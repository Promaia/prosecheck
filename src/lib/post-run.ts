import { exec } from 'node:child_process';
import path from 'node:path';
import type { RuleStatus } from '../types/index.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface PostRunOptions {
  /** Project root directory */
  projectRoot: string;
  /** Shell commands to execute */
  commands: string[];
  /** Overall run status */
  status: RuleStatus;
  /** Path to the JSON results file (if written) */
  resultsJsonPath?: string;
}

export interface PostRunResult {
  /** Command that was executed */
  command: string;
  /** Exit code (null if signal-killed) */
  exitCode: number | null;
  /** Combined stdout */
  stdout: string;
  /** Combined stderr */
  stderr: string;
}

/**
 * Execute post-run shell commands sequentially.
 *
 * Each command receives environment variables:
 * - PROSECHECK_STATUS: overall run status (pass/warn/fail/dropped)
 * - PROSECHECK_RESULTS_DIR: absolute path to outputs directory
 * - PROSECHECK_RESULTS_JSON: absolute path to results JSON file (if available)
 */
export async function executePostRun(
  options: PostRunOptions,
): Promise<PostRunResult[]> {
  const { projectRoot, commands, status, resultsJsonPath } = options;
  const results: PostRunResult[] = [];

  const env: Record<string, string> = {
    ...process.env,
    PROSECHECK_STATUS: status,
    PROSECHECK_RESULTS_DIR: path.resolve(projectRoot, OUTPUTS_DIR),
  };

  if (resultsJsonPath) {
    env['PROSECHECK_RESULTS_JSON'] = path.resolve(resultsJsonPath);
  }

  for (const command of commands) {
    const result = await runCommand(command, projectRoot, env);
    results.push(result);
  }

  return results;
}

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<PostRunResult> {
  return new Promise((resolve) => {
    exec(command, { cwd, env }, (error, stdout, stderr) => {
      resolve({
        command,
        exitCode: error ? (error.code ?? 1) : 0,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
      });
    });
  });
}
