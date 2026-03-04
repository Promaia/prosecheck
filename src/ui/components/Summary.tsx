import React from 'react';
import { Box, Text } from 'ink';
import type { CollectResultsOutput } from '../../lib/results.js';

export interface SummaryProps {
  /** Collected results from the engine */
  results: CollectResultsOutput;
}

/**
 * Final results summary after all rules have been evaluated.
 * Shows pass/warn/fail/dropped counts and overall status.
 */
export function Summary({ results }: SummaryProps): React.ReactElement {
  const passed = results.results.filter(
    (r) => r.result.status === 'pass',
  ).length;
  const warned = results.results.filter(
    (r) => r.result.status === 'warn',
  ).length;
  const failed = results.results.filter(
    (r) => r.result.status === 'fail',
  ).length;
  const droppedCount = results.dropped.length;
  const errorCount = results.errors.length;
  const total = results.results.length + droppedCount + errorCount;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text bold>{total} rules</Text>
        <Text dimColor>|</Text>
        {passed > 0 && (
          <StatusCount count={passed} label="passed" color="green" />
        )}
        {warned > 0 && (
          <StatusCount count={warned} label="warned" color="yellow" />
        )}
        {failed > 0 && (
          <StatusCount count={failed} label="failed" color="red" />
        )}
        {droppedCount > 0 && (
          <StatusCount count={droppedCount} label="dropped" color="magenta" />
        )}
        {errorCount > 0 && (
          <StatusCount count={errorCount} label="errors" color="red" />
        )}
      </Box>
      <Box marginTop={1}>
        <Text bold>Status: </Text>
        <OverallStatusText status={results.overallStatus} />
      </Box>
    </Box>
  );
}

function StatusCount({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}): React.ReactElement {
  return (
    <>
      <Text color={color}>
        {count} {label}
      </Text>
      <Text dimColor>|</Text>
    </>
  );
}

function OverallStatusText({ status }: { status: string }): React.ReactElement {
  switch (status) {
    case 'pass':
      return <Text color="green">PASS</Text>;
    case 'warn':
      return <Text color="yellow">WARN</Text>;
    case 'fail':
      return <Text color="red">FAIL</Text>;
    case 'dropped':
      return <Text color="magenta">DROPPED</Text>;
    default:
      return <Text>{status.toUpperCase()}</Text>;
  }
}
