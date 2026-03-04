# Prosecheck

LLM-powered code linting with natural-language rules. Write rules in plain English in `RULES.md` files, and prosecheck evaluates them against your codebase using LLM agents.

> **Status: Planning phase.** The design is documented in [`docs/plans/`](docs/plans/) but no implementation exists yet.

## How It Works

1. Write rules as headings in `RULES.md` files placed anywhere in your project
2. Prosecheck detects which rules are affected by your changes
3. LLM agents evaluate each rule against the codebase and report pass/warn/fail

## Documentation

- [Design Plan](docs/plans/prosecheck.md) — architecture, operating modes, change detection, output format
- [Project Foundation](docs/plans/project-foundation.md) — repo structure, tooling, dependencies
