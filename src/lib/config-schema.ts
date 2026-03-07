import { z } from 'zod';

// --- Sub-schemas ---

export const LastRunSchema = z
  .object({
    read: z
      .boolean()
      .default(false)
      .describe(
        'Read the last-run hash to skip already-checked commits. Off by default; enable via environment overrides or CLI flags.',
      ),
    write: z
      .boolean()
      .default(false)
      .describe(
        'Write the current hash after a run for future incremental checks. Off by default; enable via environment overrides or CLI flags.',
      ),
    files: z
      .boolean()
      .default(false)
      .describe(
        'Include per-file content hashes in the last-run file. Enables precise diff reporting in hash-check mode and files-based change detection.',
      ),
  })
  .describe('Incremental run tracking via .prosecheck/last-user-run');

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git diff *)',
  'Bash(git log *)',
  'Bash(git show *)',
  'Bash(cat *)',
  'Bash(find *)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(wc *)',
  'Bash(ls *)',
  'WebFetch',
  'WebSearch',
  'Task',
  'TaskOutput',
  'TaskStop',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
];

const DEFAULT_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'Write',
  'WebFetch',
  'WebSearch',
  'Task',
  'TaskOutput',
  'TaskStop',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
];

export const ClaudeCodeSchema = z
  .object({
    claudeToRuleShape: z
      .enum(['one-to-one', 'one-to-many-teams', 'one-to-many-single'])
      .default('one-to-many-teams')
      .describe(
        'How ungrouped rules are dispatched to Claude processes. ' +
          '"one-to-one": one process per rule. ' +
          '"one-to-many-teams": rules packed into team invocations with parallel sub-agents. ' +
          '"one-to-many-single": all rules in one process, evaluated sequentially.',
      ),
    maxConcurrentAgents: z
      .number()
      .int()
      .nonnegative()
      .default(10)
      .describe(
        'Maximum concurrent agents (processes or sub-agents). 0 = unlimited.',
      ),
    maxTurns: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe('Maximum number of agentic turns per Claude CLI invocation.'),
    allowedTools: z
      .array(z.string())
      .default(DEFAULT_ALLOWED_TOOLS)
      .describe(
        'Tools the Claude CLI agent is allowed to use. Passed as --allowedTools.',
      ),
    tools: z
      .array(z.string())
      .default(DEFAULT_TOOLS)
      .describe(
        'Tools available to the Claude CLI agent. Passed as --tools. Controls which tools the agent can see and invoke.',
      ),
    additionalArgs: z
      .array(z.string())
      .default([])
      .describe('Additional CLI arguments passed to each claude invocation.'),
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
        files: z.boolean().optional(),
      })
      .optional(),
    timeout: z.number().positive().optional(),
    warnAsError: z.boolean().optional(),
    retryDropped: z.boolean().optional(),
    retryDroppedMaxAttempts: z.number().int().nonnegative().optional(),
    claudeCode: z
      .object({
        claudeToRuleShape: z
          .enum(['one-to-one', 'one-to-many-teams', 'one-to-many-single'])
          .optional(),
        maxConcurrentAgents: z.number().int().nonnegative().optional(),
        maxTurns: z.number().int().positive().optional(),
        allowedTools: z.array(z.string()).optional(),
        additionalArgs: z.array(z.string()).optional(),
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
      .default(['.git/', 'node_modules/', 'dist/', 'build/', '.prosecheck/'])
      .describe(
        'Gitignore-format patterns applied to all rules. Matching files are never considered changed.',
      ),
    additionalIgnore: z
      .array(z.string())
      .default(['.gitignore'])
      .describe(
        'External ignore files whose patterns are merged into the global ignore set.',
      ),
    lastRun: LastRunSchema.default(() => ({
      read: false,
      write: false,
      files: false,
    })),
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
    claudeCode: ClaudeCodeSchema.default(() => ({
      claudeToRuleShape: 'one-to-many-teams' as const,
      maxConcurrentAgents: 10,
      maxTurns: 30,
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      tools: DEFAULT_TOOLS,
      additionalArgs: [],
    })),
    postRun: z
      .array(z.string())
      .default([])
      .describe('Shell commands to run after results are collected'),
    environments: z
      .record(z.string(), EnvironmentOverrideSchema)
      .default(() => ({
        ci: {
          warnAsError: true,
        },
        interactive: {},
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
