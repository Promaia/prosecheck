/**
 * Integration tests: Claude CLI shim & pipeline.
 *
 * These tests use a real git repo and a fake Claude binary (fake-claude.mjs)
 * to exercise the full pipeline without making real API calls. The execa mock
 * intercepts `claude` calls and redirects them to `node fake-claude.mjs`,
 * while passing `git` calls through to real execa.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
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
  lastClaudeArgs: [] as string[][],
  fakeClaudeEnv: {} as Record<string, string>,
  /** Optional per-call override: (callIndex) => env overrides, or undefined to use fakeClaudeEnv */
  perCallEnvFn: undefined as
    | ((callIndex: number) => Record<string, string>)
    | undefined,
}));

vi.mock('execa', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const realExecaFn = mod['execa'] as (...a: unknown[]) => unknown;
  return {
    execa: (cmd: string, args: string[], opts?: Record<string, unknown>) => {
      if (cmd === 'claude') {
        shared.claudeCallCount++;
        shared.lastClaudeArgs.push(args);
        const optsEnv = (opts ? opts['env'] : undefined) as
          | Record<string, string | undefined>
          | undefined;
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

import {
  createTestRepo as createTestRepoBase,
  gitCommit as gitCommitBase,
  type TestRepo,
  type ExecaFn,
} from '../helpers/git-repo.js';

async function createTestRepo(): Promise<TestRepo> {
  return createTestRepoBase({
    prefix: 'prosecheck-integ',
    execFn: execaFn as ExecaFn,
  });
}

async function gitCommit(dir: string, message: string): Promise<void> {
  return gitCommitBase(dir, message, execaFn as ExecaFn);
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
    claudeCode: {
      singleInstance: false,
      agentTeams: false,
      maxTurns: 30,
      allowedTools: [],
      tools: [],
      additionalArgs: [],
    },
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
  shared.lastClaudeArgs = [];
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
  it('runs 2 rules through real pipeline with fake Claude and collects fail results', async () => {
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
      config: makeConfig({
        claudeCode: {
          singleInstance: false,
          agentTeams: false,
          maxTurns: 30,
          allowedTools: [],
          tools: [],
          additionalArgs: [],
        },
      }),
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

    // Each claude call should have --output-format json and --allowedTools
    for (const args of shared.lastClaudeArgs) {
      expect(args).toContain('--print');
      expect(args).toContain('--output-format');
      expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    }

    // Each call should have Write permission scoped to its specific output file (absolute path)
    const allowedToolsValues = shared.lastClaudeArgs.map((args) => {
      const idx = args.indexOf('--allowedTools');
      return idx >= 0 ? args[idx + 1] : undefined;
    });
    const repoPrefix = repo.dir.replaceAll('\\', '/');
    expect(allowedToolsValues).toContainEqual(
      expect.stringContaining(
        `Write(${repoPrefix}/.prosecheck/working/outputs/rules-md--no-console-log.json)`,
      ),
    );
    expect(allowedToolsValues).toContainEqual(
      expect.stringContaining(
        `Write(${repoPrefix}/.prosecheck/working/outputs/rules-md--keep-functions-short.json)`,
      ),
    );
  }, 30_000);
});

describe('Integration: single-instance mode with agent teams', () => {
  it('sends orchestration prompt with agent teams env var set', async () => {
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
        claudeCode: {
          singleInstance: true,
          agentTeams: true,
          maxTurns: 30,
          allowedTools: [],
          tools: [],
          additionalArgs: [],
        },
      }),
    });
    const result = await runEngine(context);

    // In single-instance mode, only 1 claude process is spawned
    expect(shared.claudeCallCount).toBe(1);

    // The env should include the agent teams flag
    expect(shared.lastClaudeEnv['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']).toBe(
      '1',
    );

    // All rules should have results (fake-claude extracts all output paths)
    expect(result.results.results.length).toBe(2);
    expect(result.results.dropped).toHaveLength(0);

    // Single-instance should get wildcard Write permission for outputs
    const args = shared.lastClaudeArgs[0] as string[];
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    const toolsIdx = args.indexOf('--allowedTools');
    expect(toolsIdx).toBeGreaterThan(-1);
    const toolsArg = args[toolsIdx + 1] as string;
    const repoPrefix = repo.dir.replaceAll('\\', '/');
    expect(toolsArg).toContain(
      `Write(${repoPrefix}/.prosecheck/working/outputs/*)`,
    );
  }, 30_000);
});

describe('Integration: dropped rule retry', () => {
  it('retries a dropped rule and succeeds on second attempt', async () => {
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
  }, 30_000);
});

describe('Integration: post-run env vars', () => {
  it('passes PROSECHECK_STATUS and PROSECHECK_RESULTS_DIR to post-run commands', async () => {
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
  }, 30_000);
});
