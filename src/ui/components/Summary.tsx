import React from 'react';
import { Box, Text } from 'ink';
import type { CollectResultsOutput } from '../../lib/results.js';

export interface SummaryProps {
  /** Collected results from the engine */
  results: CollectResultsOutput;
}

/**
 * Final results summary — single line with category counts.
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
  const cachedCount = (results.cached ?? []).length;

  const parts: { count: number; label: string; color: string }[] = [];
  if (failed > 0) parts.push({ count: failed, label: 'failed', color: 'red' });
  if (passed > 0)
    parts.push({ count: passed, label: 'passed', color: 'green' });
  if (warned > 0)
    parts.push({ count: warned, label: 'warned', color: 'yellow' });
  if (droppedCount > 0)
    parts.push({ count: droppedCount, label: 'dropped', color: 'magenta' });
  if (cachedCount > 0)
    parts.push({ count: cachedCount, label: 'cached', color: 'cyan' });
  if (errorCount > 0)
    parts.push({ count: errorCount, label: 'errors', color: 'red' });

  return (
    <Box marginTop={1}>
      {parts.map((part, i) => (
        <React.Fragment key={part.label}>
          {i > 0 ? <Text dimColor> | </Text> : null}
          <Text color={part.color}>
            {part.count} {part.label}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}
