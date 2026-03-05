# Architecture

This document describes the architecture of prosecheck, an LLM-powered code linter with natural-language rules. Sections marked **[PLANNED]** are designed but not yet implemented. Sections marked **[STUB]** have file structure in place but no implementation code.

## About `docs/architecture/`

The `docs/architecture/` folder holds architecture documentation for each system. This file (`ARCHITECTURE.md`) is the high-level overview of the whole project. A smaller project may only need this single file; as systems grow more complex, they can be broken out into dedicated files in this directory (e.g., `execution-pipeline.md`, `config-system.md`).

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
│  Orchestrator: rules → prompts → dispatch → collect → report    │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│  Config  │  Rules   │ Prompts  │  Modes   │  Results            │
│ Loading  │ Discovery│ Generate │ Execute  │  Collection         │
│ +Layering│ (calcs)  │          │          │  +Formatting        │
└──────────┴──────────┴──────────┴──────────┴─────────────────────┘
```

All source files are TypeScript (strict mode, ESM-only, Node >= 20). The project builds with tsup and tests with vitest.

---

## Entry Points

### `src/cli.ts` — CLI Binary [IMPLEMENTED]

Commander-based argument parsing. Registers `lint`, `init`, and `config` subcommands with full flag support. Resolves environment (`--env`) and operating mode (`--mode`) as orthogonal concerns. Sets `process.exitCode` (never `process.exit()`) for graceful cleanup. Boolean flags use `<bool>` syntax (e.g., `--warn-as-error=1` / `--warn-as-error=0`).

**Exit codes:** 0 = all passed, 1 = rule failures, 2 = tool/config error.

### `src/index.ts` — Library API [IMPLEMENTED]

Programmatic entry point for use as a library dependency. Exports: core types (`Config`, `RuleResult`, `Rule`, `RuleStatus`, `RunContext`, `PromptVariables`), engine (`runEngine`, `EngineResult`), config loading (`loadConfig`, `resolveEnvironment`, `ConfigError`), result types (`CollectResultsOutput`, `RuleResultWithId`, `DroppedRule`), all three formatters (`formatStylish`, `formatJson`, `formatSarif`), and commands (`init`, `lint`).

---

## Commands

### `src/commands/lint.ts` — Lint Command [IMPLEMENTED]

Parses lint-specific CLI flags (env, mode, format, ref, warnAsError, retryDropped, lastRunRead/Write, timeout, claudeToRuleShape, maxConcurrentAgents), builds CLI overrides, loads config via `loadConfig()`, constructs `RunContext`, invokes `runEngine()`, writes output to stdout, and sets `process.exitCode` (0 for pass/warn, 1 for fail/dropped, 2 for config/unexpected errors). When stdout is a TTY and format is `stylish`, lazy-imports the Ink UI (`src/ui/render.ts`) for interactive progress display instead of plain text output. Key function: `lint(options: LintOptions)`.

### `src/commands/init.ts` — Init Command [IMPLEMENTED]

Scaffolds `.prosecheck/` directory with default `config.json` (baseBranch, globalIgnore, ruleCalculators defaults), creates `working/` subdirectory, adds entries to `.gitignore` (working/, config.local.json, last-user-run) with a `# prosecheck` header, and optionally creates a starter `RULES.md` with example rules. Idempotent — detects existing initialization and skips. Key function: `init(options: InitOptions)`.

### `src/commands/config.ts` — Config List & Set Command [IMPLEMENTED]

Non-interactive CLI for viewing and modifying `.prosecheck/config.json`. Two subcommands:

- **`config list`** — Loads current config via `loadConfig()`, extracts all fields by walking the Zod `ConfigSchema` shape (recursing into nested objects like `lastRun` and `claudeCode`), and displays each field's dot-path, current value, default/modified marker, and description (from `.describe()`). Schema-driven — new config fields automatically appear.
- **`config set <key>=<value> [...]`** — Parses dot-path keys, coerces string values to correct types (boolean, number, string, string[], JSON objects) based on schema introspection, validates against `ConfigSchema`, and writes minimal diff to `config.json` (only non-default values are persisted). Cleans up empty parent objects.

Key exported functions: `config()`, `extractFields()`, `resolveSchemaType()`, `coerceValue()`.

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

### `engine.ts` — Orchestrator [IMPLEMENTED]

Central coordinator that drives the lint pipeline:

1. Cleanup `.prosecheck/working/`
2. Run rule calculators → collect all rules (early return if none)
3. Run change detection → get triggered rules (early return if none)
4. Fire `discovered` and `running` progress events (if `onProgress` callback set)
5. Generate per-rule prompts
6. Start output file watcher (if `onProgress` set) — lazy-imports `output-watcher.ts`
7. Dispatch to operating mode (`claude-code` or `user-prompt`)
8. Stop output watcher
9. Collect results (with dropped detection)
10. Retry dropped rules if `retryDropped` enabled — re-generate prompts, re-dispatch, re-collect, up to `retryDroppedMaxAttempts` rounds. Stops early when all dropped rules resolve.
11. Apply `warnAsError` promotion
12. Format output (stylish/json/sarif)
13. Execute post-run tasks
14. Persist last-run hash if applicable

Key function: `runEngine(context: RunContext): Promise<EngineResult>`. Returns formatted output string, overall status, and raw results. Accepts optional `onProgress` callback on `RunContext` for real-time progress tracking.

### `change-detection.ts` — Git Diff & File Filtering [IMPLEMENTED]

Detects changed files via `git diff --name-only` and determines which rules to trigger. Pipeline:

1. Compute comparison ref via `git merge-base HEAD <baseBranch>` (with fallback to branch name for shallow clones)
2. Optionally read `.prosecheck/last-user-run` hash for incremental narrowing (last-run hash narrows which rules fire, but agents still get the merge-base ref for comparison)
3. Run `git diff --name-only <ref>` to get changed files
4. Filter through global ignore patterns (`buildIgnoreFilter`)
5. Match remaining files to rule scopes via `filterFiles` — a rule triggers if at least one changed file matches its inclusions
6. Optionally write current HEAD to `.prosecheck/last-user-run`

Returns `ChangeDetectionResult` with: `comparisonRef` (for agents), `triggeredRules`, `changedFiles`, and `changedFilesByRule` map.

Default last-run behavior by environment:

| | Interactive | CI |
|---|---|---|
| Read last-run | No | Yes |
| Write last-run | Yes | No |

### `ignore.ts` — Pattern Matching [IMPLEMENTED]

Uses the `ignore` npm package for gitignore-format pattern matching. `buildIgnoreFilter()` combines `globalIgnore` inline patterns with patterns from `additionalIgnore` files (defaults to `.gitignore`). `buildInclusionFilter()` creates per-rule scope predicates. `filterFiles()` applies both filters. Applied globally before per-rule inclusions.

### `rule.ts` — Rule Types [IMPLEMENTED]

Type definitions and factory functions for rules. Each rule has: name, description (natural language), inclusions (gitignore patterns), source reference (originating file), a stable filesystem-safe ID slug generated by `makeRuleId()`, optional `group` (for rule grouping under one agent), and optional `frontmatter` bag (`Record<string, unknown>` for unrecognized frontmatter fields preserved for future use).

### `frontmatter.ts` — Frontmatter Parser [IMPLEMENTED]

Extracts YAML frontmatter from markdown files. Returns parsed data object + remaining body. Handles missing frontmatter gracefully (returns empty data, full body). Invalid YAML is treated as no frontmatter. `extractGroupFromFrontmatter()` separates the `group` field from the rest, returning unknown fields as a passthrough bag. Used by both `rules-md` and `adr` calculators.

### `execution-plan.ts` — Execution Plan Builder [IMPLEMENTED]

Builds the `[sequential batches [parallel invocations [rules]]]` execution hierarchy for claude-code mode. Three invocation types: `one-to-one` (one process per rule), `one-to-many-teams` (parallel sub-agents), `one-to-many-single` (sequential in one agent). `buildExecutionPlan()` separates rules into ungrouped (dispatched per `claudeToRuleShape`) and grouped (always `one-to-many-single`), then packs invocations into batches respecting `maxConcurrentAgents`. Teams can be split across batches; other types use no-split insertion.

### `prompt.ts` — Prompt Generation [IMPLEMENTED]

Generates per-rule prompt files at `.prosecheck/working/prompts/<rule-id>.md`. Each prompt includes:

- Rule text (full natural-language description)
- Comparison ref (git ref to diff against)
- Changed files list (modifications, additions, deletions)
- Scope (inclusion patterns)
- Output path (`.prosecheck/working/outputs/<rule-id>.json`)
- General guidance (evaluate full codebase within scope, output JSON only)
- Output schema examples (pass/warn/fail JSON shapes)

Template is configurable via `.prosecheck/prompt-template.md` (falls back to built-in default). Global system prompt from `.prosecheck/prompt.md` is prepended when present. Interpolation uses `{{variable}}` placeholders. Key functions: `loadTemplate()`, `loadGlobalPrompt()`, `buildPromptVariables()`, `interpolateTemplate()`, `generatePrompt()`, `generatePrompts()`.

### `results.ts` — Result Collection [IMPLEMENTED]

Collects agent output JSON files from `.prosecheck/working/outputs/`. Before JSON parsing, `sanitizeAgentOutput()` handles common LLM quirks: strips UTF-8 BOM, extracts JSON from markdown fences, truncates trailing text after the last `}`, and trims whitespace. Each file is then validated against `RuleResultSchema` (Zod) — malformed agent output produces clear error messages (including input preview and rule ID) rather than downstream crashes. Detects dropped rules (missing output files). Determines overall run status from worst individual status: fail > dropped > warn > pass. Malformed outputs are treated as fail severity. Key functions: `sanitizeAgentOutput()`, `parseResultFile()`, `collectResults()`, `computeOverallStatus()`.

### `orchestration-prompt.ts` — Shared Orchestration Prompt [IMPLEMENTED]

Generates the orchestration prompt used by both user-prompt and claude-code single-instance modes. Two variants controlled by `agentTeams`:
- **Agent teams mode** (`agentTeams: true`): Instructs the agent to act as an "orchestrator" and launch agent teams (sub-agents) for each rule. Compact format listing rule name and prompt file path.
- **Sequential mode** (`agentTeams: false`): Instructs the agent to process all rules itself with detailed instructions including output paths and step-by-step guidance.

Both variants list rules by human-readable name with relative prompt file paths. Key function: `buildOrchestrationPrompt()`.

### `post-run.ts` — Post-Run Tasks [IMPLEMENTED]

Executes shell commands from `config.postRun` array sequentially after results collection. Injects environment variables: `PROSECHECK_STATUS` (overall status), `PROSECHECK_RESULTS_DIR` (absolute path to outputs directory), `PROSECHECK_RESULTS_JSON` (absolute path to results JSON file, when available). Captures stdout, stderr, and exit codes for each command. Key function: `executePostRun()`.

---

## Rule Calculators (`src/lib/calculators/`)

Pluggable modules that discover rules from different sources. Declared in `config.ruleCalculators` array. Interface: `(options) → Rule[]`.

### `index.ts` — Calculator Registry [IMPLEMENTED]

Dispatches to named calculators based on config. Supports `enabled: false` to disable individual calculators. Defaults to running `rules-md` when no calculators are configured. Throws for unknown calculator names.

### `rules-md.ts` — RULES.md Calculator [IMPLEMENTED]

Discovers `RULES.md` files throughout the project tree using `glob`. Parses YAML frontmatter (if present) to extract `group` and preserve unknown fields. Top-level `#` headings become rule names; content between headings is the rule description. Subheadings (`##`, `###`) are part of the description. Text before the first heading is ignored. The file's directory becomes the rule's inclusion scope (empty for root-level files). File-level frontmatter applies to all rules in the file.

### `adr.ts` — ADR Calculator [IMPLEMENTED]

Reads Architecture Decision Records from a configured path (default `docs/adr/`). Parses YAML frontmatter (if present) to extract `group` and preserve unknown fields. Only ADRs containing an explicit `## Rules` heading produce prosecheck rules — ADRs without this heading are documentation-only and skipped. If the `## Rules` section contains `### Sub-rule` headings, each becomes a separate rule (like RULES.md but with `###` instead of `#`); text before the first `###` is ignored as preamble. If there are no `###` headings, the entire section is one rule named after the ADR title. ADR-derived rules apply project-wide (empty inclusions). Gracefully handles missing ADR directory.

---

## Operating Modes (`src/modes/`)

Control how agents are launched. Independent of environment (any mode runs in any environment).

### `user-prompt.ts` — User Prompt Mode [IMPLEMENTED]

Generates an orchestration prompt (via the shared `orchestration-prompt.ts` builder) and prints it for the user to paste into Claude Code or another LLM. Watches `.prosecheck/working/outputs/` via `fs.watch` for result files and resolves when all expected outputs exist. Supports abort signals for early termination with partial results. Key functions: `buildUserPrompt()`, `watchForOutputs()`.

### `claude-code.ts` — Claude Code Headless Mode [IMPLEMENTED]

Builds an execution plan via `buildExecutionPlan()` from `execution-plan.ts`, then executes batches sequentially with invocations within each batch running in parallel. Each invocation spawns a `claude --print` process via `execa`. Invocation types:
- **`one-to-one`**: reads the per-rule prompt file, spawns with scoped `Write` permission for that rule's output file.
- **`one-to-many-teams`**: builds an orchestration prompt via `buildAgentTeamsPrompt()`, sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- **`one-to-many-single`**: builds an orchestration prompt via `buildSequentialPrompt()` for sequential rule processing.

Configured by `claudeToRuleShape` (replaces old `singleInstance`/`agentTeams`) and `maxConcurrentAgents`. Key functions: `runClaudeCode()`, `spawnClaude()`.

### Claude Agents SDK Mode **[PLANNED]**

Uses `@anthropic-ai/claude-code-sdk` to launch tool-using agents in-process. Same one-agent-per-rule model without external CLI processes. Not yet implemented — no source file exists.

### Internal Loop Mode **[PLANNED]**

Direct Anthropic API calls with a custom agent loop. Most flexible, most code to maintain. Not yet implemented — no source file exists.

---

## Formatters (`src/formatters/`)

Transform collected results into output. Selected via `--format` flag.

### `stylish.ts` — Human-Readable Output [IMPLEMENTED]

Default formatter. Terminal output with colors (via picocolors). Shows rule name, status (PASS/WARN/FAIL/DROP/ERR), headline, and per-comment file/line details. Includes a summary line with counts per status category. Key function: `formatStylish()`.

### `json.ts` — JSON Output [IMPLEMENTED]

Structured JSON for scripting and machine consumption. Includes overall status, results array, dropped rules, and errors. Key function: `formatJson()`.

### `sarif.ts` — SARIF Output [IMPLEMENTED]

SARIF 2.1.0 schema for GitHub Code Scanning. Maps warn/fail results to SARIF results with physical locations (file + line). Pass results are omitted. Dropped rules are included as error-level findings. Key function: `formatSarif()`.

---

## UI Components (`src/ui/`) [IMPLEMENTED]

Ink + React components for interactive terminal display. Lazy-loaded via dynamic `import()` to avoid loading Ink/React for non-interactive code paths (CI, piped output, JSON/SARIF format).

### `components/LintProgress.tsx` — Live Progress Table [IMPLEMENTED]

Renders a live table showing each rule's name, run status (`waiting` / `running` / `done`), and result as agents complete. Each row displays a colored status label (WAIT/`..`/PASS/WARN/FAIL/DROP) with the rule name and, when done, the result headline or pass comment. Accepts a `RuleProgressEntry[]` prop. Supports rerendering with updated status for real-time progress tracking.

### `components/Summary.tsx` — Results Summary [IMPLEMENTED]

Final results summary component. Displays total rule count, per-status counts (passed/warned/failed/dropped/errors), and overall status (PASS/WARN/FAIL/DROPPED) with color coding. Accepts a `CollectResultsOutput` prop from the results collector.

### `LintApp.tsx` — Top-Level App [IMPLEMENTED]

Composes `LintProgress` and `Summary` into a single Ink app. Manages `RuleProgressEntry[]` state via a React hook, accepting `ProgressEvent` updates from the engine. Exposes a module-level `getProgressHandler()` for the render wrapper to push events imperatively. Shows `Summary` only when `finalResults` prop is provided.

### `render.ts` — Ink Render Wrapper [IMPLEMENTED]

Manages the Ink render lifecycle. `shouldUseInteractiveUI(format)` checks for TTY + stylish format. `startInteractiveUI()` renders `LintApp`, returns an `InteractiveUI` interface with `onProgress` (feed to engine), `finish(results)` (show summary + unmount), and `cleanup()` (unmount on error).

### `output-watcher.ts` (`src/lib/`) — Live Output Watcher [IMPLEMENTED]

Watches `.prosecheck/working/outputs/` via `fs.watch` for new result files during mode dispatch. When a file matching an expected rule ID appears, reads and validates it via `parseResultFile()`, then fires the `onResult` callback. Deduplicates by rule ID (each rule fires at most once). Returns a stop function. Lazy-imported by the engine only when `onProgress` is set.

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

`.prosecheck/working` is wiped at the start of each run. Prompts and outputs are retained after the run for debugging.

---

## Key Architectural Decisions

See `docs/adr/` for full records:

1. **Plain-text rules evaluated by LLM** — no DSL, natural language
2. ~~One agent per rule~~ — superceded by ADR-012
3. **Change detection selects rules, agents see full codebase** — diffs control what runs, not what agents see
4. **Environment vs operating mode separation** — orthogonal config and execution axes
5. **Pluggable rule calculators** — extensible rule discovery
6. **Gitignore-format for scope patterns** — familiar pattern syntax
7. **RULES.md heading-based format** — headings as rule names
8. **TypeScript/ESM strict stack** — strict TS, ESM-only, modern tooling
9. **Configuration model and runtime defaults** — layered config, ESLint-style exit codes
10. **Zod-defined config schema** — single declaration for types, validation, defaults, and editor introspection
11. **acceptEdits permission mode** — uses `--permission-mode acceptEdits` for Claude CLI because scoped `Write()` permissions are buggy upstream
12. **Flexible rule dispatch** — configurable `claudeToRuleShape` (one-to-one, one-to-many-teams, one-to-many-single) with rule groups and concurrency limits; supercedes ADR-002

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
| YAML parsing | yaml (frontmatter extraction) |
| Process management | execa |
| Lint | eslint (strictTypeChecked) + prettier |
