import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { watchOutputs } from '../../../src/lib/output-watcher.js';

describe('watchOutputs', () => {
  let tmpDir: string;
  let outputsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'watcher-test-'));
    outputsDir = path.join(tmpDir, '.prosecheck', 'working', 'outputs');
    await mkdir(outputsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('calls onResult when a valid output file appears', async () => {
    const onResult = vi.fn();
    const stop = watchOutputs({
      projectRoot: tmpDir,
      expectedRules: [{ id: 'rule-a', name: 'Rule A', description: '', inclusions: [], source: 'RULES.md' }],
      onResult,
    });

    // Write a valid result file
    await writeFile(
      path.join(outputsDir, 'rule-a.json'),
      JSON.stringify({ status: 'pass', rule: 'Rule A', source: 'RULES.md' }),
    );

    // Wait for the watcher to pick it up
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledOnce();
    }, { timeout: 3000 });

    expect(onResult).toHaveBeenCalledWith(
      'rule-a',
      'Rule A',
      expect.objectContaining({ status: 'pass' }),
    );

    stop();
  });

  it('ignores files for unexpected rule IDs', async () => {
    const onResult = vi.fn();
    const stop = watchOutputs({
      projectRoot: tmpDir,
      expectedRules: [{ id: 'rule-a', name: 'Rule A', description: '', inclusions: [], source: 'RULES.md' }],
      onResult,
    });

    // Write a file for an unexpected rule
    await writeFile(
      path.join(outputsDir, 'rule-b.json'),
      JSON.stringify({ status: 'pass', rule: 'Rule B', source: 'RULES.md' }),
    );

    // Give the watcher time to process
    await new Promise((resolve) => { setTimeout(resolve, 200); });

    expect(onResult).not.toHaveBeenCalled();

    stop();
  });

  it('ignores non-JSON files', async () => {
    const onResult = vi.fn();
    const stop = watchOutputs({
      projectRoot: tmpDir,
      expectedRules: [{ id: 'rule-a', name: 'Rule A', description: '', inclusions: [], source: 'RULES.md' }],
      onResult,
    });

    await writeFile(path.join(outputsDir, 'rule-a.txt'), 'not json');

    await new Promise((resolve) => { setTimeout(resolve, 200); });

    expect(onResult).not.toHaveBeenCalled();

    stop();
  });

  it('does not call onResult twice for the same rule', async () => {
    const onResult = vi.fn();
    const stop = watchOutputs({
      projectRoot: tmpDir,
      expectedRules: [{ id: 'rule-a', name: 'Rule A', description: '', inclusions: [], source: 'RULES.md' }],
      onResult,
    });

    const content = JSON.stringify({ status: 'pass', rule: 'Rule A', source: 'RULES.md' });
    await writeFile(path.join(outputsDir, 'rule-a.json'), content);

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledOnce();
    }, { timeout: 3000 });

    // Overwrite the same file
    await writeFile(path.join(outputsDir, 'rule-a.json'), content);

    await new Promise((resolve) => { setTimeout(resolve, 200); });

    expect(onResult).toHaveBeenCalledOnce();

    stop();
  });

  it('returns a stop function that closes the watcher', async () => {
    const onResult = vi.fn();
    const stop = watchOutputs({
      projectRoot: tmpDir,
      expectedRules: [{ id: 'rule-a', name: 'Rule A', description: '', inclusions: [], source: 'RULES.md' }],
      onResult,
    });

    stop();

    // Write after stopping — should not trigger callback
    await writeFile(
      path.join(outputsDir, 'rule-a.json'),
      JSON.stringify({ status: 'pass', rule: 'Rule A', source: 'RULES.md' }),
    );

    await new Promise((resolve) => { setTimeout(resolve, 200); });

    expect(onResult).not.toHaveBeenCalled();
  });
});
