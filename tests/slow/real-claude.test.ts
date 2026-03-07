/**
 * Slow E2E tests: real Claude CLI, no mocks.
 *
 * These tests call the real `claude` binary and exercise the full pipeline
 * end-to-end. They are gated behind `PROSECHECK_SLOW_TESTS=1` so they
 * don't run in normal CI.
 *
 * Prerequisites: `claude` CLI installed and authenticated.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runEngine } from '../../src/lib/engine.js';
import { RuleResultSchema, ConfigSchema } from '../../src/lib/config-schema.js';
import type { Config } from '../../src/lib/config-schema.js';
import type { RunContext } from '../../src/types/index.js';
import type { TestRepo } from '../helpers/git-repo.js';
import { scenarios } from '../helpers/scenarios.js';

// Use Zod-parsed defaults so slow tests get the real allowedTools list
const SCHEMA_DEFAULTS = ConfigSchema.parse({});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...SCHEMA_DEFAULTS,
    lastRun: { read: false, write: false, files: false },
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

const verbose = !!process.env['PROSECHECK_VERBOSE'];

beforeEach(() => {
  // Suppress engine stdout unless PROSECHECK_VERBOSE is set
  if (!verbose) {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const repo of repos) {
    await repo.cleanup();
  }
  repos.length = 0;
});

function scenario(name: string) {
  const fn = scenarios[name];
  if (!fn) throw new Error(`Unknown scenario: ${name}`);
  return fn();
}

// --- Tests ---

describe.skipIf(!process.env['PROSECHECK_SLOW_TESTS'])(
  'Slow E2E: real Claude CLI',
  () => {
    it('single failing rule — TODO comment detected', async () => {
      const repo = await scenario('single-failing-rule');
      repos.push(repo);

      const context = makeContext(repo.dir, {
        config: makeConfig({
          claudeCode: {
            ...SCHEMA_DEFAULTS.claudeCode,
            claudeToRuleShape: 'one-to-one',
            maxConcurrentAgents: 0,
          },
        }),
      });
      const result = await runEngine(context);

      expect(result.results.results).toHaveLength(1);
      const ruleResult = result.results.results[0];
      expect(ruleResult).toBeDefined();
      // Validate against schema
      expect(() => RuleResultSchema.parse(ruleResult?.result)).not.toThrow();
      expect(ruleResult?.result.status).toBe('fail');
      expect(result.results.dropped).toHaveLength(0);
    }, 120_000);

    it('single passing rule — clean file', async () => {
      const repo = await scenario('single-passing-rule');
      repos.push(repo);

      const context = makeContext(repo.dir, {
        config: makeConfig({
          claudeCode: {
            ...SCHEMA_DEFAULTS.claudeCode,
            claudeToRuleShape: 'one-to-one',
            maxConcurrentAgents: 0,
          },
        }),
      });
      const result = await runEngine(context);

      expect(result.results.results).toHaveLength(1);
      const ruleResult = result.results.results[0];
      expect(ruleResult).toBeDefined();
      expect(() => RuleResultSchema.parse(ruleResult?.result)).not.toThrow();
      expect(ruleResult?.result.status).toBe('pass');
      expect(result.results.dropped).toHaveLength(0);
    }, 120_000);

    it('multiple rules, multi-instance — all output files written and valid', async () => {
      const repo = await scenario('multi-rule-violations');
      repos.push(repo);

      const context = makeContext(repo.dir, {
        config: makeConfig({
          claudeCode: {
            ...SCHEMA_DEFAULTS.claudeCode,
            claudeToRuleShape: 'one-to-one',
            maxConcurrentAgents: 0,
          },
        }),
      });
      const result = await runEngine(context);

      // Both rules should produce results
      expect(result.results.results.length).toBe(2);
      expect(result.results.dropped).toHaveLength(0);

      // Each result should parse against schema
      for (const r of result.results.results) {
        expect(() => RuleResultSchema.parse(r.result)).not.toThrow();
      }

      // Verify both rule IDs are present
      const ruleIds = result.results.results.map((r) => r.ruleId);
      expect(ruleIds).toContain('rules-md--no-todo-comments');
      expect(ruleIds).toContain('rules-md--no-console-log');
    }, 120_000);

    it('single-instance with agent-teams — all output files written and valid', async () => {
      const repo = await scenario('multi-rule-violations');
      repos.push(repo);

      const context = makeContext(repo.dir, {
        config: makeConfig({
          claudeCode: {
            ...SCHEMA_DEFAULTS.claudeCode,
            claudeToRuleShape: 'one-to-many-teams',
            maxConcurrentAgents: 0,
          },
        }),
      });
      const result = await runEngine(context);

      // All rules should have results
      expect(result.results.results.length).toBe(2);
      expect(result.results.dropped).toHaveLength(0);

      // Each result should parse against schema
      for (const r of result.results.results) {
        expect(() => RuleResultSchema.parse(r.result)).not.toThrow();
      }

      // Verify both rule IDs are present
      const ruleIds = result.results.results.map((r) => r.ruleId);
      expect(ruleIds).toContain('rules-md--no-todo-comments');
      expect(ruleIds).toContain('rules-md--no-console-log');
    }, 120_000);
  },
);
