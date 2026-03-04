import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildOrchestrationPrompt,
  watchForOutputs,
} from '../../../src/modes/user-prompt.js';
import type { UserPromptModeOptions } from '../../../src/modes/user-prompt.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-user-prompt-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(tmpDir, '.prosecheck/working/outputs'), {
    recursive: true,
  });
  await mkdir(path.join(tmpDir, '.prosecheck/working/prompts'), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeOptions(
  overrides: Partial<UserPromptModeOptions> = {},
): UserPromptModeOptions {
  return {
    projectRoot: tmpDir,
    promptPaths: new Map(),
    expectedRuleIds: [],
    ...overrides,
  };
}

describe('buildOrchestrationPrompt', () => {
  it('builds orchestration prompt listing all prompt files', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/tmp/prompts/rule-a.md');
    promptPaths.set('rule-b', '/tmp/prompts/rule-b.md');

    const options = makeOptions({
      promptPaths,
      expectedRuleIds: ['rule-a', 'rule-b'],
    });

    const prompt = buildOrchestrationPrompt(options);

    expect(prompt).toContain('rule-a');
    expect(prompt).toContain('rule-b');
    expect(prompt).toContain('/tmp/prompts/rule-a.md');
    expect(prompt).toContain('/tmp/prompts/rule-b.md');
    expect(prompt).toContain('rule-a.json');
    expect(prompt).toContain('rule-b.json');
    expect(prompt).toContain('Read each prompt file');
  });

  it('produces empty rules section for no rules', () => {
    const options = makeOptions();
    const prompt = buildOrchestrationPrompt(options);

    expect(prompt).toContain('Rules to Evaluate');
    expect(prompt).toContain('Instructions');
  });
});

describe('watchForOutputs', () => {
  it('resolves immediately when all outputs already exist', async () => {
    const expectedRuleIds = ['rule-a', 'rule-b'];
    const outputsDir = path.join(tmpDir, '.prosecheck/working/outputs');
    await writeFile(path.join(outputsDir, 'rule-a.json'), '{}');
    await writeFile(path.join(outputsDir, 'rule-b.json'), '{}');

    const options = makeOptions({ expectedRuleIds });
    const completed = await watchForOutputs(options);

    expect(completed.size).toBe(2);
    expect(completed.has('rule-a')).toBe(true);
    expect(completed.has('rule-b')).toBe(true);
  });

  it('resolves when outputs appear via file watcher', async () => {
    const expectedRuleIds = ['rule-a'];
    const outputsDir = path.join(tmpDir, '.prosecheck/working/outputs');

    const options = makeOptions({ expectedRuleIds });

    // Start watching, then write the file after a short delay
    const watchPromise = watchForOutputs(options);
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(path.join(outputsDir, 'rule-a.json'), '{}');

    const completed = await watchPromise;
    expect(completed.has('rule-a')).toBe(true);
  });

  it('resolves on abort signal with partial results', async () => {
    const expectedRuleIds = ['rule-a', 'rule-b'];
    const outputsDir = path.join(tmpDir, '.prosecheck/working/outputs');
    await writeFile(path.join(outputsDir, 'rule-a.json'), '{}');

    const controller = new AbortController();
    const options = makeOptions({ expectedRuleIds });

    // Start watching, then abort
    const watchPromise = watchForOutputs(options, controller.signal);
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    const completed = await watchPromise;
    expect(completed.has('rule-a')).toBe(true);
    expect(completed.has('rule-b')).toBe(false);
  });

  it('resolves immediately when abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const options = makeOptions({ expectedRuleIds: ['rule-a'] });
    const completed = await watchForOutputs(options, controller.signal);

    expect(completed.has('rule-a')).toBe(false);
  });
});
