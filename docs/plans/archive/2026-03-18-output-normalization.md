# Output Normalization Plan

## Problem

AI agents produce imperfect JSON output. The current pipeline rejects anything that doesn't exactly match the Zod schema, causing unnecessary failures. We want a normalization step that fixes common AI mistakes before validation, and writes the normalized version back to disk so external tools see a consistent shape.

## Current flow

```
agent writes file → sanitizeAgentOutput (BOM, fences, trailing text) → JSON.parse → Zod safeParse → accept or reject
```

## Proposed flow

```
agent writes file → sanitizeAgentOutput (BOM, fences, trailing text, lenient JSON) → JSON.parse → normalizeResult(parsed, context) → Zod safeParse → write normalized JSON back → accept or reject
```

## Normalization rules

### JSON-level (in sanitizeAgentOutput)

| Error | Fix |
|---|---|
| Trailing commas | Strip them |
| Single-quoted strings | Replace with double quotes (careful with apostrophes inside values) |
| `//` and `/* */` comments | Strip them |
| Unquoted keys | Not handled (too fragile) |

### Field-level (in normalizeResult)

#### `status`
- Lowercase the value
- Map synonyms: `"passed"`/`"success"`/`"ok"` → `"pass"`, `"failed"`/`"error"`/`"violation"` → `"fail"`, `"warning"` → `"warn"`

#### `rule`
- Accept aliases: `ruleId`, `ruleName`, `rule_name`, `rule_id`, `name` (only if `rule` missing)
- If still missing, inject from `context.ruleId`

#### `source`
- Accept aliases: `ruleSource`, `source_file`, `sourceFile`
- If still missing, inject from `context.ruleSource`
- Normalize backslashes to forward slashes

#### `headline`
- Accept aliases: `title`, `summary`, `description`, `message` (only if `headline` missing and status is warn/fail)
- If still missing on warn/fail but `comments` exists, synthesize from first comment message (truncated to 120 chars)

#### `comment` (pass-only)
- If value is an array, take first element's message or stringify
- Accept `comments` as alias if it's a string on a pass result

#### `comments` (warn/fail)
- Accept aliases: `comment` (if array), `violations`, `issues`, `findings`, `errors`
- If single object (not array), wrap in array
- If array of strings, convert each to `{ message: str }`
- If empty array on warn, downgrade status to pass
- If empty array on fail, downgrade status to warn (still flagged, but not hard fail)

#### `comments[].message`
- Accept aliases: `text`, `detail`, `description`, `comment`

#### `comments[].file`
- Accept aliases: `path`, `filePath`, `file_path`, `filename`, `fileName`
- Normalize backslashes to forward slashes
- Strip absolute project-root prefix if present

#### `comments[].line`
- Accept aliases: `lineNumber`, `line_number`, `lineNo`
- Coerce strings to integers: `"42"` → `42`
- Floor floats: `42.0` → `42`
- Clamp to minimum 1: `0` → `1`
- Range strings: `"10-15"` → `10` (take start)

## Implementation

### New file: `src/lib/normalize-result.ts`

Exports:
- `normalizeResult(raw: unknown, context: NormalizeContext): unknown` — takes a parsed-but-unvalidated object and returns a normalized plain object ready for Zod validation
- `NormalizeContext` interface: `{ ruleId: string; ruleSource: string; projectRoot?: string }`

### Changes to `src/lib/results.ts`

1. `sanitizeAgentOutput` — add trailing comma stripping, comment stripping, single-quote fixing
2. `parseResultFile` — accept a `NormalizeContext`, call `normalizeResult` between `JSON.parse` and `Zod.safeParse`
3. `collectResults` — pass context when calling `parseResultFile`, write normalized JSON back to disk after successful parse

### Test file: `tests/unit/lib/normalize-result.test.ts`

Cover each normalization rule with unit tests. The existing `results-robustness.test.ts` tests that expect rejection of trailing commas, comments, and single quotes should be updated to expect success (since normalization now handles them).

## Non-goals

- Recovering from completely non-JSON output (plain English responses) — these still fail
- Guessing intent from ambiguous structures — normalization is mechanical, not semantic
- Handling multiple concatenated JSON objects — still undefined behavior
