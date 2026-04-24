import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireRunlock, RunlockHeldError } from '../../../src/lib/runlock.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-runlock-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('acquireRunlock', () => {
  it('writes a lock file with pid/startedAt/host and releases cleanly', async () => {
    const lock = await acquireRunlock(tmpDir);
    expect(lock.path).toBe(path.join(tmpDir, '.prosecheck', '.runlock'));

    const raw = await readFile(lock.path, 'utf-8');
    const info = JSON.parse(raw) as {
      pid: number;
      startedAt: string;
      host: string;
    };
    expect(info.pid).toBe(process.pid);
    expect(info.host).toBe(os.hostname());
    expect(Number.isNaN(Date.parse(info.startedAt))).toBe(false);

    await lock.release();
    await expect(stat(lock.path)).rejects.toThrow();
  });

  it('throws RunlockHeldError when an existing live lock is held', async () => {
    // Write a lock pointing at OUR pid (guaranteed alive).
    const lockDir = path.join(tmpDir, '.prosecheck');
    await mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, '.runlock');
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host: os.hostname(),
      }),
    );

    await expect(acquireRunlock(tmpDir)).rejects.toBeInstanceOf(
      RunlockHeldError,
    );
  });

  it('reclaims a stale lock (pid not running) and calls onStale', async () => {
    const lockDir = path.join(tmpDir, '.prosecheck');
    await mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, '.runlock');
    // Pid 2^31 - 1 is practically guaranteed to be dead.
    const deadPid = 2147483646;
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: deadPid,
        startedAt: new Date().toISOString(),
        host: os.hostname(),
      }),
    );

    const onStale = vi.fn();
    const lock = await acquireRunlock(tmpDir, { onStale });
    expect(onStale).toHaveBeenCalledOnce();
    expect(onStale.mock.calls[0]?.[0]).toMatchObject({ pid: deadPid });

    // Newly acquired lock belongs to us.
    const raw = await readFile(lock.path, 'utf-8');
    expect((JSON.parse(raw) as { pid: number }).pid).toBe(process.pid);

    await lock.release();
  });

  it('treats malformed locks as stale (reclaimable)', async () => {
    const lockDir = path.join(tmpDir, '.prosecheck');
    await mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, '.runlock');
    await writeFile(lockPath, 'not JSON');

    const lock = await acquireRunlock(tmpDir);
    const raw = await readFile(lock.path, 'utf-8');
    expect((JSON.parse(raw) as { pid: number }).pid).toBe(process.pid);
    await lock.release();
  });

  it('force:true bypasses a live lock and warns', async () => {
    const lockDir = path.join(tmpDir, '.prosecheck');
    await mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, '.runlock');
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host: os.hostname(),
      }),
    );
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const lock = await acquireRunlock(tmpDir, { force: true });
    expect(warnSpy).toHaveBeenCalled();
    await lock.release();
  });

  it('RunlockHeldError carries progress count of existing per-rule outputs', async () => {
    const outputsDir = path.join(tmpDir, '.prosecheck', 'working', 'outputs');
    await mkdir(outputsDir, { recursive: true });
    await writeFile(path.join(outputsDir, 'rule-a.json'), '{}');
    await writeFile(path.join(outputsDir, 'rule-b.json'), '{}');
    await writeFile(path.join(outputsDir, 'not-json.txt'), 'ignore me');

    await writeFile(
      path.join(tmpDir, '.prosecheck', '.runlock'),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host: os.hostname(),
      }),
    );

    let caught: unknown;
    try {
      await acquireRunlock(tmpDir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RunlockHeldError);
    expect((caught as RunlockHeldError).progressOutputCount).toBe(2);
  });

  it('release() is idempotent', async () => {
    const lock = await acquireRunlock(tmpDir);
    await lock.release();
    // Second call must not throw even though the file is gone.
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('treats cross-host locks as live', async () => {
    const lockDir = path.join(tmpDir, '.prosecheck');
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      path.join(lockDir, '.runlock'),
      JSON.stringify({
        pid: 1, // any pid — host mismatch short-circuits the probe
        startedAt: new Date().toISOString(),
        host: `${os.hostname()}-not-this-machine`,
      }),
    );

    await expect(acquireRunlock(tmpDir)).rejects.toBeInstanceOf(
      RunlockHeldError,
    );
  });
});
