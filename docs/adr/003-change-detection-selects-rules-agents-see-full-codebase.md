# 3. Change detection selects rules, agents see full codebase

## Status

Accepted

## Context

When a developer changes files, we need to decide two things: which rules to run, and what context to give the agents evaluating those rules.

One approach is to feed agents only the diff — the changed lines or files. This is cheaper but loses surrounding context. A function might comply with a rule in isolation but violate it when you see how it's called. Another approach is to give agents the entire repository, which is expensive and noisy.

## Decision

Change detection determines **which rules fire** (by matching changed files to rule scopes), but agents receive the **full codebase within their rule's scope**. Agents also receive the git comparison ref so they can run their own diffs if useful.

## Consequences

- **Agents have complete context.** An agent evaluating "no direct database queries outside db/" can see the full src/services/ directory, not just the changed lines. It can identify violations that span multiple files.
- **Change detection is cheap.** A `git diff --name-only` is fast. Only rules whose scope overlaps with changed files are triggered — most runs evaluate a small subset of rules.
- **Agents can be surgical when useful.** By receiving the comparison ref, agents can run `git diff` themselves to focus on what changed while still having the full picture available.
- **Prompt size is bounded by rule scope.** A rule scoped to `src/api/` only sees that subtree, not the whole repo. Global rules (like ADR-derived rules) see everything, which may require future optimization.
- **No false negatives from missing context.** The agent never lacks information needed to evaluate its rule.
