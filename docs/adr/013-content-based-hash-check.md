# 13. Content-based file hashing for change detection

## Status

Accepted

## Context

The old `last-user-run` file stored a plain-text git commit hash. This created a circular dependency: committing the hash file changes HEAD, so the stored hash can never match in CI hash-check workflows. Any workflow that commits the last-run file invalidates itself.

We need a lightweight `--hash-check` mode that can verify no checked files changed without launching agents or requiring an API key. This mode should work reliably in CI pipelines where the last-run file is committed alongside source changes.

Cross-platform consistency is also a concern. Windows produces CRLF line endings while Unix uses LF, meaning the same logical file content can produce different hashes on different platforms.

## Decision

Replace the plain-text git hash with a compact single-line JSON format: `{"commitHash":"...","filesHash":"...","files":{...}}`.

`filesHash` is a SHA-256 digest of sorted `path:contenthash` pairs for all in-scope files. Content hashing normalizes `\r\n` to `\n` before hashing, ensuring cross-platform consistency.

When `lastRun.read` is enabled, change detection uses tiered fallback: files-based (per-file hash comparison) -> digest-only (single `filesHash` comparison) -> git-based (commit hash comparison) -> merge-base fallback.

`--hash-check` is a lint mode that compares content hashes only. No agents are launched and no API key is required.

Per-file hash detail (the `files` map) is optional, controlled by the `lastRun.files` config option. When enabled, change detection can identify exactly which files changed rather than just detecting that something changed.

The last-run file is a single compact JSON line (non-mergeable, most recent wins). `readLastRunData` still parses the legacy plain-text git hash format for backwards compatibility.

## Consequences

- **Hash check works in CI.** Committing the hash file no longer invalidates it, because content hashes only change when the checked files themselves change — not when HEAD moves.
- **Untracked files are included.** Change detection now picks up files not yet staged via `git ls-files --others --exclude-standard`, closing a gap where new files could be missed.
- **Slightly more disk I/O.** When `lastRun.files` is enabled, per-file hashes are stored alongside the aggregate digest. This is a small cost for the ability to pinpoint which files changed.
- **Backwards compatible.** Old plain-text last-run files are automatically understood but will be overwritten with the JSON format on the next write.
