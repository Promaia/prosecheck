# Building a TypeScript CLI for LLM-powered linting

**Commander.js paired with Ink is the proven architecture for this exact use case** — Anthropic's Claude Code, Google's Gemini CLI, and GitHub Copilot CLI [GitHub](https://github.com/vadimdemedes/ink) all use this combination. The pattern works because Commander handles argument parsing with zero dependencies while Ink provides a React-based interactive terminal layer, and the two decouple cleanly so CI mode bypasses Ink entirely. What follows is a complete technical blueprint covering framework selection, project structure, terminal UX, distribution, CI integration, and testing — all grounded in 2025-2026 tooling.

## The framework landscape favors Commander.js + Ink

No single framework handles both argument parsing and interactive terminal UX well. The ecosystem has settled on a two-layer approach: a lightweight argument parser for commands and flags, plus a separate rendering layer for interactive output.

**Commander.js** dominates argument parsing with **240 million weekly npm downloads**, zero dependencies, and **18–25ms startup time** — the fastest among frameworks. [Grizzlypeaksoftware](https://www.grizzlypeaksoftware.com/library/cli-framework-comparison-commander-vs-yargs-vs-oclif-utxlf9v9) It ships built-in `.d.ts` types, and the `@commander-js/extra-typings` companion package adds full type inference for parsed options. Subcommands work via `.command()` chaining [npm](https://www.npmjs.com/package/commander) or file-based executable subcommands. The testing story is simple: call `.parseAsync()` with a mock argv array. Real-world adopters include shadcn/ui and Claude Code.

**Ink** provides a React renderer for terminals — flexbox layout, hooks, reactive state, component composition. It has **27,800 GitHub stars** [Byby](https://byby.dev/node-command-line-libraries) and powers the interactive UIs for Claude Code, Gemini CLI, Prisma, Cloudflare Wrangler, [GitHub](https://github.com/vadimdemedes/ink) and Shopify CLI. [GitHub](https://github.com/vadimdemedes/ink) Its `ink-testing-library [GitHub](https://github.com/vadimdemedes/ink) ` enables component-level testing, and `renderToString()` [npm](https://www.npmjs.com/package/ink) supports static output for CI. Anthropic chose Ink specifically because React/TypeScript is familiar to most developers and the component model maps well to terminal UI composition.

The other frameworks each have clear tradeoffs that make them less suitable:

| Framework | Stars | Weekly downloads | Key tradeoff |
|-----------|-------|-----------------|--------------|
| **oclif** | 9,400 | 170K | Best plugin system, but ~30 deps, 85–135ms startup — overkill for a focused linting tool |
| **yargs** | 11,400 | 138M | Solid middleware system, but weaker TypeScript inference and heavier than Commander |
| **clipanion** | 1,200 | 2.1M | TypeScript-first with excellent nested commands (powers Yarn), [GitHub](https://github.com/shadawck/awesome-cli-frameworks) but **v4.0 has stalled in RC for over a year** |
| **citty** | 1,100 | 16.6M | Clean `defineCommand()` API [UnJS](https://unjs.io/packages/citty/) from the UnJS ecosystem, but **pre-1.0 with no plugin system** |
| **cac** | 2,900 | — | Zero-dep single file [Libraries.io](https://libraries.io/npm/cac) (powers Vite), but essentially unmaintained since mid-2024 |
| **@effect/cli** | — | Low | Outstanding type safety with built-in wizard mode, [GitHub](https://github.com/Effect-TS/effect/blob/main/packages/cli/README.md) but requires buying into the entire Effect runtime |

The architecture looks like this: Commander parses arguments and detects whether the session is interactive or CI. In interactive mode, it hands off to Ink components that render spinners, streaming output, and prompts. In CI mode, it writes plain text or JSON directly to stdout and sets appropriate exit codes.

## Project structure that separates CLI shell from core logic

The single most important structural decision is **separating CLI concerns from business logic**. This makes the core linting engine testable without spawning processes and reusable as a library.

```
my-linter/
├── src/
│   ├── cli.ts              # CLI entry: arg parsing, mode detection, process.exit
│   ├── index.ts            # Library entry: exports core API for programmatic use
│   ├── commands/
│   │   ├── lint.ts          # Lint command handler
│   │   └── init.ts          # Config initialization
│   ├── lib/
│   │   ├── engine.ts        # Core linting engine (Anthropic API integration)
│   │   ├── rules.ts         # Rule definitions and loading
│   │   └── formatter.ts     # Output formatters (stylish, JSON, SARIF)
│   ├── ui/
│   │   └── components/      # Ink React components for interactive mode
│   ├── utils/
│   │   ├── config.ts        # Hierarchical config resolution
│   │   ├── env.ts           # CI/TTY environment detection
│   │   └── reporter.ts      # Dual-mode output abstraction
│   └── types/
│       └── index.ts
├── dist/
├── tests/
├── tsup.config.ts
├── tsconfig.json
└── package.json
```

**tsup is the consensus build tool** for TypeScript CLIs in 2025. It wraps esbuild for subsecond builds, generates `.d.ts` declarations, handles dual ESM/CJS output, [Thomas Belin](https://blog.atomrc.dev/p/typescript-library-compilation-2023/) and injects shebangs via its `banner` option — eliminating the need for a separate `bin/` directory.

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
```

For `tsconfig.json`, the key choices in 2025 are **`target: "ES2022"`** (Node 20 supports it fully, including top-level await), **`strict: true`** always, and **`isolatedModules: true`** for esbuild compatibility. If tsup handles emission, use `moduleResolution: "bundler"` with `noEmit: true` [Total TypeScript](https://www.totaltypescript.com/concepts/option-module-must-be-set-to-nodenext-when-option-moduleresolution-is-set-to-nodenext) and run `tsc --noEmit` separately for type checking. If you want maximum strictness, use `moduleResolution: "NodeNext"` with `.js` extensions on imports. [TypeScript](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)

**Go ESM-only with `"type": "module"`** for a new CLI. As Anthony Fu noted in early 2025, the ecosystem is ready — ESM adoption on npm reached 25.8% by end of 2024, [Anthony Fu](https://antfu.me/posts/move-on-to-esm-only) Node.js 22+ supports `require()` of ESM modules natively, [antfu](https://antfu.me/posts/move-on-to-esm-only) [Anthony Fu](https://antfu.me/posts/move-on-to-esm-only) and every major dependency in the modern CLI stack (picocolors, execa, ora, chalk) ships ESM. For a standalone CLI, end users never see whether it's ESM or CJS internally. [antfu](https://antfu.me/posts/move-on-to-esm-only) [Anthony Fu](https://antfu.me/posts/move-on-to-esm-only)

The `package.json` configuration follows established patterns:

```jsonc
{
  "name": "my-nl-linter",
  "type": "module",
  "bin": { "nl-lint": "./dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20.0.0" },
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    }
  }
}
```

The `files` whitelist keeps the published package small by excluding source, tests, and config. [npm](https://docs.npmjs.com/cli/v8/commands/npm-publish/) The `engines` field enforces Node 20+ (current LTS), which provides `import.meta.dirname` as the ESM replacement for `__dirname`.

## Interactive UX with lightweight, modern libraries

The terminal UX stack has shifted dramatically toward smaller, faster alternatives in 2025. The recommended combination totals roughly **50 KB** versus 500 KB+ for the equivalent chalk + inquirer + ora stack.

**For colors, use picocolors** (7 KB, [GitHub](https://github.com/alexeyraspopov/picocolors) 2× faster than chalk, zero dependencies). [npm](https://www.npmjs.com/package/picocolors) It supports the `NO_COLOR` and `FORCE_COLOR` standards automatically. [No-color](https://no-color.org/) [GitHub](https://github.com/chalk/supports-color) The only missing feature versus chalk is truecolor (RGB/hex) — if you need that, **ansis** (5.89 KB) provides it at comparable performance. [DEV Community](https://dev.to/webdiscus/comparison-of-nodejs-libraries-to-colorize-text-in-terminal-4j3a) Node.js v22+ also ships `util.styleText()` built-in, [npm](https://www.npmjs.com/package/@visulima/colorize) but adoption is minimal.

**For prompts, use @clack/prompts** — it's TypeScript-first, [Blacksrc](https://www.blacksrc.com/blog/elevate-your-cli-tools-with-clack-prompts) 80% smaller [James Perkins](https://www.jamesperkins.dev/post/cli-with-clack) than Inquirer, and provides beautiful out-of-box styling with `intro/outro`, grouped prompts, built-in spinner, [npm](https://www.npmjs.com/package/@clack/prompts) and log levels. Version 1.0.1 added a `stream` API [Socket](https://socket.dev/npm/package/@clack/prompts) purpose-built for streaming output. It powers Astro's `create-astro` and SvelteKit's CLI. One caveat: it doesn't auto-detect non-TTY environments, so you must gate interactive prompts behind a `process.stdout.isTTY` check.

**For spinners, use yocto-spinner** (5 KB, zero dependencies) by the same author as ora. Astro migrated from ora to yocto-spinner specifically for size reduction. [GitHub](https://github.com/withastro/astro/commit/acf264d8c003718cda5a0b9ce5fb7ac1cd6641b6) If you're already using @clack/prompts, its built-in `spinner()` [Socket](https://socket.dev/npm/package/@clack/prompts) avoids an extra dependency entirely.

**The streaming output pattern for Claude's responses** requires careful coordination with spinners. The proven approach is sequential phases — show a spinner while waiting for the first token, clear it on first chunk arrival, then stream text directly:

```typescript
const spinner = yoctoSpinner({ text: 'Analyzing with Claude...' }).start();
const stream = client.messages.stream({ model, max_tokens, messages });
let firstChunk = true;

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    if (firstChunk) {
      spinner.stop();
      firstChunk = false;
    }
    process.stdout.write(event.delta.text);
  }
}
```

**CI environment detection** should be simple: check `process.env.CI` directly (most CI services set this) or use the `is-in-ci` package. [npm](https://www.npmjs.com/package/is-in-ci) Build a single `Reporter` abstraction that switches behavior:

```typescript
export const isCI = !!process.env.CI;
export const isTTY = !!process.stdout.isTTY;
export const isInteractive = isTTY && !isCI;
```

In interactive mode, the reporter renders Ink components with spinners, colors, and prompts. In CI mode, it writes plain text or structured JSON to stdout and skips all terminal control codes. This dual-mode pattern keeps core linting logic completely decoupled from output presentation.

## Distribution via npm first, standalone binaries second

**npm remains the primary distribution channel** for CLI tools. The `bin` field creates a globally installable command, [DEV Community](https://dev.to/rameshpvr/bin-vs-scripts-in-packagejson-1pnp) and `npx my-linter` works out of the box for zero-install usage. [DEV Community](https://dev.to/nausaf/creating-an-npm-package-that-runs-on-command-line-with-npx-9a0) To optimize npx cold-start time, minimize dependencies — every kilobyte matters when npx downloads and installs on first run. Consider pre-bundling with tsup to ship a single file with zero runtime dependencies (mark large SDKs like `@anthropic-ai/sdk` as external).

For **standalone binaries**, `bun build --compile` is the leading option in 2025-2026. Anthropic acquired Bun in December 2025 and ships Claude Code as a Bun-compiled binary — a strong ecosystem signal. [tigrisdata](https://www.tigrisdata.com/blog/using-bun-and-benchmark/) [Tigrisdata](https://www.tigrisdata.com/blog/using-bun-and-benchmark/) The workflow is one command: `bun build ./src/cli.ts --compile --outfile my-linter`. Cross-compilation targets Linux, macOS, and Windows with `--target` flags. Binary size runs **60–100 MB** (the Bun runtime is embedded), with startup around 104ms. [tigrisdata](https://www.tigrisdata.com/blog/using-bun-and-benchmark/)

`deno compile` is a strong second choice with similar capabilities. [Deno](https://docs.deno.com/runtime/reference/cli/compile/) **Node.js Single Executable Apps (SEA) remain experimental** — they require CJS-only input, [GitHub](https://github.com/oven-sh/bun/discussions/8096) a multi-step build process, [DEV Community](https://dev.to/googlecloud/building-standalone-executables-with-nodejs-29l1) and lack cross-compilation. Avoid `pkg` (deprecated by Vercel) and `nexe` (stale).

For **cross-platform compatibility**, use `node:path` methods exclusively (never string concatenation for paths), [Norbauer](https://alan.norbauer.com/articles/cross-platform-nodejs/) [GitHub](https://gist.github.com/domenic/2790533) `os.EOL` for line endings, and the `figures` package for Unicode symbols that fall back to ASCII on Windows cmd.exe. npm automatically creates `.cmd` shim wrappers on Windows that parse the `#!/usr/bin/env node` shebang, [Dawchihliou](https://dawchihliou.github.io/articles/writing-your-own-typescript-cli) so the standard shebang works everywhere. [Exploring JS](https://exploringjs.com/nodejs-shell-scripting/ch_creating-shell-scripts.html) [Medium](https://medium.com/netscape/a-guide-to-create-a-nodejs-command-line-package-c2166ad0452e)

## CI mode needs exit codes, SARIF, and cost control

**Exit codes follow the ESLint convention**, which has become the de facto standard for linters: **0** for success (no errors), **1** for lint errors found, **2** for tool/configuration errors. Use `process.exitCode = n` rather than `process.exit(n)` to allow graceful cleanup of open handles. [ESLint](https://eslint.org/docs/latest/rules/no-process-exit)

**Support three output formats** at minimum via a `--format` flag. The default "stylish" format shows human-readable results with file paths, line numbers, and colored severity. JSON mode (`--format json`) outputs structured results for machine consumption. **SARIF** (`--format sarif`) is the critical format for GitHub integration — it's the OASIS standard for static analysis results [Azurewebsites](https://sarifweb.azurewebsites.net/) and integrates directly with GitHub Code Scanning via `github/codeql-action/upload-sarif@v4`, producing inline annotations on PRs without the 10-annotation-per-step limit that GitHub Actions problem matchers impose.

**Environment variable configuration** should follow a clear hierarchy: CLI flags override env vars, which override config file values, which override defaults. The Anthropic SDK automatically reads `ANTHROPIC_API_KEY` from the environment, so no explicit passing is needed. [GitHub](https://github.com/anthropics/anthropic-sdk-typescript) For GitHub Actions, store the key in repository secrets and reference it as `${{ secrets.ANTHROPIC_API_KEY }}`.

**Cost control is critical for an LLM-powered linter in CI.** Four strategies compound effectively:

- **Only lint changed files** — use `tj-actions/changed-files` in GitHub Actions or `git diff --name-only HEAD~1` to scope the run
- **Use cheaper models in CI** — configure `LINTER_MODEL=claude-haiku-4-5-20250929` via env var for CI while defaulting to Sonnet locally
- **Cache by content hash** — hash each file's content plus the active rules and model name; skip files whose hash matches a cached result
- **Set per-file timeouts** — the Anthropic SDK supports per-request timeouts and auto-retries on 429/5xx with exponential backoff [GitHub](https://github.com/anthropics/anthropic-sdk-typescript) [GitHub](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md)

**stdin piping** follows the standard pattern: check `process.stdin.isTTY` [Node.js](https://nodejs.org/api/tty.html) (undefined when piped), read with `for await (const chunk of process.stdin)`, [Jonlinnell](https://jonlinnell.co.uk/articles/node-stdin) and support `--stdin-filename` for rules that depend on file paths. This enables workflows like `cat file.ts | nl-lint --stdin-filename file.ts`.

A complete GitHub Actions workflow combines these elements — checkout, setup Node, cache npm, get changed files, run the linter with SARIF output, and upload results to Code Scanning [GitHub](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github) — giving developers inline annotations on every PR.

## Testing strategy across three layers

**Vitest is the clear choice** over Jest for TypeScript CLI testing in 2025. It has first-class ESM support [Vitest](https://vitest.dev/guide/features) (no configuration gymnastics), native TypeScript transforms via Vite, `toMatchFileSnapshot` for readable fixture-based assertions, [Vitest](https://vitest.dev/guide/snapshot) a built-in `github-actions` reporter that converts failures to PR annotations, and `describe.runIf()` for conditionally running tests that require API keys.

**Unit tests** target the core linting engine in isolation. Inject the Anthropic client as a dependency so tests can substitute a mock. MSW (Mock Service Worker) is the recommended API mocking approach — it intercepts at the network level, works with any HTTP client including the Anthropic SDK, and integrates cleanly with Vitest: [Vitest](https://vitest.dev/guide/mocking/requests)

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.post('https://api.anthropic.com/v1/messages', () =>
    HttpResponse.json({
      content: [{ type: 'text', text: '{"issues":[]}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })
  )
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

For filesystem mocking, **memfs** is Vitest's officially recommended approach — create `__mocks__/fs.cjs` and `__mocks__/fs/promises.cjs` that re-export from memfs, then `vi.mock('node:fs')` in tests. [Vitest](https://vitest.dev/guide/mocking/file-system)

**Integration tests** spawn the actual CLI binary with `execa` and assert on exit codes, stdout, and stderr. Strip ANSI codes with `strip-ansi` before comparing output. [lekoarts](https://www.lekoarts.de/how-to-test-cli-output-in-jest-vitest/) This layer catches argument parsing bugs, format output correctness, and error handling paths that unit tests miss:

```typescript
const result = execaSync(process.execPath, ['./dist/cli.js', '--format', 'json', 'fixtures/']);
expect(result.exitCode).toBe(1);
expect(JSON.parse(result.stdout).files[0].errorCount).toBeGreaterThan(0);
```

**Fixture-based testing** is the natural pattern for a linter. Create `test/fixtures/` directories with known-good and known-bad code files, pair each with expected output snapshots, and iterate over them in a test loop. For LLM-powered linting, avoid snapshotting exact messages (they'll vary between runs) — instead assert on structural properties like error counts, rule IDs, and severity levels.

**Testing interactive prompts** works best by mocking the prompt library entirely: `vi.mock('@clack/prompts')` and stub each prompt function to return predetermined values. For true end-to-end interactive testing, the complexity of simulating TTY input (pty.js, mock-stdin) rarely justifies the effort — the dual-mode architecture means interactive and CI paths share the same core engine, so thorough unit and integration tests on the core logic provide sufficient coverage.

## Conclusion

The TypeScript CLI ecosystem has converged on clear winners for each layer of the stack. Commander.js + Ink is not a speculative recommendation — it's the battle-tested architecture behind the highest-profile AI CLI tools shipping today. The supporting cast of picocolors, @clack/prompts, yocto-spinner, and tsup reflects a broader trend toward lightweight, TypeScript-first, ESM-native tooling that replaces heavier predecessors at a fraction of the bundle size.
The most impactful architectural decision is the dual-mode Reporter abstraction that switches between interactive Ink rendering and plain CI output based on environment detection. This keeps the core linting engine — the Anthropic API integration, rule evaluation, and result formatting — completely independent of presentation concerns. For an LLM-powered linter specifically, the cost control layer (changed-files-only, content-hash caching, model selection per environment, per-request timeouts) is not optional — it's essential infrastructure that prevents CI bills from scaling linearly with repository size. And SARIF output, while often overlooked, unlocks the highest-quality GitHub integration by producing inline PR annotations without the hard limits of problem matchers.
