// Library entry point — exports core API for programmatic use

// Core types
export type { Config, RuleResult } from './lib/config-schema.js';
export type {
  Rule,
  RuleStatus,
  RunContext,
  PromptVariables,
  ProgressEvent,
  ProgressPhase,
  OnProgress,
} from './types/index.js';

// Engine
export { runEngine } from './lib/engine.js';
export type { EngineResult } from './lib/engine.js';

// Config loading
export { loadConfig, resolveEnvironment, ConfigError } from './lib/config.js';
export type { LoadConfigOptions, LoadConfigResult } from './lib/config.js';

// Result types
export type {
  CollectResultsOutput,
  RuleResultWithId,
  DroppedRule,
} from './lib/results.js';

// Orchestration prompt
export { buildOrchestrationPrompt } from './lib/orchestration-prompt.js';
export type { OrchestrationPromptOptions } from './lib/orchestration-prompt.js';

// Formatters
export { formatStylish } from './formatters/stylish.js';
export { formatJson } from './formatters/json.js';
export { formatSarif } from './formatters/sarif.js';

// Commands
export { init } from './commands/init.js';
export type { InitOptions } from './commands/init.js';
export { lint } from './commands/lint.js';
export type { LintOptions } from './commands/lint.js';
