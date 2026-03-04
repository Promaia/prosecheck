/**
 * Integration tests: Claude CLI shim & pipeline.
 *
 * These tests use a real git repo and a fake Claude binary (fake-claude.mjs)
 * to exercise the full pipeline without making real API calls. The execa mock
 * intercepts `claude` calls and redirects them to `node fake-claude.mjs`,
 * while passing `git` calls through to real execa.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Config } from '../../src/lib/config-schema.js';
import type { RunContext } from '../../src/types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE_PATH = path.resolve(__dirname, '../fixtures/fake-claude.mjs');

// Shared mutable state for the mock — vi.hoisted ensures these are available
// when the hoisted vi.mock factory runs.
const shared = vi.hoisted(() => ({
  claudeCallCount: 0,
  lastClaudeEnv: {} as Record<string, string | undefined>,
  fakeClaudeEnv: {} as Record<string, string>,
  /** Optional per-call override: (callIndex) => env overrides, or undefined to use fakeClaudeEnv */
  perCallEnvFn: undefined as ((callIndex: number) => Record<string, string>) | undefined,
}));

vi.mock('execa', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const realExecaFn = mod['execa'] as (...a: unknown[]) => unknown;
  return {
    execa: (cmd: string, args: string[], opts?: Record<string, unknown>) => {
      if (cmd === 'claude') {
        shared.claudeCallCount++;
        const optsEnv = (opts ? opts['env'] : undefined) as Record<string, string | undefined> | undefined;
        shared.lastClaudeEnv = optsEnv ?? {};

        // Determine env for fake-claude
        const extraEnv = shared.perCallEnvFn
          ? shared.perCallEnvFn(shared.claudeCallCount)
          : shared.fakeClaudeEnv;

        const mergedEnv = {
          ...process.env,
          ...(optsEnv ?? {}),
          ...extraEnv,
        };
        return realExecaFn('node', [FAKE_CLAUDE_PATH, ...args], {
          ...opts,
          env: mergedEnv,
        });
      }
      return realExecaFn(cmd, args, opts);
    },
  };
});

// Must import after mock is set up
const { execa: execaFn } = await import('execa');
const { runEngine } = await import('../../src/lib/engine.js');

// --- Helpers ---

interface TestRepo {
  dir: string;
  cleanup: () => Promise<void>;
}

async function createTestRepo(): Promise<TestRepo> {
  const suffix = randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), `prosecheck-integ-${suffix}`);
  await mkdir(dir, { recursive: true });

  // These git calls go through the mock, but since cmd !== 'claude' they pass through to real execa
  await execaFn('git', ['init'], { cwd: dir });
  await execaFn('git', ['checkout', '-b', 'main'], { cwd: dir });
  await execaFn('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await execaFn('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
  });

  // Initial commit
  await writeFile(path.join(dir, 'README.md'), '# test\n', 'utf-8');
  await gitCommit(dir, 'Initial commit');

  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function gitCommit(dir: string, message: string): Promise<void> {
  await execaFn('git', ['add', '-A'], { cwd: dir });
  await execaFn('git', ['commit', '-m', message, '--allow-empty-message'], {
    cwd: dir,
  });
}

/** Write RULES.md with two rules and .prosecheck/config.json */
async function setupFixtureProject(
  dir: string,
  configOverrides: Partial<Config> = {},
): Promise<void> {
  await mkdir(path.join(dir, '.prosecheck'), { recursive: true });
  const config = {
    baseBranch: 'main',
    ...configOverrides,
  };
  await writeFile(
    path.join(dir, '.prosecheck/config.json'),
    JSON.stringify(config),
    'utf-8',
  );
  await writeFile(
    path.join(dir, 'RULES.md'),
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
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseBranch: 'main',
    globalIgnore: ['node_modules/', 'dist/'],
    additionalIgnore: [],
    lastRun: { read: false, write: false },
    timeout: 300,
    warnAsError: false,
    retryDropped: false,
    retryDroppedMaxAttempts: 1,
    claudeCode: { singleInstance: false, agentTeams: false },
    postRun: [],
    environments: {},
    ruleCalculators: [{ name: 'rules-md', enabled: true, options: {} }],
    ...overrides,
  };
}

function makeContext(
  projectRoot: string,
  overrides: Partial<RunContext> = {},
): RunContext {
  return {
    config: makeConfig(),
    environment: 'interactive',
    mode: 'claude-code',
    format: 'stylish',
    projectRoot,
    comparisonRef: '',
    ...overrides,
  };
}

// --- Setup & Teardown ---

const repos: TestRepo[] = [];

beforeEach(() => {
  shared.claudeCallCount = 0;
  shared.lastClaudeEnv = {};
  shared.fakeClaudeEnv = {};
  shared.perCallEnvFn = undefined;
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const repo of repos) {
    await repo.cleanup();
  }
  repos.length = 0;
});

// --- Tests ---

describe('Integration: multi-instance mode full pipeline', () => {
  it(
    'runs 2 rules through real pipeline with fake Claude and collects fail results',
    async () => {
      const repo = await createTestRepo();
      repos.push(repo);

      await setupFixtureProject(repo.dir);
      await gitCommit(repo.dir, 'Add rules and config');

      // Create a feature branch with changes
      await execaFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
      await mkdir(path.join(repo.dir, 'src'), { recursive: true });
      await writeFile(
        path.join(repo.dir, 'src/foo.ts'),
        'console.log("hello");\n',
        'utf-8',
      );
      await gitCommit(repo.dir, 'Add source file');

      shared.fakeClaudeEnv = { FAKE_CLAUDE_STATUS: 'fail' };

      const context = makeContext(repo.dir, {
        config: makeConfig({ claudeCode: { singleInstance: false, agentTeams: false } }),
      });
      const result = await runEngine(context);

      expect(result.overallStatus).toBe('fail');
      expect(result.results.results.length).toBe(2);

      // Both rules should have results
      const ruleIds = result.results.results.map((r) => r.ruleId);
      expect(ruleIds).toContain('rules-md--no-console-log');
      expect(ruleIds).toContain('rules-md--keep-functions-short');

      // Each result should be a fail
      for (const r of result.results.results) {
        expect(r.result.status).toBe('fail');
      }

      // Should have spawned 2 claude processes (one per rule)
      expect(shared.claudeCallCount).toBe(2);
    },
    30_000,
  );
});

describe('Integration: single-instance mode with agent teams', () => {
  it(
    'sends orchestration prompt with agent teams env var set',
    async () => {
      const repo = await createTestRepo();
      repos.push(repo);

      await setupFixtureProject(repo.dir);
      await gitCommit(repo.dir, 'Add rules and config');

      await execaFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
      await mkdir(path.join(repo.dir, 'src'), { recursive: true });
      await writeFile(
        path.join(repo.dir, 'src/foo.ts'),
        'export const x = 1;\n',
        'utf-8',
      );
      await gitCommit(repo.dir, 'Add source file');

      shared.fakeClaudeEnv = { FAKE_CLAUDE_STATUS: 'pass' };

      const context = makeContext(repo.dir, {
        config: makeConfig({
          claudeCode: { singleInstance: true, agentTeams: true },
        }),
      });
      const result = await runEngine(context);

      // In single-instance mode, only 1 claude process is spawned
      expect(shared.claudeCallCount).toBe(1);

      // The env should include the agent teams flag
      expect(shared.lastClaudeEnv['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']).toBe('1');

      // All rules should have results (fake-claude extracts all output paths)
      expect(result.results.results.length).toBe(2);
      expect(result.results.dropped).toHaveLength(0);
    },
    30_000,
  );
});

describe('Integration: dropped rule retry', () => {
  it(
    'retries a dropped rule and succeeds on second attempt',
    async () => {
      const repo = await createTestRepo();
      repos.push(repo);

      // Use a single rule for simplicity
      await mkdir(path.join(repo.dir, '.prosecheck'), { recursive: true });
      await writeFile(
        path.join(repo.dir, '.prosecheck/config.json'),
        JSON.stringify({ baseBranch: 'main' }),
        'utf-8',
      );
      await writeFile(
        path.join(repo.dir, 'RULES.md'),
        '# No console.log\n\nDo not use console.log.\n',
        'utf-8',
      );
      await gitCommit(repo.dir, 'Add rule');

      await execaFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
      await mkdir(path.join(repo.dir, 'src'), { recursive: true });
      await writeFile(
        path.join(repo.dir, 'src/foo.ts'),
        'console.log("hi");\n',
        'utf-8',
      );
      await gitCommit(repo.dir, 'Add source file');

      // First claude call: drop; second: pass
      shared.perCallEnvFn = (callIndex) => {
        if (callIndex === 1) {
          return { FAKE_CLAUDE_DROP: '1' };
        }
        return { FAKE_CLAUDE_STATUS: 'pass' };
      };

      const context = makeContext(repo.dir, {
        config: makeConfig({
          retryDropped: true,
          retryDroppedMaxAttempts: 1,
        }),
      });
      const result = await runEngine(context);

      // After retry, the rule should have a result (not be dropped)
      expect(result.results.dropped).toHaveLength(0);
      expect(result.results.results.length).toBe(1);
      expect(result.results.results[0]?.result.status).toBe('pass');
      expect(shared.claudeCallCount).toBe(2);
    },
    30_000,
  );
});

describe('Integration: post-run env vars', () => {
  it(
    'passes PROSECHECK_STATUS and PROSECHECK_RESULTS_DIR to post-run commands',
    async () => {
      const repo = await createTestRepo();
      repos.push(repo);

      await setupFixtureProject(repo.dir);
      await gitCommit(repo.dir, 'Add rules');

      await execaFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
      await mkdir(path.join(repo.dir, 'src'), { recursive: true });
      await writeFile(
        path.join(repo.dir, 'src/foo.ts'),
        'export const x = 1;\n',
        'utf-8',
      );
      await gitCommit(repo.dir, 'Add source file');

      shared.fakeClaudeEnv = { FAKE_CLAUDE_STATUS: 'warn' };

      // The env-check output file path (outside the working dir so it persists)
      const envCheckPath = path
        .join(repo.dir, '.prosecheck/env-check.json')
        .replaceAll('\\', '/');

      const postRunCmd = `node -e "const fs=require('fs'); const p=require('path'); fs.writeFileSync('${envCheckPath}', JSON.stringify({status: process.env.PROSECHECK_STATUS, resultsDir: process.env.PROSECHECK_RESULTS_DIR}))"`;

      const context = makeContext(repo.dir, {
        config: makeConfig({ postRun: [postRunCmd] }),
      });
      const result = await runEngine(context);

      expect(result.overallStatus).toBe('warn');

      // Read the env-check file written by the post-run command
      const envCheck = JSON.parse(
        await readFile(envCheckPath, 'utf-8'),
      ) as Record<string, string>;
      expect(envCheck['status']).toBe('warn');
      expect(envCheck['resultsDir']).toBeTruthy();
      // The results dir should be an absolute path containing the outputs dir
      expect(envCheck['resultsDir']).toContain('.prosecheck');
      expect(envCheck['resultsDir']).toContain('outputs');
    },
    30_000,
  );
});
