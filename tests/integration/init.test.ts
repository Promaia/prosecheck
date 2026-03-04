import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { init } from '../../src/commands/init.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-init-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('init command', () => {
  it('scaffolds .prosecheck/ directory', async () => {
    await init({ projectRoot: tmpDir, createRules: false });

    const configPath = path.join(tmpDir, '.prosecheck/config.json');
    const content = await readFile(configPath, 'utf-8');
    expect(content).toBeTruthy();
  });

  it('creates config.json with defaults', async () => {
    await init({ projectRoot: tmpDir, createRules: false });

    const configPath = path.join(tmpDir, '.prosecheck/config.json');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config['baseBranch']).toBe('main');
    expect(config['globalIgnore']).toBeInstanceOf(Array);
    expect(config['ruleCalculators']).toBeInstanceOf(Array);
  });

  it('adds .prosecheck entries to .gitignore', async () => {
    await init({ projectRoot: tmpDir, createRules: false });

    const gitignorePath = path.join(tmpDir, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');

    expect(content).toContain('.prosecheck/working/');
    expect(content).toContain('.prosecheck/config.local.json');
    expect(content).toContain('.prosecheck/last-user-run');
  });

  it('appends to existing .gitignore without duplicates', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(gitignorePath, 'node_modules/\n.prosecheck/working/\n', 'utf-8');

    await init({ projectRoot: tmpDir, createRules: false });

    const content = await readFile(gitignorePath, 'utf-8');
    // Should not duplicate .prosecheck/working/
    const matches = content.match(/\.prosecheck\/working\//g);
    expect(matches).toHaveLength(1);
    // Should still add the missing ones
    expect(content).toContain('.prosecheck/config.local.json');
  });

  it('creates starter RULES.md when --rules flag is set', async () => {
    await init({ projectRoot: tmpDir, createRules: true });

    const rulesPath = path.join(tmpDir, 'RULES.md');
    const content = await readFile(rulesPath, 'utf-8');

    expect(content).toContain('# Rules');
    expect(content).toContain('No console.log');
  });

  it('skips RULES.md creation when file already exists', async () => {
    const rulesPath = path.join(tmpDir, 'RULES.md');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(rulesPath, '# My Rules\n', 'utf-8');

    await init({ projectRoot: tmpDir, createRules: true });

    const content = await readFile(rulesPath, 'utf-8');
    expect(content).toBe('# My Rules\n');
  });

  it('does not reinitialize if already initialized', async () => {
    await init({ projectRoot: tmpDir, createRules: false });
    const stdoutCalls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
    const callCountAfterFirst = stdoutCalls.length;

    await init({ projectRoot: tmpDir, createRules: false });

    // Should have printed "already initialized" message
    const newCalls = stdoutCalls.slice(callCountAfterFirst);
    const output = newCalls.map((c) => String(c[0])).join('');
    expect(output).toContain('already initialized');
  });
});
