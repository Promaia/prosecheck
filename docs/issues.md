# Known Issues

> Fixed issues should be removed from this file.

## HIGH

### 1. `config.ts`: Local config is not validated independently

`config.local.json` is deep-merged onto the base config with only an `isPlainObject` check. A user could put `{ "timeout": "banana" }` in their local config and it would only fail at final validation with a generic error message ("Invalid configuration after merging all layers") rather than pointing to `config.local.json` as the source.

### 2. `config.ts`: `deepMerge` has unsound generic signature

`deepMerge<T extends Record<string, unknown>>(base: T, overlay: Partial<T>): T` — the overlay is typed as `Partial<T>`, but at call sites the overlay is cast with `as Partial<Config>`. The local config could have keys that don't exist in `Config` and they'd be silently merged in. The final `ConfigSchema.safeParse()` strips unknown keys (Zod default), so this isn't a runtime bug, but the types are misleading.

## MEDIUM

### 5. `calculators/adr.ts`: `extractSection` requires exact `## Rules` heading

The check `line.trim() === '## Rules'` is exact-match only. Variants like `## Rules:` or `## Rules (v2)` would be silently skipped. This is by-design per the ADR format, but could surprise users.

**Potential fix:** Warn user about near-matches (e.g. headings starting with `## Rules`) instead of silently skipping them.

### 7. `config-schema.ts`: `PartialConfig` type is only one level deep

The mapped type handles `Config[K] extends Record<string, unknown> ? Partial<Config[K]>` but doesn't recurse further. If config ever gains deeply nested structures beyond `lastRun`/`claudeCode` (which are only one level deep), partials of deeper levels wouldn't work. Not a problem today.

**Potential fix:** Warn user / fail early if deeply nested partial configs are attempted.

## LOW

*(none currently)*
