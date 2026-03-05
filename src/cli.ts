import { Command, InvalidArgumentError } from 'commander';
import { lint } from './commands/lint.js';
import { init } from './commands/init.js';
import { config } from './commands/config.js';

function parseBool(value: string): boolean {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new InvalidArgumentError('Expected 0, 1, true, or false.');
}

const program = new Command();

program
  .name('prosecheck')
  .description('LLM-powered code linter with natural-language rules')
  .version('0.0.1');

program
  .command('lint')
  .description('Run prosecheck against the current project')
  .option('--env <environment>', 'Environment name (ci, interactive)')
  .option('--mode <mode>', 'Operating mode (claude-code, user-prompt)')
  .option('--format <format>', 'Output format (stylish, json, sarif)')
  .option('--ref <ref>', 'Git comparison ref override')
  .option('--timeout <seconds>', 'Timeout in seconds', parseFloat)
  .option('--warn-as-error <bool>', 'Treat warnings as errors (0 or 1)', parseBool)
  .option('--retry-dropped <bool>', 'Retry rules that produce no output (0 or 1)', parseBool)
  .option('--last-run-read <bool>', 'Read last-run hash for incremental narrowing (0 or 1)', parseBool)
  .option('--last-run-write <bool>', 'Write current HEAD as last-run hash (0 or 1)', parseBool)
  .option('--agent-teams <bool>', 'Enable agent teams for parallel rule processing (0 or 1)', parseBool)
  .option(
    '--max-turns <turns>',
    'Maximum agentic turns per Claude invocation',
    parseInt,
  )
  .option(
    '--allowed-tools <tools>',
    'Comma-separated list of allowed tools for Claude',
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
      agentTeams?: boolean;
      maxTurns?: number;
      allowedTools?: string;
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
        agentTeams: options.agentTeams,
        maxTurns: options.maxTurns,
        allowedTools: options.allowedTools,
      });
    },
  );

program
  .command('init')
  .description('Initialize prosecheck in the current project')
  .option('--rules', 'Create a starter RULES.md file')
  .action(async (options: { rules?: boolean }) => {
    await init({
      projectRoot: process.cwd(),
      createRules: options.rules ?? false,
    });
  });

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
