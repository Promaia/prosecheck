# 11. Use acceptEdits permission mode for Claude CLI

## Status

Accepted

## Context

Prosecheck spawns `claude --print` to evaluate lint rules. Each agent needs to write its JSON result to a specific output file under `.prosecheck/working/outputs/`. Ideally, we would scope file write access tightly using `--allowedTools` with per-file Write permissions:

- Multi-instance mode: `Write(<project>/.prosecheck/working/outputs/<rule-id>.json)`
- Single-instance mode: `Write(<project>/.prosecheck/working/outputs/*)`

This would follow the principle of least privilege — agents can only write to their designated output files.

However, Claude CLI's scoped Write permissions are currently buggy. Agents frequently receive permission denials when attempting to write to paths that should be allowed by their `--allowedTools` configuration. This causes lint runs to fail unpredictably, producing dropped rules with no output.

Alternatives considered:

- **Scoped Write permissions only.** The correct long-term approach, but currently unreliable due to upstream bugs in Claude CLI's permission matching.
- **`--permission-mode bypassPermissions`.** Too permissive — grants unrestricted access to the filesystem, network, and shell. Violates least privilege.
- **`--permission-mode acceptEdits`.** Accepts all file read/write operations automatically while still requiring approval for other actions (shell commands, network requests). A reasonable middle ground.

## Decision

Spawn `claude --print` with `--permission-mode acceptEdits`. This allows agents to write their output files reliably without manual approval.

The scoped `--allowedTools` Write entries are **kept in the generated command** even though `acceptEdits` makes them redundant. This means:

1. The code that computes per-rule and wildcard Write permissions remains exercised and tested.
2. When Claude CLI fixes its scoped permission bugs, switching back requires only removing `--permission-mode acceptEdits` from the args — no other code changes.
3. The `--allowedTools` entries serve as documentation of intended access scope.

## Consequences

- **Reliable output.** Agents can always write their result files, eliminating spurious dropped rules from permission bugs.
- **Broader write access than ideal.** Agents can write to any file, not just their output file. Since agents are prompted to write only to the specified output path and the session is non-interactive (`--print`), the practical risk is low.
- **Future migration path.** When upstream fixes land, remove the `--permission-mode acceptEdits` flag and the existing `--allowedTools` Write entries will enforce scoped access automatically. No structural changes needed.
- **Shell commands still gated.** `acceptEdits` does not auto-approve Bash commands, so agents cannot execute arbitrary shell operations without explicit tool permissions.
