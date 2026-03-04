import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface UserPromptModeOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** Expected rule IDs (used to determine when all outputs are collected) */
  expectedRuleIds: string[];
}

/**
 * Build the orchestration prompt that lists all prompt file paths.
 *
 * The user pastes this into Claude Code (or another LLM interface).
 * The prompt instructs the agent to read each prompt file and write
 * output to the corresponding output path.
 */
export function buildOrchestrationPrompt(
  options: UserPromptModeOptions,
): string {
  const lines: string[] = [
    '# Prosecheck — Rule Evaluation',
    '',
    'You are a code linter. For each rule below, read the prompt file, evaluate the codebase against the rule, and write your JSON result to the specified output path.',
    '',
    '## Rules to Evaluate',
    '',
  ];

  for (const [ruleId, promptPath] of options.promptPaths) {
    const outputPath = path.join(
      options.projectRoot,
      OUTPUTS_DIR,
      `${ruleId}.json`,
    );
    lines.push(`### ${ruleId}`);
    lines.push(`- **Prompt:** \`${promptPath}\``);
    lines.push(`- **Output:** \`${outputPath}\``);
    lines.push('');
  }

  lines.push('## Instructions');
  lines.push('');
  lines.push(
    '1. Read each prompt file listed above.',
  );
  lines.push(
    '2. Evaluate the codebase against each rule as described in the prompt.',
  );
  lines.push(
    '3. Write your JSON result for each rule to its output path.',
  );
  lines.push(
    '4. Each output file must conform to the schema described in the prompt.',
  );

  return lines.join('\n');
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
      void getCompletedRuleIds(outputsDir, expectedIds).then(
        (nowCompleted) => {
          if (nowCompleted.size >= expectedIds.size) {
            watcher.close();
            resolve(nowCompleted);
          }
        },
      );
    });

    signal?.addEventListener(
      'abort',
      () => {
        watcher.close();
        void getCompletedRuleIds(outputsDir, expectedIds).then(
          (ids) => { resolve(ids); },
          () => { resolve(completed); },
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
