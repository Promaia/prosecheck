import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  computeFileHash,
  computeFilesHash,
  computeDigest,
} from '../../../src/lib/content-hash.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-hash-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('computeFileHash', () => {
  it('returns a SHA-256 hex string', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello world\n', 'utf-8');

    const hash = await computeFileHash(filePath);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes CRLF to LF before hashing', async () => {
    const lfPath = path.join(tmpDir, 'lf.txt');
    const crlfPath = path.join(tmpDir, 'crlf.txt');

    await writeFile(lfPath, Buffer.from('line1\nline2\n'));
    await writeFile(crlfPath, Buffer.from('line1\r\nline2\r\n'));

    const lfHash = await computeFileHash(lfPath);
    const crlfHash = await computeFileHash(crlfPath);

    expect(lfHash).toBe(crlfHash);
  });

  it('preserves standalone CR (not followed by LF)', async () => {
    const crPath = path.join(tmpDir, 'cr.txt');
    const plainPath = path.join(tmpDir, 'plain.txt');

    await writeFile(crPath, Buffer.from('line1\rline2'));
    await writeFile(plainPath, Buffer.from('line1\rline2'));

    const crHash = await computeFileHash(crPath);
    const plainHash = await computeFileHash(plainPath);

    expect(crHash).toBe(plainHash);
  });

  it('produces different hashes for different content', async () => {
    const a = path.join(tmpDir, 'a.txt');
    const b = path.join(tmpDir, 'b.txt');

    await writeFile(a, 'hello', 'utf-8');
    await writeFile(b, 'world', 'utf-8');

    const hashA = await computeFileHash(a);
    const hashB = await computeFileHash(b);

    expect(hashA).not.toBe(hashB);
  });
});

describe('computeFilesHash', () => {
  it('returns filesHash and per-file map', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), 'aaa', 'utf-8');
    await writeFile(path.join(tmpDir, 'b.txt'), 'bbb', 'utf-8');

    const result = await computeFilesHash(tmpDir, ['a.txt', 'b.txt']);

    expect(result.filesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(result.files)).toEqual(['a.txt', 'b.txt']);
    expect(result.files['a.txt']).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files['b.txt']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic regardless of input order', async () => {
    await writeFile(path.join(tmpDir, 'x.txt'), 'xxx', 'utf-8');
    await writeFile(path.join(tmpDir, 'y.txt'), 'yyy', 'utf-8');

    const result1 = await computeFilesHash(tmpDir, ['x.txt', 'y.txt']);
    const result2 = await computeFilesHash(tmpDir, ['y.txt', 'x.txt']);

    expect(result1.filesHash).toBe(result2.filesHash);
  });

  it('returns a consistent hash for empty file set', async () => {
    const result = await computeFilesHash(tmpDir, []);

    expect(result.filesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files).toEqual({});
  });

  it('silently skips files that cannot be read', async () => {
    await writeFile(path.join(tmpDir, 'exists.txt'), 'ok', 'utf-8');

    const result = await computeFilesHash(tmpDir, [
      'exists.txt',
      'missing.txt',
    ]);

    expect(Object.keys(result.files)).toEqual(['exists.txt']);
  });

  it('detects changed content', async () => {
    await writeFile(path.join(tmpDir, 'file.txt'), 'version1', 'utf-8');
    const before = await computeFilesHash(tmpDir, ['file.txt']);

    await writeFile(path.join(tmpDir, 'file.txt'), 'version2', 'utf-8');
    const after = await computeFilesHash(tmpDir, ['file.txt']);

    expect(before.filesHash).not.toBe(after.filesHash);
    expect(before.files['file.txt']).not.toBe(after.files['file.txt']);
  });
});

describe('computeDigest', () => {
  it('produces deterministic output for same inputs', () => {
    const files = { 'a.txt': 'hash1', 'b.txt': 'hash2' };
    const d1 = computeDigest(files);
    const d2 = computeDigest(files);

    expect(d1).toBe(d2);
  });

  it('is order-independent (sorted internally)', () => {
    const d1 = computeDigest({ 'b.txt': 'hash2', 'a.txt': 'hash1' });
    const d2 = computeDigest({ 'a.txt': 'hash1', 'b.txt': 'hash2' });

    expect(d1).toBe(d2);
  });

  it('produces different digests for different inputs', () => {
    const d1 = computeDigest({ 'a.txt': 'hash1' });
    const d2 = computeDigest({ 'a.txt': 'hash2' });

    expect(d1).not.toBe(d2);
  });

  it('handles empty input', () => {
    const d = computeDigest({});
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });
});
