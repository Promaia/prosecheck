# Per-Rule Model Selection

Allow rules to specify which Claude model evaluates them via frontmatter. See `docs/plans/per-rule-model.md` for the full design.

---

## Config

- [ ] Add `defaultModel` field to `ClaudeCodeSchema` (default: `'sonnet'`)
- [ ] Add `teamsOrchestratorModel` field to `ClaudeCodeSchema` (optional, defaults to `defaultModel`)
- [ ] Add `validModels` field to `ClaudeCodeSchema` (default: `['opus', 'sonnet', 'haiku']`)
- [ ] Remove `--model` from `additionalArgs` in `.prosecheck/config.json`

---

## Data model

- [ ] Add `model?: string` to the `Rule` interface
- [ ] Extract `model` from frontmatter in `extractRuleMetadata()` (same pattern as `group`)
- [ ] Validate `model` against `validModels` at parse time; warn and discard invalid values

---

## Early model resolution

- [ ] In engine, after rule discovery: stamp `defaultModel` onto every rule with no explicit model
- [ ] Add tests for resolution (explicit model preserved, undefined gets default)

---

## `spawnClaude()` changes

- [ ] Add `model?: string` to `SpawnClaudeOptions`
- [ ] When set, insert `--model <value>` into args and filter `--model` from `additionalArgs`
- [ ] Add tests for model arg insertion and `additionalArgs` conflict handling

---

## Execution plan partitioning

- [ ] Add `model?: string` to the `Invocation` interface
- [ ] `one-to-one`: set `Invocation.model` from the rule's model
- [ ] Ungrouped `one-to-many-single`: partition rules by model, one invocation per model
- [ ] Groups: partition each group by model, one invocation per (group, model) pair
- [ ] `one-to-many-teams`: set `Invocation.model` to `teamsOrchestratorModel ?? defaultModel`
- [ ] Add tests for partitioning (mixed models, uniform models, groups with mixed models)

---

## `executeInvocation()` changes

- [ ] Read `invocation.model` and pass to `spawnClaude()`
- [ ] Add test verifying model flows through to spawn args

---

## Orchestration prompt

- [ ] Annotate rules with model in `buildAgentTeamsPrompt()` when model differs from default
- [ ] Add instruction telling orchestrator to use the specified model per teammate
- [ ] Add tests for prompt annotations (mixed models, all-default models)

---

## Integration test

- [ ] End-to-end test: rules with different models produce correct `--model` args per invocation
