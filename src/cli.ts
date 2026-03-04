import { Command } from 'commander';
import { lint } from './commands/lint.js';
import { init } from './commands/init.js';

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
  .option('--warn-as-error', 'Treat warnings as errors')
  .option('--no-warn-as-error', 'Do not treat warnings as errors')
  .option('--retry-dropped', 'Retry rules that produce no output')
  .option('--no-retry-dropped', 'Do not retry dropped rules')
  .option('--last-run-read', 'Read last-run hash for incremental narrowing')
  .option('--no-last-run-read', 'Do not read last-run hash')
  .option('--last-run-write', 'Write current HEAD as last-run hash')
  .option('--no-last-run-write', 'Do not write last-run hash')
  .option('--agent-teams', 'Enable agent teams for parallel rule processing')
  .option('--no-agent-teams', 'Disable agent teams')
  .action(async (options: {
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
    });
  });

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

program.parse();
