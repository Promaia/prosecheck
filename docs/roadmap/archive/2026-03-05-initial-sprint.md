# Initial Sprint (Milestones 1–19)

Completed 2026-03-05. This archive covers the full initial implementation of prosecheck from stubs to a working tool with rule groups, concurrency control, and comprehensive test coverage.

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
- [x] Implement `src/modes/claude-code.ts` — Build execution plan via `buildExecutionPlan()`, execute batches sequentially with invocations in parallel, support `claudeToRuleShape` config for dispatch strategy
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

- [x] Add `tests/git/change-detection.test.ts` — Real git repo fixture helper: `createTestRepo()` that inits a repo, commits files, creates branches, returns `{ dir, cleanup }`
- [x] Test `detectChanges()` against real repo — create branch with changes, verify correct changed files returned, verify merge-base computation
- [x] Test incremental run tracking with real repo — write last-run hash, make more commits, verify only new changes detected
- [x] Test shallow clone behavior — `git clone --depth=1` fixture, verify graceful fallback when merge-base unavailable
- [x] Test global ignore filtering with real repo — add ignored files to git, verify they are excluded from results
- [x] Test file-to-rule scope matching with real directory structure — nested RULES.md files, verify correct inclusion matching
- [x] Ensure all tests use cross-platform path handling (forward slashes in assertions, `path.join` for filesystem ops)
- [x] Verify `npm run ci` passes on both Linux and Windows

---

## Milestone 16: Claude CLI Shim & Pipeline Integration Tests

Fake Claude binary that simulates agent behavior, enabling full pipeline tests without API calls.

- [x] Create `tests/fixtures/fake-claude.mjs` — Node script that parses `-p` prompt arg, extracts output path from prompt, writes canned JSON result to that path. Support `--print` flag. Exit 0 on success
- [x] Add configurable behaviors to fake-claude — env var or flag to control: pass/warn/fail status, malformed JSON output, timeout (hang), partial output, multiple output files (for single-instance mode)
- [x] Write integration test: full pipeline with fake-claude in multi-instance mode — real git repo, real RULES.md, fake claude binary, verify formatted output and exit code
- [x] Write integration test: full pipeline with fake-claude in single-instance mode — verify orchestration prompt generation, agent-teams env var, result collection
- [x] Write integration test: dropped rule retry — fake-claude fails to write output on first call, succeeds on retry, verify retry loop works end-to-end
- [x] Write integration test: post-run tasks receive correct env vars after pipeline completes with fake-claude
- [x] Verify `npm run ci` passes

---

## Milestone 17: Result Parser Robustness & Contract Tests

Harden result parsing against common LLM output quirks and validate against golden files from real Claude outputs.

- [x] Fuzz `collectResults()` with malformed inputs — trailing commas, BOM characters, markdown-wrapped JSON (`` ```json ... ``` ``), extra fields, truncated JSON, empty files, non-JSON text
- [x] Fuzz with LLM-typical mistakes — comments in JSON, single-quoted strings, unquoted keys, trailing text after valid JSON, multiple JSON objects concatenated
- [x] Test Zod validation error messages — verify actionable error details for each malformed variant (users need to debug agent output)
- [x] Add `tests/fixtures/golden-outputs/` directory — curated set of real Claude outputs (pass, warn, fail, edge cases) as golden files
- [x] Write golden file contract tests — parse each golden file against `RuleResultSchema`, assert expected status and structure
- [x] Add prompt template regression test — when prompt template changes, verify golden outputs still parse correctly (catch prompt/schema drift)
- [x] Document golden file update process — instructions for re-recording golden files when prompt templates change
- [x] Verify `npm run ci` passes

---

## Milestone 18: Slow E2E Tests with Real Claude (Optional, CI-Gated)

Real Claude CLI integration for prompt template regression testing. Gated behind `PROSECHECK_SLOW_TESTS=1` env var.

- [x] Add `tests/slow/` directory with vitest config that only runs when `PROSECHECK_SLOW_TESTS=1` is set
- [x] Write test: single simple rule (e.g., "no TODO comments") against a fixture project with known violations — verify output file exists, parses against schema, status is `fail`
- [x] Write test: single passing rule against clean fixture — verify `pass` status
- [x] Write test: multiple rules in multi-instance mode — verify all output files written and valid
- [x] Write test: single-instance mode with agent-teams — verify orchestration works end-to-end
- [x] Add npm script `npm run test:slow` for manual invocation
- [x] Document slow test setup (required: `claude` CLI installed and authenticated)
- [ ] Verify slow tests pass locally before merging prompt template changes

---

## Milestone 19: Rule Groups & Concurrency Control

Group multiple rules under a single agent and limit parallel execution for large repos.

Rule groups allow multiple rules to run under one agent invocation. The agent evaluates all rules in the group sequentially, reducing total parallel agent runs for repos with many rules. A `maxConcurrentAgents` config caps how many rule/group slots execute at once, splitting the work into sequential batches of parallel runs: `[sequential by maxConcurrentAgents: [grouped by ruleGroup: [rule]]]`.

This milestone also introduces frontmatter parsing for both RULES.md and ADR markdown files. For now, only `group` is implemented; the parser should be designed to accept and preserve arbitrary frontmatter fields (e.g. `severity`, `scope`, `exclude`) so future milestones can consume them without changing the parser.

### Frontmatter parsing

- [x] Add YAML frontmatter parser (`src/lib/frontmatter.ts`) — extract frontmatter from markdown files, return typed metadata object (with `group` as the only actively-used field) + remaining body. Preserve unknown fields as passthrough for future use. Handle files with and without frontmatter gracefully
- [x] Extend `rules-md` calculator to parse frontmatter — consume `group` field. File-level frontmatter applies to all rules in that file. Unknown fields are stored on the `Rule` object for future consumers
- [x] Extend `adr` calculator to parse frontmatter — consume `group` field. Unknown fields stored on `Rule` for future use
- [x] Add `ruleGroup` field to `Rule` type — optional string identifying which group a rule belongs to
- [x] Add optional `frontmatter` bag to `Rule` type — `Record<string, unknown>` for preserving unrecognized frontmatter fields

### Unified execution pipeline

Refactor `claude-code.ts` to plan claude invocations, then execute them. The execution shape is:

```
[claude invocations in sequence [claude invocations in parallel [rules]]]
```

Each claude invocation is one of three types:

| Invocation type | Rules per process | Processing style | Prompt builder |
|---|---|---|---|
| **one-to-one** | 1 | Single rule via stdin | Per-rule prompt file |
| **one-to-many-teams** | N | Parallel sub-agents | `buildAgentTeamsPrompt` |
| **one-to-many-single** | N | Sequential in one agent | `buildSequentialPrompt` |

#### How rules map to invocations

The user chooses a `claudeToRuleShape` (`"one-to-one"` \| `"one-to-many-teams"` \| `"one-to-many-single"`) which controls how **ungrouped rules** are dispatched. **Grouped rules always become separate `one-to-many-single` invocations** regardless of this setting (one process per group, sequential prompt).

Ungrouped rule baseline (before adding groups):

| `claudeToRuleShape` | Invocation plan |
|---|---|
| `one-to-one` | Each rule → its own invocation. Split into sequential batches of `maxConcurrentAgents` parallel invocations. |
| `one-to-many-teams` | Pack rules into invocations of up to `maxConcurrentAgents` rules each. Each invocation uses agent-teams to process its rules as parallel sub-agents. |
| `one-to-many-single` | All ungrouped rules → one invocation, processed sequentially. |

Then group invocations are inserted using the same no-split logic as `one-to-one` (see below).

#### `maxConcurrentAgents` and batch insertion

Controls the number of concurrent agents (processes or sub-agents depending on invocation type). 0 = unlimited. The plan builder fills batches using these insertion rules:

- **`one-to-one`**: Each rule is one agent. Add to the current parallel batch until it reaches `maxConcurrentAgents`, then start a new sequential batch. No splitting.
- **`one-to-many-teams`**: Each invocation has N sub-agents, each counting as one agent. If `currentBatchSize + teamSize ≤ maxConcurrentAgents`, insert the whole team invocation. Otherwise, split: create one team of `maxConcurrentAgents - currentBatchSize` rules to fill the current batch, and put the remaining rules back into the queue to be processed later (they may need to be split again if they still exceed a fresh batch).
- **`one-to-many-single`**: One agent regardless of rule count. Add to the current parallel batch until it reaches `maxConcurrentAgents`, then start a new sequential batch. No splitting (same as `one-to-one`).
- **Groups**: One agent each. Inserted with the same no-split logic as `one-to-one` — add to the first batch with space, or start a new batch.

#### Implementation

- [x] Define execution plan types — `Invocation` (type + rules), `ExecutionPlan` (sequence of parallel batches of invocations)
- [x] Add `buildExecutionPlan()` — takes rules, `claudeToRuleShape`, `maxConcurrentAgents`, and rule groups; returns an `ExecutionPlan`
- [x] Refactor `runClaudeCode()` to execute an `ExecutionPlan` — iterate batches sequentially, run invocations within each batch in parallel, collect results
- [x] Reuse `buildSequentialPrompt` for `one-to-many-single` invocations and group invocations
- [x] Reuse `buildAgentTeamsPrompt` for `one-to-many-teams` invocations

### Config & CLI

- [x] Add `claudeToRuleShape` to `ConfigSchema` — `"one-to-one"` | `"one-to-many-teams"` | `"one-to-many-single"`, replaces current `singleInstance` + `agentTeams` booleans
- [x] Add `maxConcurrentAgents` to `ConfigSchema` — integer (0 = unlimited), controls concurrent agents per the rules above
- [x] Add `--claude-to-rule-shape` and `--max-concurrent-agents` CLI flags
- ~~Migration: map old `singleInstance`/`agentTeams` config to new `claudeToRuleShape` — dropped, no external users yet~~

### Tests

- [x] Write unit tests for frontmatter parsing (with/without frontmatter, unknown fields preserved, invalid YAML, `group` extraction)
- [x] Write unit tests for `buildExecutionPlan()` — all mode combinations produce correct hierarchy shapes
- [x] Write unit tests for unified pipeline execution (batch splitting, sequential ordering, result collection across groups)
- [x] Write integration test with fake-claude — grouped rules produce correct combined prompts and multiple outputs
- [x] Verify `npm run ci` passes
