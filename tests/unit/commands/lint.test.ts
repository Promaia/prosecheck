import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock the engine before importing lint
vi.mock('../../../src/lib/engine.js', () => ({
  runEngine: vi.fn(),
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
import { runEngine } from '../../../src/lib/engine.js';
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
      timeout: 300,
      postRun: [],
      lastRun: { read: false, write: false },
      environments: {},
      ruleCalculators: [],
      claudeCode: {
        claudeToRuleShape: 'one-to-one' as const,
        maxConcurrentAgents: 0,
        maxTurns: 10,
        allowedTools: [],
        tools: [],
        additionalArgs: [],
      },
    },
    environment: 'default',
  });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
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
