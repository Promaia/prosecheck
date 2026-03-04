import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface ClaudeCodeModeOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** Whether to use single-instance (agent-team) strategy */
  singleInstance: boolean;
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
 * an orchestration prompt that covers all rules.
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
  const { projectRoot, promptPaths } = options;

  // Build a combined prompt listing all rules
  const lines: string[] = [
    'You are a code linter. Evaluate each rule below and write results to the specified output files.',
    '',
  ];

  for (const [ruleId, promptPath] of promptPaths) {
    const content = await readFile(promptPath, 'utf-8');
    const outputPath = path.join(projectRoot, OUTPUTS_DIR, `${ruleId}.json`);
    lines.push(`## Rule: ${ruleId}`);
    lines.push(`Output to: ${outputPath}`);
    lines.push('');
    lines.push(content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const combinedPrompt = lines.join('\n');
  const result = await spawnClaude(combinedPrompt, projectRoot);

  // Map to a single result with a synthetic rule ID
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
export function spawnClaude(
  prompt: string,
  cwd: string,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'claude',
      ['--print', '-p', prompt],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error
            ? (typeof error.code === 'number' ? error.code : 1)
            : 0,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        });
      },
    );

    // If the process fails to spawn (e.g., claude not installed)
    child.on('error', () => {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: 'Failed to spawn claude CLI process',
      });
    });
  });
}
