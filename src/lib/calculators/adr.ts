import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRule } from '../rule.js';
import type { Rule } from '../../types/index.js';
import { extractRuleMetadata } from '../frontmatter.js';

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
    // Use posix join for the source path so rule IDs are consistent across
    // platforms (forward slashes always), while absolutePath uses OS-native
    // separators for actual filesystem access.
    const relativePath = path.posix.join(adrDir, file);
    const parsed = parseAdr(rawContent, relativePath);
    if (parsed) {
      rules.push(...parsed);
    }
  }

  return rules;
}

/**
 * Parse an ADR file. Returns Rule(s) if the ADR has a `## Rules` heading,
 * otherwise returns undefined (documentation-only ADR).
 *
 * If the `## Rules` section contains `### Subrule` headings, each becomes
 * a separate rule (like RULES.md but with ### instead of #). If there are
 * no ### headings, the entire section is one rule named after the ADR title.
 *
 * Each rule (or subrule) may have its own YAML frontmatter block immediately
 * after its heading (or at the start of the `## Rules` section for
 * single-rule ADRs). The `group` field controls execution grouping; other
 * fields are passed through as `frontmatter`.
 *
 * ADR-derived rules apply project-wide (empty inclusions).
 */
export function parseAdr(
  content: string,
  source: string,
): Rule[] | undefined {
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

  // Find the `## Rules` section lines
  const rulesSectionLines = extractSectionLines(lines, 'Rules');
  if (rulesSectionLines === undefined) {
    return undefined;
  }

  // Check if section has ### sub-headings
  const hasSubHeadings = rulesSectionLines.some((line) =>
    /^### .+$/.test(line),
  );

  if (!hasSubHeadings) {
    // Single rule: entire section as description, ADR title as name
    const meta = extractRuleMetadata(rulesSectionLines, source);
    return [
      createRule(title, meta.description, [], source, {
        group: meta.group,
        frontmatter: meta.frontmatter,
      }),
    ];
  }

  // Multiple sub-rules: each ### heading is a rule
  const rules: Rule[] = [];
  let currentName: string | undefined;
  let descriptionLines: string[] = [];

  for (const line of rulesSectionLines) {
    const subMatch = /^### (.+)$/.exec(line);
    const subText = subMatch?.[1];

    if (subText !== undefined) {
      // Flush previous sub-rule
      if (currentName !== undefined) {
        const meta = extractRuleMetadata(descriptionLines, source);
        rules.push(
          createRule(currentName, meta.description, [], source, {
            group: meta.group,
            frontmatter: meta.frontmatter,
          }),
        );
      }
      currentName = subText.trim();
      descriptionLines = [];
    } else if (currentName !== undefined) {
      descriptionLines.push(line);
    }
    // Lines before the first ### heading are ignored (preamble)
  }

  // Flush final sub-rule
  if (currentName !== undefined) {
    const meta = extractRuleMetadata(descriptionLines, source);
    rules.push(
      createRule(currentName, meta.description, [], source, {
        group: meta.group,
        frontmatter: meta.frontmatter,
      }),
    );
  }

  return rules.length > 0 ? rules : undefined;
}

/**
 * Extract the lines of a `## <heading>` section.
 * Returns the lines between the heading and the next `## ` heading (or EOF).
 * Returns undefined if the heading is not found.
 */
function extractSectionLines(
  lines: string[],
  heading: string,
): string[] | undefined {
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

  return sectionLines;
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
