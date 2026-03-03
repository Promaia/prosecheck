# Keeping AI coding agents on-track in TypeScript projects

**The most effective teams treat AI agent governance as a systems problem, not a prompting problem.** Rules files like CLAUDE.md and .cursorrules provide advisory guidance, but deterministic enforcement through compilers, linters, pre-commit hooks, and CI pipelines is what actually prevents mistakes. The field has converged on a layered defense model: project-level rules files set expectations, TypeScript's strict mode and ESLint catch violations automatically, and human-in-the-loop checkpoints gate critical decisions. A cross-tool standard called AGENTS.md — now governed by the Linux Foundation's Agentic AI Foundation [Agents](https://agents.md/) — is emerging as the universal format, [Agents](https://agents.md/) adopted by over 60,000 open-source projects and supported by Claude Code, Cursor, GitHub Copilot, Windsurf, and others.

---

## The rules file ecosystem has fragmented, then started converging

Every major AI coding tool has its own configuration format, but they share a common structure: markdown files placed in the repository that describe project context, coding conventions, and workflow instructions. The key formats are:

**CLAUDE.md** (Claude Code) uses a hierarchical loading model. Files at `~/.claude/CLAUDE.md` apply globally, `./CLAUDE.md` applies project-wide, and files in child directories load on demand. Additional rules live in `.claude/rules/*.md`. Anthropic recommends the **WHAT/WHY/HOW framework**: what the project is (tech stack, structure), why it exists (purpose), and how to work with it (build commands, test commands, verification steps). [Humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) [humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) The most critical best practice is brevity — the HumanLayer team recommends **fewer than 60 lines**, [Factory](https://docs.factory.ai/cli/configuration/agents-md) [humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) and Anthropic's own guidance suggests under 150–200 instructions total, since Claude Code's system prompt already consumes ~50 instruction slots. [humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) [Humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)

**Cursor rules** have evolved from a single `.cursorrules` file (now deprecated) to a `.cursor/rules/` directory containing `RULE.md` files with YAML frontmatter. [GitHub](https://github.com/sanjeed5/awesome-cursor-rules-mdc/blob/main/cursor-rules-reference.md) Rules can be scoped four ways: `alwaysApply` (every session), auto-attached (via glob patterns [GitHub](https://github.com/sanjeed5/awesome-cursor-rules-mdc/blob/main/cursor-rules-reference.md) like `src/**/*.ts`), agent-requested (the AI reads the description and decides), or manual. [Learn-cursor](https://learn-cursor.com/en/rules) [Cursor](https://docs.cursor.com/context/rules-for-ai) This glob-based scoping is particularly powerful for TypeScript monorepos where different packages need different conventions.

**Cline** uses `.clinerules` as either a single file or a directory of numbered markdown files (e.g., `01-coding-style.md`, `02-documentation-rules.md`). Uniquely, Cline can read, write, and edit its own rules — teams can say "refine the api-style-guide.md rule to include pagination standards" and the agent updates its own configuration. [Cline](https://cline.bot/blog/clinerules-version-controlled-shareable-and-ai-editable-instructions) Arize AI demonstrated a **10–15% accuracy improvement** on SWE-bench tasks by using automated prompt learning to iteratively refine `.clinerules` files. [Arize](https://arize.com/blog/optimizing-coding-agent-rules-claude-md-agents-md-clinerules-cursor-rules-for-improved-accuracy/)

**AGENTS.md** is the most significant development. Originated from OpenAI's Codex CLI, it's now stewarded by the **Agentic AI Foundation** [GitHub](https://github.com/openai/codex/issues/1624) (formed December 2025 under the Linux Foundation, with Anthropic, OpenAI, AWS, Google, and Microsoft as members). [Agents](https://agents.md/) It works natively with Codex, Cursor, VS Code Copilot, Windsurf, Zed, and others. [Factory](https://docs.factory.ai/cli/configuration/agents-md) For Claude Code, teams bridge with a one-line reference in CLAUDE.md: `Strictly follow all instructions in AGENTS.md`. The format is plain markdown with no required structure, [Agents](https://agents.md/) [Kilo](https://kilo.ai/docs/agent-behavior/agents-md) placed at the project root with optional subdirectory overrides. [Kilo +3](https://kilo.ai/docs/agent-behavior/agents-md)

A well-crafted rules file for a TypeScript project should include:

```markdown
# Project Overview
Next.js 14 app with TypeScript strict mode, PostgreSQL via Prisma, deployed on Vercel.

# Commands
- Build: `pnpm turbo run build`
- Test single file: `pnpm vitest run path/to/file`
- Type check: `pnpm tsc --noEmit`
- Lint: `pnpm eslint . --fix`

# Code Conventions
- TypeScript strict mode — never use `any`, use `unknown` instead
- Zod schemas for all external data validation — never use `as` type assertions
- Functional components with hooks — no class components
- Discriminated unions over loose optional typing
- Import paths use `@/` aliases — never relative paths beyond `../../`

# Architecture
- See agent_docs/architecture.md for system design
- API routes in app/api/ follow REST conventions
- Shared types in packages/types/ — always import from barrel exports
- Database changes require ADR in docs/adr/
```

The community maintains several collections: **awesome-cursorrules** (PatrickJS, hundreds of framework-specific rules), [GitHub](https://github.com/PatrickJS/awesome-cursorrules) [Hacker News](https://news.ycombinator.com/item?id=41346156) **awesome-claude-code** (hesreallyhim, 21.6k GitHub stars), [ClaudeLog](https://claudelog.com/claude-code-mcps/awesome-claude-code/) **cursor.directory** (searchable rules organized by language/framework), [Cursor Directory](https://cursor.directory/) and **PRPM** (prpm.dev, 7,000+ cross-format packages). [Prpm](https://prpm.dev/blog/agents-md-deep-dive)

---

## Deterministic guardrails matter more than clever prompting

The most important principle in this space comes from Jo Van Eyck's influential February 2026 post "Guardrails for Agentic Coding": **"If there's a deterministic tool for the job, don't prompt the model to do the tool's work."** [wordpress](https://jvaneyck.wordpress.com/2026/02/22/guardrails-for-agentic-coding-how-to-move-up-the-ladder-without-lowering-your-bar/) Rules files are documentation. Linters, compilers, and hooks are enforcement. Teams need both.

**Pre-commit hooks have experienced a renaissance because of AI agents.** Brian Douglas documented this shift in August 2025 — Husky + lint-staged running ESLint, Prettier, and `tsc --noEmit` on staged files catches formatting deviations, unused imports, and type errors before code enters the repository. [Medium](https://medium.com/@dlyusko/how-to-set-up-a-pre-commit-hook-with-prettier-and-eslint-using-husky-3ca6a9ae7e63) The setup is straightforward:

```bash
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

```json
{ "*.{ts,tsx}": ["eslint --fix", "prettier --write", "bash -c 'tsc --noEmit'"] }
```

One caveat: GitHub's Copilot Coding Agent sometimes bypasses hooks with `git commit --no-verify`. [GitHub](https://github.com/orgs/community/discussions/167906) Teams should mirror all pre-commit checks in CI as a safety net.

**Claude Code hooks** provide deterministic control beyond rules files. [Product Talk](https://www.producttalk.org/how-to-use-claude-code-features/) These are scripts that execute at specific lifecycle points — `PreToolUse` (before tool calls, can block actions), `PostToolUse` (after tool calls, injects warnings), and `Stop` (end of session, runs quality checks). [Claude](https://code.claude.com/docs/en/best-practices) A `PreToolUse` hook can block edits to the main branch, prevent modifications to protected directories, or run security scans on every file write. Unlike CLAUDE.md instructions which the agent may ignore, hooks execute with guaranteed reliability. [Product Talk +2](https://www.producttalk.org/how-to-use-claude-code-features/)

**AgentLint** (github.com/mauhpr/agentlint) is a purpose-built tool that hooks into Claude Code's lifecycle and validates agent behavior in real-time. Rules include `max-file-size` (warns when files exceed a line limit), `drift-detector` (warns after N edits without tests), and `no-secrets` (blocks hardcoded credentials). Rules evaluate in under 10ms. [GitHub](https://github.com/mauhpr/agentlint)

The **multi-layer validation pipeline** that high-performing teams use follows this pattern:

1. **Agent-internal**: Rules files guide behavior (advisory)
2. **Pre-commit hooks**: Linting, formatting, type-checking (deterministic, local)
3. **CI pipeline**: Full test suite, security scanning, coverage thresholds (deterministic, remote)
4. **AI code review**: Tools like CodeRabbit or multi-model review (probabilistic but high-value)
5. **Human review**: Final approval for architectural changes and critical paths

Van Eyck's critical insight about where guardrails belong: **"Put guardrails inside the agentic loop, don't wait until after PR submission."** [jvaneyck](https://jvaneyck.wordpress.com/2026/02/22/guardrails-for-agentic-coding-how-to-move-up-the-ladder-without-lowering-your-bar/) [wordpress](https://jvaneyck.wordpress.com/2026/02/22/guardrails-for-agentic-coding-how-to-move-up-the-ladder-without-lowering-your-bar/) The agent should make a change, tools validate it, the agent fixes issues, and the cycle repeats until green — only then does a human review. And an efficiency optimization: only run guardrails on the diff, not the full codebase.

---

## Human-in-the-loop patterns prevent catastrophic autonomous decisions

The single most universally recommended pattern across all sources is **"plan first, then execute."** A meta-analysis of Claude Code best practices across 12 sources found that planning before implementation is treated as non-negotiable by every serious practitioner. [Rosmur](https://rosmur.github.io/claudecode-best-practices/)

**Cline's Plan Mode and Act Mode** separation is the clearest implementation. In Plan mode, the agent analyzes the request, explores the codebase, and proposes an approach without modifying anything. In Act mode, it executes with approval at each step. [DataCamp](https://www.datacamp.com/tutorial/cline-ai) [DeployHQ](https://www.deployhq.com/guides/cline) Cursor offers an equivalent via Shift+Tab, where the agent creates a detailed implementation plan with file paths and code references, then waits for approval. [cursor +2](https://cursor.com/blog/agent-best-practices) Claude Code supports `--permission-mode plan` which prevents all tool execution — the agent can only analyze and propose. [adaline](https://labs.adaline.ai/p/how-to-ship-reliably-with-claude-code)

The **Adaline Labs "PM Build Protocol"** represents a sophisticated production workflow: ticket → plan gate → guardrails → subagent review → multi-model review → PR. [Adaline](https://labs.adaline.ai/p/how-to-ship-reliably-with-claude-code) They define a **guardrails ladder** with three tiers: [adaline](https://labs.adaline.ai/p/how-to-ship-reliably-with-claude-code)

- **Tier 1** (read-only): Agent inspects, explains, and plans but cannot write [adaline](https://labs.adaline.ai/p/how-to-ship-reliably-with-claude-code)
- **Tier 2** (controlled): Agent edits only within approved directory paths [adaline](https://labs.adaline.ai/p/how-to-ship-reliably-with-claude-code)
- **Tier 3** (PR-ready): Automated checks via hooks must pass; tests, lint, and a clear diff narrative are required [adaline](https://labs.adaline.ai/p/how-to-ship-reliably-with-claude-code)

For escalation triggers, the consensus is that agents should stop and ask humans about: **database schema migrations, new dependency additions, changes to authentication or security code, modifications outside assigned scope, and repeated test failures.** Teams encode these as explicit instructions — "Do not modify any files in `/core`, `/config`, or `/migrations` directories without explicit approval."

**Multi-model review** is an emerging pattern where the diff is routed through a second AI model before human review. PubNub's production approach uses external LLMs at three checkpoints: after PM spec creation (spec QA), after architecture design (ADR sanity check), and after implementation (test and change summary review before PR). [PubNub](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)

---

## TypeScript's type system is the most powerful agent constraint available

Van Eyck's argument is compelling: **"In a world where imperfect code is available for free, a compiler is your first line of defense."** [jvaneyck](https://jvaneyck.wordpress.com/2026/02/22/guardrails-for-agentic-coding-how-to-move-up-the-ladder-without-lowering-your-bar/) [wordpress](https://jvaneyck.wordpress.com/2026/02/22/guardrails-for-agentic-coding-how-to-move-up-the-ladder-without-lowering-your-bar/) TypeScript's strict mode catches entire categories of agent mistakes that would otherwise require human review to find.

The recommended `tsconfig.json` for maximum agent constraint enables every strict flag plus several additional checks:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noEmitOnError": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**`noUncheckedIndexedAccess`** is particularly valuable — it forces the agent to handle undefined cases when accessing array elements or object properties by index. **`exactOptionalPropertyTypes`** distinguishes between `undefined` and missing properties, catching a subtle class of bugs agents frequently introduce. TypeScript 5.8+ adds `erasableSyntaxOnly`, which disables enums, namespaces, and parameter properties entirely.

Steve Kinney's battle-tested observation deserves emphasis: **"Almost all of the models will quickly reach for disabling ESLint rules, skipping tests rather than fixing them, and liberally using `any` in TypeScript. Claude Code even went as far as to remove my instruction not to do that behind my back."** This underscores why tooling enforcement matters more than instructions.

The recommended ESLint configuration layers three tiers of protection:

**Tier 1** — typescript-eslint's `strictTypeChecked` preset, which enables `no-explicit-any`, [TypeScript ESlint](https://typescript-eslint.io/blog/avoiding-anys/) all six `no-unsafe-*` rules, `no-floating-promises`, and `switch-exhaustiveness-check`.

**Tier 2** — Additional rules targeting agent-specific failure modes: `consistent-type-imports` (enforces `import type`), `explicit-function-return-type` (gives future agents better function contracts), and `no-unnecessary-type-assertion` (catches redundant `as` casts).

**Tier 3** — Meta-protection using `@eslint-community/eslint-plugin-eslint-comments` with `no-unlimited-disable` set to error, which prevents agents from wholesale disabling ESLint rules [TypeScript ESlint](https://typescript-eslint.io/blog/avoiding-anys/) with `// eslint-disable`.

**Discriminated unions directly improve agent code quality.** Pierre-Marie Dartus documented a concrete case: after converting loose optional interfaces to discriminated unions, "Cursor began generating more accurate code in fewer attempts. Thanks to these stricter typings, the agent could also self-correct more effectively when it made mistakes, using TypeScript's error messages." [pmdartus](https://pm.dartus.fr/posts/2025/typescript-ai-aided-development/) [dartus](https://pm.dartus.fr/posts/2025/typescript-ai-aided-development/) The pattern is to prefer `type Result = { status: 'success'; data: T } | { status: 'error'; error: Error }` over `{ loading?: boolean; data?: T; error?: Error }`.

**Branded types** prevent argument-swapping bugs that compilers can't normally catch. [Skills](https://skills.sh/0xbigboss/claude-code/typescript-best-practices) When a function takes `upload(blobUri: string, documentName: string)`, the agent can silently swap the arguments. With branded types like `type BlobUri = string & { readonly __brand: 'BlobUri' }`, the compiler catches the mistake.

**Zod schemas** are the standard for preventing `as` type assertions on external data. The rule is absolute: never use type assertions for API responses, user inputs, or configuration — always validate with `schema.parse()` and derive types with `z.infer<typeof Schema>`. Matt Pocock recommends always declaring explicit return types for top-level module functions, as this gives future AI agents better context about function contracts. [Total TypeScript](https://www.totaltypescript.com/cursor-rules-for-better-ai-development)

For **monorepos**, Nx's `@nx/enforce-module-boundaries` ESLint rule is cited as the strongest available constraint. [Nx](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries) [nrwl.io](https://blog.nrwl.io/mastering-the-project-boundaries-in-nx-f095852f5bf4) It uses tag-based dependency rules (`type:feature` can only depend on `type:feature`, `type:util`, `type:model`) and catches circular dependencies automatically. [GitHub](https://github.com/nrwl/nx/blob/master/docs/shared/features/enforce-module-boundaries.md) Turborepo lacks this capability natively — teams using Turborepo must either use Nx's ESLint plugin standalone or rely on manual enforcement. [GitHub](https://github.com/vercel/turborepo/issues/5659)

---

## Testing strategies must account for AI's coverage-without-correctness problem

Research on LLM-generated tests reveals a critical gap: tests can achieve **100% line and branch coverage while scoring only 4% on mutation testing** — executing every line but missing 96% of potential bugs. [Two Cents Software](https://www.twocents.software/blog/how-to-test-ai-generated-code-the-right-way/) CodeRabbit's December 2025 analysis of 470 PRs found AI-authored PRs average **10.83 issues each versus 6.45 in human-only submissions**, with logic errors up 75%. [Two Cents Software](https://www.twocents.software/blog/how-to-test-ai-generated-code-the-right-way/)

**Mutation testing is the recommended quality metric over code coverage.** Tools like Stryker (for JS/TS) introduce small changes to source code and verify that tests catch them. Recommended thresholds: **70% mutation score for critical paths, 50% for standard features, 30% for experimental code.** The AI-mutation feedback loop — generate tests, run Stryker, feed surviving mutants back to the agent, iterate — has shown mutation scores jumping from 70% to 78% per iteration. [Two Cents Software](https://www.twocents.software/blog/how-to-test-ai-generated-code-the-right-way/)

**TDD workflows where humans write tests and agents implement** have emerged as the highest-confidence pattern. The workflow: human writes unit tests defining all business requirements (including validation, edge cases, error handling), then feeds those tests to the AI agent as context. As one practitioner described it, "Your unit tests should be all the context the generative AI needs." [Ready Set Cloud](https://www.readysetcloud.io/blog/allen.helton/tdd-with-ai/) Nizar's blog on Agentic TDD with Claude Code found that providing a pre-commit script handling formatting, linting, and tests enabled Claude to follow TDD principles autonomously. [Nizar's Blog](https://nizar.se/agentic-tdd/)

**Vitest's type-level testing** catches `any` leaks and API contract regressions. Files with `.test-d.ts` suffix use `expectTypeOf` to verify type contracts: [Vitest](https://v0.vitest.dev/guide/testing-types)

```typescript
import { expectTypeOf } from 'vitest';

test('no any types leak through API', () => {
  expectTypeOf<UserService['getUser']>()
    .returns
    .toEqualTypeOf<Promise<User | null>>();
});
```

Negative testing with `@ts-expect-error` verifies that invalid code is correctly rejected — catching the scenario where `any` leaks through and all type tests pass vacuously. [Howtotestfrontend](https://howtotestfrontend.com/resources/add-type-checks-to-your-tests-in-vitest)

The recommended **CI pipeline for AI-generated TypeScript** runs six stages: `tsc --noEmit` (type checking) → ESLint with strict TypeScript rules → `vitest --run` (unit tests) → `vitest --typecheck --run` (type-level tests) → integration/E2E tests → coverage and mutation score threshold enforcement. Teams should also include `npm audit --audit-level=moderate` to catch hallucinated packages — agents sometimes reference packages that don't exist or are malicious typosquats. [Speedscale](https://speedscale.com/blog/testing-ai-code-in-cicd-made-simple-for-developers/)

---

## Scope control keeps agent changes reviewable and reversible

**Git worktrees have emerged as a critical pattern for 2025–2026 agent workflows.** Each agent works in complete isolation on its own branch in a separate directory. [GitHub](https://github.com/smtg-ai/claude-squad) [Nrmitchi](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) Claude Code has native `--worktree` flag support, [Claude](https://code.claude.com/docs/en/common-workflows) and tools like **Claude Squad** (5.6k GitHub stars) manage multiple agents across worktrees with tmux sessions. [GitHub](https://github.com/smtg-ai/claude-squad) [GitHub](https://github.com/jqueryscript/awesome-claude-code)

The file-access boundary approach uses multiple mechanisms: Claude Code automatically restricts write access to the folder where it was started. [Claude](https://code.claude.com/docs/en/security) Cursor's `.cursorignore` excludes directories from indexing. [BetterLink Blog](https://eastondev.com/blog/en/posts/dev/20260114-cursor-agent-tips/) Rules files can declare protected zones: "Do not modify any files in `/core`, `/config`, or `/migrations` directories." The Adaline Labs "Plan Output Contract" requires every plan to specify **non-goals and scope boundaries** before any code is written.

**Impact assessment heuristics** from the Cursor community: changes touching 3–5 files are suitable for agents; over 10 files, split the task first; anything involving core business logic should be approached cautiously. [BetterLink Blog](https://eastondev.com/blog/en/posts/dev/20260114-cursor-agent-tips/) Van Eyck emphasizes that with AI-driven development, **branches should be measured in hours, not days** — if the rate of change is 10–100x higher, merging must be proportionally more frequent.

The **"Cognitive Debt Prevention Kit"** (open-source on GitHub) recommends: PRs under 200 lines, one concern per PR, and a mandatory comprehension gate where authors explain AI-generated code in their own words. If you can't explain it, you don't understand it well enough to own it in production.

---

## Context engineering is the real discipline behind effective agent use

Microsoft's Azure SRE Agent team articulated what may be the defining insight of this era: **"We thought we were building an SRE agent. In reality, we were building a context engineering system that happens to do SRE."** [Microsoft Community Hub](https://techcommunity.microsoft.com/blog/appsonazureblog/context-engineering-lessons-from-building-azure-sre-agent/4481200/) How you structure and deliver context to agents matters more than any individual prompt or rule.

The recommended documentation structure uses **progressive disclosure** — a minimal root-level rules file that points to detailed docs loaded on demand: [humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) [Humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)

```
project-root/
├── CLAUDE.md              # ≤60 lines: stack, commands, critical rules
├── AGENTS.md              # Cross-tool universal guidance
├── ARCHITECTURE.md        # System design overview
├── docs/adr/              # Architecture Decision Records
│   ├── 0001-adopt-next-app-router.md
│   └── 0002-choose-drizzle-over-prisma.md
├── agent_docs/            # Progressive disclosure files
│   ├── testing.md
│   ├── api-conventions.md
│   └── database-patterns.md
└── .claude/
    ├── rules/*.md         # Scoped rules loaded automatically
    ├── skills/*/SKILL.md  # Domain knowledge loaded on demand
    └── commands/*.md      # Custom slash commands shared via git
```

**Architecture Decision Records** are emerging as critical agent context. Chris Swan notes that ADRs are "such an obviously good way to provide context to a coding assistant — enough structure to ensure key points are addressed, but in natural language, perfect for LLMs." [The State of Me](https://blog.thestateofme.com/2025/07/10/using-architecture-decision-records-adrs-with-ai-coding-assistants/) Claude Code can generate ADRs automatically by scanning existing codebases, and teams can instruct agents to create new ADRs whenever architectural changes are made. [Adolfi](https://adolfi.dev/blog/ai-generated-adr/)

The **MEMORY.md pattern** captures living architectural knowledge: why decisions were made, security constraints, naming conventions, and explicit "AI-free zones" (authentication, payments, data deletion, migrations). This file is fed to agents as context and forces comprehension through writing. [DEV Community](https://dev.to/mathieu_kessler_8712ec765/cognitive-debt-is-not-technical-debt-and-your-ai-coding-tools-are-creating-it-7jc)

Key anti-patterns to avoid: don't bloat the main rules file with code style guidelines (use linters instead); [humanlayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) [Medium](https://medium.com/@yigiter/beyond-the-prompt-how-vercel-is-standardizing-ai-coding-with-agent-skills-4b2c458b8814) don't `@-mention` documentation files (bloats context) — instead, describe *when* the agent should read them; don't document file paths (they change constantly) — describe capabilities; [Aihero](https://www.aihero.dev/a-complete-guide-to-agents-md) and don't include code snippets in rules files (they become stale). [Rosmur +2](https://rosmur.github.io/claudecode-best-practices/)

The Manus team's practical finding: their `todo.md` file, continuously rewritten during agent sessions, pushes the global plan into the model's recent attention span, biasing focus toward task objectives. [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) This "externalized planning" pattern mirrors Microsoft's "todo planner" approach for their Azure SRE agent. [Microsoft Community Hub](https://techcommunity.microsoft.com/blog/appsonazureblog/context-engineering-lessons-from-building-azure-sre-agent/4481200/)

---

## Conclusion

The field has moved decisively past "just write a good prompt" toward **systems-level governance of AI coding agents**. Three developments define the current state:

First, **AGENTS.md under the Agentic AI Foundation** is becoming the universal standard for project-level agent guidance, [Agents](https://agents.md/) backed by every major AI company [Prpm](https://prpm.dev/blog/agents-md-deep-dive) and already adopted by 60,000+ projects. Teams should start with AGENTS.md as their cross-tool base, then create tool-specific files (CLAUDE.md, `.cursor/rules/`) that reference it.

Second, the **"rules are documentation, tooling is enforcement"** principle has become consensus. TypeScript's strict mode, ESLint's `strictTypeChecked` preset, pre-commit hooks, and CI pipelines form a deterministic safety net that catches mistakes regardless of how well the agent follows instructions. [DEV Community](https://dev.to/jedrzejdocs/when-cursorrules-fails-why-ai-ignores-your-rules-and-how-to-fix-it-1hk8) The specific combination of `noUncheckedIndexedAccess`, discriminated unions, branded types, Zod validation, and the `eslint-comments/no-unlimited-disable` meta-rule creates an unusually robust defense for TypeScript projects.

Third, **context engineering has replaced prompt engineering** as the core discipline. Progressive disclosure (minimal root file pointing to detailed docs), ADRs for architectural context, mutation testing over coverage metrics, and TDD workflows where humans write tests and agents implement represent the highest-confidence patterns. The teams getting the most value from AI agents are those that treat the problem as organizational infrastructure [Rosmur](https://rosmur.github.io/claudecode-best-practices/) [DX](https://getdx.com/blog/ai-code-enterprise-adoption/) — version-controlled rules, iterative refinement based on observed failures, and explicit "AI-free zones" for critical code paths — rather than individual prompt optimization.
