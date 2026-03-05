import { parse as parseYaml } from 'yaml';

export interface FrontmatterResult {
  /** Parsed frontmatter fields, empty object if no frontmatter present */
  data: Record<string, unknown>;
  /** The markdown body after the frontmatter block */
  body: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)---[ \t]*\r?\n?/;

/**
 * Extract YAML frontmatter from a markdown string.
 *
 * Returns the parsed data and the remaining body. If no frontmatter
 * delimiter is found, returns an empty data object and the full content
 * as the body.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const match = FRONTMATTER_RE.exec(content);

  if (!match) {
    return { data: {}, body: content };
  }

  const yamlStr = match[1] ?? '';
  const body = content.slice(match[0].length);

  let data: unknown;
  try {
    data = parseYaml(yamlStr);
  } catch {
    // Invalid YAML — treat as no frontmatter
    return { data: {}, body: content };
  }

  // YAML can parse to null (empty frontmatter) or non-object types
  if (
    data === null ||
    data === undefined ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return { data: {}, body };
  }

  return { data: data as Record<string, unknown>, body };
}

/**
 * Extract the `group` field from frontmatter data and return
 * the remaining fields as a passthrough bag.
 */
export function extractGroupFromFrontmatter(data: Record<string, unknown>): {
  group: string | undefined;
  rest: Record<string, unknown>;
} {
  const { group, ...rest } = data;
  return {
    group: typeof group === 'string' ? group : undefined,
    rest,
  };
}
