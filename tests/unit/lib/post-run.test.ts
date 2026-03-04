import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executePostRun } from '../../../src/lib/post-run.js';
import type { PostRunResult } from '../../../src/lib/post-run.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-postrun-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function first(results: PostRunResult[]): PostRunResult {
  const r = results[0];
  if (!r) throw new Error('Expected at least one result');
  return r;
}

describe('executePostRun', () => {
  it('executes commands and returns results', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['echo hello'],
      status: 'pass',
    });

    expect(results).toHaveLength(1);
    const r = first(results);
    expect(r.command).toBe('echo hello');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello');
  });

  it('injects PROSECHECK_STATUS env var', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['echo $PROSECHECK_STATUS'],
      status: 'fail',
    });

    expect(first(results).stdout.trim()).toBe('fail');
  });

  it('injects PROSECHECK_RESULTS_DIR env var', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['echo $PROSECHECK_RESULTS_DIR'],
      status: 'pass',
    });

    const expected = path.resolve(tmpDir, '.prosecheck/working/outputs');
    expect(first(results).stdout.trim()).toBe(expected);
  });

  it('injects PROSECHECK_RESULTS_JSON when provided', async () => {
    const jsonPath = path.join(tmpDir, 'results.json');
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['echo $PROSECHECK_RESULTS_JSON'],
      status: 'pass',
      resultsJsonPath: jsonPath,
    });

    expect(first(results).stdout.trim()).toBe(path.resolve(jsonPath));
  });

  it('executes multiple commands sequentially', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['echo first', 'echo second'],
      status: 'pass',
    });

    expect(results).toHaveLength(2);
    const [r0, r1] = results;
    if (!r0 || !r1) throw new Error('Expected two results');
    expect(r0.stdout.trim()).toBe('first');
    expect(r1.stdout.trim()).toBe('second');
  });

  it('captures non-zero exit codes', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['exit 42'],
      status: 'pass',
    });

    expect(first(results).exitCode).toBe(42);
  });

  it('captures stderr', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: ['echo oops >&2'],
      status: 'pass',
    });

    expect(first(results).stderr.trim()).toBe('oops');
  });

  it('returns empty array for no commands', async () => {
    const results = await executePostRun({
      projectRoot: tmpDir,
      commands: [],
      status: 'pass',
    });

    expect(results).toHaveLength(0);
  });
});
