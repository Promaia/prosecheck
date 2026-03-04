import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LintProgress } from '../../../src/ui/components/LintProgress.js';
import type { RuleProgressEntry } from '../../../src/ui/components/LintProgress.js';

function makeEntry(overrides: Partial<RuleProgressEntry> & { ruleId: string }): RuleProgressEntry {
  return {
    name: 'Test Rule',
    runStatus: 'waiting',
    ...overrides,
  };
}

function getFrame(instance: ReturnType<typeof render>): string {
  const frame = instance.lastFrame();
  expect(frame).toBeDefined();
  return frame ?? '';
}

describe('LintProgress', () => {
  it('renders waiting rules with WAIT label', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({ ruleId: 'rule-a', name: 'Rule A', runStatus: 'waiting' }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('WAIT');
    expect(frame).toContain('Rule A');
  });

  it('renders running rules with .. label', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({ ruleId: 'rule-a', name: 'Rule A', runStatus: 'running' }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('..');
    expect(frame).toContain('Rule A');
  });

  it('renders done/pass rules with PASS label', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({
        ruleId: 'rule-a',
        name: 'Rule A',
        runStatus: 'done',
        result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
      }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('PASS');
    expect(frame).toContain('Rule A');
  });

  it('renders done/fail rules with FAIL label and headline', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({
        ruleId: 'rule-a',
        name: 'Rule A',
        runStatus: 'done',
        result: {
          status: 'fail',
          rule: 'Rule A',
          source: 'RULES.md',
          headline: 'Found violations',
          comments: [{ message: 'bad code' }],
        },
      }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('FAIL');
    expect(frame).toContain('Found violations');
  });

  it('renders done/warn rules with WARN label and headline', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({
        ruleId: 'rule-a',
        name: 'Rule A',
        runStatus: 'done',
        result: {
          status: 'warn',
          rule: 'Rule A',
          source: 'RULES.md',
          headline: 'Minor issue',
          comments: [{ message: 'consider fixing' }],
        },
      }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('WARN');
    expect(frame).toContain('Minor issue');
  });

  it('renders done with no result as DROP', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({ ruleId: 'rule-a', name: 'Rule A', runStatus: 'done' }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('DROP');
  });

  it('renders multiple rules in order', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({ ruleId: 'rule-a', name: 'First Rule', runStatus: 'done', result: { status: 'pass', rule: 'First Rule', source: 'RULES.md' } }),
      makeEntry({ ruleId: 'rule-b', name: 'Second Rule', runStatus: 'running' }),
      makeEntry({ ruleId: 'rule-c', name: 'Third Rule', runStatus: 'waiting' }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('PASS');
    expect(frame).toContain('First Rule');
    expect(frame).toContain('..');
    expect(frame).toContain('Second Rule');
    expect(frame).toContain('WAIT');
    expect(frame).toContain('Third Rule');
  });

  it('shows pass comment when present', () => {
    const rules: RuleProgressEntry[] = [
      makeEntry({
        ruleId: 'rule-a',
        name: 'Rule A',
        runStatus: 'done',
        result: { status: 'pass', rule: 'Rule A', source: 'RULES.md', comment: 'All good!' },
      }),
    ];

    const inst = render(<LintProgress rules={rules} />);
    const frame = getFrame(inst);

    expect(frame).toContain('All good!');
  });

  it('updates when rerendered with new status', () => {
    const initial: RuleProgressEntry[] = [
      makeEntry({ ruleId: 'rule-a', name: 'Rule A', runStatus: 'waiting' }),
    ];

    const inst = render(<LintProgress rules={initial} />);
    expect(getFrame(inst)).toContain('WAIT');

    const updated: RuleProgressEntry[] = [
      makeEntry({
        ruleId: 'rule-a',
        name: 'Rule A',
        runStatus: 'done',
        result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
      }),
    ];

    inst.rerender(<LintProgress rules={updated} />);
    expect(getFrame(inst)).toContain('PASS');
  });
});
