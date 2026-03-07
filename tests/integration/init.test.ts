import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { init } from '../../src/commands/init.js';

const DEFAULT_OPTS = {
  createRules: false,
  githubActions: false,
  githubActionsIncremental: false,
  githubActionsHashCheck: false,
  gitPrePush: false,
  claudeStopHook: false,
};

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('init command', () => {
  it('scaffolds .prosecheck/ directory', async () => {
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });

    const configPath = path.join(tmpDir, '.prosecheck/config.json');
    const content = await readFile(configPath, 'utf-8');
    expect(content).toBeTruthy();
  });

  it('creates config.json with defaults', async () => {
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });

    const configPath = path.join(tmpDir, '.prosecheck/config.json');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config['baseBranch']).toBe('main');
    expect(config['globalIgnore']).toBeInstanceOf(Array);
    expect(config['ruleCalculators']).toBeInstanceOf(Array);
  });

  it('adds .prosecheck entries to .gitignore', async () => {
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });

    const gitignorePath = path.join(tmpDir, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');

    expect(content).toContain('.prosecheck/working/');
    expect(content).toContain('.prosecheck/config.local.json');
  });

  it('appends to existing .gitignore without duplicates', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(gitignorePath, 'node_modules/\n.prosecheck/working/\n', 'utf-8');

    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });

    const content = await readFile(gitignorePath, 'utf-8');
    const matches = content.match(/\.prosecheck\/working\//g);
    expect(matches).toHaveLength(1);
    expect(content).toContain('.prosecheck/config.local.json');
  });

  it('creates starter RULES.md when --rules flag is set', async () => {
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS, createRules: true });

    const rulesPath = path.join(tmpDir, 'RULES.md');
    const content = await readFile(rulesPath, 'utf-8');

    expect(content).toContain('# Rules');
    expect(content).toContain('No console.log');
  });

  it('skips RULES.md creation when file already exists', async () => {
    const rulesPath = path.join(tmpDir, 'RULES.md');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(rulesPath, '# My Rules\n', 'utf-8');

    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS, createRules: true });

    const content = await readFile(rulesPath, 'utf-8');
    expect(content).toBe('# My Rules\n');
  });

  it('does not reinitialize if already initialized with no flags', async () => {
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });
    const stdoutCalls = (process.stdout.write as ReturnType<typeof vi.fn>).mock
      .calls;
    const callCountAfterFirst = stdoutCalls.length;

    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });

    const newCalls = stdoutCalls.slice(callCountAfterFirst);
    const output = newCalls.map((c) => String(c[0])).join('');
    expect(output).toContain('already initialized');
  });

  it('processes integration flags on already-initialized project', async () => {
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS });

    // Running again with --rules should still create RULES.md
    await init({ projectRoot: tmpDir, ...DEFAULT_OPTS, createRules: true });

    const rulesPath = path.join(tmpDir, 'RULES.md');
    expect(await fileExists(rulesPath)).toBe(true);
  });
});

describe('--github-actions', () => {
  it('creates a full-check workflow', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActions: true,
    });

    const workflowPath = path.join(tmpDir, '.github/workflows/prosecheck.yml');
    const content = await readFile(workflowPath, 'utf-8');

    expect(content).toContain('prosecheck lint');
    expect(content).toContain('--last-run-read 0');
    expect(content).toContain('ANTHROPIC_API_KEY');
    expect(content).toContain('--format sarif');
    expect(content).toContain('upload-sarif');
  });

  it('omits SARIF when --sarif 0', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActions: true,
      sarif: false,
    });

    const workflowPath = path.join(tmpDir, '.github/workflows/prosecheck.yml');
    const content = await readFile(workflowPath, 'utf-8');

    expect(content).toContain('prosecheck lint');
    expect(content).not.toContain('--format sarif');
    expect(content).not.toContain('upload-sarif');
  });

  it('does not overwrite existing workflow', async () => {
    const workflowDir = path.join(tmpDir, '.github/workflows');
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = path.join(workflowDir, 'prosecheck.yml');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(workflowPath, 'custom workflow\n', 'utf-8');

    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActions: true,
    });

    const content = await readFile(workflowPath, 'utf-8');
    expect(content).toBe('custom workflow\n');
  });
});

describe('--github-actions-incremental', () => {
  it('creates PR and merge queue workflows', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActionsIncremental: true,
    });

    const prPath = path.join(
      tmpDir,
      '.github/workflows/prosecheck-incremental.yml',
    );
    const mqPath = path.join(
      tmpDir,
      '.github/workflows/prosecheck-merge-queue.yml',
    );

    const prContent = await readFile(prPath, 'utf-8');
    const mqContent = await readFile(mqPath, 'utf-8');

    expect(prContent).toContain('--last-run-read 1');
    expect(mqContent).toContain('--last-run-read 0');
    expect(mqContent).toContain('merge_group');
  });

  it('sets lastRun.write=true for interactive environment', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActionsIncremental: true,
    });

    const configPath = path.join(tmpDir, '.prosecheck/config.json');
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;

    expect(
      config['environments']?.['interactive']?.['lastRun']?.['write'],
    ).toBe(true);
    expect(
      config['environments']?.['interactive']?.['lastRun']?.['files'],
    ).toBe(true);
  });
});

describe('--github-actions-hash-check', () => {
  it('sets lastRun.write=true for interactive environment', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActionsHashCheck: true,
    });

    const configPath = path.join(tmpDir, '.prosecheck/config.json');
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;

    expect(
      config['environments']?.['interactive']?.['lastRun']?.['write'],
    ).toBe(true);
  });

  it('creates a hash-check workflow', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      githubActionsHashCheck: true,
    });

    const workflowPath = path.join(
      tmpDir,
      '.github/workflows/prosecheck-hash-check.yml',
    );
    const content = await readFile(workflowPath, 'utf-8');

    expect(content).toContain('prosecheck lint --hash-check');
    expect(content).not.toContain('ANTHROPIC_API_KEY');
  });
});

describe('--git-pre-push', () => {
  it('creates a pre-push hook', async () => {
    // Create .git/hooks directory to simulate a git repo
    await mkdir(path.join(tmpDir, '.git/hooks'), { recursive: true });

    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      gitPrePush: true,
    });

    const hookPath = path.join(tmpDir, '.git/hooks/pre-push');
    const content = await readFile(hookPath, 'utf-8');

    expect(content).toContain('prosecheck lint');
    expect(content).toContain('#!/bin/sh');
  });

  it('appends to existing pre-push hook', async () => {
    const hooksDir = path.join(tmpDir, '.git/hooks');
    await mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(hookPath, '#!/bin/sh\necho "existing hook"\n', 'utf-8');

    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      gitPrePush: true,
    });

    const content = await readFile(hookPath, 'utf-8');
    expect(content).toContain('existing hook');
    expect(content).toContain('prosecheck');
  });

  it('does not duplicate prosecheck in existing hook', async () => {
    const hooksDir = path.join(tmpDir, '.git/hooks');
    await mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(hookPath, '#!/bin/sh\nnpx prosecheck lint\n', 'utf-8');

    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      gitPrePush: true,
    });

    const content = await readFile(hookPath, 'utf-8');
    const matches = content.match(/prosecheck/g);
    expect(matches).toHaveLength(1);
  });
});

describe('--claude-stop-hook', () => {
  it('creates .claude/settings.json with Stop hook', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      claudeStopHook: true,
    });

    const settingsPath = path.join(tmpDir, '.claude/settings.json');
    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as Record<
      string,
      Record<string, Array<Record<string, string>>>
    >;

    const stopHooks = settings['hooks']?.['Stop'];
    expect(stopHooks).toHaveLength(1);
    expect(stopHooks?.[0]?.['command']).toContain('prosecheck lint');
  });

  it('appends to existing settings without overwriting', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(
      settingsPath,
      JSON.stringify({
        permissions: { allow: ['Read'] },
        hooks: { Stop: [{ matcher: '', command: 'echo done' }] },
      }),
      'utf-8',
    );

    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      claudeStopHook: true,
    });

    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as Record<string, unknown>;

    // Preserved existing data
    expect(settings['permissions']).toBeDefined();

    const hooks = settings['hooks'] as Record<
      string,
      Array<Record<string, string>>
    >;
    expect(hooks['Stop']).toHaveLength(2);
    expect(hooks['Stop']?.[0]?.['command']).toBe('echo done');
    expect(hooks['Stop']?.[1]?.['command']).toContain('prosecheck');
  });

  it('does not duplicate prosecheck hook', async () => {
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      claudeStopHook: true,
    });
    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      claudeStopHook: true,
    });

    const settingsPath = path.join(tmpDir, '.claude/settings.json');
    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as Record<
      string,
      Record<string, Array<Record<string, string>>>
    >;

    expect(settings['hooks']?.['Stop']).toHaveLength(1);
  });
});

describe('combining flags', () => {
  it('applies multiple integrations in a single invocation', async () => {
    await mkdir(path.join(tmpDir, '.git/hooks'), { recursive: true });

    await init({
      projectRoot: tmpDir,
      ...DEFAULT_OPTS,
      createRules: true,
      githubActions: true,
      gitPrePush: true,
    });

    expect(await fileExists(path.join(tmpDir, 'RULES.md'))).toBe(true);
    expect(
      await fileExists(path.join(tmpDir, '.github/workflows/prosecheck.yml')),
    ).toBe(true);
    expect(await fileExists(path.join(tmpDir, '.git/hooks/pre-push'))).toBe(
      true,
    );
  });
});
