import type { Config, RuleResult } from '../lib/config-schema.js';

// Re-export config-derived types
export type { Config, RuleResult };

// --- Rule types ---

export type RuleStatus = 'pass' | 'warn' | 'fail' | 'dropped';

export interface Rule {
  /** Stable, filesystem-safe identifier (e.g., "src-rules-md--no-console-log") */
  id: string;
  /** Human-readable rule name (the heading text) */
  name: string;
  /** Full natural-language rule description */
  description: string;
  /** Gitignore-format inclusion patterns defining which files this rule applies to */
  inclusions: string[];
  /** Source file the rule was discovered in (e.g., "src/RULES.md", "docs/adr/001-use-zod.md") */
  source: string;
  /** Optional rule group — rules in the same group run under one agent sequentially */
  group?: string | undefined;
  /** Passthrough bag for unrecognized frontmatter fields (for future use) */
  frontmatter?: Record<string, unknown> | undefined;
}

// --- Prompt types ---

export interface PromptVariables {
  /** Full rule text (name + description) */
  ruleText: string;
  /** Git ref to diff against */
  comparisonRef: string;
  /** Files that changed and triggered this rule */
  changedFiles: string[];
  /** The rule's inclusion patterns */
  scope: string[];
  /** Path where the agent should write its output JSON */
  outputPath: string;
  /** The rule ID */
  ruleId: string;
}

// --- Progress tracking ---

export type ProgressPhase = 'discovered' | 'running' | 'result';

export interface ProgressEvent {
  /** Which phase triggered this event */
  phase: ProgressPhase;
  /** Rule ID this event is about */
  ruleId: string;
  /** Rule name (human-readable) */
  ruleName: string;
  /** Agent result — present only when phase is 'result' */
  result?: RuleResult | undefined;
}

export type OnProgress = (event: ProgressEvent) => void;

// --- Run context ---

export interface RunContext {
  /** Resolved configuration (all layers merged) */
  config: Config;
  /** Active environment name */
  environment: string;
  /** Operating mode */
  mode: string;
  /** Output format */
  format: string;
  /** Project root directory (where .prosecheck/ lives) */
  projectRoot: string;
  /** Git comparison ref */
  comparisonRef: string;
  /** Optional progress callback for interactive UI */
  onProgress?: OnProgress | undefined;
}
