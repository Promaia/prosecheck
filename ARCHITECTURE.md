# Architecture

This document describes the architecture of prosecheck, an LLM-powered code linter with natural-language rules. Sections marked **[PLANNED]** are designed but not yet implemented. Sections marked **[STUB]** have file structure in place but no implementation code.

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (cli.ts)                             │
│  Commander arg parsing → environment + mode resolution          │
├─────────────────────────────────────────────────────────────────┤
│                     Commands Layer                              │
│  lint.ts (main flow)              init.ts (scaffolding)         │
├─────────────────────────────────────────────────────────────────┤
│                     Engine (engine.ts)                          │
│  Orchestrator: rules → prompts → dispatch → collect → report   │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│  Config  │  Rules   │ Prompts  │  Modes   │  Results            │
│ Loading  │ Discovery│ Generate │ Execute  │  Collection         │
│ +Layering│ (calcs)  │          │          │  +Formatting        │
└──────────┴──────────┴──────────┴──────────┴─────────────────────┘
```

All source files are TypeScript (strict mode, ESM-only, Node >= 20). The project builds with tsup and tests with vitest.

---

## Entry Points

### `src/cli.ts` — CLI Binary **[STUB]**

Commander-based argument parsing. Resolves environment (`--env`) and operating mode (`--mode`) as orthogonal concerns. Sets `process.exitCode` (never `process.exit()`) for graceful cleanup.

**Exit codes:** 0 = all passed, 1 = rule failures, 2 = tool/config error.

### `src/index.ts` — Library API **[STUB]**

Programmatic entry point. Exports core types and the engine for use as a library dependency.

---

## Commands

### `src/commands/lint.ts` — Lint Command **[STUB]**

Main flow: load config → discover rules → detect changes → filter rules by scope → generate prompts → execute via mode → collect results → format output → post-run tasks.

### `src/commands/init.ts` — Init Command **[STUB]**

Scaffolds `.prosecheck/` directory with default `config.json`, adds entries to `.gitignore`, and optionally creates a starter `RULES.md`.

### `src/commands/config.ts` — Config Editor Command **[PLANNED]**

Interactive terminal UI for viewing and editing `.prosecheck/config.json`. Walks the Zod `ConfigSchema` at runtime to discover all fields — their names, types, descriptions (from `.describe()`), defaults (from `.default()`), and constraints. Renders an interactive editor using Ink components where users can browse fields, see current values vs defaults, and modify settings. Writes validated JSON back to `config.json`. No hardcoded field list — the editor is entirely schema-driven, so new config fields added to the Zod schema automatically appear in the editor.

---

## Core Library (`src/lib/`)

### `config-schema.ts` — Zod Config Schema [IMPLEMENTED]

Single source of truth for configuration shape, types, defaults, and documentation. Defines:

- **`ConfigSchema`** — full Zod schema with `.describe()` on every field and `.default()` for all defaults. Sub-schemas (`LastRunSchema`, `ClaudeCodeSchema`, `CalculatorConfigSchema`, `EnvironmentOverrideSchema`) compose into the top-level schema.
- **`PartialConfig` type** — TypeScript mapped type for overlay layers (Zod v4 has no `.deepPartial()`).
- **`Config` type** — `z.infer<typeof ConfigSchema>`, the TypeScript type used throughout the codebase. No separate type definition.
- **`RuleResultSchema`** — discriminated union (`pass | warn | fail`) for agent output JSON validation.

The schema serves four roles: TypeScript type inference, runtime validation with actionable error messages, default value declaration, and runtime introspection for the config editor command.

### `config.ts` — Configuration Loading [IMPLEMENTED]

Loads and layers configuration with four-level precedence:

1. `.prosecheck/config.json` — base defaults (committed)
2. `.prosecheck/config.local.json` — personal overrides (gitignored)
3. Environment overrides — named block from `config.environments[env]`
4. CLI flags — highest priority

Deep merge at each layer (arrays replaced, not concatenated). Base config validated with `ConfigSchema.safeParse()`, local config deep-merged without separate schema validation, final merged result validated with `ConfigSchema`. Invalid config throws `ConfigError` with Zod's structured error paths.

Environment is resolved from `--env` flag, `process.env.CI` auto-detection, or `interactive` default.

Key config fields: `baseBranch`, `globalIgnore`, `additionalIgnore`, `lastRun`, `timeout`, `warnAsError`, `retryDropped`, `retryDroppedMaxAttempts`, `claudeCode`, `postRun`, `environments`, `ruleCalculators`.

### `engine.ts` — Orchestrator **[STUB]**

Central coordinator that drives the lint pipeline:

1. Cleanup `.prosecheck/working/`
2. Run rule calculators → collect all rules
3. Run change detection → get changed files
4. Match changed files to rule scopes → select triggered rules
5. Generate per-rule prompts
6. Dispatch to operating mode
7. Collect results (with dropped detection + optional retry)
8. Format and report
9. Execute post-run tasks
10. Set exit code

### `change-detection.ts` — Git Diff & File Filtering **[STUB]**

Runs `git diff --name-only` against the comparison ref (default: merge-base with `baseBranch`). Maps changed files to parent directories. Supports incremental tracking via `.prosecheck/last-user-run`.

Default last-run behavior by environment:

| | Interactive | CI |
|---|---|---|
| Read last-run | No | Yes |
| Write last-run | Yes | No |

### `ignore.ts` — Pattern Matching [IMPLEMENTED]

Uses the `ignore` npm package for gitignore-format pattern matching. `buildIgnoreFilter()` combines `globalIgnore` inline patterns with patterns from `additionalIgnore` files (defaults to `.gitignore`). `buildInclusionFilter()` creates per-rule scope predicates. `filterFiles()` applies both filters. Applied globally before per-rule inclusions.

### `rule.ts` — Rule Types [IMPLEMENTED]

Type definitions and factory functions for rules. Each rule has: name, description (natural language), inclusions (gitignore patterns), source reference (originating file), and a stable filesystem-safe ID slug generated by `makeRuleId()`.

### `prompt.ts` — Prompt Generation **[STUB]**

Generates per-rule prompt files at `.prosecheck/working/prompts/<rule-id>.md`. Each prompt includes:

- Rule text (full natural-language description)
- Comparison ref (git ref to diff against)
- Changed files list (modifications, additions, deletions)
- Scope (inclusion patterns)
- Output path (`.prosecheck/working/outputs/<rule-id>.json`)
- General guidance (evaluate full codebase within scope, output JSON only)

Template is configurable via `.prosecheck/prompt-template.md`. Global system prompt from `.prosecheck/prompt.md` is prepended.

### `results.ts` — Result Collection **[STUB]**

Collects agent output JSON files. Each file is validated against `RuleResultSchema` (Zod) — malformed agent output produces clear errors rather than downstream crashes. Detects dropped rules (no output). Orchestrates retries when `retryDropped` is enabled. Determines overall run status from worst individual status: fail > dropped > warn > pass.

### `post-run.ts` — Post-Run Tasks **[STUB]**

Executes shell commands from `config.postRun` array after results collection. Injects environment variables: `PROSECHECK_STATUS`, `PROSECHECK_RESULTS_DIR`, `PROSECHECK_RESULTS_JSON`.

---

## Rule Calculators (`src/lib/calculators/`)

Pluggable modules that discover rules from different sources. Declared in `config.ruleCalculators` array. Interface: `(options) → Rule[]`.

### `index.ts` — Calculator Registry **[STUB]**

Dispatches to named calculators based on config. Supports `enabled: false` to disable individual calculators.

### `rules-md.ts` — RULES.md Calculator **[STUB]**

Discovers `RULES.md` files throughout the project tree. Parses top-level `#` headings as rule names; content between headings is the rule description. Subheadings (`##`, `###`) are part of the description. The file's directory becomes the rule's inclusion scope.

### `adr.ts` — ADR Calculator **[STUB]**

Reads Architecture Decision Records from a configured path (default `docs/adr/`). Only ADRs containing an explicit `## Rules` heading produce prosecheck rules — ADRs without this heading are documentation-only and skipped. The content under `## Rules` becomes the rule description; the ADR title (`# ...`) becomes the rule name. ADR-derived rules apply project-wide (inclusions: root).

---

## Operating Modes (`src/modes/`)

Control how agents are launched. Independent of environment (any mode runs in any environment).

### `user-prompt.ts` — User Prompt Mode **[STUB]**

Generates per-rule prompt files, then builds a single orchestration prompt listing all prompt file paths. Displays the prompt for the user to paste into Claude Code. Watches `.prosecheck/working/outputs/` for result files and/or waits for user signal.

### `claude-code.ts` — Claude Code Headless Mode **[STUB]**

Spawns `claude --print` processes (one per rule, in parallel). Each instance receives its prompt file content and writes results to `.prosecheck/working/outputs/`. Config option `claudeCode.singleInstance` switches to a single-instance agent-team strategy.

### Claude Agents SDK Mode **[PLANNED]**

Uses `@anthropic-ai/claude-code-sdk` to launch tool-using agents in-process. Same one-agent-per-rule model without external CLI processes. Not yet implemented — no source file exists.

### Internal Loop Mode **[PLANNED]**

Direct Anthropic API calls with a custom agent loop. Most flexible, most code to maintain. Not yet implemented — no source file exists.

---

## Formatters (`src/formatters/`)

Transform collected results into output. Selected via `--format` flag.

### `stylish.ts` — Human-Readable Output **[STUB]**

Default formatter. Terminal output with colors (via picocolors). Shows rule name, status, headline, and per-comment file/line details.

### `json.ts` — JSON Output **[STUB]**

Structured JSON for scripting and machine consumption.

### `sarif.ts` — SARIF Output **[STUB]**

SARIF schema for GitHub Code Scanning. Enables inline PR annotations on rule violations.

---

## UI Components (`src/ui/components/`) **[STUB]**

Ink + React components for interactive terminal display.

### `LintProgress.tsx`

Live table showing each rule's name, run status (waiting / running / done), and result as agents complete.

### `Summary.tsx`

Final results summary after all rules have been evaluated.

---

## Agent Output Format

Agents write structured JSON to `.prosecheck/working/outputs/<rule-id>.json`:

| Status | Written by | Fields |
|---|---|---|
| `pass` | Agent | `status`, `rule`, `source`, optional `comment` |
| `warn` | Agent | `status`, `rule`, `source`, `headline`, `comments[]` |
| `fail` | Agent | `status`, `rule`, `source`, `headline`, `comments[]` |
| `dropped` | Tool | Assigned when no output file received |

Each `comments[]` entry has: `message` (required), `file` (optional), `line` (optional).

---

## Data Flow

```
RULES.md files ──→ rules-md calculator ──┐
                                         ├──→ Rule[] ──→ Change Detection
ADR files ───────→ adr calculator ───────┘         ↓
                                              Triggered Rules
                                                   ↓
                                         Prompt Generation
                                         (.prosecheck/working/prompts/)
                                                   ↓
                                         Operating Mode Execution
                                         (user-prompt | claude-code | ...)
                                                   ↓
                                         Result Collection
                                         (.prosecheck/working/outputs/)
                                                   ↓
                                         Formatting + Reporting
                                         (stylish | json | sarif)
                                                   ↓
                                         Post-Run Tasks
                                                   ↓
                                         Exit Code
```

---

## File System Layout (Runtime)

```
.prosecheck/
├── config.json              # Base config (committed)
├── config.local.json        # Personal overrides (gitignored)
├── prompt.md                # (optional) Global system prompt
├── prompt-template.md       # (optional) Custom prompt template
├── last-user-run            # Git hash of last run (auto-managed)
└── working/                 # Ephemeral workspace (gitignored)
    ├── prompts/             # Generated per-rule prompts (<rule-id>.md)
    └── outputs/             # Agent result files (<rule-id>.json)
```

Working directory is wiped at the start of each run. Prompts and outputs are retained after the run for debugging.

---

## Key Architectural Decisions

See `docs/adr/` for full records:

1. **Plain-text rules evaluated by LLM** — no DSL, natural language
2. **One agent per rule** — parallel, isolated evaluation
3. **Change detection selects rules, agents see full codebase** — diffs control what runs, not what agents see
4. **Environment vs operating mode separation** — orthogonal config and execution axes
5. **Pluggable rule calculators** — extensible rule discovery
6. **Gitignore-format for scope patterns** — familiar pattern syntax
7. **RULES.md heading-based format** — headings as rule names
8. **TypeScript/ESM strict stack** — strict TS, ESM-only, modern tooling
9. **Configuration model and runtime defaults** — layered config, ESLint-style exit codes
10. **Zod-defined config schema** — single declaration for types, validation, defaults, and editor introspection

---

## Technology Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict + extra flags) |
| Runtime | Node.js >= 20, ESM-only |
| Build | tsup (esbuild wrapper) |
| Test | vitest + msw + ink-testing-library |
| CLI | commander + @commander-js/extra-typings |
| Terminal UI | ink + react + picocolors + yocto-spinner |
| Schema & validation | zod (config types, validation, introspection) |
| Pattern matching | ignore (gitignore format) |
| Process management | execa |
| Lint | eslint (strictTypeChecked) + prettier |
