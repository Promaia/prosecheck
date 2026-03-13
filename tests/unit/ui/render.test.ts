import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import once at the suite level. shouldUseInteractiveUI reads
// process.stdout.isTTY at call time, not import time, so a single
// import is fine. Dynamic per-test import caused flaky timeouts
// because the first cold-start load of ink/React is slow.
import { shouldUseInteractiveUI } from '../../../src/ui/render.js';

describe('shouldUseInteractiveUI', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    // Restore original value
    if (originalIsTTY === undefined) {
      delete (process.stdout as unknown as Record<string, unknown>)['isTTY'];
    } else {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  it('returns true for stylish format on TTY', () => {
    process.stdout.isTTY = true;
    expect(shouldUseInteractiveUI('stylish')).toBe(true);
  });

  it('returns false for json format on TTY', () => {
    process.stdout.isTTY = true;
    expect(shouldUseInteractiveUI('json')).toBe(false);
  });

  it('returns false for sarif format on TTY', () => {
    process.stdout.isTTY = true;
    expect(shouldUseInteractiveUI('sarif')).toBe(false);
  });

  it('returns false for stylish format when not TTY', () => {
    (process.stdout as unknown as Record<string, unknown>)['isTTY'] = undefined;
    expect(shouldUseInteractiveUI('stylish')).toBeFalsy();
  });
});
