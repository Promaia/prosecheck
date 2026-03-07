import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface FilesHashResult {
  /** Single digest of all in-scope file contents */
  filesHash: string;
  /** Per-file content hashes (path → hash), sorted by path */
  files: Record<string, string>;
}

/**
 * Compute a SHA-256 content hash for a single file.
 * Normalizes \r\n → \n before hashing for cross-platform consistency.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  const normalized = normalizeLineEndings(content);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Compute content hashes for a set of files relative to projectRoot.
 *
 * Returns a single digest (hash of sorted path:hash pairs) and the
 * per-file hash map. Files that cannot be read (deleted, permission
 * errors) are silently skipped.
 */
export async function computeFilesHash(
  projectRoot: string,
  filePaths: string[],
): Promise<FilesHashResult> {
  const sorted = [...filePaths].sort();
  const files: Record<string, string> = {};

  for (const relPath of sorted) {
    try {
      const absPath = path.join(projectRoot, relPath);
      files[relPath] = await computeFileHash(absPath);
    } catch {
      // File may have been deleted between detection and hashing — skip
    }
  }

  const filesHash = computeDigest(files);
  return { filesHash, files };
}

/**
 * Compute a single SHA-256 digest from a sorted map of path → hash pairs.
 * Deterministic: entries are sorted by path before hashing.
 */
export function computeDigest(files: Record<string, string>): string {
  const hash = createHash('sha256');
  const sortedKeys = Object.keys(files).sort();
  for (const key of sortedKeys) {
    hash.update(`${key}:${files[key] ?? ''}\n`);
  }
  return hash.digest('hex');
}

/**
 * Normalize line endings in a buffer: replace \r\n with \n.
 */
function normalizeLineEndings(buffer: Buffer): Buffer {
  // Fast path: no \r in the buffer
  if (!buffer.includes(0x0d)) {
    return buffer;
  }

  // Slow path: filter out \r that precedes \n
  const result: number[] = [];
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) {
      continue; // skip \r before \n
    }
    result.push(buffer[i] ?? 0);
  }
  return Buffer.from(result);
}
