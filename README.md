# Prosecheck

LLM-powered code linting with natural-language rules. Write rules in plain English, and prosecheck evaluates them against your codebase using Claude.

```
┌────────┬───────────────────────────────────────────────────────────────┐
│ STATUS │ RULE                                                          │
├────────┼───────────────────────────────────────────────────────────────┤
│ PASS   │ Request ID must propagate from endpoints to background jobs   │
│ FAIL   │ Architecture docs are updated when modules change             │
└────────┴───────────────────────────────────────────────────────────────┘

1 failed | 1 passed
```

## How It Works

1. You write rules as headings in `RULES.md` files placed anywhere in your project
2. Prosecheck detects which files changed (via `git diff`) and which rules apply
3. Claude agents evaluate each triggered rule against the codebase and report pass/warn/fail
4. Results are formatted for the terminal, as JSON, or as SARIF for GitHub Code Scanning

## Features

- **Natural-language rules** — enforce conventions that traditional linters can't express: architectural boundaries, naming consistency, documentation standards, API design patterns.
- **Scoped rules** — place `RULES.md` in any directory to scope its rules there. `src/api/RULES.md` only triggers when `src/api/` files change
- **Incremental** — only rules affected by your changes are evaluated
- **Multiple output formats** — terminal (stylish), JSON, and SARIF
- **Configurable dispatch** — one agent per rule, parallel sub-agents, or sequential single-agent
- **CI-ready** — auto-detects CI environments, supports SARIF upload to GitHub Code Scanning
- **ADR rules** — extract rules from Architecture Decision Records automatically

## Installing

### Prerequisites

- [Git](https://git-scm.com/downloads) (for change detection)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (the default execution backend)
- [Node.js](https://nodejs.org/) >= 20 (for the npm install route)

### From npm

```bash
npm install -D prosecheck
```

Or run directly:

```bash
npx prosecheck lint
```

## Quick Setup

Initialize prosecheck in your project:

```bash
prosecheck init --rules
```

This creates:

- `.prosecheck/config.json` — configuration file
- `RULES.md` — a starter rules file with examples

Edit `RULES.md` to define your own rules:

```markdown
# Rules

## Request ID must propagate from endpoints to background jobs

The `requestId` from incoming API requests must be threaded through to all
background job dispatches (queue publishers, async workers). This ensures
end-to-end tracing across synchronous and asynchronous boundaries. Check
that job dispatch calls include the request ID from context, not a newly
generated one.

## Architecture docs are updated when modules change

When a module under `src/lib/` is added, removed, or has its public API
changed, the corresponding section in `docs/architecture/ARCHITECTURE.md`
must be updated in the same PR. New modules need a new section. Removed
modules should have their section deleted. Signature changes should be
reflected in the description.
```

Rules are markdown headings. The body is the rule description — write as much or as little detail as you need.

Scope is determined by where you place the `RULES.md` file: rules apply to everything in the file's directory and below. Place it at the highest level you want the rules to apply to. A file at `src/api/RULES.md` only triggers when files under `src/api/` change. A `RULES.md` at the project root applies to everything.

Run the linter:

```bash
prosecheck lint
```

Output:

```
┌────────┬───────────────────────────────────────────────────────────────┐
│ STATUS │ RULE                                                          │
├────────┼───────────────────────────────────────────────────────────────┤
│ PASS   │ Request ID must propagate from endpoints to background jobs   │
│ FAIL   │ Architecture docs are updated when modules change             │
└────────┴───────────────────────────────────────────────────────────────┘

1 failed | 1 passed
```

### Output formats

```bash
prosecheck lint --format stylish   # default, colored terminal output
prosecheck lint --format json      # machine-readable JSON
prosecheck lint --format sarif     # SARIF 2.1.0 for GitHub Code Scanning
```

## CI Setup

### Option 1: Full check on every push

The simplest approach. Every push runs all triggered rules from scratch.

```bash
prosecheck init --github-actions
```

Generates a GitHub Actions workflow that runs `prosecheck lint --last-run-read 0` on every push. No incremental state, no extra requirements.

**Requirements:**

- `ANTHROPIC_API_KEY` in your repository secrets (used by Claude Code)

### Option 2: Incremental with merge queue

For larger projects where running all rules on every push is too expensive.

```bash
prosecheck init --github-actions-incremental
```

Generates two workflows:

- **PR push:** runs `prosecheck lint --last-run-read 1` (only checks rules not covered by a previous run)
- **Merge queue:** runs `prosecheck lint --last-run-read 0` (full check before merge)

Also sets `lastRun.write=true` for the interactive environment so local runs persist the hash.

**Requirements:**

- `ANTHROPIC_API_KEY` in your repository secrets
- [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) enabled on your repository (ensures the full check runs before merge)

### Option 3: Hash check (zero token cost)

For teams that run prosecheck locally but want CI to verify it actually happened.

```bash
prosecheck init --github-actions-hash-check
```

Generates a workflow that checks whether `.prosecheck/last-user-run` matches the current commit — confirming someone ran prosecheck before pushing. No LLM calls in CI, no API key needed. Relies on developers running locally with `--last-run-write 1` and committing the hash file.

---

## Configuration

### Environments

Prosecheck auto-detects the environment from `process.env.CI` or defaults to `interactive`. Override with `--env`:

```bash
prosecheck lint --env ci
```

Environment-specific settings are defined in `config.json` under `environments`:

```json
{
  "environments": {
    "ci": { "warnAsError": true, "timeout": 600 },
    "interactive": {}
  }
}
```

### Local overrides

Create `.prosecheck/config.local.json` for personal settings that aren't committed to the repo (it's gitignored automatically):

```json
{
  "timeout": 60,
  "lastRun": { "write": true }
}
```

### Run modes

Control how rules are dispatched to Claude via `claudeCode.claudeToRuleShape`:

| Mode                 | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `one-to-many-teams`  | **(default)** Rules packed into team invocations with parallel sub-agents |
| `one-to-one`         | One Claude process per rule                                               |
| `one-to-many-single` | All rules in one process, evaluated sequentially                          |

```bash
prosecheck lint --claude-to-rule-shape one-to-one
```

### Additional rule sources

Beyond `RULES.md` files, prosecheck can extract rules from Architecture Decision Records:

```json
{
  "ruleCalculators": [
    { "name": "rules-md" },
    { "name": "adr", "options": { "path": "docs/adr" } }
  ]
}
```

ADRs that contain a `## Rules` section automatically generate prosecheck rules. ADRs without that heading are ignored. Sub-rules (`### Sub-rule`) within the section become separate rules; otherwise the entire section is one rule named after the ADR title.

### More info

Run any command with `--help` for available options:

```bash
prosecheck lint --help
prosecheck init --help
prosecheck config --help
```

View all configuration fields, their current values, and descriptions:

```bash
prosecheck config list
```

---

## Project Internals

Prosecheck is TypeScript (strict mode, ESM-only, Node >= 20). Built with tsup, tested with vitest.

### Repository structure

```
src/
  cli.ts                 # Commander-based CLI entry point
  commands/              # lint, init, config subcommands
  lib/                   # Core: config, engine, change detection, prompts, results
    calculators/         # Rule discovery (rules-md, adr)
  modes/                 # Execution backends (claude-code, user-prompt)
  formatters/            # Output formatting (stylish, json, sarif)
  ui/                    # Ink/React interactive terminal UI
docs/
  architecture/          # Architecture documentation
  roadmap/               # Roadmap and milestone tracking
  adr/                   # Architectural Decision Records
  plans/                 # Original design documents
```

### Documentation

- [Architecture](docs/architecture/ARCHITECTURE.md) — system design, data flow, module descriptions
- [Roadmap](docs/roadmap/README.md) — current and completed milestones
- [ADRs](docs/adr/) — architectural decision records
- [Design plans](docs/plans/) — original design documents
