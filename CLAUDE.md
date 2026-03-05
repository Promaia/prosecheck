# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project

Prosecheck is an LLM-powered code linter with natural-language rules. See `docs/plans/prosecheck.md` for the full design plan, `docs/plans/project-foundation.md` for tooling decisions, and `docs/adr/` for architectural decision records.

## Commands

- `npm run build` — build with tsup
- `npm run typecheck` — type-check with tsc
- `npm run lint` — lint with eslint
- `npm run test` — run tests with vitest
- `npm run ci` — full CI pipeline (typecheck + lint + test + build)

## Keeping docs in sync

After making changes to the codebase, you MUST:

1. **Update ARCHITECTURE.md** — When you implement a stub, add a new module, change the data flow, or modify the component structure, update `ARCHITECTURE.md` to reflect the current state. Change `[STUB]` to `[IMPLEMENTED]` when a module has real code. Change `[PLANNED]` to `[STUB]` when a file is created. Remove status markers entirely when a section is fully implemented and tested.

2. **Update ROADMAP.md** — When you complete a task, check the box (`- [x]`). When you discover new tasks during implementation, add them to the appropriate milestone. If a milestone is fully complete, note it at the top of the milestone section.

3. **Check ROADMAP.md before starting work** — Before implementing anything, read `ROADMAP.md` to understand current implementation status, what has been completed, and what the next priorities are. Follow the milestone ordering — earlier milestones should be completed before later ones.

## Verification

After completing each milestone (or any significant set of changes), run `npm run ci` to verify everything passes. This runs typecheck, lint, test, and build in sequence. Do not move to the next milestone until CI passes cleanly. If CI fails, fix the issue before proceeding. If formatting fails, even for files you didn't modify, run the formatter. Iterate until CI passes.

## Self-review

After completing implementation work, consult `docs/self-review.md` for the self-review checklist — criteria and severity levels for evaluating changes before presenting findings.

## Known issues

`docs/issues.md` tracks known bugs and architectural concerns. Fixed issues should be removed from the file.

## Code style

- TypeScript strict mode with ESM-only (`"type": "module"`)
- Use `process.exitCode` instead of `process.exit()`
- Follow existing patterns in the codebase
- Do not add `// eslint-disable` comments — fix the underlying issue instead
