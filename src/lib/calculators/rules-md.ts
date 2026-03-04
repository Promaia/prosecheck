import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { createRule } from '../rule.js';
import type { Rule } from '../../types/index.js';

export interface RulesMdOptions {
  // Glob pattern for RULES.md files. Defaults to all RULES.md files recursively.
  pattern?: string;
}

/**
 * Discover RULES.md files in a project tree and parse them into rules.
 *
 * Each top-level `#` heading becomes a rule name. Content between headings
 * (including subheadings) becomes the rule description. The file's directory
 * becomes the rule's inclusion scope.
 */
export async function calculateRulesMd(
  projectRoot: string,
  options: RulesMdOptions = {},
): Promise<Rule[]> {
  const pattern = options.pattern ?? '**/RULES.md';

  const files = (
    await glob(pattern, {
      cwd: projectRoot,
      ignore: ['node_modules/**', '.git/**'],
      posix: true,
    })
  ).sort();

  const rules: Rule[] = [];

  for (const file of files) {
    const absolutePath = path.join(projectRoot, file);
    const content = await readFile(absolutePath, 'utf-8');
    const parsed = parseRulesMd(content, file);
    rules.push(...parsed);
  }

  return rules;
}

/**
 * Parse a RULES.md file into rules.
 *
 * Rules are delimited by top-level `# ` headings. Content before the first
 * heading is ignored. Subheadings (`##`, `###`, etc.) are part of the
 * description.
 */
export function parseRulesMd(content: string, source: string): Rule[] {
  const lines = content.split('\n');
  const rules: Rule[] = [];

  let currentName: string | undefined;
  let descriptionLines: string[] = [];
  const dir = path.dirname(source);
  // Use the directory as inclusion scope — root means everything
  const inclusions = dir === '.' ? [] : [`${dir}/`];

  for (const line of lines) {
    // Match top-level heading only (# Title), not ## or deeper
    const headingMatch = /^# (.+)$/.exec(line);
    const headingText = headingMatch?.[1];

    if (headingText !== undefined) {
      // Flush previous rule
      if (currentName !== undefined) {
        rules.push(
          createRule(currentName, descriptionLines.join('\n').trim(), inclusions, source),
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
    rules.push(
      createRule(currentName, descriptionLines.join('\n').trim(), inclusions, source),
    );
  }

  return rules;
}
