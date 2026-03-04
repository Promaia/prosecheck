import React from 'react';
import { render } from 'ink';
import { LintApp, getProgressHandler } from './LintApp.js';
import type { CollectResultsOutput } from '../lib/results.js';
import type { OnProgress } from '../types/index.js';

export interface InteractiveUI {
  /** Progress callback to pass as `onProgress` on RunContext */
  onProgress: OnProgress;
  /** Show the final summary and unmount */
  finish: (results: CollectResultsOutput) => void;
  /** Clean up without showing summary (e.g., on error) */
  cleanup: () => void;
}

/**
 * Check whether interactive UI should be used.
 *
 * Returns true when stdout is a TTY and the output format is 'stylish'
 * (the human-readable default). JSON/SARIF output and piped stdout
 * should use the existing plain-text path.
 */
export function shouldUseInteractiveUI(format: string): boolean {
  return format === 'stylish' && process.stdout.isTTY;
}

/**
 * Start the interactive Ink UI.
 *
 * Renders the `LintApp` component and returns an updater interface.
 * The caller feeds progress events via `onProgress` and calls `finish()`
 * when the engine completes to show the summary.
 */
export function startInteractiveUI(): InteractiveUI {
  const inkInstance = render(
    React.createElement(LintApp),
  );

  // The LintApp registers its progress handler on mount via useEffect.
  // Since Ink renders synchronously on first render, the handler is
  // available immediately after render().
  const handler = getProgressHandler();

  const onProgress: OnProgress = (event) => {
    handler?.(event);
  };

  const finish = (results: CollectResultsOutput): void => {
    inkInstance.rerender(
      React.createElement(LintApp, { finalResults: results }),
    );
    inkInstance.unmount();
  };

  const cleanup = (): void => {
    inkInstance.unmount();
  };

  return { onProgress, finish, cleanup };
}
