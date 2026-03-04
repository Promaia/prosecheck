import { z } from 'zod';

// --- Sub-schemas ---

export const LastRunSchema = z
  .object({
    read: z
      .boolean()
      .default(false)
      .describe(
        'Read the last-run hash to skip already-checked commits. Default: off for interactive, on for CI.',
      ),
    write: z
      .boolean()
      .default(true)
      .describe(
        'Write the current hash after a run for future incremental checks. Default: on for interactive, off for CI.',
      ),
  })
  .describe('Incremental run tracking via .prosecheck/last-user-run');

export const ClaudeCodeSchema = z
  .object({
    singleInstance: z
      .boolean()
      .default(false)
      .describe(
        'Launch one Claude Code instance with a combined prompt instead of one instance per rule.',
      ),
    agentTeams: z
      .boolean()
      .default(true)
      .describe(
        'Enable agent teams support. When true, the orchestration prompt instructs the agent to launch sub-agents for each rule, and sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.',
      ),
  })
  .describe('Claude Code Headless mode settings');

export const CalculatorConfigSchema = z
  .object({
    name: z.string().describe('Calculator name (e.g., "rules-md", "adr")'),
    enabled: z
      .boolean()
      .default(true)
      .describe('Whether this calculator is active'),
    options: z
      .record(z.string(), z.unknown())
      .default({})
      .describe('Calculator-specific options'),
  })
  .describe('Configuration for a rule calculator');

export const EnvironmentOverrideSchema = z
  .object({
    lastRun: z
      .object({
        read: z.boolean().optional(),
        write: z.boolean().optional(),
      })
      .optional(),
    timeout: z.number().positive().optional(),
    warnAsError: z.boolean().optional(),
    retryDropped: z.boolean().optional(),
    retryDroppedMaxAttempts: z.number().int().nonnegative().optional(),
    claudeCode: z
      .object({
        singleInstance: z.boolean().optional(),
        agentTeams: z.boolean().optional(),
      })
      .optional(),
    postRun: z.array(z.string()).optional(),
  })
  .describe('Per-environment config overrides');

// --- Main config schema ---

export const ConfigSchema = z
  .object({
    baseBranch: z
      .string()
      .default('main')
      .describe('Git branch to diff against for change detection'),
    globalIgnore: z
      .array(z.string())
      .default([
        '.git/',
        'node_modules/',
        'dist/',
        'build/',
        '.prosecheck/working/',
      ])
      .describe(
        'Gitignore-format patterns applied to all rules. Matching files are never considered changed.',
      ),
    additionalIgnore: z
      .array(z.string())
      .default(['.gitignore'])
      .describe(
        'External ignore files whose patterns are merged into the global ignore set.',
      ),
    lastRun: LastRunSchema.default(() => ({ read: false, write: true })),
    timeout: z
      .number()
      .positive()
      .default(300)
      .describe('Per-run timeout in seconds'),
    warnAsError: z
      .boolean()
      .default(false)
      .describe('Treat warnings as failures for exit code purposes'),
    retryDropped: z
      .boolean()
      .default(false)
      .describe('Automatically retry rules that produce no output'),
    retryDroppedMaxAttempts: z
      .number()
      .int()
      .nonnegative()
      .default(1)
      .describe('Max retry attempts per dropped rule'),
    claudeCode: ClaudeCodeSchema.default(() => ({ singleInstance: false, agentTeams: true })),
    postRun: z
      .array(z.string())
      .default([])
      .describe('Shell commands to run after results are collected'),
    environments: z
      .record(z.string(), EnvironmentOverrideSchema)
      .default(() => ({
        ci: {
          lastRun: { read: true, write: false },
          warnAsError: true,
        },
        interactive: {
          lastRun: { read: false, write: true },
        },
      }))
      .describe('Named environment overrides selected via --env'),
    ruleCalculators: z
      .array(CalculatorConfigSchema)
      .default([])
      .describe('Pluggable rule calculator definitions'),
  })
  .describe('Prosecheck configuration');

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Partial config type for overlay layers (config.local.json, CLI overrides).
 * Overlays are plain objects deep-merged onto the validated base config.
 */
export type PartialConfig = {
  [K in keyof Config]?: Config[K] extends Array<unknown>
    ? Config[K]
    : Config[K] extends Record<string, unknown>
      ? Partial<Config[K]>
      : Config[K];
};

// --- Agent output schemas ---

const RuleResultCommentSchema = z.object({
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

const PassResultSchema = z.object({
  status: z.literal('pass'),
  rule: z.string(),
  source: z.string(),
  comment: z.string().optional(),
});

const WarnResultSchema = z.object({
  status: z.literal('warn'),
  rule: z.string(),
  source: z.string(),
  headline: z.string(),
  comments: z.array(RuleResultCommentSchema).nonempty(),
});

const FailResultSchema = z.object({
  status: z.literal('fail'),
  rule: z.string(),
  source: z.string(),
  headline: z.string(),
  comments: z.array(RuleResultCommentSchema).nonempty(),
});

export const RuleResultSchema = z.discriminatedUnion('status', [
  PassResultSchema,
  WarnResultSchema,
  FailResultSchema,
]);

export type RuleResult = z.infer<typeof RuleResultSchema>;
