import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadConfig,
  deepMerge,
  resolveEnvironment,
  ConfigError,
} from '../../../src/lib/config.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function writeConfig(
  projectRoot: string,
  config: Record<string, unknown>,
): Promise<void> {
  const configDir = path.join(projectRoot, '.prosecheck');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify(config));
}

async function writeLocalConfig(
  projectRoot: string,
  config: Record<string, unknown>,
): Promise<void> {
  const configDir = path.join(projectRoot, '.prosecheck');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, 'config.local.json'),
    JSON.stringify(config),
  );
}

describe('loadConfig', () => {
  it('loads config from .prosecheck/config.json', async () => {
    await writeConfig(tmpDir, { baseBranch: 'develop' });

    const { config } = await loadConfig({ projectRoot: tmpDir });
    expect(config.baseBranch).toBe('develop');
  });

  it('applies defaults when config.json is empty', async () => {
    await writeConfig(tmpDir, {});

    const { config } = await loadConfig({ projectRoot: tmpDir });
    expect(config.baseBranch).toBe('main');
    expect(config.addtlOverheadTimeout).toBe(60);
    expect(config.hardTotalTimeout).toBeNull();
    // Default env is interactive, which enables the per-rule cache.
    expect(config.lastRun.read).toBe(true);
    expect(config.lastRun.write).toBe(true);
  });

  it('leaves lastRun off for the ci environment by default', async () => {
    await writeConfig(tmpDir, {});

    const { config } = await loadConfig({ projectRoot: tmpDir, env: 'ci' });
    expect(config.lastRun.read).toBe(false);
    expect(config.lastRun.write).toBe(false);
  });

  it('applies defaults when config.json does not exist', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });

    const { config } = await loadConfig({ projectRoot: tmpDir });
    expect(config.baseBranch).toBe('main');
  });

  it('merges config.local.json on top of config.json', async () => {
    await writeConfig(tmpDir, {
      baseBranch: 'main',
      addtlOverheadTimeout: 60,
    });
    await writeLocalConfig(tmpDir, { addtlOverheadTimeout: 120 });

    const { config } = await loadConfig({ projectRoot: tmpDir });
    expect(config.baseBranch).toBe('main');
    expect(config.addtlOverheadTimeout).toBe(120);
  });

  it('applies environment overrides', async () => {
    await writeConfig(tmpDir, {
      warnAsError: false,
      environments: {
        ci: { warnAsError: true },
      },
    });

    const { config, environment } = await loadConfig({
      projectRoot: tmpDir,
      env: 'ci',
    });
    expect(environment).toBe('ci');
    expect(config.warnAsError).toBe(true);
  });

  it('auto-detects ci environment from process.env.CI', async () => {
    vi.stubEnv('CI', 'true');
    await writeConfig(tmpDir, {
      environments: {
        ci: { warnAsError: true },
      },
    });

    const { config, environment } = await loadConfig({ projectRoot: tmpDir });
    expect(environment).toBe('ci');
    expect(config.warnAsError).toBe(true);
  });

  it('CLI flags override everything', async () => {
    await writeConfig(tmpDir, { hardTotalTimeout: 300 });

    const { config } = await loadConfig({
      projectRoot: tmpDir,
      cliOverrides: { hardTotalTimeout: 60 },
    });
    expect(config.hardTotalTimeout).toBe(60);
  });

  it('full layering: base → local → env → cli', async () => {
    await writeConfig(tmpDir, {
      baseBranch: 'main',
      addtlOverheadTimeout: 60,
      warnAsError: false,
      environments: {
        ci: { warnAsError: true, hardTotalTimeout: 600 },
      },
    });
    await writeLocalConfig(tmpDir, { baseBranch: 'develop' });

    const { config } = await loadConfig({
      projectRoot: tmpDir,
      env: 'ci',
      cliOverrides: { hardTotalTimeout: 120 },
    });

    expect(config.baseBranch).toBe('develop'); // from local
    expect(config.warnAsError).toBe(true); // from env override
    expect(config.hardTotalTimeout).toBe(120); // from CLI
  });

  it('throws ConfigError for invalid config', async () => {
    await writeConfig(tmpDir, { addtlOverheadTimeout: 'not a number' });

    await expect(loadConfig({ projectRoot: tmpDir })).rejects.toThrow(
      ConfigError,
    );
  });

  it('throws ConfigError with issue details', async () => {
    await writeConfig(tmpDir, { hardTotalTimeout: -1 });

    try {
      await loadConfig({ projectRoot: tmpDir });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.issues.length).toBeGreaterThan(0);
    }
  });

  it('ignores missing config.local.json', async () => {
    await writeConfig(tmpDir, { baseBranch: 'main' });

    const { config } = await loadConfig({ projectRoot: tmpDir });
    expect(config.baseBranch).toBe('main');
  });

  it('deep merges nested objects in local config', async () => {
    // Use an env with no lastRun override so we can observe the local merge
    await writeConfig(tmpDir, {
      lastRun: { read: false, write: true, files: false },
      environments: {
        interactive: {},
      },
    });
    await writeLocalConfig(tmpDir, {
      lastRun: { read: true },
    });

    const { config } = await loadConfig({ projectRoot: tmpDir });
    expect(config.lastRun.read).toBe(true); // overridden by local
    expect(config.lastRun.write).toBe(true); // preserved from base
  });
});

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const base = { a: 1, b: 2 };
    const result = deepMerge(base, { a: 1, b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('deep merges nested objects', () => {
    const base = { nested: { a: 1, b: 2 } };
    const result = deepMerge(base, { nested: { a: 1, b: 3 } });
    expect(result).toEqual({ nested: { a: 1, b: 3 } });
  });

  it('replaces arrays instead of concatenating', () => {
    const base = { items: [1, 2, 3] };
    const result = deepMerge(base, { items: [4, 5] });
    expect(result).toEqual({ items: [4, 5] });
  });

  it('skips undefined overlay values', () => {
    const base = { a: 1, b: 2 };
    const overlay: Partial<typeof base> = {};
    const result = deepMerge(base, overlay);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe('resolveEnvironment', () => {
  it('returns explicit env when provided', () => {
    expect(resolveEnvironment('staging')).toBe('staging');
  });

  it('returns ci when process.env.CI is set', () => {
    vi.stubEnv('CI', 'true');
    expect(resolveEnvironment()).toBe('ci');
  });

  it('returns interactive by default', () => {
    vi.stubEnv('CI', '');
    expect(resolveEnvironment()).toBe('interactive');
  });

  it('prefers explicit env over CI auto-detection', () => {
    vi.stubEnv('CI', 'true');
    expect(resolveEnvironment('staging')).toBe('staging');
  });
});
