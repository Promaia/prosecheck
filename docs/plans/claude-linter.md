# Claude Linter — Design Plan

Claude Linter is a Claude Agents SDK-powered code linter that processes directory-scoped rules written in plain text. Rather than encoding lint logic in ASTs or regex patterns, rules are natural-language descriptions in `RULES.md` files, evaluated by LLM agents against the target codebase.

---

## Operating Modes

### CI Mode

In CI mode, the tool launches one agent in parallel per rule being checked. Each agent receives the relevant source context and its assigned rule, evaluates compliance, and reports findings. The system prompt for CI agents is loaded from `.rules/prompt-ci.md`.

**Flow:** Invoke → Collect rules → Launch parallel agents (one per rule) → Aggregate results → Exit with appropriate code

### Claude Code Mode

In Claude Code mode, the tool does not launch agents itself. Instead it generates a prompt the user hands to Claude Code. That prompt asks Claude Code to spawn an agent team — one agent per rule — and directs each agent to write its results to a file with a unique name (assigned in the prompt) under `.rules/working/outputs/`. The tool then collects and processes those output files.

A generated prompt file at `.rules/prompt-claude-code.md` provides additional instructions that Claude Code agents reference during execution.

**Flow:** Invoke → Collect rules → Build prompt → Show prompt to user and wait for continue/cancel → User runs prompt in Claude Code → User confirms completion → Tool collects results from `.rules/working/outputs/` → Process and display

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

**Default behavior differs by mode:**

| Behavior | Claude Code (local) | CI |
|---|---|---|
| Read last-run file | No (off by default) | Yes (on by default) |
| Write last-run file | Yes (on by default) | No (off by default) |

This means local runs always check against the full branch diff (safe default for developers) but record their position so CI can skip already-checked work. Each behavior is independently configurable.

### Configuration Layering

Config uses a base + mode override model:

```json
{
  "baseBranch": "main",
  "lastRun": {
    "read": false,
    "write": true
  },
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
  "ruleCalculators": []
}
```

Top-level keys are base defaults. The `ci` and `local` objects override base values for their respective modes. CLI flags override everything:

- `--last-run-read` / `--no-last-run-read` — force enable/disable reading the last-run file
- `--last-run-write` / `--no-last-run-write` — force enable/disable writing the last-run file

---

## Directory Layout

```
.rules/
├── config.json                # Configuration (base branch, rule calculators, options)
├── prompt-ci.md               # System prompt for CI-mode agents
├── prompt-claude-code.md      # Generated prompt file for Claude Code mode
├── last-user-run              # Git hash of last local run (auto-managed)
├── working/
│   └── outputs/               # Agent output files (Claude Code mode)
└── ...
```

Project-level `RULES.md` files can live at any directory depth. Rules scoped to a subdirectory apply only to files within that subtree.

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

**`rules-md`** — The default calculator. Discovers `RULES.md` files throughout the project tree and parses each rule entry from them. Each rule is plain-text, scoped to the directory containing its `RULES.md`. Enabled by default.

**`adr`** — Calculates rules from Architecture Decision Records. Reads ADR files from a configured path (default `docs/adr`) and derives enforceable rules from recorded decisions. For example, an ADR that decides "use Zod for all external data validation" becomes a rule agents can check against. Enabled by default.

### Custom Calculators

The calculator interface is designed for extension. A calculator receives its options from config and returns a list of rules, each with:

- Rule text (natural language)
- Scope (directory path the rule applies to)
- Source reference (originating file for traceability)

---

## RULES.md Format

Rules files contain plain-text rules, one per entry. The exact format is intentionally simple — each rule is a human-readable statement that an LLM agent can evaluate code against.

```markdown
# RULES.md

- All exported functions must have JSDoc comments.
- No direct database queries outside of the `db/` module.
- Error responses must use the shared ApiError class.
```

Rules in a `RULES.md` apply to all files in that directory and its children. A `RULES.md` deeper in the tree can add rules specific to that subtree.

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
| Two operating modes | CI runs autonomously; Claude Code integrates into developer workflow |
| Plain-text rules | No DSL — rules are natural language, evaluated by LLM |
| Directory scoping | Rules in `RULES.md` apply to their subtree |
| Pluggable rule calculators | `rules-md` and `adr` built-in; extensible via config |
| Change detection selects rules, not context | Diffs determine which rules fire; agents see full codebase within scope |
| Agents get the comparison ref | Agents can run their own diffs for fine-grained analysis |
| Mode-specific last-run defaults | Local writes but doesn't read; CI reads but doesn't write |
| Base + mode config layering | `ci` and `local` overrides on top of base defaults; CLI flags override all |
| Structured JSON output | Pass/fail with optional comments, file paths, and line numbers |
| Configurable base branch | `.rules/config.json` controls diff base and calculator options |
