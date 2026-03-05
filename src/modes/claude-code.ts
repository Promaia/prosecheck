import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { Rule } from '../types/index.js';
import { buildOrchestrationPrompt } from '../lib/orchestration-prompt.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface ClaudeCodeModeOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** Whether to use single-instance strategy */
  singleInstance: boolean;
  /** Whether to enable agent teams */
  agentTeams: boolean;
  /** Maximum agentic turns per Claude CLI invocation */
  maxTurns: number;
  /** Tools the Claude CLI agent is allowed to use (permission scoping) */
  allowedTools: string[];
  /** Tools available to the Claude CLI agent */
  tools: string[];
  /** Additional CLI arguments passed to each claude invocation */
  additionalArgs: string[];
  /** Global system prompt from .prosecheck/prompt.md, if present */
  systemPrompt?: string | undefined;
  /** Triggered rules (needed for orchestration prompt rule names) */
  rules: Rule[];
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
  systemPrompt?: string | undefined;
}

/**
 * Run rules via Claude Code CLI (`claude --print`).
 *
 * In multi-instance mode (default): spawns one `claude --print` process
 * per rule in parallel. Each process receives its prompt file content via
 * stdin and is expected to write results to the outputs directory.
 *
 * In single-instance mode: spawns a single `claude --print` process with
 * an orchestration prompt that covers all rules. When `agentTeams` is true,
 * CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set and the prompt instructs
 * the agent to launch sub-agents.
 */
export async function runClaudeCode(
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  if (options.singleInstance) {
    return runSingleInstance(options);
  }
  return runMultiInstance(options);
}

async function runMultiInstance(
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  const { projectRoot, promptPaths, maxTurns, allowedTools, tools, additionalArgs, systemPrompt } =
    options;
  const verbose = !!process.env['PROSECHECK_VERBOSE'];

  if (verbose) {
    const ruleIds = [...promptPaths.keys()];
    debug(`multi-instance mode: ${String(ruleIds.length)} rules`);
    for (const ruleId of ruleIds) {
      debug(`  rule: ${ruleId} -> ${promptPaths.get(ruleId) ?? '???'}`);
    }
  }

  const promises: Promise<ClaudeCodeResult>[] = [];

  for (const [ruleId, promptPath] of promptPaths) {
    // Grant Write access only to this rule's specific output file (absolute path)
    const outputFile = path
      .join(projectRoot, OUTPUTS_DIR, `${ruleId}.json`)
      .replaceAll('\\', '/');
    const ruleAllowedTools = [...allowedTools, `Write(${outputFile})`];

    promises.push(
      runOneRule(ruleId, promptPath, projectRoot, {
        maxTurns,
        allowedTools: ruleAllowedTools,
        tools,
        additionalArgs,
        systemPrompt,
      }),
    );
  }

  return Promise.all(promises);
}

async function runSingleInstance(
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  const {
    projectRoot,
    promptPaths,
    rules,
    agentTeams,
    maxTurns,
    allowedTools,
    tools,
    additionalArgs,
    systemPrompt,
  } = options;
  const verbose = !!process.env['PROSECHECK_VERBOSE'];

  if (verbose) {
    debug(
      `single-instance mode: ${String(rules.length)} rules, agentTeams=${String(agentTeams)}`,
    );
  }

  const orchestrationPrompt = buildOrchestrationPrompt({
    projectRoot,
    promptPaths,
    rules,
    agentTeams,
  });

  const env = agentTeams
    ? { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
    : undefined;

  // Grant Write access to all output files in single-instance mode (absolute path)
  const absOutputsDir = path
    .join(projectRoot, OUTPUTS_DIR)
    .replaceAll('\\', '/');
  const singleAllowedTools = [...allowedTools, `Write(${absOutputsDir}/*)`];

  const result = await spawnClaude(orchestrationPrompt, projectRoot, {
    env,
    maxTurns,
    allowedTools: singleAllowedTools,
    tools,
    additionalArgs,
    systemPrompt,
  });

  return [
    {
      ruleId: '__single_instance__',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  ];
}

async function runOneRule(
  ruleId: string,
  promptPath: string,
  projectRoot: string,
  spawnOptions: SpawnClaudeOptions,
): Promise<ClaudeCodeResult> {
  const promptContent = await readFile(promptPath, 'utf-8');
  const result = await spawnClaude(promptContent, projectRoot, spawnOptions);

  return {
    ruleId,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
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
  ];

  // Output format: stream-json when verbose for live streaming, json otherwise
  args.push('--output-format', verbose ? 'stream-json' : 'json');

  // Verbose flags for debugging
  if (verbose) {
    args.push('--verbose');
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

  // Additional user-configured args
  if (options.additionalArgs && options.additionalArgs.length > 0) {
    args.push(...options.additionalArgs);
  }

  if (verbose) {
    const promptPreview =
      prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt;
    debug('--- spawning claude ---');
    debug(`  cmd: claude ${args.join(' ')}`);
    debug(`  cwd: ${cwd}`);
    debug(`  prompt via stdin (${String(prompt.length)} chars): ${promptPreview}`);
    if (options.env) {
      const extraKeys = Object.keys(options.env).filter(
        (k) => process.env[k] !== options.env?.[k],
      );
      if (extraKeys.length > 0) {
        debug(`  extra env: ${extraKeys.join(', ')}`);
      }
    }
  }

  // In verbose mode, inherit stdout/stderr so claude's output goes directly to
  // the terminal — bypasses vitest's capture for true live streaming. We don't
  // use claude's stdout/stderr programmatically (results come from output files),
  // so inheriting is safe.
  const stdio = verbose ? (['pipe', 'inherit', 'inherit'] as const) : undefined;

  try {
    const result = await execa('claude', args, {
      cwd,
      input: prompt,
      ...(options.env ? { env: options.env } : {}),
      ...(stdio ? { stdout: stdio[1], stderr: stdio[2] } : {}),
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
      stderr: e.stderr ?? 'Failed to spawn claude CLI process',
    };
  }
}

function debug(msg: string): void {
  // console.error is captured by vitest and displayed in the stderr block after test completion
  console.error(`[prosecheck:debug] ${msg}`);
}
