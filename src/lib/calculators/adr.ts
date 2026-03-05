import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRule } from '../rule.js';
import type { Rule } from '../../types/index.js';
import {
  parseFrontmatter,
  extractGroupFromFrontmatter,
} from '../frontmatter.js';

export interface AdrOptions {
  /** Directory containing ADR markdown files. Defaults to 'docs/adr' */
  path?: string;
}

/**
 * Read ADR files from a directory and extract rules from those with a
 * `## Rules` heading. ADRs without this heading are documentation-only
 * and are skipped.
 */
export async function calculateAdr(
  projectRoot: string,
  options: AdrOptions = {},
): Promise<Rule[]> {
  const adrDir = options.path ?? 'docs/adr';
  const absoluteDir = path.join(projectRoot, adrDir);

  let entries: string[];
  try {
    entries = await readdir(absoluteDir);
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }

  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();

  const rules: Rule[] = [];

  for (const file of mdFiles) {
    const absolutePath = path.join(absoluteDir, file);
    const rawContent = await readFile(absolutePath, 'utf-8');
    const { data: frontmatterData, body } = parseFrontmatter(rawContent);
    const { group, rest } = extractGroupFromFrontmatter(frontmatterData);
    // Use posix join for the source path so rule IDs are consistent across
    // platforms (forward slashes always), while absolutePath uses OS-native
    // separators for actual filesystem access.
    const relativePath = path.posix.join(adrDir, file);
    const parsed = parseAdr(body, relativePath, { group, frontmatter: rest });
    if (parsed) {
      rules.push(parsed);
    }
  }

  return rules;
}

interface AdrMetadata {
  group?: string | undefined;
  frontmatter?: Record<string, unknown> | undefined;
}

/**
 * Parse an ADR file. Returns a Rule if the ADR has a `## Rules` heading,
 * otherwise returns undefined (documentation-only ADR).
 *
 * The ADR title (`# ...`) becomes the rule name. The content under `## Rules`
 * becomes the rule description. ADR-derived rules apply project-wide.
 */
export function parseAdr(
  content: string,
  source: string,
  metadata?: AdrMetadata,
): Rule | undefined {
  const lines = content.split('\n');

  // Extract title from the first `# ` heading
  let title: string | undefined;
  for (const line of lines) {
    const titleMatch = /^# (.+)$/.exec(line);
    const titleText = titleMatch?.[1];
    if (titleText !== undefined) {
      title = titleText.trim();
      break;
    }
  }

  if (title === undefined) {
    return undefined;
  }

  // Find the `## Rules` section
  const rulesContent = extractSection(lines, 'Rules');
  if (rulesContent === undefined) {
    return undefined;
  }

  // ADR rules apply project-wide (empty inclusions = all files)
  return createRule(title, rulesContent, [], source, {
    group: metadata?.group,
    frontmatter: metadata?.frontmatter,
  });
}

/**
 * Extract the content of a `## <heading>` section from lines.
 * Returns the text between the heading and the next `## ` heading (or EOF).
 * Returns undefined if the heading is not found.
 */
function extractSection(lines: string[], heading: string): string | undefined {
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (inSection) {
      // Stop at the next ## heading
      if (/^## /.test(line)) {
        break;
      }
      sectionLines.push(line);
    } else if (line.trim() === `## ${heading}`) {
      inSection = true;
    }
  }

  if (!inSection) {
    return undefined;
  }

  return sectionLines.join('\n').trim();
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
