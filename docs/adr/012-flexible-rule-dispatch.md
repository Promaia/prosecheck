# 12. Flexible rule dispatch model

## Status

Accepted (supersedes ADR-002)

## Context

ADR-002 established one-agent-per-rule as the execution model. This remains the cleanest baseline — focused prompts, independent failure, easy debugging. However, real-world usage has revealed cases where strict one-per-rule is not ideal:

- **Large rulesets.** Projects with 20+ rules spawn many parallel agents, consuming significant compute and hitting concurrency limits.
- **Related rules.** Some rules are logically related (e.g., all style rules, all security rules). Running them under one agent reduces overhead without losing much isolation.
- **User preference.** Some users prefer a single agent evaluating everything sequentially, trading speed for simplicity and lower cost.

## Decision

Rule dispatch is configurable via `claudeToRuleShape`, which controls how **ungrouped** rules are handled:

- **`one-to-one`** (default spirit of ADR-002): one process per rule.
- **`one-to-many-teams`**: rules packed into agent-teams invocations where sub-agents evaluate rules in parallel within a single orchestrator process.
- **`one-to-many-single`**: all rules sent to one agent for sequential evaluation.

**Rule groups** (via frontmatter `group` field) allow users to explicitly batch related rules under one agent. Grouped rules always run as `one-to-many-single` regardless of the `claudeToRuleShape` setting — one process per group, rules evaluated sequentially within.

**`maxConcurrentAgents`** limits how many agents (processes or sub-agents) run simultaneously. The execution plan builder packs invocations into sequential batches respecting this limit, with team invocations split across batches when necessary.

## Consequences

- **Backwards compatible.** `one-to-one` with no groups produces the same behavior as ADR-002.
- **Scalable.** Large rulesets can use groups and concurrency limits to avoid overwhelming the system.
- **User choice.** Users pick the trade-off between isolation (one-to-one), speed (one-to-many-teams), and simplicity (one-to-many-single).
- **Groups are always sequential.** A group is a cost/concurrency optimization, not a parallelism tool. Rules within a group share one agent context.
- **Complexity.** The execution plan builder is more complex than the original flat-parallel model, but the unified pipeline handles all combinations through one code path.
