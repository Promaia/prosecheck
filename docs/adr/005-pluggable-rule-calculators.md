# 5. Pluggable rule calculators

## Status

Accepted

## Context

Rules can come from multiple sources: `RULES.md` files scattered through the project, Architecture Decision Records, or potentially other formats (YAML policy files, inline code annotations, external rule registries). We need an architecture that supports discovering rules from different source formats without hardcoding each one.

Alternatives considered:

- **Hardcoded RULES.md parser only.** Simple but not extensible. Adding ADR support would require modifying core code.
- **Plugin system with dynamic loading.** Flexible but heavy — requires a plugin API, loader, versioning.
- **Config-driven calculator registry.** Middle ground — calculators are named modules registered in config, with a simple interface.

## Decision

Rule discovery is handled by **rule calculators** — named modules declared in `.prosecheck/config.json`. Each calculator receives its config options and returns a list of rules with name, description, inclusions, and source reference. Two calculators are built-in: `rules-md` (discovers and parses RULES.md files) and `adr` (derives rules from ADR documents that contain an explicit `## Rules` heading — ADRs without this heading are documentation-only and produce no rules).

## Consequences

- **New rule sources don't touch core.** Adding a calculator is isolated — implement the interface, register in config.
- **Users control which calculators run.** Disable ADR-derived rules by setting `"enabled": false` in config. No code changes needed.
- **Simple interface.** A calculator is a function: `(options) → Rule[]`. No lifecycle hooks, no plugin API.
- **Limited to built-in calculators initially.** External/third-party calculators are a future concern — the interface is designed for it, but the loading mechanism isn't built yet.
