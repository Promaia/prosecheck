import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import {
  detectChanges,
  getMergeBase,
  getChangedFiles,
  getCurrentHead,
  readLastRunHash,
  writeLastRunHash,
} from '../../../src/lib/change-detection.js';
import { ConfigSchema } from '../../../src/lib/config-schema.js';
import { createRule } from '../../../src/lib/rule.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock buildIgnoreFilter from ignore module — buildInclusionFilter is kept as-is via passthrough
vi.mock('../../../src/lib/ignore.js', async () => {
  const { buildInclusionFilter } = await vi.importActual<
    Record<string, unknown>
  >('../../../src/lib/ignore.js');
  return {
    buildInclusionFilter,
    buildIgnoreFilter: vi.fn().mockResolvedValue({
      ignores: () => false,
    }),
  };
});

import { execa } from 'execa';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildIgnoreFilter } from '../../../src/lib/ignore.js';

const mockedExeca = vi.mocked(execa);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedBuildIgnoreFilter = vi.mocked(buildIgnoreFilter);

const PROJECT_ROOT = '/fake/project';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMergeBase', () => {
  it('returns the merge-base hash', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'abc123\n' } as never);

    const result = await getMergeBase(PROJECT_ROOT, 'main');

    expect(result).toBe('abc123');
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['merge-base', 'HEAD', 'main'],
      { cwd: PROJECT_ROOT },
    );
  });

  it('falls back to branch name when merge-base fails', async () => {
    mockedExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

    const result = await getMergeBase(PROJECT_ROOT, 'main');

    expect(result).toBe('main');
  });
});

describe('getChangedFiles', () => {
  it('returns list of changed files', async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nsrc/bar.ts\n',
    } as never);

    const result = await getChangedFiles(PROJECT_ROOT, 'abc123');

    expect(result).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'abc123'],
      { cwd: PROJECT_ROOT },
    );
  });

  it('returns empty array when no changes', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);

    const result = await getChangedFiles(PROJECT_ROOT, 'abc123');

    expect(result).toEqual([]);
  });
});

describe('getCurrentHead', () => {
  it('returns the current HEAD hash', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'def456\n' } as never);

    const result = await getCurrentHead(PROJECT_ROOT);

    expect(result).toBe('def456');
  });
});

describe('readLastRunHash', () => {
  it('reads the hash from the last-run file', async () => {
    mockedReadFile.mockResolvedValueOnce('abc123\n');

    const result = await readLastRunHash(PROJECT_ROOT);

    expect(result).toBe('abc123');
    expect(mockedReadFile).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck/last-user-run'),
      'utf-8',
    );
  });

  it('returns undefined when file does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockedReadFile.mockRejectedValueOnce(error);

    const result = await readLastRunHash(PROJECT_ROOT);

    expect(result).toBeUndefined();
  });

  it('returns undefined for empty file', async () => {
    mockedReadFile.mockResolvedValueOnce('');

    const result = await readLastRunHash(PROJECT_ROOT);

    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid (non-hex) hash', async () => {
    mockedReadFile.mockResolvedValueOnce('not-a-hex-hash\n');

    const result = await readLastRunHash(PROJECT_ROOT);

    expect(result).toBeUndefined();
  });

  it('rethrows non-ENOENT errors', async () => {
    const error = new Error('EACCES') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockedReadFile.mockRejectedValueOnce(error);

    await expect(readLastRunHash(PROJECT_ROOT)).rejects.toThrow('EACCES');
  });
});

describe('writeLastRunHash', () => {
  it('writes the hash with trailing newline', async () => {
    mockedMkdir.mockResolvedValueOnce(undefined);
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await writeLastRunHash(PROJECT_ROOT, 'abc123');

    expect(mockedMkdir).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck'),
      { recursive: true },
    );
    expect(mockedWriteFile).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck/last-user-run'),
      'abc123\n',
      'utf-8',
    );
  });
});

describe('detectChanges', () => {
  const baseConfig = ConfigSchema.parse({});

  function makeRules() {
    return [
      createRule('Global Rule', 'Applies everywhere', [], 'RULES.md'),
      createRule('API Rule', 'API-only', ['src/api/'], 'src/api/RULES.md'),
      createRule('Src Rule', 'Src-wide', ['src/'], 'src/RULES.md'),
    ];
  }

  function setupGitMocks(opts: {
    mergeBase?: string;
    changedFiles?: string[];
    head?: string;
  }) {
    const mergeBase = opts.mergeBase ?? 'merge-base-hash';
    const changedFiles = opts.changedFiles ?? [];
    const head = opts.head ?? 'current-head-hash';

    // getMergeBase
    mockedExeca.mockResolvedValueOnce({ stdout: mergeBase } as never);
    // getChangedFiles
    mockedExeca.mockResolvedValueOnce({
      stdout: changedFiles.join('\n'),
    } as never);
    // getCurrentHead (for lastRun.write)
    mockedExeca.mockResolvedValueOnce({ stdout: head } as never);
  }

  it('triggers rules whose scope contains changed files', async () => {
    setupGitMocks({ changedFiles: ['src/api/routes.ts'] });
    // Mock ignore filter that doesn't filter anything
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const rules = makeRules();
    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: baseConfig,

      rules,
    });

    const triggeredNames = result.triggeredRules.map((r) => r.name);
    // Global rule matches everything, API rule matches src/api/, Src rule matches src/
    expect(triggeredNames).toContain('Global Rule');
    expect(triggeredNames).toContain('API Rule');
    expect(triggeredNames).toContain('Src Rule');
  });

  it('does not trigger rules when no files match their scope', async () => {
    setupGitMocks({ changedFiles: ['docs/README.md'] });
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const rules = makeRules();
    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: baseConfig,

      rules,
    });

    const triggeredNames = result.triggeredRules.map((r) => r.name);
    // Global rule matches everything, but API and Src rules don't match docs/
    expect(triggeredNames).toContain('Global Rule');
    expect(triggeredNames).not.toContain('API Rule');
    expect(triggeredNames).not.toContain('Src Rule');
  });

  it('returns no triggered rules when there are no changes', async () => {
    setupGitMocks({ changedFiles: [] });
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: baseConfig,

      rules: makeRules(),
    });

    expect(result.triggeredRules).toEqual([]);
    expect(result.changedFiles).toEqual([]);
  });

  it('uses explicit comparisonRef when provided', async () => {
    // No getMergeBase call needed since explicit ref is provided
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts',
    } as never); // getChangedFiles
    mockedExeca.mockResolvedValueOnce({
      stdout: 'head-hash',
    } as never); // getCurrentHead
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: baseConfig,

      rules: makeRules(),
      comparisonRef: 'explicit-ref',
    });

    expect(result.comparisonRef).toBe('explicit-ref');
    // First execa call should be getChangedFiles with explicit ref
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'explicit-ref'],
      { cwd: PROJECT_ROOT },
    );
  });

  it('reads last-run hash when lastRun.read is enabled', async () => {
    const ciConfig = ConfigSchema.parse({
      lastRun: { read: true, write: false },
    });

    // getMergeBase
    mockedExeca.mockResolvedValueOnce({
      stdout: 'merge-base-hash',
    } as never);
    // getChangedFiles — should use last-run hash, not merge-base
    mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
    // readLastRunHash — must be valid hex
    mockedReadFile.mockResolvedValueOnce('aabbccdd1122\n');
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: ciConfig,

      rules: makeRules(),
    });

    // comparisonRef should be merge-base (agents get this), but diff used last-run
    expect(result.comparisonRef).toBe('merge-base-hash');
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'aabbccdd1122'],
      { cwd: PROJECT_ROOT },
    );
  });

  it('falls back to comparisonRef when last-run file does not exist', async () => {
    const ciConfig = ConfigSchema.parse({
      lastRun: { read: true, write: false },
    });

    // getMergeBase
    mockedExeca.mockResolvedValueOnce({
      stdout: 'merge-base-hash',
    } as never);
    // getChangedFiles
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // readLastRunHash — file missing
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockedReadFile.mockRejectedValueOnce(error);
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: ciConfig,

      rules: makeRules(),
    });

    // Should fall back to merge-base
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'merge-base-hash'],
      { cwd: PROJECT_ROOT },
    );
    expect(result.comparisonRef).toBe('merge-base-hash');
  });

  it('returns commitLastRunHash callback when lastRun.write is enabled', async () => {
    const config = ConfigSchema.parse({
      lastRun: { read: false, write: true },
    });

    setupGitMocks({ changedFiles: [], head: 'new-head-hash' });
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,

      rules: [],
    });

    // Should NOT write immediately — deferred to caller
    expect(mockedWriteFile).not.toHaveBeenCalled();
    expect(result.commitLastRunHash).toBeDefined();

    // Caller invokes the callback after successful run
    mockedMkdir.mockResolvedValueOnce(undefined);
    mockedWriteFile.mockResolvedValueOnce(undefined);
    const commit = result.commitLastRunHash;
    expect(commit).toBeDefined();
    if (commit) await commit();

    expect(mockedWriteFile).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck/last-user-run'),
      'new-head-hash\n',
      'utf-8',
    );
  });

  it('does not return commitLastRunHash when lastRun.write is disabled', async () => {
    const config = ConfigSchema.parse({
      lastRun: { read: false, write: false },
    });

    // getMergeBase
    mockedExeca.mockResolvedValueOnce({
      stdout: 'merge-base-hash',
    } as never);
    // getChangedFiles
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // No getCurrentHead call expected
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,

      rules: [],
    });

    expect(result.commitLastRunHash).toBeUndefined();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('populates changedFilesByRule correctly', async () => {
    setupGitMocks({
      changedFiles: ['src/api/routes.ts', 'src/utils.ts', 'docs/README.md'],
    });
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const rules = makeRules();
    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: baseConfig,

      rules,
    });

    const globalRuleFiles = result.changedFilesByRule.get(rules[0]?.id ?? '');
    const apiRuleFiles = result.changedFilesByRule.get(rules[1]?.id ?? '');
    const srcRuleFiles = result.changedFilesByRule.get(rules[2]?.id ?? '');

    // Global rule sees all files
    expect(globalRuleFiles).toContain('src/api/routes.ts');
    expect(globalRuleFiles).toContain('src/utils.ts');
    expect(globalRuleFiles).toContain('docs/README.md');
    // API rule only sees src/api/ files
    expect(apiRuleFiles).toEqual(['src/api/routes.ts']);
    // Src rule sees all src/ files
    expect(srcRuleFiles).toContain('src/api/routes.ts');
    expect(srcRuleFiles).toContain('src/utils.ts');
    expect(srcRuleFiles).not.toContain('docs/README.md');
  });

  it('filters out globally ignored files from changedFiles', async () => {
    // getMergeBase
    mockedExeca.mockResolvedValueOnce({
      stdout: 'merge-base-hash',
    } as never);
    // getChangedFiles
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nnode_modules/pkg/index.js\ndist/bundle.js',
    } as never);
    // getCurrentHead
    mockedExeca.mockResolvedValueOnce({
      stdout: 'head-hash',
    } as never);

    // Mock ignore filter that ignores node_modules/ and dist/
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: (f: string) =>
        f.startsWith('node_modules/') || f.startsWith('dist/'),
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: baseConfig,

      rules: makeRules(),
    });

    expect(result.changedFiles).toEqual(['src/foo.ts']);
    expect(result.changedFiles).not.toContain('node_modules/pkg/index.js');
    expect(result.changedFiles).not.toContain('dist/bundle.js');
  });
});
