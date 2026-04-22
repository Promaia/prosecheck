/**
 * End-to-end pipeline tests.
 *
 * These tests exercise the full pipeline (calculators → change detection →
 * prompt generation → mode dispatch → result collection → formatting) with
 * only git commands and external processes mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Config } from '../../src/lib/config-schema.js';
import type { RunContext } from '../../src/types/index.js';

let tmpDir: string;

// Mock execa (used by change-detection for git commands)
const mockExeca = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => mockExeca(...args) as unknown,
}));

// Mock claude-code mode (spawns external processes)
const mockRunClaudeCode = vi.fn();
vi.mock('../../src/modes/claude-code.js', () => ({
  runClaudeCode: (...args: unknown[]) => mockRunClaudeCode(...args) as unknown,
}));

// Mock user-prompt mode (requires interactive terminal)
const mockBuildUserPrompt = vi.fn();
const mockWatchForOutputs = vi.fn();
vi.mock('../../src/modes/user-prompt.js', () => ({
  buildUserPrompt: (...args: unknown[]) =>
    mockBuildUserPrompt(...args) as unknown,
  watchForOutputs: (...args: unknown[]) =>
    mockWatchForOutputs(...args) as unknown,
}));

const { runEngine } = await import('../../src/lib/engine.js');

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseBranch: 'main',
    globalIgnore: ['node_modules/', 'dist/', '.prosecheck/'],
    additionalIgnore: [],
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
    ruleCalculators: [{ name: 'rules-md', enabled: true, options: {} }],
    ...overrides,
  };
}

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    config: makeConfig(),
    environment: 'interactive',
    mode: 'claude-code',
    format: 'stylish',
    projectRoot: tmpDir,
    comparisonRef: '',
    ...overrides,
  };
}

/** Write a rule result JSON file to the outputs directory */
async function writeAgentOutput(
  ruleId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const outputDir = path.join(tmpDir, '.prosecheck/working/outputs');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, `${ruleId}.json`),
    JSON.stringify(result),
    'utf-8',
  );
}

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-e2e-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);

  // Default git mock: merge-base returns a hash, diff returns changed files
  mockExeca.mockImplementation((cmd: string, args: string[]) => {
    const firstArg = args[0];
    if (cmd === 'git' && firstArg === 'merge-base') {
      return Promise.resolve({ stdout: 'abc123def456' });
    }
    if (cmd === 'git' && firstArg === 'diff') {
      return Promise.resolve({ stdout: 'src/foo.ts\nsrc/bar.ts' });
    }
    if (cmd === 'git' && firstArg === 'rev-parse') {
      return Promise.resolve({ stdout: 'deadbeef12345678' });
    }
    return Promise.resolve({ stdout: '' });
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('E2E: user-prompt mode', () => {
  it('generates prompt files and collects results', async () => {
    // Set up fixture project with RULES.md
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log in source files.\n',
      'utf-8',
    );

    // Mock user-prompt mode: simulate agent writing output
    mockBuildUserPrompt.mockReturnValue('Copy this prompt...');
    mockWatchForOutputs.mockImplementation(async () => {
      // Simulate agent writing output while "watching"
      await writeAgentOutput('rules-md--no-console-log', {
        status: 'pass',
        rule: 'No console.log',
        source: 'RULES.md',
      });
      return new Set(['rules-md--no-console-log']);
    });

    const context = makeContext({ mode: 'user-prompt' });
    const result = await runEngine(context);

    // Verify prompt files were generated
    const promptsDir = path.join(tmpDir, '.prosecheck/working/prompts');
    const promptFiles = await readdir(promptsDir);
    expect(promptFiles.length).toBeGreaterThan(0);
    expect(promptFiles.some((f) => f.endsWith('.md'))).toBe(true);

    // Verify prompt content contains rule text
    const promptContent = await readFile(
      path.join(promptsDir, promptFiles[0] as string),
      'utf-8',
    );
    expect(promptContent).toContain('No console.log');
    expect(promptContent).toContain('src/foo.ts');

    // Verify results
    expect(result.overallStatus).toBe('pass');
    expect(result.results.results).toHaveLength(1);
    expect(result.output).toBeTruthy();
  });
});

describe('E2E: claude-code mode', () => {
  it('runs full pipeline from rules to formatted output', async () => {
    // Set up fixture project
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      [
        '# No console.log',
        '',
        'Do not use console.log in source files.',
        '',
        '# Keep functions short',
        '',
        'Functions should be under 50 lines.',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Mock claude-code: simulate agent writing outputs
    mockRunClaudeCode.mockImplementation(async () => {
      await writeAgentOutput('rules-md--no-console-log', {
        status: 'fail',
        rule: 'No console.log',
        source: 'RULES.md',
        headline: 'Found console.log statements',
        comments: [
          { message: 'Remove console.log', file: 'src/foo.ts', line: 10 },
          { message: 'Remove console.log', file: 'src/bar.ts', line: 25 },
        ],
      });
      await writeAgentOutput('rules-md--keep-functions-short', {
        status: 'pass',
        rule: 'Keep functions short',
        source: 'RULES.md',
      });
    });

    const context = makeContext({ mode: 'claude-code', format: 'stylish' });
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('fail');
    expect(result.results.results).toHaveLength(2);
    expect(result.output).toContain('FAIL');
    expect(result.output).toContain('console.log');
  });

  it('produces valid JSON output', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log.\n',
      'utf-8',
    );

    mockRunClaudeCode.mockImplementation(async () => {
      await writeAgentOutput('rules-md--no-console-log', {
        status: 'warn',
        rule: 'No console.log',
        source: 'RULES.md',
        headline: 'Found one console.log',
        comments: [
          { message: 'Consider removing', file: 'src/foo.ts', line: 5 },
        ],
      });
    });

    const context = makeContext({ format: 'json' });
    const result = await runEngine(context);

    const parsed = JSON.parse(result.output) as Record<string, unknown>;
    expect(parsed['overallStatus']).toBe('warn');
    expect(parsed['results']).toBeInstanceOf(Array);
  });

  it('handles dropped rules (no output produced)', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log.\n',
      'utf-8',
    );

    // Mock claude-code returns without writing any output files
    mockRunClaudeCode.mockResolvedValue(undefined);

    const context = makeContext();
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('dropped');
    expect(result.results.dropped).toHaveLength(1);
  });

  it('returns early when no files changed', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log.\n',
      'utf-8',
    );

    // No changed files
    mockExeca.mockImplementation((cmd: string, args: string[]) => {
      const firstArg = args[0];
      if (cmd === 'git' && firstArg === 'merge-base') {
        return Promise.resolve({ stdout: 'abc123' });
      }
      if (cmd === 'git' && firstArg === 'diff') {
        return Promise.resolve({ stdout: '' });
      }
      return Promise.resolve({ stdout: '' });
    });

    const context = makeContext();
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('pass');
    expect(mockRunClaudeCode).not.toHaveBeenCalled();
  });

  it('applies warnAsError promotion across full pipeline', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log.\n',
      'utf-8',
    );

    mockRunClaudeCode.mockImplementation(async () => {
      await writeAgentOutput('rules-md--no-console-log', {
        status: 'warn',
        rule: 'No console.log',
        source: 'RULES.md',
        headline: 'Found one issue',
        comments: [{ message: 'Consider removing' }],
      });
    });

    const context = makeContext({
      config: makeConfig({ warnAsError: true }),
    });
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('fail');
  });
});

describe('E2E: init creates working project scaffold', () => {
  it('init then lint succeeds on fresh project', async () => {
    // Use init to scaffold a project
    const { init } = await import('../../src/commands/init.js');
    await init({ projectRoot: tmpDir, createRules: true });

    // Verify scaffold
    const config = JSON.parse(
      await readFile(path.join(tmpDir, '.prosecheck/config.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(config['baseBranch']).toBe('main');

    const rules = await readFile(path.join(tmpDir, 'RULES.md'), 'utf-8');
    expect(rules).toContain('# Rules');

    // Mock claude-code to write passing outputs for all discovered rules
    mockRunClaudeCode.mockImplementation(async () => {
      // Read what prompts were generated to know which output files to write
      const promptsDir = path.join(tmpDir, '.prosecheck/working/prompts');
      const promptFiles = await readdir(promptsDir);
      for (const file of promptFiles) {
        const ruleId = file.replace('.md', '');
        await writeAgentOutput(ruleId, {
          status: 'pass',
          rule: ruleId,
          source: 'RULES.md',
        });
      }
    });

    const context = makeContext();
    const result = await runEngine(context);

    expect(result.overallStatus).toBe('pass');
    expect(result.results.results.length).toBeGreaterThan(0);
  });
});

describe('E2E: per-rule cache tracking', () => {
  it('writes per-rule cache entries for passing rules, skips them on subsequent unchanged run', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log.\n',
      'utf-8',
    );

    mockExeca.mockImplementation((cmd: string, args: string[]) => {
      const firstArg = args[0];
      if (cmd === 'git' && firstArg === 'merge-base') {
        return Promise.resolve({ stdout: 'abc123def456' });
      }
      if (cmd === 'git' && firstArg === 'ls-files') {
        return Promise.resolve({ stdout: 'RULES.md' });
      }
      if (cmd === 'git' && firstArg === 'diff') {
        return Promise.resolve({ stdout: 'RULES.md' });
      }
      if (cmd === 'git' && firstArg === 'rev-parse') {
        return Promise.resolve({ stdout: 'deadbeef12345678' });
      }
      return Promise.resolve({ stdout: '' });
    });

    mockRunClaudeCode.mockImplementation(async () => {
      await writeAgentOutput('rules-md--no-console-log', {
        status: 'pass',
        rule: 'No console.log',
        source: 'RULES.md',
      });
    });

    // Run 1: write is on — per-rule cache entries should be written for passing rules
    const context1 = makeContext({
      config: makeConfig({
        lastRun: { read: false, write: true },
      }),
    });
    await runEngine(context1);

    const lastRunPath = path.join(tmpDir, '.prosecheck/last-user-run');
    const raw = (await readFile(lastRunPath, 'utf-8')).trim();
    const lastRunData = JSON.parse(raw) as Record<string, unknown>;
    const rules = lastRunData['rules'] as Record<string, unknown> | undefined;
    expect(rules).toBeDefined();
    const entry = rules?.['rules-md--no-console-log'] as
      | Record<string, unknown>
      | undefined;
    expect(entry).toBeDefined();
    expect(entry?.['status']).toBe('pass');
    expect(entry?.['fingerprint']).toBeDefined();

    // Run 2: read is on — no files changed, so the rule is cached (not re-run)
    mockRunClaudeCode.mockClear();

    const context2 = makeContext({
      config: makeConfig({
        lastRun: { read: true, write: false },
      }),
    });
    const result2 = await runEngine(context2);

    expect(result2.overallStatus).toBe('pass');
    expect(mockRunClaudeCode).not.toHaveBeenCalled();
    expect(result2.results.cached).toBeDefined();
    expect(result2.results.cached?.length).toBeGreaterThan(0);
  });
});

describe('E2E: SARIF output validation', () => {
  it('produces valid SARIF 2.1.0 structure', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      [
        '# No console.log',
        '',
        'Do not use console.log.',
        '',
        '# Keep functions short',
        '',
        'Functions should be under 50 lines.',
      ].join('\n') + '\n',
      'utf-8',
    );

    mockRunClaudeCode.mockImplementation(async () => {
      await writeAgentOutput('rules-md--no-console-log', {
        status: 'fail',
        rule: 'No console.log',
        source: 'RULES.md',
        headline: 'Found console.log usage',
        comments: [
          { message: 'Remove this', file: 'src/foo.ts', line: 10 },
          { message: 'Remove this too', file: 'src/bar.ts', line: 20 },
        ],
      });
      await writeAgentOutput('rules-md--keep-functions-short', {
        status: 'warn',
        rule: 'Keep functions short',
        source: 'RULES.md',
        headline: 'Long function detected',
        comments: [
          { message: 'Function is 75 lines', file: 'src/foo.ts', line: 1 },
        ],
      });
    });

    const context = makeContext({ format: 'sarif' });
    const result = await runEngine(context);

    // Parse SARIF output
    const sarif = JSON.parse(result.output) as Record<string, unknown>;

    // Validate top-level SARIF structure
    expect(sarif['$schema']).toContain('sarif-schema-2.1.0');
    expect(sarif['version']).toBe('2.1.0');

    const runs = sarif['runs'] as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);

    const run = runs[0] as Record<string, unknown>;

    // Validate tool section
    const tool = run['tool'] as Record<string, unknown>;
    const driver = tool['driver'] as Record<string, unknown>;
    expect(driver['name']).toBe('prosecheck');

    // Validate rules
    const rules = driver['rules'] as Array<Record<string, unknown>>;
    expect(rules.length).toBeGreaterThanOrEqual(2);

    // Validate results
    const results = run['results'] as Array<Record<string, unknown>>;
    expect(results.length).toBe(3); // 2 from fail + 1 from warn

    // Validate result structure
    for (const r of results) {
      expect(r['ruleId']).toBeTruthy();
      expect(typeof r['ruleIndex']).toBe('number');
      expect(['error', 'warning']).toContain(r['level']);
      expect(r['message']).toBeTruthy();
    }

    // Check that fail results have "error" level
    const failResults = results.filter((r) => r['level'] === 'error');
    expect(failResults.length).toBe(2);

    // Check that warn results have "warning" level
    const warnResults = results.filter((r) => r['level'] === 'warning');
    expect(warnResults.length).toBe(1);

    // Validate physical locations
    for (const r of results) {
      const locations = r['locations'] as
        | Array<Record<string, unknown>>
        | undefined;
      if (locations) {
        for (const loc of locations) {
          const physLoc = loc['physicalLocation'] as Record<string, unknown>;
          expect(physLoc['artifactLocation']).toBeTruthy();
        }
      }
    }
  });

  it('includes dropped rules as error findings in SARIF', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.prosecheck/config.json'),
      JSON.stringify({ baseBranch: 'main' }),
      'utf-8',
    );
    await writeFile(
      path.join(tmpDir, 'RULES.md'),
      '# No console.log\n\nDo not use console.log.\n',
      'utf-8',
    );

    // No output written → dropped
    mockRunClaudeCode.mockResolvedValue(undefined);

    const context = makeContext({ format: 'sarif' });
    const result = await runEngine(context);

    const sarif = JSON.parse(result.output) as Record<string, unknown>;
    const runs = sarif['runs'] as Array<Record<string, unknown>>;
    const run = runs[0] as Record<string, unknown>;

    const results = run['results'] as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);

    // Dropped rules should appear as error-level
    const droppedResult = results[0] as Record<string, unknown>;
    expect(droppedResult['level']).toBe('error');
    expect(
      (droppedResult['message'] as Record<string, string>)['text'],
    ).toContain('no output');
  });
});
