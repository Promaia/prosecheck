import React, { useState, useCallback, useEffect } from 'react';
import { Box } from 'ink';
import { LintProgress } from './components/LintProgress.js';
import { Summary } from './components/Summary.js';
import type { RuleProgressEntry } from './components/LintProgress.js';
import type { CollectResultsOutput } from '../lib/results.js';
import type { ProgressEvent } from '../types/index.js';

export interface LintAppProps {
  /** Final collected results — shown after all rules complete */
  finalResults?: CollectResultsOutput | undefined;
}

/**
 * Top-level Ink app that composes LintProgress and Summary.
 *
 * Exposes an imperative `handleProgress` callback via a ref-like pattern:
 * the parent calls `useLintAppUpdater()` to get the handler, then passes
 * progress events from the engine.
 */
export function LintApp({ finalResults }: LintAppProps): React.ReactElement {
  const { entries } = useLintAppState();

  return (
    <Box flexDirection="column">
      <LintProgress rules={entries} />
      {finalResults ? <Summary results={finalResults} /> : null}
    </Box>
  );
}

// --- State management hook (shared via module-level ref) ---

type EntriesMap = Map<string, RuleProgressEntry>;

/** Module-level ref for the state updater so the render wrapper can push events */
let globalDispatch: ((event: ProgressEvent) => void) | undefined;

/**
 * Get the progress event handler. Call this after rendering the LintApp
 * to get a function you can pass as `onProgress` to the engine.
 */
export function getProgressHandler(): ((event: ProgressEvent) => void) | undefined {
  return globalDispatch;
}

function useLintAppState(): { entries: RuleProgressEntry[] } {
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

  // Register the handler globally so the render wrapper can access it
  useEffect(() => {
    globalDispatch = handleProgress;
    return () => {
      globalDispatch = undefined;
    };
  }, [handleProgress]);

  // Convert map to sorted array (insertion order)
  const entries = Array.from(entriesMap.values());

  return { entries };
}
