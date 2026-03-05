# Future Milestones (Post-MVP)

These are designed in the plan but not targeted for the initial implementation.

## Interactive Configuration Editor
- [ ] Implement Zod schema walker — Recursively traverse `ConfigSchema` to extract field paths, types, descriptions (`.describe()`), defaults (`.default()`), and constraints (min/max, enums, array item types) into a flat field metadata list
- [ ] Implement config editor UI components (Ink/React) — Browsable field list with current value vs default, grouped by section (top-level keys). Support editing strings, numbers, booleans, string arrays, and nested objects. Validate input against the Zod schema in real-time
- [ ] Write unit tests for schema walker and config editor (ink-testing-library)
- [ ] Write integration test — Run interactive editor, modify a field, verify written JSON is valid

## Claude Agents SDK Mode
- [ ] Add `src/modes/claude-agents.ts` — In-process agent execution via `@anthropic-ai/claude-code-sdk`
- [ ] Register `claude-agents` mode in CLI
- [ ] Write tests for agents SDK mode

## Internal Loop Mode
- [ ] Add `src/modes/internal-loop.ts` — Direct Anthropic API calls with custom agent loop
- [ ] Register `internal-loop` mode in CLI
- [ ] Write tests for internal loop mode

## Custom/External Rule Calculators
- [ ] Design and implement external calculator loading mechanism (dynamic import from configured paths or npm packages)

## Structured Post-Run Actions
- [ ] Extend post-run system beyond shell commands to support structured actions: `post-pr-comment`, `update-check-run`, Slack notifications, etc.

## Performance Optimization
- [ ] Large-scope caching — cache file listings for global-scope rules to avoid redundant filesystem traversal
