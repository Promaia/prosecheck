import { describe, it, expect } from 'vitest';
import {
  ConfigSchema,
  RuleResultSchema,
  LastRunSchema,
  ClaudeCodeSchema,
  CalculatorConfigSchema,
  EnvironmentOverrideSchema,
} from '../../../src/lib/config-schema.js';

describe('ConfigSchema', () => {
  it('produces full defaults from empty input', () => {
    const result = ConfigSchema.parse({});

    expect(result.baseBranch).toBe('main');
    expect(result.timeout).toBe(300);
    expect(result.warnAsError).toBe(false);
    expect(result.retryDropped).toBe(false);
    expect(result.retryDroppedMaxAttempts).toBe(1);
    expect(result.postRun).toEqual([]);
    expect(result.ruleCalculators).toEqual([]);
    expect(result.globalIgnore).toContain('node_modules/');
    expect(result.additionalIgnore).toEqual(['.gitignore']);
  });

  it('applies nested defaults for lastRun', () => {
    const result = ConfigSchema.parse({});
    expect(result.lastRun.read).toBe(false);
    expect(result.lastRun.write).toBe(false);
  });

  it('applies nested defaults for claudeCode', () => {
    const result = ConfigSchema.parse({});
    expect(result.claudeCode.claudeToRuleShape).toBe('one-to-many-teams');
    expect(result.claudeCode.maxConcurrentAgents).toBe(10);
    expect(result.claudeCode.maxTurns).toBe(30);
    expect(result.claudeCode.allowedTools).toBeInstanceOf(Array);
    expect(result.claudeCode.allowedTools.length).toBeGreaterThan(0);
    expect(result.claudeCode.allowedTools).toContain('Read');
    expect(result.claudeCode.allowedTools).toContain('Grep');
    expect(result.claudeCode.allowedTools).toContain('Glob');
  });

  it('provides default environments', () => {
    const result = ConfigSchema.parse({});
    expect(result.environments['ci']).toBeDefined();
    expect(result.environments['ci']?.warnAsError).toBe(true);
    expect(result.environments['interactive']).toBeDefined();
  });

  it('accepts valid full config', () => {
    const result = ConfigSchema.safeParse({
      baseBranch: 'develop',
      timeout: 600,
      warnAsError: true,
      lastRun: { read: true, write: false },
      claudeCode: { claudeToRuleShape: 'one-to-many-teams' },
      ruleCalculators: [
        { name: 'rules-md', enabled: true },
        { name: 'adr', enabled: false, options: { path: 'docs/adr' } },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseBranch).toBe('develop');
      expect(result.data.timeout).toBe(600);
      expect(result.data.ruleCalculators).toHaveLength(2);
    }
  });

  it('rejects invalid types', () => {
    const result = ConfigSchema.safeParse({ timeout: 'not a number' });
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = ConfigSchema.safeParse({ timeout: -1 });
    expect(result.success).toBe(false);
  });

  it('has descriptions on top-level fields', () => {
    // Verify .describe() metadata is present on key fields
    expect(ConfigSchema.description).toBe('Prosecheck configuration');
    expect(LastRunSchema.description).toContain('Incremental run tracking');
    expect(ClaudeCodeSchema.description).toContain('Claude Code');
    expect(CalculatorConfigSchema.description).toContain('rule calculator');
    expect(EnvironmentOverrideSchema.description).toContain('environment');
  });
});

describe('RuleResultSchema', () => {
  it('accepts valid pass result', () => {
    const result = RuleResultSchema.safeParse({
      status: 'pass',
      rule: 'No console.log',
      source: 'src/RULES.md',
    });
    expect(result.success).toBe(true);
  });

  it('accepts pass result with optional comment', () => {
    const result = RuleResultSchema.safeParse({
      status: 'pass',
      rule: 'No console.log',
      source: 'src/RULES.md',
      comment: 'All clear',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid warn result', () => {
    const result = RuleResultSchema.safeParse({
      status: 'warn',
      rule: 'No console.log',
      source: 'src/RULES.md',
      headline: 'Minor issue found',
      comments: [
        {
          message: 'Consider removing console.log',
          file: 'src/foo.ts',
          line: 42,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid fail result', () => {
    const result = RuleResultSchema.safeParse({
      status: 'fail',
      rule: 'No console.log',
      source: 'src/RULES.md',
      headline: 'Violation found',
      comments: [{ message: 'Direct console.log usage' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects warn result without comments', () => {
    const result = RuleResultSchema.safeParse({
      status: 'warn',
      rule: 'No console.log',
      source: 'src/RULES.md',
      headline: 'Minor issue',
      comments: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects fail result without comments', () => {
    const result = RuleResultSchema.safeParse({
      status: 'fail',
      rule: 'No console.log',
      source: 'src/RULES.md',
      headline: 'Violation',
      comments: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown status', () => {
    const result = RuleResultSchema.safeParse({
      status: 'unknown',
      rule: 'No console.log',
      source: 'src/RULES.md',
    });
    expect(result.success).toBe(false);
  });
});
