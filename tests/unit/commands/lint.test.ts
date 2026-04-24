import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock the engine before importing lint
vi.mock('../../../src/lib/engine.js', () => ({
  runEngine: vi.fn(),
  UnknownRuleFilterError: class UnknownRuleFilterError extends Error {
    constructor(
      public readonly unmatched: string[],
      public readonly available: Array<{ id: string; name: string }>,
    ) {
      super(
        `Unrecognized --rules entr${unmatched.length === 1 ? 'y' : 'ies'}: ${unmatched
          .map((u) => `"${u}"`)
          .join(', ')}`,
      );
      this.name = 'UnknownRuleFilterError';
    }
  },
}));

// Mock config loading to avoid needing real config files
vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: vi.fn(),
  resolveEnvironment: vi.fn(() => 'default'),
  ConfigError: class ConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ConfigError';
    }
  },
}));

import { lint } from '../../../src/commands/lint.js';
import { runEngine, UnknownRuleFilterError } from '../../../src/lib/engine.js';
import { loadConfig } from '../../../src/lib/config.js';
import type { EngineResult } from '../../../src/lib/engine.js';

const mockedRunEngine = vi.mocked(runEngine);
const mockedLoadConfig = vi.mocked(loadConfig);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-lint-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });

  // Suppress stdout/stderr
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  // Default mock: config loads successfully (cast to avoid matching full Config shape)
  mockedLoadConfig.mockResolvedValue({
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
        defaultModel: 'sonnet',
        validModels: ['opus', 'sonnet', 'haiku'],
      },
    },
    environment: 'default',
  });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  process.exitCode = undefined;
});

function mockEngineResult(overrides: Partial<EngineResult> = {}): EngineResult {
  return {
    results: {
      results: [],
      dropped: [],
      errors: [],
      overallStatus: 'pass' as const,
    },
    overallStatus: 'pass',
    output: 'All rules passed.',
    ...overrides,
  };
}

describe('lint --output', () => {
  it('writes output to file when --output is specified', async () => {
    const outputPath = path.join(tmpDir, 'output.log');
    mockedRunEngine.mockResolvedValue(
      mockEngineResult({ output: 'PASS rule-1' }),
    );

    await lint({
      projectRoot: tmpDir,
      format: 'json',
      output: outputPath,
    });

    const content = await readFile(outputPath, 'utf-8');
    expect(content).toBe('PASS rule-1\n');
  });

  it('does not write file when --output is not specified', async () => {
    mockedRunEngine.mockResolvedValue(
      mockEngineResult({ output: 'PASS rule-1' }),
    );

    await lint({
      projectRoot: tmpDir,
      format: 'json',
    });

    // No file should exist — we just verify lint completed successfully
    expect(process.exitCode).toBe(0);
  });

  it('does not write file when output is empty', async () => {
    const outputPath = path.join(tmpDir, 'output.log');
    mockedRunEngine.mockResolvedValue(mockEngineResult({ output: '' }));

    await lint({
      projectRoot: tmpDir,
      format: 'json',
      output: outputPath,
    });

    // File should not exist since output was empty (falsy)
    await expect(readFile(outputPath, 'utf-8')).rejects.toThrow();
  });

  it('overwrites existing output file', async () => {
    const outputPath = path.join(tmpDir, 'output.log');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outputPath, 'old content');

    mockedRunEngine.mockResolvedValue(
      mockEngineResult({ output: 'new content' }),
    );

    await lint({
      projectRoot: tmpDir,
      format: 'json',
      output: outputPath,
    });

    const content = await readFile(outputPath, 'utf-8');
    expect(content).toBe('new content\n');
  });
});

describe('lint runlock', () => {
  it('exits 2 and explains when another run holds the lock', async () => {
    mockedRunEngine.mockResolvedValue(
      mockEngineResult({ output: 'should not be reached' }),
    );

    // Write a lock pointing at our own pid so isLiveLock() returns true.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.join(tmpDir, '.prosecheck'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, '.prosecheck', '.runlock'),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host: (await import('node:os')).default.hostname(),
      }),
    );

    const writes: string[] = [];
    (
      process.stderr.write as unknown as {
        mockImplementation: (fn: (s: string) => boolean) => void;
      }
    ).mockImplementation((s: string) => {
      writes.push(s);
      return true;
    });

    await lint({ projectRoot: tmpDir });

    expect(process.exitCode).toBe(2);
    const combined = writes.join('');
    expect(combined).toContain('Another prosecheck run');
    expect(combined).toContain(`pid:        ${String(process.pid)}`);
    expect(mockedRunEngine).not.toHaveBeenCalled();
  });

  it('force: true bypasses the runlock', async () => {
    mockedRunEngine.mockResolvedValue(mockEngineResult({ output: 'ok' }));
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.join(tmpDir, '.prosecheck'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, '.prosecheck', '.runlock'),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host: (await import('node:os')).default.hostname(),
      }),
    );

    await lint({ projectRoot: tmpDir, force: true });

    expect(process.exitCode).toBe(0);
    expect(mockedRunEngine).toHaveBeenCalled();
  });
});

describe('lint --rules strict validation', () => {
  it('exits 2 on UnknownRuleFilterError and prints available rules', async () => {
    const available = [
      {
        id: 'rules-md--alpha',
        name: 'Alpha',
        description: 'd',
        inclusions: [],
        source: 'RULES.md',
      },
      {
        id: 'rules-md--beta',
        name: 'Beta',
        description: 'd',
        inclusions: [],
        source: 'RULES.md',
      },
    ];
    mockedRunEngine.mockRejectedValue(
      new UnknownRuleFilterError(['gamma'], available),
    );

    const writes: string[] = [];
    (
      process.stderr.write as unknown as {
        mockImplementation: (fn: (s: string) => boolean) => void;
      }
    ).mockImplementation((s: string) => {
      writes.push(s);
      return true;
    });

    await lint({
      projectRoot: tmpDir,
      rules: 'gamma',
    });

    expect(process.exitCode).toBe(2);
    const combined = writes.join('');
    expect(combined).toContain('gamma');
    expect(combined).toContain('Alpha');
    expect(combined).toContain('rules-md--beta');
    expect(combined).toContain('--rules-allow-missing');
  });
});
