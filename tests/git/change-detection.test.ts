import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { execa } from 'execa';
import {
  detectChanges,
  getMergeBase,
  readLastRunData,
} from '../../src/lib/change-detection.js';
import { ConfigSchema } from '../../src/lib/config-schema.js';
import { createRule } from '../../src/lib/rule.js';
import {
  createTestRepo,
  gitCommit,
  writeTestFile,
  type TestRepo,
} from '../helpers/git-repo.js';

// Collect repos to clean up after each test
const repos: TestRepo[] = [];

afterEach(async () => {
  for (const repo of repos) {
    await repo.cleanup();
  }
  repos.length = 0;
});

const fingerprintInputs = {
  promptTemplate: 'tpl',
  globalPrompt: undefined,
};

describe('git integration: basic change detection', () => {
  it('detects changed and added files on a feature branch', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    // Create a file on main and commit
    await writeTestFile(repo.dir, 'src/foo.ts', 'const x = 1;\n');
    await gitCommit(repo.dir, 'Add foo');

    // Create feature branch
    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });

    // Modify foo and add bar
    await writeTestFile(repo.dir, 'src/foo.ts', 'const x = 2;\n');
    await writeTestFile(repo.dir, 'src/bar.ts', 'const y = 1;\n');
    await gitCommit(repo.dir, 'Modify foo and add bar');

    const config = ConfigSchema.parse({
      globalIgnore: [],
      additionalIgnore: [],
    });
    const rules = [createRule('Src Rule', 'Check src', ['src/'], 'RULES.md')];

    const result = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });

    expect(result.changedFiles).toContain('src/foo.ts');
    expect(result.changedFiles).toContain('src/bar.ts');
    expect(result.triggeredRules).toHaveLength(1);
    expect(result.triggeredRules[0]?.name).toBe('Src Rule');
    // comparisonRef should be a valid hex hash
    expect(result.comparisonRef).toMatch(/^[0-9a-f]{40}$/);
  }, 30_000);
});

describe('git integration: merge-base computation', () => {
  it('returns the fork point, not HEAD of main', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    // Add a commit on main
    await writeTestFile(repo.dir, 'a.ts');
    await gitCommit(repo.dir, 'Commit A on main');

    // Record the fork point
    const { stdout: forkHash } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: repo.dir,
    });

    // Create feature branch
    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
    await writeTestFile(repo.dir, 'b.ts');
    await gitCommit(repo.dir, 'Commit B on feature');

    // Add more commits on main after the fork
    await execa('git', ['checkout', 'main'], { cwd: repo.dir });
    await writeTestFile(repo.dir, 'c.ts');
    await gitCommit(repo.dir, 'Commit C on main');

    // Switch back to feature
    await execa('git', ['checkout', 'feature'], { cwd: repo.dir });

    const mergeBase = await getMergeBase(repo.dir, 'main');
    expect(mergeBase).toBe(forkHash.trim());
  }, 30_000);
});

describe('git integration: scope matching with nested directories', () => {
  it('matches files to correct rule scopes', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'base.ts');
    await gitCommit(repo.dir, 'Base commit');

    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });

    await writeTestFile(repo.dir, 'src/api/route.ts');
    await writeTestFile(repo.dir, 'src/lib/util.ts');
    await writeTestFile(repo.dir, 'docs/readme.md');
    await gitCommit(repo.dir, 'Add nested files');

    const config = ConfigSchema.parse({
      globalIgnore: [],
      additionalIgnore: [],
    });
    const apiRule = createRule(
      'API Rule',
      'API only',
      ['src/api/'],
      'RULES.md',
    );
    const srcRule = createRule('Src Rule', 'All src', ['src/'], 'RULES.md');
    const globalRule = createRule('Global Rule', 'Everything', [], 'RULES.md');

    const result = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules: [apiRule, srcRule, globalRule],
      ...fingerprintInputs,
    });

    const apiFiles = result.changedFilesByRule.get(apiRule.id);
    const srcFiles = result.changedFilesByRule.get(srcRule.id);
    const globalFiles = result.changedFilesByRule.get(globalRule.id);

    // API rule only matches src/api/
    expect(apiFiles).toEqual(['src/api/route.ts']);

    // Src rule matches all src/ files
    expect(srcFiles).toContain('src/api/route.ts');
    expect(srcFiles).toContain('src/lib/util.ts');
    expect(srcFiles).not.toContain('docs/readme.md');

    // Global rule matches everything
    expect(globalFiles).toContain('src/api/route.ts');
    expect(globalFiles).toContain('src/lib/util.ts');
    expect(globalFiles).toContain('docs/readme.md');
  }, 30_000);
});

describe('git integration: global ignore filtering', () => {
  it('excludes globally ignored files', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'base.ts');
    await gitCommit(repo.dir, 'Base commit');

    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });

    await writeTestFile(repo.dir, 'src/app.ts');
    await writeTestFile(repo.dir, 'vendor/pkg.js');
    await writeTestFile(repo.dir, 'output/bundle.js');
    await gitCommit(repo.dir, 'Add files');

    const config = ConfigSchema.parse({
      globalIgnore: ['vendor/', 'output/'],
      additionalIgnore: [],
    });
    const rules = [createRule('All Rule', 'Everything', [], 'RULES.md')];

    const result = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });

    expect(result.changedFiles).toContain('src/app.ts');
    expect(result.changedFiles).not.toContain('vendor/pkg.js');
    expect(result.changedFiles).not.toContain('output/bundle.js');
  }, 30_000);
});

describe('git integration: per-rule cache tracking', () => {
  it('second run skips rule whose in-scope files are unchanged', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'base.ts');
    await gitCommit(repo.dir, 'Base commit');

    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });

    // Commit A: add file-a
    await writeTestFile(repo.dir, 'src/file-a.ts');
    await gitCommit(repo.dir, 'Commit A');

    const config = ConfigSchema.parse({
      lastRun: { read: true, write: true },
      globalIgnore: ['.prosecheck/'],
      additionalIgnore: [],
    });
    const rules = [createRule('Src', 'Src only', ['src/'], 'RULES.md')];

    // First run — no cache; rule must trigger
    const result1 = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });

    expect(result1.triggeredRules).toHaveLength(1);
    expect(result1.cachedRules).toHaveLength(0);
    expect(result1.writeRuleCacheEntries).toBeDefined();

    // Simulate rule passing: persist cache entry
    const write = result1.writeRuleCacheEntries;
    if (write) await write(new Set(rules.map((r) => r.id)));

    const saved = await readLastRunData(repo.dir);
    expect(saved?.rules[rules[0]?.id ?? '']?.status).toBe('pass');

    // Second run with no file changes — rule should be cached
    const result2 = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });

    expect(result2.triggeredRules).toHaveLength(0);
    expect(result2.cachedRules).toHaveLength(1);
  }, 30_000);

  it('second run re-triggers rule after an in-scope file changes', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'base.ts');
    await gitCommit(repo.dir, 'Base commit');

    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });

    await writeTestFile(repo.dir, 'src/file-a.ts', 'const a = 1;\n');
    await gitCommit(repo.dir, 'Commit A');

    const config = ConfigSchema.parse({
      lastRun: { read: true, write: true },
      globalIgnore: ['.prosecheck/'],
      additionalIgnore: [],
    });
    const rules = [createRule('Src', 'Src only', ['src/'], 'RULES.md')];

    const result1 = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });
    const write = result1.writeRuleCacheEntries;
    if (write) await write(new Set(rules.map((r) => r.id)));

    // Modify file-a
    await writeTestFile(repo.dir, 'src/file-a.ts', 'const a = 2;\n');

    const result2 = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });

    expect(result2.triggeredRules).toHaveLength(1);
    expect(result2.cachedRules).toHaveLength(0);
    expect(result2.changedFilesByRule.get(rules[0]?.id ?? '')).toEqual([
      'src/file-a.ts',
    ]);
  }, 30_000);
});

describe('git integration: shallow clone behavior', () => {
  it('getMergeBase falls back to branch name in shallow clone', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'src/app.ts');
    await gitCommit(repo.dir, 'Add app');

    // Clone with depth=1 into a second temp dir
    const suffix = randomBytes(8).toString('hex');
    const shallowDir = path.join(os.tmpdir(), `prosecheck-shallow-${suffix}`);
    const shallowRepo: TestRepo = {
      dir: shallowDir,
      cleanup: async () => {
        await rm(shallowDir, { recursive: true, force: true });
      },
    };
    repos.push(shallowRepo);

    await execa('git', ['clone', '--depth=1', repo.dir, shallowDir]);

    // In a shallow clone, merge-base typically fails
    const mergeBase = await getMergeBase(shallowDir, 'main');
    // Should fall back to branch name string
    expect(typeof mergeBase).toBe('string');
    // Either it's a hash (if git manages) or the branch name fallback
    if (!mergeBase.match(/^[0-9a-f]{40}$/)) {
      expect(mergeBase).toBe('main');
    }
  }, 30_000);

  it('detectChanges works with explicit comparisonRef in shallow clone', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'src/app.ts');
    await gitCommit(repo.dir, 'Add app');

    // Get HEAD hash before cloning
    const { stdout: headHash } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: repo.dir,
    });

    // Clone with depth=1
    const suffix = randomBytes(8).toString('hex');
    const shallowDir = path.join(os.tmpdir(), `prosecheck-shallow2-${suffix}`);
    const shallowRepo: TestRepo = {
      dir: shallowDir,
      cleanup: async () => {
        await rm(shallowDir, { recursive: true, force: true });
      },
    };
    repos.push(shallowRepo);

    await execa('git', ['clone', '--depth=1', repo.dir, shallowDir]);

    // Add a file in the shallow clone
    await writeTestFile(shallowDir, 'src/new.ts');
    await execa('git', ['config', 'user.name', 'Test'], { cwd: shallowDir });
    await execa('git', ['config', 'user.email', 'test@test.com'], {
      cwd: shallowDir,
    });
    await gitCommit(shallowDir, 'Add new file');

    const config = ConfigSchema.parse({
      globalIgnore: [],
      additionalIgnore: [],
      lastRun: { read: false, write: false },
    });
    const rules = [createRule('All', 'Everything', [], 'RULES.md')];

    // Use the cloned HEAD as explicit ref
    const result = await detectChanges({
      projectRoot: shallowDir,
      config,
      rules,
      comparisonRef: headHash.trim(),
      ...fingerprintInputs,
    });

    expect(result.changedFiles).toContain('src/new.ts');
  }, 30_000);
});

describe('git integration: no changes detected', () => {
  it('returns empty results when no files changed', async () => {
    const repo = await createTestRepo();
    repos.push(repo);

    await writeTestFile(repo.dir, 'src/app.ts');
    await gitCommit(repo.dir, 'Add app');

    // Create feature branch but don't change anything
    await execa('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });

    const config = ConfigSchema.parse({
      globalIgnore: [],
      additionalIgnore: [],
    });
    const rules = [createRule('All', 'Everything', [], 'RULES.md')];

    const result = await detectChanges({
      projectRoot: repo.dir,
      config,
      rules,
      ...fingerprintInputs,
    });

    expect(result.changedFiles).toEqual([]);
    expect(result.triggeredRules).toEqual([]);
  }, 30_000);
});
