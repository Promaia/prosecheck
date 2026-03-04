# Roadmap

Implementation status for prosecheck. All source files currently exist as stubs (placeholder comments only). This roadmap tracks the work needed to reach a functional tool.

Items are grouped by milestone. Within each milestone, items are roughly ordered by dependency (implement earlier items first). Check the box when implementation is complete and tests pass.

**Verification:** Every milestone ends with a `npm run ci` gate (typecheck + lint + test + build). Do not move to the next milestone until CI passes cleanly.

---

## Milestone 1: Core Types & Configuration

Foundation types and config loading — everything else depends on these.

- [x] Define Zod config schema in `src/lib/config-schema.ts` — `ConfigSchema` with `.describe()` on every field and `.default()` for all defaults. Sub-schemas: `LastRunSchema`, `ClaudeCodeSchema`, `CalculatorConfigSchema`, `EnvironmentOverrideSchema`. `Config` type via `z.infer`. `PartialConfig` as TypeScript mapped type (Zod v4 has no `.deepPartial()`). `RuleResultSchema` as discriminated union for agent output validation
- [x] Define remaining shared types in `src/types/index.ts` — Rule, RuleStatus, PromptVariables, RunContext (Config type re-exported from Zod schema)
- [x] Implement `src/lib/rule.ts` — Rule type helpers, stable ID slug generation from rule name + source path
- [x] Implement `src/lib/config.ts` — 4-layer config loading: config.json → config.local.json → environment overrides → CLI flags. Zod validation on base and final merged config. `ConfigError` with structured issue details
- [x] Implement `src/lib/ignore.ts` — Combine `globalIgnore` inline patterns with `additionalIgnore` file patterns via `ignore` package, inclusion filter, `filterFiles` utility
- [x] Write unit tests for Zod schema (15 tests: defaults, validation, descriptions, RuleResult variants)
- [x] Write unit tests for config loading (20 tests: layering, deep merge, missing files, Zod errors, environment resolution)
- [x] Write unit tests for ignore pattern matching (10 tests: globalIgnore, additionalIgnore, inclusions, filterFiles)
- [x] Verify `npm run ci` passes

---

## Milestone 2: Rule Discovery

Rule calculators that find and parse rules from project files.

- [x] Implement `src/lib/calculators/index.ts` — Calculator registry with built-in `rules-md` and `adr` calculators, dispatch by name, respect `enabled` flag, default to `rules-md` when no calculators configured
- [x] Implement `src/lib/calculators/rules-md.ts` — Recursive RULES.md discovery via `glob`, parse `#` headings as rule names, content between headings as descriptions (subheadings included), directory as inclusion scope
- [x] Implement `src/lib/calculators/adr.ts` — Read ADR markdown files from configured path, skip ADRs without `## Rules` heading, extract rule description from `## Rules` section, ADR title as rule name, project-wide inclusions
- [x] Write unit tests for rules-md calculator (11 tests: parsing, multi-rule files, subheadings, preamble, inclusions, fixtures)
- [x] Write unit tests for adr calculator (11 tests: `## Rules` extraction, skip without heading, multi-line content, missing directory, fixtures)
- [x] Write unit tests for calculator registry (5 tests: default dispatch, named dispatch, disabled calculators, combined results, unknown names)
- [x] Verify `npm run ci` passes

---

## Milestone 3: Change Detection

Git integration for determining which rules to run.

- [x] Implement `src/lib/change-detection.ts` — Run `git diff --name-only` against comparison ref, compute merge-base, map changed files to parent directories, match against rule inclusions with ignore filtering
- [x] Implement incremental run tracking — Read/write `.prosecheck/last-user-run`, respect environment-specific `lastRun.read`/`lastRun.write` defaults
- [x] Write unit tests for change detection (20 tests: mock git commands, test file-to-rule matching, test incremental tracking, last-run read/write, global ignore filtering)
- [x] Verify `npm run ci` passes

---

## Milestone 4: Prompt Generation

Build the per-rule prompt files that agents consume.

- [x] Implement `src/lib/prompt.ts` — Load default template, load custom template from `.prosecheck/prompt-template.md` if present, load global system prompt from `.prosecheck/prompt.md` if present, interpolate variables (rule text, comparison ref, changed files, scope, output path), write to `.prosecheck/working/prompts/<rule-id>.md`
- [x] Write unit tests for prompt generation (template interpolation, custom templates, system prompt prepending)
- [x] Verify `npm run ci` passes

---

## Milestone 5: Result Collection & Post-Run

Collect agent outputs and handle edge cases.

- [x] Implement `src/lib/results.ts` — Read output JSON files from `.prosecheck/working/outputs/`, validate each against `RuleResultSchema` (Zod) with actionable error messages for malformed agent output, detect dropped rules (missing output files), orchestrate retries when `retryDropped` enabled, compute overall run status from worst individual status
- [x] Implement `src/lib/post-run.ts` — Execute shell commands from `config.postRun`, inject `PROSECHECK_STATUS`, `PROSECHECK_RESULTS_DIR`, `PROSECHECK_RESULTS_JSON` environment variables
- [x] Write unit tests for result collection (all statuses, dropped detection, retry logic, overall status computation)
- [x] Write unit tests for post-run task execution
- [x] Verify `npm run ci` passes

---

## Milestone 6: Output Formatters

Transform results into human-readable and machine-readable formats.

- [x] Implement `src/formatters/stylish.ts` — Colored terminal output with rule names, statuses, headlines, per-comment file/line details
- [x] Implement `src/formatters/json.ts` — Structured JSON output of all results
- [x] Implement `src/formatters/sarif.ts` — SARIF schema output for GitHub Code Scanning inline PR annotations
- [x] Write unit tests for all three formatters (snapshot tests recommended)
- [x] Verify `npm run ci` passes

---

## Milestone 7: Operating Modes

The execution backends that launch agents.

- [x] Implement `src/modes/user-prompt.ts` — Build orchestration prompt listing all prompt file paths, display to user, watch `.prosecheck/working/outputs/` for result files, support user-signal completion in interactive environments
- [x] Implement `src/modes/claude-code.ts` — Spawn `claude --print` processes via execFile (one per rule, parallel), feed prompt file content to each instance, collect outputs, support `claudeCode.singleInstance` config for agent-team strategy
- [x] Write unit tests for user-prompt mode (prompt generation, file watching)
- [x] Write unit tests for claude-code mode (mock spawnClaude, process management, single-instance toggle)
- [x] Verify `npm run ci` passes

---

## Milestone 8: Engine Orchestration

Wire everything together into the main lint pipeline.

- [x] Implement `src/lib/engine.ts` — Full pipeline: cleanup working dir → run calculators → change detection → filter rules → generate prompts → dispatch to mode → collect results → format → post-run → set exit code
- [x] Implement `src/commands/lint.ts` — Parse lint-specific CLI flags, construct RunContext, invoke engine, handle errors with exit code 2
- [x] Write unit tests for engine (mock all subsystems, test pipeline ordering, test error handling)
- [x] Verify `npm run ci` passes

---

## Milestone 9: CLI & Init Command

Top-level CLI wiring and project scaffolding.

- [x] Implement `src/cli.ts` — Commander program definition, register lint and init subcommands, global flags (`--env`, `--mode`, `--format`, `--timeout`, `--warn-as-error`, `--last-run-read`, `--last-run-write`, `--retry-dropped`), environment resolution, `process.exitCode` handling
- [x] Implement `src/commands/init.ts` — Create `.prosecheck/` directory, write default `config.json`, add `.prosecheck/working/`, `.prosecheck/config.local.json`, `.prosecheck/last-user-run` to `.gitignore`, optionally create starter `RULES.md`
- [x] Write integration tests for CLI (`tests/integration/cli.test.ts`) — Spawn `dist/cli.js` with execa, assert exit codes and stdout/stderr for various scenarios
- [x] Write integration tests for init command (`tests/integration/init.test.ts`) — Verify scaffolded files and gitignore entries
- [x] Verify `npm run ci` passes

---

## Milestone 10: Terminal UI

Interactive display for real-time progress.

- [x] Implement `src/ui/components/LintProgress.tsx` — Ink/React component showing live table of rule names, run statuses (waiting/running/done), and results as agents complete
- [x] Implement `src/ui/components/Summary.tsx` — Final results summary component with pass/warn/fail/dropped counts and overall status
- [x] Write component tests using ink-testing-library
- [x] Verify `npm run ci` passes

---

## Milestone 11: Library API

Public programmatic interface for use as a dependency.

- [x] Implement `src/index.ts` — Export core types (Rule, RuleResult, Config), engine function, and formatter utilities for programmatic consumption
- [x] Verify `npm run ci` passes

---

## Milestone 12: End-to-End Validation

Full integration testing against real scenarios.

- [x] End-to-end test: user-prompt mode with fixture project — verify prompt files generated, simulate agent output, verify formatted results
- [x] End-to-end test: claude-code mode with fixture project (mocked execa) — verify full pipeline from CLI invocation to exit code
- [x] End-to-end test: init command creates working project scaffold
- [x] End-to-end test: incremental run tracking across multiple invocations
- [x] End-to-end test: SARIF output validates against SARIF schema
- [x] Verify CI pipeline passes (`npm run ci`) — typecheck, lint, format, test, build

---

## Milestone 13: Interactive Lint UI

Wire the LintProgress and Summary components into the lint pipeline for real-time interactive display.

- [x] Add `src/ui/LintApp.tsx` — Top-level Ink app component that composes `LintProgress` and `Summary`, manages `RuleProgressEntry[]` state, and exposes callbacks for status updates
- [x] Add `src/ui/render.ts` — Ink `render()` wrapper that creates/destroys the interactive UI. Exports `startInteractiveUI()` returning an updater interface and `stopInteractiveUI()` for cleanup
- [x] Add progress callback to engine — Extend `RunContext` or engine options with an optional `onProgress` callback. Engine calls it at key points: rules discovered (all `waiting`), mode dispatch started (set `running`), output file detected (set `done` with result)
- [x] Wire into lint command — When format is `stylish` and stdout is a TTY, use interactive Ink rendering instead of plain text. Fall back to current behavior for CI, piped output, or non-stylish formats
- [x] Add output file watcher to engine — During mode dispatch, watch `.prosecheck/working/outputs/` for new files, parse each as it arrives, and fire `onProgress` with the result
- [x] Write tests for LintApp state management (ink-testing-library — verify state transitions from waiting → running → done)
- [x] Write tests for render.ts (verify TTY detection, fallback to non-interactive)
- [x] Verify `npm run ci` passes

---

## Milestone 14: Config List & Set

Non-interactive `prosecheck config` command for viewing and modifying configuration via CLI flags.

- [x] Add `src/commands/config.ts` — Implement config command with `list` and `set` subcommands
- [x] Implement `config list` — Load current config, display all fields with current values vs defaults, grouped by section. Mark non-default values. Show field descriptions from Zod `.describe()`
- [x] Implement `config set key=value` — Parse dot-path keys (e.g., `lastRun.read`), coerce string values to correct types (boolean, number, string, string[]), validate against `ConfigSchema`, write minimal diff to `.prosecheck/config.json`
- [x] Register `config` command in CLI (`src/cli.ts`)
- [x] Write unit tests for config list and config set (value coercion, dot-path resolution, validation errors, minimal write)
- [x] Verify `npm run ci` passes

---

## Milestone 15: Cross-Platform & Git Integration Tests

Real git repos in temp directories to catch platform-specific behavior (path separators, shallow clones, merge-base edge cases) without mocking.

- [ ] Add `tests/git/change-detection.test.ts` — Real git repo fixture helper: `createTestRepo()` that inits a repo, commits files, creates branches, returns `{ dir, cleanup }`
- [ ] Test `detectChanges()` against real repo — create branch with changes, verify correct changed files returned, verify merge-base computation
- [ ] Test incremental run tracking with real repo — write last-run hash, make more commits, verify only new changes detected
- [ ] Test shallow clone behavior — `git clone --depth=1` fixture, verify graceful fallback when merge-base unavailable
- [ ] Test global ignore filtering with real repo — add ignored files to git, verify they are excluded from results
- [ ] Test file-to-rule scope matching with real directory structure — nested RULES.md files, verify correct inclusion matching
- [ ] Ensure all tests use cross-platform path handling (forward slashes in assertions, `path.join` for filesystem ops)
- [ ] Verify `npm run ci` passes on both Linux and Windows

---

## Milestone 16: Claude CLI Shim & Pipeline Integration Tests

Fake Claude binary that simulates agent behavior, enabling full pipeline tests without API calls.

- [ ] Create `tests/fixtures/fake-claude.mjs` — Node script that parses `-p` prompt arg, extracts output path from prompt, writes canned JSON result to that path. Support `--print` flag. Exit 0 on success
- [ ] Add configurable behaviors to fake-claude — env var or flag to control: pass/warn/fail status, malformed JSON output, timeout (hang), partial output, multiple output files (for single-instance mode)
- [ ] Write integration test: full pipeline with fake-claude in multi-instance mode — real git repo, real RULES.md, fake claude binary, verify formatted output and exit code
- [ ] Write integration test: full pipeline with fake-claude in single-instance mode — verify orchestration prompt generation, agent-teams env var, result collection
- [ ] Write integration test: dropped rule retry — fake-claude fails to write output on first call, succeeds on retry, verify retry loop works end-to-end
- [ ] Write integration test: post-run tasks receive correct env vars after pipeline completes with fake-claude
- [ ] Verify `npm run ci` passes

---

## Milestone 17: Result Parser Robustness & Contract Tests

Harden result parsing against common LLM output quirks and validate against golden files from real Claude outputs.

- [ ] Fuzz `collectResults()` with malformed inputs — trailing commas, BOM characters, markdown-wrapped JSON (`` ```json ... ``` ``), extra fields, truncated JSON, empty files, non-JSON text
- [ ] Fuzz with LLM-typical mistakes — comments in JSON, single-quoted strings, unquoted keys, trailing text after valid JSON, multiple JSON objects concatenated
- [ ] Test Zod validation error messages — verify actionable error details for each malformed variant (users need to debug agent output)
- [ ] Add `tests/fixtures/golden-outputs/` directory — curated set of real Claude outputs (pass, warn, fail, edge cases) as golden files
- [ ] Write golden file contract tests — parse each golden file against `RuleResultSchema`, assert expected status and structure
- [ ] Add prompt template regression test — when prompt template changes, verify golden outputs still parse correctly (catch prompt/schema drift)
- [ ] Document golden file update process — instructions for re-recording golden files when prompt templates change
- [ ] Verify `npm run ci` passes

---

## Milestone 18: Slow E2E Tests with Real Claude (Optional, CI-Gated)

Real Claude CLI integration for prompt template regression testing. Gated behind `PROSECHECK_SLOW_TESTS=1` env var.

- [ ] Add `tests/slow/` directory with vitest config that only runs when `PROSECHECK_SLOW_TESTS=1` is set
- [ ] Write test: single simple rule (e.g., "no TODO comments") against a fixture project with known violations — verify output file exists, parses against schema, status is `fail`
- [ ] Write test: single passing rule against clean fixture — verify `pass` status
- [ ] Write test: multiple rules in multi-instance mode — verify all output files written and valid
- [ ] Write test: single-instance mode with agent-teams — verify orchestration works end-to-end
- [ ] Add npm script `npm run test:slow` for manual invocation
- [ ] Document slow test setup (required: `claude` CLI installed and authenticated)
- [ ] Verify slow tests pass locally before merging prompt template changes

---

## Milestone 19: npm Publishing

Prepare and publish prosecheck to the npm registry.

- [ ] Add LICENSE file (choose license)
- [ ] Polish README with usage examples, badges, and screenshots
- [ ] Add `prepublishOnly` script that runs `npm run ci`
- [ ] Configure `files` field in `package.json` to publish only `dist/`, `README.md`, `LICENSE`
- [ ] Set up semantic versioning and initial `0.1.0` release
- [ ] Publish to npm (`npm publish`)
- [ ] Verify `npx prosecheck init` and `npx prosecheck lint` work from a clean install

---

## Milestone 20: Integration Setup via `init`

Make `prosecheck init` re-runnable with flags to set up CI and local hooks. Running `init` again in an already-initialized project applies the requested integrations without overwriting existing config.

- [ ] Make `init` re-runnable — skip config/directory creation if already initialized, but still process integration flags
- [ ] Add `.prosecheck/working` to `.gitignore` during init if `.gitignore` exists but the entry is missing (idempotent — safe to run multiple times)
- [ ] `prosecheck init --github-actions` — Generate `.github/workflows/prosecheck.yml` with configurable options (format, environment, rules path) and optional SARIF upload step
- [ ] `prosecheck init --git-pre-push` — Install a `.git/hooks/pre-push` script (or append to existing) that runs `prosecheck lint`
- [ ] `prosecheck init --claude-stop-hook` — Add a `Stop` hook entry to `.claude/settings.json` that runs `prosecheck lint` after Claude finishes responding
- [ ] Support combining flags: `prosecheck init --github-actions --git-pre-push` applies both in a single invocation
- [ ] Write tests for each integration flag (verify generated files, idempotency, no clobbering)
- [ ] Verify `npm run ci` passes

---

## Milestone 21: GitHub Actions Action

A published GitHub Action (`Promaia/prosecheck-action`) for running prosecheck in CI with minimal config.

- [ ] Create action repository structure — `action.yml`, `dist/index.js` (bundled), `README.md`
- [ ] Define action inputs: `rules-path`, `format` (`stylish`|`sarif`|`json`), `environment`, `mode`, `warn-as-error`, `comparison-ref`, `timeout`, `upload-sarif` (boolean, default true when format is sarif)
- [ ] Implement action — install prosecheck, run lint with configured options, capture output
- [ ] When `upload-sarif` is true, automatically run `github/codeql-action/upload-sarif` as a post step (no user config needed)
- [ ] Expose `results-json` and `exit-code` as action outputs for downstream steps
- [ ] Write tests for action (mock GitHub context, verify SARIF upload integration)
- [ ] Publish to GitHub Marketplace
- [ ] Update `prosecheck init --github-actions` to reference the published action

---

## Milestone 22: Binary Distribution

Build standalone binaries so users can run prosecheck without Node.js installed.

- [ ] Evaluate bundlers — `pkg`, `bun build --compile`, or `node --experimental-sea-generate` (Node 20+ single executable apps)
- [ ] Add build script for Linux, macOS (arm64 + x64), and Windows targets
- [ ] Set up GitHub Actions release workflow — on git tag, build binaries for all targets and attach to GitHub Release
- [ ] Add install instructions to README (curl one-liner, GitHub Releases, Homebrew tap)
- [ ] Verify binary works end-to-end (init, lint, config commands)

---

## Future Milestones (Post-MVP)

These are designed in the plan but not targeted for the initial implementation.

### Interactive Configuration Editor
- [ ] Implement Zod schema walker — Recursively traverse `ConfigSchema` to extract field paths, types, descriptions (`.describe()`), defaults (`.default()`), and constraints (min/max, enums, array item types) into a flat field metadata list
- [ ] Implement config editor UI components (Ink/React) — Browsable field list with current value vs default, grouped by section (top-level keys). Support editing strings, numbers, booleans, string arrays, and nested objects. Validate input against the Zod schema in real-time
- [ ] Write unit tests for schema walker and config editor (ink-testing-library)
- [ ] Write integration test — Run interactive editor, modify a field, verify written JSON is valid

### Claude Agents SDK Mode
- [ ] Add `src/modes/claude-agents.ts` — In-process agent execution via `@anthropic-ai/claude-code-sdk`
- [ ] Register `claude-agents` mode in CLI
- [ ] Write tests for agents SDK mode

### Internal Loop Mode
- [ ] Add `src/modes/internal-loop.ts` — Direct Anthropic API calls with custom agent loop
- [ ] Register `internal-loop` mode in CLI
- [ ] Write tests for internal loop mode

### RULES.md Frontmatter
- [ ] Extend rules-md calculator to parse optional YAML frontmatter for per-rule metadata (severity, tags, custom scope overrides, exclusion patterns)

### ADR Frontmatter Scoping
- [ ] Extend adr calculator to parse YAML frontmatter in ADR files for targeted inclusion/exclusion patterns instead of project-wide scope

### Custom/External Rule Calculators
- [ ] Design and implement external calculator loading mechanism (dynamic import from configured paths or npm packages)

### Structured Post-Run Actions
- [ ] Extend post-run system beyond shell commands to support structured actions: `post-pr-comment`, `update-check-run`, Slack notifications, etc.

### Performance Optimization
- [ ] Rule batching — optionally combine multiple rules into a single agent call for cost reduction
- [ ] Large-scope caching — cache file listings for global-scope rules to avoid redundant filesystem traversal
