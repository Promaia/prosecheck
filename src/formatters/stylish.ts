import pc from 'picocolors';
import type { CollectResultsOutput } from '../lib/results.js';

/**
 * Format results as colored terminal output (default formatter).
 *
 * Shows rule name, status, headline, and per-comment file/line details.
 */
export function formatStylish(output: CollectResultsOutput): string {
  const lines: string[] = [];

  for (const { ruleId, result } of output.results) {
    const statusLabel = formatStatus(result.status);
    lines.push(
      `${statusLabel} ${pc.bold(result.rule)} ${pc.dim(`(${ruleId})`)}`,
    );
    lines.push(`  ${pc.dim('source:')} ${result.source}`);

    if (result.status === 'pass') {
      if (result.comment) {
        lines.push(`  ${result.comment}`);
      }
    } else {
      lines.push(`  ${result.headline}`);
      for (const comment of result.comments) {
        const location = formatLocation(comment.file, comment.line);
        lines.push(`    ${location}${comment.message}`);
      }
    }

    lines.push('');
  }

  for (const { rule } of output.dropped) {
    const statusLabel = formatStatus('dropped');
    lines.push(
      `${statusLabel} ${pc.bold(rule.name)} ${pc.dim(`(${rule.id})`)}`,
    );
    lines.push(`  ${pc.dim('source:')} ${rule.source}`);
    lines.push(`  No output produced by agent`);
    lines.push('');
  }

  for (const error of output.errors) {
    const statusLabel = formatStatus('error');
    lines.push(
      `${statusLabel} ${pc.bold(error.ruleName)} ${pc.dim(`(${error.ruleId})`)}`,
    );
    lines.push(`  ${error.message}`);
    lines.push('');
  }

  const summary = buildSummary(output);
  lines.push(summary);

  return lines.join('\n');
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pass':
      return pc.green('PASS');
    case 'warn':
      return pc.yellow('WARN');
    case 'fail':
      return pc.red('FAIL');
    case 'dropped':
      return pc.magenta('DROP');
    case 'error':
      return pc.red('ERR ');
    default:
      return status.toUpperCase();
  }
}

function formatLocation(file?: string, line?: number): string {
  if (!file) return '';
  const loc = line ? `${file}:${String(line)}` : file;
  return pc.cyan(loc) + ' ';
}

function buildSummary(output: CollectResultsOutput): string {
  const total =
    output.results.length + output.dropped.length + output.errors.length;
  const passed = output.results.filter(
    (r) => r.result.status === 'pass',
  ).length;
  const warned = output.results.filter(
    (r) => r.result.status === 'warn',
  ).length;
  const failed = output.results.filter(
    (r) => r.result.status === 'fail',
  ).length;
  const droppedCount = output.dropped.length;
  const errorCount = output.errors.length;

  const parts: string[] = [];
  if (passed > 0) parts.push(pc.green(`${String(passed)} passed`));
  if (warned > 0) parts.push(pc.yellow(`${String(warned)} warned`));
  if (failed > 0) parts.push(pc.red(`${String(failed)} failed`));
  if (droppedCount > 0)
    parts.push(pc.magenta(`${String(droppedCount)} dropped`));
  if (errorCount > 0) parts.push(pc.red(`${String(errorCount)} errors`));

  return `${pc.bold(String(total) + ' rules')} | ${parts.join(' | ')}`;
}
