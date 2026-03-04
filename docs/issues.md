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

### `claude-code.ts`: Uses `execFile` instead of `execa`

The ROADMAP originally specified execa for process spawning, but `execFile` from `node:child_process` was used instead. The execa package remains in `package.json` as an unused dependency. Consider switching to execa if more advanced process management is needed (e.g., streaming output, better signal handling), or remove the execa dependency if it stays unused.

### `user-prompt.ts`: `watchForOutputs` watcher callback has benign race condition

If `fs.watch` fires rapid file events, `getCompletedRuleIds` may be called multiple times concurrently. Each call independently checks completion and may call `resolve()`. This is harmless since `resolve()` is idempotent after the first call, but the redundant I/O could be avoided with a debounce or guard flag.

### `config.ts`: Environment overrides bypass static type constraints via `Partial<Config>` cast

When environment overrides are deep-merged at `config.ts:126`, the `EnvironmentOverrideSchema` (a subset of `Config`) is cast as `Partial<Config>`. This means TypeScript won't catch if extra keys sneak in. Not a runtime bug — Zod's final `safeParse()` strips unknown keys — but it's the same family of dynamic-config-meets-static-types looseness as issue 2.

### `cli.test.ts`: Integration tests use `npx tsx` instead of built artifact

CLI integration tests spawn `npx tsx src/cli.ts` rather than the built `dist/cli.js`. This means they don't exercise the actual bundled artifact. Acceptable since the build step is separately verified by CI, but a future e2e test against `dist/cli.js` would provide more confidence in the shipped binary.

### `pipeline.test.ts`: E2E tests don't exercise `additionalIgnore` file loading

The e2e tests set `additionalIgnore: []` in the config, skipping the `.gitignore` loading path in `buildIgnoreFilter`. This code path is covered by unit tests, but not exercised end-to-end.

### `pipeline.test.ts`: E2E tests don't cover post-run tasks

Post-run task execution (`config.postRun` → `executePostRun`) is unit-tested but not included in the e2e pipeline tests. A future test could verify that post-run commands receive the correct environment variables after a full pipeline run.

### `claude-code.test.ts`: No test for `env` var propagation in `spawnClaude`

The claude-code tests mock `execFile` but don't verify that `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is passed through in the `env` option when `agentTeams` is true. The env var injection logic in `runSingleInstance` is untested at the unit level.
