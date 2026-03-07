import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import {
  detectChanges,
  getMergeBase,
  getChangedFiles,
  getCurrentHead,
  readLastRunHash,
  writeLastRunData,
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

// Mock content-hash to avoid real file I/O
vi.mock('../../../src/lib/content-hash.js', () => ({
  computeFilesHash: vi.fn().mockResolvedValue({
    filesHash: 'mock-digest',
    files: {},
  }),
  computeDigest: vi.fn().mockReturnValue('mock-digest'),
}));

import { execa } from 'execa';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildIgnoreFilter } from '../../../src/lib/ignore.js';
import { computeFilesHash } from '../../../src/lib/content-hash.js';

const mockedExeca = vi.mocked(execa);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedBuildIgnoreFilter = vi.mocked(buildIgnoreFilter);
const mockedComputeFilesHash = vi.mocked(computeFilesHash);

const PROJECT_ROOT = '/fake/project';

beforeEach(() => {
  vi.resetAllMocks();
  // Re-establish content-hash mock after resetAllMocks
  mockedComputeFilesHash.mockResolvedValue({
    filesHash: 'mock-digest',
    files: {},
  });
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
  it('returns list of changed files including untracked', async () => {
    // git diff --name-only
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nsrc/bar.ts\n',
    } as never);
    // git ls-files --others --exclude-standard
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/new-file.ts\n',
    } as never);

    const result = await getChangedFiles(PROJECT_ROOT, 'abc123');

    expect(result).toContain('src/foo.ts');
    expect(result).toContain('src/bar.ts');
    expect(result).toContain('src/new-file.ts');
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'abc123'],
      { cwd: PROJECT_ROOT },
    );
  });

  it('returns empty array when no changes and no untracked', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);

    const result = await getChangedFiles(PROJECT_ROOT, 'abc123');

    expect(result).toEqual([]);
  });

  it('deduplicates files that appear in both diff and untracked', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
    mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);

    const result = await getChangedFiles(PROJECT_ROOT, 'abc123');

    expect(result).toEqual(['src/foo.ts']);
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
  it('reads commitHash from JSON format', async () => {
    mockedReadFile.mockResolvedValueOnce(
      '{"commitHash":"abc123","filesHash":"xyz"}\n',
    );

    const result = await readLastRunHash(PROJECT_ROOT);

    expect(result).toBe('abc123');
  });

  it('reads the hash from legacy plain-text format', async () => {
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

describe('writeLastRunData', () => {
  it('writes compact JSON with commitHash', async () => {
    mockedMkdir.mockResolvedValueOnce(undefined);
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await writeLastRunData(PROJECT_ROOT, { commitHash: 'abc123' });

    expect(mockedMkdir).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck'),
      { recursive: true },
    );
    expect(mockedWriteFile).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck/last-user-run'),
      '{"commitHash":"abc123"}\n',
      'utf-8',
    );
  });

  it('includes filesHash and files when provided', async () => {
    mockedMkdir.mockResolvedValueOnce(undefined);
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await writeLastRunData(PROJECT_ROOT, {
      commitHash: 'abc123',
      filesHash: 'digest456',
      files: { 'src/foo.ts': 'hash1' },
    });

    const written = mockedWriteFile.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(parsed['commitHash']).toBe('abc123');
    expect(parsed['filesHash']).toBe('digest456');
    expect(parsed['files']).toEqual({ 'src/foo.ts': 'hash1' });
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
    trackedFiles?: string[];
    head?: string;
    skipMergeBase?: boolean;
  }) {
    const mergeBase = opts.mergeBase ?? 'merge-base-hash';
    const changedFiles = opts.changedFiles ?? [];
    const trackedFiles = opts.trackedFiles ?? changedFiles;

    // getMergeBase (skipped when explicit comparisonRef is provided)
    if (!opts.skipMergeBase) {
      mockedExeca.mockResolvedValueOnce({ stdout: mergeBase } as never);
    }
    // collectInScopeFiles: git ls-files (tracked)
    mockedExeca.mockResolvedValueOnce({
      stdout: trackedFiles.join('\n'),
    } as never);
    // collectInScopeFiles: git ls-files --others (untracked)
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // getChangedFiles: git diff --name-only
    mockedExeca.mockResolvedValueOnce({
      stdout: changedFiles.join('\n'),
    } as never);
    // getChangedFiles: git ls-files --others (untracked)
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // getCurrentHead — only mocked when head is explicitly provided (for lastRun.write tests)
    if (opts.head !== undefined) {
      mockedExeca.mockResolvedValueOnce({ stdout: opts.head } as never);
    }
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
    setupGitMocks({
      skipMergeBase: true,
      changedFiles: ['src/foo.ts'],
    });
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
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'explicit-ref'],
      { cwd: PROJECT_ROOT },
    );
  });

  it('reads last-run commitHash when lastRun.read is enabled', async () => {
    const ciConfig = ConfigSchema.parse({
      lastRun: { read: true, write: false, files: false },
    });

    // getMergeBase
    mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
    // collectInScopeFiles: git ls-files (tracked)
    mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
    // collectInScopeFiles: git ls-files --others
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // readLastRunData — JSON format with commitHash only (no filesHash)
    mockedReadFile.mockResolvedValueOnce('{"commitHash":"aabbccdd1122"}\n');
    // getChangedFiles: git diff (should use commitHash)
    mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
    // getChangedFiles: git ls-files --others
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
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
      lastRun: { read: true, write: false, files: false },
    });

    // getMergeBase
    mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
    // collectInScopeFiles: git ls-files
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // collectInScopeFiles: git ls-files --others
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // readLastRunData — file missing
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockedReadFile.mockRejectedValueOnce(error);
    // getChangedFiles: git diff (falls back to merge-base)
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // getChangedFiles: git ls-files --others
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    mockedBuildIgnoreFilter.mockResolvedValueOnce({
      ignores: () => false,
    } as never);

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config: ciConfig,
      rules: makeRules(),
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'merge-base-hash'],
      { cwd: PROJECT_ROOT },
    );
    expect(result.comparisonRef).toBe('merge-base-hash');
  });

  it('returns commitLastRunHash callback when lastRun.write is enabled', async () => {
    const config = ConfigSchema.parse({
      lastRun: { read: false, write: true, files: false },
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
    // getCurrentHead call inside the deferred writer
    mockedExeca.mockResolvedValueOnce({ stdout: 'new-head-hash' } as never);
    mockedMkdir.mockResolvedValueOnce(undefined);
    mockedWriteFile.mockResolvedValueOnce(undefined);
    const commit = result.commitLastRunHash;
    expect(commit).toBeDefined();
    if (commit) await commit();

    // Should write JSON format with commitHash and filesHash
    expect(mockedWriteFile).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, '.prosecheck/last-user-run'),
      expect.stringContaining('"commitHash":"new-head-hash"'),
      'utf-8',
    );
  });

  it('does not return commitLastRunHash when lastRun.write is disabled', async () => {
    const config = ConfigSchema.parse({
      lastRun: { read: false, write: false, files: false },
    });

    setupGitMocks({ changedFiles: [] });
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

  describe('tiered fallback detection', () => {
    it('Tier 1: uses stored per-file hashes to detect changes', async () => {
      const config = ConfigSchema.parse({
        lastRun: { read: true, write: false, files: false },
      });

      // getMergeBase
      mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
      // collectInScopeFiles: git ls-files (tracked)
      mockedExeca.mockResolvedValueOnce({
        stdout: 'src/foo.ts\nsrc/bar.ts',
      } as never);
      // collectInScopeFiles: git ls-files --others
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
      // readLastRunData — JSON with per-file hashes
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          commitHash: 'old-hash',
          filesHash: 'old-digest',
          files: { 'src/foo.ts': 'hash-unchanged', 'src/bar.ts': 'hash-old' },
        }) + '\n',
      );
      // computeFilesHash returns current hashes (bar.ts changed)
      mockedComputeFilesHash.mockResolvedValueOnce({
        filesHash: 'new-digest',
        files: {
          'src/foo.ts': 'hash-unchanged',
          'src/bar.ts': 'hash-new',
        },
      });

      mockedBuildIgnoreFilter.mockResolvedValueOnce({
        ignores: () => false,
      } as never);

      const rules = [
        createRule('Src Rule', 'Src-wide', ['src/'], 'src/RULES.md'),
      ];
      const result = await detectChanges({
        projectRoot: PROJECT_ROOT,
        config,
        rules,
      });

      // Should detect bar.ts as changed via file hash diff (Tier 1)
      expect(result.changedFiles).toContain('src/bar.ts');
      expect(result.changedFiles).not.toContain('src/foo.ts');
      expect(result.triggeredRules).toHaveLength(1);
      // Should NOT have called git diff (skipped Tier 3)
      const diffCalls = mockedExeca.mock.calls.filter(
        (c) => c[0] === 'git' && (c[1] as string[])[0] === 'diff',
      );
      expect(diffCalls).toHaveLength(0);
    });

    it('Tier 2: skips all rules when digest matches (no per-file detail)', async () => {
      const config = ConfigSchema.parse({
        lastRun: { read: true, write: false, files: false },
      });

      // getMergeBase
      mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
      // collectInScopeFiles: git ls-files
      mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
      // collectInScopeFiles: git ls-files --others
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
      // readLastRunData — JSON with filesHash only, no files map
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          commitHash: 'old-hash',
          filesHash: 'same-digest',
        }) + '\n',
      );
      // computeFilesHash returns matching digest
      mockedComputeFilesHash.mockResolvedValueOnce({
        filesHash: 'same-digest',
        files: { 'src/foo.ts': 'hash1' },
      });

      mockedBuildIgnoreFilter.mockResolvedValueOnce({
        ignores: () => false,
      } as never);

      const rules = makeRules();
      const result = await detectChanges({
        projectRoot: PROJECT_ROOT,
        config,
        rules,
      });

      // Digest matches → no rules triggered
      expect(result.triggeredRules).toHaveLength(0);
      expect(result.changedFiles).toHaveLength(0);
      // Should NOT have called git diff
      const diffCalls = mockedExeca.mock.calls.filter(
        (c) => c[0] === 'git' && (c[1] as string[])[0] === 'diff',
      );
      expect(diffCalls).toHaveLength(0);
    });

    it('Tier 2→3: falls through to git-based when digest mismatches', async () => {
      const config = ConfigSchema.parse({
        lastRun: { read: true, write: false, files: false },
      });

      // getMergeBase
      mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
      // collectInScopeFiles: git ls-files
      mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
      // collectInScopeFiles: git ls-files --others
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
      // readLastRunData — JSON with filesHash only (no files map), different digest
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          commitHash: 'stored-commit',
          filesHash: 'old-digest',
        }) + '\n',
      );
      // computeFilesHash returns different digest
      mockedComputeFilesHash.mockResolvedValueOnce({
        filesHash: 'new-digest',
        files: { 'src/foo.ts': 'hash1' },
      });
      // getChangedFiles: git diff (should use stored commitHash)
      mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
      // getChangedFiles: git ls-files --others
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);

      mockedBuildIgnoreFilter.mockResolvedValueOnce({
        ignores: () => false,
      } as never);

      const rules = makeRules();
      const result = await detectChanges({
        projectRoot: PROJECT_ROOT,
        config,
        rules,
      });

      // Should have fallen through to git diff with stored commitHash
      expect(mockedExeca).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-only', 'stored-commit'],
        { cwd: PROJECT_ROOT },
      );
      expect(result.triggeredRules.length).toBeGreaterThan(0);
    });

    it('Tier 1: detects removed files', async () => {
      const config = ConfigSchema.parse({
        lastRun: { read: true, write: false, files: false },
      });

      // getMergeBase
      mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
      // collectInScopeFiles: git ls-files (only foo.ts remains)
      mockedExeca.mockResolvedValueOnce({ stdout: 'src/foo.ts' } as never);
      // collectInScopeFiles: git ls-files --others
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
      // readLastRunData — stored hashes include bar.ts which no longer exists
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          commitHash: 'old-hash',
          filesHash: 'old-digest',
          files: {
            'src/foo.ts': 'hash-foo',
            'src/bar.ts': 'hash-bar',
          },
        }) + '\n',
      );
      // computeFilesHash returns only foo.ts (bar.ts removed)
      mockedComputeFilesHash.mockResolvedValueOnce({
        filesHash: 'new-digest',
        files: { 'src/foo.ts': 'hash-foo' },
      });

      mockedBuildIgnoreFilter.mockResolvedValueOnce({
        ignores: () => false,
      } as never);

      const rules = [
        createRule('Src Rule', 'Src-wide', ['src/'], 'src/RULES.md'),
      ];
      const result = await detectChanges({
        projectRoot: PROJECT_ROOT,
        config,
        rules,
      });

      // bar.ts was removed → shows as changed
      expect(result.changedFiles).toContain('src/bar.ts');
      expect(result.triggeredRules).toHaveLength(1);
    });
  });

  it('filters out globally ignored files from changedFiles', async () => {
    // getMergeBase
    mockedExeca.mockResolvedValueOnce({ stdout: 'merge-base-hash' } as never);
    // collectInScopeFiles: git ls-files
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nnode_modules/pkg/index.js\ndist/bundle.js',
    } as never);
    // collectInScopeFiles: git ls-files --others
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // getChangedFiles: git diff
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nnode_modules/pkg/index.js\ndist/bundle.js',
    } as never);
    // getChangedFiles: git ls-files --others
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);

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
