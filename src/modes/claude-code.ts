import { readFile } from 'node:fs/promises';
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
    allowedTools,
    tools,
    additionalArgs,
    systemPrompt,
  } = options;

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

      const outputFile = path
        .join(projectRoot, OUTPUTS_DIR, `${rule.id}.json`)
        .replaceAll('\\', '/');
      const ruleAllowedTools = [...allowedTools, `Write(${outputFile})`];

      const promptContent = await readFile(promptPath, 'utf-8');
      const result = await spawnClaude(promptContent, projectRoot, {
        maxTurns,
        allowedTools: ruleAllowedTools,
        tools,
        additionalArgs,
        systemPrompt,
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
      const teamAllowedTools = [...allowedTools, `Write(${absOutputsDir}/*)`];

      const orchestrationPrompt = buildOrchestrationPrompt({
        projectRoot,
        promptPaths,
        rules: invocation.rules,
        agentTeams: true,
      });

      const env = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };

      const result = await spawnClaude(orchestrationPrompt, projectRoot, {
        env,
        maxTurns,
        allowedTools: teamAllowedTools,
        tools,
        additionalArgs,
        systemPrompt,
      });

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
      const singleAllowedTools = [...allowedTools, `Write(${absOutputsDir}/*)`];

      const orchestrationPrompt = buildOrchestrationPrompt({
        projectRoot,
        promptPaths,
        rules: invocation.rules,
        agentTeams: false,
      });

      const result = await spawnClaude(orchestrationPrompt, projectRoot, {
        maxTurns,
        allowedTools: singleAllowedTools,
        tools,
        additionalArgs,
        systemPrompt,
      });

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
