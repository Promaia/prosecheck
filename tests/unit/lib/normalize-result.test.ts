import { describe, it, expect } from 'vitest';
import { normalizeResult } from '../../../src/lib/normalize-result.js';
import type { NormalizeContext } from '../../../src/lib/normalize-result.js';

const ctx: NormalizeContext = {
  ruleId: 'test-rule',
  ruleSource: 'src/RULES.md',
  projectRoot: '/home/user/project',
};

describe('normalizeResult', () => {
  describe('passthrough for non-objects', () => {
    it('returns strings unchanged', () => {
      expect(normalizeResult('hello', ctx)).toBe('hello');
    });

    it('returns null unchanged', () => {
      expect(normalizeResult(null, ctx)).toBeNull();
    });

    it('returns arrays unchanged', () => {
      expect(normalizeResult([1, 2], ctx)).toEqual([1, 2]);
    });
  });

  describe('status normalization', () => {
    it('lowercases status', () => {
      const result = normalizeResult(
        { status: 'PASS', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'pass');
    });

    it('maps "Pass" to "pass"', () => {
      const result = normalizeResult(
        { status: 'Pass', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'pass');
    });

    it('maps "passed" to "pass"', () => {
      const result = normalizeResult(
        { status: 'passed', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'pass');
    });

    it('maps "success" to "pass"', () => {
      const result = normalizeResult(
        { status: 'success', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'pass');
    });

    it('maps "ok" to "pass"', () => {
      const result = normalizeResult(
        { status: 'ok', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'pass');
    });

    it('maps "failed" to "fail"', () => {
      const result = normalizeResult(
        { status: 'failed', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'fail');
    });

    it('maps "error" to "fail"', () => {
      const result = normalizeResult(
        { status: 'error', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'fail');
    });

    it('maps "violation" to "fail"', () => {
      const result = normalizeResult(
        { status: 'violation', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'fail');
    });

    it('maps "warning" to "warn"', () => {
      const result = normalizeResult(
        { status: 'warning', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'warn');
    });

    it('maps "FAIL" to "fail"', () => {
      const result = normalizeResult(
        { status: 'FAIL', rule: 'r', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('status', 'fail');
    });
  });

  describe('rule field normalization', () => {
    it('uses ruleId alias', () => {
      const result = normalizeResult(
        { status: 'pass', ruleId: 'my-rule', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('rule', 'my-rule');
      expect(result).not.toHaveProperty('ruleId');
    });

    it('uses ruleName alias', () => {
      const result = normalizeResult(
        { status: 'pass', ruleName: 'My Rule', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('rule', 'My Rule');
    });

    it('uses rule_name alias', () => {
      const result = normalizeResult(
        { status: 'pass', rule_name: 'My Rule', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('rule', 'My Rule');
    });

    it('injects rule from context if missing', () => {
      const result = normalizeResult({ status: 'pass', source: 's' }, ctx);
      expect(result).toHaveProperty('rule', 'test-rule');
    });

    it('does not overwrite existing rule', () => {
      const result = normalizeResult(
        { status: 'pass', rule: 'original', source: 's' },
        ctx,
      );
      expect(result).toHaveProperty('rule', 'original');
    });
  });

  describe('source field normalization', () => {
    it('uses ruleSource alias', () => {
      const result = normalizeResult(
        { status: 'pass', rule: 'r', ruleSource: 'src/RULES.md' },
        ctx,
      );
      expect(result).toHaveProperty('source', 'src/RULES.md');
      expect(result).not.toHaveProperty('ruleSource');
    });

    it('uses source_file alias', () => {
      const result = normalizeResult(
        { status: 'pass', rule: 'r', source_file: 'src/RULES.md' },
        ctx,
      );
      expect(result).toHaveProperty('source', 'src/RULES.md');
    });

    it('injects source from context if missing', () => {
      const result = normalizeResult({ status: 'pass', rule: 'r' }, ctx);
      expect(result).toHaveProperty('source', 'src/RULES.md');
    });

    it('normalizes backslashes in source', () => {
      const result = normalizeResult(
        { status: 'pass', rule: 'r', source: 'src\\RULES.md' },
        ctx,
      );
      expect(result).toHaveProperty('source', 'src/RULES.md');
    });
  });

  describe('headline normalization', () => {
    it('uses title alias', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          title: 'Issue found',
          comments: [{ message: 'm' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('headline', 'Issue found');
      expect(result).not.toHaveProperty('title');
    });

    it('uses summary alias', () => {
      const result = normalizeResult(
        {
          status: 'fail',
          rule: 'r',
          source: 's',
          summary: 'Bad code',
          comments: [{ message: 'm' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('headline', 'Bad code');
    });

    it('synthesizes headline from first comment if missing', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          comments: [{ message: 'First issue detail' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('headline', 'First issue detail');
    });

    it('truncates synthesized headline to 120 chars', () => {
      const longMessage = 'A'.repeat(200);
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          comments: [{ message: longMessage }],
        },
        ctx,
      );
      const headline = (result as Record<string, unknown>)['headline'];
      expect(typeof headline).toBe('string');
      expect((headline as string).length).toBe(120);
      expect((headline as string).endsWith('...')).toBe(true);
    });
  });

  describe('comments normalization', () => {
    it('uses "comment" alias (array)', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comment: [{ message: 'detail' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('comments');
      const comments = (result as Record<string, unknown>)['comments'];
      expect(Array.isArray(comments)).toBe(true);
    });

    it('uses "violations" alias', () => {
      const result = normalizeResult(
        {
          status: 'fail',
          rule: 'r',
          source: 's',
          headline: 'h',
          violations: [{ message: 'bad' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('comments');
      expect(result).not.toHaveProperty('violations');
    });

    it('uses "issues" alias', () => {
      const result = normalizeResult(
        {
          status: 'fail',
          rule: 'r',
          source: 's',
          headline: 'h',
          issues: [{ message: 'bad' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('comments');
    });

    it('wraps single comment object in array', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: { message: 'single' },
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)['comments'];
      expect(comments).toEqual([{ message: 'single' }]);
    });

    it('converts string array to message objects', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: ['issue one', 'issue two'],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)['comments'];
      expect(comments).toEqual([
        { message: 'issue one' },
        { message: 'issue two' },
      ]);
    });

    it('downgrades warn with empty comments to pass', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [],
        },
        ctx,
      );
      expect(result).toHaveProperty('status', 'pass');
    });

    it('does not downgrade fail with empty comments', () => {
      const result = normalizeResult(
        {
          status: 'fail',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [],
        },
        ctx,
      );
      expect(result).toHaveProperty('status', 'fail');
    });
  });

  describe('comment field normalization', () => {
    it('resolves "text" alias to "message"', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ text: 'detail' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('message', 'detail');
      expect(comments[0]).not.toHaveProperty('text');
    });

    it('resolves "detail" alias to "message"', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ detail: 'info' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('message', 'info');
    });

    it('adds placeholder message if missing', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ file: 'foo.ts', line: 5 }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('message', '(no message)');
    });
  });

  describe('comment file normalization', () => {
    it('resolves "path" alias to "file"', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', path: 'foo.ts' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('file', 'foo.ts');
      expect(comments[0]).not.toHaveProperty('path');
    });

    it('resolves "filePath" alias', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', filePath: 'foo.ts' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('file', 'foo.ts');
    });

    it('normalizes backslashes in file paths', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', file: 'src\\lib\\foo.ts' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('file', 'src/lib/foo.ts');
    });

    it('strips absolute project root prefix', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', file: '/home/user/project/src/foo.ts' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('file', 'src/foo.ts');
    });
  });

  describe('comment line normalization', () => {
    it('coerces string line to number', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line: '42' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 42);
    });

    it('resolves "lineNumber" alias', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', lineNumber: 10 }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 10);
      expect(comments[0]).not.toHaveProperty('lineNumber');
    });

    it('resolves "line_number" alias', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line_number: 10 }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 10);
    });

    it('clamps line 0 to 1', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line: 0 }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 1);
    });

    it('clamps negative line to 1', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line: -5 }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 1);
    });

    it('floors float line to int', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line: 42.7 }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 42);
    });

    it('takes start of range string', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line: '10-15' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).toHaveProperty('line', 10);
    });

    it('removes non-numeric line values', () => {
      const result = normalizeResult(
        {
          status: 'warn',
          rule: 'r',
          source: 's',
          headline: 'h',
          comments: [{ message: 'm', line: 'near the top' }],
        },
        ctx,
      );
      const comments = (result as Record<string, unknown>)[
        'comments'
      ] as Record<string, unknown>[];
      expect(comments[0]).not.toHaveProperty('line');
    });
  });

  describe('pass-only comment field', () => {
    it('extracts message from array comment on pass', () => {
      const result = normalizeResult(
        {
          status: 'pass',
          rule: 'r',
          source: 's',
          comment: [{ message: 'all good' }],
        },
        ctx,
      );
      expect(result).toHaveProperty('comment', 'all good');
    });

    it('extracts string from array comment on pass', () => {
      const result = normalizeResult(
        {
          status: 'pass',
          rule: 'r',
          source: 's',
          comment: ['all good'],
        },
        ctx,
      );
      expect(result).toHaveProperty('comment', 'all good');
    });

    it('accepts "comments" string alias on pass', () => {
      const result = normalizeResult(
        {
          status: 'pass',
          rule: 'r',
          source: 's',
          comments: 'Looks good to me',
        },
        ctx,
      );
      expect(result).toHaveProperty('comment', 'Looks good to me');
      expect(result).not.toHaveProperty('comments');
    });
  });

  describe('combined normalization', () => {
    it('fixes multiple issues at once', () => {
      const result = normalizeResult(
        {
          status: 'FAIL',
          ruleName: 'No Console Log',
          ruleSource: 'src\\RULES.md',
          title: 'Console log found',
          violations: [
            {
              text: 'Found console.log',
              filePath: '/home/user/project/src/foo.ts',
              lineNumber: '42',
            },
          ],
        },
        ctx,
      ) as Record<string, unknown>;

      expect(result['status']).toBe('fail');
      expect(result['rule']).toBe('No Console Log');
      expect(result['source']).toBe('src/RULES.md');
      expect(result['headline']).toBe('Console log found');
      const comments = result['comments'] as Record<string, unknown>[];
      expect(comments).toHaveLength(1);
      const first = comments[0];
      expect(first).toBeDefined();
      expect(first?.['message']).toBe('Found console.log');
      expect(first?.['file']).toBe('src/foo.ts');
      expect(first?.['line']).toBe(42);
    });
  });
});
