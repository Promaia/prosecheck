import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { Config } from './config-schema.js';
import type { Rule } from '../types/index.js';
import { buildIgnoreFilter, buildInclusionFilter } from './ignore.js';
import { computeFilesHash } from './content-hash.js';

export interface ChangeDetectionOptions {
  /** Project root directory */
  projectRoot: string;
  /** Resolved configuration */
  config: Config;
  /** All discovered rules */
  rules: Rule[];
  /** Explicit comparison ref override (from CLI --ref flag) */
  comparisonRef?: string;
}

export interface ChangeDetectionResult {
  /** The git ref agents should compare against */
  comparisonRef: string;
  /** Rules that have at least one changed file in their scope */
  triggeredRules: Rule[];
  /** All changed files (after global ignore filtering) */
  changedFiles: string[];
  /** Map from rule ID to the changed files within that rule's scope */
  changedFilesByRule: Map<string, string[]>;
  /**
   * Callback to persist the current HEAD as the last-run hash.
   * Only present when `config.lastRun.write` is enabled.
   * The caller (engine) should invoke this after a successful run.
   */
  commitLastRunHash?: () => Promise<void>;
}

/**
 * Detect changed files and determine which rules should be triggered.
 *
 * When `lastRun.read` is enabled, uses a tiered detection strategy:
 * 1. **Files-based**: If stored per-file hashes exist, diff against current
 *    content hashes to find exactly which files changed.
 * 2. **Digest-only**: If only a filesHash digest exists and it matches,
 *    skip all rules (nothing changed). On mismatch, fall through.
 * 3. **Git-based**: Use stored commitHash as git diff ref.
 * 4. **Merge-base**: Default fallback using `git merge-base HEAD baseBranch`.
 *
 * When `lastRun.write` is enabled, prepares a deferred callback that writes
 * both git hash and content hashes to the last-run file.
 */
export async function detectChanges(
  options: ChangeDetectionOptions,
): Promise<ChangeDetectionResult> {
  const { projectRoot, config, rules } = options;

  // Determine the comparison ref for agents (merge-base with baseBranch)
  const comparisonRef =
    options.comparisonRef ??
    (await getMergeBase(projectRoot, config.baseBranch));

  // Build global ignore filter (shared across all detection paths)
  const globalFilter = await buildIgnoreFilter(
    projectRoot,
    config.globalIgnore,
    config.additionalIgnore,
  );

  // Collect all in-scope file paths across all rules (for content hashing)
  const allInScopeFiles = await collectInScopeFiles(
    projectRoot,
    rules,
    globalFilter,
  );

  // Try files-based detection first when lastRun.read is enabled
  let lastRunData: LastRunData | undefined;
  if (config.lastRun.read) {
    lastRunData = await readLastRunData(projectRoot);

    if (lastRunData) {
      // Tier 1: Files-based diff (stored per-file hashes exist)
      if (lastRunData.files) {
        const result = await detectChangesFromFileHashes(
          projectRoot,
          rules,
          allInScopeFiles,
          lastRunData.files,
          comparisonRef,
          config,
        );
        if (result) return result;
      }

      // Tier 2: Digest-only (filesHash exists but no per-file detail)
      if (lastRunData.filesHash && !lastRunData.files) {
        const current = await computeFilesHash(projectRoot, allInScopeFiles);
        if (current.filesHash === lastRunData.filesHash) {
          // Nothing changed — no rules triggered
          return buildEmptyResult(
            comparisonRef,
            config,
            projectRoot,
            rules,
            allInScopeFiles,
          );
        }
        // Digest mismatch — fall through to git-based
      }
    }
  }

  // Tier 3: Git-based diff (commitHash or merge-base)
  let diffRef = comparisonRef;
  if (config.lastRun.read && lastRunData?.commitHash) {
    diffRef = lastRunData.commitHash;
  }

  const rawChangedFiles = await getChangedFiles(projectRoot, diffRef);
  const changedFiles = rawChangedFiles.filter((f) => !globalFilter.ignores(f));

  return buildResult(
    changedFiles,
    rules,
    comparisonRef,
    config,
    projectRoot,
    allInScopeFiles,
  );
}

/**
 * Detect changes by comparing stored per-file hashes against current content.
 * Returns a ChangeDetectionResult if the comparison is conclusive, or
 * undefined to signal that the caller should fall through to git-based.
 */
async function detectChangesFromFileHashes(
  projectRoot: string,
  rules: Rule[],
  allInScopeFiles: string[],
  storedFiles: Record<string, string>,
  comparisonRef: string,
  config: Config,
): Promise<ChangeDetectionResult | undefined> {
  const current = await computeFilesHash(projectRoot, allInScopeFiles);

  // Find files that changed, were added, or were removed
  const changedFiles: string[] = [];
  for (const [filePath, hash] of Object.entries(current.files)) {
    if (storedFiles[filePath] !== hash) {
      changedFiles.push(filePath);
    }
  }
  // Files that were in the stored set but no longer exist
  for (const filePath of Object.keys(storedFiles)) {
    if (current.files[filePath] === undefined) {
      changedFiles.push(filePath);
    }
  }

  return buildResult(
    changedFiles,
    rules,
    comparisonRef,
    config,
    projectRoot,
    allInScopeFiles,
  );
}

/**
 * Build a ChangeDetectionResult from a list of changed files.
 */
function buildResult(
  changedFiles: string[],
  rules: Rule[],
  comparisonRef: string,
  config: Config,
  projectRoot: string,
  allInScopeFiles: string[],
): ChangeDetectionResult {
  const changedFilesByRule = new Map<string, string[]>();
  const triggeredRules: Rule[] = [];

  for (const rule of rules) {
    const inclusionFilter = buildInclusionFilter(rule.inclusions);
    const ruleFiles = changedFiles.filter(inclusionFilter);
    if (ruleFiles.length > 0) {
      changedFilesByRule.set(rule.id, ruleFiles);
      triggeredRules.push(rule);
    }
  }

  const result: ChangeDetectionResult = {
    comparisonRef,
    triggeredRules,
    changedFiles,
    changedFilesByRule,
  };

  if (config.lastRun.write) {
    result.commitLastRunHash = buildLastRunWriter(
      projectRoot,
      config,
      allInScopeFiles,
    );
  }

  return result;
}

/**
 * Build an empty result (no triggered rules) with an optional last-run writer.
 */
function buildEmptyResult(
  comparisonRef: string,
  config: Config,
  projectRoot: string,
  rules: Rule[],
  allInScopeFiles: string[],
): ChangeDetectionResult {
  return buildResult(
    [],
    rules,
    comparisonRef,
    config,
    projectRoot,
    allInScopeFiles,
  );
}

/**
 * Build the deferred last-run writer callback.
 */
function buildLastRunWriter(
  projectRoot: string,
  config: Config,
  allInScopeFiles: string[],
): () => Promise<void> {
  return async () => {
    const headHash = await getCurrentHead(projectRoot);
    const { filesHash, files } = await computeFilesHash(
      projectRoot,
      allInScopeFiles,
    );
    await writeLastRunData(projectRoot, {
      commitHash: headHash,
      filesHash,
      files: config.lastRun.files ? files : undefined,
    });
  };
}

/**
 * Collect all file paths that fall within any rule's scope.
 * Uses `git ls-files` for tracked files plus `git ls-files --others`
 * for untracked files, then filters through global ignore and rule scopes.
 */
export async function collectInScopeFiles(
  projectRoot: string,
  rules: Rule[],
  globalFilter: { ignores: (path: string) => boolean },
): Promise<string[]> {
  // Get all tracked files
  const { stdout: trackedOutput } = await execa('git', ['ls-files'], {
    cwd: projectRoot,
  });
  // Get untracked files (respects .gitignore)
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

  // Filter through global ignore
  const filtered = [...allFiles].filter((f) => !globalFilter.ignores(f));

  // Filter to files that match at least one rule's scope
  const inScope = new Set<string>();
  for (const rule of rules) {
    const inclusionFilter = buildInclusionFilter(rule.inclusions);
    for (const file of filtered) {
      if (inclusionFilter(file)) {
        inScope.add(file);
      }
    }
  }

  return [...inScope].sort();
}

/**
 * Compute the merge-base between HEAD and the given base branch.
 * Falls back to the base branch ref itself if merge-base fails
 * (e.g. shallow clone, unrelated histories).
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
    // Fallback: use the branch ref directly (e.g. shallow clone)
    return baseBranch;
  }
}

/**
 * Get the list of changed files between a ref and HEAD, plus any
 * untracked files (new files not yet staged).
 * Returns paths relative to project root, using forward slashes.
 */
export async function getChangedFiles(
  projectRoot: string,
  ref: string,
): Promise<string[]> {
  // Changed files (committed, staged, and unstaged) since ref
  const { stdout: diffOutput } = await execa(
    'git',
    ['diff', '--name-only', ref],
    { cwd: projectRoot },
  );

  // Untracked files (respects .gitignore)
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

const GIT_HASH_RE = /^[0-9a-f]{4,40}$/;

export interface LastRunData {
  /** Git HEAD at time of run */
  commitHash: string;
  /** SHA-256 digest of all in-scope file contents */
  filesHash?: string | undefined;
  /** Per-file content hashes (only when lastRun.files is enabled) */
  files?: Record<string, string> | undefined;
}

/**
 * Read the last-run data from `.prosecheck/last-user-run`.
 *
 * Supports two formats for backwards compatibility:
 * - New JSON format: `{"commitHash":"...","filesHash":"...","files":{...}}`
 * - Legacy plain-text format: bare git hash on a single line
 *
 * Returns undefined if the file doesn't exist or is unparseable.
 */
export async function readLastRunData(
  projectRoot: string,
): Promise<LastRunData | undefined> {
  let content: string;
  try {
    content = await readFile(path.join(projectRoot, LAST_RUN_PATH), 'utf-8');
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }

  const trimmed = content.trim();
  if (!trimmed) return undefined;

  // Try JSON format first
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const commitHash = parsed['commitHash'];
      if (typeof commitHash !== 'string') return undefined;
      return {
        commitHash,
        filesHash:
          typeof parsed['filesHash'] === 'string'
            ? parsed['filesHash']
            : undefined,
        files:
          parsed['files'] &&
          typeof parsed['files'] === 'object' &&
          !Array.isArray(parsed['files'])
            ? (parsed['files'] as Record<string, string>)
            : undefined,
      };
    } catch {
      return undefined;
    }
  }

  // Legacy plain-text git hash
  if (GIT_HASH_RE.test(trimmed)) {
    return { commitHash: trimmed };
  }

  return undefined;
}

/**
 * Read only the commit hash from the last-run file (for git-based diffing).
 * Convenience wrapper around readLastRunData.
 */
export async function readLastRunHash(
  projectRoot: string,
): Promise<string | undefined> {
  const data = await readLastRunData(projectRoot);
  return data?.commitHash;
}

export interface WriteLastRunOptions {
  commitHash: string;
  filesHash?: string | undefined;
  files?: Record<string, string> | undefined;
}

/**
 * Write last-run data to `.prosecheck/last-user-run` as a single compact
 * JSON line. Non-mergeable by design — most recent version always wins.
 */
export async function writeLastRunData(
  projectRoot: string,
  data: WriteLastRunOptions,
): Promise<void> {
  const filePath = path.join(projectRoot, LAST_RUN_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  const obj: Record<string, unknown> = {
    commitHash: data.commitHash,
  };
  if (data.filesHash !== undefined) {
    obj['filesHash'] = data.filesHash;
  }
  if (data.files !== undefined) {
    obj['files'] = data.files;
  }
  await writeFile(filePath, JSON.stringify(obj) + '\n', 'utf-8');
}

/**
 * Write the current HEAD hash to `.prosecheck/last-user-run`.
 * @deprecated Use writeLastRunData for the new JSON format.
 */
export async function writeLastRunHash(
  projectRoot: string,
  hash: string,
): Promise<void> {
  await writeLastRunData(projectRoot, { commitHash: hash });
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
