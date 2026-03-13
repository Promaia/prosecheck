import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ClaudeCodeModeOptions } from '../../../src/modes/claude-code.js';

// Mock execa so we intercept `claude` calls and can inspect args
const mockExeca = vi.fn().mockResolvedValue({
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  pid: 123,
});
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => mockExeca(...args) as unknown,
}));

// Import after mock setup — uses real runClaudeCode/spawnClaude with mocked execa
const { runClaudeCode } = await import('../../../src/modes/claude-code.js');

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-claude-code-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(tmpDir, '.prosecheck/working/prompts'), {
    recursive: true,
  });
  mockExeca.mockClear();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writePrompt(ruleId: string, content: string): Promise<string> {
  const promptPath = path.join(
    tmpDir,
    '.prosecheck/working/prompts',
    `${ruleId}.md`,
  );
  await writeFile(promptPath, content, 'utf-8');
  return promptPath;
}

function makeOptions(
  overrides: Partial<ClaudeCodeModeOptions> = {},
): ClaudeCodeModeOptions {
  return {
    projectRoot: tmpDir,
    promptPaths: new Map(),
    claudeToRuleShape: 'one-to-one',
    maxConcurrentAgents: 0,
    maxTurns: 30,
    allowedTools: ['Read', 'Grep', 'Glob'],
    tools: [],
    additionalArgs: [],
    defaultModel: 'sonnet',
    rules: [],
    ...overrides,
  };
}

function makeRule(id: string) {
  return {
    id,
    name: id,
    description: 'Test rule',
    inclusions: [],
    source: 'RULES.md',
  };
}

/** Extract the args array from a specific mockExeca call */
function getClaudeArgs(callIndex: number): string[] {
  const call = mockExeca.mock.calls[callIndex] as unknown[];
  return call[1] as string[];
}

/** Extract the --allowedTools value from a claude call's args */
function getAllowedToolsArg(callIndex: number): string | undefined {
  const args = getClaudeArgs(callIndex);
  const idx = args.indexOf('--allowedTools');
  if (idx === -1) return undefined;
  return args[idx + 1];
}

describe('claude-code mode', () => {
  it('spawns one process per rule in multi-instance mode', async () => {
    const promptPathA = await writePrompt('rule-a', 'Prompt A');
    const promptPathB = await writePrompt('rule-b', 'Prompt B');

    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPathA);
    promptPaths.set('rule-b', promptPathB);

    const options = makeOptions({
      promptPaths,
      rules: [makeRule('rule-a'), makeRule('rule-b')],
    });
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(2);
    expect(mockExeca).toHaveBeenCalledTimes(2);
    const ruleIds = results.map((r) => r.ruleId).sort();
    expect(ruleIds).toEqual(['rule-a', 'rule-b']);
  });

  it('spawns single instance in singleInstance mode', async () => {
    const promptPathA = await writePrompt('rule-a', 'Prompt A');
    const promptPathB = await writePrompt('rule-b', 'Prompt B');

    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPathA);
    promptPaths.set('rule-b', promptPathB);

    const options = makeOptions({
      promptPaths,
      claudeToRuleShape: 'one-to-many-single',
      rules: [makeRule('rule-a'), makeRule('rule-b')],
    });
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.ruleId).sort()).toEqual(['rule-a', 'rule-b']);
    expect(mockExeca).toHaveBeenCalledTimes(1);
  });

  it('returns exit codes from processes', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({ promptPaths, rules: [makeRule('rule-a')] });
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(1);
    expect(results[0]?.exitCode).toBe(0);
  });

  it('handles empty prompt paths', async () => {
    const options = makeOptions();
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(0);
  });

  it('passes config allowedTools to claude CLI', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({
      promptPaths,
      rules: [makeRule('rule-a')],
      allowedTools: ['Read', 'Grep', 'Glob'],
    });
    await runClaudeCode(options);

    const toolsArg = getAllowedToolsArg(0);
    expect(toolsArg).toBeDefined();
    // Config tools should be present
    expect(toolsArg).toContain('Read');
    expect(toolsArg).toContain('Grep');
    expect(toolsArg).toContain('Glob');
  });

  it('appends per-rule Write permission in multi-instance mode', async () => {
    const promptPathA = await writePrompt('rule-a', 'Prompt A');
    const promptPathB = await writePrompt('rule-b', 'Prompt B');

    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPathA);
    promptPaths.set('rule-b', promptPathB);

    const options = makeOptions({
      promptPaths,
      rules: [makeRule('rule-a'), makeRule('rule-b')],
      allowedTools: ['Read'],
    });
    await runClaudeCode(options);

    expect(mockExeca).toHaveBeenCalledTimes(2);

    // Collect the allowedTools from both calls
    const toolsArgs = [0, 1].map((i) => getAllowedToolsArg(i));

    // Each call should have Write scoped to its specific output file (absolute path)
    const expectedA = `.prosecheck/working/outputs/rule-a.json)`;
    const expectedB = `.prosecheck/working/outputs/rule-b.json)`;
    expect(toolsArgs).toContainEqual(expect.stringContaining(expectedA));
    expect(toolsArgs).toContainEqual(expect.stringContaining(expectedB));
    // Paths should be absolute (contain the tmpDir prefix)
    for (const toolsArg of toolsArgs) {
      const writeEntry = (toolsArg as string)
        .split(',')
        .find((t) => t.startsWith('Write('));
      expect(writeEntry).toContain(tmpDir.replaceAll('\\', '/'));
    }

    // Neither call should have the other rule's Write permission
    for (const toolsArg of toolsArgs) {
      expect(toolsArg).toBeDefined();
      const writeEntries = (toolsArg as string)
        .split(',')
        .filter((t) => t.startsWith('Write('));
      expect(writeEntries).toHaveLength(1);
    }
  });

  it('appends wildcard Write permission in single-instance mode', async () => {
    const promptPathA = await writePrompt('rule-a', 'Prompt A');
    const promptPathB = await writePrompt('rule-b', 'Prompt B');

    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPathA);
    promptPaths.set('rule-b', promptPathB);

    const options = makeOptions({
      promptPaths,
      claudeToRuleShape: 'one-to-many-single',
      rules: [makeRule('rule-a'), makeRule('rule-b')],
      allowedTools: ['Read'],
    });
    await runClaudeCode(options);

    expect(mockExeca).toHaveBeenCalledTimes(1);

    const toolsArg = getAllowedToolsArg(0);
    expect(toolsArg).toBeDefined();
    expect(toolsArg).toContain('Read');
    // Write permission should use absolute path
    const expectedPrefix = tmpDir.replaceAll('\\', '/');
    expect(toolsArg).toContain(
      `Write(${expectedPrefix}/.prosecheck/working/outputs/*)`,
    );
  });

  it('passes --max-turns flag', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({
      promptPaths,
      rules: [makeRule('rule-a')],
      maxTurns: 50,
    });
    await runClaudeCode(options);

    const args = getClaudeArgs(0);
    const idx = args.indexOf('--max-turns');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('50');
  });

  it('passes --output-format json flag', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({ promptPaths, rules: [makeRule('rule-a')] });
    await runClaudeCode(options);

    const args = getClaudeArgs(0);
    const idx = args.indexOf('--output-format');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('json');
  });

  it('passes --system-prompt when provided', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({
      promptPaths,
      rules: [makeRule('rule-a')],
      systemPrompt: 'You are a linter.',
    });
    await runClaudeCode(options);

    const args = getClaudeArgs(0);
    const idx = args.indexOf('--system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('You are a linter.');
  });

  it('omits --system-prompt when not provided', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({ promptPaths, rules: [makeRule('rule-a')] });
    await runClaudeCode(options);

    const args = getClaudeArgs(0);
    expect(args).not.toContain('--system-prompt');
  });
});
