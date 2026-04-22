import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunContext } from '../../../src/types/index.js';
import type { Config } from '../../../src/lib/config-schema.js';
import type { Rule } from '../../../src/types/index.js';

// Mock all subsystems
const mockRunCalculators = vi.fn();
const mockDetectChanges = vi.fn();
const mockGeneratePrompts = vi.fn();
const mockCollectResults = vi.fn();
const mockExecutePostRun = vi.fn();
const mockRunClaudeCode = vi.fn();
const mockBuildUserPrompt = vi.fn();
const mockWatchForOutputs = vi.fn();
const mockFormatStylish = vi.fn();
const mockFormatJson = vi.fn();
const mockFormatSarif = vi.fn();

vi.mock('../../../src/lib/calculators/index.js', () => ({
  runCalculators: mockRunCalculators,
}));
const mockListAllFiles = vi.fn();
const mockWriteLastRunData = vi.fn();
vi.mock('../../../src/lib/change-detection.js', () => ({
  detectChanges: mockDetectChanges,
  listAllFiles: (...args: unknown[]) => mockListAllFiles(...args) as unknown,
  writeLastRunData: (...args: unknown[]) =>
    mockWriteLastRunData(...args) as unknown,
}));
const mockBuildIgnoreFilter = vi.fn();
vi.mock('../../../src/lib/ignore.js', () => ({
  buildIgnoreFilter: (...args: unknown[]) =>
    mockBuildIgnoreFilter(...args) as unknown,
  buildInclusionFilter: () => () => true,
}));
const mockComputeFilesHash = vi.fn();
vi.mock('../../../src/lib/content-hash.js', () => ({
  computeFilesHash: (...args: unknown[]) =>
    mockComputeFilesHash(...args) as unknown,
}));
vi.mock('../../../src/lib/fingerprint.js', () => ({
  computeRuleFingerprint: (rule: { id: string }) => `fp-${rule.id}`,
}));
vi.mock('../../../src/lib/prompt.js', () => ({
  generatePrompts: mockGeneratePrompts,
  loadGlobalPrompt: () => Promise.resolve(undefined),
  loadTemplate: () => Promise.resolve('tpl'),
}));
const mockComputeOverallStatus = vi.fn();
vi.mock('../../../src/lib/results.js', () => ({
  collectResults: mockCollectResults,
  computeOverallStatus: mockComputeOverallStatus,
}));
vi.mock('../../../src/lib/post-run.js', () => ({
  executePostRun: mockExecutePostRun,
}));
vi.mock('../../../src/modes/claude-code.js', () => ({
  runClaudeCode: mockRunClaudeCode,
}));
vi.mock('../../../src/modes/user-prompt.js', () => ({
  buildUserPrompt: mockBuildUserPrompt,
  watchForOutputs: mockWatchForOutputs,
}));
vi.mock('../../../src/formatters/stylish.js', () => ({
  formatStylish: mockFormatStylish,
}));
vi.mock('../../../src/formatters/json.js', () => ({
  formatJson: mockFormatJson,
}));
vi.mock('../../../src/formatters/sarif.js', () => ({
  formatSarif: mockFormatSarif,
}));

const { runEngine, filterRulesByNameOrId } =
  await import('../../../src/lib/engine.js');

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseBranch: 'main',
    globalIgnore: [],
    additionalIgnore: ['.gitignore'],
    lastRun: { read: false, write: false },
    addtlOverheadTimeout: 60,
    hardTotalTimeout: null,
    warnAsError: false,
    retryDropped: false,
    retryDroppedMaxAttempts: 1,
    claudeCode: {
      claudeToRuleShape: 'one-to-one',
      maxConcurrentAgents: 0,
      maxTurns: 30,
      invocationTimeout: 120,
      timeoutPerRule: 60,
      allowedTools: [],
      tools: [],
      additionalArgs: [],
      defaultModel: 'sonnet',
      validModels: ['opus', 'sonnet', 'haiku'],
    },
    postRun: [],
    environments: {},
    ruleCalculators: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    config: makeConfig(),
    environment: 'interactive',
    mode: 'claude-code',
    format: 'stylish',
    projectRoot: '/tmp/fake-project',
    comparisonRef: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default mocks
  mockRunCalculators.mockResolvedValue([
    {
      id: 'rule-a',
      name: 'Rule A',
      description: 'D',
      inclusions: ['src/'],
      source: 'RULES.md',
    },
  ]);
  mockDetectChanges.mockResolvedValue({
    comparisonRef: 'abc123',
    triggeredRules: [
      {
        id: 'rule-a',
        name: 'Rule A',
        description: 'D',
        inclusions: ['src/'],
        source: 'RULES.md',
      },
    ],
    cachedRules: [],
    changedFiles: ['src/foo.ts'],
    changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
  });
  mockGeneratePrompts.mockResolvedValue({
    promptPaths: new Map([['rule-a', '/tmp/prompts/rule-a.md']]),
  });
  mockRunClaudeCode.mockResolvedValue([]);
  mockCollectResults.mockResolvedValue({
    results: [
      {
        ruleId: 'rule-a',
        result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
      },
    ],
    dropped: [],
    errors: [],
    overallStatus: 'pass',
  });
  // Real implementation for computeOverallStatus used by retry logic
  const severity = ['pass', 'warn', 'dropped', 'fail'];
  mockComputeOverallStatus.mockImplementation(
    (
      results: Array<{ result: { status: string } }>,
      dropped: unknown[],
      errors: unknown[],
    ) => {
      let worst = 'pass';
      for (const { result } of results) {
        if (severity.indexOf(result.status) > severity.indexOf(worst))
          worst = result.status;
      }
      if (
        dropped.length > 0 &&
        severity.indexOf('dropped') > severity.indexOf(worst)
      )
        worst = 'dropped';
      if (
        errors.length > 0 &&
        severity.indexOf('fail') > severity.indexOf(worst)
      )
        worst = 'fail';
      return worst;
    },
  );
  mockFormatStylish.mockReturnValue('PASS Rule A');
  mockFormatJson.mockReturnValue('{"status":"pass"}');
  mockFormatSarif.mockReturnValue('{"runs":[]}');
  mockExecutePostRun.mockResolvedValue([]);
  mockBuildUserPrompt.mockReturnValue('orchestration prompt');
  mockWatchForOutputs.mockResolvedValue(new Set(['rule-a']));
});

describe('runEngine', () => {
  it('runs full pipeline in correct order', async () => {
    const context = makeContext();
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('pass');
    expect(result.output).toBe('PASS Rule A');

    // Verify pipeline order
    expect(mockRunCalculators).toHaveBeenCalledOnce();
    expect(mockDetectChanges).toHaveBeenCalledOnce();
    expect(mockGeneratePrompts).toHaveBeenCalledOnce();
    expect(mockRunClaudeCode).toHaveBeenCalledOnce();
    expect(mockCollectResults).toHaveBeenCalledOnce();
    expect(mockFormatStylish).toHaveBeenCalledOnce();
  });

  it('returns early when no rules found', async () => {
    mockRunCalculators.mockResolvedValue([]);
    const context = makeContext();
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('pass');
    expect(mockDetectChanges).not.toHaveBeenCalled();
    expect(mockGeneratePrompts).not.toHaveBeenCalled();
  });

  it('returns early when no rules triggered', async () => {
    mockDetectChanges.mockResolvedValue({
      comparisonRef: 'abc123',
      triggeredRules: [],
      cachedRules: [],
      changedFiles: [],
      changedFilesByRule: new Map(),
    });

    const context = makeContext();
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('pass');
    expect(mockGeneratePrompts).not.toHaveBeenCalled();
  });

  it('dispatches to claude-code mode', async () => {
    const context = makeContext({ mode: 'claude-code' });
    await runEngine(context);

    expect(mockRunClaudeCode).toHaveBeenCalledOnce();
    expect(mockBuildUserPrompt).not.toHaveBeenCalled();
  });

  it('dispatches to user-prompt mode', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const context = makeContext({ mode: 'user-prompt' });
    await runEngine(context);

    expect(mockBuildUserPrompt).toHaveBeenCalledOnce();
    expect(mockWatchForOutputs).toHaveBeenCalledOnce();
    expect(mockRunClaudeCode).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('throws on unknown mode', async () => {
    const context = makeContext({ mode: 'unknown' });
    await expect(runEngine(context)).rejects.toThrow('Unknown operating mode');
  });

  it('uses json formatter when format is json', async () => {
    const context = makeContext({ format: 'json' });
    const result = await runEngine(context);

    expect(mockFormatJson).toHaveBeenCalledOnce();
    expect(result.output).toBe('{"status":"pass"}');
  });

  it('uses sarif formatter when format is sarif', async () => {
    const context = makeContext({ format: 'sarif' });
    const result = await runEngine(context);

    expect(mockFormatSarif).toHaveBeenCalledOnce();
    expect(result.output).toBe('{"runs":[]}');
  });

  it('promotes warn to fail when warnAsError is set', async () => {
    mockCollectResults.mockResolvedValue({
      results: [
        {
          ruleId: 'rule-a',
          result: {
            status: 'warn',
            rule: 'Rule A',
            source: 'RULES.md',
            headline: 'h',
            comments: [{ message: 'm' }],
          },
        },
      ],
      dropped: [],
      errors: [],
      overallStatus: 'warn',
    });

    const context = makeContext({
      config: makeConfig({ warnAsError: true }),
    });
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('fail');
  });

  it('executes post-run tasks when configured', async () => {
    const context = makeContext({
      config: makeConfig({ postRun: ['echo done'] }),
    });
    await runEngine(context);

    expect(mockExecutePostRun).toHaveBeenCalledOnce();
  });

  it('skips post-run tasks when none configured', async () => {
    const context = makeContext();
    await runEngine(context);

    expect(mockExecutePostRun).not.toHaveBeenCalled();
  });

  it('calls writeRuleCacheEntries with passing rule IDs when present', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    mockDetectChanges.mockResolvedValue({
      comparisonRef: 'abc123',
      triggeredRules: [
        {
          id: 'rule-a',
          name: 'Rule A',
          description: 'D',
          inclusions: ['src/'],
          source: 'RULES.md',
        },
      ],
      cachedRules: [],
      changedFiles: ['src/foo.ts'],
      changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      writeRuleCacheEntries: writeFn,
    });

    const context = makeContext();
    await runEngine(context);

    expect(writeFn).toHaveBeenCalledOnce();
    const passingIds = writeFn.mock.calls[0]?.[0] as Set<string>;
    expect(passingIds.has('rule-a')).toBe(true);
  });

  describe('retryDropped', () => {
    const ruleA = {
      id: 'rule-a',
      name: 'Rule A',
      description: 'D',
      inclusions: ['src/'],
      source: 'RULES.md',
    };
    const ruleB = {
      id: 'rule-b',
      name: 'Rule B',
      description: 'D',
      inclusions: ['src/'],
      source: 'RULES.md',
    };

    it('does not retry when retryDropped is false', async () => {
      mockRunCalculators.mockResolvedValue([ruleA]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      });
      mockCollectResults.mockResolvedValue({
        results: [],
        dropped: [{ rule: ruleA, attempt: 1 }],
        errors: [],
        overallStatus: 'dropped',
      });
      mockFormatStylish.mockReturnValue('DROPPED');

      const context = makeContext({
        config: makeConfig({ retryDropped: false }),
      });
      await runEngine(context);

      // collectResults called once (no retry)
      expect(mockCollectResults).toHaveBeenCalledTimes(1);
      expect(mockRunClaudeCode).toHaveBeenCalledTimes(1);
    });

    it('retries dropped rules and resolves them on success', async () => {
      mockRunCalculators.mockResolvedValue([ruleA, ruleB]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA, ruleB],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([
          ['rule-a', ['src/foo.ts']],
          ['rule-b', ['src/foo.ts']],
        ]),
      });
      mockGeneratePrompts.mockResolvedValue({
        promptPaths: new Map([
          ['rule-a', '/tmp/p/rule-a.md'],
          ['rule-b', '/tmp/p/rule-b.md'],
        ]),
      });

      // First collect: rule-a passes, rule-b dropped
      mockCollectResults
        .mockResolvedValueOnce({
          results: [
            {
              ruleId: 'rule-a',
              result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
            },
          ],
          dropped: [{ rule: ruleB, attempt: 1 }],
          errors: [],
          overallStatus: 'dropped',
        })
        // Second collect (retry): rule-b now passes
        .mockResolvedValueOnce({
          results: [
            {
              ruleId: 'rule-b',
              result: { status: 'pass', rule: 'Rule B', source: 'RULES.md' },
            },
          ],
          dropped: [],
          errors: [],
          overallStatus: 'pass',
        });

      mockFormatStylish.mockReturnValue('ALL PASS');

      const context = makeContext({
        config: makeConfig({ retryDropped: true, retryDroppedMaxAttempts: 1 }),
      });
      const result = await runEngine(context);

      // Two dispatches: initial + retry
      expect(mockRunClaudeCode).toHaveBeenCalledTimes(2);
      expect(mockCollectResults).toHaveBeenCalledTimes(2);
      expect(mockGeneratePrompts).toHaveBeenCalledTimes(2);
      // Overall status should be pass since retry resolved
      expect(result.overallStatus).toBe('pass');
      expect(result.results.dropped).toHaveLength(0);
      expect(result.results.results).toHaveLength(2);
    });

    it('respects retryDroppedMaxAttempts limit', async () => {
      mockRunCalculators.mockResolvedValue([ruleA]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      });

      // Always returns dropped
      mockCollectResults.mockResolvedValue({
        results: [],
        dropped: [{ rule: ruleA, attempt: 1 }],
        errors: [],
        overallStatus: 'dropped',
      });
      mockFormatStylish.mockReturnValue('DROPPED');

      const context = makeContext({
        config: makeConfig({ retryDropped: true, retryDroppedMaxAttempts: 2 }),
      });
      const result = await runEngine(context);

      // Initial dispatch + 2 retry attempts
      expect(mockRunClaudeCode).toHaveBeenCalledTimes(3);
      expect(mockCollectResults).toHaveBeenCalledTimes(3);
      // Rule remains dropped
      expect(result.results.dropped).toHaveLength(1);
      expect(result.results.dropped[0]?.attempt).toBe(3);
    });

    it('stops retrying early when all dropped rules resolve', async () => {
      mockRunCalculators.mockResolvedValue([ruleA]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      });

      // First: dropped. Second: resolved.
      mockCollectResults
        .mockResolvedValueOnce({
          results: [],
          dropped: [{ rule: ruleA, attempt: 1 }],
          errors: [],
          overallStatus: 'dropped',
        })
        .mockResolvedValueOnce({
          results: [
            {
              ruleId: 'rule-a',
              result: {
                status: 'warn',
                rule: 'Rule A',
                source: 'RULES.md',
                headline: 'h',
                comments: [],
              },
            },
          ],
          dropped: [],
          errors: [],
          overallStatus: 'warn',
        });
      mockFormatStylish.mockReturnValue('WARN');

      const context = makeContext({
        config: makeConfig({ retryDropped: true, retryDroppedMaxAttempts: 3 }),
      });
      const result = await runEngine(context);

      // Only 2 dispatches (initial + 1 retry), not 4 (initial + 3)
      expect(mockRunClaudeCode).toHaveBeenCalledTimes(2);
      expect(result.overallStatus).toBe('warn');
      expect(result.results.dropped).toHaveLength(0);
    });

    it('retries only dropped rules, not already-resolved ones', async () => {
      mockRunCalculators.mockResolvedValue([ruleA, ruleB]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA, ruleB],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([
          ['rule-a', ['src/foo.ts']],
          ['rule-b', ['src/foo.ts']],
        ]),
      });
      mockGeneratePrompts.mockResolvedValue({
        promptPaths: new Map([
          ['rule-a', '/tmp/p/rule-a.md'],
          ['rule-b', '/tmp/p/rule-b.md'],
        ]),
      });

      // First: rule-a passes, rule-b dropped
      mockCollectResults
        .mockResolvedValueOnce({
          results: [
            {
              ruleId: 'rule-a',
              result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
            },
          ],
          dropped: [{ rule: ruleB, attempt: 1 }],
          errors: [],
          overallStatus: 'dropped',
        })
        // Retry collect: rule-b passes
        .mockResolvedValueOnce({
          results: [
            {
              ruleId: 'rule-b',
              result: { status: 'pass', rule: 'Rule B', source: 'RULES.md' },
            },
          ],
          dropped: [],
          errors: [],
          overallStatus: 'pass',
        });
      mockFormatStylish.mockReturnValue('ALL PASS');

      const context = makeContext({
        config: makeConfig({ retryDropped: true, retryDroppedMaxAttempts: 1 }),
      });
      await runEngine(context);

      // The retry generatePrompts should only have rule-b
      const retryPromptCall = mockGeneratePrompts.mock.calls[1] as unknown[];
      const retryPromptRules = (
        retryPromptCall[0] as { rules: (typeof ruleA)[] }
      ).rules;
      expect(retryPromptRules).toHaveLength(1);
      expect(retryPromptRules[0]?.id).toBe('rule-b');
    });
  });

  describe('hash-check mode', () => {
    const rule = {
      id: 'rule-a',
      name: 'Rule A',
      description: 'D',
      inclusions: ['src/'],
      source: 'RULES.md',
    };

    it('passes when every rule has a current cache entry', async () => {
      mockRunCalculators.mockResolvedValue([rule]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [],
        cachedRules: [rule],
        changedFiles: [],
        changedFilesByRule: new Map(),
      });

      const context = makeContext({ hashCheck: true });
      const result = await runEngine(context);

      expect(result.overallStatus).toBe('pass');
      expect(result.output).toContain('Hash check passed');
      expect(mockRunClaudeCode).not.toHaveBeenCalled();
    });

    it('fails when any rule has stale or missing cache entries', async () => {
      mockRunCalculators.mockResolvedValue([rule]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [rule],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      });

      const context = makeContext({ hashCheck: true });
      const result = await runEngine(context);

      expect(result.overallStatus).toBe('fail');
      expect(result.output).toContain('Hash check failed');
      expect(result.output).toContain('Rule A');
      expect(mockRunClaudeCode).not.toHaveBeenCalled();
    });

    it('forces lastRun.read on regardless of config', async () => {
      mockRunCalculators.mockResolvedValue([rule]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [],
        cachedRules: [rule],
        changedFiles: [],
        changedFilesByRule: new Map(),
      });

      const context = makeContext({
        hashCheck: true,
        config: makeConfig({ lastRun: { read: false, write: false } }),
      });
      await runEngine(context);

      const callArg = mockDetectChanges.mock.calls[0]?.[0] as {
        config: { lastRun: { read: boolean; write: boolean } };
      };
      expect(callArg.config.lastRun.read).toBe(true);
      expect(callArg.config.lastRun.write).toBe(false);
    });

    it('returns early when no rules found', async () => {
      mockRunCalculators.mockResolvedValue([]);

      const context = makeContext({ hashCheck: true });
      const result = await runEngine(context);

      expect(result.overallStatus).toBe('pass');
      expect(mockDetectChanges).not.toHaveBeenCalled();
    });
  });

  describe('hash-check-write mode', () => {
    const rule = {
      id: 'rule-a',
      name: 'Rule A',
      description: 'D',
      inclusions: ['src/'],
      source: 'RULES.md',
    };

    it('writes per-rule cache entries and returns pass', async () => {
      mockRunCalculators.mockResolvedValue([rule]);
      mockBuildIgnoreFilter.mockResolvedValue({ ignores: () => false });
      mockListAllFiles.mockResolvedValue(['src/foo.ts', 'src/bar.ts']);
      mockComputeFilesHash.mockResolvedValue({
        filesHash: 'new-digest',
        files: { 'src/foo.ts': 'h1', 'src/bar.ts': 'h2' },
      });
      mockWriteLastRunData.mockResolvedValue(undefined);

      const context = makeContext({ hashCheckWrite: true });
      const result = await runEngine(context);

      expect(result.overallStatus).toBe('pass');
      expect(result.output).toContain('Hash check write');
      expect(mockWriteLastRunData).toHaveBeenCalledOnce();
      const writeCall = mockWriteLastRunData.mock.calls[0] as [
        string,
        { rules: Record<string, unknown> },
      ];
      expect(writeCall[0]).toBe('/tmp/fake-project');
      expect(writeCall[1].rules['rule-a']).toEqual({
        status: 'pass',
        fingerprint: 'fp-rule-a',
        files: { 'src/foo.ts': 'h1', 'src/bar.ts': 'h2' },
      });
      expect(mockRunClaudeCode).not.toHaveBeenCalled();
      expect(mockDetectChanges).not.toHaveBeenCalled();
    });
  });

  describe('--rules filter', () => {
    it('filters rules to only matching names', async () => {
      const ruleA = {
        id: 'rule-a',
        name: 'Rule A',
        description: 'D',
        inclusions: ['src/'],
        source: 'RULES.md',
      };
      const ruleB = {
        id: 'rule-b',
        name: 'Rule B',
        description: 'D',
        inclusions: ['src/'],
        source: 'RULES.md',
      };
      mockRunCalculators.mockResolvedValue([ruleA, ruleB]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      });

      const context = makeContext({ ruleFilter: ['Rule A'] });
      await runEngine(context);

      // Change detection should only see rule A
      expect(mockDetectChanges).toHaveBeenCalledWith(
        expect.objectContaining({
          rules: [expect.objectContaining({ id: 'rule-a' })],
        }),
      );
    });

    it('writes cache entries for targeted rules during a partial --rules run', async () => {
      const writeFn = vi.fn().mockResolvedValue(undefined);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [
          {
            id: 'rule-a',
            name: 'Rule A',
            description: 'D',
            inclusions: ['src/'],
            source: 'RULES.md',
          },
        ],
        cachedRules: [],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
        writeRuleCacheEntries: writeFn,
      });

      const context = makeContext({
        config: makeConfig({
          lastRun: { read: false, write: true },
        }),
        ruleFilter: ['Rule A'],
      });
      await runEngine(context);

      expect(writeFn).toHaveBeenCalledOnce();
      const passingIds = writeFn.mock.calls[0]?.[0] as Set<string>;
      expect(passingIds.has('rule-a')).toBe(true);
    });
  });
});

describe('filterRulesByNameOrId', () => {
  const rules: Rule[] = [
    {
      id: 'rules-md--no-console-log',
      name: 'No console.log',
      description: 'D',
      inclusions: [],
      source: 'RULES.md',
    },
    {
      id: 'rules-md--use-strict',
      name: 'Use strict mode',
      description: 'D',
      inclusions: [],
      source: 'RULES.md',
    },
    {
      id: 'src-rules-md--no-any',
      name: 'No any types',
      description: 'D',
      inclusions: ['src/'],
      source: 'src/RULES.md',
    },
  ];

  it('matches by exact name (case-insensitive)', () => {
    const result = filterRulesByNameOrId(rules, ['no console.log']);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('rules-md--no-console-log');
  });

  it('matches by exact ID', () => {
    const result = filterRulesByNameOrId(rules, ['src-rules-md--no-any']);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('No any types');
  });

  it('matches multiple rules with mixed name and ID', () => {
    const result = filterRulesByNameOrId(rules, [
      'No console.log',
      'src-rules-md--no-any',
    ]);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when nothing matches', () => {
    const result = filterRulesByNameOrId(rules, ['nonexistent']);
    expect(result).toEqual([]);
  });
});
