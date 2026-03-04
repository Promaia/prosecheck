import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Summary } from '../../../src/ui/components/Summary.js';
import type { CollectResultsOutput } from '../../../src/lib/results.js';

function makeResults(
  overrides: Partial<CollectResultsOutput> = {},
): CollectResultsOutput {
  return {
    results: [],
    dropped: [],
    errors: [],
    overallStatus: 'pass',
    ...overrides,
  };
}

function getFrame(instance: ReturnType<typeof render>): string {
  const frame = instance.lastFrame();
  expect(frame).toBeDefined();
  return frame ?? '';
}

describe('Summary', () => {
  it('renders total rule count', () => {
    const results = makeResults({
      results: [
        {
          ruleId: 'a',
          result: { status: 'pass', rule: 'A', source: 'RULES.md' },
        },
        {
          ruleId: 'b',
          result: { status: 'pass', rule: 'B', source: 'RULES.md' },
        },
      ],
    });

    const frame = getFrame(render(<Summary results={results} />));

    expect(frame).toContain('2 rules');
  });

  it('renders pass count', () => {
    const results = makeResults({
      results: [
        {
          ruleId: 'a',
          result: { status: 'pass', rule: 'A', source: 'RULES.md' },
        },
      ],
    });

    expect(getFrame(render(<Summary results={results} />))).toContain(
      '1 passed',
    );
  });

  it('renders warn count', () => {
    const results = makeResults({
      results: [
        {
          ruleId: 'a',
          result: {
            status: 'warn',
            rule: 'A',
            source: 'RULES.md',
            headline: 'h',
            comments: [{ message: 'm' }],
          },
        },
      ],
      overallStatus: 'warn',
    });

    expect(getFrame(render(<Summary results={results} />))).toContain(
      '1 warned',
    );
  });

  it('renders fail count', () => {
    const results = makeResults({
      results: [
        {
          ruleId: 'a',
          result: {
            status: 'fail',
            rule: 'A',
            source: 'RULES.md',
            headline: 'h',
            comments: [{ message: 'm' }],
          },
        },
      ],
      overallStatus: 'fail',
    });

    expect(getFrame(render(<Summary results={results} />))).toContain(
      '1 failed',
    );
  });

  it('renders dropped count', () => {
    const results = makeResults({
      dropped: [
        {
          rule: {
            id: 'a',
            name: 'A',
            description: '',
            inclusions: [],
            source: 'RULES.md',
          },
          attempt: 1,
        },
      ],
      overallStatus: 'dropped',
    });

    expect(getFrame(render(<Summary results={results} />))).toContain(
      '1 dropped',
    );
  });

  it('renders error count', () => {
    const results = makeResults({
      errors: [{ ruleId: 'a', ruleName: 'A', message: 'bad json' }],
      overallStatus: 'fail',
    });

    expect(getFrame(render(<Summary results={results} />))).toContain(
      '1 errors',
    );
  });

  it('renders overall PASS status', () => {
    const results = makeResults({ overallStatus: 'pass' });

    expect(getFrame(render(<Summary results={results} />))).toContain('PASS');
  });

  it('renders overall FAIL status', () => {
    const results = makeResults({ overallStatus: 'fail' });

    expect(getFrame(render(<Summary results={results} />))).toContain('FAIL');
  });

  it('renders mixed results summary', () => {
    const results = makeResults({
      results: [
        {
          ruleId: 'a',
          result: { status: 'pass', rule: 'A', source: 'RULES.md' },
        },
        {
          ruleId: 'b',
          result: {
            status: 'fail',
            rule: 'B',
            source: 'RULES.md',
            headline: 'h',
            comments: [{ message: 'm' }],
          },
        },
      ],
      dropped: [
        {
          rule: {
            id: 'c',
            name: 'C',
            description: '',
            inclusions: [],
            source: 'RULES.md',
          },
          attempt: 1,
        },
      ],
      overallStatus: 'fail',
    });

    const frame = getFrame(render(<Summary results={results} />));

    expect(frame).toContain('3 rules');
    expect(frame).toContain('1 passed');
    expect(frame).toContain('1 failed');
    expect(frame).toContain('1 dropped');
    expect(frame).toContain('FAIL');
  });
});
