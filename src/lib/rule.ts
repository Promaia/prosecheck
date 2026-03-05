import type { Rule } from '../types/index.js';

/**
 * Generate a stable, filesystem-safe ID slug from a rule name and source path.
 *
 * Examples:
 *   ("No console.log", "src/RULES.md") → "src-rules-md--no-console-log"
 *   ("Use Zod", "docs/adr/001-use-zod.md") → "docs-adr-001-use-zod-md--use-zod"
 */
export function makeRuleId(name: string, source: string): string {
  const slugify = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const sourceSlug = slugify(source);
  const nameSlug = slugify(name);

  return `${sourceSlug}--${nameSlug}`;
}

export interface CreateRuleOptions {
  group?: string | undefined;
  frontmatter?: Record<string, unknown> | undefined;
}

/**
 * Create a Rule object with a generated ID.
 */
export function createRule(
  name: string,
  description: string,
  inclusions: string[],
  source: string,
  options?: CreateRuleOptions,
): Rule {
  return {
    id: makeRuleId(name, source),
    name,
    description,
    inclusions,
    source,
    ...(options?.group !== undefined ? { group: options.group } : {}),
    ...(options?.frontmatter && Object.keys(options.frontmatter).length > 0
      ? { frontmatter: options.frontmatter }
      : {}),
  };
}
