# 9. Configuration model and runtime behavior defaults

## Status

Accepted

## Context

This ADR records the collection of configuration and runtime behavior decisions that define the developer experience. Each follows established conventions from tools like ESLint, Prettier, and Git. Individually routine, together they form the contract users rely on.

## Decision

### Config file location and layering

Configuration lives in `.prosecheck/config.json`. The resolution order follows the standard pattern used by ESLint, Prettier, and similar tools:

1. **`config.json`** — base defaults, committed to the repository
2. **`config.local.json`** — personal overrides, gitignored (like `.env.local`)
3. **Environment overrides** — named blocks in `config.environments` selected via `--env`
4. **CLI flags** — highest priority, override everything

Deep merge is used at each layer. This means a `config.local.json` with `{ "timeout": 600 }` only overrides timeout without affecting other settings.

### Exit codes

Following the ESLint convention exactly:

| Code | Meaning |
|---|---|
| 0 | All rules passed (or only warnings, unless `--warn-as-error`) |
| 1 | One or more rules failed |
| 2 | Configuration or tool error |

`process.exitCode` is used instead of `process.exit()` for graceful cleanup.

### Global ignore defaults

`globalIgnore` defaults to `[".git/", "node_modules/", "dist/", "build/", ".prosecheck/working/"]`. `additionalIgnore` defaults to `[".gitignore"]`, automatically importing the project's existing gitignore patterns. Both can be set to `[]` to disable.

This follows the principle of sensible defaults — the tool should ignore what Git ignores without requiring configuration.

### Working directory lifecycle

`.prosecheck/working/` (prompts and outputs) is wiped at the start of each run to prevent stale artifacts. After the run completes, files are retained for debugging and external tooling. The directory is gitignored.

### Incremental run tracking

A git hash at `.prosecheck/last-user-run` enables incremental runs. Default behavior differs by environment:

- **Interactive**: writes the hash after each run (so CI can use it), does not read it (always checks full branch diff)
- **CI**: reads the hash (skips already-checked work), does not write it (avoids polluting the repo)

Both behaviors are independently togglable via config or CLI flags.

### Output formats

Three formats, selectable via `--format`:

- **stylish** (default) — human-readable terminal output with colors
- **json** — structured JSON for scripting and machine consumption
- **sarif** — SARIF schema for GitHub Code Scanning inline PR annotations

## Consequences

- **Familiar to users of existing tools.** The layering model, exit codes, and ignore behavior all follow established conventions. No surprises.
- **Gitignore integration is automatic.** Projects don't need to duplicate their ignore patterns in prosecheck config.
- **Debugging is easy.** Retained prompt and output files let users inspect exactly what happened. The working directory is ephemeral by convention (gitignored, wiped on run) but visible by default.
- **Incremental runs are safe by default.** Interactive mode always checks the full diff (no missed violations), while CI mode can skip already-checked commits for efficiency.
