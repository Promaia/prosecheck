# No process.exit() calls
---
model: haiku
---
Use `process.exitCode = N` instead of `process.exit(N)`. Direct process.exit() skips cleanup and can mask errors in tests.

# No eslint-disable comments
---
model: haiku
---
Do not add `// eslint-disable` or `/* eslint-disable */` comments. Fix the underlying lint issue instead.

# Imports use .js extensions
---
model: haiku
---
All relative imports must include the `.js` extension (e.g., `import { foo } from './bar.js'`). This is required for ESM compatibility.

# No default exports
---
model: haiku
---
Prefer named exports over default exports. Named exports provide better refactoring support and consistent import names across the codebase.

# New features must have tests
---
model: opus
---
Any new feature must include corresponding test coverage. Test files belong in the matching `tests/` subdirectory (unit, integration, e2e).

# Architecture docs reflect implemented state
---
model: opus
---
Files in `docs/architecture/` must accurately describe the current codebase. Status markers (`[STUB]`, `[IMPLEMENTED]`, `[PLANNED]`) must match reality. Do not describe features that don't exist without a status marker. Compare against the working tree, not just committed code — uncommitted changes count as the current state.
