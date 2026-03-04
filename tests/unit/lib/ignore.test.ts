import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildIgnoreFilter, buildInclusionFilter, filterFiles } from '../../../src/lib/ignore.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `prosecheck-ignore-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('buildIgnoreFilter', () => {
  it('matches inline globalIgnore patterns', async () => {
    const ig = await buildIgnoreFilter(tmpDir, ['node_modules/', 'dist/'], []);

    expect(ig.ignores('node_modules/foo.js')).toBe(true);
    expect(ig.ignores('dist/index.js')).toBe(true);
    expect(ig.ignores('src/index.ts')).toBe(false);
  });

  it('combines globalIgnore with additionalIgnore file patterns', async () => {
    await writeFile(path.join(tmpDir, '.gitignore'), 'coverage/\n*.log\n');

    const ig = await buildIgnoreFilter(tmpDir, ['node_modules/'], ['.gitignore']);

    expect(ig.ignores('node_modules/foo.js')).toBe(true);
    expect(ig.ignores('coverage/report.html')).toBe(true);
    expect(ig.ignores('debug.log')).toBe(true);
    expect(ig.ignores('src/index.ts')).toBe(false);
  });

  it('handles missing additionalIgnore files gracefully', async () => {
    // .gitignore doesn't exist — should not throw
    const ig = await buildIgnoreFilter(tmpDir, ['node_modules/'], ['.gitignore']);

    expect(ig.ignores('node_modules/foo.js')).toBe(true);
    expect(ig.ignores('src/index.ts')).toBe(false);
  });

  it('handles empty globalIgnore and additionalIgnore', async () => {
    const ig = await buildIgnoreFilter(tmpDir, [], []);

    // Nothing is ignored
    expect(ig.ignores('anything.ts')).toBe(false);
  });

  it('reads multiple additionalIgnore files', async () => {
    await writeFile(path.join(tmpDir, '.gitignore'), 'coverage/\n');
    await writeFile(path.join(tmpDir, '.eslintignore'), 'dist/\n');

    const ig = await buildIgnoreFilter(tmpDir, [], ['.gitignore', '.eslintignore']);

    expect(ig.ignores('coverage/report.html')).toBe(true);
    expect(ig.ignores('dist/index.js')).toBe(true);
  });
});

describe('buildInclusionFilter', () => {
  it('matches files under inclusion directory', () => {
    const filter = buildInclusionFilter(['src/api/']);

    expect(filter('src/api/routes.ts')).toBe(true);
    expect(filter('src/api/handlers/auth.ts')).toBe(true);
    expect(filter('src/lib/utils.ts')).toBe(false);
  });

  it('returns true for everything when inclusions are empty', () => {
    const filter = buildInclusionFilter([]);

    expect(filter('anything.ts')).toBe(true);
    expect(filter('deep/nested/path.ts')).toBe(true);
  });

  it('supports multiple inclusion patterns', () => {
    const filter = buildInclusionFilter(['src/api/', 'src/lib/']);

    expect(filter('src/api/routes.ts')).toBe(true);
    expect(filter('src/lib/utils.ts')).toBe(true);
    expect(filter('src/db/queries.ts')).toBe(false);
  });
});

describe('filterFiles', () => {
  it('excludes globally ignored files and applies inclusions', async () => {
    const globalFilter = await buildIgnoreFilter(tmpDir, ['node_modules/', 'dist/'], []);

    const files = [
      'src/api/routes.ts',
      'src/lib/utils.ts',
      'node_modules/foo/index.js',
      'dist/index.js',
    ];

    const result = filterFiles(files, globalFilter, ['src/api/']);

    expect(result).toEqual(['src/api/routes.ts']);
  });

  it('keeps all non-ignored files when inclusions are empty', async () => {
    const globalFilter = await buildIgnoreFilter(tmpDir, ['node_modules/'], []);

    const files = ['src/foo.ts', 'src/bar.ts', 'node_modules/x.js'];
    const result = filterFiles(files, globalFilter, []);

    expect(result).toEqual(['src/foo.ts', 'src/bar.ts']);
  });
});
