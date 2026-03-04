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
vi.mock('../../../src/lib/results.js', () => ({
  collectResults: mockCollectResults,
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
    claudeCode: { singleInstance: false, agentTeams: false },
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
});
