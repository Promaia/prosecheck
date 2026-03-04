import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Rule } from '../types/index.js';
import { buildOrchestrationPrompt } from '../lib/orchestration-prompt.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface UserPromptModeOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** Expected rule IDs (used to determine when all outputs are collected) */
  expectedRuleIds: string[];
  /** Triggered rules (for rule names in the prompt) */
  rules: Rule[];
  /** Whether to use agent teams mode */
  agentTeams: boolean;
}

/**
 * Build the prompt that the user pastes into Claude Code (or another LLM).
 *
 * Uses the shared orchestration prompt builder — same code path as
 * claude-code single-instance mode.
 */
export function buildUserPrompt(options: UserPromptModeOptions): string {
  return buildOrchestrationPrompt({
    projectRoot: options.projectRoot,
    promptPaths: options.promptPaths,
    rules: options.rules,
    agentTeams: options.agentTeams,
  });
}

/**
 * Watch the outputs directory for result files.
 *
 * Resolves when all expected output files exist, or when the abort signal
 * fires. Returns the set of rule IDs that have output files.
 */
export async function watchForOutputs(
  options: UserPromptModeOptions,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const outputsDir = path.join(options.projectRoot, OUTPUTS_DIR);
  const expectedIds = new Set(options.expectedRuleIds);

  // Check what already exists
  const completed = await getCompletedRuleIds(outputsDir, expectedIds);
  if (completed.size >= expectedIds.size) {
    return completed;
  }

  // Watch for new files
  return new Promise<Set<string>>((resolve) => {
    if (signal?.aborted) {
      resolve(completed);
      return;
    }

    const watcher = watch(outputsDir, () => {
      void getCompletedRuleIds(outputsDir, expectedIds).then((nowCompleted) => {
        if (nowCompleted.size >= expectedIds.size) {
          watcher.close();
          resolve(nowCompleted);
        }
      });
    });

    signal?.addEventListener(
      'abort',
      () => {
        watcher.close();
        void getCompletedRuleIds(outputsDir, expectedIds).then(
          (ids) => {
            resolve(ids);
          },
          () => {
            resolve(completed);
          },
        );
      },
      { once: true },
    );
  });
}

async function getCompletedRuleIds(
  outputsDir: string,
  expectedIds: Set<string>,
): Promise<Set<string>> {
  const completed = new Set<string>();
  try {
    const files = await readdir(outputsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const ruleId = file.slice(0, -5); // strip .json
      if (expectedIds.has(ruleId)) {
        completed.add(ruleId);
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return completed;
}
