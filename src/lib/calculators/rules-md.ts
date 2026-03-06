import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { createRule } from '../rule.js';
import type { Rule } from '../../types/index.js';
import {
  parseFrontmatter,
  extractGroupFromFrontmatter,
} from '../frontmatter.js';

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
    const { data: frontmatterData, body } = parseFrontmatter(rawContent);
    const { group: fileGroup, rest: fileRest } =
      extractGroupFromFrontmatter(frontmatterData);
    const parsed = parseRulesMd(body, file, {
      group: fileGroup,
      frontmatter: fileRest,
    });
    rules.push(...parsed);
  }

  return rules;
}

interface FileMetadata {
  group?: string | undefined;
  frontmatter?: Record<string, unknown> | undefined;
}

/**
 * Parse a RULES.md file into rules.
 *
 * Rules are delimited by top-level `# ` headings. Content before the first
 * heading is ignored. Subheadings (`##`, `###`, etc.) are part of the
 * description.
 *
 * File-level frontmatter metadata (group, extra fields) is applied to all
 * rules in the file.
 */
export function parseRulesMd(
  content: string,
  source: string,
  metadata?: FileMetadata,
): Rule[] {
  const lines = content.split('\n');
  const rules: Rule[] = [];

  let currentName: string | undefined;
  let descriptionLines: string[] = [];
  const dir = path.dirname(source);
  // Use the directory as inclusion scope — root means everything
  const inclusions = dir === '.' ? [] : [`${dir}/`];

  const ruleOptions = {
    group: metadata?.group,
    frontmatter: metadata?.frontmatter,
  };

  for (const line of lines) {
    // Match top-level heading only (# Title), not ## or deeper
    const headingMatch = /^# (.+)$/.exec(line);
    const headingText = headingMatch?.[1];

    if (headingText !== undefined) {
      // Flush previous rule
      if (currentName !== undefined) {
        rules.push(
          createRule(
            currentName,
            descriptionLines.join('\n').trim(),
            inclusions,
            source,
            ruleOptions,
          ),
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
      createRule(
        currentName,
        descriptionLines.join('\n').trim(),
        inclusions,
        source,
        ruleOptions,
      ),
    );
  }

  return rules;
}
