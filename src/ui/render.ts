import React from 'react';
import { render } from 'ink';
import { LintApp } from './LintApp.js';
import type { ProgressRef } from './LintApp.js';
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
  const progressRef: ProgressRef = { current: undefined };

  const inkInstance = render(
    React.createElement(LintApp, { progressRef }),
  );

  // Ink renders synchronously on first render, so the handler
  // is available in progressRef.current immediately after render().
  const onProgress: OnProgress = (event) => {
    progressRef.current?.(event);
  };

  const finish = (results: CollectResultsOutput): void => {
    inkInstance.rerender(
      React.createElement(LintApp, { progressRef, finalResults: results }),
    );
    inkInstance.unmount();
  };

  const cleanup = (): void => {
    inkInstance.unmount();
  };

  return { onProgress, finish, cleanup };
}
