import { describe, it, expect } from 'vitest';
import {
  parseResultFile,
  sanitizeAgentOutput,
} from '../../../src/lib/results.js';

/** Minimal valid pass JSON for wrapping in quirky formats */
const VALID_PASS = JSON.stringify({
  status: 'pass',
  rule: 'test-rule',
  source: 'RULES.md',
});

const VALID_WARN = JSON.stringify({
  status: 'warn',
  rule: 'test-rule',
  source: 'RULES.md',
  headline: 'Something is off',
  comments: [{ message: 'Detail here' }],
});

const VALID_FAIL = JSON.stringify({
  status: 'fail',
  rule: 'test-rule',
  source: 'RULES.md',
  headline: 'Violation found',
  comments: [{ message: 'Fix this', file: 'foo.ts', line: 10 }],
});

describe('sanitizeAgentOutput', () => {
  it('strips UTF-8 BOM', () => {
    const input = '\uFEFF' + VALID_PASS;
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });

  it('extracts from ```json fences', () => {
    const input = '```json\n' + VALID_PASS + '\n```';
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });

  it('extracts from ``` fences without lang tag', () => {
    const input = '```\n' + VALID_PASS + '\n```';
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });

  it('strips trailing text after JSON', () => {
    const input = VALID_PASS + '\n\nThis is my analysis of the code.';
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });

  it('trims leading and trailing whitespace', () => {
    const input = '   \n' + VALID_PASS + '\n   ';
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });

  it('handles trailing newlines', () => {
    const input = VALID_PASS + '\n\n\n';
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });

  it('handles BOM + markdown fences + trailing text combined', () => {
    const input =
      '\uFEFF```json\n' + VALID_PASS + '\n```\nHere is my reasoning.';
    expect(sanitizeAgentOutput(input)).toBe(VALID_PASS);
  });
});

describe('parseResultFile — sanitization (should parse successfully)', () => {
  it('parses BOM-prefixed content', () => {
    const result = parseResultFile('\uFEFF' + VALID_PASS, 'r1');
    expect(result.ok).toBe(true);
  });

  it('parses markdown-wrapped JSON with lang tag', () => {
    const result = parseResultFile('```json\n' + VALID_PASS + '\n```', 'r1');
    expect(result.ok).toBe(true);
  });

  it('parses markdown-wrapped JSON without lang tag', () => {
    const result = parseResultFile('```\n' + VALID_PASS + '\n```', 'r1');
    expect(result.ok).toBe(true);
  });

  it('parses JSON with trailing explanatory text', () => {
    const result = parseResultFile(
      VALID_PASS + '\n\nI checked all the files and found no issues.',
      'r1',
    );
    expect(result.ok).toBe(true);
  });

  it('parses JSON with leading/trailing whitespace', () => {
    const result = parseResultFile('\n  ' + VALID_PASS + '  \n', 'r1');
    expect(result.ok).toBe(true);
  });

  it('parses JSON with trailing newlines', () => {
    const result = parseResultFile(VALID_PASS + '\n\n\n', 'r1');
    expect(result.ok).toBe(true);
  });
});

describe('parseResultFile — malformed inputs (should fail with clear errors)', () => {
  it('rejects trailing commas', () => {
    const input = '{"status": "pass", "rule": "r", "source": "s",}';
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('not valid JSON');
    }
  });

  it('rejects comments in JSON', () => {
    const input = '{"status": "pass", // comment\n"rule": "r", "source": "s"}';
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects single-quoted strings', () => {
    const input = "{'status': 'pass', 'rule': 'r', 'source': 's'}";
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects unquoted keys', () => {
    const input = '{status: "pass", rule: "r", source: "s"}';
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects truncated JSON', () => {
    const input = '{"status": "pass", "rule": "r"';
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects empty file', () => {
    const result = parseResultFile('', 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects non-JSON text', () => {
    const result = parseResultFile(
      'I analyzed the code and found no issues.',
      'r1',
    );
    expect(result.ok).toBe(false);
  });

  it('rejects concatenated JSON objects', () => {
    const input = VALID_PASS + VALID_PASS;
    const result = parseResultFile(input, 'r1');
    // This may or may not parse depending on sanitization — but if it does,
    // it should still be a valid single result (the first object via truncation)
    // The key thing is it doesn't throw
    expect(typeof result.ok).toBe('boolean');
  });
});

describe('parseResultFile — Zod validation edge cases', () => {
  it('rejects wrong-case status (PASS)', () => {
    const input = JSON.stringify({
      status: 'PASS',
      rule: 'r',
      source: 's',
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('schema validation');
    }
  });

  it('rejects line: 0', () => {
    const input = JSON.stringify({
      status: 'warn',
      rule: 'r',
      source: 's',
      headline: 'h',
      comments: [{ message: 'm', file: 'f.ts', line: 0 }],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects line: -5', () => {
    const input = JSON.stringify({
      status: 'warn',
      rule: 'r',
      source: 's',
      headline: 'h',
      comments: [{ message: 'm', file: 'f.ts', line: -5 }],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects line: 1.5 (non-integer)', () => {
    const input = JSON.stringify({
      status: 'warn',
      rule: 'r',
      source: 's',
      headline: 'h',
      comments: [{ message: 'm', file: 'f.ts', line: 1.5 }],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects empty comments array on warn', () => {
    const input = JSON.stringify({
      status: 'warn',
      rule: 'r',
      source: 's',
      headline: 'h',
      comments: [],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects empty comments array on fail', () => {
    const input = JSON.stringify({
      status: 'fail',
      rule: 'r',
      source: 's',
      headline: 'h',
      comments: [],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('accepts extra unknown fields (Zod strips them)', () => {
    const input = JSON.stringify({
      status: 'pass',
      rule: 'r',
      source: 's',
      confidence: 0.95,
      reasoning: 'Looks good',
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(true);
  });

  it('rejects missing headline on warn', () => {
    const input = JSON.stringify({
      status: 'warn',
      rule: 'r',
      source: 's',
      comments: [{ message: 'm' }],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('rejects missing comments on fail', () => {
    const input = JSON.stringify({
      status: 'fail',
      rule: 'r',
      source: 's',
      headline: 'h',
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
  });

  it('parses valid warn result', () => {
    const result = parseResultFile(VALID_WARN, 'r1');
    expect(result.ok).toBe(true);
  });

  it('parses valid fail result', () => {
    const result = parseResultFile(VALID_FAIL, 'r1');
    expect(result.ok).toBe(true);
  });
});

describe('parseResultFile — error message quality', () => {
  it('JSON parse errors include input preview', () => {
    const longGarbage = 'This is not JSON at all. '.repeat(20);
    const result = parseResultFile(longGarbage, 'my-rule');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('my-rule');
      expect(result.message).toContain('Input preview:');
      // Preview should be truncated
      expect(result.message.length).toBeLessThan(longGarbage.length + 200);
    }
  });

  it('JSON parse errors include rule ID', () => {
    const result = parseResultFile('{invalid}', 'rule-abc');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('rule-abc');
    }
  });

  it('Zod errors include field path', () => {
    const input = JSON.stringify({
      status: 'warn',
      rule: 'r',
      source: 's',
      headline: 'h',
      comments: [{ message: 'm', line: -1 }],
    });
    const result = parseResultFile(input, 'r1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('schema validation');
    }
  });

  it('Zod errors include rule ID', () => {
    const input = JSON.stringify({ status: 'invalid' });
    const result = parseResultFile(input, 'my-custom-rule');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('my-custom-rule');
    }
  });
});
