import type { Rule } from '../../types/index.js';
import type { Config } from '../config-schema.js';
import { calculateRulesMd } from './rules-md.js';
import { calculateAdr } from './adr.js';

/** A calculator function that discovers rules from a project. */
export type CalculatorFn = (
  projectRoot: string,
  options: Record<string, unknown>,
) => Promise<Rule[]>;

/**
 * Built-in calculator registry.
 *
 * Each calculator accepts a specific options interface (RulesMdOptions, AdrOptions)
 * but is stored as CalculatorFn (Record<string, unknown> options) for uniform dispatch.
 * The `satisfies` check ensures each function's signature is compatible at the call
 * level, while the cast adapts the parameter type for the registry.
 */
const CALCULATORS: Record<string, CalculatorFn> = {
  'rules-md': calculateRulesMd as CalculatorFn,
  adr: calculateAdr as CalculatorFn,
};

/**
 * Run all enabled rule calculators and collect discovered rules.
 *
 * If no calculators are configured, runs `rules-md` by default.
 */
export async function runCalculators(
  projectRoot: string,
  config: Config,
): Promise<Rule[]> {
  const calculators = config.ruleCalculators;

  // Default: run rules-md if no calculators configured
  if (calculators.length === 0) {
    const rules = await calculateRulesMd(projectRoot, {
      ignore: config.globalIgnore,
    });
    assertNoDuplicateIds(rules);
    return rules;
  }

  const rules: Rule[] = [];

  for (const calc of calculators) {
    if (!calc.enabled) {
      continue;
    }

    const fn = CALCULATORS[calc.name];
    if (!fn) {
      throw new Error(
        `Unknown rule calculator: "${calc.name}". Available: ${Object.keys(CALCULATORS).join(', ')}`,
      );
    }

    const options =
      calc.name === 'rules-md'
        ? { ignore: config.globalIgnore, ...calc.options }
        : calc.options;
    const result = await fn(projectRoot, options);
    rules.push(...result);
  }

  assertNoDuplicateIds(rules);

  return rules;
}

/**
 * Fail early if two rules produce the same ID. This can happen when rule names
 * differ only in non-alphanumeric characters (e.g. "No console.log" vs
 * "No console log") since the slugifier collapses them identically.
 */
function assertNoDuplicateIds(rules: Rule[]): void {
  const seen = new Map<string, Rule>();
  for (const rule of rules) {
    const existing = seen.get(rule.id);
    if (existing) {
      throw new Error(
        `Rule ID collision: "${rule.id}" is produced by both ` +
          `"${existing.name}" (${existing.source}) and "${rule.name}" (${rule.source}). ` +
          `Rename one of the rules to resolve the conflict.`,
      );
    }
    seen.set(rule.id, rule);
  }
}
