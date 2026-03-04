import { describe, it, expect } from 'vitest';
import { formatSarif } from '../../../src/formatters/sarif.js';
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

describe('sarif formatter', () => {
  it('outputs valid SARIF schema', () => {
    const output = makeOutput();
    const parsed = JSON.parse(formatSarif(output)) as Record<string, unknown>;

    expect(parsed['version']).toBe('2.1.0');
    expect(parsed['$schema']).toContain('sarif-schema-2.1.0');
    expect(parsed['runs']).toBeInstanceOf(Array);
  });

  it('maps fail results to SARIF results with locations', () => {
    const output = makeOutput({
      overallStatus: 'fail',
      results: [
        {
          ruleId: 'test-rule',
          result: {
            status: 'fail',
            rule: 'No console.log',
            source: 'src/RULES.md',
            headline: 'Violations found',
            comments: [
              {
                message: 'console.log on line 42',
                file: 'src/foo.ts',
                line: 42,
              },
              { message: 'another issue', file: 'src/bar.ts' },
            ],
          },
        },
      ],
    });

    const parsed = JSON.parse(formatSarif(output)) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          level: string;
          message: { text: string };
          locations?: Array<{
            physicalLocation: {
              artifactLocation: { uri: string };
              region?: { startLine: number };
            };
          }>;
        }>;
      }>;
    };

    const run = parsed.runs[0];
    expect(run).toBeDefined();
    if (!run) return;

    expect(run.tool.driver.rules).toHaveLength(1);
    expect(run.results).toHaveLength(2);

    const firstResult = run.results[0];
    expect(firstResult).toBeDefined();
    if (!firstResult) return;
    expect(firstResult.ruleId).toBe('test-rule');
    expect(firstResult.level).toBe('error');
    expect(firstResult.locations).toHaveLength(1);
    const loc = firstResult.locations?.[0];
    expect(loc?.physicalLocation.artifactLocation.uri).toBe('src/foo.ts');
    expect(loc?.physicalLocation.region?.startLine).toBe(42);

    const secondResult = run.results[1];
    expect(secondResult).toBeDefined();
    if (!secondResult) return;
    expect(secondResult.locations).toHaveLength(1);
    const loc2 = secondResult.locations?.[0];
    expect(loc2?.physicalLocation.artifactLocation.uri).toBe('src/bar.ts');
    expect(loc2?.physicalLocation.region).toBeUndefined();
  });

  it('maps warn results with warning level', () => {
    const output = makeOutput({
      overallStatus: 'warn',
      results: [
        {
          ruleId: 'warn-rule',
          result: {
            status: 'warn',
            rule: 'Style guide',
            source: 'docs/RULES.md',
            headline: 'Minor issue',
            comments: [{ message: 'Refactor this' }],
          },
        },
      ],
    });

    const parsed = JSON.parse(formatSarif(output)) as {
      runs: Array<{ results: Array<{ level: string }> }>;
    };

    const run = parsed.runs[0];
    expect(run).toBeDefined();
    if (!run) return;
    const result = run.results[0];
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.level).toBe('warning');
  });

  it('omits pass results from SARIF output', () => {
    const output = makeOutput({
      results: [
        {
          ruleId: 'pass-rule',
          result: { status: 'pass', rule: 'Good', source: 'a.md' },
        },
      ],
    });

    const parsed = JSON.parse(formatSarif(output)) as {
      runs: Array<{
        results: unknown[];
        tool: { driver: { rules: unknown[] } };
      }>;
    };

    const run = parsed.runs[0];
    expect(run).toBeDefined();
    if (!run) return;
    expect(run.results).toHaveLength(0);
    expect(run.tool.driver.rules).toHaveLength(0);
  });

  it('includes dropped rules as error results', () => {
    const rule = createRule('Dropped Rule', 'D', [], 'r.md');
    const output = makeOutput({
      overallStatus: 'dropped',
      dropped: [{ rule, attempt: 1 }],
    });

    const parsed = JSON.parse(formatSarif(output)) as {
      runs: Array<{
        results: Array<{
          ruleId: string;
          level: string;
          message: { text: string };
        }>;
      }>;
    };

    const run = parsed.runs[0];
    expect(run).toBeDefined();
    if (!run) return;
    expect(run.results).toHaveLength(1);
    const result = run.results[0];
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.level).toBe('error');
    expect(result.message.text).toContain('Dropped Rule');
  });
});
