# Ergonomics and Safeguards

Features that reduce self-inflicted cost when agentic callers (Claude Code in particular) drive prosecheck. Each item traces back to a concrete failure mode observed in a real 204 MB chat transcript analyzing promaia-ts usage.

## Motivation

A session of ~237 prosecheck invocations wasted substantial time on four repeating patterns:

1. Rule-ID guessing (`--rules "..."` matched-no-rules loops, 5–6 full-agent-spawning attempts per occurrence).
2. Parallel runs into the same working dir (up to 5 concurrent `pnpm prosecheck > /tmp/N.log &` burns).
3. `| tail -N` piping stripping rule IDs, making follow-up filtering impossible.
4. Repeated full runs to "refresh the hash" after filtered runs — legitimate in that they do catch cross-rule regressions, but punishingly expensive.

## 1. Rule listing + strict `--rules` validation

**Problem:** Today `--rules "does-not-match"` prints a one-line warning and exits 0 with zero rules run. Callers don't discover the misspelling until after a wasted invocation. Agentic callers then loop through variants, each spawning rule-discovery and model calls before realizing the filter matched nothing.

**Proposal:**

- [x] Add `prosecheck list-rules` subcommand. Lists every discovered rule (name, id/slug, group, model, source file, inclusions) in a readable format. Support `--json`.
- [x] In `lint`, when `--rules` is set, validate **all** supplied names against the discovered rule set before launching any agent:
  - Accept exact match on rule name (case-insensitive) OR stable slug id.
  - On any unrecognized entry: exit code 2, print the unrecognized names, print the available names+ids, do not launch any agent.
  - Pass `--rules-allow-missing` to restore the previous "warn and run the rest" behavior.

**Touches:** `src/commands/lint.ts`, `src/lib/rule.ts` (`findUnmatchedRuleFilters`), new `src/commands/list-rules.ts`, `src/lib/engine.ts` (`UnknownRuleFilterError`).

## 2. Concurrency safety (PID file / "already running" detection)

**Problem:** `.prosecheck/working/` is a single shared tree per repo. Two concurrent runs corrupt each other's `outputs/`, `prompts/`, `timing/`. Observed in chat at L26129, L26262, L26283, L26297, L26314 (five concurrent background runs over 40 min) and L51923→51926 (4 seconds apart).

**Proposal:**

- [x] On `prosecheck lint` start, write `.prosecheck/.runlock` containing `{ pid, startedAt, host }`. Remove on normal exit and on signal handlers (`SIGINT`, `SIGTERM`). The lock lives outside `.prosecheck/working/` because the engine wipes that tree at the start of every run.
- [x] Before writing the lock, check for an existing one. If present AND the pid is alive (OS-level `process.kill(pid, 0)` probe; treat cross-host locks as alive):
  - Exit code 2 by default.
  - Print: the pid, when it started (with relative age), the count of `<rule-id>.json` files already in `working/outputs/`, and an explanation that running two lints against the same working dir corrupts shared files.
  - Suggest three paths: wait, kill, or bypass with a flag.
- [x] Flags: `--force` (and alias `--ignore-runlock`) bypass the check.
- [x] If the lock file is present but the pid is dead (or the file is malformed), reclaim it and log a warning.

**Touches:** new `src/lib/runlock.ts`, `src/commands/lint.ts` (acquire before runEngine, release in finally, flag surface).

## 3. Output tail-safety hint

**Problem:** Callers routinely pipe `pnpm prosecheck 2>&1 | tail -5` to fit the summary into chat context, which discards per-rule lines. When a failure happens, they don't have rule IDs to pass to `--rules`, so they either re-grep `.prosecheck/working/outputs/*.json` or re-run the full suite.

**Proposal:**

- [x] When `--output <file>` is set (stylish or json formatter), append a final line to stdout that unambiguously points at the file, something like:

      ℹ For the full per-rule output including rule IDs you can pass to --rules, read: .prosecheck/last-output.txt

  Placed AFTER the summary so `tail -N` with even tiny N captures it.
- [x] Do NOT emit when `--format json` or `--format sarif` is going to stdout (would corrupt machine consumption).
- [x] Also emit a one-line "next-step hint" with the exact filter command when any rule failed/warned/dropped:

      ℹ Re-run only these rules: prosecheck lint --rules "<Rule A>,<Rule B>"

**Touches:** new `src/lib/output-hints.ts`, `src/commands/lint.ts` where output is composed.

## 4. Frontmatter-declared inclusions (and exclusions)

**Problem:** `buildInclusionFilter` supports full gitignore syntax including `!` negation, but `rules-md` calculator hard-codes inclusions to `[<dir-of-RULES.md>/]` and ignores any `inclusions:` field in frontmatter. Callers can't narrow scope without splitting RULES.md across directories. See promaia-tuning plan for the downstream payoff.

**Proposal:**

- [x] Extend `extractRuleMetadata()` (frontmatter.ts) to surface an `inclusions?: string[]` field.
- [x] In `rules-md.ts`, if a rule's frontmatter supplies `inclusions`, use those verbatim (not merged with the directory path). If absent, fall back to today's directory-prefix default.
- [x] `inclusions` is gitignore-syntax, so negation via `!pattern` works out of the box — no separate `exclusions:` field needed.
- [x] Fingerprint already hashes inclusions (`src/lib/fingerprint.ts`), so cache invalidates automatically when a rule's scope changes. No ADR-014 change required.
- [x] Extend `adr.ts` calculator the same way for consistency.

**Touches:** `src/lib/frontmatter.ts`, `src/lib/calculators/rules-md.ts`, `src/lib/calculators/adr.ts`, tests for all three.

## Priority / sequencing

1 (rule list + strict validation) and 3 (tail-safety hint) are small and independently valuable; do either first.
2 (runlock) is moderate and blocks a whole class of silent corruption, worth doing next.
4 (inclusions) unblocks the big cache-hit-rate win downstream in callers like promaia-ts.

No item here is tied to another — ship them separately as they're ready.

## Non-goals

- A `--rules … --refresh-cache-for-rest` affordance. Attractive in theory (would let filtered runs also re-stamp the cache for un-re-evaluated rules as still-good), but dangerous: we verified that full-run follow-ups catch real cross-rule regressions. The right fix is making the follow-up full run cheap via better cache and scope, not letting callers stamp cache without evaluation.
- Changing default `claudeToRuleShape` or dispatch semantics. Orthogonal to everything above.
