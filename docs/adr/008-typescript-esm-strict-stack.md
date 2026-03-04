# 8. TypeScript/ESM strict stack and dependency choices

## Status

Accepted

## Context

This ADR records the collection of framework and tooling decisions that define the project's technical foundation. Individually, each is a standard choice that doesn't warrant its own ADR. Together, they form the development environment contract that contributors need to understand.

## Decision

### Language and runtime

- **TypeScript in strict mode** with additional strictness flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`. These catch real bugs (unhandled undefined from array access, optional vs missing property confusion) at the cost of slightly more verbose code.
- **Node.js >= 20** (current LTS at time of decision). Enables ES2022 features including top-level await.
- **ESM-only** (`"type": "module"`). No CommonJS dual-publishing. ESM is the standard module system going forward and all our dependencies support it.

### Build and test

- **tsup** for building. Wraps esbuild for subsecond builds, generates `.d.ts` files, and injects the shebang for the CLI entry point. Chosen over raw esbuild (no .d.ts) and tsc (slow).
- **vitest** for testing. First-class ESM support, native TypeScript transforms, `toMatchFileSnapshot` for snapshot testing, and a `github-actions` reporter for CI annotations. Chosen over Jest (ESM support still experimental).
- **msw** for API mocking. Network-level mocking for future direct-API modes. Chosen for its interceptor approach over manual fetch mocking.

### CLI and UI

- **commander** for argument parsing. 240M weekly downloads, zero dependencies, 18–25ms startup overhead. Used by Claude Code and shadcn/ui. Chosen over yargs (heavier, CJS-oriented) and citty (newer, less ecosystem).
- **@commander-js/extra-typings** for full type inference on parsed options.
- **ink + react** for interactive terminal UI. React component model for terminal rendering. Used by Claude Code, Gemini CLI, Prisma, and Wrangler. Chosen over blessed (unmaintained) and raw ANSI escape codes (tedious).
- **ink-testing-library** for component-level UI tests.

### Utilities

- **picocolors** for terminal colors. 7KB, 2x faster than chalk, zero dependencies, respects NO_COLOR/FORCE_COLOR.
- **yocto-spinner** for progress spinners. 5KB, zero dependencies, by ora's author. Chosen over ora (larger).
- **ignore** for gitignore-pattern matching. De-facto standard in the Node.js ecosystem.
- **execa** for process spawning. Used to launch and manage Claude Code CLI child processes.

### Code quality

- **eslint** with `typescript-eslint` `strictTypeChecked` preset. Catches `any` types, unsafe operations, floating promises.
- **@eslint-community/eslint-plugin-eslint-comments** with `no-unlimited-disable`. Prevents AI agents from blanket-disabling lint rules.
- **prettier** for formatting. No configuration debates.

## Consequences

- **Consistent, strict codebase.** The strict TypeScript settings and ESLint preset catch bugs early and prevent quality erosion.
- **Fast feedback loop.** tsup builds in under a second, vitest runs tests with native TS transforms — no separate compile step.
- **Modern baseline.** ESM-only and Node 20 minimum means we use current standards without compatibility shims.
- **Meta-protection against AI agents.** The `no-unlimited-disable` rule specifically prevents AI coding agents from inserting `// eslint-disable` comments to bypass lint checks.
