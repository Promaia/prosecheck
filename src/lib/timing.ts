import { watch } from 'node:fs';
import path from 'node:path';

const TIMING_DIR = '.prosecheck/working/timing';
const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface RuleTiming {
  ruleId: string;
  /** When the agent started processing this rule (ms since epoch) */
  startedAt?: number | undefined;
  /** When the output file appeared (ms since epoch) */
  completedAt?: number | undefined;
  /** Duration in milliseconds (completedAt - startedAt) */
  durationMs?: number | undefined;
}

/**
 * Track per-rule timing by watching for start markers and output files.
 *
 * Start markers: `.prosecheck/working/timing/<rule-id>.started`
 *   Written by agents before they begin processing each rule.
 *   For one-to-one invocations, `markStart()` is called programmatically.
 *
 * Completion: `.prosecheck/working/outputs/<rule-id>.json`
 *   The normal output file — its appearance marks the end of processing.
 */
export class TimingTracker {
  private starts = new Map<string, number>();
  private completions = new Map<string, number>();
  private watchers: ReturnType<typeof watch>[] = [];

  constructor(projectRoot: string) {
    const timingDir = path.join(projectRoot, TIMING_DIR);
    const outputsDir = path.join(projectRoot, OUTPUTS_DIR);

    // Watch timing dir for .started files
    try {
      const tw = watch(timingDir, (_, filename) => {
        if (!filename || !filename.endsWith('.started')) return;
        const ruleId = filename.slice(0, -'.started'.length);
        if (!this.starts.has(ruleId)) {
          this.starts.set(ruleId, Date.now());
        }
      });
      this.watchers.push(tw);
    } catch {
      // Directory may not exist yet — that's fine
    }

    // Watch outputs dir for .json files
    try {
      const ow = watch(outputsDir, (_, filename) => {
        if (!filename || !filename.endsWith('.json')) return;
        const ruleId = filename.slice(0, -'.json'.length);
        if (!this.completions.has(ruleId)) {
          this.completions.set(ruleId, Date.now());
        }
      });
      this.watchers.push(ow);
    } catch {
      // Directory may not exist yet — that's fine
    }
  }

  /** Programmatically mark a rule as started (for one-to-one invocations). */
  markStart(ruleId: string): void {
    if (!this.starts.has(ruleId)) {
      this.starts.set(ruleId, Date.now());
    }
  }

  /** Get timing data for all observed rules. */
  getTimings(): Map<string, RuleTiming> {
    const timings = new Map<string, RuleTiming>();
    const allRuleIds = new Set([
      ...this.starts.keys(),
      ...this.completions.keys(),
    ]);

    for (const ruleId of allRuleIds) {
      const startedAt = this.starts.get(ruleId);
      const completedAt = this.completions.get(ruleId);
      const durationMs =
        startedAt !== undefined && completedAt !== undefined
          ? completedAt - startedAt
          : undefined;
      timings.set(ruleId, { ruleId, startedAt, completedAt, durationMs });
    }

    return timings;
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
