import type { Rule } from '../../types/index.js';
import type { Config } from '../config-schema.js';
import { calculateRulesMd } from './rules-md.js';
import { calculateAdr } from './adr.js';

/** A calculator function that discovers rules from a project. */
export type CalculatorFn = (
  projectRoot: string,
  options: Record<string, unknown>,
) => Promise<Rule[]>;

/** Built-in calculator registry. */
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
    return calculateRulesMd(projectRoot);
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

    const result = await fn(projectRoot, calc.options);
    rules.push(...result);
  }

  return rules;
}
