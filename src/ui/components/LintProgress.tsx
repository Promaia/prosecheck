import React from 'react';
import { Box, Text } from 'ink';
import type { RuleResult } from '../../lib/config-schema.js';

/** Per-rule run status as it progresses through the pipeline. */
export type RuleRunStatus = 'waiting' | 'running' | 'done';

export interface RuleProgressEntry {
  /** Stable rule ID */
  ruleId: string;
  /** Human-readable rule name */
  name: string;
  /** Current execution status */
  runStatus: RuleRunStatus;
  /** Agent result (only present when runStatus is 'done') */
  result?: RuleResult | undefined;
}

export interface LintProgressProps {
  /** Progress entries for all triggered rules */
  rules: RuleProgressEntry[];
}

function statusLabel(runStatus: RuleRunStatus, result?: RuleResult): string {
  if (runStatus === 'waiting') return 'WAIT';
  if (runStatus === 'running') return ' .. ';
  if (!result) return 'DROP';
  switch (result.status) {
    case 'pass':
      return 'PASS';
    case 'warn':
      return 'WARN';
    case 'fail':
      return 'FAIL';
  }
}

function statusColor(
  runStatus: RuleRunStatus,
  result?: RuleResult,
): string {
  if (runStatus === 'waiting') return 'gray';
  if (runStatus === 'running') return 'blue';
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

function resultDetail(result?: RuleResult): string {
  if (!result) return '';
  if (result.status === 'pass') return result.comment ?? '';
  return result.headline;
}

/**
 * Live table showing each rule's name, run status (waiting/running/done),
 * and result as agents complete.
 */
export function LintProgress({ rules }: LintProgressProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {rules.map((entry) => {
        const label = statusLabel(entry.runStatus, entry.result);
        const color = statusColor(entry.runStatus, entry.result);
        const detail = entry.runStatus === 'done' ? resultDetail(entry.result) : '';

        return (
          <Box key={entry.ruleId} gap={1}>
            <Text color={color} bold>{label}</Text>
            <Text>{entry.name}</Text>
            {detail ? <Text dimColor>{detail}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
