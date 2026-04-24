import { writeFileSync } from 'node:fs';
import { loadConfig, resolveEnvironment, ConfigError } from '../lib/config.js';
import type { PartialConfig } from '../lib/config-schema.js';
import { runEngine, UnknownRuleFilterError } from '../lib/engine.js';
import { buildOutputHints } from '../lib/output-hints.js';
import {
  acquireRunlock,
  RunlockHeldError,
  type Runlock,
} from '../lib/runlock.js';
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
  /** Run in hash-check mode (no agents, just compare file hashes) */
  hashCheck?: boolean | undefined;
  /** Update stored hashes without running agents */
  hashCheckWrite?: boolean | undefined;
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
  /** Write output to a file instead of (in addition to) stdout */
  output?: string | undefined;
  /** Comma-separated rule names or IDs to filter to (disables last-run-hash write) */
  rules?: string | undefined;
  /** When true, unrecognized --rules entries warn and continue instead of exiting 2 */
  rulesAllowMissing?: boolean | undefined;
  /** Bypass the runlock check (use when certain no other prosecheck is active) */
  force?: boolean | undefined;
  /** Enable per-agent log streaming to .prosecheck/working/logs/ */
  debug?: boolean | undefined;
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
  let runlock: Runlock | undefined;

  try {
    runlock = await acquireRunlock(projectRoot, {
      force: options.force,
      onStale: (info) => {
        process.stderr.write(
          `[prosecheck] Warning: reclaiming stale runlock from dead pid ${String(info.pid)} (started ${info.startedAt}).\n`,
        );
      },
    });

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
      cliOverrides['hardTotalTimeout'] = options.timeout;
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
      hashCheck: options.hashCheck,
      hashCheckWrite: options.hashCheckWrite,
      ruleFilter: options.rules
        ? options.rules
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
        : undefined,
      rulesAllowMissing: options.rulesAllowMissing,
      onProgress: interactiveUI?.onProgress,
      debug: options.debug,
    };
    // NB: `options.force` is handled by `acquireRunlock` above, not threaded
    // through RunContext (the engine itself does not care about runlocks).

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

    // Write to output file if requested
    if (options.output && result.output) {
      writeFileSync(options.output, result.output + '\n');
    }

    // Emit trailing hints to stdout (stylish format only — keeps json/sarif
    // stdout clean). Placed AFTER the summary so `tail -N` catches them even
    // when callers truncate per-rule lines.
    const hints = buildOutputHints({
      outputPath: options.output,
      format,
      results: result.results,
    });
    if (hints.length > 0) {
      process.stdout.write(hints.join('\n') + '\n');
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

    if (error instanceof RunlockHeldError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }

    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }

    if (error instanceof UnknownRuleFilterError) {
      process.stderr.write(`${error.message}\n\n`);
      process.stderr.write('Available rules:\n');
      for (const rule of error.available) {
        process.stderr.write(`  - ${rule.name}  (id: ${rule.id})\n`);
      }
      process.stderr.write(
        '\nRun `prosecheck list-rules` to see the same list with sources and scopes.\n',
      );
      process.stderr.write(
        'Pass --rules-allow-missing to warn-and-continue instead of erroring.\n',
      );
      process.exitCode = 2;
      return;
    }

    if (error instanceof Error) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }

    process.stderr.write(
      `Unexpected error: ${String(error)}\nRun with PROSECHECK_VERBOSE=1 for more details.\n`,
    );
    process.exitCode = 2;
  } finally {
    if (runlock !== undefined) {
      await runlock.release();
    }
  }
}
