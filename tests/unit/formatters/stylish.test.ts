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
