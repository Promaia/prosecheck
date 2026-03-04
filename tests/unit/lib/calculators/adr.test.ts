import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { calculateAdr, parseAdr } from '../../../../src/lib/calculators/adr.js';

const fixturesDir = path.resolve(import.meta.dirname, '../../../fixtures');

describe('parseAdr', () => {
  it('extracts rule from ADR with ## Rules heading', () => {
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

    const rule = parseAdr(content, 'docs/adr/002-errors.md');
    expect(rule).toBeDefined();
    expect(rule?.name).toBe('2. Use structured errors');
    expect(rule?.description).toBe('All errors must be AppError instances.');
    expect(rule?.source).toBe('docs/adr/002-errors.md');
    expect(rule?.inclusions).toEqual([]);
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

    const rule = parseAdr(content, 'docs/adr/001-use-zod.md');
    expect(rule).toBeUndefined();
  });

  it('returns undefined for file with no title heading', () => {
    const content = '## Rules\n\nSome rules.\n';
    const rule = parseAdr(content, 'docs/adr/bad.md');
    expect(rule).toBeUndefined();
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

    const rule = parseAdr(content, 'docs/adr/005-logging.md');
    expect(rule?.description).toContain('Never use console.log directly.');
    expect(rule?.description).toContain('Always use the Logger class.');
    expect(rule?.description).toContain('Include structured metadata.');
  });

  it('ADR rules apply project-wide (empty inclusions)', () => {
    const content = '# 1. Test\n\n## Rules\n\nDo the thing.\n';
    const rule = parseAdr(content, 'docs/adr/001.md');
    expect(rule?.inclusions).toEqual([]);
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
    expect(ruleNames).not.toContain('1. Use Zod for all external data validation');
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
