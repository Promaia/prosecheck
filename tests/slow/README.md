# Slow E2E Tests (Real Claude)

These tests exercise the full prosecheck pipeline with the **real Claude CLI** — no mocks or fakes. They catch prompt template regressions: if the prompt format confuses Claude or schema instructions are unclear, these tests surface it.

## Prerequisites

- `claude` CLI installed and available on `PATH`
- Authenticated (`claude auth` or equivalent)

## How to run

```bash
# Run all slow tests
npm run test:slow

# Run a single test by name
npm run test:slow -- -t "single failing rule"

# Run with verbose output (see Claude's responses and formatted results)
npm run test:slow:verbose

# Combine: single test with verbose output
npm run test:slow:verbose -- -t "single passing rule"
```

The `vitest.config.slow.ts` config sets `PROSECHECK_SLOW_TESTS=1` automatically, so no manual env var setup is needed on any platform.

The tests use `describe.skipIf(!process.env.PROSECHECK_SLOW_TESTS)` so they are also skipped during normal `npm test` runs.

## When to run

- Before merging changes to prompt templates (`src/lib/prompt.ts`, `.prosecheck/prompt-template.md`)
- Before merging changes to result parsing (`src/lib/results.ts`, `src/lib/config-schema.ts`)
- Before releases

## Expected duration

1–3 minutes depending on Claude API latency. Each test has a 120-second timeout.
