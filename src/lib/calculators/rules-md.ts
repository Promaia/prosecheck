import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { createRule } from '../rule.js';
import type { Rule } from '../../types/index.js';
import { extractRuleMetadata } from '../frontmatter.js';

export interface RulesMdOptions {
  // Glob pattern for RULES.md files. Defaults to all RULES.md files recursively.
  pattern?: string;
  // Additional glob patterns to exclude from rule discovery.
  ignore?: string[];
}

/**
 * Discover RULES.md files in a project tree and parse them into rules.
 *
 * Each top-level `#` heading becomes a rule name. Content between headings
 * (including subheadings) becomes the rule description. The file's directory
 * becomes the rule's inclusion scope.
 *
 * Per-rule frontmatter (a `---` fenced YAML block immediately after the
 * heading) is supported. The `group` field controls execution grouping;
 * remaining fields are passed through as `frontmatter`.
 */
export async function calculateRulesMd(
  projectRoot: string,
  options: RulesMdOptions = {},
): Promise<Rule[]> {
  const pattern = options.pattern ?? '**/RULES.md';

  const defaultIgnore = ['node_modules/**', '.git/**'];
  const extraIgnore = (options.ignore ?? []).map((p) =>
    p.endsWith('/') ? `${p}**` : p,
  );

  const files = (
    await glob(pattern, {
      cwd: projectRoot,
      ignore: [...defaultIgnore, ...extraIgnore],
      posix: true,
    })
  ).sort();

  const rules: Rule[] = [];

  for (const file of files) {
    const absolutePath = path.join(projectRoot, file);
    const rawContent = await readFile(absolutePath, 'utf-8');
    const parsed = parseRulesMd(rawContent, file);
    rules.push(...parsed);
  }

  return rules;
}

/**
 * Detect whether rules are delimited by `#` or `##` headings.
 *
 * If the first heading in the file is exactly `# Rules`, the file uses
 * section mode: `##` headings delimit rules and the `# Rules` heading is
 * not itself a rule. Otherwise, `#` headings delimit rules (original
 * behaviour).
 */
function detectHeadingLevel(lines: string[]): { level: 1 | 2; skip: number } {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // First heading in the file decides the mode
    if (/^#{1,6} /.test(line)) {
      if (/^# Rules\s*$/.test(line)) {
        return { level: 2, skip: i };
      }
      return { level: 1, skip: -1 };
    }
  }
  return { level: 1, skip: -1 };
}

/**
 * Parse a RULES.md file into rules.
 *
 * Rules are delimited by headings whose level is auto-detected:
 * - If the first heading is `# Rules`, then `##` headings delimit rules
 *   (section mode). The `# Rules` line is skipped.
 * - Otherwise, `#` headings delimit rules (original behaviour).
 *
 * Content before the first rule heading is ignored. Deeper subheadings are
 * part of the description.
 *
 * Each rule may have its own YAML frontmatter block immediately after its
 * heading. The `group` field controls execution grouping; other fields are
 * passed through as `frontmatter`.
 */
export function parseRulesMd(content: string, source: string): Rule[] {
  const lines = content.split('\n');
  const rules: Rule[] = [];

  const { level, skip } = detectHeadingLevel(lines);
  const headingPattern = level === 1 ? /^# (.+)$/ : /^## (.+)$/;

  let currentName: string | undefined;
  let descriptionLines: string[] = [];
  const dir = path.dirname(source);
  // Use the directory as inclusion scope — root means everything
  const inclusions = dir === '.' ? [] : [`${dir}/`];

  for (let i = 0; i < lines.length; i++) {
    if (i === skip) continue; // skip the `# Rules` line in section mode

    const line = lines[i] ?? '';
    const headingMatch = headingPattern.exec(line);
    const headingText = headingMatch?.[1];

    if (headingText !== undefined) {
      // Flush previous rule
      if (currentName !== undefined) {
        const meta = extractRuleMetadata(descriptionLines, source);
        rules.push(
          createRule(currentName, meta.description, inclusions, source, {
            group: meta.group,
            model: meta.model,
            frontmatter: meta.frontmatter,
          }),
        );
      }

      currentName = headingText.trim();
      descriptionLines = [];
    } else if (currentName !== undefined) {
      descriptionLines.push(line);
    }
    // Lines before the first heading are ignored
  }

  // Flush final rule
  if (currentName !== undefined) {
    const meta = extractRuleMetadata(descriptionLines, source);
    rules.push(
      createRule(currentName, meta.description, inclusions, source, {
        group: meta.group,
        model: meta.model,
        frontmatter: meta.frontmatter,
      }),
    );
  }

  return rules;
}
