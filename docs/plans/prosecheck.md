# Prosecheck — Design Plan

Prosecheck is an LLM-powered code linter that processes directory-scoped rules written in plain text. Rather than encoding lint logic in ASTs or regex patterns, rules are natural-language descriptions in `RULES.md` files, evaluated by LLM agents against the target codebase.

---

## Environments and Operating Modes

Prosecheck separates two orthogonal concerns: **where** the tool runs (environment) and **how** it executes agents (operating mode).

### Environments

An environment controls configuration layering — which config overrides apply. Environments are passed via `--env <name>` (defaults to `interactive`).

- **`interactive`** — Developer workstation. Default environment when no `--env` flag is passed.
- **`ci`** — Continuous integration. Auto-detected when `process.env.CI` is set, but can also be passed explicitly.
- **Custom environments** — Users can define arbitrary environment names (e.g., `staging`, `nightly`) in `.prosecheck/config.json` and pass them via `--env`. Each environment name maps to a config override block.

Environments affect config layering only (e.g., last-run defaults, model selection). They do not determine how agents are launched — that is the operating mode's job.

### Operating Modes

An operating mode controls how the tool executes rule evaluation. Modes are selected via `--mode <name>`.

#### User Prompt (implemented)

The tool generates per-rule prompt files (see [Prompt Generation and Execution Pipeline](#prompt-generation-and-execution-pipeline)), then builds a single orchestration prompt for the user to paste into Claude Code. This orchestration prompt instructs Claude Code to create an agent team — one agent per prompt file — and lists all the prompt file paths. The user copies the prompt into their Claude Code session, which spawns the agents.

The tool then watches `.prosecheck/working/outputs/` for result files to appear and/or waits for the user to signal completion, then collects and processes the results.

**Flow:** Invoke → Collect rules → Generate per-rule prompts → Build orchestration prompt → Display prompt and watch for output files or user signal → Collect results → Post-run tasks → Report

#### Claude Code Headless (implemented)

The tool generates per-rule prompt files (see [Prompt Generation and Execution Pipeline](#prompt-generation-and-execution-pipeline)), then launches Claude Code CLI instances to execute them.

By default, it spawns one `claude --print` process per rule in parallel. Each instance receives its prompt file content, evaluates the rule autonomously, and writes results to `.prosecheck/working/outputs/`.

A config option `claudeCode.singleInstance` switches to an alternative strategy: launch a single Claude Code instance with the same orchestration prompt used in User Prompt mode (instructing it to spawn an agent team internally). This trades parallelism control for lower process overhead.

This mode works in any environment. In CI it runs unattended. Locally, the tool provides progressive output showing per-rule status as each instance completes.

**Flow:** Invoke → Collect rules → Generate per-rule prompts → Launch Claude Code instance(s) → Stream progress as instances complete → Collect results → Post-run tasks → Report

#### Claude Agents SDK (planned — not yet implemented)

Uses the `@anthropic-ai/claude-code-sdk` to launch autonomous tool-using agents directly in-process. Same one-agent-per-rule model, but without spawning external CLI processes. This eliminates the Claude Code CLI as a runtime dependency and gives tighter control over tool definitions, context management, and agent orchestration.

#### Internal Loop (planned — not yet implemented)

Direct Anthropic API calls with a custom agent loop. The tool manages the message history, tool execution, and retry logic itself. Most flexible but most code to maintain. Would be needed if targeting non-Claude models or requiring custom tool implementations that the SDK doesn't support.

---

## Prompt Generation and Execution Pipeline

All operating modes share the same prompt generation phase. The execution and collection phases differ by mode.

### 1. Cleanup

At the start of every run, the tool deletes all files in `.prosecheck/working/prompts/` and `.prosecheck/working/outputs/`. This ensures no stale artifacts from a previous run contaminate results.

### 2. Per-Rule Prompt Generation

For each rule triggered by change detection, the tool generates a prompt file at `.prosecheck/working/prompts/<rule-id>.md`. The rule ID is a stable, filesystem-safe slug derived from the rule name and source file (e.g., `src-rules-md--exported-functions-must-have-jsdoc`).

Each prompt includes:

- **Rule text** — the full natural-language rule description from the source file
- **Comparison ref** — the git ref to diff against (e.g., `origin/main`, a specific commit)
- **Changed files** — the list of changed files (modifications, additions, and deletions) that triggered this rule, so the agent knows where to focus
- **Scope** — the rule's inclusion patterns, so the agent knows its boundaries
- **Output path** — the exact file path to write results to: `.prosecheck/working/outputs/<rule-id>.json`
- **General guidance** — instructions included in every prompt:

> These files changed, but they may interact with related code in important ways. Look at the changes since the listed git ref and evaluate the full codebase within the rule's scope. Output your pass/warn/fail status to the specified output file. Do not prompt the user for any questions. Output only to the JSON file without user interaction.

The prompt template is configurable. The tool ships a default template, and users can override it by placing a custom template at `.prosecheck/prompt-template.md`. The template receives all the above variables for interpolation. A separate global system prompt at `.prosecheck/prompt.md` is prepended to every per-rule prompt and can contain project-wide agent instructions.

### 3. Mode-Specific Execution

After prompt generation, the operating mode takes over:

- **User Prompt**: builds an orchestration prompt listing all prompt file paths, displays it to the user
- **Claude Code Headless**: feeds each prompt file to a `claude --print` instance (or a single instance in `singleInstance` mode)
- **Claude Agents SDK** (planned): feeds each prompt to an in-process agent
- **Internal Loop** (planned): feeds each prompt into a custom agent loop

### 4. Waiting and Collection

The tool waits for results using mode-appropriate strategies:

- **Output file watching** — watches `.prosecheck/working/outputs/` for `<rule-id>.json` files to appear (all modes)
- **Process exit** — waits for Claude Code processes to exit (Claude Code Headless mode)
- **User signal** — waits for the user to press a key or confirm completion (User Prompt mode, interactive only)
- **Timeout** — configurable per-run timeout (`timeout` in config, `--timeout` CLI flag). When reached, any rule without output is marked `dropped`

In interactive mode, the tool displays a live table showing each rule's name, run status (waiting / running / done), and final result as they complete.

### 5. Dropped Rule Handling

If a rule produces no output file — because the agent self-cancelled, timed out, or crashed — the rule receives status `dropped`.

Dropped rules are treated as failures by default. A config option `retryDropped` (default `false`) enables automatic retries: the tool re-generates the prompt and re-launches the agent for each dropped rule, up to `retryDroppedMaxAttempts` times (default `1`). If a rule remains dropped after retries, it counts as a failure in the final report.

### 6. Post-Run Tasks

After results are collected and reported, the tool optionally runs a sequence of post-run tasks. For now, these are shell commands defined in config:

```json
{
  "postRun": [
    "echo 'Linting complete'"
  ]
}
```

Post-run commands receive environment variables with run metadata:

- `PROSECHECK_STATUS` — overall run status (`pass`, `warn`, `fail`)
- `PROSECHECK_RESULTS_DIR` — path to `.prosecheck/working/outputs/`
- `PROSECHECK_RESULTS_JSON` — path to a combined results JSON file

In the future, post-run tasks will support structured actions (e.g., `post-pr-comment`, `update-check-run`) in addition to shell commands.

### 7. Artifact Retention

Prompt files (`.prosecheck/working/prompts/`) and output files (`.prosecheck/working/outputs/`) are **not** cleaned up after a run. They remain on disk for:

- Debugging — inspect exactly what the agent was asked and what it produced
- External tooling — other tools can read the structured outputs
- Re-runs — a user can manually re-feed a prompt file to Claude Code

The `.prosecheck/working/` directory should be gitignored.

---

## Change Detection and Scoping

Change detection determines **which rules to run**, not what the agents see. The tool diffs the selected ref to find changed files, maps those files to their parent directories, and marks every rule whose scope contains at least one changed file. Rule calculators run first so directory scopes are known before change detection begins.

Agents always receive the **full codebase** within their rule's scope. They are given the comparison ref so they can run their own diff commands if needed. This means agents have complete context to evaluate compliance — change detection only controls which rules are triggered, not what context agents get.

### Comparison Ref

The tool can be invoked against different scopes:

- **Diverge from main** (default): Changes since the current branch diverged from `main`. The base branch name is configurable in `.prosecheck/config.json`.
- **Diverge from specific ref**: Changes since diverging from a named branch or arbitrary git ref.
- **All code**: All rules run regardless of change history.

### Incremental Run Tracking

A git hash stored at `.prosecheck/last-user-run` provides an additional scope narrowing. When enabled, changed-file detection uses the last-run hash instead of the merge-base. Agents still receive the original merge-base ref for comparison — last-run tracking only affects which rules are selected to run, not the ref agents compare against.

**Default behavior differs by environment:**

| Behavior | `interactive` environment | `ci` environment |
|---|---|---|
| Read last-run file | No (off by default) | Yes (on by default) |
| Write last-run file | Yes (on by default) | No (off by default) |

This means interactive runs always check against the full branch diff (safe default for developers) but record their position so CI can skip already-checked work. Each behavior is independently configurable. Custom environments inherit base defaults unless they define their own overrides.

### Zod-Defined Config Schema

The entire configuration shape is defined as a Zod schema in `src/lib/config-schema.ts`. This single declaration serves as:

1. **TypeScript types** — `z.infer<typeof ConfigSchema>` produces the `Config` type used throughout the codebase. No separate type definition to maintain.
2. **Runtime validation** — `ConfigSchema.safeParse(data)` validates loaded JSON with structured error paths (e.g., `environments.ci.lastRun.read: expected boolean, received string`). Invalid config produces exit code 2.
3. **Default values** — `.default()` on each field. `ConfigSchema.parse({})` produces a fully-populated config.
4. **Schema introspection** — `.describe()` on each field carries human-readable descriptions. The `prosecheck config` editor command walks the schema at runtime to discover field names, types, descriptions, defaults, and constraints — no hardcoded field registry.

The schema is composed from sub-schemas for readability: `LastRunSchema`, `ClaudeCodeSchema`, `CalculatorConfigSchema`, `EnvironmentOverrideSchema`. A `PartialConfigSchema` (via `.deepPartial()`) is used for `config.local.json` and environment override blocks, since these are partial overlays. Agent output JSON is also validated via `RuleResultSchema`.

### Configuration Layering

Config uses a base + environment override model:

```json
{
  "baseBranch": "main",
  "globalIgnore": [".git/", "node_modules/", "dist/", "build/", ".prosecheck/working/"],
  "additionalIgnore": [".gitignore"],
  "lastRun": {
    "read": false,
    "write": true
  },
  "timeout": 300,
  "warnAsError": false,
  "retryDropped": false,
  "retryDroppedMaxAttempts": 1,
  "claudeCode": {
    "singleInstance": false
  },
  "postRun": [],
  "environments": {
    "ci": {
      "lastRun": {
        "read": true,
        "write": false
      },
      "warnAsError": true
    },
    "interactive": {
      "lastRun": {
        "read": false,
        "write": true
      }
    },
    "nightly": {
      "lastRun": {
        "read": false,
        "write": false
      }
    }
  },
  "ruleCalculators": []
}
```

New config fields:

- `timeout` — per-run timeout in seconds (default 300). Overridable via `--timeout` CLI flag
- `warnAsError` — treat warnings as failures for exit code purposes (default `false`). Overridable via `--warn-as-error`
- `retryDropped` — automatically retry rules that produce no output (default `false`). Overridable via `--retry-dropped`
- `retryDroppedMaxAttempts` — max retry attempts per dropped rule (default `1`)
- `claudeCode.singleInstance` — in Claude Code Headless mode, launch one instance with agent-team prompt instead of one-per-rule (default `false`)
- `postRun` — array of shell commands to run after results are collected

Top-level keys are base defaults. The `environments` object contains named overrides — `interactive` and `ci` are built-in, but users can add arbitrary names (e.g., `nightly`, `staging`). The active environment is selected via `--env <name>` (defaults to `interactive`; auto-detects `ci` when `process.env.CI` is set). CLI flags override everything:

- `--last-run-read` / `--no-last-run-read` — force enable/disable reading the last-run file
- `--last-run-write` / `--no-last-run-write` — force enable/disable writing the last-run file

### Local Config Overrides

An optional file `.prosecheck/config.local.json` provides personal overrides that are not committed to the repository. This file should be gitignored (the `init` command adds it to `.gitignore` automatically).

`config.local.json` has the same schema as `config.json`. Its values are deep-merged on top of `config.json` before environment layering is applied. The full resolution order is:

1. **`config.json`** — base defaults (committed)
2. **`config.local.json`** — personal overrides (gitignored)
3. **Environment overrides** — from the active environment in the merged config
4. **CLI flags** — highest priority

This allows developers to set personal preferences (e.g., a different timeout, extra ignore patterns, or a custom `postRun` command) without affecting the shared config.

---

## Project Tree

The tree below shows what a project using prosecheck looks like. Items marked **(optional)** are not required for the tool to function.

```
my-project/
├── .prosecheck/                          # Tool configuration root
│   ├── config.json                  # Configuration (base branch, globalIgnore, calculators)
│   ├── prompt.md                    # (optional) Global system prompt prepended to all agent prompts
│   ├── prompt-template.md           # (optional) Custom per-rule prompt template
│   ├── config.local.json             # (optional, gitignored) Local overrides merged on top of config.json
│   ├── last-user-run                # Git hash of last interactive run (auto-managed)
│   └── working/                     # Ephemeral workspace (gitignored)
│       ├── prompts/                 # Generated per-rule prompt files (<rule-id>.md)
│       └── outputs/                 # Agent result files (<rule-id>.json)
│
├── RULES.md                         # (optional) Project-root rules — apply to all files
│
├── src/
│   ├── RULES.md                     # (optional) Rules scoped to src/
│   ├── api/
│   │   ├── RULES.md                 # (optional) Rules scoped to src/api/
│   │   ├── routes.ts
│   │   └── handlers.ts
│   ├── db/
│   │   ├── queries.ts
│   │   └── migrations/
│   └── lib/
│       ├── errors.ts
│       └── utils.ts
│
├── docs/
│   └── adr/                         # (optional) Architecture Decision Records
│       ├── 001-use-zod.md           # (optional) ADR with ## Rules heading → enforceable rule
│       ├── 002-api-error-class.md   # (optional) ADR without ## Rules → documentation only, skipped
│       └── ...
│
├── package.json
└── ...
```

**Required:** Only `.prosecheck/config.json` is strictly required. The tool creates `last-user-run` and `working/` as needed. `prompt.md`, `prompt-template.md`, and `config.local.json` are optional overrides.

**RULES.md files** can live at any directory depth. Each file's directory becomes the inclusion pattern for all rules it contains. A `RULES.md` deeper in the tree adds rules specific to that subtree.

**ADR files** are read from the path configured in the `adr` calculator (default `docs/adr/`). Only ADRs with an explicit `## Rules` heading produce prosecheck rules — others are documentation-only. The `adr` calculator can be disabled entirely in config.

---

## Rule Calculators

Rule discovery is handled by **rule calculators** — pluggable modules that produce a list of rules from a given source. The architecture supports multiple calculators; which ones are active and their options are declared in `.prosecheck/config.json`.

### Config Structure

Rule calculators are declared in the `ruleCalculators` array within `.prosecheck/config.json` (see [Configuration Layering](#configuration-layering) for the full config shape):

```json
{
  "ruleCalculators": [
    {
      "name": "rules-md",
      "enabled": true,
      "options": {}
    },
    {
      "name": "adr",
      "enabled": true,
      "options": {
        "path": "docs/adr"
      }
    }
  ]
}
```

### Built-in Calculators

**`rules-md`** — The default calculator. Discovers `RULES.md` files throughout the project tree and parses each rule entry from them. Each rule's inclusions are set to the directory containing its `RULES.md` (e.g., a `RULES.md` at `src/api/` produces inclusions of `src/api/`). In the initial implementation, this is a single directory path per rule. In the future, `RULES.md` could support exclusion patterns or frontmatter to refine scope further. Enabled by default.

**`adr`** — Calculates rules from Architecture Decision Records. Reads ADR files from a configured path (default `docs/adr`). Only ADRs that contain an explicit `## Rules` heading produce prosecheck rules — ADRs without this heading are treated as documentation-only and skipped. The content under the `## Rules` heading (up to the next same-level heading or end of file) becomes the rule description. The ADR title (`# ...` heading) becomes the rule name. This opt-in approach means teams can have a mix of enforceable and documentation-only ADRs in the same directory. ADR-derived rules apply project-wide (inclusions: root). In the future, ADR files could use YAML frontmatter to define specific inclusion/exclusion patterns. Enabled by default.

### Custom Calculators

The calculator interface is designed for extension. A calculator receives its options from config and returns a list of rules, each with:

- Rule name (the heading text for `rules-md`, or equivalent for other calculators)
- Rule description (natural language)
- Inclusions (gitignore-formatted patterns defining which files the rule applies to)
- Source reference (originating file for traceability)

### Rule Scope: Inclusions and Exclusions

Every rule carries an **inclusions** field — a list of gitignore-formatted patterns defining which files the rule applies to. Patterns follow gitignore syntax: directories match recursively, `!` prefixes negate (exclude), and standard glob wildcards apply.

#### Global Ignore

Before per-rule inclusions are evaluated, a **global ignore** list is applied to all rules. This is configured via two fields in `.prosecheck/config.json`:

**`globalIgnore`** — an inline list of gitignore-formatted patterns, defaulting to common non-source paths:

```json
"globalIgnore": [".git/", "node_modules/", "dist/", "build/", ".prosecheck/working/"]
```

**`additionalIgnore`** — a list of external ignore files whose patterns are merged into the global ignore set:

```json
"additionalIgnore": [".gitignore"]
```

This defaults to `[".gitignore"]`, so projects automatically respect their existing `.gitignore` patterns without duplicating them. Patterns from all listed files are read and combined with the `globalIgnore` inline patterns. Files that don't exist are silently skipped. Set to `[]` to not import any external ignore files.

The combined ignore set (inline `globalIgnore` + patterns from `additionalIgnore` files) is applied to all rules — matching files are never considered changed and agents are instructed to skip them. This prevents noise from vendored code, build artifacts, and tool internals.

Setting both `globalIgnore` to `[]` and `additionalIgnore` to `[]` disables all default exclusions, meaning every file in the repo is eligible for rule matching.

The resolution order is: **globalIgnore + additionalIgnore → per-rule inclusions**. A file must not match any global/additional ignore pattern AND must match the rule's inclusions to be in scope.

#### Per-Rule Inclusions

In the initial implementation, each calculator produces simple single-directory inclusions:

- `rules-md`: the directory containing the `RULES.md` file (e.g., `src/api/`)
- `adr`: project root (i.e., all files)

The gitignore format is chosen because it naturally supports future enhancements without changing the data model:

```
# Future: RULES.md frontmatter could define fine-grained scope
src/api/
!src/api/generated/
!src/api/**/*.test.ts

# Future: ADR YAML frontmatter could target specific packages
packages/auth/
packages/shared/lib/crypto/
```

Change detection uses these inclusions to match changed files against rules — a rule only runs if at least one changed file matches its inclusion patterns (after global ignore filtering).

---

## RULES.md Format

Rules are defined using **headings as rule names**. Each top-level heading (`#`) starts a new rule. Everything from one heading to the next (or end of file) is that rule's description — the natural-language text an agent evaluates code against. Subheadings (`##`, `###`, etc.) within a rule are part of its description, not separate rules. Any text before the first heading is ignored (useful for preamble or notes).

```markdown
Some introductory text — this is ignored by the parser.

# Exported functions must have JSDoc comments

All functions exported from a module must have a JSDoc comment that
describes the function's purpose, parameters, and return value.

## Exceptions

Private helper functions (not exported) do not require JSDoc.

# No direct database queries outside of db/

All SQL queries and ORM calls must go through modules in the `db/`
directory. Service layers import from `db/` — they never construct
queries directly.

# Error responses use the shared ApiError class

All error responses returned from API route handlers must use the
`ApiError` class from `src/lib/errors.ts`. Do not throw plain `Error`
objects or return ad-hoc `{ error: string }` shapes.
```

This example produces three rules: "Exported functions must have JSDoc comments", "No direct database queries outside of db/", and "Error responses use the shared ApiError class". The "Exceptions" subheading is part of the first rule's description, not a separate rule.

Rules in a `RULES.md` are scoped to that file's directory and its children (the directory becomes the rule's inclusion pattern). A `RULES.md` deeper in the tree adds rules specific to that subtree.

---

## Agent Output Format

Agents output structured JSON to `.prosecheck/working/outputs/<rule-id>.json`. Each result has one of four statuses.

### Pass

```json
{
  "status": "pass",
  "rule": "All exported functions must have JSDoc comments.",
  "source": "src/RULES.md",
  "comment": "All 12 exported functions in src/lib/ have JSDoc comments."
}
```

The `comment` field is optional on pass — agents may include a summary note but are not required to.

### Warn

```json
{
  "status": "warn",
  "rule": "All exported functions must have JSDoc comments.",
  "source": "src/RULES.md",
  "headline": "Minor JSDoc gaps in src/lib/utils.ts",
  "comments": [
    {
      "message": "`formatDate` has a JSDoc comment but is missing @param descriptions.",
      "file": "src/lib/utils.ts",
      "line": 23
    }
  ]
}
```

A warning uses the same shape as a failure — `headline` and `comments` are required. Warnings indicate the code is not clearly in violation but deserves attention (e.g., partial compliance, ambiguous cases). The agent decides whether to warn or fail based on severity.

### Fail

```json
{
  "status": "fail",
  "rule": "No direct database queries outside of the db/ module.",
  "source": "src/RULES.md",
  "headline": "Direct SQL query found in src/services/user.ts",
  "comments": [
    {
      "message": "Raw `db.query()` call should be moved to `src/db/users.ts`.",
      "file": "src/services/user.ts",
      "line": 47
    },
    {
      "message": "Consider using the existing `findUserById` helper in `src/db/users.ts`."
    }
  ]
}
```

A failure requires a `headline` (short summary of the violation) and a `comments` array with at least one entry. Each comment has a `message` and optional `file` and `line` fields for pinpointing the violation.

### Dropped

A `dropped` status is **not written by agents** — it is assigned by the tool when a rule produces no output file. This happens when:

- The agent self-cancelled or crashed
- The agent timed out
- The agent wrote output to the wrong location

Dropped rules are eligible for retry (see [Dropped Rule Handling](#5-dropped-rule-handling)). After retries are exhausted, dropped rules count as failures in the final report.

### Status Severity and Final Result

The overall run status is determined by the worst status across all rules:

| Priority | Status | Meaning | Exit code |
|---|---|---|---|
| 1 (worst) | `fail` | Rule clearly violated | 1 |
| 2 | `dropped` | No output received, treated as failure | 1 |
| 3 | `warn` | Potential issue, deserves attention | 0 (configurable to 1 via `--warn-as-error`) |
| 4 (best) | `pass` | Rule satisfied | 0 |

### Schema Summary

| Field | Pass | Warn | Fail |
|---|---|---|---|
| `status` | `"pass"` | `"warn"` | `"fail"` |
| `rule` | Required | Required | Required |
| `source` | Required | Required | Required |
| `comment` | Optional string | — | — |
| `headline` | — | Required | Required |
| `comments` | — | Required, non-empty array | Required, non-empty array |
| `comments[].message` | — | Required | Required |
| `comments[].file` | — | Optional | Optional |
| `comments[].line` | — | Optional | Optional |

---

## Summary of Key Design Decisions

| Decision | Detail |
|---|---|
| One agent per rule | Enables parallel evaluation and clear per-rule reporting |
| Environment ≠ operating mode | Environment (interactive/ci/custom) controls config; operating mode (user-prompt/claude-code/future) controls execution |
| Two operating modes initially | User Prompt (manual) and Claude Code Headless (automated); Agents SDK and Internal Loop planned |
| Custom environments | Users define arbitrary environment names in config; selected via `--env` CLI flag |
| Plain-text rules | No DSL — rules are natural language, evaluated by LLM |
| Shared prompt generation | All modes generate the same per-rule prompt files; only execution differs |
| Configurable prompt templates | Default template ships with the tool; users override via `.prosecheck/prompt-template.md` and `.prosecheck/prompt.md` |
| Four rule statuses | `pass`, `warn`, `fail`, `dropped` — dropped is tool-assigned when no output received |
| Clean before, retain after | `.prosecheck/working/` is wiped at run start; prompts and outputs are kept after for inspection |
| Dropped rule retries | Configurable retry for rules that produce no output; dropped counts as failure after retries exhausted |
| Post-run tasks | Shell commands run after results collection; future: structured actions (PR comments, check runs) |
| Global ignore by default | `globalIgnore` inline patterns + `additionalIgnore` external files (defaults to `.gitignore`); set both to `[]` to disable |
| Gitignore-formatted inclusions | Rules carry inclusion patterns; initially single directory, extensible to exclusions |
| Pluggable rule calculators | `rules-md` and `adr` built-in; extensible via config |
| Change detection selects rules, not context | Diffs determine which rules fire; agents see full codebase within scope |
| Agents get the comparison ref | Agents can run their own diffs for fine-grained analysis |
| Prompts include changed file list | Agents receive the full list of changed files (modifications, additions, deletions) that triggered the rule |
| Environment-specific last-run defaults | Interactive writes but doesn't read; CI reads but doesn't write; custom environments inherit base |
| Base + environment config layering | Named environment overrides on top of base defaults; CLI flags override all |
| Local config overrides | `config.local.json` is gitignored and merged on top of `config.json` for personal settings |
| Structured JSON output | Pass/warn/fail with optional comments, file paths, and line numbers |
| Configurable base branch | `.prosecheck/config.json` controls diff base and calculator options |
| All modes share output contract | Every operating mode writes results to `.prosecheck/working/outputs/` as structured JSON |
| Claude Code Headless single-instance option | Config toggle to use one instance with agent-team prompt vs. one-per-rule (default) |
| Zod-defined config schema | Single Zod declaration for types, runtime validation, defaults, and editor introspection |
| Schema-driven config editor | `prosecheck config` command walks Zod schema at runtime — no hardcoded field list |
| Agent output validation | `RuleResultSchema` (Zod) validates agent output JSON with structured errors |
