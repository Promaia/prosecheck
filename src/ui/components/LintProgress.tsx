import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { RuleResult } from '../../lib/config-schema.js';

/** Per-rule run status as it progresses through the pipeline. */
export type RuleRunStatus = 'waiting' | 'running' | 'done' | 'cached';

export interface RuleProgressEntry {
  /** Stable rule ID */
  ruleId: string;
  /** Human-readable rule name */
  name: string;
  /** Current execution status */
  runStatus: RuleRunStatus;
  /** Agent result (only present when runStatus is 'done') */
  result?: RuleResult | undefined;
  /** Timestamp when the rule started running */
  startedAt?: number | undefined;
}

export interface LintProgressProps {
  /** Progress entries for all triggered rules */
  rules: RuleProgressEntry[];
}

const STATUS_WIDTH = 6;
const MIN_RULE_WIDTH = 20;

function pad(
  s: string,
  width: number,
  align: 'left' | 'center' = 'left',
): string {
  if (s.length >= width) return s.slice(0, width);
  if (align === 'center') {
    const leftPad = Math.floor((width - s.length) / 2);
    return ' '.repeat(leftPad) + s + ' '.repeat(width - s.length - leftPad);
  }
  return s + ' '.repeat(width - s.length);
}

function statusColor(runStatus: RuleRunStatus, result?: RuleResult): string {
  if (runStatus === 'waiting') return 'gray';
  if (runStatus === 'running') return 'cyan';
  if (runStatus === 'cached') return 'cyan';
  if (!result) return 'magenta';
  switch (result.status) {
    case 'pass':
      return 'green';
    case 'warn':
      return 'yellow';
    case 'fail':
      return 'red';
  }
}

function getStatusText(entry: RuleProgressEntry, now: number): string {
  if (entry.runStatus === 'waiting') return 'WAIT';
  if (entry.runStatus === 'running') {
    if (entry.startedAt != null) {
      const elapsed = (now - entry.startedAt) / 1000;
      return elapsed.toFixed(1) + 's';
    }
    return '..';
  }
  if (entry.runStatus === 'cached') return 'CACHED';
  if (!entry.result) return 'DROP';
  switch (entry.result.status) {
    case 'pass':
      return 'PASS';
    case 'warn':
      return 'WARN';
    case 'fail':
      return 'FAIL';
  }
}

/**
 * Live table showing each rule's name and run status with a
 * box-drawing border and running timer for in-progress rules.
 */
export function LintProgress({ rules }: LintProgressProps): React.ReactElement {
  const [now, setNow] = useState(Date.now());
  const hasRunning = rules.some((r) => r.runStatus === 'running');

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => {
      clearInterval(id);
    };
  }, [hasRunning]);

  if (rules.length === 0) {
    return <Box />;
  }

  const ruleWidth = Math.max(
    MIN_RULE_WIDTH,
    ...rules.map((r) => r.name.length),
  );
  const sCol = STATUS_WIDTH + 2;
  const rCol = ruleWidth + 2;

  const topBorder = `┌${'─'.repeat(sCol)}┬${'─'.repeat(rCol)}┐`;
  const headerSep = `├${'─'.repeat(sCol)}┼${'─'.repeat(rCol)}┤`;
  const bottomBorder = `└${'─'.repeat(sCol)}┴${'─'.repeat(rCol)}┘`;

  return (
    <Box flexDirection="column">
      <Text>{topBorder}</Text>
      <Text>
        {'│ '}
        {pad('STATUS', STATUS_WIDTH, 'center')}
        {' │ '}
        {pad('RULE', ruleWidth)}
        {' │'}
      </Text>
      <Text>{headerSep}</Text>
      {rules.map((entry) => {
        const statusText = getStatusText(entry, now);
        const color = statusColor(entry.runStatus, entry.result);
        const align: 'left' | 'center' =
          entry.runStatus === 'running' ? 'center' : 'left';
        return (
          <Text key={entry.ruleId}>
            {'│ '}
            <Text color={color} bold>
              {pad(statusText, STATUS_WIDTH, align)}
            </Text>
            {' │ '}
            {pad(entry.name, ruleWidth)}
            {' │'}
          </Text>
        );
      })}
      <Text>{bottomBorder}</Text>
    </Box>
  );
}
