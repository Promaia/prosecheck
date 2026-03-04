import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LintApp, getProgressHandler } from '../../../src/ui/LintApp.js';
import type { ProgressEvent } from '../../../src/types/index.js';
import type { CollectResultsOutput } from '../../../src/lib/results.js';

function getFrame(instance: ReturnType<typeof render>): string {
  const frame = instance.lastFrame();
  expect(frame).toBeDefined();
  return frame ?? '';
}

function fireProgress(event: ProgressEvent): void {
  const handler = getProgressHandler();
  expect(handler).toBeDefined();
  handler?.(event);
}

describe('LintApp', () => {
  it('renders empty state initially', () => {
    const inst = render(<LintApp />);
    // Should render without crashing, empty progress list
    expect(getFrame(inst)).toBeDefined();
  });

  it('shows rules as they are discovered', async () => {
    const inst = render(<LintApp />);

    fireProgress({ phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });

    // Need to wait for React state update
    await vi.waitFor(() => {
      expect(getFrame(inst)).toContain('WAIT');
    });
    expect(getFrame(inst)).toContain('Rule A');
  });

  it('transitions rules from waiting to running', async () => {
    const inst = render(<LintApp />);

    fireProgress({ phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress({ phase: 'running', ruleId: 'rule-a', ruleName: 'Rule A' });

    await vi.waitFor(() => {
      expect(getFrame(inst)).toContain('..');
    });
  });

  it('transitions rules from running to done with result', async () => {
    const inst = render(<LintApp />);

    fireProgress({ phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress({ phase: 'running', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress({
      phase: 'result',
      ruleId: 'rule-a',
      ruleName: 'Rule A',
      result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
    });

    await vi.waitFor(() => {
      expect(getFrame(inst)).toContain('PASS');
    });
  });

  it('tracks multiple rules independently', async () => {
    const inst = render(<LintApp />);

    fireProgress({ phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress({ phase: 'discovered', ruleId: 'rule-b', ruleName: 'Rule B' });
    fireProgress({
      phase: 'result',
      ruleId: 'rule-a',
      ruleName: 'Rule A',
      result: { status: 'pass', rule: 'Rule A', source: 'RULES.md' },
    });

    await vi.waitFor(() => {
      const frame = getFrame(inst);
      expect(frame).toContain('PASS');
      expect(frame).toContain('WAIT');
    });
  });

  it('shows summary when finalResults are provided', async () => {
    const results: CollectResultsOutput = {
      results: [
        { ruleId: 'rule-a', result: { status: 'pass', rule: 'A', source: 'RULES.md' } },
      ],
      dropped: [],
      errors: [],
      overallStatus: 'pass',
    };

    const inst = render(<LintApp finalResults={results} />);

    await vi.waitFor(() => {
      const frame = getFrame(inst);
      expect(frame).toContain('1 rules');
      expect(frame).toContain('PASS');
    });
  });

  it('shows fail result with headline', async () => {
    const inst = render(<LintApp />);

    fireProgress({ phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress({
      phase: 'result',
      ruleId: 'rule-a',
      ruleName: 'Rule A',
      result: {
        status: 'fail',
        rule: 'Rule A',
        source: 'RULES.md',
        headline: 'Violations found',
        comments: [{ message: 'bad' }],
      },
    });

    await vi.waitFor(() => {
      const frame = getFrame(inst);
      expect(frame).toContain('FAIL');
      expect(frame).toContain('Violations found');
    });
  });
});
