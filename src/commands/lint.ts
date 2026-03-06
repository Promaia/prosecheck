import { loadConfig, resolveEnvironment, ConfigError } from '../lib/config.js';
import type { PartialConfig } from '../lib/config-schema.js';
import { runEngine } from '../lib/engine.js';
import type { RunContext } from '../types/index.js';
import type { InteractiveUI } from '../ui/render.js';

export interface LintOptions {
  /** Project root directory */
  projectRoot: string;
  /** Environment name (from --env flag) */
  env?: string | undefined;
  /** Operating mode (from --mode flag) */
  mode?: string | undefined;
  /** Output format (from --format flag) */
  format?: string | undefined;
  /** Git comparison ref override */
  ref?: string | undefined;
  /** Override warnAsError config */
  warnAsError?: boolean | undefined;
  /** Override retryDropped config */
  retryDropped?: boolean | undefined;
  /** Override lastRun.read config */
  lastRunRead?: boolean | undefined;
  /** Override lastRun.write config */
  lastRunWrite?: boolean | undefined;
  /** Override timeout config */
  timeout?: number | undefined;
  /** Override claudeToRuleShape config */
  claudeToRuleShape?: string | undefined;
  /** Override maxConcurrentAgents config */
  maxConcurrentAgents?: number | undefined;
  /** Override maxTurns config */
  maxTurns?: number | undefined;
  /** Override allowedTools config (comma-separated string from CLI) */
  allowedTools?: string | undefined;
}

/**
 * Execute the lint command.
 *
 * Parses options, loads config, constructs RunContext, invokes the engine,
 * and sets the exit code based on overall status.
 */
export async function lint(options: LintOptions): Promise<void> {
  const { projectRoot } = options;
  let interactiveUI: InteractiveUI | undefined;

  try {
    // Resolve environment
    const environment = resolveEnvironment(options.env);

    // Build CLI overrides from flags
    const cliOverrides: Record<string, unknown> = {};
    if (options.warnAsError !== undefined) {
      cliOverrides['warnAsError'] = options.warnAsError;
    }
    if (options.retryDropped !== undefined) {
      cliOverrides['retryDropped'] = options.retryDropped;
    }
    if (options.timeout !== undefined) {
      cliOverrides['timeout'] = options.timeout;
    }
    if (
      options.lastRunRead !== undefined ||
      options.lastRunWrite !== undefined
    ) {
      const lastRun: Record<string, unknown> = {};
      if (options.lastRunRead !== undefined) {
        lastRun['read'] = options.lastRunRead;
      }
      if (options.lastRunWrite !== undefined) {
        lastRun['write'] = options.lastRunWrite;
      }
      cliOverrides['lastRun'] = lastRun;
    }
    if (options.claudeToRuleShape !== undefined) {
      cliOverrides['claudeCode'] = {
        ...(cliOverrides['claudeCode'] as Record<string, unknown> | undefined),
        claudeToRuleShape: options.claudeToRuleShape,
      };
    }
    if (options.maxConcurrentAgents !== undefined) {
      cliOverrides['claudeCode'] = {
        ...(cliOverrides['claudeCode'] as Record<string, unknown> | undefined),
        maxConcurrentAgents: options.maxConcurrentAgents,
      };
    }
    if (options.maxTurns !== undefined) {
      cliOverrides['claudeCode'] = {
        ...(cliOverrides['claudeCode'] as Record<string, unknown> | undefined),
        maxTurns: options.maxTurns,
      };
    }
    if (options.allowedTools !== undefined) {
      cliOverrides['claudeCode'] = {
        ...(cliOverrides['claudeCode'] as Record<string, unknown> | undefined),
        allowedTools: options.allowedTools.split(',').map((t) => t.trim()),
      };
    }

    // Load config with CLI overrides
    const hasCliOverrides = Object.keys(cliOverrides).length > 0;
    const { config } = hasCliOverrides
      ? await loadConfig({
          projectRoot,
          env: environment,
          cliOverrides: cliOverrides as PartialConfig,
        })
      : await loadConfig({ projectRoot, env: environment });

    // Determine mode and format
    const mode = options.mode ?? 'claude-code';
    const format = options.format ?? 'stylish';

    // Start interactive UI if applicable (lazy import to avoid loading Ink for non-interactive paths)
    if (format === 'stylish' && process.stdout.isTTY) {
      const { startInteractiveUI } = await import('../ui/render.js');
      interactiveUI = startInteractiveUI();
    }

    // Construct run context
    const context: RunContext = {
      config,
      environment,
      mode,
      format,
      projectRoot,
      comparisonRef: options.ref ?? '',
      onProgress: interactiveUI?.onProgress,
    };

    // Run the engine
    const result = await runEngine(context);

    // Output results
    if (interactiveUI) {
      interactiveUI.finish(result.results);
      // Print full details after the interactive summary
      if (result.output) {
        process.stdout.write('\n' + result.output + '\n');
      }
    } else if (result.output) {
      process.stdout.write(result.output + '\n');
    }

    // Set exit code based on status
    switch (result.overallStatus) {
      case 'fail':
        process.exitCode = 1;
        break;
      case 'dropped':
        process.exitCode = 1;
        break;
      case 'warn':
        // warn is only exit 0 (unless warnAsError promoted it to fail above)
        process.exitCode = 0;
        break;
      default:
        process.exitCode = 0;
    }
  } catch (error: unknown) {
    interactiveUI?.cleanup();

    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }

    if (error instanceof Error) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }

    process.stderr.write('An unexpected error occurred\n');
    process.exitCode = 2;
  }
}
