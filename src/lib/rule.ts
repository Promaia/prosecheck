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

/**
 * Return filter entries that do not match any rule by name (case-insensitive)
 * or by id (exact). Used to validate `--rules` before launching agents so
 * callers don't burn a run on a misspelled filter.
 */
export function findUnmatchedRuleFilters(
  rules: Rule[],
  filter: string[],
): string[] {
  const names = new Set(rules.map((r) => r.name.toLowerCase()));
  const ids = new Set(rules.map((r) => r.id));
  return filter.filter((f) => !names.has(f.toLowerCase()) && !ids.has(f));
}

export interface CreateRuleOptions {
  group?: string | undefined;
  model?: string | undefined;
  timeout?: number | undefined;
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
    ...(options?.model !== undefined ? { model: options.model } : {}),
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options?.frontmatter && Object.keys(options.frontmatter).length > 0
      ? { frontmatter: options.frontmatter }
      : {}),
  };
}
