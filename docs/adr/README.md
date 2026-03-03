# docs/adr

Architecture Decision Records (ADRs) capture important technical decisions along with their context, alternatives considered, and consequences. Code tells you *what* was built; ADRs tell you *why* it was built that way and *what else was considered*.

ADRs are the canonical source of truth for architectural decisions in this repository. Both humans and AI agents should consult existing ADRs before making changes to the systems they describe, and should create new ADRs when making significant architectural choices.

## When to write an ADR

Write an ADR when a decision is **hard to reverse**, **affects multiple packages**, or **would surprise someone reading the code without context**. Examples: choosing a database, adding a new service, changing the auth model, adopting a new library for a core concern, restructuring package boundaries.

Don't write an ADR for routine choices like picking a utility function, fixing a bug, or choosing between two equivalent approaches with no meaningful tradeoff.

## Format

Every ADR follows this template:

```markdown
# ADR-NNNN: [Short title describing the decision]

## Status

[Proposed | Accepted | Superseded by ADR-NNNN | Deprecated]

## Date

YYYY-MM-DD

## Context

What is the problem or situation that requires a decision? What constraints
exist? Keep this factual — describe the forces at play, not the solution.

## Options Considered

Brief description of each alternative that was evaluated, with key
tradeoffs noted. This section is what makes ADRs valuable — it records
the paths not taken and why.

## Decision

State the decision clearly in one or two sentences. "We will use X" or
"We will not do Y." Be direct.

## Consequences

What follows from this decision? List both positive and negative
consequences, and any risks or things to watch for. Use prose, not
bullet points, unless there are many distinct consequences.

## Additional References (optional)

Links to research documents, external resources, or related ADRs that
informed this decision. Omit this section if there are no references
beyond what's already linked inline.
```

## Rules and Reasons

| Rule | Reason |
| :--- | :----- |
| ADRs are numbered sequentially (ADR-0001, ADR-0002, ...) | Provides a stable reference ID and shows decision order |
| File names follow the pattern `NNNN-short-title.md` | Sorts chronologically in the filesystem; readable at a glance |
| ADRs are immutable once accepted | The historical reasoning is the point — editing it retroactively defeats the purpose |
| To reverse a decision, write a new ADR that supersedes the old one | Preserves the full decision history; the old ADR's status updates to "Superseded by ADR-NNNN" |
| The status field on a superseded ADR may be updated | This is the only permitted edit to an accepted ADR |
| Every ADR must include Options Considered | Recording rejected alternatives is what makes ADRs useful — without it, it's just a changelog entry |
| Keep ADRs short (aim for one page) | Long ADRs don't get read. Link to research docs in `docs/research/` for detailed analysis |
| ADRs should reference related research documents where applicable | Connects the decision to the deeper investigation that informed it |
| AI agents must check existing ADRs before modifying systems they describe | Prevents undoing intentional decisions; ADRs are context that keeps agents on track |
| AI agents should draft new ADRs (status: Proposed) for human review when making architectural changes | Captures reasoning while it's fresh; humans approve before the status moves to Accepted |
