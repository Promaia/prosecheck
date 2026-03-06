# No process.exit() calls

Use `process.exitCode = N` instead of `process.exit(N)`. Direct process.exit() skips cleanup and can mask errors in tests.

# No eslint-disable comments

Do not add `// eslint-disable` or `/* eslint-disable */` comments. Fix the underlying lint issue instead.

# Imports use .js extensions

All relative imports must include the `.js` extension (e.g., `import { foo } from './bar.js'`). This is required for ESM compatibility.

# No default exports

Prefer named exports over default exports. Named exports provide better refactoring support and consistent import names across the codebase.

# Architecture docs reflect implemented state

Files in `docs/architecture/` must accurately describe the current codebase. Status markers (`[STUB]`, `[IMPLEMENTED]`, `[PLANNED]`) must match reality. Do not describe features that don't exist without a status marker.
