import { readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Runlock lives OUTSIDE of `.prosecheck/working/` because the engine wipes
 * that tree at the start of every run. Keeping the lock one level up means
 * a second caller can inspect the first caller's lock before their own
 * wipe destroys anything.
 */
const RUNLOCK_DIR = '.prosecheck';
const RUNLOCK_FILENAME = '.runlock';
const OUTPUTS_DIR_FROM_PROJECT_ROOT = '.prosecheck/working/outputs';

export interface RunlockInfo {
  pid: number;
  /** ISO-8601 start timestamp */
  startedAt: string;
  /** os.hostname() — cross-host locks are treated as live since we can't probe the pid */
  host: string;
}

/**
 * Thrown when a runlock already exists and is considered live (pid is running
 * on this host, or lock is from a different host).
 */
export class RunlockHeldError extends Error {
  constructor(
    public readonly info: RunlockInfo,
    public readonly progressOutputCount: number,
  ) {
    const age = ageDescription(info.startedAt);
    super(
      `Another prosecheck run is in progress in this working directory.\n` +
        `  pid:        ${String(info.pid)}\n` +
        `  host:       ${info.host}\n` +
        `  started:    ${info.startedAt}${age ? ` (${age})` : ''}\n` +
        `  progress:   ${String(progressOutputCount)} per-rule output file(s) already written\n\n` +
        `Running two lints against the same working directory corrupts shared ` +
        `outputs/, prompts/, and timing/ files. Options:\n` +
        `  • Wait for the other run to finish.\n` +
        `  • Kill it (pid ${String(info.pid)}) and re-run.\n` +
        `  • Bypass with --force (or --ignore-runlock) if you are certain ` +
        `no other prosecheck is active.`,
    );
    this.name = 'RunlockHeldError';
  }
}

export interface AcquireRunlockOptions {
  /** Bypass lock-held check. Logs a warning. */
  force?: boolean | undefined;
  /** Called with stale-lock info when a dead pid is reclaimed. */
  onStale?: ((info: RunlockInfo) => void) | undefined;
}

export interface Runlock {
  /** Remove the lock. Safe to call multiple times. */
  release(): Promise<void>;
  /** Absolute path to the lock file (exposed for tests). */
  readonly path: string;
}

/**
 * Acquire a repo-scoped runlock. Throws `RunlockHeldError` when another
 * live run already holds the lock (unless `force: true`). Otherwise
 * writes `.prosecheck/.runlock` with this process's info, registers
 * SIGINT/SIGTERM handlers that release it, and returns a handle whose
 * `release()` removes the file.
 */
export async function acquireRunlock(
  projectRoot: string,
  options: AcquireRunlockOptions = {},
): Promise<Runlock> {
  const lockPath = path.join(projectRoot, RUNLOCK_DIR, RUNLOCK_FILENAME);

  await mkdir(path.join(projectRoot, RUNLOCK_DIR), { recursive: true });

  const existing = await readLock(lockPath);
  if (existing !== undefined) {
    const alive = isLiveLock(existing);
    if (alive && !options.force) {
      const progress = await countExistingOutputs(projectRoot);
      throw new RunlockHeldError(existing, progress);
    }
    if (!alive) {
      options.onStale?.(existing);
    } else if (options.force) {
      console.error(
        `[prosecheck] Warning: --force bypassing runlock held by pid ${String(existing.pid)} on ${existing.host} (started ${existing.startedAt}).`,
      );
    }
    // Remove stale or force-overridden lock
    await rm(lockPath, { force: true });
  }

  const info: RunlockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
  };
  // `wx` would be ideal but we already deleted the existing file above;
  // the remaining race window is vanishingly small for a local dev tool.
  await writeFile(lockPath, JSON.stringify(info, null, 2), 'utf-8');

  const signalHandler = (): void => {
    // Best-effort sync unlink — Node may not await an async handler before exit.
    try {
      if (existsSync(lockPath)) unlinkSync(lockPath);
    } catch {
      // ignore — the lock will look stale and be reclaimed next run
    }
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    await rm(lockPath, { force: true });
  };

  return {
    release,
    path: lockPath,
  };
}

/** Parse an existing runlock. Returns `undefined` if absent or malformed. */
async function readLock(lockPath: string): Promise<RunlockInfo | undefined> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf-8');
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RunlockInfo>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.host === 'string'
    ) {
      return {
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        host: parsed.host,
      };
    }
  } catch {
    // fall through
  }
  // Malformed lock — treat as stale so we can reclaim.
  return undefined;
}

/**
 * Decide whether a lock's process is still running.
 *
 * Cross-host locks are treated as live because we can't probe a remote pid —
 * this matches the spec: "treat cross-host locks as alive".
 *
 * Same-host locks are probed with `process.kill(pid, 0)`. If the pid is ours
 * (unlikely, but possible across restarts if someone re-used our pid), we
 * still treat it as alive to be safe.
 */
function isLiveLock(info: RunlockInfo): boolean {
  if (info.host !== os.hostname()) return true;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      // Process exists but we don't have permission — treat as alive.
      return true;
    }
    return false;
  }
}

async function countExistingOutputs(projectRoot: string): Promise<number> {
  const dir = path.join(projectRoot, OUTPUTS_DIR_FROM_PROJECT_ROOT);
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function ageDescription(isoStartedAt: string): string | undefined {
  const started = Date.parse(isoStartedAt);
  if (Number.isNaN(started)) return undefined;
  const ageMs = Date.now() - started;
  if (ageMs < 0) return undefined;
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ago`;
}
