# Error messages must be actionable
---
model: sonnet
---
User-facing error messages (thrown errors, CLI output) should explain what went wrong and suggest how to fix it. Avoid bare "invalid input" or "something went wrong" messages.

# Zod schemas validate at system boundaries only
---
model: haiku
---
Use Zod for validating external input (config files, CLI args, agent JSON output). Do not add Zod validation for internal function arguments — trust TypeScript's type system for internal code.

# No hardcoded file paths
---
model: haiku
---
Do not hardcode absolute paths or platform-specific path separators. Use `path.join()` or `path.posix.join()` and derive paths from `projectRoot` or similar context.
