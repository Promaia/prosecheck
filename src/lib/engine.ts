import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Rule, Config, RunContext, OnProgress } from '../types/index.js';
import type { CollectResultsOutput } from './results.js';
import type { ChangeDetectionResult } from './change-detection.js';
import { runCalculators } from './calculators/index.js';
import {
  detectChanges,
  readLastRunData,
  writeLastRunData,
  collectInScopeFiles,
  getCurrentHead,
} from './change-detection.js';
import { computeFilesHash } from './content-hash.js';
import { buildIgnoreFilter } from './ignore.js';
import { generatePrompts, loadGlobalPrompt } from './prompt.js';
import { collectResults, computeOverallStatus } from './results.js';
import { executePostRun } from './post-run.js';
import { buildUserPrompt, watchForOutputs } from '../modes/user-prompt.js';
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
  await mkdir(path.join(workingDir, 'outputs'), { recursive: true });

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

  // 2b. Hash-check mode — compare content hashes without launching agents
  if (context.hashCheck) {
    return runHashCheck(projectRoot, config, rules, format);
  }

  // 2c. Hash-check-write mode — update stored hashes without running agents
  if (context.hashCheckWrite) {
    return runHashCheckWrite(projectRoot, config, rules, format);
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

  // 4b. In user-prompt mode, print the prompt before the UI starts rendering
  if (mode === 'user-prompt') {
    const agentTeams =
      config.claudeCode.claudeToRuleShape === 'one-to-many-teams';
    const orchestrationPrompt = buildUserPrompt({
      projectRoot,
      promptPaths,
      expectedRuleIds: changeResult.triggeredRules.map((r) => r.id),
      rules: changeResult.triggeredRules,
      agentTeams,
    });
    process.stdout.write(
      [
        'USER-PROMPT MODE',
        'Copy-and-paste the following into your Claude Code session to have it generate outputs.',
        '---',
        orchestrationPrompt,
        '---',
        '',
      ].join('\n'),
    );
  }

  // Fire 'discovered' progress events
  const onProgress = context.onProgress;
  if (onProgress) {
    for (const rule of changeResult.triggeredRules) {
      onProgress({ phase: 'discovered', ruleId: rule.id, ruleName: rule.name });
    }
  }

  // Fire 'running' progress events
  if (onProgress) {
    for (const rule of changeResult.triggeredRules) {
      onProgress({ phase: 'running', ruleId: rule.id, ruleName: rule.name });
    }
  }

  // 4b. Load global system prompt for claude-code mode
  const globalPrompt = await loadGlobalPrompt(projectRoot);

  // 5. Dispatch to operating mode (with live output watching if progress callback)
  let stopWatcher: (() => void) | undefined;
  if (onProgress) {
    const { watchOutputs } = await import('./output-watcher.js');
    stopWatcher = watchOutputs({
      projectRoot,
      expectedRules: changeResult.triggeredRules,
      onResult: (ruleId, ruleName, result) => {
        onProgress({ phase: 'result', ruleId, ruleName, result });
      },
    });
  }

  const timeoutMs = config.timeout * 1000;
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    await dispatchMode(
      mode,
      projectRoot,
      promptPaths,
      changeResult.triggeredRules,
      config,
      globalPrompt,
      signal,
    );
  } catch (error: unknown) {
    if (isTimeoutError(error)) {
      // Timeout — fall through to collect partial results
    } else {
      throw error;
    }
  }

  stopWatcher?.();

  // 6. Collect results
  const collected = await collectResults({
    projectRoot,
    expectedRules: changeResult.triggeredRules,
  });

  // 6b. Retry dropped rules if configured
  if (config.retryDropped && collected.dropped.length > 0) {
    await retryDroppedRules({
      collected,
      config,
      projectRoot,
      mode,
      changeResult,
      onProgress,
      globalPrompt,
      signal,
    });
  }

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
  globalPrompt: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const expectedRuleIds = triggeredRules.map((r) => r.id);

  const agentTeams =
    config.claudeCode.claudeToRuleShape === 'one-to-many-teams';

  switch (mode) {
    case 'user-prompt': {
      // Prompt was already printed before the UI started rendering
      await watchForOutputs(
        {
          projectRoot,
          promptPaths,
          expectedRuleIds,
          rules: triggeredRules,
          agentTeams,
        },
        signal,
      );
      break;
    }
    case 'claude-code': {
      await runClaudeCode({
        projectRoot,
        promptPaths,
        claudeToRuleShape: config.claudeCode.claudeToRuleShape,
        maxConcurrentAgents: config.claudeCode.maxConcurrentAgents,
        maxTurns: config.claudeCode.maxTurns,
        allowedTools: config.claudeCode.allowedTools,
        tools: config.claudeCode.tools,
        additionalArgs: config.claudeCode.additionalArgs,
        systemPrompt: globalPrompt,
        rules: triggeredRules,
        signal,
      });
      break;
    }
    default:
      throw new Error(`Unknown operating mode: "${mode}"`);
  }
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
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

interface RetryDroppedOptions {
  collected: CollectResultsOutput;
  config: Config;
  projectRoot: string;
  mode: string;
  changeResult: ChangeDetectionResult;
  onProgress: OnProgress | undefined;
  globalPrompt: string | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Retry rules that produced no output file. Re-generates prompts for just
 * the dropped rules, re-dispatches to the operating mode, and merges any
 * new results back into the collected output.
 *
 * Runs up to `config.retryDroppedMaxAttempts` retry rounds. Each round
 * only retries rules that are still dropped.
 */
async function retryDroppedRules(options: RetryDroppedOptions): Promise<void> {
  const {
    collected,
    config,
    projectRoot,
    mode,
    changeResult,
    onProgress,
    globalPrompt,
    signal,
  } = options;
  const maxAttempts = config.retryDroppedMaxAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (collected.dropped.length === 0) break;

    const droppedRules = collected.dropped.map((d) => d.rule);

    // Fire progress events for retried rules
    if (onProgress) {
      for (const rule of droppedRules) {
        onProgress({ phase: 'running', ruleId: rule.id, ruleName: rule.name });
      }
    }

    // Re-generate prompts for dropped rules
    const { promptPaths } = await generatePrompts({
      projectRoot,
      rules: droppedRules,
      comparisonRef: changeResult.comparisonRef,
      changedFilesByRule: changeResult.changedFilesByRule,
    });

    // Re-dispatch
    await dispatchMode(
      mode,
      projectRoot,
      promptPaths,
      droppedRules,
      config,
      globalPrompt,
      signal,
    );

    // Collect results for retried rules only
    const retryCollected = await collectResults({
      projectRoot,
      expectedRules: droppedRules,
    });

    // Merge retry results into the main collected output:
    // - Successful results replace dropped entries
    // - Still-dropped rules remain but with bumped attempt count
    const newlyResolved = new Set(retryCollected.results.map((r) => r.ruleId));

    // Add newly successful results
    for (const result of retryCollected.results) {
      collected.results.push(result);
    }

    // Add any new errors
    for (const error of retryCollected.errors) {
      const errorRuleId = error.ruleId;
      newlyResolved.add(errorRuleId);
      collected.errors.push(error);
    }

    // Update dropped list: keep only rules that are still dropped, bump attempt
    collected.dropped = retryCollected.dropped.map((d) => ({
      rule: d.rule,
      attempt: attempt + 1,
    }));

    // Fire progress events for resolved rules
    if (onProgress) {
      for (const result of retryCollected.results) {
        const rule = droppedRules.find((r) => r.id === result.ruleId);
        if (rule) {
          onProgress({
            phase: 'result',
            ruleId: rule.id,
            ruleName: rule.name,
            result: result.result,
          });
        }
      }
    }
  }

  // Recompute overall status after retries
  collected.overallStatus = computeOverallStatus(
    collected.results,
    collected.dropped,
    collected.errors,
  );
}

/**
 * Hash-check mode: compare in-scope file content hashes against stored
 * last-run data. Passes if nothing changed, fails if files differ.
 * No agents are launched and no API key is needed.
 */
async function runHashCheck(
  projectRoot: string,
  config: Config,
  rules: Rule[],
  format: string,
): Promise<EngineResult> {
  const globalFilter = await buildIgnoreFilter(
    projectRoot,
    config.globalIgnore,
    config.additionalIgnore,
  );

  // Collect all in-scope files
  const inScopeFiles = await collectInScopeFiles(
    projectRoot,
    rules,
    globalFilter,
  );

  // Compute current content hashes
  const current = await computeFilesHash(projectRoot, inScopeFiles);

  // Read stored last-run data
  const lastRun = await readLastRunData(projectRoot);

  const failResults: CollectResultsOutput = {
    results: [],
    dropped: [],
    errors: [],
    overallStatus: 'fail',
  };

  if (!lastRun) {
    return hashCheckResult(
      'Hash check failed: no last-run data found. Run prosecheck lint --last-run-write 1 first.',
      'fail',
      failResults,
      format,
    );
  }

  if (!lastRun.filesHash) {
    return hashCheckResult(
      'Hash check failed: last-run data has no filesHash. Re-run prosecheck lint --last-run-write 1 to generate content hashes.',
      'fail',
      failResults,
      format,
    );
  }

  if (current.filesHash === lastRun.filesHash) {
    const passResults: CollectResultsOutput = {
      results: [],
      dropped: [],
      errors: [],
      overallStatus: 'pass',
    };
    return hashCheckResult(
      `Hash check passed: ${String(inScopeFiles.length)} in-scope files unchanged since last run.`,
      'pass',
      passResults,
      format,
    );
  }

  // Digest mismatch — report which files changed if per-file detail is available
  const changedFiles: string[] = [];
  if (lastRun.files) {
    for (const [filePath, hash] of Object.entries(current.files)) {
      if (lastRun.files[filePath] !== hash) {
        changedFiles.push(filePath);
      }
    }
    for (const filePath of Object.keys(lastRun.files)) {
      if (current.files[filePath] === undefined) {
        changedFiles.push(filePath);
      }
    }
  }

  let msg = 'Hash check failed: in-scope files changed since last run.';
  if (changedFiles.length > 0) {
    msg += ' Changed files:\n' + changedFiles.map((f) => `  - ${f}`).join('\n');
  }
  msg += '\nRun prosecheck lint --last-run-write 1 to update.';

  return hashCheckResult(msg, 'fail', failResults, format);
}

/**
 * Hash-check-write mode: compute current content hashes and write them
 * to the last-run file without running any agents. Lets users manually
 * mark the current state as "checked" when they know changes are irrelevant.
 */
async function runHashCheckWrite(
  projectRoot: string,
  config: Config,
  rules: Rule[],
  format: string,
): Promise<EngineResult> {
  const globalFilter = await buildIgnoreFilter(
    projectRoot,
    config.globalIgnore,
    config.additionalIgnore,
  );

  const inScopeFiles = await collectInScopeFiles(
    projectRoot,
    rules,
    globalFilter,
  );

  const current = await computeFilesHash(projectRoot, inScopeFiles);
  const headHash = await getCurrentHead(projectRoot);

  await writeLastRunData(projectRoot, {
    commitHash: headHash,
    filesHash: current.filesHash,
    files: config.lastRun.files ? current.files : undefined,
  });

  const passResults: CollectResultsOutput = {
    results: [],
    dropped: [],
    errors: [],
    overallStatus: 'pass',
  };

  const msg = `Hash check write: updated last-run hashes for ${String(inScopeFiles.length)} in-scope files.`;
  return hashCheckResult(msg, 'pass', passResults, format);
}

function hashCheckResult(
  message: string,
  overallStatus: string,
  results: CollectResultsOutput,
  format: string,
): EngineResult {
  // For structured formats, use the standard formatter so output is valid JSON/SARIF
  const output = format === 'stylish' ? message : formatOutput(results, format);
  return { output, overallStatus, results };
}
