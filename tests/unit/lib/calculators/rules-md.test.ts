import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  calculateRulesMd,
  parseRulesMd,
} from '../../../../src/lib/calculators/rules-md.js';

const fixturesDir = path.resolve(import.meta.dirname, '../../../fixtures');

describe('parseRulesMd', () => {
  it('parses a single rule from a heading and description', () => {
    const content = '# No console.log\n\nRemove all console.log statements.\n';
    const rules = parseRulesMd(content, 'RULES.md');

    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('No console.log');
    expect(rules[0]?.description).toBe('Remove all console.log statements.');
    expect(rules[0]?.source).toBe('RULES.md');
  });

  it('parses multiple rules from multiple headings', () => {
    const content = [
      '# Rule One',
      '',
      'Description one.',
      '',
      '# Rule Two',
      '',
      'Description two.',
    ].join('\n');

    const rules = parseRulesMd(content, 'RULES.md');
    expect(rules).toHaveLength(2);
    expect(rules[0]?.name).toBe('Rule One');
    expect(rules[1]?.name).toBe('Rule Two');
  });

  it('includes subheadings in rule description', () => {
    const content = [
      '# Main Rule',
      '',
      'Overview.',
      '',
      '## Details',
      '',
      'More info here.',
    ].join('\n');

    const rules = parseRulesMd(content, 'RULES.md');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.description).toContain('## Details');
    expect(rules[0]?.description).toContain('More info here.');
  });

  it('ignores text before first heading', () => {
    const content = [
      'This is preamble text.',
      '',
      '# Actual Rule',
      '',
      'Rule description.',
    ].join('\n');

    const rules = parseRulesMd(content, 'RULES.md');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('Actual Rule');
    expect(rules[0]?.description).not.toContain('preamble');
  });

  it('sets inclusion to containing directory for nested files', () => {
    const rules = parseRulesMd('# Rule\n\nDesc.', 'src/api/RULES.md');

    expect(rules[0]?.inclusions).toEqual(['src/api/']);
  });

  it('sets empty inclusions for root-level RULES.md', () => {
    const rules = parseRulesMd('# Rule\n\nDesc.', 'RULES.md');

    expect(rules[0]?.inclusions).toEqual([]);
  });

  it('frontmatter inclusions override the directory default', () => {
    const content = [
      '# Narrow Rule',
      '',
      '---',
      'inclusions:',
      '  - packages/api/**',
      '  - "!packages/api/tests/**"',
      '---',
      'Desc.',
    ].join('\n');
    const rules = parseRulesMd(content, 'RULES.md');
    expect(rules[0]?.inclusions).toEqual([
      'packages/api/**',
      '!packages/api/tests/**',
    ]);
  });

  it('frontmatter inclusions also override nested-file default', () => {
    const content = [
      '# Rule',
      '',
      '---',
      'inclusions:',
      '  - packages/web/**',
      '---',
      'Desc.',
    ].join('\n');
    const rules = parseRulesMd(content, 'src/api/RULES.md');
    // The directory default ['src/api/'] must be replaced, not merged.
    expect(rules[0]?.inclusions).toEqual(['packages/web/**']);
  });

  it('falls back to directory default when inclusions absent', () => {
    const content = ['# Rule', '', '---', 'group: g1', '---', 'Desc.'].join(
      '\n',
    );
    const rules = parseRulesMd(content, 'src/api/RULES.md');
    expect(rules[0]?.inclusions).toEqual(['src/api/']);
  });

  it('returns empty array for file with no headings', () => {
    const rules = parseRulesMd('Just some text without headings.', 'RULES.md');

    expect(rules).toEqual([]);
  });

  it('produces empty description when heading is immediately followed by another heading', () => {
    const content = '# Rule One\n# Rule Two\n\nDescription two.';
    const rules = parseRulesMd(content, 'RULES.md');

    expect(rules).toHaveLength(2);
    expect(rules[0]?.name).toBe('Rule One');
    expect(rules[0]?.description).toBe('');
    expect(rules[1]?.name).toBe('Rule Two');
    expect(rules[1]?.description).toBe('Description two.');
  });

  it('generates stable IDs from name and source', () => {
    const rules = parseRulesMd('# No console.log\n\nDesc.', 'src/RULES.md');

    expect(rules[0]?.id).toBe('src-rules-md--no-console-log');
  });

  describe('per-rule frontmatter', () => {
    it('extracts group from rule frontmatter', () => {
      const content = [
        '# No console.log',
        '---',
        'group: perf',
        '---',
        'Remove all console.log statements.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(1);
      expect(rules[0]?.group).toBe('perf');
      expect(rules[0]?.description).toBe('Remove all console.log statements.');
    });

    it('extracts group independently per rule', () => {
      const content = [
        '# Rule One',
        '---',
        'group: perf',
        '---',
        'Description one.',
        '',
        '# Rule Two',
        '',
        'Description two.',
        '',
        '# Rule Three',
        '---',
        'group: style',
        '---',
        'Description three.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(3);
      expect(rules[0]?.group).toBe('perf');
      expect(rules[1]?.group).toBeUndefined();
      expect(rules[2]?.group).toBe('style');
    });

    it('passes through extra frontmatter fields', () => {
      const content = [
        '# My Rule',
        '---',
        'group: perf',
        'severity: warn',
        '---',
        'Description.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules[0]?.group).toBe('perf');
      expect(rules[0]?.frontmatter).toEqual({ severity: 'warn' });
    });

    it('handles frontmatter after a blank line following the heading', () => {
      const content = [
        '# My Rule',
        '',
        '---',
        'group: perf',
        '---',
        'Description.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules[0]?.group).toBe('perf');
      expect(rules[0]?.description).toBe('Description.');
    });

    it('works in section mode with ## headings', () => {
      const content = [
        '# Rules',
        '',
        '## Rule One',
        '---',
        'group: perf',
        '---',
        'Description one.',
        '',
        '## Rule Two',
        '',
        'Description two.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(2);
      expect(rules[0]?.group).toBe('perf');
      expect(rules[1]?.group).toBeUndefined();
    });
  });

  describe('section mode (# Rules header)', () => {
    it('uses ## headings as rule delimiters when first heading is # Rules', () => {
      const content = [
        '# Rules',
        '',
        '## No console.log',
        '',
        'Remove all console.log statements.',
        '',
        '## Use strict mode',
        '',
        'Always enable strict mode.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(2);
      expect(rules[0]?.name).toBe('No console.log');
      expect(rules[0]?.description).toBe('Remove all console.log statements.');
      expect(rules[1]?.name).toBe('Use strict mode');
      expect(rules[1]?.description).toBe('Always enable strict mode.');
    });

    it('ignores preamble between # Rules and first ## heading', () => {
      const content = [
        '# Rules',
        '',
        'These are our project rules.',
        '',
        '## Actual Rule',
        '',
        'Description.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(1);
      expect(rules[0]?.name).toBe('Actual Rule');
      expect(rules[0]?.description).not.toContain('project rules');
    });

    it('includes ### subheadings in rule description in section mode', () => {
      const content = [
        '# Rules',
        '',
        '## Main Rule',
        '',
        'Overview.',
        '',
        '### Details',
        '',
        'More info.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(1);
      expect(rules[0]?.description).toContain('### Details');
      expect(rules[0]?.description).toContain('More info.');
    });

    it('does not trigger section mode for # Rules as a non-first heading', () => {
      const content = [
        '# First Rule',
        '',
        'Description.',
        '',
        '# Rules',
        '',
        'This is another rule named Rules.',
      ].join('\n');

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toHaveLength(2);
      expect(rules[0]?.name).toBe('First Rule');
      expect(rules[1]?.name).toBe('Rules');
    });

    it('does not trigger section mode for ## Rules', () => {
      const content = ['## Rules', '', 'This has no # heading first.'].join(
        '\n',
      );

      const rules = parseRulesMd(content, 'RULES.md');
      expect(rules).toEqual([]);
    });
  });
});

describe('calculateRulesMd', () => {
  it('discovers RULES.md files in project-simple', async () => {
    const projectRoot = path.join(fixturesDir, 'project-simple');
    const rules = await calculateRulesMd(projectRoot);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe(
      'All exported functions must have JSDoc comments',
    );
    expect(rules[0]?.source).toBe('RULES.md');
    expect(rules[0]?.inclusions).toEqual([]);
  });

  it('discovers nested RULES.md files in project-nested', async () => {
    const projectRoot = path.join(fixturesDir, 'project-nested');
    const rules = await calculateRulesMd(projectRoot);

    // Root RULES.md (1 rule) + src/RULES.md (1 rule) + src/api/RULES.md (2 rules)
    expect(rules).toHaveLength(4);

    const ruleNames = rules.map((r) => r.name);
    expect(ruleNames).toContain('No console.log in production code');
    expect(ruleNames).toContain('Use strict TypeScript');
    expect(ruleNames).toContain(
      'Error responses use the shared ApiError class',
    );
    expect(ruleNames).toContain('API routes must validate input with Zod');
  });

  it('excludes paths matching ignore patterns', async () => {
    const projectRoot = path.join(fixturesDir, 'project-nested');
    const rules = await calculateRulesMd(projectRoot, {
      ignore: ['src/api/'],
    });

    // Root RULES.md (1 rule) + src/RULES.md (1 rule), api excluded
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.source).not.toContain('src/api/');
    }
  });

  it('sets correct inclusions for nested RULES.md files', async () => {
    const projectRoot = path.join(fixturesDir, 'project-nested');
    const rules = await calculateRulesMd(projectRoot);

    const rootRule = rules.find(
      (r) => r.name === 'No console.log in production code',
    );
    const srcRule = rules.find((r) => r.name === 'Use strict TypeScript');
    const apiRule = rules.find(
      (r) => r.name === 'Error responses use the shared ApiError class',
    );

    expect(rootRule?.inclusions).toEqual([]);
    expect(srcRule?.inclusions).toEqual(['src/']);
    expect(apiRule?.inclusions).toEqual(['src/api/']);
  });
});
