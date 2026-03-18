/**
 * Normalizes raw AI output into the canonical result schema shape.
 *
 * This module applies mechanical fixes for common AI mistakes:
 * field name aliases, type coercions, missing fields that can be
 * inferred from context, and structural corrections (e.g. wrapping
 * a single comment object in an array).
 *
 * Runs AFTER JSON.parse but BEFORE Zod validation.
 */

export interface NormalizeContext {
  /** Rule ID (from the output filename) */
  ruleId: string;
  /** Rule source file path */
  ruleSource: string;
  /** Project root for stripping absolute paths */
  projectRoot?: string;
}

// --- Alias maps ---

const STATUS_SYNONYMS: Record<string, string> = {
  passed: 'pass',
  success: 'pass',
  ok: 'pass',
  failed: 'fail',
  error: 'fail',
  violation: 'fail',
  warning: 'warn',
};

const RULE_ALIASES = ['ruleId', 'ruleName', 'rule_name', 'rule_id', 'name'];
const SOURCE_ALIASES = ['ruleSource', 'source_file', 'sourceFile'];
const HEADLINE_ALIASES = ['title', 'summary', 'description', 'message'];
const COMMENTS_ALIASES = [
  'comment',
  'violations',
  'issues',
  'findings',
  'errors',
];
const COMMENT_MESSAGE_ALIASES = ['text', 'detail', 'description', 'comment'];
const COMMENT_FILE_ALIASES = [
  'path',
  'filePath',
  'file_path',
  'filename',
  'fileName',
];
const COMMENT_LINE_ALIASES = ['lineNumber', 'line_number', 'lineNo'];

// --- Helpers ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Remove a known key from a record. */
function removeKey(obj: Record<string, unknown>, key: string): void {
  Reflect.deleteProperty(obj, key);
}

/** Pick the first alias that exists on the object, then delete it. */
function pickAlias(
  obj: Record<string, unknown>,
  canonical: string,
  aliases: string[],
): void {
  if (obj[canonical] !== undefined) return;
  for (const alias of aliases) {
    if (obj[alias] !== undefined) {
      obj[canonical] = obj[alias];
      removeKey(obj, alias);
      return;
    }
  }
}

function normalizePath(p: string, projectRoot?: string): string {
  let result = p.replaceAll('\\', '/');
  if (projectRoot) {
    const prefix = projectRoot.replaceAll('\\', '/').replace(/\/$/, '') + '/';
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length);
    }
  }
  return result;
}

function coerceLine(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  let num: number;
  if (typeof value === 'string') {
    // Handle range strings like "10-15" — take the start
    const rangeMatch = value.match(/^(\d+)/);
    if (rangeMatch) {
      num = Number(rangeMatch[1]);
    } else {
      return undefined;
    }
  } else if (typeof value === 'number') {
    num = value;
  } else {
    return undefined;
  }

  num = Math.floor(num);
  return Math.max(1, num);
}

// --- Comment normalization ---

function normalizeComment(
  raw: unknown,
  projectRoot?: string,
): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    return { message: raw };
  }
  if (!isRecord(raw)) return null;

  const comment = { ...raw };

  // message aliases
  pickAlias(comment, 'message', COMMENT_MESSAGE_ALIASES);
  if (comment['message'] === undefined) {
    comment['message'] = '(no message)';
  }

  // file aliases
  pickAlias(comment, 'file', COMMENT_FILE_ALIASES);
  if (typeof comment['file'] === 'string') {
    comment['file'] = normalizePath(comment['file'], projectRoot);
  }

  // line aliases and coercion
  pickAlias(comment, 'line', COMMENT_LINE_ALIASES);
  if (comment['line'] !== undefined) {
    const coerced = coerceLine(comment['line']);
    if (coerced !== undefined) {
      comment['line'] = coerced;
    } else {
      delete comment['line'];
    }
  }

  return comment;
}

function normalizeComments(
  raw: unknown,
  projectRoot?: string,
): Record<string, unknown>[] | undefined {
  if (raw === undefined || raw === null) return undefined;

  // Single object → wrap in array
  if (isRecord(raw)) {
    const c = normalizeComment(raw, projectRoot);
    return c ? [c] : undefined;
  }

  if (!Array.isArray(raw)) return undefined;

  // Array of strings or objects
  const results: Record<string, unknown>[] = [];
  for (const item of raw) {
    const c = normalizeComment(item, projectRoot);
    if (c) results.push(c);
  }
  return results.length > 0 ? results : [];
}

// --- Main normalization ---

/**
 * Normalize a parsed-but-unvalidated object into canonical result shape.
 * Returns the normalized plain object (or the input unchanged if not a record).
 */
export function normalizeResult(
  raw: unknown,
  context: NormalizeContext,
): unknown {
  if (!isRecord(raw)) return raw;

  const obj = { ...raw };

  // --- status ---
  if (typeof obj['status'] === 'string') {
    const lower = obj['status'].toLowerCase();
    obj['status'] = STATUS_SYNONYMS[lower] ?? lower;
  }

  // --- rule ---
  pickAlias(obj, 'rule', RULE_ALIASES);
  if (obj['rule'] === undefined) {
    obj['rule'] = context.ruleId;
  }

  // --- source ---
  pickAlias(obj, 'source', SOURCE_ALIASES);
  if (obj['source'] === undefined) {
    obj['source'] = context.ruleSource;
  }
  if (typeof obj['source'] === 'string') {
    obj['source'] = normalizePath(obj['source']);
  }

  const status = obj['status'];
  const isWarnOrFail = status === 'warn' || status === 'fail';

  // --- comments (warn/fail) ---
  if (isWarnOrFail) {
    // Resolve comments aliases
    pickAlias(obj, 'comments', COMMENTS_ALIASES);

    // Normalize comments array
    const normalized = normalizeComments(obj['comments'], context.projectRoot);
    if (normalized !== undefined) {
      obj['comments'] = normalized;
    }

    // Empty comments on warn → downgrade to pass
    if (
      Array.isArray(obj['comments']) &&
      obj['comments'].length === 0 &&
      status === 'warn'
    ) {
      obj['status'] = 'pass';
    }
  }

  // --- headline (warn/fail) ---
  if (obj['status'] === 'warn' || obj['status'] === 'fail') {
    pickAlias(obj, 'headline', HEADLINE_ALIASES);

    // Synthesize from first comment if missing
    if (obj['headline'] === undefined && Array.isArray(obj['comments'])) {
      const first: unknown = obj['comments'][0];
      if (isRecord(first) && typeof first['message'] === 'string') {
        const msg = first['message'];
        obj['headline'] = msg.length > 120 ? msg.slice(0, 117) + '...' : msg;
      }
    }
  }

  // --- comment (pass-only) ---
  if (obj['status'] === 'pass') {
    // If comment is an array (confused with comments), extract first message
    if (Array.isArray(obj['comment'])) {
      const first: unknown = obj['comment'][0];
      if (typeof first === 'string') {
        obj['comment'] = first;
      } else if (isRecord(first) && typeof first['message'] === 'string') {
        obj['comment'] = first['message'];
      } else {
        removeKey(obj, 'comment');
      }
    }
    // Accept "comments" as alias for "comment" if it's a string on pass
    if (obj['comment'] === undefined && typeof obj['comments'] === 'string') {
      obj['comment'] = obj['comments'];
      removeKey(obj, 'comments');
    }
  }

  return obj;
}
