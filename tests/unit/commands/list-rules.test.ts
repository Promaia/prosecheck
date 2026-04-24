import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Rule } from '../../../src/types/index.js';

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: vi.fn(),
  resolveEnvironment: vi.fn(() => 'default'),
  ConfigError: class ConfigError extends Error {
    constructor(
      message: string,
      public readonly issues: unknown[] = [],
    ) {
      super(message);
      this.name = 'ConfigError';
    }
  },
}));

vi.mock('../../../src/lib/calculators/index.js', () => ({
  runCalculators: vi.fn(),
}));

import { listRules } from '../../../src/commands/list-rules.js';
import { loadConfig, ConfigError } from '../../../src/lib/config.js';
import { runCalculators } from '../../../src/lib/calculators/index.js';

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedRunCalculators = vi.mocked(runCalculators);

let tmpDir: string;
let stdoutChunks: string[];
let stderrChunks: string[];

const makeRule = (overrides: Partial<Rule> = {}): Rule => ({
  id: 'rule-a',
  name: 'Rule A',
  description: 'first',
  source: 'RULES.md',
  inclusions: [],
  ...overrides,
});

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-list-rules-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });

  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  const fakeConfig = {
    config: {
      baseBranch: 'main',
      globalIgnore: [],
      additionalIgnore: [],
      warnAsError: false,
      retryDropped: false,
      retryDroppedMaxAttempts: 1,
      addtlOverheadTimeout: 60,
      hardTotalTimeout: null,
      postRun: [],
      lastRun: { read: false, write: false },
      environments: {},
      ruleCalculators: [],
      claudeCode: {
        claudeToRuleShape: 'one-to-one' as const,
        maxConcurrentAgents: 0,
        maxTurns: 10,
        invocationTimeout: 120,
        timeoutPerRule: 60,
        allowedTools: [],
        tools: [],
        additionalArgs: [],
      },
    },
  };
  mockedLoadConfig.mockResolvedValue(
    fakeConfig as unknown as Awaited<ReturnType<typeof loadConfig>>,
  );
  process.exitCode = 0;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  process.exitCode = 0;
});

describe('listRules', () => {
  it('prints a table containing every discovered rule', async () => {
    mockedRunCalculators.mockResolvedValue([
      makeRule({
        id: 'rule-a',
        name: 'Rule A',
        source: 'RULES.md',
        inclusions: ['src/**'],
      }),
      makeRule({
        id: 'rule-b',
        name: 'Rule B',
        source: 'docs/adr/002.md',
        group: 'docs',
        model: 'opus',
        inclusions: [],
      }),
    ]);

    await listRules({ projectRoot: tmpDir });

    const out = stdoutChunks.join('');
    expect(out).toContain('2 rule(s) discovered');
    expect(out).toContain('Rule A');
    expect(out).toContain('rule-a');
    expect(out).toContain('src/**');
    expect(out).toContain('Rule B');
    expect(out).toContain('docs/adr/002.md');
    expect(out).toContain('(project-wide)');
    expect(out).toContain('opus');
    expect(process.exitCode).toBe(0);
  });

  it('emits JSON with id/name/source/inclusions when json: true', async () => {
    mockedRunCalculators.mockResolvedValue([
      makeRule({
        id: 'rule-a',
        name: 'Rule A',
        source: 'RULES.md',
        inclusions: ['src/**'],
        group: 'core',
        model: 'sonnet',
      }),
    ]);

    await listRules({ projectRoot: tmpDir, json: true });

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      {
        id: 'rule-a',
        name: 'Rule A',
        source: 'RULES.md',
        inclusions: ['src/**'],
        group: 'core',
        model: 'sonnet',
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('omits group/model from JSON output when rule does not declare them', async () => {
    mockedRunCalculators.mockResolvedValue([
      makeRule({ id: 'rule-a', name: 'Rule A', inclusions: [] }),
    ]);

    await listRules({ projectRoot: tmpDir, json: true });

    const parsed = JSON.parse(stdoutChunks.join('')) as Array<
      Record<string, unknown>
    >;
    expect(parsed[0]).not.toHaveProperty('group');
    expect(parsed[0]).not.toHaveProperty('model');
  });

  it('prints a friendly message when no rules are discovered', async () => {
    mockedRunCalculators.mockResolvedValue([]);

    await listRules({ projectRoot: tmpDir });

    expect(stdoutChunks.join('')).toContain('No rules discovered');
    expect(process.exitCode).toBe(0);
  });

  it('reports ConfigError with exit code 2', async () => {
    mockedLoadConfig.mockRejectedValue(new ConfigError('bad config', []));

    await listRules({ projectRoot: tmpDir });

    expect(stderrChunks.join('')).toContain('Configuration error: bad config');
    expect(process.exitCode).toBe(2);
  });

  it('reports generic errors with exit code 2', async () => {
    mockedRunCalculators.mockRejectedValue(new Error('calc blew up'));

    await listRules({ projectRoot: tmpDir });

    expect(stderrChunks.join('')).toContain('Error: calc blew up');
    expect(process.exitCode).toBe(2);
  });

  it('passes the --env value through to resolveEnvironment and loadConfig', async () => {
    mockedRunCalculators.mockResolvedValue([]);

    await listRules({ projectRoot: tmpDir, env: 'ci' });

    const call = mockedLoadConfig.mock.calls[0]?.[0];
    expect(call).toMatchObject({ projectRoot: tmpDir, env: 'default' });
  });
});
