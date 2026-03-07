# Content-based hash check

Replace the git-commit-hash last-run file with a content-based file hash. This fixes the circular dependency where committing the hash file changes HEAD, and enables a lightweight `--hash-check` mode that passes/fails without launching agents.

## Background

The current `last-user-run` file stores a git commit hash. This is broken for hash-check CI workflows because committing the file changes HEAD, so the stored hash can never match. A content-based hash of in-scope files solves this: the hash only changes when checked files actually change, not when the hash file itself is committed.

## New last-run file format

The file (`.prosecheck/last-user-run`) becomes a **single compact JSON line** (no pretty-printing) so that merge conflicts always resolve to "most recent wins":

```
{"commitHash":"abc123...","filesHash":"def456..."}
```

With `lastRun.files` enabled:

```
{"commitHash":"abc123...","filesHash":"def456...","files":{"src/foo.ts":"aaa...","src/bar.ts":"bbb..."}}
```

Fields:
- `commitHash` — git HEAD at time of run (used for git-based fallback in `lastRun.read`)
- `filesHash` — SHA-256 digest of sorted `path:contenthash` pairs for all in-scope files
- `files` — (optional) per-file content hashes, only written when `lastRun.files` is enabled

Content hashing: read file bytes from working tree, normalize `\r\n` to `\n`, SHA-256 hash.

## Change detection progression (when `lastRun.read` is true)

1. **Files-based** (if stored `files` map exists): compute current in-scope file hashes, diff against stored map. Changed/new/removed files are the diff. Match to rule scopes to find triggered rules.
2. **Digest-only** (if `filesHash` exists but no `files` map): if current digest matches stored digest, zero triggered rules (pass fast). If mismatch, fall through to git-based.
3. **Git-based** (if `commitHash` exists): use as `git diff` ref, same as current behavior.
4. **Merge-base** (fallback): `git merge-base HEAD baseBranch`, same as current behavior.

## Tasks

### Config and CLI

- [x] Add `lastRun.files` field to `LastRunSchema` (boolean, default false) — controls whether per-file hashes are written
- [x] Add `lastRun.files` to `EnvironmentOverrideSchema`
- [x] Add `--last-run-files 1|0` CLI flag to `lint` command, wire through to config overrides
- [x] Add `--hash-check` flag to `lint` command (boolean)

### Untracked file detection

- [x] In `getChangedFiles`, union `git diff --name-only ref` with `git ls-files --others --exclude-standard` so untracked files (new, not yet staged) are included in change detection
- [x] Verify global ignore filtering still applies to untracked files
- [x] Add tests for untracked file inclusion

### Content hashing

- [x] Add `computeFileHash(filePath)` — read file, normalize `\r\n` to `\n`, return SHA-256 hex
- [x] Add `computeFilesHash(projectRoot, filePaths)` — sort paths, hash each, produce `{ filesHash, files }` where `files` is the per-file map
- [x] Add `computeDigest(files)` — given sorted `path:hash` pairs, produce a single SHA-256 digest
- [x] Add unit tests for content hashing (line ending normalization, deterministic ordering, empty file set)

### Last-run file read/write

- [x] Update `writeLastRunHash` to write compact JSON `{ commitHash, filesHash, files? }`
- [x] Update `readLastRunHash` to parse JSON format; fall back to plain-text git hash for backwards compatibility with old files
- [x] When `lastRun.files` is false, omit `files` key from written JSON
- [x] Add unit tests for new format read/write and backwards-compat fallback

### Files-based change detection

- [x] When `lastRun.read` is true and stored `files` map exists: compute current in-scope hashes, diff against stored map, use diff as changed file list
- [x] When `lastRun.read` is true and only `filesHash` exists: compare digest, skip agents if match, fall through to git-based if mismatch
- [x] When `lastRun.read` is true and only `commitHash` exists: use as git diff ref (current behavior)
- [x] Ensure triggered rules are determined from the files-based diff the same way as from git diff (same scope matching, same ignore filtering)
- [x] Add unit tests for each fallback tier

### Hash-check mode (`--hash-check`)

- [x] In engine (or lint command): when `--hash-check` is set, run calculators and scope matching only — no prompt generation, no agent dispatch
- [x] Compute current `filesHash` for all in-scope files
- [x] Read stored last-run file, compare `filesHash`
- [x] Match → pass (exit 0), print confirmation message
- [x] Mismatch → fail (exit 1), print which files differ (if `files` detail available) or generic "files changed" message
- [x] Respect output format flags (stylish/json) for hash-check output
- [x] Add unit tests for hash-check pass/fail paths
- [x] Add integration test: run lint with `--last-run-write`, modify a file, verify `--hash-check` fails; run lint again, verify `--hash-check` passes

### Init and workflow updates

- [x] `--github-actions-incremental` sets `lastRun.files: true` in interactive environment config (so CI gets per-file detail for better diff reporting)
- [x] `--github-actions-hash-check` workflow calls `npx prosecheck lint --hash-check` instead of the current shell script that compares git hashes
- [x] Remove the shell-script-based `WORKFLOW_HASH_CHECK` template
- [x] Update init tests for new workflow content and config values

### Documentation

- [x] Write ADR for content-hash design decision
- [x] Update architecture docs for new last-run format and hash-check mode
- [x] Update ARCHITECTURE.md change detection section
