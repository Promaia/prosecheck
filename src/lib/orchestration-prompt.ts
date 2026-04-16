import path from 'node:path';
import type { Rule } from '../types/index.js';
import { RESULT_SCHEMA } from './prompt.js';

const OUTPUTS_DIR = '.prosecheck/working/outputs';
const TIMING_DIR = '.prosecheck/working/timing';

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

  // Build rule lookups
  const ruleNames = new Map<string, string>();
  const ruleModels = new Map<string, string | undefined>();
  for (const rule of rules) {
    ruleNames.set(rule.id, rule.name);
    ruleModels.set(rule.id, rule.model);
  }

  // Build the rule list entries — only include rules assigned to this invocation
  const sortedEntries = [...promptPaths.entries()]
    .filter(([ruleId]) => ruleNames.has(ruleId))
    .sort(([a], [b]) => a.localeCompare(b));
  const ruleEntries: string[] = [];
  for (const [ruleId, promptPath] of sortedEntries) {
    const name = ruleNames.get(ruleId) ?? ruleId;
    const relativePath = path
      .relative(projectRoot, promptPath)
      .replaceAll('\\', '/');
    const model = agentTeams ? ruleModels.get(ruleId) : undefined;
    const modelAnnotation = model ? ` (use ${model})` : '';
    ruleEntries.push(`* ${name}${modelAnnotation}: ${relativePath}`);
  }

  const ruleList = ruleEntries.join('\n');

  if (agentTeams) {
    const hasModelAnnotations = [...ruleModels.values()].some(
      (m) => m !== undefined,
    );
    return buildAgentTeamsPrompt(
      ruleList,
      projectRoot,
      promptPaths,
      ruleNames,
      hasModelAnnotations,
    );
  }
  return buildSequentialPrompt(ruleList, projectRoot, promptPaths, ruleNames);
}

function buildAgentTeamsPrompt(
  ruleList: string,
  projectRoot: string,
  promptPaths: Map<string, string>,
  ruleNames: Map<string, string>,
  hasModelAnnotations: boolean,
): string {
  // Build output path list — only include rules assigned to this invocation
  const sortedIds = [...promptPaths.keys()]
    .filter((id) => ruleNames.has(id))
    .sort();
  const outputEntries: string[] = [];
  const timingEntries: string[] = [];
  for (const ruleId of sortedIds) {
    const name = ruleNames.get(ruleId) ?? ruleId;
    const outputPath = path
      .join(projectRoot, OUTPUTS_DIR, `${ruleId}.json`)
      .replaceAll('\\', '/');
    const timingPath = path
      .join(projectRoot, TIMING_DIR, `${ruleId}.started`)
      .replaceAll('\\', '/');
    outputEntries.push(`  - ${name}: \`${outputPath}\``);
    timingEntries.push(`  - ${name}: \`${timingPath}\``);
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
    '## Progress tracking',
    '',
    'Before each sub-agent begins evaluating its rule, it MUST write an empty file to mark the start. Include this instruction in every message you send to sub-agents:',
    ...timingEntries,
    '',
    'Each marker must be written immediately before starting work on that rule. Do not batch them.',
    '',
    '## Output file paths',
    '',
    ...outputEntries,
    '',
    ...(hasModelAnnotations
      ? [
          '## Model selection',
          '',
          'When a rule specifies a model (e.g., "use haiku"), use that model for the teammate evaluating that rule. Rules without a model annotation use the default model.',
          '',
        ]
      : []),
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
  // Build output path list — only include rules assigned to this invocation
  const outputEntries: string[] = [];
  const timingEntries: string[] = [];
  const sortedIds = [...promptPaths.keys()]
    .filter((id) => ruleNames.has(id))
    .sort();
  for (const ruleId of sortedIds) {
    const name = ruleNames.get(ruleId) ?? ruleId;
    const outputPath = path
      .join(projectRoot, OUTPUTS_DIR, `${ruleId}.json`)
      .replaceAll('\\', '/');
    const timingPath = path
      .join(projectRoot, TIMING_DIR, `${ruleId}.started`)
      .replaceAll('\\', '/');
    outputEntries.push(`  - ${name}: \`${outputPath}\``);
    timingEntries.push(`  - ${name}: \`${timingPath}\``);
  }

  return [
    'You are a lint agent. Process the following lint rules. Each rule has a prompt file that you should follow to check the rule and output its result in the correct place:',
    '',
    ruleList,
    '',
    '## Instructions',
    '',
    '1. Read each prompt file listed above.',
    '2. Before evaluating each rule, write an empty file to mark the start:',
    ...timingEntries,
    '3. Evaluate the codebase against each rule as described in the prompt.',
    '4. Write your JSON result for each rule to its output path:',
    ...outputEntries,
    '5. Each output file must conform to the JSON schema described in the prompt.',
    '6. Process all rules — do not skip any.',
  ].join('\n');
}
