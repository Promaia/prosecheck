import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  extractGroupFromFrontmatter,
} from '../../../src/lib/frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns empty data and full body when no frontmatter present', () => {
    const content = '# My Rule\n\nSome description.';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it('parses valid frontmatter and returns body', () => {
    const content =
      '---\ngroup: perf\nseverity: warn\n---\n# My Rule\n\nDescription.';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({ group: 'perf', severity: 'warn' });
    expect(result.body).toBe('# My Rule\n\nDescription.');
  });

  it('handles empty frontmatter block', () => {
    const content = '---\n---\n# My Rule';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe('# My Rule');
  });

  it('handles frontmatter with only whitespace', () => {
    const content = '---\n  \n---\n# My Rule';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe('# My Rule');
  });

  it('preserves unknown fields', () => {
    const content =
      '---\ngroup: perf\ncustom_field: hello\ntags:\n  - a\n  - b\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({
      group: 'perf',
      custom_field: 'hello',
      tags: ['a', 'b'],
    });
    expect(result.body).toBe('Body');
  });

  it('returns empty data on invalid YAML', () => {
    const content = '---\n: : invalid: yaml: [[\n---\n# My Rule';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it('handles YAML that parses to a non-object (string)', () => {
    const content = '---\njust a string\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe('Body');
  });

  it('handles YAML that parses to an array', () => {
    const content = '---\n- a\n- b\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe('Body');
  });

  it('handles Windows-style line endings', () => {
    const content = '---\r\ngroup: perf\r\n---\r\n# My Rule';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({ group: 'perf' });
    expect(result.body).toBe('# My Rule');
  });

  it('does not match frontmatter that does not start at the beginning', () => {
    const content = '\n---\ngroup: perf\n---\n# My Rule';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });
});

describe('extractGroupFromFrontmatter', () => {
  it('extracts group and returns rest', () => {
    const data = { group: 'perf', severity: 'warn', custom: 42 };
    const result = extractGroupFromFrontmatter(data);
    expect(result.group).toBe('perf');
    expect(result.rest).toEqual({ severity: 'warn', custom: 42 });
  });

  it('returns undefined group when not present', () => {
    const data = { severity: 'warn' };
    const result = extractGroupFromFrontmatter(data);
    expect(result.group).toBeUndefined();
    expect(result.rest).toEqual({ severity: 'warn' });
  });

  it('returns undefined group when group is not a string', () => {
    const data = { group: 42, other: 'val' };
    const result = extractGroupFromFrontmatter(data);
    expect(result.group).toBeUndefined();
    expect(result.rest).toEqual({ other: 'val' });
  });

  it('handles empty data', () => {
    const result = extractGroupFromFrontmatter({});
    expect(result.group).toBeUndefined();
    expect(result.rest).toEqual({});
  });
});
