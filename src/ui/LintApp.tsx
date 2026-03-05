import React, { useState, useCallback, useEffect } from 'react';
import { Box } from 'ink';
import { LintProgress } from './components/LintProgress.js';
import { Summary } from './components/Summary.js';
import type { RuleProgressEntry } from './components/LintProgress.js';
import type { CollectResultsOutput } from '../lib/results.js';
import type { ProgressEvent } from '../types/index.js';

/** Mutable ref that the component writes its progress handler into. */
export interface ProgressRef {
  current: ((event: ProgressEvent) => void) | undefined;
}

export interface LintAppProps {
  /** Ref that receives the progress handler on mount */
  progressRef: ProgressRef;
  /** Final collected results — shown after all rules complete */
  finalResults?: CollectResultsOutput | undefined;
}

/**
 * Top-level Ink app that composes LintProgress and Summary.
 *
 * Writes its progress handler into `progressRef.current` on mount,
 * scoped to this specific render instance.
 */
export function LintApp({
  progressRef,
  finalResults,
}: LintAppProps): React.ReactElement {
  const { entries } = useLintAppState(progressRef);

  return (
    <Box flexDirection="column">
      <LintProgress rules={entries} />
      {finalResults ? <Summary results={finalResults} /> : null}
    </Box>
  );
}

// --- State management hook ---

type EntriesMap = Map<string, RuleProgressEntry>;

function useLintAppState(progressRef: ProgressRef): {
  entries: RuleProgressEntry[];
} {
  const [entriesMap, setEntriesMap] = useState<EntriesMap>(new Map());

  const handleProgress = useCallback((event: ProgressEvent) => {
    setEntriesMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(event.ruleId);

      switch (event.phase) {
        case 'discovered':
          if (!existing) {
            next.set(event.ruleId, {
              ruleId: event.ruleId,
              name: event.ruleName,
              runStatus: 'waiting',
            });
          }
          break;
        case 'running':
          next.set(event.ruleId, {
            ruleId: event.ruleId,
            name: event.ruleName,
            runStatus: 'running',
            result: existing?.result,
            startedAt: existing?.startedAt ?? Date.now(),
          });
          break;
        case 'result':
          next.set(event.ruleId, {
            ruleId: event.ruleId,
            name: event.ruleName,
            runStatus: 'done',
            result: event.result,
          });
          break;
      }

      return next;
    });
  }, []);

  // Write the handler into the caller's ref
  useEffect(() => {
    progressRef.current = handleProgress;
    return () => {
      progressRef.current = undefined;
    };
  }, [handleProgress, progressRef]);

  // Convert map to sorted array (insertion order)
  const entries = Array.from(entriesMap.values());

  return { entries };
}
