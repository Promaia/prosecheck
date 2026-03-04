import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/**
 * Build a global ignore filter from config settings.
 *
 * Combines inline `globalIgnore` patterns with patterns read from
 * `additionalIgnore` files (e.g., .gitignore). Missing files in
 * `additionalIgnore` are silently skipped.
 */
export async function buildIgnoreFilter(
  projectRoot: string,
  globalIgnore: string[],
  additionalIgnore: string[],
): Promise<Ignore> {
  const ig = ignore();

  // Add inline global patterns
  if (globalIgnore.length > 0) {
    ig.add(globalIgnore);
  }

  // Read and add patterns from external ignore files
  for (const ignoreFile of additionalIgnore) {
    const filePath = path.resolve(projectRoot, ignoreFile);
    try {
      const content = await readFile(filePath, 'utf-8');
      ig.add(content);
    } catch (error: unknown) {
      // Silently skip missing files
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
  }

  return ig;
}

/**
 * Build an inclusion filter from a rule's inclusion patterns.
 * Returns a predicate that checks if a file path is within the rule's scope.
 *
 * Uses the `ignore` package (gitignore semantics) so directory patterns like
 * "src/api/" match all files under that directory.
 */
export function buildInclusionFilter(inclusions: string[]): (filePath: string) => boolean {
  if (inclusions.length === 0) {
    // No inclusions means the rule applies to everything
    return () => true;
  }

  const ig = ignore();
  ig.add(inclusions);

  return (filePath: string) => ig.ignores(filePath);
}

/**
 * Filter a list of file paths: keep only those that are NOT globally ignored
 * AND ARE included by the rule's inclusion patterns.
 */
export function filterFiles(
  files: string[],
  globalFilter: Ignore,
  inclusions: string[],
): string[] {
  const inclusionFilter = buildInclusionFilter(inclusions);

  return files.filter((file) => {
    // Skip globally ignored files
    if (globalFilter.ignores(file)) return false;
    // Keep only files matching the rule's inclusions
    return inclusionFilter(file);
  });
}
