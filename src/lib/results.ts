import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RuleResultSchema } from './config-schema.js';
import type { RuleResult } from './config-schema.js';
import type { Rule, RuleStatus } from '../types/index.js';
import { normalizeResult } from './normalize-result.js';
import type { NormalizeContext } from './normalize-result.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

/** Status severity ordering: higher index = worse */
const STATUS_SEVERITY: RuleStatus[] = ['pass', 'warn', 'dropped', 'fail'];

export interface DroppedRule {
  rule: Rule;
  attempt: number;
}

export interface CollectResultsOptions {
  /** Project root directory */
  projectRoot: string;
  /** Rules that were expected to produce output */
  expectedRules: Rule[];
}

export interface CollectResultsOutput {
  /** Successfully parsed results */
  results: RuleResultWithId[];
  /** Rules that produced no output file */
  dropped: DroppedRule[];
  /** Rules that produced malformed output */
  errors: ResultError[];
  /** Overall worst status across all results and dropped rules */
  overallStatus: RuleStatus;
}

export interface RuleResultWithId {
  ruleId: string;
  result: RuleResult;
}

export interface ResultError {
  ruleId: string;
  ruleName: string;
  message: string;
}

/**
 * Sanitize common LLM output quirks before JSON parsing.
 * Transforms: BOM removal, markdown fence extraction,
 * trailing text truncation, comment stripping, trailing comma
 * removal, single-quote fixing, whitespace trimming.
 */
export function sanitizeAgentOutput(content: string): string {
  // Strip UTF-8 BOM
  let cleaned = content.replace(/^\uFEFF/, '');

  // Extract from markdown fences: ```json\n...\n``` or ```\n...\n```
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch?.[1]) {
    cleaned = fenceMatch[1];
  }

  // Strip trailing text after JSON — find last } and truncate
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace !== -1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  // Strip single-line comments (// ...) — but not inside strings
  cleaned = stripJsonComments(cleaned);

  // Strip trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // Fix single-quoted strings → double-quoted
  cleaned = fixSingleQuotes(cleaned);

  // Trim whitespace
  return cleaned.trim();
}

/**
 * Strip // and /* comments from JSON-like text, preserving string contents.
 */
function stripJsonComments(input: string): string {
  let result = '';
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    const next = input.charAt(i + 1);
    // String literal — pass through unchanged
    if (ch === '"') {
      result += '"';
      i++;
      while (i < input.length && input.charAt(i) !== '"') {
        if (input.charAt(i) === '\\') {
          result += input.charAt(i) + input.charAt(i + 1);
          i += 2;
        } else {
          result += input.charAt(i);
          i++;
        }
      }
      if (i < input.length) {
        result += '"';
        i++;
      }
    }
    // Single-line comment
    else if (ch === '/' && next === '/') {
      // Skip to end of line
      while (i < input.length && input.charAt(i) !== '\n') i++;
    }
    // Block comment
    else if (ch === '/' && next === '*') {
      i += 2;
      while (
        i < input.length &&
        !(input.charAt(i) === '*' && input.charAt(i + 1) === '/')
      )
        i++;
      i += 2; // skip */
    }
    // Normal character
    else {
      result += ch;
      i++;
    }
  }
  return result;
}

/**
 * Replace single-quoted JSON strings with double-quoted.
 * Only applies when the input looks like it uses single quotes for all keys/values.
 */
function fixSingleQuotes(input: string): string {
  // Only attempt if there are single quotes and no double quotes around values
  // (to avoid breaking apostrophes in normal double-quoted JSON)
  if (input.includes('"')) return input;

  // Replace single quotes with double quotes
  return input.replace(/'/g, '"');
}

/**
 * Parse and validate a single output file.
 * Applies sanitization, normalization, then Zod validation.
 * Returns the validated RuleResult or an error message.
 */
export function parseResultFile(
  content: string,
  ruleId: string,
  context?: NormalizeContext,
): { ok: true; result: RuleResult } | { ok: false; message: string } {
  const sanitized = sanitizeAgentOutput(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    const preview = content.slice(0, 200);
    return {
      ok: false,
      message: `Output for rule "${ruleId}" is not valid JSON. Input preview: ${preview}`,
    };
  }

  // Normalize common AI mistakes before schema validation
  const normalized = context
    ? normalizeResult(parsed, context)
    : normalizeResult(parsed, { ruleId, ruleSource: '' });

  const validation = RuleResultSchema.safeParse(normalized);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    return {
      ok: false,
      message: `Output for rule "${ruleId}" failed schema validation:\n${issues}`,
    };
  }

  return { ok: true, result: validation.data };
}

/**
 * Collect and validate all agent output files for the expected rules.
 */
export async function collectResults(
  options: CollectResultsOptions,
): Promise<CollectResultsOutput> {
  const { projectRoot, expectedRules } = options;
  const outputsDir = path.join(projectRoot, OUTPUTS_DIR);

  const results: RuleResultWithId[] = [];
  const dropped: DroppedRule[] = [];
  const errors: ResultError[] = [];

  // Get set of existing output files
  let existingFiles: Set<string>;
  try {
    const files = await readdir(outputsDir);
    existingFiles = new Set(files);
  } catch {
    // If directory doesn't exist, all rules are dropped
    existingFiles = new Set();
  }

  for (const rule of expectedRules) {
    const outputFile = `${rule.id}.json`;

    if (!existingFiles.has(outputFile)) {
      dropped.push({ rule, attempt: 1 });
      continue;
    }

    const filePath = path.join(outputsDir, outputFile);
    const content = await readFile(filePath, 'utf-8');
    const context: NormalizeContext = {
      ruleId: rule.id,
      ruleSource: rule.source,
      projectRoot,
    };
    const parsed = parseResultFile(content, rule.id, context);

    if (parsed.ok) {
      // Write normalized JSON back so external tools see a consistent shape
      await writeFile(
        filePath,
        JSON.stringify(parsed.result, null, 2) + '\n',
        'utf-8',
      );
      results.push({ ruleId: rule.id, result: parsed.result });
    } else {
      errors.push({
        ruleId: rule.id,
        ruleName: rule.name,
        message: parsed.message,
      });
    }
  }

  const overallStatus = computeOverallStatus(results, dropped, errors);

  return { results, dropped, errors, overallStatus };
}

/**
 * Determine the overall run status from individual results and dropped rules.
 * Severity order: fail > dropped > warn > pass.
 * Errors (malformed output) are treated as "fail".
 */
export function computeOverallStatus(
  results: RuleResultWithId[],
  dropped: DroppedRule[],
  errors: ResultError[],
): RuleStatus {
  let worst: RuleStatus = 'pass';

  for (const { result } of results) {
    if (severityOf(result.status) > severityOf(worst)) {
      worst = result.status;
    }
  }

  if (dropped.length > 0 && severityOf('dropped') > severityOf(worst)) {
    worst = 'dropped';
  }

  if (errors.length > 0 && severityOf('fail') > severityOf(worst)) {
    worst = 'fail';
  }

  return worst;
}

function severityOf(status: RuleStatus): number {
  return STATUS_SEVERITY.indexOf(status);
}
