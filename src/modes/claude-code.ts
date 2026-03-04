import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { Rule } from '../types/index.js';
import { buildOrchestrationPrompt } from '../lib/orchestration-prompt.js';

export interface ClaudeCodeModeOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** Whether to use single-instance strategy */
  singleInstance: boolean;
  /** Whether to enable agent teams */
  agentTeams: boolean;
  /** Triggered rules (needed for orchestration prompt rule names) */
  rules: Rule[];
}

export interface ClaudeCodeResult {
  ruleId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
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
  const { projectRoot, promptPaths } = options;

  const promises: Promise<ClaudeCodeResult>[] = [];

  for (const [ruleId, promptPath] of promptPaths) {
    promises.push(runOneRule(ruleId, promptPath, projectRoot));
  }

  return Promise.all(promises);
}

async function runSingleInstance(
  options: ClaudeCodeModeOptions,
): Promise<ClaudeCodeResult[]> {
  const { projectRoot, promptPaths, rules, agentTeams } = options;

  const orchestrationPrompt = buildOrchestrationPrompt({
    projectRoot,
    promptPaths,
    rules,
    agentTeams,
  });

  const env = agentTeams
    ? { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
    : undefined;

  const result = await spawnClaude(orchestrationPrompt, projectRoot, env);

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
): Promise<ClaudeCodeResult> {
  const promptContent = await readFile(promptPath, 'utf-8');
  const result = await spawnClaude(promptContent, projectRoot);

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
 * The prompt is passed via the `-p` flag.
 */
export async function spawnClaude(
  prompt: string,
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
  try {
    const result = await execa('claude', ['--print', '-p', prompt], {
      cwd,
      ...(env ? { env } : {}),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const e = error as { exitCode?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.exitCode ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? 'Failed to spawn claude CLI process',
    };
  }
}
