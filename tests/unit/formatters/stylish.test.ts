import { describe, it, expect } from 'vitest';
import { formatStylish } from '../../../src/formatters/stylish.js';
import type { CollectResultsOutput } from '../../../src/lib/results.js';
import { createRule } from '../../../src/lib/rule.js';

function makeOutput(
  overrides: Partial<CollectResultsOutput> = {},
): CollectResultsOutput {
  return {
    results: [],
    dropped: [],
    errors: [],
    overallStatus: 'pass',
    ...overrides,
  };
}

describe('stylish formatter', () => {
  it('formats pass results', () => {
    const output = makeOutput({
      results: [
        {
          ruleId: 'test-rule',
          result: {
            status: 'pass',
            rule: 'No console.log',
            source: 'src/RULES.md',
            comment: 'All clear',
          },
        },
      ],
    });

    const text = formatStylish(output);

    expect(text).toContain('PASS');
    expect(text).toContain('No console.log');
    expect(text).toContain('All clear');
    expect(text).toContain('1 rules');
    expect(text).toContain('1 passed');
  });

  it('formats fail results with file and line', () => {
    const output = makeOutput({
      overallStatus: 'fail',
      results: [
        {
          ruleId: 'test-rule',
          result: {
            status: 'fail',
            rule: 'No console.log',
            source: 'src/RULES.md',
            headline: 'Found violations',
            comments: [
              { message: 'console.log found', file: 'src/foo.ts', line: 42 },
              { message: 'another one', file: 'src/bar.ts' },
            ],
          },
        },
      ],
    });

    const text = formatStylish(output);

    expect(text).toContain('FAIL');
    expect(text).toContain('Found violations');
    expect(text).toContain('src/foo.ts:42');
    expect(text).toContain('console.log found');
    expect(text).toContain('src/bar.ts');
    expect(text).toContain('another one');
    expect(text).toContain('1 failed');
  });

  it('formats warn results', () => {
    const output = makeOutput({
      overallStatus: 'warn',
      results: [
        {
          ruleId: 'test-rule',
          result: {
            status: 'warn',
            rule: 'Style guide',
            source: 'docs/RULES.md',
            headline: 'Minor issue',
            comments: [{ message: 'Consider refactoring' }],
          },
        },
      ],
    });

    const text = formatStylish(output);

    expect(text).toContain('WARN');
    expect(text).toContain('Minor issue');
    expect(text).toContain('1 warned');
  });

  it('formats dropped results', () => {
    const rule = createRule('Missing Rule', 'Desc', ['src/'], 'src/RULES.md');
    const output = makeOutput({
      overallStatus: 'dropped',
      dropped: [{ rule, attempt: 1 }],
    });

    const text = formatStylish(output);

    expect(text).toContain('DROP');
    expect(text).toContain('Missing Rule');
    expect(text).toContain('No output produced');
    expect(text).toContain('1 dropped');
  });

  it('formats cached rules', () => {
    const rule = createRule('Cached Rule', 'Desc', ['src/'], 'src/RULES.md');
    const output = makeOutput({
      cached: [rule],
    });

    const text = formatStylish(output);

    expect(text).toContain('CACHED');
    expect(text).toContain('Cached Rule');
    expect(text).toContain('skipped (cache current)');
    expect(text).toContain('1 rules');
    expect(text).toContain('1 cached');
  });

  it('formats error results', () => {
    const output = makeOutput({
      overallStatus: 'fail',
      errors: [
        {
          ruleId: 'bad-rule',
          ruleName: 'Bad Rule',
          message: 'Invalid JSON output',
        },
      ],
    });

    const text = formatStylish(output);

    expect(text).toContain('ERR');
    expect(text).toContain('Bad Rule');
    expect(text).toContain('Invalid JSON output');
    expect(text).toContain('1 errors');
  });

  it('includes timing duration for results', () => {
    const timing = new Map([
      [
        'test-rule',
        {
          ruleId: 'test-rule',
          startedAt: 1000,
          completedAt: 46200,
          durationMs: 45200,
        },
      ],
    ]);
    const output = makeOutput({
      results: [
        {
          ruleId: 'test-rule',
          result: {
            status: 'pass',
            rule: 'No console.log',
            source: 'src/RULES.md',
          },
        },
      ],
      timing,
    });

    const text = formatStylish(output);
    expect(text).toContain('45.2s');
  });

  it('shows "never started" for dropped rules with no start marker', () => {
    const rule = createRule('Missing', 'Desc', ['src/'], 'src/RULES.md');
    const output = makeOutput({
      overallStatus: 'dropped',
      dropped: [{ rule, attempt: 1 }],
      timing: new Map(),
    });

    const text = formatStylish(output);
    expect(text).toContain('never started');
  });

  it('shows "started but timed out" for dropped rules with start marker', () => {
    const rule = createRule('Slow Rule', 'Desc', ['src/'], 'src/RULES.md');
    const timing = new Map([
      [
        rule.id,
        {
          ruleId: rule.id,
          startedAt: 1000,
          completedAt: undefined,
          durationMs: undefined,
        },
      ],
    ]);
    const output = makeOutput({
      overallStatus: 'dropped',
      dropped: [{ rule, attempt: 1 }],
      timing,
    });

    const text = formatStylish(output);
    expect(text).toContain('started but timed out');
  });

  it('formats mixed results with summary', () => {
    const rule = createRule('Dropped', 'D', [], 'r.md');
    const output = makeOutput({
      overallStatus: 'fail',
      results: [
        {
          ruleId: 'pass-rule',
          result: { status: 'pass', rule: 'Pass', source: 'a.md' },
        },
        {
          ruleId: 'fail-rule',
          result: {
            status: 'fail',
            rule: 'Fail',
            source: 'b.md',
            headline: 'Bad',
            comments: [{ message: 'detail' }],
          },
        },
      ],
      dropped: [{ rule, attempt: 1 }],
    });

    const text = formatStylish(output);

    expect(text).toContain('3 rules');
    expect(text).toContain('1 passed');
    expect(text).toContain('1 failed');
    expect(text).toContain('1 dropped');
  });
});
