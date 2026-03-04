# 4. Environment vs operating mode separation

## Status

Accepted

## Context

Most CLI tools conflate "where am I running" with "how should I behave." A tool might have a `--ci` flag that simultaneously changes output format, disables interactivity, and switches execution strategy. This makes it hard to test CI behavior locally or run headless mode on a developer machine.

Prosecheck needs to support multiple execution strategies (generating a prompt for the user, spawning Claude Code instances, future SDK-based agents) across multiple environments (developer workstations, CI pipelines, nightly jobs).

## Decision

Two orthogonal axes:

- **Environment** (`--env`) controls configuration layering — which config overrides apply. Built-in environments are `interactive` (default) and `ci` (auto-detected). Users can define custom environments.
- **Operating mode** (`--mode`) controls how agents are launched — user-prompt, claude-code headless, or future modes (agents SDK, internal loop).

These are independent. Any mode can run in any environment.

## Consequences

- **Testable.** A developer can run `--mode claude-code --env ci` locally to reproduce CI behavior exactly.
- **Extensible.** New modes (agents SDK) and new environments (staging, nightly) are added independently without combinatorial complexity.
- **Clear mental model.** Environment answers "what config do I use?" Mode answers "how do I execute?" No conflation.
- **Slightly more to learn.** Users must understand two concepts instead of one. Mitigated by sensible defaults — most users never pass either flag.
