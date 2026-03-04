# 6. Gitignore-format for scope patterns

## Status

Accepted

## Context

Rules need inclusion patterns (which files they apply to) and the tool needs global exclusion patterns (which files to skip entirely). We need a pattern language for both.

Alternatives considered:

- **Glob patterns.** Familiar but limited — no negation, no directory-recursive semantics by default.
- **Regular expressions.** Powerful but hard to read and write for file paths. Overkill for this use case.
- **Custom DSL.** Maximum flexibility but another thing to learn. Unjustifiable when existing formats work.
- **Gitignore format.** Every developer already knows it. Supports directories, negation (`!`), wildcards, and recursive matching.

## Decision

All file-matching patterns — `globalIgnore`, `additionalIgnore`, and per-rule inclusions — use gitignore syntax. The `ignore` npm package provides the matching implementation.

## Consequences

- **Zero learning curve.** Developers already write `.gitignore` files. The same patterns work in `.prosecheck/config.json` and future RULES.md frontmatter.
- **Negation built in.** `src/api/` followed by `!src/api/generated/` works naturally. This supports fine-grained scoping without a separate exclusion mechanism.
- **Ecosystem compatibility.** The `additionalIgnore` config defaults to `[".gitignore"]`, so projects automatically respect their existing ignore patterns.
- **Battle-tested implementation.** The `ignore` package is the de-facto standard for gitignore matching in Node.js.
- **Not perfect for every case.** Gitignore patterns are designed for exclusion, not inclusion. Using them for "which files does this rule apply to" is a slight semantic stretch, but the mechanics work well.
