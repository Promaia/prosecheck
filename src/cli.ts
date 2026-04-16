import { createRequire } from 'node:module';
import { Command, InvalidArgumentError } from 'commander';
import { lint } from './commands/lint.js';
import { init } from './commands/init.js';
import { config } from './commands/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

function parseBool(value: string): boolean {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new InvalidArgumentError('Expected 0, 1, true, or false.');
}

const program = new Command();

program
  .name('prosecheck')
  .description(
    'LLM-powered code linter with natural-language rules.\n♥ by the Promaia team',
  )
  .version(pkg.version);

program
  .command('lint')
  .description('Run prosecheck against the current project')
  .option('--env <environment>', 'Environment name (ci, interactive)')
  .option('--mode <mode>', 'Operating mode (claude-code, user-prompt)')
  .option('--format <format>', 'Output format (stylish, json, sarif)')
  .option('--ref <ref>', 'Git comparison ref override')
  .option(
    '--timeout <seconds>',
    'Hard total timeout in seconds (caps the dynamic run timeout)',
    parseFloat,
  )
  .option(
    '--warn-as-error <bool>',
    'Treat warnings as errors (0 or 1)',
    parseBool,
  )
  .option(
    '--retry-dropped <bool>',
    'Retry rules that produce no output (0 or 1)',
    parseBool,
  )
  .option(
    '--last-run-read <bool>',
    'Read last-run hash for incremental narrowing (0 or 1)',
    parseBool,
  )
  .option(
    '--last-run-write <bool>',
    'Write current HEAD as last-run hash (0 or 1)',
    parseBool,
  )
  .option(
    '--last-run-files <bool>',
    'Include per-file content hashes in last-run file (0 or 1)',
    parseBool,
  )
  .option(
    '--hash-check',
    'Check if in-scope files changed since last run (no agents, no API key)',
  )
  .option(
    '--hash-check-write',
    'Update stored hashes without running agents (mark current state as checked)',
  )
  .option(
    '--claude-to-rule-shape <shape>',
    'How rules are dispatched (one-to-one, one-to-many-teams, one-to-many-single)',
  )
  .option(
    '--max-concurrent-agents <count>',
    'Maximum concurrent agents (0 = unlimited)',
    parseInt,
  )
  .option(
    '--max-turns <turns>',
    'Maximum agentic turns per Claude invocation',
    parseInt,
  )
  .option(
    '--allowed-tools <tools>',
    'Comma-separated list of allowed tools for Claude',
  )
  .option('--output <file>', 'Write output to a file (in addition to stdout)')
  .option(
    '--rules <rules>',
    'Comma-separated list of rule names or IDs to run (disables last-run-hash write)',
  )
  .option(
    '--debug',
    'Stream per-agent stdout/stderr to .prosecheck/working/logs/ for debugging',
  )
  .action(
    async (options: {
      env?: string;
      mode?: string;
      format?: string;
      ref?: string;
      timeout?: number;
      warnAsError?: boolean;
      retryDropped?: boolean;
      lastRunRead?: boolean;
      lastRunWrite?: boolean;
      lastRunFiles?: boolean;
      hashCheck?: boolean;
      hashCheckWrite?: boolean;
      claudeToRuleShape?: string;
      maxConcurrentAgents?: number;
      maxTurns?: number;
      allowedTools?: string;
      output?: string;
      rules?: string;
      debug?: boolean;
    }) => {
      await lint({
        projectRoot: process.cwd(),
        env: options.env,
        mode: options.mode,
        format: options.format,
        ref: options.ref,
        timeout: options.timeout,
        warnAsError: options.warnAsError,
        retryDropped: options.retryDropped,
        lastRunRead: options.lastRunRead,
        lastRunWrite: options.lastRunWrite,
        lastRunFiles: options.lastRunFiles,
        hashCheck: options.hashCheck,
        hashCheckWrite: options.hashCheckWrite,
        claudeToRuleShape: options.claudeToRuleShape,
        maxConcurrentAgents: options.maxConcurrentAgents,
        maxTurns: options.maxTurns,
        allowedTools: options.allowedTools,
        output: options.output,
        rules: options.rules,
        debug: options.debug,
      });
    },
  );

program
  .command('init')
  .description('Initialize prosecheck in the current project')
  .option('--rules', 'Create a starter RULES.md file')
  .option('--github-actions', 'Generate a full-check GitHub Actions workflow')
  .option(
    '--github-actions-incremental',
    'Generate incremental GitHub Actions workflows (PR + merge queue)',
  )
  .option(
    '--github-actions-hash-check',
    'Generate a hash-check GitHub Actions workflow (zero token cost)',
  )
  .option('--git-pre-push', 'Install a git pre-push hook')
  .option(
    '--claude-stop-hook',
    'Add a Claude Code Stop hook that runs prosecheck after responses',
  )
  .option(
    '--sarif <bool>',
    'Include SARIF upload in generated workflows (default: true)',
    parseBool,
  )
  .action(
    async (options: {
      rules?: boolean;
      githubActions?: boolean;
      githubActionsIncremental?: boolean;
      githubActionsHashCheck?: boolean;
      gitPrePush?: boolean;
      claudeStopHook?: boolean;
      sarif?: boolean;
    }) => {
      await init({
        projectRoot: process.cwd(),
        createRules: options.rules ?? false,
        githubActions: options.githubActions ?? false,
        githubActionsIncremental: options.githubActionsIncremental ?? false,
        githubActionsHashCheck: options.githubActionsHashCheck ?? false,
        gitPrePush: options.gitPrePush ?? false,
        claudeStopHook: options.claudeStopHook ?? false,
        sarif: options.sarif,
      });
    },
  );

const configCmd = program
  .command('config')
  .description('View or modify prosecheck configuration');

configCmd
  .command('list')
  .description('List all configuration fields with current values')
  .action(async () => {
    await config({
      projectRoot: process.cwd(),
      action: 'list',
      args: [],
    });
  });

configCmd
  .command('set <entries...>')
  .description('Set configuration values (key=value format)')
  .action(async (entries: string[]) => {
    await config({
      projectRoot: process.cwd(),
      action: 'set',
      args: entries,
    });
  });

program.parse();
