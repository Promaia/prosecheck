import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Rule, PromptVariables } from '../types/index.js';

const PROMPTS_DIR = '.prosecheck/working/prompts';
const OUTPUTS_DIR = '.prosecheck/working/outputs';
const CUSTOM_TEMPLATE_PATH = '.prosecheck/prompt-template.md';
const GLOBAL_PROMPT_PATH = '.prosecheck/prompt.md';

const DEFAULT_TEMPLATE = `# Rule: {{ruleName}}

## Rule Text

{{ruleText}}

## Comparison Ref

Compare against: \`{{comparisonRef}}\`

## Changed Files

The following files changed and triggered this rule:

{{changedFilesList}}

## Scope

This rule applies to files matching:

{{scopeList}}

## Instructions

These files changed, but they may interact with related code in important ways. Look at the changes since the listed git ref and evaluate the full codebase within the rule's scope. Output your pass/warn/fail status to the specified output file. Do not prompt the user for any questions. Output only to the JSON file without user interaction.

## Output

Write your result as JSON to: \`{{outputPath}}\`

The JSON must match one of these shapes:

**Pass:**
\`\`\`json
{
  "status": "pass",
  "rule": "{{ruleName}}",
  "source": "{{ruleSource}}",
  "comment": "Optional summary"
}
\`\`\`

**Warn:**
\`\`\`json
{
  "status": "warn",
  "rule": "{{ruleName}}",
  "source": "{{ruleSource}}",
  "headline": "Short summary of concern",
  "comments": [
    { "message": "Detail", "file": "path/to/file.ts", "line": 1 }
  ]
}
\`\`\`

**Fail:**
\`\`\`json
{
  "status": "fail",
  "rule": "{{ruleName}}",
  "source": "{{ruleSource}}",
  "headline": "Short summary of violation",
  "comments": [
    { "message": "Detail", "file": "path/to/file.ts", "line": 1 }
  ]
}
\`\`\`
`;

export interface GeneratePromptOptions {
  /** Project root directory */
  projectRoot: string;
  /** The rule to generate a prompt for */
  rule: Rule;
  /** Git ref agents should compare against */
  comparisonRef: string;
  /** Changed files that triggered this rule */
  changedFiles: string[];
}

export interface GeneratePromptsOptions {
  /** Project root directory */
  projectRoot: string;
  /** Rules to generate prompts for */
  rules: Rule[];
  /** Git ref agents should compare against */
  comparisonRef: string;
  /** Map from rule ID to changed files within that rule's scope */
  changedFilesByRule: Map<string, string[]>;
}

export interface GeneratePromptsResult {
  /** Paths to generated prompt files, keyed by rule ID */
  promptPaths: Map<string, string>;
}

/**
 * Load the prompt template: custom `.prosecheck/prompt-template.md` if present,
 * otherwise the built-in default.
 */
export async function loadTemplate(projectRoot: string): Promise<string> {
  try {
    return await readFile(
      path.join(projectRoot, CUSTOM_TEMPLATE_PATH),
      'utf-8',
    );
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return DEFAULT_TEMPLATE;
    }
    throw error;
  }
}

/**
 * Load the global system prompt from `.prosecheck/prompt.md` if present.
 * Returns undefined if the file does not exist.
 */
export async function loadGlobalPrompt(
  projectRoot: string,
): Promise<string | undefined> {
  try {
    const content = await readFile(
      path.join(projectRoot, GLOBAL_PROMPT_PATH),
      'utf-8',
    );
    return content.trim() || undefined;
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Build the PromptVariables for a given rule.
 */
export function buildPromptVariables(
  rule: Rule,
  comparisonRef: string,
  changedFiles: string[],
  projectRoot: string,
): PromptVariables {
  const outputPath = path.join(projectRoot, OUTPUTS_DIR, `${rule.id}.json`).replaceAll('\\', '/');
  return {
    ruleText: `# ${rule.name}\n\n${rule.description}`,
    comparisonRef,
    changedFiles,
    scope: rule.inclusions.length > 0 ? rule.inclusions : ['(all files)'],
    outputPath,
    ruleId: rule.id,
  };
}

/**
 * Interpolate template variables into a prompt template string.
 */
export function interpolateTemplate(
  template: string,
  variables: PromptVariables,
  rule: Rule,
): string {
  const changedFilesList =
    variables.changedFiles.length > 0
      ? variables.changedFiles.map((f) => `- \`${f}\``).join('\n')
      : '- (no changed files)';

  const scopeList = variables.scope.map((s) => `- \`${s}\``).join('\n');

  return template
    .replaceAll('{{ruleName}}', rule.name)
    .replaceAll('{{ruleText}}', variables.ruleText)
    .replaceAll('{{comparisonRef}}', variables.comparisonRef)
    .replaceAll('{{changedFilesList}}', changedFilesList)
    .replaceAll('{{scopeList}}', scopeList)
    .replaceAll('{{outputPath}}', variables.outputPath)
    .replaceAll('{{ruleId}}', variables.ruleId)
    .replaceAll('{{ruleSource}}', rule.source);
}

/**
 * Generate a single prompt file for a rule.
 * Returns the absolute path to the written prompt file.
 */
export async function generatePrompt(
  options: GeneratePromptOptions,
  template: string,
  globalPrompt: string | undefined,
): Promise<string> {
  const { projectRoot, rule, comparisonRef, changedFiles } = options;

  const variables = buildPromptVariables(
    rule,
    comparisonRef,
    changedFiles,
    projectRoot,
  );

  let content = interpolateTemplate(template, variables, rule);

  if (globalPrompt) {
    content = globalPrompt + '\n\n---\n\n' + content;
  }

  const promptPath = path.join(projectRoot, PROMPTS_DIR, `${rule.id}.md`);
  await mkdir(path.dirname(promptPath), { recursive: true });
  await writeFile(promptPath, content, 'utf-8');

  return promptPath;
}

/**
 * Generate prompt files for all triggered rules.
 *
 * 1. Ensure prompts directory exists
 * 2. Load template (custom or default)
 * 3. Load global system prompt if present
 * 4. Generate one prompt file per rule
 *
 * Note: Cleanup of stale prompt/output files is the engine's responsibility.
 */
export async function generatePrompts(
  options: GeneratePromptsOptions,
): Promise<GeneratePromptsResult> {
  const { projectRoot, rules, comparisonRef, changedFilesByRule } = options;

  // Ensure prompts directory exists (and is clean for this run)
  const promptsDir = path.join(projectRoot, PROMPTS_DIR);
  await mkdir(promptsDir, { recursive: true });

  // Load template and global prompt
  const template = await loadTemplate(projectRoot);
  const globalPrompt = await loadGlobalPrompt(projectRoot);

  // Generate per-rule prompts
  const promptPaths = new Map<string, string>();
  for (const rule of rules) {
    const changedFiles = changedFilesByRule.get(rule.id) ?? [];
    const promptPath = await generatePrompt(
      { projectRoot, rule, comparisonRef, changedFiles },
      template,
      globalPrompt,
    );
    promptPaths.set(rule.id, promptPath);
  }

  return { promptPaths };
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
