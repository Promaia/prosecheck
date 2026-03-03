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

## Change Scoping

The tool can be invoked against different scopes of changes:

- **Diverge from main** (default): Lint only changes since the current branch diverged from `main`. The base branch name is configurable in `.rules/config.json`.
- **Diverge from specific ref**: Lint only changes since diverging from a named branch or arbitrary git ref.
- **All code**: Lint the entire codebase regardless of change history.

### Incremental Run Tracking

A git hash is stored at `.rules/last-user-run`. When present, the tool can additionally limit scope to only changes since that hash. This lets local user invocations cover only new work, preventing redundant and costly CI runs on already-checked code.

This behavior is on by default and can be disabled via a CLI flag (e.g., `--no-incremental`).

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

```json
{
  "baseBranch": "main",
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

## Summary of Key Design Decisions

| Decision | Detail |
|---|---|
| One agent per rule | Enables parallel evaluation and clear per-rule reporting |
| Two operating modes | CI runs autonomously; Claude Code integrates into developer workflow |
| Plain-text rules | No DSL — rules are natural language, evaluated by LLM |
| Directory scoping | Rules in `RULES.md` apply to their subtree |
| Pluggable rule calculators | `rules-md` and `adr` built-in; extensible via config |
| Incremental tracking | `.rules/last-user-run` avoids redundant work between local and CI |
| Configurable base branch | `.rules/config.json` controls diff base and calculator options |
