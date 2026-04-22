import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { Config } from './config-schema.js';
import type { Rule } from '../types/index.js';
import { buildIgnoreFilter, buildInclusionFilter } from './ignore.js';
import { computeFilesHash } from './content-hash.js';
import { computeRuleFingerprint } from './fingerprint.js';

export interface ChangeDetectionOptions {
  /** Project root directory */
  projectRoot: string;
  /** Resolved configuration */
  config: Config;
  /** All discovered rules */
  rules: Rule[];
  /** Explicit comparison ref override (from CLI --ref flag) */
  comparisonRef?: string;
  /** Prompt template used for rule fingerprinting */
  promptTemplate: string;
  /** Global system prompt used for rule fingerprinting (undefined if absent) */
  globalPrompt: string | undefined;
}

export interface ChangeDetectionResult {
  /** The git ref agents should compare against */
  comparisonRef: string;
  /** Rules that need to run this round */
  triggeredRules: Rule[];
  /** Rules skipped because their cache entry is current (only when lastRun.read) */
  cachedRules: Rule[];
  /** All changed files across triggered rules (after global ignore filtering) */
  changedFiles: string[];
  /** Map from rule ID to changed files in that rule's scope */
  changedFilesByRule: Map<string, string[]>;
  /**
   * Callback to persist the per-rule cache after a run. Only present when
   * `config.lastRun.write` is enabled. Accepts the set of rule IDs that
   * passed and removes entries for triggered rules that did not pass.
   */
  writeRuleCacheEntries?: (passingRuleIds: Set<string>) => Promise<void>;
}

/**
 * Per-rule change detection.
 *
 * For each rule, compare its current in-scope file hashes and fingerprint
 * against the stored cache entry. Trigger the rule if no entry exists, the
 * fingerprint differs, or any in-scope file has changed. Otherwise the rule
 * is "cached" and skipped for this run.
 *
 * When `lastRun.read` is off, cache entries are ignored and rules trigger
 * via git-diff against the comparison ref (legacy narrowing behavior).
 */
export async function detectChanges(
  options: ChangeDetectionOptions,
): Promise<ChangeDetectionResult> {
  const { projectRoot, config, rules, promptTemplate, globalPrompt } = options;

  const comparisonRef =
    options.comparisonRef ??
    (await getMergeBase(projectRoot, config.baseBranch));

  const globalFilter = await buildIgnoreFilter(
    projectRoot,
    config.globalIgnore,
    config.additionalIgnore,
  );

  // Build the shared universe of files (tracked + untracked, globally un-ignored)
  const allFiles = await listAllFiles(projectRoot);
  const unIgnored = allFiles.filter((f) => !globalFilter.ignores(f));

  // Compute per-rule in-scope file sets
  const filesByRule = new Map<string, string[]>();
  for (const rule of rules) {
    const inclusionFilter = buildInclusionFilter(rule.inclusions);
    filesByRule.set(rule.id, unIgnored.filter(inclusionFilter).sort());
  }

  const fingerprintInputs = { promptTemplate, globalPrompt };
  const fingerprintByRule = new Map<string, string>();
  for (const rule of rules) {
    fingerprintByRule.set(
      rule.id,
      computeRuleFingerprint(rule, fingerprintInputs),
    );
  }

  // Compute current per-rule file hashes (only for files we care about)
  const hashesByRule = new Map<string, Record<string, string>>();
  const allInScope = new Set<string>();
  for (const files of filesByRule.values()) {
    for (const f of files) allInScope.add(f);
  }
  const { files: currentHashes } = await computeFilesHash(projectRoot, [
    ...allInScope,
  ]);
  for (const rule of rules) {
    const scoped: Record<string, string> = {};
    for (const f of filesByRule.get(rule.id) ?? []) {
      const h = currentHashes[f];
      if (h !== undefined) scoped[f] = h;
    }
    hashesByRule.set(rule.id, scoped);
  }

  const triggeredRules: Rule[] = [];
  const cachedRules: Rule[] = [];
  const changedFilesByRule = new Map<string, string[]>();
  const allChanged = new Set<string>();

  if (config.lastRun.read) {
    const lastRun = await readLastRunData(projectRoot);
    for (const rule of rules) {
      const entry = lastRun?.rules[rule.id];
      const currentFiles = hashesByRule.get(rule.id) ?? {};
      const currentFingerprint = fingerprintByRule.get(rule.id) ?? '';

      const changed = diffFileMaps(entry?.files, currentFiles);
      const fingerprintChanged =
        !entry || entry.fingerprint !== currentFingerprint;

      if (!fingerprintChanged && changed.length === 0) {
        cachedRules.push(rule);
        continue;
      }

      triggeredRules.push(rule);
      const fallback = fingerprintChanged
        ? Object.keys(currentFiles).sort()
        : changed;
      changedFilesByRule.set(rule.id, fallback);
      for (const f of fallback) allChanged.add(f);
    }
  } else {
    // Legacy narrowing: git diff against comparisonRef determines triggered set.
    const rawChanged = await getChangedFiles(projectRoot, comparisonRef);
    const changed = rawChanged.filter((f) => !globalFilter.ignores(f));
    for (const f of changed) allChanged.add(f);

    for (const rule of rules) {
      const inclusionFilter = buildInclusionFilter(rule.inclusions);
      const ruleChanged = changed.filter(inclusionFilter);
      if (ruleChanged.length > 0) {
        triggeredRules.push(rule);
        changedFilesByRule.set(rule.id, ruleChanged);
      }
    }
  }

  const result: ChangeDetectionResult = {
    comparisonRef,
    triggeredRules,
    cachedRules,
    changedFiles: [...allChanged].sort(),
    changedFilesByRule,
  };

  if (config.lastRun.write) {
    result.writeRuleCacheEntries = buildCacheWriter(
      projectRoot,
      triggeredRules,
      hashesByRule,
      fingerprintByRule,
    );
  }

  return result;
}

/**
 * Return the set of file paths that changed between the stored and current
 * per-file hash maps (additions, modifications, deletions).
 */
function diffFileMaps(
  stored: Record<string, string> | undefined,
  current: Record<string, string>,
): string[] {
  if (!stored) {
    return Object.keys(current).sort();
  }
  const changed = new Set<string>();
  for (const [filePath, hash] of Object.entries(current)) {
    if (stored[filePath] !== hash) changed.add(filePath);
  }
  for (const filePath of Object.keys(stored)) {
    if (current[filePath] === undefined) changed.add(filePath);
  }
  return [...changed].sort();
}

/**
 * Build the deferred cache writer callback. Reads existing entries, updates
 * only the rules that were triggered this run (writing passes, removing
 * non-passes), and leaves other entries untouched.
 */
function buildCacheWriter(
  projectRoot: string,
  triggeredRules: Rule[],
  hashesByRule: Map<string, Record<string, string>>,
  fingerprintByRule: Map<string, string>,
): (passingRuleIds: Set<string>) => Promise<void> {
  return async (passingRuleIds: Set<string>) => {
    const existing = (await readLastRunData(projectRoot)) ?? { rules: {} };
    const triggeredIds = new Set(triggeredRules.map((r) => r.id));
    const rules: Record<string, CachedRuleEntry> = {};

    // Preserve entries for rules that were not triggered this run
    for (const [ruleId, entry] of Object.entries(existing.rules)) {
      if (!triggeredIds.has(ruleId)) {
        rules[ruleId] = entry;
      }
    }

    // Write entries for triggered rules that passed
    for (const rule of triggeredRules) {
      if (passingRuleIds.has(rule.id)) {
        rules[rule.id] = {
          files: hashesByRule.get(rule.id) ?? {},
          fingerprint: fingerprintByRule.get(rule.id) ?? '',
          status: 'pass',
        };
      }
    }

    await writeLastRunData(projectRoot, { rules });
  };
}

export async function listAllFiles(projectRoot: string): Promise<string[]> {
  const { stdout: trackedOutput } = await execa('git', ['ls-files'], {
    cwd: projectRoot,
  });
  const { stdout: untrackedOutput } = await execa(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: projectRoot },
  );

  const allFiles = new Set<string>();
  for (const line of trackedOutput.trim().split('\n')) {
    if (line) allFiles.add(line);
  }
  for (const line of untrackedOutput.trim().split('\n')) {
    if (line) allFiles.add(line);
  }
  return [...allFiles];
}

/**
 * Compute the merge-base between HEAD and the given base branch.
 * Falls back to the base branch ref if merge-base fails.
 */
export async function getMergeBase(
  projectRoot: string,
  baseBranch: string,
): Promise<string> {
  try {
    const { stdout } = await execa('git', ['merge-base', 'HEAD', baseBranch], {
      cwd: projectRoot,
    });
    return stdout.trim();
  } catch {
    return baseBranch;
  }
}

/**
 * Get the list of changed files between a ref and HEAD, including untracked.
 */
export async function getChangedFiles(
  projectRoot: string,
  ref: string,
): Promise<string[]> {
  const { stdout: diffOutput } = await execa(
    'git',
    ['diff', '--name-only', ref],
    { cwd: projectRoot },
  );
  const { stdout: untrackedOutput } = await execa(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: projectRoot },
  );

  const files = new Set<string>();
  for (const line of diffOutput.trim().split('\n')) {
    if (line) files.add(line);
  }
  for (const line of untrackedOutput.trim().split('\n')) {
    if (line) files.add(line);
  }
  return [...files];
}

/**
 * Get the current HEAD commit hash.
 */
export async function getCurrentHead(projectRoot: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
  });
  return stdout.trim();
}

const LAST_RUN_PATH = '.prosecheck/last-user-run';

export interface CachedRuleEntry {
  /** Per-file content hashes for files in this rule's scope at last pass */
  files: Record<string, string>;
  /** Fingerprint over rule text + inclusions + model + frontmatter + templates */
  fingerprint: string;
  /** Only 'pass' entries are stored — non-pass never caches */
  status: 'pass';
}

export interface LastRunData {
  rules: Record<string, CachedRuleEntry>;
}

/**
 * Read per-rule cache data from `.prosecheck/last-user-run`.
 * Returns undefined if the file does not exist or is unparseable.
 * Unknown shapes are treated as absent (ADR-014 specifies no migration shim).
 */
export async function readLastRunData(
  projectRoot: string,
): Promise<LastRunData | undefined> {
  let content: string;
  try {
    content = await readFile(path.join(projectRoot, LAST_RUN_PATH), 'utf-8');
  } catch (error: unknown) {
    if (isEnoent(error)) return undefined;
    throw error;
  }

  const trimmed = content.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rawRules = parsed['rules'];
    if (!rawRules || typeof rawRules !== 'object' || Array.isArray(rawRules)) {
      return undefined;
    }

    const rules: Record<string, CachedRuleEntry> = {};
    for (const [ruleId, raw] of Object.entries(
      rawRules as Record<string, unknown>,
    )) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const obj = raw as Record<string, unknown>;
      const files = obj['files'];
      const fingerprint = obj['fingerprint'];
      const status = obj['status'];
      if (
        files &&
        typeof files === 'object' &&
        !Array.isArray(files) &&
        typeof fingerprint === 'string' &&
        status === 'pass'
      ) {
        rules[ruleId] = {
          files: files as Record<string, string>,
          fingerprint,
          status: 'pass',
        };
      }
    }
    return { rules };
  } catch {
    return undefined;
  }
}

/**
 * Write per-rule cache data to `.prosecheck/last-user-run` as compact JSON.
 */
export async function writeLastRunData(
  projectRoot: string,
  data: LastRunData,
): Promise<void> {
  const filePath = path.join(projectRoot, LAST_RUN_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data) + '\n', 'utf-8');
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
