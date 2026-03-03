# Project Foundation

Repository structure, tooling, and configuration for claude-linter.

---

## Repository Tree

```
claude-linter/
├── src/
│   ├── cli.ts                         # CLI entry: Commander arg parsing, mode detection, process.exit
│   ├── index.ts                       # Library entry: exports core API for programmatic use
│   │
│   ├── commands/
│   │   ├── lint.ts                    # Lint command — main flow for both CI and local modes
│   │   └── init.ts                    # `init` command — scaffolds .rules/ in a target project
│   │
│   ├── lib/
│   │   ├── engine.ts                  # Orchestrator: collects rules, generates prompts, dispatches mode, collects results
│   │   ├── config.ts                  # Config loading, layering (base → environment → CLI flags), validation
│   │   ├── prompt.ts                  # Per-rule prompt generation from template + variables
│   │   ├── results.ts                 # Result collection, dropped detection, retry orchestration
│   │   ├── post-run.ts                # Post-run task execution (shell commands, env vars)
│   │   ├── change-detection.ts        # Git diff, changed-file mapping, globalIgnore + additionalIgnore filtering
│   │   ├── ignore.ts                  # Gitignore-pattern matching (globalIgnore, additionalIgnore, inclusions)
│   │   ├── rule.ts                    # Rule type definition and helpers
│   │   └── calculators/
│   │       ├── index.ts               # Calculator registry and dispatch
│   │       ├── rules-md.ts            # rules-md calculator: discovers + parses RULES.md files
│   │       └── adr.ts                 # adr calculator: reads ADR files, derives rules
│   │
│   ├── modes/
│   │   ├── user-prompt.ts             # User Prompt mode: builds prompt, watches for output files
│   │   └── claude-code.ts             # Claude Code Headless mode: spawns claude CLI instances per rule
│   │
│   ├── formatters/
│   │   ├── stylish.ts                 # Human-readable terminal output (default)
│   │   ├── json.ts                    # Structured JSON output
│   │   └── sarif.ts                   # SARIF output for GitHub Code Scanning
│   │
│   ├── ui/
│   │   └── components/                # Ink React components for interactive local mode
│   │       ├── LintProgress.tsx       # Rule-by-rule progress display
│   │       └── Summary.tsx            # Final results summary
│   │
│   └── types/
│       └── index.ts                   # Shared type definitions
│
├── tests/
│   ├── unit/
│   │   ├── lib/
│   │   │   ├── config.test.ts
│   │   │   ├── prompt.test.ts
│   │   │   ├── results.test.ts
│   │   │   ├── change-detection.test.ts
│   │   │   ├── ignore.test.ts
│   │   │   └── calculators/
│   │   │       ├── rules-md.test.ts
│   │   │       └── adr.test.ts
│   │   ├── formatters/
│   │   │   ├── stylish.test.ts
│   │   │   ├── json.test.ts
│   │   │   └── sarif.test.ts
│   │   └── modes/
│   │       ├── user-prompt.test.ts
│   │       └── claude-code.test.ts
│   ├── integration/
│   │   ├── cli.test.ts                # Spawns dist/cli.js with execa, asserts exit codes + stdout
│   │   └── init.test.ts
│   └── fixtures/
│       ├── project-simple/            # Minimal project with one RULES.md
│       ├── project-nested/            # Nested RULES.md files at multiple depths
│       └── project-adr/              # Project with docs/adr/ for adr calculator tests
│
├── docs/
│   ├── plans/                         # Design plans (this file, claude-linter.md)
│   ├── adr/                           # Architecture Decision Records
│   └── research/                      # Immutable, date-tagged research documents
│
├── .github/
│   └── workflows/
│       └── ci.yml                     # CI pipeline: typecheck → lint → test → build
│
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── eslint.config.ts                   # ESLint flat config
├── .prettierrc
├── .gitignore
├── CLAUDE.md
└── README.md
```

---

## Language and Runtime

| Choice | Value |
|---|---|
| Language | TypeScript, strict mode |
| Runtime | Node.js >= 20 (current LTS) |
| Module system | ESM-only (`"type": "module"` in package.json) |
| Target | ES2022 (full Node 20 support, including top-level await) |

---

## Core Dependencies

| Dependency | Purpose | Rationale |
|---|---|---|
| `commander` | Argument parsing, subcommands | 240M weekly downloads, zero deps, 18-25ms startup, used by Claude Code and shadcn/ui |
| `ink` + `react` | Interactive terminal UI | React-based terminal renderer, used by Claude Code, Gemini CLI, Prisma, Wrangler |
| `@anthropic-ai/claude-code` | Claude Code CLI | Runtime dependency for Claude Code Headless mode; spawned as child processes (one per rule) via `claude --print` |
| `execa` | Process spawning | Launches and manages Claude Code CLI child processes in headless mode |
| `picocolors` | Terminal colors | 7KB, 2x faster than chalk, zero deps, NO_COLOR/FORCE_COLOR support |
| `yocto-spinner` | Spinners | 5KB, zero deps, by ora's author — Astro migrated from ora to this |
| `ignore` | Gitignore-pattern matching | De-facto standard for parsing gitignore patterns in Node.js |

---

## Dev Dependencies

| Dependency | Purpose | Rationale |
|---|---|---|
| `tsup` | Build | Wraps esbuild, subsecond builds, generates .d.ts, injects shebang |
| `typescript` | Type checking | `tsc --noEmit` for type checking, tsup handles emission |
| `vitest` | Testing | First-class ESM, native TS transforms, `toMatchFileSnapshot`, github-actions reporter |
| `msw` | API mocking | Network-level mocking for future direct API modes; useful for integration tests |
| `eslint` | Linting | With `typescript-eslint` strictTypeChecked preset |
| `@eslint-community/eslint-plugin-eslint-comments` | Meta-linting | `no-unlimited-disable` prevents AI agents from blanket-disabling rules |
| `prettier` | Formatting | Consistent formatting, no debates |
| `@commander-js/extra-typings` | CLI type inference | Full type inference for parsed Commander options |
| `ink-testing-library` | UI testing | Component-level testing for Ink components |

---

## TypeScript Configuration

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Key strictness choices:
- `noUncheckedIndexedAccess` — forces handling undefined on array/object index access
- `exactOptionalPropertyTypes` — distinguishes undefined from missing properties
- `noPropertyAccessFromIndexSignature` — requires bracket notation for index signatures
- `jsx: "react-jsx"` — for Ink components

---

## Build Configuration

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  sourcemap: true,
  dts: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['@anthropic-ai/claude-code'],
});
```

Two entry points:
- `src/cli.ts` — the CLI binary (gets shebang via `banner`)
- `src/index.ts` — library entry for programmatic use

---

## package.json Shape

```jsonc
{
  "name": "claude-linter",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "claude-linter": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "ci": "npm run typecheck && npm run lint && npm run test && npm run build"
  }
}
```

---

## Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    reporters: process.env.CI ? ['github-actions', 'default'] : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/ui/**'],
    },
  },
});
```

### Test structure

| Layer | Location | What it covers |
|---|---|---|
| Unit | `tests/unit/` | Config loading, ignore matching, calculators, formatters — all isolated |
| Integration | `tests/integration/` | Spawn CLI binary with `execa`, assert exit codes + stdout/stderr |
| Fixtures | `tests/fixtures/` | Fake projects with known RULES.md / ADR files for deterministic tests |

Claude Code Headless mode tests mock `execa` to avoid spawning real CLI instances. User Prompt mode tests verify prompt generation and output file collection. Filesystem-heavy tests (config loading, calculator discovery) use real fixture directories rather than mocks.

---

## ESLint Configuration

```typescript
// eslint.config.ts — flat config
import tseslint from 'typescript-eslint';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  eslintComments.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
    },
  },
  {
    ignores: ['dist/', 'tests/fixtures/'],
  },
);
```

Three tiers of protection:
1. `strictTypeChecked` — catches `any`, unsafe operations, floating promises
2. Additional rules — `consistent-type-imports`, `no-unnecessary-type-assertion`
3. Meta-protection — `no-unlimited-disable` prevents blanket `// eslint-disable`

---

## CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run format:check
      - run: npm run test
      - run: npm run build
```

Stages run sequentially: **typecheck → lint → format check → test → build**. Fast failures first (typecheck is cheapest), build last (only matters if everything else passes).

---

## Exit Codes

Following the ESLint convention:

| Code | Meaning |
|---|---|
| `0` | Success — all rules passed |
| `1` | Lint errors found — one or more rules failed |
| `2` | Tool/configuration error — bad config, missing files, API failures |

Use `process.exitCode = n` instead of `process.exit(n)` for graceful cleanup.

---

## Environment and Mode Resolution

```typescript
// Environment: controls config layering
// Resolved from: --env flag > process.env.CI auto-detect > "local" default
export function resolveEnvironment(cliEnv?: string): string {
  if (cliEnv) return cliEnv;
  if (process.env.CI) return 'ci';
  return 'local';
}

// Display: controls output presentation (orthogonal to environment)
export const isTTY = !!process.stdout.isTTY;
export const isInteractive = isTTY && resolveEnvironment() !== 'ci';
```

**Environments** (`--env <name>`, default `local`):
- `local` — developer workstation defaults
- `ci` — auto-detected via `process.env.CI`, or passed explicitly
- Custom — any name defined in `config.environments`, e.g. `--env nightly`

**Operating modes** (`--mode <name>`):
- `user-prompt` — generates prompt for user to paste into Claude Code
- `claude-code` — spawns Claude Code CLI instances headlessly (one per rule)
- `claude-agents` — (planned) uses Claude Agents SDK in-process
- `internal-loop` — (planned) direct API calls with custom agent loop

---

## Output Formats

Selectable via `--format` flag:

| Format | Flag | Use case |
|---|---|---|
| Stylish | `--format stylish` (default) | Human-readable terminal output with colors |
| JSON | `--format json` | Machine consumption, scripting |
| SARIF | `--format sarif` | GitHub Code Scanning integration — inline PR annotations |
