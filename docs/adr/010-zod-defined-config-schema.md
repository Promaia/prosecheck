# 10. Zod-defined configuration schema

## Status

Accepted

## Context

Prosecheck has a layered configuration model (ADR 009) with non-trivial structure: nested objects (`lastRun`, `claudeCode`), arrays of typed objects (`ruleCalculators`), environment override blocks, and fields with specific default values. This config needs:

1. **Runtime validation** — JSON files from disk can contain anything. Bad config should produce clear error messages, not cryptic runtime crashes.
2. **TypeScript types** — The codebase needs a `Config` type that stays in sync with the validation logic.
3. **Default values** — Many fields have defaults (`timeout: 300`, `baseBranch: "main"`). These should be declared once, not duplicated between validation and loading logic.
4. **Self-describing schema** — A future interactive configuration editor (the `config` command) needs to discover field names, types, descriptions, defaults, and constraints at runtime without hardcoding UI strings.

Alternatives considered:

- **Manual types + manual validation.** Types and validation diverge over time. No runtime introspection for an editor.
- **JSON Schema.** Good for validation, but TypeScript type inference requires code generation (e.g., `json-schema-to-typescript`). No natural way to attach descriptions for a TUI editor.
- **io-ts / superstruct.** Capable but less ecosystem adoption. Zod has become the de-facto standard for TypeScript schema validation.
- **Zod.** Defines schema, infers TypeScript types, validates at runtime, carries descriptions and defaults — all from a single declaration. 25M+ weekly npm downloads, first-class TypeScript support.

## Decision

The configuration schema is defined as a **Zod schema** in `src/lib/config-schema.ts`. This single schema declaration serves four purposes:

1. **Type inference** — `z.infer<typeof ConfigSchema>` produces the `Config` type. No separate type definition to maintain.
2. **Runtime validation** — `ConfigSchema.safeParse(data)` validates loaded JSON with structured error reporting. Invalid config produces actionable error messages (field path, expected type, received value).
3. **Default values** — `z.default()` on each field declares defaults inline. `ConfigSchema.parse({})` produces a fully-populated config with all defaults applied. Deep merge of partial configs naturally works through `.deepPartial()` for overlay schemas.
4. **Schema introspection** — `.describe()` on each field attaches human-readable descriptions. The config editor walks the schema tree at runtime to discover field names, types, descriptions, defaults, and constraints — no hardcoded field list.

A `PartialConfigSchema` (via `.deepPartial()`) is used for `config.local.json` and environment override blocks, since these are partial overlays merged onto the base.

Agent output is also validated with a Zod schema (`RuleResultSchema`) when reading output files from `.prosecheck/working/outputs/`. This catches malformed agent output early with clear errors.

## Consequences

- **Single source of truth.** Types, validation, defaults, and documentation are one declaration. Adding a config field means adding one Zod field — types, validation, defaults, and editor metadata update automatically.
- **Actionable error messages.** `ZodError` includes the field path (e.g., `environments.ci.lastRun.read`), expected type, and received value. Config errors surface as exit code 2 with clear guidance.
- **Config editor for free.** The future `prosecheck config` command can walk the Zod schema to render an interactive TUI — it reads `.describe()` for labels/help text, `.default()` for current defaults, and the Zod type for input validation. No separate field registry needed.
- **New dependency.** Zod adds ~60KB to the bundle. Acceptable given it replaces what would otherwise be manual validation code, a separate type definition, and a separate field metadata registry.
- **Schema must be kept readable.** A large Zod schema can become unwieldy. Mitigated by breaking it into sub-schemas (`LastRunSchema`, `ClaudeCodeSchema`, `CalculatorConfigSchema`) composed into the top-level `ConfigSchema`.
