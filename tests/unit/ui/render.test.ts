import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

  it('returns true for stylish format on TTY', async () => {
    process.stdout.isTTY = true;
    const { shouldUseInteractiveUI } =
      await import('../../../src/ui/render.js');
    expect(shouldUseInteractiveUI('stylish')).toBe(true);
  });

  it('returns false for json format on TTY', async () => {
    process.stdout.isTTY = true;
    const { shouldUseInteractiveUI } =
      await import('../../../src/ui/render.js');
    expect(shouldUseInteractiveUI('json')).toBe(false);
  });

  it('returns false for sarif format on TTY', async () => {
    process.stdout.isTTY = true;
    const { shouldUseInteractiveUI } =
      await import('../../../src/ui/render.js');
    expect(shouldUseInteractiveUI('sarif')).toBe(false);
  });

  it('returns false for stylish format when not TTY', async () => {
    (process.stdout as unknown as Record<string, unknown>)['isTTY'] = undefined;
    const { shouldUseInteractiveUI } =
      await import('../../../src/ui/render.js');
    expect(shouldUseInteractiveUI('stylish')).toBeFalsy();
  });
});
