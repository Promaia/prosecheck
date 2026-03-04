import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { Config } from './config-schema.js';
import type { Rule } from '../types/index.js';
import { buildIgnoreFilter, buildInclusionFilter } from './ignore.js';

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
 * 1. Compute the comparison ref (explicit, or merge-base with baseBranch)
 * 2. Optionally read last-run hash for incremental narrowing
 * 3. Run `git diff --name-only` to get changed files
 * 4. Filter through global ignore patterns
 * 5. Match files to rule scopes
 * 6. Optionally write the current HEAD as the new last-run hash
 */
export async function detectChanges(
  options: ChangeDetectionOptions,
): Promise<ChangeDetectionResult> {
  const { projectRoot, config, rules } = options;

  // Determine the comparison ref for agents (merge-base with baseBranch)
  const comparisonRef =
    options.comparisonRef ?? (await getMergeBase(projectRoot, config.baseBranch));

  // Determine the diff ref (may differ from comparisonRef when using last-run)
  let diffRef = comparisonRef;
  if (config.lastRun.read) {
    const lastRunHash = await readLastRunHash(projectRoot);
    if (lastRunHash) {
      diffRef = lastRunHash;
    }
  }

  // Get changed files from git
  const rawChangedFiles = await getChangedFiles(projectRoot, diffRef);

  // Apply global ignore filtering
  const globalFilter = await buildIgnoreFilter(
    projectRoot,
    config.globalIgnore,
    config.additionalIgnore,
  );

  const changedFiles = rawChangedFiles.filter((f) => !globalFilter.ignores(f));

  // Match changed files to rule scopes (global ignore already applied above)
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

  // Prepare deferred last-run write for the caller (engine) to invoke after success
  if (config.lastRun.write) {
    const headHash = await getCurrentHead(projectRoot);
    result.commitLastRunHash = () => writeLastRunHash(projectRoot, headHash);
  }

  return result;
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
 * Get the list of changed files between a ref and HEAD.
 * Returns paths relative to project root, using forward slashes.
 */
export async function getChangedFiles(
  projectRoot: string,
  ref: string,
): Promise<string[]> {
  const { stdout } = await execa('git', ['diff', '--name-only', ref], {
    cwd: projectRoot,
  });

  if (!stdout.trim()) {
    return [];
  }

  return stdout.trim().split('\n');
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

/**
 * Read the last-run hash from `.prosecheck/last-user-run`.
 * Returns undefined if the file doesn't exist or contains an invalid hash.
 */
export async function readLastRunHash(
  projectRoot: string,
): Promise<string | undefined> {
  try {
    const content = await readFile(
      path.join(projectRoot, LAST_RUN_PATH),
      'utf-8',
    );
    const hash = content.trim();
    if (!hash) return undefined;
    if (!GIT_HASH_RE.test(hash)) return undefined;
    return hash;
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Write the current HEAD hash to `.prosecheck/last-user-run`.
 */
export async function writeLastRunHash(
  projectRoot: string,
  hash: string,
): Promise<void> {
  const filePath = path.join(projectRoot, LAST_RUN_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, hash + '\n', 'utf-8');
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
