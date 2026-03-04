import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseResultFile,
  collectResults,
  computeOverallStatus,
} from '../../../src/lib/results.js';
import type {
  RuleResultWithId,
  DroppedRule,
  ResultError,
} from '../../../src/lib/results.js';
import { createRule } from '../../../src/lib/rule.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-results-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(tmpDir, '.prosecheck/working/outputs'), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function writeOutput(ruleId: string, data: unknown): Promise<void> {
  return writeFile(
    path.join(tmpDir, '.prosecheck/working/outputs', `${ruleId}.json`),
    JSON.stringify(data),
    'utf-8',
  );
}

describe('parseResultFile', () => {
  it('parses a valid pass result', () => {
    const json = JSON.stringify({
      status: 'pass',
      rule: 'No console.log',
      source: 'src/RULES.md',
    });

    const result = parseResultFile(json, 'test-rule');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.status).toBe('pass');
    }
  });

  it('parses a valid warn result', () => {
    const json = JSON.stringify({
      status: 'warn',
      rule: 'No console.log',
      source: 'src/RULES.md',
      headline: 'Found console.log usage',
      comments: [{ message: 'Line 42 has console.log', file: 'src/foo.ts', line: 42 }],
    });

    const result = parseResultFile(json, 'test-rule');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.status).toBe('warn');
    }
  });

  it('parses a valid fail result', () => {
    const json = JSON.stringify({
      status: 'fail',
      rule: 'No console.log',
      source: 'src/RULES.md',
      headline: 'console.log must be removed',
      comments: [{ message: 'Found console.log', file: 'src/foo.ts', line: 10 }],
    });

    const result = parseResultFile(json, 'test-rule');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.status).toBe('fail');
    }
  });

  it('rejects invalid JSON', () => {
    const result = parseResultFile('not json {{{', 'test-rule');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('not valid JSON');
    }
  });

  it('rejects result with invalid schema', () => {
    const json = JSON.stringify({ status: 'pass' }); // missing "rule" and "source"

    const result = parseResultFile(json, 'test-rule');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('failed schema validation');
    }
  });

  it('rejects unknown status values', () => {
    const json = JSON.stringify({
      status: 'unknown',
      rule: 'test',
      source: 'test.md',
    });

    const result = parseResultFile(json, 'test-rule');

    expect(result.ok).toBe(false);
  });

  it('rejects warn/fail without comments', () => {
    const json = JSON.stringify({
      status: 'warn',
      rule: 'test',
      source: 'test.md',
      headline: 'Issue found',
      comments: [],
    });

    const result = parseResultFile(json, 'test-rule');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('failed schema validation');
    }
  });
});

describe('collectResults', () => {
  it('collects results from output files', async () => {
    const rule = createRule('No console.log', 'Desc', ['src/'], 'src/RULES.md');
    await writeOutput(rule.id, {
      status: 'pass',
      rule: rule.name,
      source: rule.source,
    });

    const output = await collectResults({
      projectRoot: tmpDir,
      expectedRules: [rule],
    });

    expect(output.results).toHaveLength(1);
    const firstResult = output.results[0];
    expect(firstResult).toBeDefined();
    if (!firstResult) return;
    expect(firstResult.ruleId).toBe(rule.id);
    expect(firstResult.result.status).toBe('pass');
    expect(output.dropped).toHaveLength(0);
    expect(output.errors).toHaveLength(0);
    expect(output.overallStatus).toBe('pass');
  });

  it('marks missing outputs as dropped', async () => {
    const rule = createRule('No console.log', 'Desc', ['src/'], 'src/RULES.md');
    // No output file written

    const output = await collectResults({
      projectRoot: tmpDir,
      expectedRules: [rule],
    });

    expect(output.results).toHaveLength(0);
    expect(output.dropped).toHaveLength(1);
    const firstDropped = output.dropped[0];
    expect(firstDropped).toBeDefined();
    if (!firstDropped) return;
    expect(firstDropped.rule.id).toBe(rule.id);
    expect(output.overallStatus).toBe('dropped');
  });

  it('reports malformed output as errors', async () => {
    const rule = createRule('Bad rule', 'Desc', ['src/'], 'src/RULES.md');
    await writeOutput(rule.id, { status: 'pass' }); // missing fields

    const output = await collectResults({
      projectRoot: tmpDir,
      expectedRules: [rule],
    });

    expect(output.results).toHaveLength(0);
    expect(output.errors).toHaveLength(1);
    const firstError = output.errors[0];
    expect(firstError).toBeDefined();
    if (!firstError) return;
    expect(firstError.ruleId).toBe(rule.id);
    expect(output.overallStatus).toBe('fail'); // errors treated as fail
  });

  it('handles mixed results correctly', async () => {
    const ruleA = createRule('Rule A', 'Desc A', ['src/'], 'src/RULES.md');
    const ruleB = createRule('Rule B', 'Desc B', ['docs/'], 'docs/RULES.md');
    const ruleC = createRule('Rule C', 'Desc C', ['test/'], 'test/RULES.md');

    await writeOutput(ruleA.id, {
      status: 'pass',
      rule: ruleA.name,
      source: ruleA.source,
    });
    await writeOutput(ruleB.id, {
      status: 'warn',
      rule: ruleB.name,
      source: ruleB.source,
      headline: 'Warning',
      comments: [{ message: 'detail' }],
    });
    // ruleC — no output (dropped)

    const output = await collectResults({
      projectRoot: tmpDir,
      expectedRules: [ruleA, ruleB, ruleC],
    });

    expect(output.results).toHaveLength(2);
    expect(output.dropped).toHaveLength(1);
    expect(output.overallStatus).toBe('dropped');
  });

  it('handles missing outputs directory gracefully', async () => {
    await rm(path.join(tmpDir, '.prosecheck'), { recursive: true, force: true });
    const rule = createRule('Rule A', 'Desc', ['src/'], 'src/RULES.md');

    const output = await collectResults({
      projectRoot: tmpDir,
      expectedRules: [rule],
    });

    expect(output.dropped).toHaveLength(1);
    expect(output.overallStatus).toBe('dropped');
  });
});

describe('computeOverallStatus', () => {
  it('returns pass when all results pass', () => {
    const results: RuleResultWithId[] = [
      { ruleId: 'a', result: { status: 'pass', rule: 'A', source: 'a.md' } },
    ];
    expect(computeOverallStatus(results, [], [])).toBe('pass');
  });

  it('returns warn when worst is warn', () => {
    const results: RuleResultWithId[] = [
      { ruleId: 'a', result: { status: 'pass', rule: 'A', source: 'a.md' } },
      {
        ruleId: 'b',
        result: {
          status: 'warn',
          rule: 'B',
          source: 'b.md',
          headline: 'h',
          comments: [{ message: 'm' }],
        },
      },
    ];
    expect(computeOverallStatus(results, [], [])).toBe('warn');
  });

  it('returns fail when any result fails', () => {
    const results: RuleResultWithId[] = [
      {
        ruleId: 'a',
        result: {
          status: 'fail',
          rule: 'A',
          source: 'a.md',
          headline: 'h',
          comments: [{ message: 'm' }],
        },
      },
    ];
    expect(computeOverallStatus(results, [], [])).toBe('fail');
  });

  it('returns dropped when rules are dropped', () => {
    const rule = createRule('A', 'D', [], 'a.md');
    const dropped: DroppedRule[] = [{ rule, attempt: 1 }];
    expect(computeOverallStatus([], dropped, [])).toBe('dropped');
  });

  it('returns fail when errors exist', () => {
    const errors: ResultError[] = [
      { ruleId: 'a', ruleName: 'A', message: 'bad json' },
    ];
    expect(computeOverallStatus([], [], errors)).toBe('fail');
  });

  it('fail beats dropped', () => {
    const rule = createRule('A', 'D', [], 'a.md');
    const results: RuleResultWithId[] = [
      {
        ruleId: 'b',
        result: {
          status: 'fail',
          rule: 'B',
          source: 'b.md',
          headline: 'h',
          comments: [{ message: 'm' }],
        },
      },
    ];
    const dropped: DroppedRule[] = [{ rule, attempt: 1 }];
    expect(computeOverallStatus(results, dropped, [])).toBe('fail');
  });

  it('dropped beats warn', () => {
    const rule = createRule('A', 'D', [], 'a.md');
    const results: RuleResultWithId[] = [
      {
        ruleId: 'b',
        result: {
          status: 'warn',
          rule: 'B',
          source: 'b.md',
          headline: 'h',
          comments: [{ message: 'm' }],
        },
      },
    ];
    const dropped: DroppedRule[] = [{ rule, attempt: 1 }];
    expect(computeOverallStatus(results, dropped, [])).toBe('dropped');
  });

  it('returns pass for empty inputs', () => {
    expect(computeOverallStatus([], [], [])).toBe('pass');
  });
});
