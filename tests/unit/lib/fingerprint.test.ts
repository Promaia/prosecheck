import { describe, it, expect } from 'vitest';
import { computeRuleFingerprint } from '../../../src/lib/fingerprint.js';
import { createRule } from '../../../src/lib/rule.js';
import type { Rule } from '../../../src/types/index.js';

const inputs = { promptTemplate: 'tpl', globalPrompt: undefined };

function makeRule(overrides: Partial<Rule> = {}): Rule {
  const base = createRule('Rule', 'Desc', ['src/'], 'RULES.md');
  return { ...base, ...overrides };
}

describe('computeRuleFingerprint', () => {
  it('returns the same hash for the same inputs', () => {
    const rule = makeRule();
    expect(computeRuleFingerprint(rule, inputs)).toBe(
      computeRuleFingerprint(rule, inputs),
    );
  });

  it('is independent of inclusion array order', () => {
    const a = makeRule({ inclusions: ['src/', 'test/'] });
    const b = makeRule({ inclusions: ['test/', 'src/'] });
    expect(computeRuleFingerprint(a, inputs)).toBe(
      computeRuleFingerprint(b, inputs),
    );
  });

  it('is independent of frontmatter key insertion order', () => {
    const a = makeRule({ frontmatter: { a: 1, b: 2 } });
    const b = makeRule({ frontmatter: { b: 2, a: 1 } });
    expect(computeRuleFingerprint(a, inputs)).toBe(
      computeRuleFingerprint(b, inputs),
    );
  });

  it('changes when the rule description changes', () => {
    const a = makeRule({ description: 'one' });
    const b = makeRule({ description: 'two' });
    expect(computeRuleFingerprint(a, inputs)).not.toBe(
      computeRuleFingerprint(b, inputs),
    );
  });

  it('changes when inclusions change', () => {
    const a = makeRule({ inclusions: ['src/'] });
    const b = makeRule({ inclusions: ['lib/'] });
    expect(computeRuleFingerprint(a, inputs)).not.toBe(
      computeRuleFingerprint(b, inputs),
    );
  });

  it('changes when the rule model changes', () => {
    const a = makeRule({ model: 'sonnet' });
    const b = makeRule({ model: 'opus' });
    expect(computeRuleFingerprint(a, inputs)).not.toBe(
      computeRuleFingerprint(b, inputs),
    );
  });

  it('changes when the prompt template changes', () => {
    const rule = makeRule();
    const a = computeRuleFingerprint(rule, { ...inputs, promptTemplate: 'a' });
    const b = computeRuleFingerprint(rule, { ...inputs, promptTemplate: 'b' });
    expect(a).not.toBe(b);
  });

  it('changes when the global prompt goes from undefined to defined', () => {
    const rule = makeRule();
    const a = computeRuleFingerprint(rule, {
      ...inputs,
      globalPrompt: undefined,
    });
    const b = computeRuleFingerprint(rule, {
      ...inputs,
      globalPrompt: 'global',
    });
    expect(a).not.toBe(b);
  });

  it('treats undefined model/frontmatter the same on repeated calls', () => {
    const rule = makeRule({ model: undefined, frontmatter: undefined });
    expect(computeRuleFingerprint(rule, inputs)).toBe(
      computeRuleFingerprint(rule, inputs),
    );
  });

  it('returns a 64-character hex SHA-256 digest', () => {
    const rule = makeRule();
    const fp = computeRuleFingerprint(rule, inputs);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
