import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunContext } from '../../../src/types/index.js';
import type { Config } from '../../../src/lib/config-schema.js';

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
vi.mock('../../../src/lib/change-detection.js', () => ({
  detectChanges: mockDetectChanges,
}));
vi.mock('../../../src/lib/prompt.js', () => ({
  generatePrompts: mockGeneratePrompts,
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

const { runEngine } = await import('../../../src/lib/engine.js');

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseBranch: 'main',
    globalIgnore: [],
    additionalIgnore: ['.gitignore'],
    lastRun: { read: false, write: false },
    timeout: 300,
    warnAsError: false,
    retryDropped: false,
    retryDroppedMaxAttempts: 1,
    claudeCode: { singleInstance: false, agentTeams: true },
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
    { id: 'rule-a', name: 'Rule A', description: 'D', inclusions: ['src/'], source: 'RULES.md' },
  ]);
  mockDetectChanges.mockResolvedValue({
    comparisonRef: 'abc123',
    triggeredRules: [
      { id: 'rule-a', name: 'Rule A', description: 'D', inclusions: ['src/'], source: 'RULES.md' },
    ],
    changedFiles: ['src/foo.ts'],
    changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
  });
  mockGeneratePrompts.mockResolvedValue({
    promptPaths: new Map([['rule-a', '/tmp/prompts/rule-a.md']]),
  });
  mockRunClaudeCode.mockResolvedValue([]);
  mockCollectResults.mockResolvedValue({
    results: [{ ruleId: 'rule-a', result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' } }],
    dropped: [],
    errors: [],
    overallStatus: 'pass',
  });
  // Real implementation for computeOverallStatus used by retry logic
  const severity = ['pass', 'warn', 'dropped', 'fail'];
  mockComputeOverallStatus.mockImplementation(
    (results: Array<{ result: { status: string } }>, dropped: unknown[], errors: unknown[]) => {
      let worst = 'pass';
      for (const { result } of results) {
        if (severity.indexOf(result.status) > severity.indexOf(worst)) worst = result.status;
      }
      if (dropped.length > 0 && severity.indexOf('dropped') > severity.indexOf(worst)) worst = 'dropped';
      if (errors.length > 0 && severity.indexOf('fail') > severity.indexOf(worst)) worst = 'fail';
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
      results: [{
        ruleId: 'rule-a',
        result: {
          status: 'warn', rule: 'Rule A', source: 'RULES.md',
          headline: 'h', comments: [{ message: 'm' }],
        },
      }],
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

  it('calls commitLastRunHash when present', async () => {
    const commitFn = vi.fn().mockResolvedValue(undefined);
    mockDetectChanges.mockResolvedValue({
      comparisonRef: 'abc123',
      triggeredRules: [
        { id: 'rule-a', name: 'Rule A', description: 'D', inclusions: ['src/'], source: 'RULES.md' },
      ],
      changedFiles: ['src/foo.ts'],
      changedFilesByRule: new Map([['rule-a', ['src/foo.ts']]]),
      commitLastRunHash: commitFn,
    });

    const context = makeContext();
    await runEngine(context);

    expect(commitFn).toHaveBeenCalledOnce();
  });

  describe('retryDropped', () => {
    const ruleA = { id: 'rule-a', name: 'Rule A', description: 'D', inclusions: ['src/'], source: 'RULES.md' };
    const ruleB = { id: 'rule-b', name: 'Rule B', description: 'D', inclusions: ['src/'], source: 'RULES.md' };

    it('does not retry when retryDropped is false', async () => {
      mockRunCalculators.mockResolvedValue([ruleA]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA],
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

      const context = makeContext({ config: makeConfig({ retryDropped: false }) });
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
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']], ['rule-b', ['src/foo.ts']]]),
      });
      mockGeneratePrompts.mockResolvedValue({
        promptPaths: new Map([['rule-a', '/tmp/p/rule-a.md'], ['rule-b', '/tmp/p/rule-b.md']]),
      });

      // First collect: rule-a passes, rule-b dropped
      mockCollectResults
        .mockResolvedValueOnce({
          results: [{ ruleId: 'rule-a', result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' } }],
          dropped: [{ rule: ruleB, attempt: 1 }],
          errors: [],
          overallStatus: 'dropped',
        })
        // Second collect (retry): rule-b now passes
        .mockResolvedValueOnce({
          results: [{ ruleId: 'rule-b', result: { status: 'pass', rule: 'Rule B', source: 'RULES.md' } }],
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
          results: [{ ruleId: 'rule-a', result: { status: 'warn', rule: 'Rule A', source: 'RULES.md', headline: 'h', comments: [] } }],
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

    it('retries only the dropped rules, not already-resolved ones', async () => {
      mockRunCalculators.mockResolvedValue([ruleA, ruleB]);
      mockDetectChanges.mockResolvedValue({
        comparisonRef: 'abc123',
        triggeredRules: [ruleA, ruleB],
        changedFiles: ['src/foo.ts'],
        changedFilesByRule: new Map([['rule-a', ['src/foo.ts']], ['rule-b', ['src/foo.ts']]]),
      });
      mockGeneratePrompts.mockResolvedValue({
        promptPaths: new Map([['rule-a', '/tmp/p/rule-a.md'], ['rule-b', '/tmp/p/rule-b.md']]),
      });

      // First: rule-a passes, rule-b dropped
      mockCollectResults
        .mockResolvedValueOnce({
          results: [{ ruleId: 'rule-a', result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' } }],
          dropped: [{ rule: ruleB, attempt: 1 }],
          errors: [],
          overallStatus: 'dropped',
        })
        // Retry collect: rule-b passes
        .mockResolvedValueOnce({
          results: [{ ruleId: 'rule-b', result: { status: 'pass', rule: 'Rule B', source: 'RULES.md' } }],
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
      const retryPromptRules = (retryPromptCall[0] as { rules: typeof ruleA[] }).rules;
      expect(retryPromptRules).toHaveLength(1);
      expect(retryPromptRules[0]?.id).toBe('rule-b');
    });
  });
});
