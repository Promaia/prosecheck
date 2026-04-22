import { createHash } from 'node:crypto';
import type { Rule } from '../types/index.js';

export interface FingerprintInputs {
  /** The default prompt template (custom or built-in) */
  promptTemplate: string;
  /** The global system prompt (undefined if not present) */
  globalPrompt: string | undefined;
}

/**
 * Compute a stable fingerprint over everything — besides file content — that
 * could change a rule's verdict: the rule's own text, inclusions, model,
 * frontmatter, the prompt template, and the global system prompt.
 *
 * A fingerprint mismatch invalidates the cached pass entry for a rule so the
 * rule re-evaluates on the next run.
 */
export function computeRuleFingerprint(
  rule: Rule,
  inputs: FingerprintInputs,
): string {
  const payload = {
    name: rule.name,
    description: rule.description,
    inclusions: [...rule.inclusions].sort(),
    model: rule.model ?? null,
    frontmatter: rule.frontmatter ?? null,
    promptTemplate: inputs.promptTemplate,
    globalPrompt: inputs.globalPrompt ?? null,
  };
  const hash = createHash('sha256');
  hash.update(stableStringify(payload));
  return hash.digest('hex');
}

/**
 * JSON.stringify with recursively sorted object keys. Ensures that the same
 * logical value produces the same string regardless of key insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          stableStringify((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}
