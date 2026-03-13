# Per-Rule Model Selection

## Goal

Allow each rule to specify which Claude model (`opus`, `sonnet`, `haiku`) should evaluate it, via frontmatter:

```markdown
# No console.log
---
model: haiku
---
Do not use console.log in production code.
```

Rules without a `model` field use `claudeCode.defaultModel` (defaults to `sonnet`).

## Motivation

Different rules have different complexity. Simple style checks (e.g., "no console.log") can run on haiku for speed and cost savings. Complex architectural rules benefit from opus. Per-rule model selection lets users optimise the cost/quality tradeoff per rule.

## Current execution planning

```
buildExecutionPlan(rules, shape, maxConcurrentAgents)
  │
  ├─ separate: ungrouped[] vs grouped Map<groupName, rules[]>
  │
  ├─ ungrouped ──→ buildUngroupedInvocations(shape)
  │                  one-to-one:         1 invocation per rule
  │                  one-to-many-teams:  rules chunked into teams of `max` size
  │                  one-to-many-single: ALL rules in 1 invocation
  │
  └─ grouped ──→ 1 one-to-many-single invocation per group name

all invocations ──→ packed into batches (respecting maxConcurrentAgents)
```

Each invocation maps to one `spawnClaude()` call with one `--model` flag. The constraint: **all rules in a single-process invocation (`one-to-one`, `one-to-many-single`) must share a model**. `one-to-many-teams` is exempt because the orchestrator delegates to sub-agents who can each use a different model.

## Design

### Data model

Add `model?: string` to the `Rule` interface. Extracted from frontmatter alongside `group` by `extractRuleMetadata()` — same pattern as `extractGroupFromFrontmatter()`.

Validated against `claudeCode.validModels` (defaults to `['opus', 'sonnet', 'haiku']`). Unknown values produce a warning at parse time and fall back to `defaultModel`. Users can extend `validModels` in config to support new model aliases without waiting for a prosecheck release.

### Config changes

Replace the `additionalArgs: ["--model", "sonnet"]` pattern with two new fields on `ClaudeCodeSchema`:

```typescript
defaultModel: z.string().default('sonnet')
  .describe('Default Claude model for rule evaluation. Per-rule frontmatter overrides this.'),
teamsOrchestratorModel: z.string().optional()
  .describe('Model for the orchestrator process in one-to-many-teams mode. Defaults to defaultModel.'),
validModels: z.array(z.string()).default(['opus', 'sonnet', 'haiku'])
  .describe('Accepted model names. Rules with unrecognised model values fall back to defaultModel.'),
```

`teamsOrchestratorModel` controls which model runs the top-level orchestrator in `one-to-many-teams` invocations. The orchestrator only dispatches work and validates outputs — it doesn't evaluate rules itself — so a cheaper model may suffice. Defaults to `defaultModel` when not set.

`defaultModel` is passed as `--model` to every `spawnClaude()` call unless a per-rule model overrides it. `validModels` is used at rule parse time to validate frontmatter `model` values. No migration path needed — we're the only users, so just remove `--model` from `additionalArgs` in our config when implementing.

### Model resolution (early assignment)

Before any execution planning happens, every rule with `model: undefined` gets stamped with `defaultModel`. This happens once, at rule discovery time (in the engine, after config is loaded and rules are calculated), so all downstream code can treat `rule.model` as always-defined. This avoids spreading `?? defaultModel` fallback logic across the plan builder, invocation executor, and orchestration prompt generator.

```typescript
// In engine.ts, after calculateRules():
for (const rule of rules) {
  if (!rule.model) rule.model = config.claudeCode.defaultModel;
}
```

After this, `rule.model` is always a string. The `Rule` type keeps `model?: string` (calculators don't know about config), but all code after resolution can assume it's set.

### Execution plan changes

`buildExecutionPlan()` no longer needs a `defaultModel` option — every rule already has a model. The new flow:

```
buildExecutionPlan(rules, shape, maxConcurrentAgents)
  │
  ├─ separate: ungrouped[] vs grouped Map<groupName, rules[]>
  │
  ├─ ungrouped ──→ buildUngroupedInvocations(shape)
  │     one-to-one:         1 invocation per rule, model from rule
  │     one-to-many-teams:  chunk into teams (mixed models OK, handled via prompt)
  │     one-to-many-single: partition by model FIRST, then 1 invocation per partition
  │
  └─ grouped ──→ partition each group by model,
  │               then 1 one-to-many-single invocation per (group, model) pair
  │
  all invocations ──→ packed into batches (respecting maxConcurrentAgents)
```

#### Per invocation type

**`one-to-one`**: No partitioning needed. Each invocation has one rule. `Invocation.model` is set from that rule's effective model.

**`one-to-many-teams`**: No partitioning needed. Mixed models within a team invocation are fine — the orchestration prompt annotates each rule with its model, and the team lead spawns sub-agents accordingly. The orchestrator process itself runs on `teamsOrchestratorModel` (falling back to `defaultModel`). `Invocation.model` is set to the orchestrator model.

**`one-to-many-single` (ungrouped)**: Must partition by effective model. Currently all ungrouped rules go into one invocation — with mixed models this becomes N invocations (one per distinct model).

```
ungrouped [X(sonnet), Y(haiku), Z(sonnet)]
  → invocation 1: one-to-many-single, model=sonnet, rules=[X, Z]
  → invocation 2: one-to-many-single, model=haiku,  rules=[Y]
```

**Groups (`one-to-many-single`)**: Same partitioning, scoped within each group. The group key effectively becomes `(group, model)`.

```
group "perf" with rules [A(sonnet), B(haiku), C(sonnet)]
  → invocation 1: one-to-many-single, model=sonnet, rules=[A, C]
  → invocation 2: one-to-many-single, model=haiku,  rules=[B]
```

This preserves grouping semantics (rules in the same group+model share context) while respecting model constraints.

### `Invocation` type changes

Add `model?: string` to the `Invocation` interface. Set for all invocation types: the rule's model for single-process invocations (`one-to-one`, `one-to-many-single`), and `teamsOrchestratorModel ?? defaultModel` for `one-to-many-teams` (per-rule models are in the prompt, not the process flag).

`executeInvocation()` reads `invocation.model` and passes it to `spawnClaude()`.

### `spawnClaude()` changes

Add a `model?: string` field to `SpawnClaudeOptions`. When set:

1. Insert `--model <value>` into the args.
2. Filter out any `--model X` pair from `additionalArgs` to prevent conflict (the per-rule model takes precedence over `additionalArgs`).

After early model resolution, this is always set for single-process invocations.

### Orchestration prompt changes

For `one-to-many-teams`, extend `buildAgentTeamsPrompt()` to annotate rules with their model when it differs from default:

```
* No console.log (use haiku): .prosecheck/working/prompts/no-console-log.md
* Architecture review: .prosecheck/working/prompts/arch-review.md
```

Add an instruction: "When a rule specifies a model, use that model for the teammate evaluating that rule."

Per the [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams), model selection is controlled via the orchestration prompt — there is no explicit `model` parameter on `TeamCreate`, but the team lead interprets natural-language instructions like "Use Sonnet for each teammate" when spawning agents. This is the supported mechanism.

## Implementation order

1. **Config**: Add `defaultModel` and `validModels` to `ClaudeCodeSchema`. Deprecation warning for `--model` in `additionalArgs`.
2. **Data model**: Add `model` to `Rule` type and `extractRuleMetadata()`. Validate against `validModels`.
3. **`spawnClaude()`**: Add `model` option, handle `additionalArgs` conflict, always emit `--model`.
4. **Engine: early model resolution**: After rule discovery, stamp `defaultModel` onto rules with no explicit model.
5. **Execution plan**: Partition ungrouped `one-to-many-single` and groups by `rule.model`. Set `Invocation.model`.
6. **`executeInvocation()`**: Read `invocation.model`, pass to `spawnClaude()`.
7. **Orchestration prompt**: Annotate rules with model in `buildAgentTeamsPrompt()`.
8. **Tests**: Unit tests for model extraction, validation, early resolution, plan partitioning, spawn args, and orchestration prompt annotations.

## Known limitations

- **Teams model reliability**: Model selection for teammates is prompt-driven (natural language), not a hard API parameter. The orchestrator could theoretically ignore the model annotation and spawn with the wrong model. This is considered acceptable — the orchestration prompt is explicit, and the cost of a wrong-model evaluation is low (a slightly over/under-powered check, not a correctness failure). If `TeamCreate` gains a `model` parameter in the future, we can switch to it.
