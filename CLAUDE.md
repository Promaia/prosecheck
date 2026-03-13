# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project

Prosecheck is an LLM-powered code linter with natural-language rules. See `docs/plans/prosecheck.md` for the full design plan, `docs/plans/project-foundation.md` for tooling decisions, and `docs/adr/` for architectural decision records.

## Commands

- `npm run build` — build with tsup
- `npm run typecheck` — type-check with tsc
- `npm run lint` — lint with eslint
- `npm run format:check` — check formatting with prettier
- `npm run test` — run tests with vitest
- `npm run ci` — full CI pipeline (typecheck + lint + format:check + test + build)
- `npm run prosecheck:self` — check against RULES.md files

## Keeping docs in sync

After making changes to the codebase, you MUST:

1. **Update architecture docs** — When you implement a stub, add a new module, change the data flow, or modify the component structure, identify the correct doc in `docs/architecture/` and update it. `docs/architecture/ARCHITECTURE.md` is the high-level overview of the whole project; complex systems may have their own files. Change `[STUB]` to `[IMPLEMENTED]` when a module has real code. Change `[PLANNED]` to `[STUB]` when a file is created. Remove status markers entirely when a section is fully implemented and tested. After updating a subsystem doc, check if the high-level `ARCHITECTURE.md` also needs updating.

2. **Update roadmap** — When you complete a task, check the box (`- [x]`) in the appropriate file under `docs/roadmap/`. When you discover new tasks during implementation, add them to the appropriate roadmap file. When all tasks in a file are complete, move it to `docs/roadmap/archive/` with a date prefix.

3. **Check roadmap before starting work** — Before implementing anything, read the active files in `docs/roadmap/` to understand current priorities and what has been completed. See `docs/roadmap/README.md` for the structure.

## Verification

After completing each milestone (or any significant set of changes), run `npm run ci` and `npm run prosecheck:self` to verify everything passes. This runs typecheck, lint, test, format:check, and build in sequence. Do not move to the next milestone until CI passes cleanly. Read `.prosecheck/output.log` for prosecheck output. If CI fails, fix the issue before proceeding. If formatting fails, even for files you didn't modify, run the formatter. Iterate until CI passes.

`.prosecheck/last-user-run` should be committed — it tracks the last-run hash so CI can verify someone ran prosecheck locally. After prosecheck passes, commit the updated hash file alongside your changes.

## Self-review

After completing implementation work, consult `docs/self-review.md` for the self-review checklist — criteria and severity levels for evaluating changes before presenting findings.

## Known issues

`docs/issues.md` tracks known bugs and architectural concerns. Fixed issues should be removed from the file.

## Code style

- TypeScript strict mode with ESM-only (`"type": "module"`)
- Use `process.exitCode` instead of `process.exit()`
- Follow existing patterns in the codebase
- Do not add `// eslint-disable` comments — fix the underlying issue instead
