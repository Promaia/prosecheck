import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildUserPrompt,
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
    rules: [],
    agentTeams: false,
    ...overrides,
  };
}

describe('buildUserPrompt', () => {
  it('builds sequential prompt listing all prompt files', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', path.join(tmpDir, '.prosecheck/working/prompts/rule-a.md'));
    promptPaths.set('rule-b', path.join(tmpDir, '.prosecheck/working/prompts/rule-b.md'));

    const options = makeOptions({
      promptPaths,
      expectedRuleIds: ['rule-a', 'rule-b'],
      rules: [
        { id: 'rule-a', name: 'Rule A', description: 'D', inclusions: [], source: 'RULES.md' },
        { id: 'rule-b', name: 'Rule B', description: 'D', inclusions: [], source: 'RULES.md' },
      ],
    });

    const prompt = buildUserPrompt(options);

    expect(prompt).toContain('Rule A');
    expect(prompt).toContain('Rule B');
    expect(prompt).toContain('rule-a.md');
    expect(prompt).toContain('rule-b.md');
    expect(prompt).toContain('Read each prompt file');
    expect(prompt).toContain('lint agent');
  });

  it('builds agent teams prompt when agentTeams is true', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', path.join(tmpDir, '.prosecheck/working/prompts/rule-a.md'));

    const options = makeOptions({
      promptPaths,
      expectedRuleIds: ['rule-a'],
      rules: [
        { id: 'rule-a', name: 'Rule A', description: 'D', inclusions: [], source: 'RULES.md' },
      ],
      agentTeams: true,
    });

    const prompt = buildUserPrompt(options);

    expect(prompt).toContain('orchestrator');
    expect(prompt).toContain('agent teams');
    expect(prompt).toContain('Rule A');
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
