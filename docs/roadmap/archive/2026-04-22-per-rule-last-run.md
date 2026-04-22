# Per-rule last-run state

Replace the global last-run snapshot with per-rule entries so that partial `--rules` runs persist correctly and subsequent full checks skip rules whose inputs are unchanged since the last passing evaluation. See ADR-014 for the design.

---

## Data model

- [x] Define new `LastRunData` shape: `{ rules: Record<ruleId, { files, fingerprint, status: 'pass' }> }`
- [x] Delete the old `LastRunData` shape (commitHash / filesHash / files) — no backwards-compat path
- [x] Remove the legacy plain-text git-hash branch from `readLastRunData`
- [x] Remove `lastRun.files` from `ConfigSchema`; keep `lastRun.read` and `lastRun.write`
- [x] Update `writeLastRunData` + `readLastRunData` to the new shape; drop `writeLastRunHash` / `readLastRunHash` helpers
- [x] Add a `ruleFingerprint(rule, promptTemplate, globalPrompt)` helper that returns a SHA-256 over rule text, inclusions, model, frontmatter, prompt template, and global prompt

---

## Change detection

- [x] Rewrite `detectChanges` to iterate rules and check each against its stored entry
- [x] For each rule: trigger if no entry exists, fingerprint differs, or any in-scope file hash differs (including file-add and file-remove within scope)
- [x] Remove the tiered fallback (files-based → digest-only → git-based → merge-base); the new model is files-based only for triggering decisions
- [x] Keep merge-base computation for the `comparisonRef` passed to agents (ADR-003 is unchanged)
- [x] Remove `collectInScopeFiles`'s current "union across all rules" behavior where it conflicts — per-rule in-scope sets are now what matter; keep a shared tracked-files query to avoid re-running `git ls-files` per rule
- [x] Add tests: no prior state triggers all rules; unchanged rule with current fingerprint is skipped; fingerprint change triggers; in-scope file change triggers; out-of-scope change does not trigger; rule added/removed handled cleanly

---

## Engine integration

- [x] Replace global `commitLastRunHash` callback with a per-rule `writeRuleCacheEntries(passingRules)` callback
- [x] On successful collection, write an entry for every rule whose status is `pass`; delete entries for rules that ran and produced non-pass; leave untouched entries for rules that didn't run
- [x] Remove the `lastRun.write = false` force in engine step 2-filter — partial `--rules` runs now write their entries
- [x] Thread prompt template and global prompt into fingerprint computation (both already loaded in `prompt.ts`)
- [x] Add test: partial `--rules` run updates only the targeted rules' entries; full subsequent run skips them

---

## CACHED status

- [x] Add `cached` to `RuleStatus` (or introduce as an engine-level pseudo-status distinct from agent-written statuses)
- [x] Engine emits cached-pass entries into the results set for rules that were skipped due to a current cache hit
- [x] Progress events: emit `cached` for skipped rules so the Ink UI shows them
- [x] Worst-status calculation treats `cached` as equivalent to `pass`
- [x] Add tests for the new status at the engine boundary

---

## Formatters

- [x] `stylish`: render `CACHED` rows with their own label and summary count
- [x] `json`: include cached rules in the results array with `status: "cached"`
- [x] `sarif`: omit cached rules (same treatment as `pass`)
- [x] Update `Summary.tsx` counts to include cached
- [x] Update `LintProgress.tsx` status labels

---

## Hash-check mode

- [x] Rework `--hash-check` to pass iff every rule has a current cache entry (fingerprint matches and no in-scope files changed)
- [x] Rework `--hash-check-write` to compute and write cache entries for every rule using a stub `pass` status (consistent with current "mark as checked" semantics)
- [x] Update hash-check tests

---

## CLI + config cleanup

- [x] Remove `--last-run-files` CLI flag from `lint.ts`
- [x] Remove `lastRun.files` handling from `config.ts` extraction
- [x] Update `config list` golden output tests

---

## Docs

- [x] Update `docs/architecture/ARCHITECTURE.md` — change-detection section, content-hash section, file system layout example, agent output table (add CACHED row)
- [x] Update README if it mentions `lastRun.files`
- [x] Move ADR-014 status from Proposed to Accepted once merged
- [x] Add a note to ADR-013's Status ("Superseded in part by ADR-014" — the per-file hashing primitive remains, but the global-snapshot model is gone)

---

## Verification

- [x] `npm run ci` clean
- [x] `npm run prosecheck:self` clean
- [x] Manual check: partial `--rules` run followed by full run actually skips the partially-checked rule
- [x] Manual check: editing a rule's text invalidates its cache on next run
