import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Rule, Config, RunContext } from '../types/index.js';
import type { CollectResultsOutput } from './results.js';
import { runCalculators } from './calculators/index.js';
import { detectChanges } from './change-detection.js';
import { generatePrompts } from './prompt.js';
import { collectResults } from './results.js';
import { executePostRun } from './post-run.js';
import { buildOrchestrationPrompt, watchForOutputs } from '../modes/user-prompt.js';
import { runClaudeCode } from '../modes/claude-code.js';
import { formatStylish } from '../formatters/stylish.js';
import { formatJson } from '../formatters/json.js';
import { formatSarif } from '../formatters/sarif.js';

const WORKING_DIR = '.prosecheck/working';

export interface EngineResult {
  /** Formatted output string */
  output: string;
  /** Overall status for exit code determination */
  overallStatus: string;
  /** Raw collected results */
  results: CollectResultsOutput;
}

/**
 * Run the full lint pipeline:
 *
 * 1. Cleanup `.prosecheck/working/`
 * 2. Run rule calculators → collect all rules
 * 3. Run change detection → get changed files, triggered rules
 * 4. Generate per-rule prompts
 * 5. Dispatch to operating mode
 * 6. Collect results (with dropped detection)
 * 7. Format and report
 * 8. Execute post-run tasks
 * 9. Optionally persist last-run hash
 */
export async function runEngine(context: RunContext): Promise<EngineResult> {
  const { config, projectRoot, mode, format } = context;

  // 1. Clean working directory
  const workingDir = path.join(projectRoot, WORKING_DIR);
  await rm(workingDir, { recursive: true, force: true });
  await mkdir(workingDir, { recursive: true });

  // 2. Discover rules via calculators
  const rules = await runCalculators(projectRoot, config);

  if (rules.length === 0) {
    const emptyResults: CollectResultsOutput = {
      results: [],
      dropped: [],
      errors: [],
      overallStatus: 'pass',
    };
    return {
      output: formatOutput(emptyResults, format),
      overallStatus: 'pass',
      results: emptyResults,
    };
  }

  // 3. Change detection — find triggered rules
  const detectOptions: Parameters<typeof detectChanges>[0] = {
    projectRoot,
    config,
    rules,
  };
  if (context.comparisonRef) {
    detectOptions.comparisonRef = context.comparisonRef;
  }
  const changeResult = await detectChanges(detectOptions);

  if (changeResult.triggeredRules.length === 0) {
    const emptyResults: CollectResultsOutput = {
      results: [],
      dropped: [],
      errors: [],
      overallStatus: 'pass',
    };
    return {
      output: formatOutput(emptyResults, format),
      overallStatus: 'pass',
      results: emptyResults,
    };
  }

  // 4. Generate prompts for triggered rules
  const { promptPaths } = await generatePrompts({
    projectRoot,
    rules: changeResult.triggeredRules,
    comparisonRef: changeResult.comparisonRef,
    changedFilesByRule: changeResult.changedFilesByRule,
  });

  // 5. Dispatch to operating mode
  await dispatchMode(mode, projectRoot, promptPaths, changeResult.triggeredRules, config);

  // 6. Collect results
  const collected = await collectResults({
    projectRoot,
    expectedRules: changeResult.triggeredRules,
  });

  // Apply warnAsError: promote overall status
  let overallStatus = collected.overallStatus;
  if (config.warnAsError && overallStatus === 'warn') {
    overallStatus = 'fail';
  }
  collected.overallStatus = overallStatus;

  // 7. Format output
  const output = formatOutput(collected, format);

  // 8. Post-run tasks
  if (config.postRun.length > 0) {
    await executePostRun({
      projectRoot,
      commands: config.postRun,
      status: overallStatus,
    });
  }

  // 9. Persist last-run hash if applicable
  if (changeResult.commitLastRunHash) {
    await changeResult.commitLastRunHash();
  }

  return { output, overallStatus, results: collected };
}

async function dispatchMode(
  mode: string,
  projectRoot: string,
  promptPaths: Map<string, string>,
  triggeredRules: Rule[],
  config: Config,
): Promise<void> {
  const expectedRuleIds = triggeredRules.map((r) => r.id);

  switch (mode) {
    case 'user-prompt': {
      const orchestrationPrompt = buildOrchestrationPrompt({
        projectRoot,
        promptPaths,
        expectedRuleIds,
      });
      // Print prompt for user to copy
      process.stdout.write(orchestrationPrompt + '\n');
      // Watch for outputs
      await watchForOutputs({ projectRoot, promptPaths, expectedRuleIds });
      break;
    }
    case 'claude-code': {
      await runClaudeCode({
        projectRoot,
        promptPaths,
        singleInstance: config.claudeCode.singleInstance,
      });
      break;
    }
    default:
      throw new Error(`Unknown operating mode: "${mode}"`);
  }
}

function formatOutput(results: CollectResultsOutput, format: string): string {
  switch (format) {
    case 'stylish':
      return formatStylish(results);
    case 'json':
      return formatJson(results);
    case 'sarif':
      return formatSarif(results);
    default:
      return formatStylish(results);
  }
}
