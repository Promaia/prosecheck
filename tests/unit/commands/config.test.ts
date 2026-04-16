import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from '../../../src/commands/config.js';
import {
  extractFields,
  resolveSchemaType,
  coerceValue,
} from '../../../src/commands/config.js';
import { ConfigSchema } from '../../../src/lib/config-schema.js';
import { z } from 'zod';

let tmpDir: string;
let stdoutData: string;
let stderrData: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-config-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });

  stdoutData = '';
  stderrData = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      stdoutData += String(chunk);
      return true;
    },
  );
  vi.spyOn(process.stderr, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      stderrData += String(chunk);
      return true;
    },
  );
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function writeConfig(
  projectRoot: string,
  configObj: Record<string, unknown>,
): Promise<void> {
  const configDir = path.join(projectRoot, '.prosecheck');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify(configObj),
  );
}

async function readConfig(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const content = await readFile(
    path.join(projectRoot, '.prosecheck', 'config.json'),
    'utf-8',
  );
  return JSON.parse(content) as Record<string, unknown>;
}

// --- extractFields ---

describe('extractFields', () => {
  it('extracts top-level fields from ConfigSchema', () => {
    const defaults = ConfigSchema.parse({}) as unknown as Record<
      string,
      unknown
    >;
    const fields = extractFields(ConfigSchema, defaults, defaults);

    const paths = fields.map((f) => f.path);
    expect(paths).toContain('baseBranch');
    expect(paths).toContain('addtlOverheadTimeout');
    expect(paths).toContain('warnAsError');
  });

  it('recurses into nested objects (lastRun)', () => {
    const defaults = ConfigSchema.parse({}) as unknown as Record<
      string,
      unknown
    >;
    const fields = extractFields(ConfigSchema, defaults, defaults);

    const paths = fields.map((f) => f.path);
    expect(paths).toContain('lastRun.read');
    expect(paths).toContain('lastRun.write');
    // Should NOT have flat 'lastRun'
    expect(paths).not.toContain('lastRun');
  });

  it('includes descriptions from .describe()', () => {
    const defaults = ConfigSchema.parse({}) as unknown as Record<
      string,
      unknown
    >;
    const fields = extractFields(ConfigSchema, defaults, defaults);

    const baseBranch = fields.find((f) => f.path === 'baseBranch');
    expect(baseBranch?.description).toContain('Git branch');
  });

  it('includes default values', () => {
    const defaults = ConfigSchema.parse({}) as unknown as Record<
      string,
      unknown
    >;
    const fields = extractFields(ConfigSchema, defaults, defaults);

    const overhead = fields.find((f) => f.path === 'addtlOverheadTimeout');
    expect(overhead?.defaultValue).toBe(60);
  });
});

// --- resolveSchemaType ---

describe('resolveSchemaType', () => {
  it('resolves top-level keys', () => {
    const type = resolveSchemaType(ConfigSchema, 'baseBranch');
    expect(type).toBeDefined();
  });

  it('resolves nested keys via dot path', () => {
    const type = resolveSchemaType(ConfigSchema, 'lastRun.read');
    expect(type).toBeDefined();
  });

  it('returns undefined for unknown keys', () => {
    expect(resolveSchemaType(ConfigSchema, 'nonexistent')).toBeUndefined();
  });

  it('returns undefined for invalid nested paths', () => {
    expect(
      resolveSchemaType(ConfigSchema, 'baseBranch.nested'),
    ).toBeUndefined();
  });
});

// --- coerceValue ---

describe('coerceValue', () => {
  it('coerces strings', () => {
    expect(coerceValue('hello', z.string())).toEqual({ value: 'hello' });
  });

  it('coerces booleans', () => {
    expect(coerceValue('true', z.boolean())).toEqual({ value: true });
    expect(coerceValue('false', z.boolean())).toEqual({ value: false });
  });

  it('rejects invalid booleans', () => {
    const result = coerceValue('yes', z.boolean());
    expect(result.error).toBeDefined();
  });

  it('coerces numbers', () => {
    expect(coerceValue('42', z.number())).toEqual({ value: 42 });
    expect(coerceValue('3.14', z.number())).toEqual({ value: 3.14 });
  });

  it('rejects invalid numbers', () => {
    const result = coerceValue('abc', z.number());
    expect(result.error).toBeDefined();
  });

  it('coerces comma-separated arrays', () => {
    expect(coerceValue('a,b,c', z.array(z.string()))).toEqual({
      value: ['a', 'b', 'c'],
    });
  });

  it('coerces JSON arrays', () => {
    expect(coerceValue('["a","b"]', z.array(z.string()))).toEqual({
      value: ['a', 'b'],
    });
  });

  it('coerces empty string to empty array', () => {
    expect(coerceValue('', z.array(z.string()))).toEqual({ value: [] });
  });
});

// --- config list ---

describe('config list', () => {
  it('lists all fields with defaults when no config exists', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await config({ projectRoot: tmpDir, action: 'list', args: [] });

    expect(stdoutData).toContain('baseBranch');
    expect(stdoutData).toContain('addtlOverheadTimeout');
    expect(stdoutData).toContain('default');
  });

  it('marks modified values', async () => {
    await writeConfig(tmpDir, { baseBranch: 'develop' });
    await config({ projectRoot: tmpDir, action: 'list', args: [] });

    expect(stdoutData).toContain('baseBranch');
    expect(stdoutData).toContain('modified');
  });
});

// --- config set ---

describe('config set', () => {
  it('sets a string value', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['baseBranch=develop'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['baseBranch']).toBe('develop');
  });

  it('sets a boolean value', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['warnAsError=true'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['warnAsError']).toBe(true);
  });

  it('sets a number value', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['addtlOverheadTimeout=120'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['addtlOverheadTimeout']).toBe(120);
  });

  it('sets a nested value via dot path', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['lastRun.read=true'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['lastRun']).toEqual({ read: true });
  });

  it('removes value when set to default', async () => {
    await writeConfig(tmpDir, {
      baseBranch: 'develop',
      addtlOverheadTimeout: 120,
    });
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['baseBranch=main'],
    });

    const saved = await readConfig(tmpDir);
    // baseBranch should be removed since 'main' is the default
    expect(saved['baseBranch']).toBeUndefined();
    // addtlOverheadTimeout should remain
    expect(saved['addtlOverheadTimeout']).toBe(120);
  });

  it('sets multiple values at once', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['baseBranch=develop', 'addtlOverheadTimeout=120'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['baseBranch']).toBe('develop');
    expect(saved['addtlOverheadTimeout']).toBe(120);
  });

  it('rejects unknown keys', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['unknownKey=value'],
    });

    expect(process.exitCode).toBe(2);
    expect(stderrData).toContain('Unknown config key');
  });

  it('rejects invalid value format', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['noequals'],
    });

    expect(process.exitCode).toBe(2);
    expect(stderrData).toContain('key=value');
  });

  it('rejects invalid boolean values', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['warnAsError=yes'],
    });

    expect(process.exitCode).toBe(2);
    expect(stderrData).toContain('Invalid value');
  });

  it('sets an array value via comma-separated', async () => {
    await writeConfig(tmpDir, {});
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['postRun=echo hello,echo world'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['postRun']).toEqual(['echo hello', 'echo world']);
  });

  it('creates config file if it does not exist', async () => {
    await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: ['baseBranch=develop'],
    });

    const saved = await readConfig(tmpDir);
    expect(saved['baseBranch']).toBe('develop');
  });

  it('shows no usage error with no args', async () => {
    await config({
      projectRoot: tmpDir,
      action: 'set',
      args: [],
    });

    expect(process.exitCode).toBe(2);
    expect(stderrData).toContain('Usage');
  });
});
