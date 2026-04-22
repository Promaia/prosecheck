import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectChanges,
  getMergeBase,
  getChangedFiles,
  getCurrentHead,
  readLastRunData,
  writeLastRunData,
} from '../../../src/lib/change-detection.js';
import type { LastRunData } from '../../../src/lib/change-detection.js';
import { ConfigSchema } from '../../../src/lib/config-schema.js';
import type { Rule } from '../../../src/types/index.js';

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

// Pass through buildInclusionFilter, mock buildIgnoreFilter to a no-op allowlist
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

// Mock content-hash — the test writes per-call values into this mock
vi.mock('../../../src/lib/content-hash.js', () => ({
  computeFilesHash: vi.fn().mockResolvedValue({
    filesHash: 'mock-digest',
    files: {},
  }),
  computeDigest: vi.fn().mockReturnValue('mock-digest'),
}));

import { execa } from 'execa';
import { readFile, writeFile } from 'node:fs/promises';
import { computeFilesHash } from '../../../src/lib/content-hash.js';
import { buildIgnoreFilter } from '../../../src/lib/ignore.js';

const mockedExeca = vi.mocked(execa);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedComputeFilesHash = vi.mocked(computeFilesHash);
const mockedBuildIgnoreFilter = vi.mocked(buildIgnoreFilter);

const PROJECT_ROOT = '/fake/project';

function makeRule(over: Partial<Rule> & { id: string; name: string }): Rule {
  return {
    id: over.id,
    name: over.name,
    description: over.description ?? 'desc',
    inclusions: over.inclusions ?? ['src/**'],
    source: over.source ?? 'RULES.md',
  };
}

function makeConfig(over: Record<string, unknown> = {}) {
  return ConfigSchema.parse({
    lastRun: { read: true, write: true },
    ...over,
  });
}

function mockListAllFiles(files: string[]): void {
  // listAllFiles: git ls-files (tracked) + git ls-files --others (untracked)
  mockedExeca.mockResolvedValueOnce({
    stdout: files.join('\n') + '\n',
  } as never);
  mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
}

function mockMergeBase(sha: string): void {
  mockedExeca.mockResolvedValueOnce({ stdout: sha + '\n' } as never);
}

function mockLastRunFile(data: LastRunData | null): void {
  if (data === null) {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockedReadFile.mockRejectedValueOnce(err);
  } else {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(data));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedComputeFilesHash.mockResolvedValue({
    filesHash: 'mock-digest',
    files: {},
  });
  mockedBuildIgnoreFilter.mockResolvedValue({
    ignores: () => false,
  } as unknown as ReturnType<typeof buildIgnoreFilter> extends Promise<infer R>
    ? R
    : never);
});

describe('getMergeBase', () => {
  it('returns the merge-base hash', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'abc123\n' } as never);
    expect(await getMergeBase(PROJECT_ROOT, 'main')).toBe('abc123');
  });

  it('falls back to branch name when merge-base fails', async () => {
    mockedExeca.mockRejectedValueOnce(new Error('not a repo'));
    expect(await getMergeBase(PROJECT_ROOT, 'main')).toBe('main');
  });
});

describe('getChangedFiles', () => {
  it('merges diff and untracked', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'a.ts\nb.ts\n' } as never);
    mockedExeca.mockResolvedValueOnce({ stdout: 'c.ts\n' } as never);
    const files = await getChangedFiles(PROJECT_ROOT, 'abc');
    expect(files.sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('getCurrentHead', () => {
  it('returns trimmed stdout', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'deadbeef\n' } as never);
    expect(await getCurrentHead(PROJECT_ROOT)).toBe('deadbeef');
  });
});

describe('readLastRunData / writeLastRunData', () => {
  it('returns undefined when file is missing', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockedReadFile.mockRejectedValueOnce(err);
    expect(await readLastRunData(PROJECT_ROOT)).toBeUndefined();
  });

  it('returns undefined when file contents are not valid JSON', async () => {
    mockedReadFile.mockResolvedValueOnce('not json');
    expect(await readLastRunData(PROJECT_ROOT)).toBeUndefined();
  });

  it('returns undefined when schema does not match', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ foo: 'bar' }));
    expect(await readLastRunData(PROJECT_ROOT)).toBeUndefined();
  });

  it('parses rule entries from stored data', async () => {
    const stored: LastRunData = {
      rules: {
        'rule-a': {
          files: { 'src/foo.ts': 'hash1' },
          fingerprint: 'fp1',
          status: 'pass',
        },
      },
    };
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await readLastRunData(PROJECT_ROOT);
    expect(result).toEqual(stored);
  });

  it('writes compact JSON to .prosecheck/last-user-run', async () => {
    mockedWriteFile.mockResolvedValueOnce(undefined);
    await writeLastRunData(PROJECT_ROOT, {
      rules: {
        'rule-a': { files: {}, fingerprint: 'fp', status: 'pass' },
      },
    });
    expect(mockedWriteFile).toHaveBeenCalled();
    const [, content] = mockedWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain('"rules"');
    expect(content).toContain('rule-a');
  });
});

describe('detectChanges — lastRun.read off (legacy narrowing)', () => {
  it('uses git diff and per-rule inclusion to pick triggered rules', async () => {
    const rule = makeRule({ id: 'r1', name: 'R1', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: false, write: false } });

    mockMergeBase('base-sha');
    // getChangedFiles: diff + untracked
    mockedExeca.mockResolvedValueOnce({
      stdout: 'src/foo.ts\ndocs/readme.md\n',
    } as never);
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    // listAllFiles: not used in legacy branch — but detectChanges still calls it (filesByRule built up front).
    mockListAllFiles(['src/foo.ts', 'docs/readme.md']);
    // computeFilesHash for inScope set
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h' },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules).toEqual([rule]);
    expect(result.changedFilesByRule.get('r1')).toEqual(['src/foo.ts']);
    expect(result.cachedRules).toEqual([]);
    expect(result.writeRuleCacheEntries).toBeUndefined();
  });

  it('does not return writeRuleCacheEntries when lastRun.write is off', async () => {
    const rule = makeRule({ id: 'r1', name: 'R1', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: false, write: false } });

    mockMergeBase('base');
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    mockedExeca.mockResolvedValueOnce({ stdout: '' } as never);
    mockListAllFiles([]);
    mockedComputeFilesHash.mockResolvedValueOnce({ filesHash: 'd', files: {} });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.writeRuleCacheEntries).toBeUndefined();
  });
});

describe('detectChanges — per-rule cache (lastRun.read on)', () => {
  it('triggers all rules when no prior state exists', async () => {
    const ruleA = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const ruleB = makeRule({ id: 'b', name: 'B', inclusions: ['docs/**'] });
    const config = makeConfig({ lastRun: { read: true, write: true } });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts', 'docs/readme.md']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h1', 'docs/readme.md': 'h2' },
    });
    mockLastRunFile(null); // no file

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [ruleA, ruleB],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(result.cachedRules).toEqual([]);
    expect(result.writeRuleCacheEntries).toBeDefined();
  });

  it('skips a rule whose fingerprint and file hashes are unchanged', async () => {
    const rule = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: true, write: true } });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h-current' },
    });

    // Compute the expected fingerprint via the production function
    const { computeRuleFingerprint } =
      await import('../../../src/lib/fingerprint.js');
    const fp = computeRuleFingerprint(rule, {
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h-current' },
          fingerprint: fp,
          status: 'pass',
        },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules).toEqual([]);
    expect(result.cachedRules.map((r) => r.id)).toEqual(['a']);
  });

  it('triggers when fingerprint changes (rule text edit)', async () => {
    const rule = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: true, write: false } });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h1' },
    });
    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h1' },
          fingerprint: 'stale-fp',
          status: 'pass',
        },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules.map((r) => r.id)).toEqual(['a']);
    expect(result.cachedRules).toEqual([]);
  });

  it('triggers when an in-scope file changes', async () => {
    const rule = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: true, write: false } });
    const { computeRuleFingerprint } =
      await import('../../../src/lib/fingerprint.js');
    const fp = computeRuleFingerprint(rule, {
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h-new' },
    });
    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h-old' },
          fingerprint: fp,
          status: 'pass',
        },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules.map((r) => r.id)).toEqual(['a']);
    expect(result.changedFilesByRule.get('a')).toEqual(['src/foo.ts']);
  });

  it('does not trigger when only out-of-scope files change', async () => {
    const rule = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: true, write: false } });
    const { computeRuleFingerprint } =
      await import('../../../src/lib/fingerprint.js');
    const fp = computeRuleFingerprint(rule, {
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts', 'docs/readme.md']);
    // src/foo.ts unchanged, docs/readme.md changed — but docs/ is out of scope
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h1', 'docs/readme.md': 'new' },
    });
    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h1' },
          fingerprint: fp,
          status: 'pass',
        },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules).toEqual([]);
    expect(result.cachedRules.map((r) => r.id)).toEqual(['a']);
  });

  it('handles in-scope file removal (stored file no longer exists)', async () => {
    const rule = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: true, write: false } });
    const { computeRuleFingerprint } =
      await import('../../../src/lib/fingerprint.js');
    const fp = computeRuleFingerprint(rule, {
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h1' },
    });
    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h1', 'src/deleted.ts': 'h2' },
          fingerprint: fp,
          status: 'pass',
        },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules.map((r) => r.id)).toEqual(['a']);
  });

  it('writeRuleCacheEntries updates only triggered rules', async () => {
    const ruleA = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const ruleB = makeRule({ id: 'b', name: 'B', inclusions: ['docs/**'] });
    const config = makeConfig({ lastRun: { read: true, write: true } });
    const { computeRuleFingerprint } =
      await import('../../../src/lib/fingerprint.js');
    const fpB = computeRuleFingerprint(ruleB, {
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts', 'docs/readme.md']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h-new', 'docs/readme.md': 'h-same' },
    });
    // Initial read: rule A stale, rule B current
    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h-old' },
          fingerprint: 'old-fp',
          status: 'pass',
        },
        b: {
          files: { 'docs/readme.md': 'h-same' },
          fingerprint: fpB,
          status: 'pass',
        },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [ruleA, ruleB],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    expect(result.triggeredRules.map((r) => r.id)).toEqual(['a']);
    expect(result.cachedRules.map((r) => r.id)).toEqual(['b']);
    expect(result.writeRuleCacheEntries).toBeDefined();

    // Cache writer re-reads existing, updates rule A only
    mockLastRunFile({
      rules: {
        a: {
          files: { 'src/foo.ts': 'h-old' },
          fingerprint: 'old-fp',
          status: 'pass',
        },
        b: {
          files: { 'docs/readme.md': 'h-same' },
          fingerprint: fpB,
          status: 'pass',
        },
      },
    });
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await result.writeRuleCacheEntries?.(new Set(['a']));

    const writeCall = mockedWriteFile.mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall?.[1] as string) as LastRunData;
    // rule A updated with new hashes
    expect(written.rules['a']?.files).toEqual({ 'src/foo.ts': 'h-new' });
    // rule B untouched
    expect(written.rules['b']?.fingerprint).toBe(fpB);
  });

  it('writeRuleCacheEntries deletes triggered rules that did not pass', async () => {
    const rule = makeRule({ id: 'a', name: 'A', inclusions: ['src/**'] });
    const config = makeConfig({ lastRun: { read: true, write: true } });

    mockMergeBase('base');
    mockListAllFiles(['src/foo.ts']);
    mockedComputeFilesHash.mockResolvedValueOnce({
      filesHash: 'd',
      files: { 'src/foo.ts': 'h1' },
    });
    mockLastRunFile({
      rules: {
        a: { files: {}, fingerprint: 'old', status: 'pass' },
      },
    });

    const result = await detectChanges({
      projectRoot: PROJECT_ROOT,
      config,
      rules: [rule],
      promptTemplate: 'tpl',
      globalPrompt: undefined,
    });

    mockLastRunFile({
      rules: {
        a: { files: {}, fingerprint: 'old', status: 'pass' },
      },
    });
    mockedWriteFile.mockResolvedValueOnce(undefined);

    // Rule ran but did not pass → entry should be deleted
    await result.writeRuleCacheEntries?.(new Set());

    const written = JSON.parse(
      mockedWriteFile.mock.calls[0]?.[1] as string,
    ) as LastRunData;
    expect(written.rules).toEqual({});
  });
});
