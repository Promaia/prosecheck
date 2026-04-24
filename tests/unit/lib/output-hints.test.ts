import { describe, it, expect } from 'vitest';
import { buildOutputHints } from '../../../src/lib/output-hints.js';
import { createRule } from '../../../src/lib/rule.js';
import type { CollectResultsOutput } from '../../../src/lib/results.js';

function makeResults(
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

describe('buildOutputHints', () => {
  it('returns no hints when format is json', () => {
    const hints = buildOutputHints({
      format: 'json',
      outputPath: 'out.log',
      results: makeResults(),
    });
    expect(hints).toEqual([]);
  });

  it('returns no hints when format is sarif', () => {
    const hints = buildOutputHints({
      format: 'sarif',
      outputPath: 'out.log',
      results: makeResults(),
    });
    expect(hints).toEqual([]);
  });

  it('emits an output-file pointer hint when outputPath is set', () => {
    const hints = buildOutputHints({
      format: 'stylish',
      outputPath: '.prosecheck/last-output.txt',
      results: makeResults(),
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('.prosecheck/last-output.txt');
    expect(hints[0]).toContain('read this file');
  });

  it('does not emit output-file pointer when outputPath is absent', () => {
    const hints = buildOutputHints({
      format: 'stylish',
      results: makeResults(),
    });
    expect(hints).toEqual([]);
  });

  it('does not emit output-file pointer for empty string outputPath', () => {
    const hints = buildOutputHints({
      format: 'stylish',
      outputPath: '',
      results: makeResults(),
    });
    expect(hints).toEqual([]);
  });

  it('emits re-run hint when there are warn/fail rules', () => {
    const hints = buildOutputHints({
      format: 'stylish',
      results: makeResults({
        results: [
          {
            ruleId: 'r1',
            result: {
              status: 'warn',
              rule: 'Rule One',
              source: 'RULES.md',
              headline: 'noted',
              comments: [{ message: 'a' }],
            },
          },
          {
            ruleId: 'r2',
            result: {
              status: 'fail',
              rule: 'Rule Two',
              source: 'RULES.md',
              headline: 'broken',
              comments: [{ message: 'b' }],
            },
          },
          {
            ruleId: 'r3',
            result: {
              status: 'pass',
              rule: 'Rule Three',
              source: 'RULES.md',
            },
          },
        ],
      }),
    });

    const rerun = hints.find((h) => h.includes('re-run'));
    expect(rerun).toBeDefined();
    expect(rerun).toContain('"Rule One"');
    expect(rerun).toContain('"Rule Two"');
    expect(rerun).not.toContain('"Rule Three"');
    expect(rerun).toContain('--rules "Rule One","Rule Two"');
  });

  it('includes dropped rules in the re-run hint', () => {
    const droppedRule = createRule('Dropped One', 'text', [], 'RULES.md');
    const hints = buildOutputHints({
      format: 'stylish',
      results: makeResults({
        overallStatus: 'dropped',
        dropped: [{ rule: droppedRule, attempt: 1 }],
      }),
    });

    const rerun = hints.find((h) => h.includes('re-run'));
    expect(rerun).toBeDefined();
    expect(rerun).toContain('"Dropped One"');
  });

  it('omits re-run hint when all rules passed', () => {
    const hints = buildOutputHints({
      format: 'stylish',
      results: makeResults({
        results: [
          {
            ruleId: 'r1',
            result: {
              status: 'pass',
              rule: 'Rule One',
              source: 'RULES.md',
            },
          },
        ],
      }),
    });

    expect(hints.some((h) => h.includes('re-run'))).toBe(false);
  });

  it('emits both hints when applicable', () => {
    const hints = buildOutputHints({
      format: 'stylish',
      outputPath: '.prosecheck/last-output.txt',
      results: makeResults({
        results: [
          {
            ruleId: 'r1',
            result: {
              status: 'fail',
              rule: 'Rule One',
              source: 'RULES.md',
              headline: 'broken',
              comments: [{ message: 'a' }],
            },
          },
        ],
      }),
    });

    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain('read this file');
    expect(hints[1]).toContain('re-run');
  });
});
