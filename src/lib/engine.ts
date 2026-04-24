import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Rule, Config, RunContext, OnProgress } from '../types/index.js';
import type { CollectResultsOutput } from './results.js';
import type { ChangeDetectionResult } from './change-detection.js';
import { runCalculators } from './calculators/index.js';
import { findUnmatchedRuleFilters } from './rule.js';
import {
  detectChanges,
  listAllFiles,
  writeLastRunData,
} from './change-detection.js';
import { computeFilesHash } from './content-hash.js';
import { buildIgnoreFilter, buildInclusionFilter } from './ignore.js';
import { computeRuleFingerprint } from './fingerprint.js';
import { generatePrompts, loadGlobalPrompt, loadTemplate } from './prompt.js';
import { collectResults, computeOverallStatus } from './results.js';
import { executePostRun } from './post-run.js';
import { buildUserPrompt, watchForOutputs } from '../modes/user-prompt.js';
import { runClaudeCode } from '../modes/claude-code.js';
import { buildExecutionPlan, computeRunTimeout } from './execution-plan.js';
import { TimingTracker } from './timing.js';
import { formatStylish } from '../formatters/stylish.js';
import { formatJson } from '../formatters/json.js';
import { formatSarif } from '../formatters/sarif.js';

const WORKING_DIR = '.prosecheck/working';

/**
 * Thrown when `--rules` entries don't match any discovered rule and the
 * caller has not opted into the `rulesAllowMissing` escape hatch.
 */
export class UnknownRuleFilterError extends Error {
  constructor(
    public readonly unmatched: string[],
    public readonly available: Rule[],
  ) {
    super(
      `Unrecognized --rules entr${unmatched.length === 1 ? 'y' : 'ies'}: ${unmatched
        .map((u) => `"${u}"`)
        .join(', ')}`,
    );
    this.name = 'UnknownRuleFilterError';
  }
}

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
 * 9. Optionally persist per-rule cache entries for passing rules
 */
export async function runEngine(context: RunContext): Promise<EngineResult> {
  const { config } = context;
  const { projectRoot, mode, format } = context;

  // 1. Clean working directory
  const workingDir = path.join(projectRoot, WORKING_DIR);
  await rm(workingDir, { recursive: true, force: true });
  await mkdir(path.join(workingDir, 'outputs'), { recursive: true });
  await mkdir(path.join(workingDir, 'timing'), { recursive: true });
  if (context.debug) {
    await mkdir(path.join(workingDir, 'logs'), { recursive: true });
  }

  // 2. Discover rules via calculators
  let rules = await runCalculators(projectRoot, config);

  // 2-filter. If --rules was specified, validate and filter to matching rules.
  if (context.ruleFilter) {
    const unmatched = findUnmatchedRuleFilters(rules, context.ruleFilter);
    if (unmatched.length > 0 && !context.rulesAllowMissing) {
      throw new UnknownRuleFilterError(unmatched, rules);
    }
    if (unmatched.length > 0) {
      const allRuleNames = rules.map((r) => r.name);
      console.error(
        `[prosecheck] Warning: --rules entries did not match any rule: ${unmatched.join(', ')}. Available rules: ${allRuleNames.join(', ')}`,
      );
    }
    rules = filterRulesByNameOrId(rules, context.ruleFilter);
  }

  // 2a. Resolve per-rule model — stamp defaultModel onto rules without an explicit model
  const { defaultModel, validModels } = config.claudeCode;
  for (const rule of rules) {
    if (rule.model && !validModels.includes(rule.model)) {
      console.error(
        `[prosecheck] Warning: unknown model "${rule.model}" on rule "${rule.name}" in ${rule.source} (valid: ${validModels.join(', ')}). Falling back to "${defaultModel}".`,
      );
      rule.model = defaultModel;
    }
    if (!rule.model) {
      rule.model = defaultModel;
    }
  }

  if (rules.length === 0) {
    const emptyResults: CollectResultsOutput = {
      results: [],
      dropped: [],
      errors: [],
      cached: [],
      overallStatus: 'pass',
    };
    return {
      output: formatOutput(emptyResults, format),
      overallStatus: 'pass',
      results: emptyResults,
    };
  }

  // Load prompt template + global prompt early — needed for fingerprinting
  const promptTemplate = await loadTemplate(projectRoot);
  const globalPrompt = await loadGlobalPrompt(projectRoot);

  // 2b. Hash-check mode — compare per-rule cache entries without launching agents
  if (context.hashCheck) {
    return runHashCheck(
      projectRoot,
      config,
      rules,
      promptTemplate,
      globalPrompt,
      format,
      context.comparisonRef,
    );
  }

  // 2c. Hash-check-write mode — update stored per-rule cache without running agents
  if (context.hashCheckWrite) {
    return runHashCheckWrite(
      projectRoot,
      config,
      rules,
      promptTemplate,
      globalPrompt,
      format,
    );
  }

  // 3. Change detection — find triggered rules
  const detectOptions: Parameters<typeof detectChanges>[0] = {
    projectRoot,
    config,
    rules,
    promptTemplate,
    globalPrompt,
  };
  if (context.comparisonRef) {
    detectOptions.comparisonRef = context.comparisonRef;
  }
  const changeResult = await detectChanges(detectOptions);

  // Emit 'cached' progress events for rules skipped via cache
  const onProgressEarly = context.onProgress;
  if (onProgressEarly) {
    for (const rule of changeResult.cachedRules) {
      onProgressEarly({
        phase: 'cached',
        ruleId: rule.id,
        ruleName: rule.name,
      });
    }
  }

  if (changeResult.triggeredRules.length === 0) {
    const results: CollectResultsOutput = {
      results: [],
      dropped: [],
      errors: [],
      cached: changeResult.cachedRules,
      overallStatus: 'pass',
    };
    return {
      output: formatOutput(results, format),
      overallStatus: 'pass',
      results,
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

  // Start timing tracker
  const timingTracker = new TimingTracker(projectRoot);

  // Compute dynamic run timeout from execution plan
  const plan = buildExecutionPlan({
    rules: changeResult.triggeredRules,
    claudeToRuleShape: config.claudeCode.claudeToRuleShape,
    maxConcurrentAgents: config.claudeCode.maxConcurrentAgents,
    teamsOrchestratorModel: config.claudeCode.teamsOrchestratorModel,
  });
  const dynamicTimeout =
    computeRunTimeout(
      plan,
      config.claudeCode.invocationTimeout,
      config.claudeCode.timeoutPerRule,
    ) + config.addtlOverheadTimeout;
  const timeoutMs =
    (config.hardTotalTimeout !== null
      ? Math.min(dynamicTimeout, config.hardTotalTimeout)
      : dynamicTimeout) * 1000;
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
      context.debug,
      timingTracker,
    );
  } catch (error: unknown) {
    if (isTimeoutError(error)) {
      // Timeout — fall through to collect partial results
    } else {
      throw error;
    }
  }

  stopWatcher?.();
  timingTracker.stop();

  // 6. Collect results
  const collected = await collectResults({
    projectRoot,
    expectedRules: changeResult.triggeredRules,
  });

  // Attach timing data
  collected.timing = timingTracker.getTimings();

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
      debug: context.debug,
    });
  }

  // Attach cached rules to the results bundle
  collected.cached = changeResult.cachedRules;

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

  // 9. Persist per-rule cache entries for passing rules
  if (changeResult.writeRuleCacheEntries) {
    const passingIds = new Set<string>();
    for (const { ruleId, result } of collected.results) {
      if (result.status === 'pass') passingIds.add(ruleId);
    }
    await changeResult.writeRuleCacheEntries(passingIds);
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
  debug?: boolean,
  timingTracker?: TimingTracker,
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
        invocationTimeout: config.claudeCode.invocationTimeout,
        timeoutPerRule: config.claudeCode.timeoutPerRule,
        allowedTools: config.claudeCode.allowedTools,
        tools: config.claudeCode.tools,
        additionalArgs: config.claudeCode.additionalArgs,
        defaultModel: config.claudeCode.defaultModel,
        teamsOrchestratorModel: config.claudeCode.teamsOrchestratorModel,
        systemPrompt: globalPrompt,
        rules: triggeredRules,
        signal,
        debug,
        timingTracker,
      });
      break;
    }
    default:
      throw new Error(
        `Unknown operating mode: "${mode}". Valid modes: claude-code, user-prompt`,
      );
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
  debug?: boolean | undefined;
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
      options.debug,
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
 * Hash-check mode: pass iff every rule has a current per-rule cache entry
 * (fingerprint matches and no in-scope files have changed). No agents are
 * launched and no API key is needed.
 */
async function runHashCheck(
  projectRoot: string,
  config: Config,
  rules: Rule[],
  promptTemplate: string,
  globalPrompt: string | undefined,
  format: string,
  comparisonRef?: string,
): Promise<EngineResult> {
  // Force lastRun.read on for the duration of the check — we need cache-aware
  // detection regardless of the user's config.
  const readConfig: Config = {
    ...config,
    lastRun: { ...config.lastRun, read: true, write: false },
  };

  const detectOptions: Parameters<typeof detectChanges>[0] = {
    projectRoot,
    config: readConfig,
    rules,
    promptTemplate,
    globalPrompt,
  };
  if (comparisonRef) detectOptions.comparisonRef = comparisonRef;
  const changeResult = await detectChanges(detectOptions);

  const emptyResults = (
    status: 'pass' | 'fail',
    cached: Rule[] = [],
  ): CollectResultsOutput => ({
    results: [],
    dropped: [],
    errors: [],
    cached,
    overallStatus: status,
  });

  if (changeResult.triggeredRules.length === 0) {
    return hashCheckResult(
      `Hash check passed: all ${String(rules.length)} rules have current cache entries.`,
      'pass',
      emptyResults('pass', changeResult.cachedRules),
      format,
    );
  }

  const triggeredNames = changeResult.triggeredRules
    .map((r) => `  - ${r.name} (${r.id})`)
    .join('\n');
  const msg =
    `Hash check failed: ${String(changeResult.triggeredRules.length)} of ${String(rules.length)} rule(s) have stale or missing cache entries.\n` +
    `${triggeredNames}\n` +
    `Run prosecheck lint --hash-check-write to update, or run a full lint.`;
  return hashCheckResult(msg, 'fail', emptyResults('fail'), format);
}

/**
 * Hash-check-write mode: compute fingerprints and per-rule file hashes for
 * every rule and persist them as pass entries. Marks the current state as
 * "checked" without running any agents.
 */
async function runHashCheckWrite(
  projectRoot: string,
  config: Config,
  rules: Rule[],
  promptTemplate: string,
  globalPrompt: string | undefined,
  format: string,
): Promise<EngineResult> {
  const globalFilter = await buildIgnoreFilter(
    projectRoot,
    config.globalIgnore,
    config.additionalIgnore,
  );

  const allFiles = await listAllFiles(projectRoot);
  const unIgnored = allFiles.filter((f) => !globalFilter.ignores(f));

  const inScope = new Set<string>();
  const filesByRule = new Map<string, string[]>();
  for (const rule of rules) {
    const inclusion = buildInclusionFilter(rule.inclusions);
    const scoped = unIgnored.filter(inclusion).sort();
    filesByRule.set(rule.id, scoped);
    for (const f of scoped) inScope.add(f);
  }

  const { files: currentHashes } = await computeFilesHash(projectRoot, [
    ...inScope,
  ]);

  const cacheRules: Record<
    string,
    { files: Record<string, string>; fingerprint: string; status: 'pass' }
  > = {};
  for (const rule of rules) {
    const scoped: Record<string, string> = {};
    for (const f of filesByRule.get(rule.id) ?? []) {
      const h = currentHashes[f];
      if (h !== undefined) scoped[f] = h;
    }
    cacheRules[rule.id] = {
      files: scoped,
      fingerprint: computeRuleFingerprint(rule, {
        promptTemplate,
        globalPrompt,
      }),
      status: 'pass',
    };
  }

  await writeLastRunData(projectRoot, { rules: cacheRules });

  const passResults: CollectResultsOutput = {
    results: [],
    dropped: [],
    errors: [],
    cached: [],
    overallStatus: 'pass',
  };

  const msg = `Hash check write: updated cache entries for ${String(rules.length)} rule(s) (${String(inScope.size)} in-scope files).`;
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

/**
 * Filter rules to only those matching the given names or IDs.
 * Matches case-insensitively on rule name, and exactly on rule ID.
 */
export function filterRulesByNameOrId(rules: Rule[], filter: string[]): Rule[] {
  const lowerFilter = filter.map((f) => f.toLowerCase());
  return rules.filter(
    (rule) =>
      lowerFilter.includes(rule.name.toLowerCase()) || filter.includes(rule.id),
  );
}
