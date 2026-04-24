import pc from 'picocolors';
import { loadConfig, resolveEnvironment, ConfigError } from '../lib/config.js';
import { runCalculators } from '../lib/calculators/index.js';
import type { Rule } from '../types/index.js';

export interface ListRulesOptions {
  /** Project root directory */
  projectRoot: string;
  /** Environment name (from --env flag) */
  env?: string | undefined;
  /** Emit JSON instead of the human-readable table */
  json?: boolean | undefined;
}

/**
 * Discover all rules and print them. Purpose: let agentic callers learn the
 * exact rule names and ids before using `--rules` so they don't waste an
 * invocation on a misspelled filter.
 */
export async function listRules(options: ListRulesOptions): Promise<void> {
  try {
    const environment = resolveEnvironment(options.env);
    const { config } = await loadConfig({
      projectRoot: options.projectRoot,
      env: environment,
    });
    const rules = await runCalculators(options.projectRoot, config);

    if (options.json) {
      const payload = rules.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        inclusions: r.inclusions,
        ...(r.group !== undefined ? { group: r.group } : {}),
        ...(r.model !== undefined ? { model: r.model } : {}),
      }));
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      return;
    }

    if (rules.length === 0) {
      process.stdout.write('No rules discovered.\n');
      return;
    }

    process.stdout.write(formatRulesTable(rules));
  } catch (error: unknown) {
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
    process.stderr.write(`Unexpected error: ${String(error)}\n`);
    process.exitCode = 2;
  }
}

function formatRulesTable(rules: Rule[]): string {
  const lines: string[] = [];
  lines.push(pc.bold(`${String(rules.length)} rule(s) discovered:`));
  lines.push('');
  for (const rule of rules) {
    lines.push(`  ${pc.bold(rule.name)}`);
    lines.push(`    ${pc.dim('id:      ')}${rule.id}`);
    lines.push(`    ${pc.dim('source:  ')}${rule.source}`);
    if (rule.group !== undefined) {
      lines.push(`    ${pc.dim('group:   ')}${rule.group}`);
    }
    if (rule.model !== undefined) {
      lines.push(`    ${pc.dim('model:   ')}${rule.model}`);
    }
    const scope =
      rule.inclusions.length > 0
        ? rule.inclusions.join(', ')
        : '(project-wide)';
    lines.push(`    ${pc.dim('scope:   ')}${scope}`);
    lines.push('');
  }
  lines.push(
    pc.dim(
      'Pass a rule name or id to `prosecheck lint --rules "<name-or-id>,..."`.',
    ),
  );
  return lines.join('\n') + '\n';
}
