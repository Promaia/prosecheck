# Golden Output Fixtures

These JSON files represent realistic Claude agent outputs for contract testing. Each file is parsed by `parseResultFile()` in the test suite to verify schema compatibility.

## Naming convention

Files are prefixed with their expected status: `pass-*`, `warn-*`, `fail-*`.

## When to update

- **Schema change**: If `RuleResultSchema` in `config-schema.ts` changes, update golden files to match the new schema and verify tests pass.
- **New edge case**: If a real Claude output reveals a new pattern, add a golden file for it.
- **Prompt template change**: After modifying `DEFAULT_TEMPLATE` in `prompt.ts`, run the golden output tests to ensure outputs still parse correctly.

## How to update

1. Edit or add JSON files in this directory.
2. Run `npm run test -- tests/unit/lib/golden-outputs.test.ts` to verify all files parse correctly.
3. Commit the updated fixtures alongside the schema or template change.
