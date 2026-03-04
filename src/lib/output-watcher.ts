import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Rule } from '../types/index.js';
import type { RuleResult } from './config-schema.js';
import { parseResultFile } from './results.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface WatchOutputsOptions {
  /** Project root directory */
  projectRoot: string;
  /** Rules expected to produce output */
  expectedRules: Rule[];
  /** Callback fired when a rule's output file is detected and parsed */
  onResult: (ruleId: string, ruleName: string, result: RuleResult) => void;
}

/**
 * Watch `.prosecheck/working/outputs/` for new result files.
 *
 * When a file matching an expected rule ID appears, it is read and parsed.
 * If valid, `onResult` is called. Invalid files are silently ignored
 * (the final `collectResults` pass will catch them as errors).
 *
 * Returns a stop function that closes the watcher.
 */
export function watchOutputs(options: WatchOutputsOptions): () => void {
  const { projectRoot, expectedRules, onResult } = options;
  const outputsDir = path.join(projectRoot, OUTPUTS_DIR);

  // Build lookup maps
  const ruleNames = new Map<string, string>();
  for (const rule of expectedRules) {
    ruleNames.set(rule.id, rule.name);
  }

  const seen = new Set<string>();

  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(outputsDir, (_, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      const ruleId = filename.slice(0, -5);
      if (seen.has(ruleId) || !ruleNames.has(ruleId)) return;
      seen.add(ruleId);

      const filePath = path.join(outputsDir, filename);
      void readAndNotify(filePath, ruleId, ruleNames.get(ruleId) ?? ruleId, onResult);
    });
  } catch {
    // Directory may not exist yet — that's fine, outputs will be caught by collectResults
  }

  return () => {
    watcher?.close();
  };
}

async function readAndNotify(
  filePath: string,
  ruleId: string,
  ruleName: string,
  onResult: (ruleId: string, ruleName: string, result: RuleResult) => void,
): Promise<void> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseResultFile(content, ruleId);
    if (parsed.ok) {
      onResult(ruleId, ruleName, parsed.result);
    }
  } catch {
    // File may be partially written — ignore, collectResults will handle it
  }
}
