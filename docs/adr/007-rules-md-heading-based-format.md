# 7. RULES.md heading-based format

## Status

Accepted

## Context

We need a format for defining rules in source-controlled files. This format will be the primary way users interact with prosecheck, so it must be easy to read, write, and review in pull requests.

Alternatives considered:

- **YAML/JSON per-rule files.** Structured but verbose. A directory of `rule-name.yaml` files adds friction — creating a rule requires creating a file.
- **YAML frontmatter in Markdown.** Adds metadata support but complicates parsing and is less readable for non-technical contributors.
- **Single file, structured format.** A YAML or JSON file listing rules. Loses the prose-friendly nature of the tool.
- **Markdown with headings as delimiters.** Each `#` heading starts a new rule. Everything between headings is that rule's description. Subheadings (`##`, `###`) are part of the description, not separate rules.

## Decision

Rules are defined in `RULES.md` files using top-level headings (`#`) as rule names. The heading text becomes the rule name. All content from one heading to the next (or end of file) is the rule's description. Subheadings are part of the description. Text before the first heading is ignored.

A `RULES.md` file can live at any directory depth. Its directory becomes the inclusion scope for all rules it contains.

## Consequences

- **Natural to write.** Authors write a heading and a paragraph. No syntax to learn.
- **Reviewable.** Adding a rule is a readable diff — a heading and some prose.
- **Scoping by placement.** Drop a `RULES.md` in `src/api/` and those rules apply to that subtree. No configuration needed.
- **Multiple rules per file.** One `RULES.md` can contain many rules, avoiding file proliferation.
- **Limited metadata.** No structured fields for severity, tags, or custom scope overrides. These can be added later via optional frontmatter without breaking the base format.
- **Heading ambiguity.** Rule names must be top-level headings. A `RULES.md` that uses `#` for document title and `##` for rules won't parse correctly. This convention must be documented clearly.
