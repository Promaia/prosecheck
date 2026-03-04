import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';

const CLI_SOURCE = path.resolve('src/cli.ts');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile('npx', ['tsx', CLI_SOURCE, ...args], { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      });
    });
  });
}

describe('CLI', () => {
  it('shows help with --help', { timeout: 15000 }, async () => {
    const result = await runCli(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('prosecheck');
    expect(result.stdout).toContain('lint');
    expect(result.stdout).toContain('init');
  });

  it('shows version with --version', async () => {
    const result = await runCli(['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('0.0.1');
  });

  it('shows lint help with lint --help', async () => {
    const result = await runCli(['lint', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--env');
    expect(result.stdout).toContain('--mode');
    expect(result.stdout).toContain('--format');
    expect(result.stdout).toContain('--warn-as-error');
  });

  it('shows init help with init --help', async () => {
    const result = await runCli(['init', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--rules');
  });
});
