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
export function parseFrontmatter(
  content: string,
  source?: string,
): FrontmatterResult {
  const match = FRONTMATTER_RE.exec(content);

  if (!match) {
    return { data: {}, body: content };
  }

  const yamlStr = match[1] ?? '';
  const body = content.slice(match[0].length);

  let data: unknown;
  try {
    data = parseYaml(yamlStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const where = source ? ` in ${source}` : '';
    console.error(
      `[prosecheck] Warning: invalid YAML frontmatter${where} (ignored): ${msg}`,
    );
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

export interface RuleMetadata {
  group: string | undefined;
  model: string | undefined;
  timeout: number | undefined;
  frontmatter: Record<string, unknown> | undefined;
  description: string;
}

/**
 * Extract per-rule frontmatter from a rule's description lines.
 *
 * If the lines (after skipping leading blanks) start with a `---` fenced
 * YAML block, the block is parsed and removed from the description.
 * The `group` field is extracted separately; remaining fields are returned
 * as `frontmatter`.
 */
export function extractRuleMetadata(
  descriptionLines: string[],
  source?: string,
): RuleMetadata {
  // Skip leading empty lines to find potential frontmatter
  let startIdx = 0;
  while (
    startIdx < descriptionLines.length &&
    descriptionLines[startIdx]?.trim() === ''
  ) {
    startIdx++;
  }

  const content = descriptionLines.slice(startIdx).join('\n');
  const { data, body } = parseFrontmatter(content, source);

  if (Object.keys(data).length === 0) {
    return {
      group: undefined,
      model: undefined,
      timeout: undefined,
      frontmatter: undefined,
      description: descriptionLines.join('\n').trim(),
    };
  }

  const { group, rest } = extractGroupFromFrontmatter(data);
  const { model, timeout, ...remaining } = rest;
  return {
    group,
    model: typeof model === 'string' ? model : undefined,
    timeout: typeof timeout === 'number' && timeout > 0 ? timeout : undefined,
    frontmatter: Object.keys(remaining).length > 0 ? remaining : undefined,
    description: body.trim(),
  };
}
