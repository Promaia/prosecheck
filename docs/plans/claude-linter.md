# Claude Linter — Design Plan

Claude Linter is an LLM-powered code linter that processes directory-scoped rules written in plain text. Rather than encoding lint logic in ASTs or regex patterns, rules are natural-language descriptions in `RULES.md` files, evaluated by LLM agents against the target codebase.

---

## Environments and Operating Modes

Claude Linter separates two orthogonal concerns: **where** the tool runs (environment) and **how** it executes agents (operating mode).

### Environments

An environment controls configuration layering — which config overrides apply. Environments are passed via `--env <name>` (defaults to `local`).

- **`local`** — Developer workstation. Default environment when no `--env` flag is passed.
- **`ci`** — Continuous integration. Auto-detected when `process.env.CI` is set, but can also be passed explicitly.
- **Custom environments** — Users can define arbitrary environment names (e.g., `staging`, `nightly`) in `.rules/config.json` and pass them via `--env`. Each environment name maps to a config override block.

Environments affect config layering only (e.g., last-run defaults, model selection). They do not determine how agents are launched — that is the operating mode's job.

### Operating Modes

An operating mode controls how the tool executes rule evaluation. Modes are selected via `--mode <name>`.

#### User Prompt (implemented)

The tool generates a prompt and displays it to the user. The user copies the prompt into their own Claude Code session, which spawns an agent team — one agent per rule. Each agent writes its results to a file with a unique name (assigned in the prompt) under `.rules/working/outputs/`. The tool watches for output files to appear and/or waits for the user to signal completion, then collects and processes the results.

A generated prompt file at `.rules/prompt.md` provides additional instructions that Claude Code agents reference during execution.

**Flow:** Invoke → Collect rules → Build prompt → Display prompt and wait for output files or user signal → Collect results from `.rules/working/outputs/` → Process and display

#### Claude Code Headless (implemented)

The tool programmatically launches Claude Code CLI instances — one per rule — using `claude --print` (or the Claude Code SDK's headless API). Each instance receives a prompt instructing it to evaluate its assigned rule, explore the codebase autonomously, never ask the user questions, and write structured JSON results to a specific output file under `.rules/working/outputs/`.

This mode works in any environment. In CI it runs unattended. Locally, the tool provides progressive output showing per-rule status as each Claude Code instance completes.

**Flow:** Invoke → Collect rules → Launch parallel Claude Code CLI instances (one per rule) → Stream progress as instances complete → Collect results from `.rules/working/outputs/` → Process and display

#### Claude Agents SDK (planned — not yet implemented)

Uses the `@anthropic-ai/claude-code-sdk` to launch autonomous tool-using agents directly in-process. Same one-agent-per-rule model, but without spawning external CLI processes. This eliminates the Claude Code CLI as a runtime dependency and gives tighter control over tool definitions, context management, and agent orchestration.

#### Internal Loop (planned — not yet implemented)

Direct Anthropic API calls with a custom agent loop. The tool manages the message history, tool execution, and retry logic itself. Most flexible but most code to maintain. Would be needed if targeting non-Claude models or requiring custom tool implementations that the SDK doesn't support.

---

## Change Detection and Scoping

Change detection determines **which rules to run**, not what the agents see. The tool diffs the selected ref to find changed files, maps those files to their parent directories, and marks every rule whose scope contains at least one changed file. Rule calculators run first so directory scopes are known before change detection begins.

Agents always receive the **full codebase** within their rule's scope. They are given the comparison ref so they can run their own diff commands if needed. This means agents have complete context to evaluate compliance — change detection only controls which rules are triggered, not what context agents get.

### Comparison Ref

The tool can be invoked against different scopes:

- **Diverge from main** (default): Changes since the current branch diverged from `main`. The base branch name is configurable in `.rules/config.json`.
- **Diverge from specific ref**: Changes since diverging from a named branch or arbitrary git ref.
- **All code**: All rules run regardless of change history.

### Incremental Run Tracking

A git hash stored at `.rules/last-user-run` provides an additional scope narrowing. When enabled, changed-file detection uses the last-run hash instead of the merge-base. Agents still receive the original merge-base ref for comparison — last-run tracking only affects which rules are selected to run, not the ref agents compare against.

**Default behavior differs by environment:**

| Behavior | `local` environment | `ci` environment |
|---|---|---|
| Read last-run file | No (off by default) | Yes (on by default) |
| Write last-run file | Yes (on by default) | No (off by default) |

This means local runs always check against the full branch diff (safe default for developers) but record their position so CI can skip already-checked work. Each behavior is independently configurable. Custom environments inherit base defaults unless they define their own overrides.

### Configuration Layering

Config uses a base + environment override model:

```json
{
  "baseBranch": "main",
  "globalIgnore": [".git/", "node_modules/", "dist/", "build/", ".rules/working/"],
  "additionalIgnore": [".gitignore"],
  "lastRun": {
    "read": false,
    "write": true
  },
  "environments": {
    "ci": {
      "lastRun": {
        "read": true,
        "write": false
      }
    },
    "local": {
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

Top-level keys are base defaults. The `environments` object contains named overrides — `local` and `ci` are built-in, but users can add arbitrary names (e.g., `nightly`, `staging`). The active environment is selected via `--env <name>` (defaults to `local`; auto-detects `ci` when `process.env.CI` is set). CLI flags override everything:

- `--last-run-read` / `--no-last-run-read` — force enable/disable reading the last-run file
- `--last-run-write` / `--no-last-run-write` — force enable/disable writing the last-run file

---

## Project Tree

The tree below shows what a project using claude-linter looks like. Items marked **(optional)** are not required for the tool to function.

```
my-project/
├── .rules/                          # Tool configuration root
│   ├── config.json                  # Configuration (base branch, globalIgnore, calculators)
│   ├── prompt.md                     # System prompt / instructions for agents
│   ├── last-user-run                # Git hash of last local run (auto-managed)
│   └── working/                     # Ephemeral workspace (gitignored)
│       └── outputs/                 # Agent output files (Claude Code mode)
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
│       ├── 001-use-zod.md           # (optional) ADR → becomes enforceable rule
│       ├── 002-api-error-class.md   # (optional) ADR → becomes enforceable rule
│       └── ...
│
├── package.json
└── ...
```

**Required:** Only `.rules/config.json` is strictly required. The tool creates `prompt.md`, `last-user-run`, and `working/` as needed.

**RULES.md files** can live at any directory depth. Each file's directory becomes the inclusion pattern for all rules it contains. A `RULES.md` deeper in the tree adds rules specific to that subtree.

**ADR files** are read from the path configured in the `adr` calculator (default `docs/adr/`). These are optional — the `adr` calculator can be disabled in config.

---

## Rule Calculators

Rule discovery is handled by **rule calculators** — pluggable modules that produce a list of rules from a given source. The architecture supports multiple calculators; which ones are active and their options are declared in `.rules/config.json`.

### Config Structure

Rule calculators are declared in the `ruleCalculators` array within `.rules/config.json` (see [Configuration Layering](#configuration-layering) for the full config shape):

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

**`adr`** — Calculates rules from Architecture Decision Records. Reads ADR files from a configured path (default `docs/adr`) and derives enforceable rules from recorded decisions. For example, an ADR that decides "use Zod for all external data validation" becomes a rule agents can check against. In the initial implementation, ADR-derived rules apply project-wide (inclusions: root). In the future, ADR files could use YAML frontmatter to define specific inclusion/exclusion patterns. Enabled by default.

### Custom Calculators

The calculator interface is designed for extension. A calculator receives its options from config and returns a list of rules, each with:

- Rule name (the heading text for `rules-md`, or equivalent for other calculators)
- Rule description (natural language)
- Inclusions (gitignore-formatted patterns defining which files the rule applies to)
- Source reference (originating file for traceability)

### Rule Scope: Inclusions and Exclusions

Every rule carries an **inclusions** field — a list of gitignore-formatted patterns defining which files the rule applies to. Patterns follow gitignore syntax: directories match recursively, `!` prefixes negate (exclude), and standard glob wildcards apply.

#### Global Ignore

Before per-rule inclusions are evaluated, a **global ignore** list is applied to all rules. This is configured via two fields in `.rules/config.json`:

**`globalIgnore`** — an inline list of gitignore-formatted patterns, defaulting to common non-source paths:

```json
"globalIgnore": [".git/", "node_modules/", "dist/", "build/", ".rules/working/"]
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

Agents output structured JSON. A result is either a **pass** or a **fail**:

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

### Schema Summary

| Field | Pass | Fail |
|---|---|---|
| `status` | `"pass"` | `"fail"` |
| `rule` | Required | Required |
| `source` | Required | Required |
| `comment` | Optional string | — |
| `headline` | — | Required |
| `comments` | — | Required, non-empty array |
| `comments[].message` | — | Required |
| `comments[].file` | — | Optional |
| `comments[].line` | — | Optional |

---

## Summary of Key Design Decisions

| Decision | Detail |
|---|---|
| One agent per rule | Enables parallel evaluation and clear per-rule reporting |
| Environment ≠ operating mode | Environment (local/ci/custom) controls config; operating mode (user-prompt/claude-code/future) controls execution |
| Two operating modes initially | User Prompt (manual) and Claude Code Headless (automated); Agents SDK and Internal Loop planned |
| Custom environments | Users define arbitrary environment names in config; selected via `--env` CLI flag |
| Plain-text rules | No DSL — rules are natural language, evaluated by LLM |
| Global ignore by default | `globalIgnore` inline patterns + `additionalIgnore` external files (defaults to `.gitignore`); set both to `[]` to disable |
| Gitignore-formatted inclusions | Rules carry inclusion patterns; initially single directory, extensible to exclusions |
| Pluggable rule calculators | `rules-md` and `adr` built-in; extensible via config |
| Change detection selects rules, not context | Diffs determine which rules fire; agents see full codebase within scope |
| Agents get the comparison ref | Agents can run their own diffs for fine-grained analysis |
| Environment-specific last-run defaults | Local writes but doesn't read; CI reads but doesn't write; custom environments inherit base |
| Base + environment config layering | Named environment overrides on top of base defaults; CLI flags override all |
| Structured JSON output | Pass/fail with optional comments, file paths, and line numbers |
| Configurable base branch | `.rules/config.json` controls diff base and calculator options |
| All modes share output contract | Every operating mode writes results to `.rules/working/outputs/` as structured JSON |
