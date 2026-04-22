import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { watch } from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { Rule } from '../types/index.js';
import {
  buildExecutionPlan,
  type ClaudeToRuleShape,
  type ExecutionPlan,
  type Invocation,
} from '../lib/execution-plan.js';
import { buildOrchestrationPrompt } from '../lib/orchestration-prompt.js';
import { parseResultFile } from '../lib/results.js';
import { RESULT_SCHEMA } from '../lib/prompt.js';
import type { TimingTracker } from '../lib/timing.js';

const SCHEMA_SYSTEM_PROMPT = `All lint rule output files MUST use this exact JSON schema. The "status" field is required and must be "pass", "warn", or "fail". Never use alternative formats.

${RESULT_SCHEMA}`;

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface ClaudeCodeModeOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** How ungrouped rules are dispatched */
  claudeToRuleShape: ClaudeToRuleShape;
  /** Maximum concurrent agents (0 = unlimited) */
  maxConcurrentAgents: number;
  /** Maximum agentic turns per Claude CLI invocation */
  maxTurns: number;
  /** Base per-invocation timeout in seconds */
  invocationTimeout: number;
  /** Additional timeout in seconds per rule in a multi-rule invocation */
  timeoutPerRule: number;
  /** Tools the Claude CLI agent is allowed to use (permission scoping) */
  allowedTools: string[];
  /** Tools available to the Claude CLI agent */
  tools: string[];
  /** Additional CLI arguments passed to each claude invocation */
  additionalArgs: string[];
  /** Default model for rule evaluation */
  defaultModel: string;
  /** Model for the orchestrator in one-to-many-teams mode */
  teamsOrchestratorModel?: string | undefined;
  /** Global system prompt from .prosecheck/prompt.md, if present */
  systemPrompt?: string | undefined;
  /** Triggered rules (needed for orchestration prompt rule names) */
  rules: Rule[];
  /** Abort signal for timeout enforcement */
  signal?: AbortSignal | undefined;
  /** Enable per-agent log streaming to .prosecheck/working/logs/ */
  debug?: boolean | undefined;
  /** Timing tracker for per-rule duration measurement */
  timingTracker?: TimingTracker | undefined;
}

export interface ClaudeCodeResult {
  ruleId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SpawnClaudeOptions {
  env?: NodeJS.ProcessEnv | undefined;
  maxTurns?: number | undefined;
  allowedTools?: string[] | undefined;
  tools?: string[] | undefined;
  additionalArgs?: string[] | undefined;
  /** Claude model to use (e.g., 'sonnet', 'opus', 'haiku'). Passed as --model. */
  model?: string | undefined;
  systemPrompt?: string | undefined;
  appendSystemPrompt?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Path to log file for streaming debug output */
  logFile?: string | undefined;
}

/**
 * Run rules via Claude Code CLI (`claude --print`).
 *
 * Builds an execution plan based on `claudeToRuleShape`, `maxConcurrentAgents`,
 * and rule groups, then executes batches sequentially with invocations within
 * each batch running in parallel.
 */
export async function runClaudeCode(
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  const { rules, claudeToRuleShape, maxConcurrentAgents } = options;
  const verbose = !!process.env['PROSECHECK_VERBOSE'];

  const plan = buildExecutionPlan({
    rules,
    claudeToRuleShape,
    maxConcurrentAgents,
    teamsOrchestratorModel: options.teamsOrchestratorModel,
  });

  if (verbose) {
    debug(
      `execution plan: ${String(plan.length)} batch(es), shape=${claudeToRuleShape}, ` +
        `maxConcurrent=${String(maxConcurrentAgents)}`,
    );
    for (const [i, batch] of plan.entries()) {
      debug(`  batch ${String(i)}: ${String(batch.length)} invocation(s)`);
      for (const inv of batch) {
        debug(
          `    ${inv.type}: ${String(inv.rules.length)} rule(s) [${inv.rules.map((r) => r.id).join(', ')}]`,
        );
      }
    }
  }

  return executePlan(plan, options);
}

async function executePlan(
  plan: ExecutionPlan,
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  const allResults: ClaudeCodeResult[] = [];

  for (const batch of plan) {
    const batchPromises = batch.map((invocation) =>
      executeInvocation(invocation, options),
    );
    const batchResults = await Promise.all(batchPromises);
    for (const results of batchResults) {
      allResults.push(...results);
    }
  }

  return allResults;
}

async function executeInvocation(
  invocation: Invocation,
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  const {
    projectRoot,
    promptPaths,
    maxTurns,
    invocationTimeout,
    timeoutPerRule,
    allowedTools,
    tools,
    additionalArgs,
    systemPrompt,
    signal: runSignal,
  } = options;

  // Compute per-invocation timeout: base + sum of per-rule timeouts
  const rulesTimeout = invocation.rules.reduce(
    (sum, r) => sum + (r.timeout ?? timeoutPerRule),
    0,
  );
  const totalTimeout = invocationTimeout + rulesTimeout;
  const invocationSignal = AbortSignal.timeout(totalTimeout * 1000);
  const signal = runSignal
    ? AbortSignal.any([runSignal, invocationSignal])
    : invocationSignal;

  switch (invocation.type) {
    case 'one-to-one': {
      // Single rule — read prompt file and spawn
      const rule = invocation.rules[0];
      if (!rule) {
        return [];
      }
      const promptPath = promptPaths.get(rule.id);
      if (!promptPath) {
        return [
          {
            ruleId: rule.id,
            exitCode: 1,
            stdout: '',
            stderr: `No prompt path found for rule ${rule.id}`,
          },
        ];
      }

      // Mark start for timing (programmatic — no agent marker needed)
      options.timingTracker?.markStart(rule.id);

      const outputFile = path
        .join(projectRoot, OUTPUTS_DIR, `${rule.id}.json`)
        .replaceAll('\\', '/');
      const ruleAllowedTools = [...allowedTools, `Write(${outputFile})`];

      const promptContent = await readFile(promptPath, 'utf-8');
      const logFile = options.debug
        ? path.join(projectRoot, '.prosecheck/working/logs', `${rule.id}.log`)
        : undefined;
      const result = await spawnClaude(promptContent, projectRoot, {
        maxTurns,
        allowedTools: ruleAllowedTools,
        tools,
        additionalArgs,
        model: invocation.model,
        systemPrompt,
        appendSystemPrompt: SCHEMA_SYSTEM_PROMPT,
        signal,
        logFile,
      });

      return [
        {
          ruleId: rule.id,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      ];
    }

    case 'one-to-many-teams': {
      // Agent teams — orchestration prompt with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
      const absOutputsDir = path
        .join(projectRoot, OUTPUTS_DIR)
        .replaceAll('\\', '/');
      const absTimingDir = path
        .join(projectRoot, '.prosecheck/working/timing')
        .replaceAll('\\', '/');
      const teamAllowedTools = [
        ...allowedTools,
        `Write(${absOutputsDir}/*)`,
        `Write(${absTimingDir}/*)`,
      ];

      const orchestrationPrompt = buildOrchestrationPrompt({
        projectRoot,
        promptPaths,
        rules: invocation.rules,
        agentTeams: true,
      });

      const env = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };

      const earlyExit = watchForEarlyExit(
        projectRoot,
        invocation.rules.map((r) => r.id),
      );
      const combinedSignal = combineSignals(
        signal,
        earlyExit.controller.signal,
      );

      const teamsLogFile = options.debug
        ? path.join(
            projectRoot,
            '.prosecheck/working/logs',
            `${invocation.rules[0]?.id ?? 'batch'}--teams.log`,
          )
        : undefined;
      const result = await spawnClaude(orchestrationPrompt, projectRoot, {
        env,
        maxTurns,
        allowedTools: teamAllowedTools,
        tools,
        additionalArgs,
        model: invocation.model,
        systemPrompt,
        appendSystemPrompt: SCHEMA_SYSTEM_PROMPT,
        signal: combinedSignal,
        logFile: teamsLogFile,
      });
      earlyExit.stop();

      return invocation.rules.map((r) => ({
        ruleId: r.id,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }));
    }

    case 'one-to-many-single': {
      // Sequential — orchestration prompt, single agent processes all rules
      const absOutputsDir = path
        .join(projectRoot, OUTPUTS_DIR)
        .replaceAll('\\', '/');
      const absTimingDir2 = path
        .join(projectRoot, '.prosecheck/working/timing')
        .replaceAll('\\', '/');
      const singleAllowedTools = [
        ...allowedTools,
        `Write(${absOutputsDir}/*)`,
        `Write(${absTimingDir2}/*)`,
      ];

      const orchestrationPrompt = buildOrchestrationPrompt({
        projectRoot,
        promptPaths,
        rules: invocation.rules,
        agentTeams: false,
      });

      const earlyExit = watchForEarlyExit(
        projectRoot,
        invocation.rules.map((r) => r.id),
      );
      const combinedSignal = combineSignals(
        signal,
        earlyExit.controller.signal,
      );

      const singleLogFile = options.debug
        ? path.join(
            projectRoot,
            '.prosecheck/working/logs',
            `${invocation.rules[0]?.id ?? 'batch'}--single.log`,
          )
        : undefined;
      const result = await spawnClaude(orchestrationPrompt, projectRoot, {
        maxTurns,
        allowedTools: singleAllowedTools,
        tools,
        additionalArgs,
        model: invocation.model,
        systemPrompt,
        appendSystemPrompt: SCHEMA_SYSTEM_PROMPT,
        signal: combinedSignal,
        logFile: singleLogFile,
      });
      earlyExit.stop();

      return invocation.rules.map((r) => ({
        ruleId: r.id,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }));
    }
  }
}

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a `claude --print` process with the given prompt.
 *
 * Flags:
 * - Always: `--print -p <prompt> --output-format json`
 * - Verbose (`PROSECHECK_VERBOSE`): `--output-format stream-json --verbose`
 * - `--max-turns N` when configured
 * - `--allowedTools "Read,Grep,..."` when configured
 * - `--system-prompt <text>` when a global prompt is provided
 */
export async function spawnClaude(
  prompt: string,
  cwd: string,
  options: SpawnClaudeOptions = {},
): Promise<SpawnResult> {
  const verbose = !!process.env['PROSECHECK_VERBOSE'];

  // See ADR-011: acceptEdits is used because scoped Write permissions are
  // currently buggy in Claude CLI. We keep --allowedTools Write() entries
  // for when the bugs are fixed upstream.
  const args: string[] = [
    '--print',
    '--permission-mode',
    'acceptEdits',
    // Disable MCP servers — agents don't need external integrations
    '--strict-mcp-config',
    // Don't persist conversation to disk
    '--no-session-persistence',
    // Skip user/project/local settings so user-configured hooks don't fire
    // inside prosecheck's child claude invocations.
    '--setting-sources',
    '',
  ];

  // Output format: stream-json when verbose or debug logging (need streamed output
  // so data flows through the .on('data') handlers into log files), json otherwise
  args.push(
    '--output-format',
    verbose || options.logFile ? 'stream-json' : 'json',
  );

  // Verbose flags for debugging (also required when stream-json is used for debug logging)
  if (verbose || options.logFile) {
    args.push('--verbose');
  }

  // Model
  if (options.model) {
    args.push('--model', options.model);
  }

  // Max turns
  if (options.maxTurns !== undefined) {
    args.push('--max-turns', String(options.maxTurns));
  }

  // Allowed tools (permission scoping)
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowedTools', options.allowedTools.join(','));
  }

  // Available tools (which tools the agent can see)
  if (options.tools && options.tools.length > 0) {
    args.push('--tools', options.tools.join(','));
  }

  // System prompt
  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }

  // Append system prompt (added after default system prompt)
  if (options.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  // Additional user-configured args (filter --model if we already set one)
  if (options.additionalArgs && options.additionalArgs.length > 0) {
    let filtered = options.additionalArgs;
    if (options.model) {
      filtered = [];
      for (let i = 0; i < options.additionalArgs.length; i++) {
        if (options.additionalArgs[i] === '--model') {
          i++; // skip the value too
        } else {
          filtered.push(options.additionalArgs[i] as string);
        }
      }
    }
    args.push(...filtered);
  }

  if (verbose) {
    const promptPreview =
      prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt;
    debug('--- spawning claude ---');
    debug(`  cmd: claude ${args.join(' ')}`);
    debug(`  cwd: ${cwd}`);
    debug(
      `  prompt via stdin (${String(prompt.length)} chars): ${promptPreview}`,
    );
    if (options.env) {
      const extraKeys = Object.keys(options.env).filter(
        (k) => process.env[k] !== options.env?.[k],
      );
      if (extraKeys.length > 0) {
        debug(`  extra env: ${extraKeys.join(', ')}`);
      }
    }
  }

  // When debug logging is active, don't inherit stdio — we need the streams
  // to tee to the log file. In verbose-only mode, inherit stdout/stderr so
  // claude's output goes directly to the terminal.
  const useInherit = verbose && !options.logFile;
  const stdio = useInherit
    ? (['pipe', 'inherit', 'inherit'] as const)
    : undefined;

  // Clear CLAUDECODE env var so child Claude CLI doesn't think it's a nested
  // session and refuse to start (Claude CLI sets CLAUDECODE=1 and checks for it).
  const env = { ...process.env, ...options.env, CLAUDECODE: '' };

  // When logFile is set, stream stdout/stderr to the file as data arrives
  if (options.logFile) {
    const logStream = createWriteStream(options.logFile, { flags: 'w' });

    const subprocess = execa('claude', args, {
      cwd,
      input: prompt,
      env,
      ...(options.signal ? { cancelSignal: options.signal } : {}),
      maxBuffer: 10 * 1024 * 1024,
    });

    // Tee stdout to log file (and terminal if verbose)
    subprocess.stdout.on('data', (chunk: Buffer) => {
      logStream.write(chunk);
      if (verbose) {
        process.stderr.write(chunk);
      }
    });

    // Tee stderr to log file (and terminal if verbose)
    subprocess.stderr.on('data', (chunk: Buffer) => {
      logStream.write(chunk);
      if (verbose) {
        process.stderr.write(chunk);
      }
    });

    try {
      const result = await subprocess;
      logStream.end();

      if (verbose) {
        debug(`--- claude exited (code 0) ---`);
      }

      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error: unknown) {
      logStream.end();
      const e = error as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
      };
      const exitCode = e.exitCode ?? 1;

      if (verbose) {
        debug(`--- claude exited (code ${String(exitCode)}) ---`);
      }

      return {
        exitCode,
        stdout: e.stdout ?? '',
        stderr:
          e.stderr ??
          'Failed to spawn claude CLI process. Is the Claude CLI installed and available on your PATH?',
      };
    }
  }

  try {
    const result = await execa('claude', args, {
      cwd,
      input: prompt,
      env,
      ...(stdio ? { stdout: stdio[1], stderr: stdio[2] } : {}),
      ...(options.signal ? { cancelSignal: options.signal } : {}),
      maxBuffer: 10 * 1024 * 1024,
    });

    if (verbose) {
      debug(`--- claude exited (code 0) ---`);
    }

    return {
      exitCode: 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (error: unknown) {
    const e = error as { exitCode?: number; stdout?: string; stderr?: string };
    const exitCode = e.exitCode ?? 1;

    if (verbose) {
      debug(`--- claude exited (code ${String(exitCode)}) ---`);
    }

    return {
      exitCode,
      stdout: e.stdout ?? '',
      stderr:
        e.stderr ??
        'Failed to spawn claude CLI process. Is the Claude CLI installed and available on your PATH?',
    };
  }
}

/**
 * Combine an optional external signal (e.g., timeout) with an early-exit signal.
 * Returns a signal that fires when either fires first.
 */
function combineSignals(
  external: AbortSignal | undefined,
  earlyExit: AbortSignal,
): AbortSignal {
  if (!external) return earlyExit;
  return AbortSignal.any([external, earlyExit]);
}

function debug(msg: string): void {
  // console.error is captured by vitest and displayed in the stderr block after test completion
  console.error(`[prosecheck:debug] ${msg}`);
}

/**
 * Watch for all expected output files to exist and be valid JSON.
 * Returns an AbortController whose signal fires when all outputs are ready,
 * plus a stop function to clean up the watcher.
 *
 * The returned signal can be combined with an external signal (e.g., timeout)
 * via `AbortSignal.any()` and passed to `spawnClaude()` so the process is
 * killed as soon as all results are in.
 */
export function watchForEarlyExit(
  projectRoot: string,
  ruleIds: string[],
): { controller: AbortController; stop: () => void } {
  const controller = new AbortController();
  const outputsDir = path.join(projectRoot, OUTPUTS_DIR);
  const pending = new Set(ruleIds);

  const checkFile = (ruleId: string): void => {
    if (!pending.has(ruleId)) return;
    const filePath = path.join(outputsDir, `${ruleId}.json`);
    void readFile(filePath, 'utf-8')
      .then((content) => {
        const parsed = parseResultFile(content, ruleId);
        if (parsed.ok) {
          pending.delete(ruleId);
          if (pending.size === 0) {
            if (process.env['PROSECHECK_VERBOSE']) {
              debug('all outputs valid — aborting claude process');
            }
            controller.abort();
          }
        }
      })
      .catch(() => {
        // File not ready yet — ignore
      });
  };

  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(outputsDir, (_, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      const ruleId = filename.slice(0, -5);
      checkFile(ruleId);
    });
  } catch {
    // Directory may not exist yet — watcher won't fire, that's fine
  }

  // Also check files that may already exist (written before watcher started)
  for (const ruleId of ruleIds) {
    checkFile(ruleId);
  }

  const stop = (): void => {
    watcher?.close();
  };

  return { controller, stop };
}
