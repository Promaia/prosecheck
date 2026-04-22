# ADR-014: Per-rule last-run state

## Status

Accepted

## Date

2026-04-22

## Context

`last-user-run` today is a single global snapshot: one `commitHash`, one `filesHash` digest, and (when `lastRun.files` is enabled) one flat `files` map of per-file hashes for all in-scope files across every rule. Change detection triggers a rule when any of its in-scope files differ from that global snapshot.

This global model forces a binary on partial runs. If the user runs `prosecheck --rules foo`, the resulting last-run file could only honestly represent *all* rules if every rule had just been evaluated. Because that isn't true, engine step 2-filter explicitly forces `lastRun.write = false` for `--rules` invocations — partial runs leave no trace at all.

The practical consequence: a common developer workflow re-runs rules unnecessarily. User checks one rule (`--rules small-thing`), confirms it passes, keeps working, then runs a full check — the full check re-evaluates `small-thing` even though its in-scope files haven't changed since it passed moments ago. LLM invocations are the dominant cost, so redoing known-good work is meaningful waste.

Caching "this rule already passed against this input" needs a per-rule state, not a global one.

## Options Considered

**1. Keep global state, allow partial runs to update it.** Rejected. A partial `--rules` run cannot advance the global snapshot without implicitly claiming the unrun rules also passed at the new state — which would silently mask real work that needs doing on the next full run. The step 2-filter guard exists for a reason.

**2. Per-rule state with independent per-file hash maps.** Chosen. Each rule stores the hashes of its in-scope files at the time of its last passing run, plus a fingerprint over inputs that would invalidate the verdict. On each run, a rule triggers iff any of its in-scope files or inputs differ from its stored entry, or no entry exists. Partial runs can safely update the entries of the rules they evaluated without touching the rest.

**3. Cache all verdicts (pass/warn/fail) not just pass.** Rejected. Caching a `warn` or `fail` would hide a known issue from the next report even though the user may have edited unrelated files expecting the report to re-surface it. Surprising and user-hostile. Only `pass` is cached; `warn`/`fail`/`dropped` always re-evaluate on the next triggering run.

**4. Cache based on file content only.** Rejected. A rule's verdict is a function of more than the files — it depends on the rule's own text, inclusions, model, prompt template, and global prompt. Changing any of those should invalidate the cache. The per-rule entry stores a `ruleFingerprint` covering these inputs so cache invalidation is correct without user intervention.

## Decision

Replace the current global last-run model with a per-rule model.

The last-run file becomes:

```json
{
  "rules": {
    "<rule-id>": {
      "files": { "relative/path.ts": "sha256...", ... },
      "fingerprint": "sha256...",
      "status": "pass"
    }
  }
}
```

- `files` is the map of in-scope file hashes at the time of the last passing evaluation of this rule.
- `fingerprint` is a SHA-256 over the rule's text (description + inclusions + model + frontmatter), the prompt template, and the global prompt. Any change in those inputs invalidates the cache for that rule.
- `status` is always `pass` when an entry exists. We only write entries for passing rules; `warn`, `fail`, and `dropped` never produce a cache entry, and any prior entry is removed when a rule produces a non-pass verdict.

Change detection becomes a per-rule check: for each rule, compare the current in-scope file hashes and current fingerprint against the stored entry. Trigger if anything differs or no entry exists. Skipped rules are reported in output as `CACHED` (a new pseudo-status) so users can see what was evaluated this run and what was taken from cache.

Partial `--rules` runs now update the per-rule entries for the rules they evaluated and leave every other entry untouched. The `lastRun.write = false` force in engine step 2-filter is removed.

We will not maintain backwards compatibility with the prior last-run format. On first run against an old `last-user-run`, the file is simply treated as absent and rewritten in the new shape. Hash-check mode (`--hash-check`) is reworked to use per-rule data — a repo passes hash-check iff every in-scope rule has a current cache entry.

The `lastRun.files` config option is retired, since per-file granularity is now the only mode. `lastRun.read` and `lastRun.write` remain.

## Consequences

Partial runs stop being silently discarded. A `--rules foo` run that passes will, on the next full check, correctly skip `foo` — matching user expectation and saving a meaningful amount of LLM work.

Rule text and prompt-template edits invalidate cache automatically via the fingerprint, so users don't need to remember to clear cache when they edit rules. This is a notable correctness improvement over the current global model, which does not track prompt or rule-text changes at all.

The ADR-003 caveat (agents may read outside their scope) is unchanged: per-rule caching inherits the same blind spot as today's `lastRun.files`. A rule like "docs must match implementation" scoped to `docs/` won't re-trigger on implementation changes. This is left to rule-author discipline, as with the current system — there is no known way to make it perfect without the agent declaring its dependencies, which LLMs do not do reliably.

The last-run file grows roughly linearly with (rules × in-scope files per rule). For repos with many global rules this is larger than the current single-map format, but still small (a hash per file, sorted JSON). Measured overhead is expected to be negligible compared to LLM invocation cost.

Retiring `lastRun.files` and rewriting the file format is a breaking change to users who've committed `last-user-run`. On first run after upgrade, the file rewrites and every rule re-evaluates once — a one-time cost. No migration shim is maintained.

`CACHED` becomes a new visible state in formatters (stylish/json/sarif). Adding a state is a minor output-format change; we accept the small surface churn as the cost of making cached skips legible.
