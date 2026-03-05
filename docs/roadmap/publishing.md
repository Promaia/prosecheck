# Publishing & Distribution

Active work toward making prosecheck available as a public tool.

---

## npm Publishing

Prepare and publish prosecheck to the npm registry.

- [ ] Add LICENSE file (choose license)
- [ ] Polish README with usage examples, badges, and screenshots
- [ ] Add `prepublishOnly` script that runs `npm run ci`
- [ ] Configure `files` field in `package.json` to publish only `dist/`, `README.md`, `LICENSE`
- [ ] Set up semantic versioning and initial `0.1.0` release
- [ ] Publish to npm (`npm publish`)
- [ ] Verify `npx prosecheck init` and `npx prosecheck lint` work from a clean install

---

## Integration Setup via `init`

Make `prosecheck init` re-runnable with flags to set up CI and local hooks. Running `init` again in an already-initialized project applies the requested integrations without overwriting existing config.

- [ ] Make `init` re-runnable — skip config/directory creation if already initialized, but still process integration flags
- [ ] Add `.prosecheck/working` to `.gitignore` during init if `.gitignore` exists but the entry is missing (idempotent — safe to run multiple times)
- [ ] `prosecheck init --github-actions` — Generate a full-check workflow (runs on every push with `--last-run-read 0`). Simple setup for projects that don't need incremental optimization
- [ ] `prosecheck init --github-actions-incremental` — Generate an incremental CI setup: workflow on PR push with `--last-run-read 1`, workflow on merge queue with `--last-run-read 0`, and config with `lastRun.write=true` for the interactive environment (so local runs persist the hash). Requires GitHub merge queue for the full-check guarantee before merge
- [ ] `prosecheck init --github-actions-hash-check` — Generate a lightweight CI workflow that verifies `.prosecheck/last-user-run` matches the current commit hash. Zero token cost — relies on developers running prosecheck locally (with `--last-run-write 1`) and committing the hash file. CI just confirms someone actually ran it. Useful for teams that want CI enforcement without paying for LLM calls in CI
- [ ] `prosecheck init --git-pre-push` — Install a `.git/hooks/pre-push` script (or append to existing) that runs `prosecheck lint`
- [ ] `prosecheck init --claude-stop-hook` — Add a `Stop` hook entry to `.claude/settings.json` that runs `prosecheck lint` after Claude finishes responding
- [ ] Support combining flags: `prosecheck init --github-actions --git-pre-push` applies both in a single invocation
- [ ] Write tests for each integration flag (verify generated files, idempotency, no clobbering)
- [ ] Verify `npm run ci` passes

---

## GitHub Actions Action

A published GitHub Action (`Promaia/prosecheck-action`) for running prosecheck in CI with minimal config.

- [ ] Create action repository structure — `action.yml`, `dist/index.js` (bundled), `README.md`
- [ ] Define action inputs: `rules-path`, `format` (`stylish`|`sarif`|`json`), `environment`, `mode`, `warn-as-error`, `comparison-ref`, `timeout`, `upload-sarif` (boolean, default true when format is sarif)
- [ ] Implement action — install prosecheck, run lint with configured options, capture output
- [ ] When `upload-sarif` is true, automatically run `github/codeql-action/upload-sarif` as a post step (no user config needed)
- [ ] Expose `results-json` and `exit-code` as action outputs for downstream steps
- [ ] Write tests for action (mock GitHub context, verify SARIF upload integration)
- [ ] Publish to GitHub Marketplace
- [ ] Update `prosecheck init --github-actions` to reference the published action

---

## Binary Distribution

Build standalone binaries so users can run prosecheck without Node.js installed.

- [ ] Evaluate bundlers — `pkg`, `bun build --compile`, or `node --experimental-sea-generate` (Node 20+ single executable apps)
- [ ] Add build script for Linux, macOS (arm64 + x64), and Windows targets
- [ ] Set up GitHub Actions release workflow — on git tag, build binaries for all targets and attach to GitHub Release
- [ ] Add install instructions to README (curl one-liner, GitHub Releases, Homebrew tap)
- [ ] Verify binary works end-to-end (init, lint, config commands)

