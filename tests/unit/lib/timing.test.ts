import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TimingTracker } from '../../../src/lib/timing.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-timing-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(tmpDir, '.prosecheck/working/timing'), {
    recursive: true,
  });
  await mkdir(path.join(tmpDir, '.prosecheck/working/outputs'), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('TimingTracker', () => {
  it('records programmatic start via markStart', () => {
    const tracker = new TimingTracker(tmpDir);
    tracker.markStart('rule-1');
    tracker.stop();

    const timings = tracker.getTimings();
    const t = timings.get('rule-1');
    expect(t).toBeDefined();
    expect(t?.startedAt).toBeTypeOf('number');
    expect(t?.completedAt).toBeUndefined();
    expect(t?.durationMs).toBeUndefined();
  });

  it('does not overwrite existing start time', () => {
    const tracker = new TimingTracker(tmpDir);
    tracker.markStart('rule-1');
    const first = tracker.getTimings().get('rule-1')?.startedAt;

    tracker.markStart('rule-1');
    const second = tracker.getTimings().get('rule-1')?.startedAt;
    tracker.stop();

    expect(first).toBe(second);
  });

  it('detects .started files in timing dir', async () => {
    const tracker = new TimingTracker(tmpDir);

    // Write a .started file
    await writeFile(
      path.join(tmpDir, '.prosecheck/working/timing/rule-2.started'),
      '',
    );

    // Give the watcher a moment to fire
    await new Promise((resolve) => setTimeout(resolve, 200));
    tracker.stop();

    const timings = tracker.getTimings();
    const t = timings.get('rule-2');
    expect(t).toBeDefined();
    expect(t?.startedAt).toBeTypeOf('number');
  });

  it('detects .json files in outputs dir', async () => {
    const tracker = new TimingTracker(tmpDir);

    await writeFile(
      path.join(tmpDir, '.prosecheck/working/outputs/rule-3.json'),
      '{}',
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    tracker.stop();

    const timings = tracker.getTimings();
    const t = timings.get('rule-3');
    expect(t).toBeDefined();
    expect(t?.completedAt).toBeTypeOf('number');
  });

  it('computes duration when both start and completion exist', async () => {
    const tracker = new TimingTracker(tmpDir);
    tracker.markStart('rule-4');

    // Small delay to ensure measurable duration
    await new Promise((resolve) => setTimeout(resolve, 50));

    await writeFile(
      path.join(tmpDir, '.prosecheck/working/outputs/rule-4.json'),
      '{}',
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    tracker.stop();

    const timings = tracker.getTimings();
    const t = timings.get('rule-4');
    expect(t).toBeDefined();
    expect(t?.startedAt).toBeTypeOf('number');
    expect(t?.completedAt).toBeTypeOf('number');
    expect(t?.durationMs).toBeTypeOf('number');
    expect(t?.durationMs).toBeGreaterThan(0);
  });

  it('returns empty map when no events observed', () => {
    const tracker = new TimingTracker(tmpDir);
    tracker.stop();
    expect(tracker.getTimings().size).toBe(0);
  });

  it('ignores non-.started files in timing dir', async () => {
    const tracker = new TimingTracker(tmpDir);

    await writeFile(
      path.join(tmpDir, '.prosecheck/working/timing/rule-5.txt'),
      '',
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    tracker.stop();

    expect(tracker.getTimings().size).toBe(0);
  });

  it('ignores non-.json files in outputs dir', async () => {
    const tracker = new TimingTracker(tmpDir);

    await writeFile(
      path.join(tmpDir, '.prosecheck/working/outputs/rule-6.tmp'),
      '',
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    tracker.stop();

    expect(tracker.getTimings().size).toBe(0);
  });
});
