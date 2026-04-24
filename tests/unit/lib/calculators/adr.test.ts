import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { calculateAdr, parseAdr } from '../../../../src/lib/calculators/adr.js';

const fixturesDir = path.resolve(import.meta.dirname, '../../../fixtures');

describe('parseAdr', () => {
  it('extracts single rule from ADR with ## Rules heading (no sub-headings)', () => {
    const content = [
      '# 2. Use structured errors',
      '',
      '## Status',
      '',
      'Accepted',
      '',
      '## Decision',
      '',
      'Use AppError class.',
      '',
      '## Rules',
      '',
      'All errors must be AppError instances.',
      '',
      '## Consequences',
      '',
      'Consistent errors.',
    ].join('\n');

    const rules = parseAdr(content, 'docs/adr/002-errors.md');
    expect(rules).toBeDefined();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.name).toBe('2. Use structured errors');
    expect(rules?.[0]?.description).toBe(
      'All errors must be AppError instances.',
    );
    expect(rules?.[0]?.source).toBe('docs/adr/002-errors.md');
    expect(rules?.[0]?.inclusions).toEqual([]);
  });

  it('returns undefined for ADR without ## Rules heading', () => {
    const content = [
      '# 1. Use Zod',
      '',
      '## Status',
      '',
      'Accepted',
      '',
      '## Decision',
      '',
      'Use Zod for validation.',
    ].join('\n');

    const rules = parseAdr(content, 'docs/adr/001-use-zod.md');
    expect(rules).toBeUndefined();
  });

  it('returns undefined for file with no title heading', () => {
    const content = '## Rules\n\nSome rules.\n';
    const rules = parseAdr(content, 'docs/adr/bad.md');
    expect(rules).toBeUndefined();
  });

  it('captures multi-line rules content', () => {
    const content = [
      '# 5. Logging policy',
      '',
      '## Rules',
      '',
      'Never use console.log directly.',
      'Always use the Logger class.',
      'Include structured metadata.',
      '',
      '## Consequences',
      '',
      'Better observability.',
    ].join('\n');

    const rules = parseAdr(content, 'docs/adr/005-logging.md');
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.description).toContain(
      'Never use console.log directly.',
    );
    expect(rules?.[0]?.description).toContain('Always use the Logger class.');
    expect(rules?.[0]?.description).toContain('Include structured metadata.');
  });

  it('ADR rules apply project-wide (empty inclusions)', () => {
    const content = '# 1. Test\n\n## Rules\n\nDo the thing.\n';
    const rules = parseAdr(content, 'docs/adr/001.md');
    expect(rules?.[0]?.inclusions).toEqual([]);
  });

  it('single-rule ADR honors frontmatter inclusions', () => {
    const content = [
      '# 2. Scope test',
      '',
      '## Rules',
      '',
      '---',
      'inclusions:',
      '  - packages/api/**',
      '---',
      'Narrow rule body.',
    ].join('\n');
    const rules = parseAdr(content, 'docs/adr/002.md');
    expect(rules?.[0]?.inclusions).toEqual(['packages/api/**']);
  });

  it('sub-rule ADR honors per-sub-rule frontmatter inclusions', () => {
    const content = [
      '# 3. Style',
      '',
      '## Rules',
      '',
      '### Narrow',
      '',
      '---',
      'inclusions:',
      '  - packages/web/**',
      '---',
      'Narrow body.',
      '',
      '### Broad',
      '',
      'No frontmatter.',
    ].join('\n');
    const rules = parseAdr(content, 'docs/adr/003.md');
    expect(rules).toHaveLength(2);
    const narrow = rules?.find((r) => r.name === 'Narrow');
    const broad = rules?.find((r) => r.name === 'Broad');
    expect(narrow?.inclusions).toEqual(['packages/web/**']);
    expect(broad?.inclusions).toEqual([]);
  });

  describe('sub-heading rules (### within ## Rules)', () => {
    it('creates separate rules for each ### sub-heading', () => {
      const content = [
        '# 6. Code style',
        '',
        '## Rules',
        '',
        '### No console.log',
        '',
        'Do not use console.log in production code.',
        '',
        '### Keep functions short',
        '',
        'Functions should be under 50 lines.',
        '',
        '## Consequences',
        '',
        'Cleaner code.',
      ].join('\n');

      const rules = parseAdr(content, 'docs/adr/006-style.md');
      expect(rules).toHaveLength(2);
      expect(rules?.[0]?.name).toBe('No console.log');
      expect(rules?.[0]?.description).toBe(
        'Do not use console.log in production code.',
      );
      expect(rules?.[1]?.name).toBe('Keep functions short');
      expect(rules?.[1]?.description).toBe(
        'Functions should be under 50 lines.',
      );
    });

    it('all sub-rules share the same source', () => {
      const content = [
        '# 7. Testing',
        '',
        '## Rules',
        '',
        '### Write unit tests',
        '',
        'All modules must have unit tests.',
        '',
        '### No test pollution',
        '',
        'Tests must not modify shared state.',
      ].join('\n');

      const rules = parseAdr(content, 'docs/adr/007-testing.md');
      expect(rules).toHaveLength(2);
      for (const rule of rules ?? []) {
        expect(rule.source).toBe('docs/adr/007-testing.md');
        expect(rule.inclusions).toEqual([]);
      }
    });

    it('ignores preamble text before the first ### heading', () => {
      const content = [
        '# 8. Security',
        '',
        '## Rules',
        '',
        'The following rules apply to security-sensitive code:',
        '',
        '### Validate all input',
        '',
        'Never trust user input.',
        '',
        '### Use parameterized queries',
        '',
        'Prevent SQL injection.',
      ].join('\n');

      const rules = parseAdr(content, 'docs/adr/008-security.md');
      expect(rules).toHaveLength(2);
      expect(rules?.[0]?.name).toBe('Validate all input');
      expect(rules?.[0]?.description).toBe('Never trust user input.');
    });

    it('extracts per-subrule frontmatter', () => {
      const content = [
        '# 9. Performance',
        '',
        '## Rules',
        '',
        '### No N+1 queries',
        '---',
        'group: perf',
        'severity: warn',
        '---',
        'Batch database queries.',
        '',
        '### Cache expensive calls',
        '---',
        'group: perf',
        'severity: warn',
        '---',
        'Use memoization.',
      ].join('\n');

      const rules = parseAdr(content, 'docs/adr/009-perf.md');
      expect(rules).toHaveLength(2);
      for (const rule of rules ?? []) {
        expect(rule.group).toBe('perf');
        expect(rule.frontmatter).toEqual({ severity: 'warn' });
      }
    });

    it('supports mixed frontmatter and no-frontmatter subrules', () => {
      const content = [
        '# 10. Mixed',
        '',
        '## Rules',
        '',
        '### Grouped rule',
        '---',
        'group: style',
        '---',
        'Description.',
        '',
        '### Ungrouped rule',
        '',
        'No frontmatter here.',
      ].join('\n');

      const rules = parseAdr(content, 'docs/adr/010-mixed.md');
      expect(rules).toHaveLength(2);
      expect(rules?.[0]?.group).toBe('style');
      expect(rules?.[1]?.group).toBeUndefined();
    });
  });
});

describe('calculateAdr', () => {
  it('reads ADR files from project-adr fixture', async () => {
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await calculateAdr(projectRoot);

    // 001-use-zod.md has no ## Rules, 003-api-versioning.md has no ## Rules
    // 002-error-handling.md and 004-logging.md have ## Rules
    expect(rules).toHaveLength(2);
  });

  it('skips ADRs without ## Rules heading', async () => {
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await calculateAdr(projectRoot);

    const ruleNames = rules.map((r) => r.name);
    // 001 and 003 have no ## Rules
    expect(ruleNames).not.toContain(
      '1. Use Zod for all external data validation',
    );
    expect(ruleNames).not.toContain('3. API versioning strategy');
  });

  it('extracts rules from ADRs with ## Rules heading', async () => {
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await calculateAdr(projectRoot);

    const ruleNames = rules.map((r) => r.name);
    expect(ruleNames).toContain('2. Use structured error handling');
    expect(ruleNames).toContain('4. Centralized logging');
  });

  it('uses configured ADR path', async () => {
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await calculateAdr(projectRoot, { path: 'docs/adr' });

    expect(rules.length).toBeGreaterThan(0);
  });

  it('returns empty array when ADR directory does not exist', async () => {
    const projectRoot = path.join(fixturesDir, 'project-simple');
    const rules = await calculateAdr(projectRoot, { path: 'docs/adr' });

    expect(rules).toEqual([]);
  });

  it('sets source to relative path within ADR directory', async () => {
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await calculateAdr(projectRoot);

    for (const rule of rules) {
      expect(rule.source).toMatch(/^docs\/adr\//);
    }
  });
});
