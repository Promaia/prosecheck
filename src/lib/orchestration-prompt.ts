import path from 'node:path';
import type { Rule } from '../types/index.js';
import { RESULT_SCHEMA } from './prompt.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';

export interface OrchestrationPromptOptions {
  /** Project root directory */
  projectRoot: string;
  /** Map of rule ID to prompt file path */
  promptPaths: Map<string, string>;
  /** Triggered rules (for rule names in the prompt) */
  rules: Rule[];
  /** Whether to use agent teams mode */
  agentTeams: boolean;
}

/**
 * Build the orchestration prompt used by both user-prompt and claude-code
 * single-instance modes.
 *
 * When `agentTeams` is true, the prompt instructs the agent to launch
 * sub-agents (agent teams) for each rule. When false, it instructs the
 * agent to process all rules sequentially itself.
 */
export function buildOrchestrationPrompt(
  options: OrchestrationPromptOptions,
): string {
  const { projectRoot, promptPaths, rules, agentTeams } = options;

  // Build rule name lookup
  const ruleNames = new Map<string, string>();
  for (const rule of rules) {
    ruleNames.set(rule.id, rule.name);
  }

  // Build the rule list entries — sort by rule ID for deterministic output
  const sortedEntries = [...promptPaths.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const ruleEntries: string[] = [];
  for (const [ruleId, promptPath] of sortedEntries) {
    const name = ruleNames.get(ruleId) ?? ruleId;
    const relativePath = path
      .relative(projectRoot, promptPath)
      .replaceAll('\\', '/');
    ruleEntries.push(`* ${name}: ${relativePath}`);
  }

  const ruleList = ruleEntries.join('\n');

  if (agentTeams) {
    return buildAgentTeamsPrompt(ruleList, projectRoot, promptPaths, ruleNames);
  }
  return buildSequentialPrompt(ruleList, projectRoot, promptPaths, ruleNames);
}

function buildAgentTeamsPrompt(
  ruleList: string,
  projectRoot: string,
  promptPaths: Map<string, string>,
  ruleNames: Map<string, string>,
): string {
  // Build output path list so the orchestrator knows where to validate
  const sortedIds = [...promptPaths.keys()].sort();
  const outputEntries: string[] = [];
  for (const ruleId of sortedIds) {
    const name = ruleNames.get(ruleId) ?? ruleId;
    const outputPath = path
      .join(projectRoot, OUTPUTS_DIR, `${ruleId}.json`)
      .replaceAll('\\', '/');
    outputEntries.push(`  - ${name}: \`${outputPath}\``);
  }

  return [
    'You are a lint agent orchestrator. Launch agent teams to process the following lint rules. Each rule has a prompt file that the agent should follow to check the rule and output its result in the correct place:',
    '',
    ruleList,
    '',
    '## Required output schema',
    '',
    'Every sub-agent MUST write a JSON file matching one of these exact shapes. Include this schema in every message you send to sub-agents:',
    '',
    RESULT_SCHEMA,
    '',
    'The "status" field is REQUIRED and must be exactly "pass", "warn", or "fail". The "rule" field must be a string. Do not use alternative field names like "violations", "pass", "ruleId", or "ruleName".',
    '',
    '## Output file paths',
    '',
    ...outputEntries,
    '',
    '## Validation pass',
    '',
    'After all sub-agents complete, read every output file listed above and verify each one matches the required schema. If any file is missing the "status" field, uses wrong field names, or has any other schema violation, rewrite it to conform exactly. Do not skip this step.',
  ].join('\n');
}

function buildSequentialPrompt(
  ruleList: string,
  projectRoot: string,
  promptPaths: Map<string, string>,
  ruleNames: Map<string, string>,
): string {
  // Build output path list for instructions — same sort as rule list
  const outputEntries: string[] = [];
  const sortedIds = [...promptPaths.keys()].sort();
  for (const ruleId of sortedIds) {
    const name = ruleNames.get(ruleId) ?? ruleId;
    const outputPath = path
      .join(projectRoot, OUTPUTS_DIR, `${ruleId}.json`)
      .replaceAll('\\', '/');
    outputEntries.push(`  - ${name}: \`${outputPath}\``);
  }

  return [
    'You are a lint agent. Process the following lint rules. Each rule has a prompt file that you should follow to check the rule and output its result in the correct place:',
    '',
    ruleList,
    '',
    '## Instructions',
    '',
    '1. Read each prompt file listed above.',
    '2. Evaluate the codebase against each rule as described in the prompt.',
    '3. Write your JSON result for each rule to its output path:',
    ...outputEntries,
    '4. Each output file must conform to the JSON schema described in the prompt.',
    '5. Process all rules — do not skip any.',
  ].join('\n');
}
