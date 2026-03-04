import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LintApp } from '../../../src/ui/LintApp.js';
import type { ProgressRef } from '../../../src/ui/LintApp.js';
import type { ProgressEvent } from '../../../src/types/index.js';
import type { CollectResultsOutput } from '../../../src/lib/results.js';

function getFrame(instance: ReturnType<typeof render>): string {
  const frame = instance.lastFrame();
  expect(frame).toBeDefined();
  return frame ?? '';
}

function makeRef(): ProgressRef {
  return { current: undefined };
}

function fireProgress(ref: ProgressRef, event: ProgressEvent): void {
  expect(ref.current).toBeDefined();
  ref.current?.(event);
}

describe('LintApp', () => {
  it('renders empty state initially', () => {
    const ref = makeRef();
    const inst = render(<LintApp progressRef={ref} />);
    expect(getFrame(inst)).toBeDefined();
  });

  it('populates progressRef on mount', () => {
    const ref = makeRef();
    render(<LintApp progressRef={ref} />);
    expect(ref.current).toBeDefined();
    expect(typeof ref.current).toBe('function');
  });

  it('shows rules as they are discovered', async () => {
    const ref = makeRef();
    const inst = render(<LintApp progressRef={ref} />);

    fireProgress(ref, { phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });

    await vi.waitFor(() => {
      expect(getFrame(inst)).toContain('WAIT');
    });
    expect(getFrame(inst)).toContain('Rule A');
  });

  it('transitions rules from waiting to running', async () => {
    const ref = makeRef();
    const inst = render(<LintApp progressRef={ref} />);

    fireProgress(ref, { phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress(ref, { phase: 'running', ruleId: 'rule-a', ruleName: 'Rule A' });

    await vi.waitFor(() => {
      expect(getFrame(inst)).toContain('..');
    });
  });

  it('transitions rules from running to done with result', async () => {
    const ref = makeRef();
    const inst = render(<LintApp progressRef={ref} />);

    fireProgress(ref, { phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress(ref, { phase: 'running', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress(ref, {
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
    const ref = makeRef();
    const inst = render(<LintApp progressRef={ref} />);

    fireProgress(ref, { phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress(ref, { phase: 'discovered', ruleId: 'rule-b', ruleName: 'Rule B' });
    fireProgress(ref, {
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
    const ref = makeRef();
    const results: CollectResultsOutput = {
      results: [
        { ruleId: 'rule-a', result: { status: 'pass', rule: 'A', source: 'RULES.md' } },
      ],
      dropped: [],
      errors: [],
      overallStatus: 'pass',
    };

    const inst = render(<LintApp progressRef={ref} finalResults={results} />);

    await vi.waitFor(() => {
      const frame = getFrame(inst);
      expect(frame).toContain('1 rules');
      expect(frame).toContain('PASS');
    });
  });

  it('shows fail result with headline', async () => {
    const ref = makeRef();
    const inst = render(<LintApp progressRef={ref} />);

    fireProgress(ref, { phase: 'discovered', ruleId: 'rule-a', ruleName: 'Rule A' });
    fireProgress(ref, {
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
