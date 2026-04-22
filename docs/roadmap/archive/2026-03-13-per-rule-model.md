# Per-Rule Model Selection

Allow rules to specify which Claude model evaluates them via frontmatter. See `docs/plans/per-rule-model.md` for the full design.

---

## Config

- [x] Add `defaultModel` field to `ClaudeCodeSchema` (default: `'sonnet'`)
- [x] Add `teamsOrchestratorModel` field to `ClaudeCodeSchema` (optional, defaults to `defaultModel`)
- [x] Add `validModels` field to `ClaudeCodeSchema` (default: `['opus', 'sonnet', 'haiku']`)
- [x] Remove `--model` from `additionalArgs` in `.prosecheck/config.json`

---

## Data model

- [x] Add `model?: string` to the `Rule` interface
- [x] Extract `model` from frontmatter in `extractRuleMetadata()` (same pattern as `group`)
- [x] Validate `model` against `validModels` at parse time; warn and discard invalid values

---

## Early model resolution

- [x] In engine, after rule discovery: stamp `defaultModel` onto every rule with no explicit model
- [x] Add tests for resolution (explicit model preserved, undefined gets default)

---

## `spawnClaude()` changes

- [x] Add `model?: string` to `SpawnClaudeOptions`
- [x] When set, insert `--model <value>` into args and filter `--model` from `additionalArgs`
- [x] Add tests for model arg insertion and `additionalArgs` conflict handling

---

## Execution plan partitioning

- [x] Add `model?: string` to the `Invocation` interface
- [x] `one-to-one`: set `Invocation.model` from the rule's model
- [x] Ungrouped `one-to-many-single`: partition rules by model, one invocation per model
- [x] Groups: partition each group by model, one invocation per (group, model) pair
- [x] `one-to-many-teams`: set `Invocation.model` to `teamsOrchestratorModel ?? defaultModel`
- [x] Add tests for partitioning (mixed models, uniform models, groups with mixed models)

---

## `executeInvocation()` changes

- [x] Read `invocation.model` and pass to `spawnClaude()`
- [x] Add test verifying model flows through to spawn args

---

## Orchestration prompt

- [x] Annotate rules with model in `buildAgentTeamsPrompt()` when model differs from default
- [x] Add instruction telling orchestrator to use the specified model per teammate
- [x] Add tests for prompt annotations (mixed models, all-default models)

---

## Integration test

- [x] End-to-end test: rules with different models produce correct `--model` args per invocation
