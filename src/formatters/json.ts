import type { CollectResultsOutput } from '../lib/results.js';

export interface JsonOutput {
  overallStatus: string;
  results: JsonResultEntry[];
  dropped: JsonDroppedEntry[];
  errors: JsonErrorEntry[];
}

export interface JsonResultEntry {
  ruleId: string;
  status: string;
  rule: string;
  source: string;
  headline?: string;
  comment?: string;
  comments?: Array<{
    message: string;
    file?: string | undefined;
    line?: number | undefined;
  }>;
}

export interface JsonDroppedEntry {
  ruleId: string;
  ruleName: string;
  source: string;
}

export interface JsonErrorEntry {
  ruleId: string;
  ruleName: string;
  message: string;
}

/**
 * Format results as structured JSON.
 */
export function formatJson(output: CollectResultsOutput): string {
  const json: JsonOutput = {
    overallStatus: output.overallStatus,
    results: output.results.map(({ ruleId, result }) => {
      const entry: JsonResultEntry = {
        ruleId,
        status: result.status,
        rule: result.rule,
        source: result.source,
      };

      if (result.status === 'pass') {
        if (result.comment) {
          entry.comment = result.comment;
        }
      } else {
        entry.headline = result.headline;
        entry.comments = result.comments;
      }

      return entry;
    }),
    dropped: output.dropped.map(({ rule }) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      source: rule.source,
    })),
    errors: output.errors.map((e) => ({
      ruleId: e.ruleId,
      ruleName: e.ruleName,
      message: e.message,
    })),
  };

  return JSON.stringify(json, null, 2) + '\n';
}
