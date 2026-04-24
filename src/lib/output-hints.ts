import pc from 'picocolors';
import type { CollectResultsOutput } from './results.js';

export interface BuildOutputHintsOptions {
  /** Path passed to `--output`, if any. */
  outputPath?: string | undefined;
  /** Format selected by `--format` (stylish | json | sarif). */
  format: string;
  /** Collected results from the engine. */
  results: CollectResultsOutput;
}

/**
 * Build trailing hint lines to append after the formatted output.
 *
 * Hints are intentionally placed AFTER the summary so that piping
 * `2>&1 | tail -N` with a small N still catches them. Callers whose
 * stdout is a JSON/SARIF feed get no hints so parsers stay clean.
 *
 * Two hints:
 * - `--output <path>` pointer, so callers who truncated stdout know
 *   where the full per-rule content lives (including rule IDs).
 * - Re-run hint listing warn/fail/dropped rule names, so the immediate
 *   next `--rules` call doesn't need to re-grep or re-run the full suite.
 */
export function buildOutputHints(options: BuildOutputHintsOptions): string[] {
  if (options.format !== 'stylish') return [];

  const hints: string[] = [];

  if (options.outputPath !== undefined && options.outputPath.length > 0) {
    hints.push(
      pc.dim(
        `hint: Full output saved to ${options.outputPath} — read this file for per-rule details and rule IDs.`,
      ),
    );
  }

  const attention: string[] = [];
  for (const { result } of options.results.results) {
    if (result.status === 'warn' || result.status === 'fail') {
      attention.push(result.rule);
    }
  }
  for (const { rule } of options.results.dropped) {
    attention.push(rule.name);
  }

  if (attention.length > 0) {
    const quoted = attention.map((n) => `"${n}"`).join(',');
    hints.push(
      pc.dim(
        `hint: To re-run only these rules: prosecheck lint --rules ${quoted}`,
      ),
    );
  }

  return hints;
}
