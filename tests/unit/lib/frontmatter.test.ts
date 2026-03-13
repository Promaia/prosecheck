import { describe, it, expect, vi } from 'vitest';
import {
  parseFrontmatter,
  extractGroupFromFrontmatter,
  extractRuleMetadata,
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

  it('returns empty data on invalid YAML and warns with source', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const content = '---\n: : invalid: yaml: [[\n---\n# My Rule';
    const result = parseFrontmatter(content, 'src/RULES.md');
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('invalid YAML frontmatter in src/RULES.md'),
    );
    spy.mockRestore();
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

describe('extractRuleMetadata', () => {
  it('returns plain description when no frontmatter present', () => {
    const lines = ['', 'Some description.', 'More text.'];
    const result = extractRuleMetadata(lines);
    expect(result.group).toBeUndefined();
    expect(result.frontmatter).toBeUndefined();
    expect(result.description).toBe('Some description.\nMore text.');
  });

  it('extracts group from frontmatter block', () => {
    const lines = ['---', 'group: perf', '---', 'Description.'];
    const result = extractRuleMetadata(lines);
    expect(result.group).toBe('perf');
    expect(result.frontmatter).toBeUndefined();
    expect(result.description).toBe('Description.');
  });

  it('extracts group and passthrough fields', () => {
    const lines = ['---', 'group: perf', 'severity: warn', '---', 'Desc.'];
    const result = extractRuleMetadata(lines);
    expect(result.group).toBe('perf');
    expect(result.frontmatter).toEqual({ severity: 'warn' });
    expect(result.description).toBe('Desc.');
  });

  it('skips leading blank lines before frontmatter', () => {
    const lines = ['', '', '---', 'group: style', '---', 'Desc.'];
    const result = extractRuleMetadata(lines);
    expect(result.group).toBe('style');
    expect(result.description).toBe('Desc.');
  });

  it('returns empty description for frontmatter-only content', () => {
    const lines = ['---', 'group: perf', '---'];
    const result = extractRuleMetadata(lines);
    expect(result.group).toBe('perf');
    expect(result.description).toBe('');
  });

  it('handles empty lines array', () => {
    const result = extractRuleMetadata([]);
    expect(result.group).toBeUndefined();
    expect(result.frontmatter).toBeUndefined();
    expect(result.description).toBe('');
  });

  it('extracts model from frontmatter', () => {
    const lines = ['---', 'model: haiku', '---', 'Description.'];
    const result = extractRuleMetadata(lines);
    expect(result.model).toBe('haiku');
    expect(result.description).toBe('Description.');
  });

  it('does not include model in the passthrough frontmatter bag', () => {
    const lines = [
      '---',
      'group: perf',
      'model: opus',
      'severity: warn',
      '---',
      'Desc.',
    ];
    const result = extractRuleMetadata(lines);
    expect(result.group).toBe('perf');
    expect(result.model).toBe('opus');
    expect(result.frontmatter).toEqual({ severity: 'warn' });
    expect(result.frontmatter).not.toHaveProperty('model');
  });

  it('returns undefined model when not present', () => {
    const lines = ['---', 'group: style', '---', 'Desc.'];
    const result = extractRuleMetadata(lines);
    expect(result.model).toBeUndefined();
  });
});
