import type { CollectResultsOutput } from '../lib/results.js';

/**
 * SARIF 2.1.0 output for GitHub Code Scanning.
 *
 * Maps prosecheck results to SARIF results with:
 * - Each rule as a reportingDescriptor
 * - Each comment as a result with physical location
 * - warn → "warning", fail → "error" severity levels
 * - pass rules are omitted (no findings to report)
 */
export function formatSarif(output: CollectResultsOutput): string {
  const rules: SarifRule[] = [];
  const results: SarifResult[] = [];
  const ruleIndexMap = new Map<string, number>();

  for (const { ruleId, result } of output.results) {
    if (result.status === 'pass') continue;

    if (!ruleIndexMap.has(ruleId)) {
      ruleIndexMap.set(ruleId, rules.length);
      rules.push({
        id: ruleId,
        shortDescription: { text: result.rule },
        fullDescription: { text: result.headline },
      });
    }

    const ruleIndex = ruleIndexMap.get(ruleId) ?? 0;
    const level: SarifLevel = result.status === 'fail' ? 'error' : 'warning';

    for (const comment of result.comments) {
      const sarifResult: SarifResult = {
        ruleId,
        ruleIndex,
        level,
        message: { text: comment.message },
      };

      if (comment.file) {
        sarifResult.locations = [
          {
            physicalLocation: {
              artifactLocation: { uri: comment.file },
              ...(comment.line
                ? {
                    region: {
                      startLine: comment.line,
                    },
                  }
                : {}),
            },
          },
        ];
      }

      results.push(sarifResult);
    }
  }

  // Dropped rules as "error" findings with no location
  for (const { rule } of output.dropped) {
    if (!ruleIndexMap.has(rule.id)) {
      ruleIndexMap.set(rule.id, rules.length);
      rules.push({
        id: rule.id,
        shortDescription: { text: rule.name },
        fullDescription: { text: 'Rule produced no output (dropped)' },
      });
    }

    results.push({
      ruleId: rule.id,
      ruleIndex: ruleIndexMap.get(rule.id) ?? 0,
      level: 'error',
      message: { text: `Rule "${rule.name}" produced no output` },
    });
  }

  const sarif: SarifLog = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'prosecheck',
            informationUri: 'https://github.com/Promaia/prosecheck',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2) + '\n';
}

// --- SARIF type definitions (subset of SARIF 2.1.0) ---

type SarifLevel = 'none' | 'note' | 'warning' | 'error';

interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

interface SarifDriver {
  name: string;
  informationUri: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations?: SarifLocation[];
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number };
  };
}
