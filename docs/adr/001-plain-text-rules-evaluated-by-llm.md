# 1. Plain-text rules evaluated by LLM

## Status

Accepted

## Context

Code linters traditionally encode rules as AST visitors, regex patterns, or structured schemas. These approaches require rule authors to learn a DSL or programming API, which limits who can write and maintain rules. Many valuable coding standards — "services should not call the database directly," "error responses must use the shared ApiError class" — are easy to express in English but awkward or impossible to express as AST patterns.

LLMs can evaluate natural-language instructions against code with reasonable accuracy. This creates an opportunity to build a linter where rules are written in plain prose.

## Decision

Rules are natural-language descriptions written in Markdown. There is no DSL, schema, or structured rule format. An LLM agent reads each rule and the relevant codebase, then judges compliance.

## Consequences

- **Anyone can write rules.** No programming knowledge required — product managers, architects, and team leads can contribute rules directly.
- **Rules can express intent.** "Use the logger utility instead of console.log" captures intent that a regex (`/console\.log/`) misses (e.g., the rule doesn't apply in test helpers).
- **Evaluation is non-deterministic.** The same rule may produce different results across runs. This is an inherent tradeoff — we accept it because the rules being evaluated are also inherently fuzzy.
- **Cost scales with rule count.** Each rule requires an LLM call. This is acceptable for the tens-of-rules scale we target, not for hundreds.
- **No static analysis guarantees.** Unlike AST-based linters, prosecheck cannot guarantee it catches every violation. It complements traditional linters rather than replacing them.
