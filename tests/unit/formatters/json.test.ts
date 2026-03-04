import { describe, it, expect } from 'vitest';
import { formatJson } from '../../../src/formatters/json.js';
import type { JsonOutput } from '../../../src/formatters/json.js';
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

describe('json formatter', () => {
  it('outputs valid JSON', () => {
    const output = makeOutput();
    const text = formatJson(output);

    expect(() => JSON.parse(text) as unknown).not.toThrow();
  });

  it('includes all result fields for pass', () => {
    const output = makeOutput({
      results: [
        {
          ruleId: 'test-rule',
          result: {
            status: 'pass',
            rule: 'No console.log',
            source: 'src/RULES.md',
            comment: 'All good',
          },
        },
      ],
    });

    const parsed = JSON.parse(formatJson(output)) as JsonOutput;

    expect(parsed.overallStatus).toBe('pass');
    expect(parsed.results).toHaveLength(1);
    const first = parsed.results[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.ruleId).toBe('test-rule');
    expect(first.status).toBe('pass');
    expect(first.rule).toBe('No console.log');
    expect(first.source).toBe('src/RULES.md');
    expect(first.comment).toBe('All good');
  });

  it('includes headline and comments for fail', () => {
    const output = makeOutput({
      overallStatus: 'fail',
      results: [
        {
          ruleId: 'fail-rule',
          result: {
            status: 'fail',
            rule: 'Rule',
            source: 'r.md',
            headline: 'Bad',
            comments: [{ message: 'detail', file: 'a.ts', line: 10 }],
          },
        },
      ],
    });

    const parsed = JSON.parse(formatJson(output)) as JsonOutput;
    const first = parsed.results[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.headline).toBe('Bad');
    expect(first.comments).toHaveLength(1);
  });

  it('includes dropped rules', () => {
    const rule = createRule('Dropped', 'D', [], 'r.md');
    const output = makeOutput({
      overallStatus: 'dropped',
      dropped: [{ rule, attempt: 1 }],
    });

    const parsed = JSON.parse(formatJson(output)) as JsonOutput;

    expect(parsed.dropped).toHaveLength(1);
    const first = parsed.dropped[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.ruleId).toBe(rule.id);
    expect(first.ruleName).toBe('Dropped');
  });

  it('includes errors', () => {
    const output = makeOutput({
      overallStatus: 'fail',
      errors: [{ ruleId: 'err', ruleName: 'Err Rule', message: 'bad json' }],
    });

    const parsed = JSON.parse(formatJson(output)) as JsonOutput;

    expect(parsed.errors).toHaveLength(1);
    const first = parsed.errors[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.message).toBe('bad json');
  });
});
