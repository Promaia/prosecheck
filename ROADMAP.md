# Roadmap

Implementation status for prosecheck. All source files currently exist as stubs (placeholder comments only). This roadmap tracks the work needed to reach a functional tool.

Items are grouped by milestone. Within each milestone, items are roughly ordered by dependency (implement earlier items first). Check the box when implementation is complete and tests pass.

---

## Milestone 1: Core Types & Configuration

Foundation types and config loading — everything else depends on these.

- [ ] Define Zod config schema in `src/lib/config-schema.ts` — `ConfigSchema` with `.describe()` on every field and `.default()` for all defaults. Break into sub-schemas: `LastRunSchema`, `ClaudeCodeSchema`, `CalculatorConfigSchema`, `EnvironmentOverrideSchema`. Export `Config` type via `z.infer<typeof ConfigSchema>`. Define `PartialConfigSchema` via `.deepPartial()` for overlay layers. Define `RuleResultSchema` for agent output validation
- [ ] Define remaining shared types in `src/types/index.ts` — Rule, RuleStatus, PromptVariables, RunContext (Config type comes from Zod schema, not manually defined here)
- [ ] Implement `src/lib/rule.ts` — Rule type helpers, stable ID slug generation from rule name + source path
- [ ] Implement `src/lib/config.ts` — Load `config.json`, validate with `ConfigSchema.safeParse()`, deep-merge `config.local.json` (validated with `PartialConfigSchema`), apply environment overrides (validated with `PartialConfigSchema`), apply CLI flag overrides. Invalid config produces exit code 2 with Zod error paths
- [ ] Implement `src/lib/ignore.ts` — Combine `globalIgnore` inline patterns with patterns from `additionalIgnore` files, expose a file-matching predicate using the `ignore` package
- [ ] Write unit tests for Zod schema (defaults applied on empty input, validation errors for bad types, partial schema accepts subsets, `.describe()` present on all fields)
- [ ] Write unit tests for config loading (layering, deep merge, missing files, invalid JSON, Zod validation errors)
- [ ] Write unit tests for ignore pattern matching (globalIgnore, additionalIgnore, edge cases)

---

## Milestone 2: Rule Discovery

Rule calculators that find and parse rules from project files.

- [ ] Implement `src/lib/calculators/index.ts` — Calculator registry, dispatch by name, respect `enabled` flag
- [ ] Implement `src/lib/calculators/rules-md.ts` — Discover `RULES.md` files recursively, parse `#` headings as rule names, extract descriptions, set directory as inclusion scope
- [ ] Implement `src/lib/calculators/adr.ts` — Read ADR files from configured path, skip ADRs without a `## Rules` heading (documentation-only), extract rule description from `## Rules` section content, use ADR title as rule name, set project-wide inclusions
- [ ] Write unit tests for rules-md calculator using `tests/fixtures/project-simple/` and `tests/fixtures/project-nested/`
- [ ] Write unit tests for adr calculator using `tests/fixtures/project-adr/` — test ADRs with `## Rules` heading produce rules, ADRs without it are skipped, mixed directories work correctly
- [ ] Write unit tests for calculator registry (dispatch, disabled calculators, unknown names)

---

## Milestone 3: Change Detection

Git integration for determining which rules to run.

- [ ] Implement `src/lib/change-detection.ts` — Run `git diff --name-only` against comparison ref, compute merge-base, map changed files to parent directories, match against rule inclusions with ignore filtering
- [ ] Implement incremental run tracking — Read/write `.prosecheck/last-user-run`, respect environment-specific `lastRun.read`/`lastRun.write` defaults
- [ ] Write unit tests for change detection (mock git commands, test file-to-rule matching, test incremental tracking)

---

## Milestone 4: Prompt Generation

Build the per-rule prompt files that agents consume.

- [ ] Implement `src/lib/prompt.ts` — Load default template, load custom template from `.prosecheck/prompt-template.md` if present, load global system prompt from `.prosecheck/prompt.md` if present, interpolate variables (rule text, comparison ref, changed files, scope, output path), write to `.prosecheck/working/prompts/<rule-id>.md`
- [ ] Write unit tests for prompt generation (template interpolation, custom templates, system prompt prepending)

---

## Milestone 5: Result Collection & Post-Run

Collect agent outputs and handle edge cases.

- [ ] Implement `src/lib/results.ts` — Read output JSON files from `.prosecheck/working/outputs/`, validate each against `RuleResultSchema` (Zod) with actionable error messages for malformed agent output, detect dropped rules (missing output files), orchestrate retries when `retryDropped` enabled, compute overall run status from worst individual status
- [ ] Implement `src/lib/post-run.ts` — Execute shell commands from `config.postRun`, inject `PROSECHECK_STATUS`, `PROSECHECK_RESULTS_DIR`, `PROSECHECK_RESULTS_JSON` environment variables
- [ ] Write unit tests for result collection (all statuses, dropped detection, retry logic, overall status computation)
- [ ] Write unit tests for post-run task execution

---

## Milestone 6: Output Formatters

Transform results into human-readable and machine-readable formats.

- [ ] Implement `src/formatters/stylish.ts` — Colored terminal output with rule names, statuses, headlines, per-comment file/line details
- [ ] Implement `src/formatters/json.ts` — Structured JSON output of all results
- [ ] Implement `src/formatters/sarif.ts` — SARIF schema output for GitHub Code Scanning inline PR annotations
- [ ] Write unit tests for all three formatters (snapshot tests recommended)

---

## Milestone 7: Operating Modes

The execution backends that launch agents.

- [ ] Implement `src/modes/user-prompt.ts` — Build orchestration prompt listing all prompt file paths, display to user, watch `.prosecheck/working/outputs/` for result files, support user-signal completion in interactive environments
- [ ] Implement `src/modes/claude-code.ts` — Spawn `claude --print` processes via execa (one per rule, parallel), feed prompt file content to each instance, collect outputs, support `claudeCode.singleInstance` config for agent-team strategy
- [ ] Write unit tests for user-prompt mode (prompt generation, file watching)
- [ ] Write unit tests for claude-code mode (mock execa, process management, single-instance toggle)

---

## Milestone 8: Engine Orchestration

Wire everything together into the main lint pipeline.

- [ ] Implement `src/lib/engine.ts` — Full pipeline: cleanup working dir → run calculators → change detection → filter rules → generate prompts → dispatch to mode → collect results → format → post-run → set exit code
- [ ] Implement `src/commands/lint.ts` — Parse lint-specific CLI flags, construct RunContext, invoke engine, handle errors with exit code 2
- [ ] Write unit tests for engine (mock all subsystems, test pipeline ordering, test error handling)

---

## Milestone 9: CLI & Init Command

Top-level CLI wiring and project scaffolding.

- [ ] Implement `src/cli.ts` — Commander program definition, register lint and init subcommands, global flags (`--env`, `--mode`, `--format`, `--timeout`, `--warn-as-error`, `--last-run-read`, `--last-run-write`, `--retry-dropped`), environment resolution, `process.exitCode` handling
- [ ] Implement `src/commands/init.ts` — Create `.prosecheck/` directory, write default `config.json`, add `.prosecheck/working/`, `.prosecheck/config.local.json`, `.prosecheck/last-user-run` to `.gitignore`, optionally create starter `RULES.md`
- [ ] Write integration tests for CLI (`tests/integration/cli.test.ts`) — Spawn `dist/cli.js` with execa, assert exit codes and stdout/stderr for various scenarios
- [ ] Write integration tests for init command (`tests/integration/init.test.ts`) — Verify scaffolded files and gitignore entries

---

## Milestone 10: Terminal UI

Interactive display for real-time progress.

- [ ] Implement `src/ui/components/LintProgress.tsx` — Ink/React component showing live table of rule names, run statuses (waiting/running/done), and results as agents complete
- [ ] Implement `src/ui/components/Summary.tsx` — Final results summary component with pass/warn/fail/dropped counts and overall status
- [ ] Write component tests using ink-testing-library

---

## Milestone 11: Library API

Public programmatic interface for use as a dependency.

- [ ] Implement `src/index.ts` — Export core types (Rule, RuleResult, Config), engine function, and formatter utilities for programmatic consumption

---

## Milestone 12: End-to-End Validation

Full integration testing against real scenarios.

- [ ] End-to-end test: user-prompt mode with fixture project — verify prompt files generated, simulate agent output, verify formatted results
- [ ] End-to-end test: claude-code mode with fixture project (mocked execa) — verify full pipeline from CLI invocation to exit code
- [ ] End-to-end test: init command creates working project scaffold
- [ ] End-to-end test: incremental run tracking across multiple invocations
- [ ] End-to-end test: SARIF output validates against SARIF schema
- [ ] Verify CI pipeline passes (`npm run ci`) — typecheck, lint, format, test, build

---

## Milestone 13: Configuration Editor

Interactive `prosecheck config` command — schema-driven, no hardcoded field list.

- [ ] Add `src/commands/config.ts` — Implement config command entry point, load current config from `.prosecheck/config.json`
- [ ] Implement Zod schema walker — Recursively traverse `ConfigSchema` to extract field paths, types, descriptions (`.describe()`), defaults (`.default()`), and constraints (min/max, enums, array item types) into a flat field metadata list
- [ ] Implement config editor UI components (Ink/React) — Browsable field list with current value vs default, grouped by section (top-level keys). Support editing strings, numbers, booleans, string arrays, and nested objects. Validate input against the Zod schema in real-time
- [ ] Implement config writer — Serialize modified config back to `.prosecheck/config.json` with clean formatting, only writing fields that differ from defaults (minimal config)
- [ ] Register `config` command in CLI (`src/cli.ts`)
- [ ] Write unit tests for schema walker (field discovery, description extraction, default extraction, nested field paths)
- [ ] Write unit tests for config editor (ink-testing-library — field navigation, value editing, validation feedback)
- [ ] Write integration test — Run `prosecheck config`, modify a field, verify written JSON is valid

---

## Future Milestones (Post-MVP)

These are designed in the plan but not targeted for the initial implementation.

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

### npm Publishing
- [ ] Prepare for npm publish — LICENSE file, polished README, `prepublishOnly` script, semantic versioning

### Performance Optimization
- [ ] Rule batching — optionally combine multiple rules into a single agent call for cost reduction
- [ ] Large-scope caching — cache file listings for global-scope rules to avoid redundant filesystem traversal
