# 2. One agent per rule

## Status

Superseded by [ADR-012](012-flexible-rule-dispatch.md)

## Context

When evaluating multiple rules against a codebase, we can either have a single agent evaluate all rules in one pass or spawn a separate agent per rule. A single agent is cheaper (one LLM call) but creates a large, complex prompt that risks rules being overlooked or conflated. Separate agents are more expensive but each has a focused task.

## Decision

Each rule is evaluated by its own independent agent. Agents run in parallel and produce isolated results.

## Consequences

- **Clear accountability.** Each result maps to exactly one rule and one agent. Failures are easy to diagnose.
- **Parallel execution.** Rules evaluate concurrently, limited only by API rate limits or process concurrency.
- **Independent failure.** One agent crashing or timing out doesn't affect other rules. Dropped rules are detected and optionally retried.
- **Higher cost.** N rules means N LLM calls. For the expected scale (5–30 rules per project), this is acceptable.
- **Simpler prompts.** Each agent sees one rule, its scope, and the changed files. No prompt engineering needed to prevent rules from interfering with each other.
- **Natural scaling boundary.** If cost becomes a concern, batching multiple rules into one agent is a future optimization — but starting with one-per-rule gives the cleanest baseline.
