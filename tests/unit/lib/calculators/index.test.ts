import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runCalculators } from '../../../../src/lib/calculators/index.js';
import { ConfigSchema } from '../../../../src/lib/config-schema.js';

const fixturesDir = path.resolve(import.meta.dirname, '../../../fixtures');

describe('runCalculators', () => {
  it('runs rules-md by default when no calculators configured', async () => {
    const config = ConfigSchema.parse({});
    const projectRoot = path.join(fixturesDir, 'project-simple');
    const rules = await runCalculators(projectRoot, config);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('All exported functions must have JSDoc comments');
  });

  it('dispatches to named calculators from config', async () => {
    const config = ConfigSchema.parse({
      ruleCalculators: [
        { name: 'adr', enabled: true, options: { path: 'docs/adr' } },
      ],
    });
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await runCalculators(projectRoot, config);

    expect(rules).toHaveLength(2);
  });

  it('skips disabled calculators', async () => {
    const config = ConfigSchema.parse({
      ruleCalculators: [
        { name: 'rules-md', enabled: false },
        { name: 'adr', enabled: true, options: { path: 'docs/adr' } },
      ],
    });
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await runCalculators(projectRoot, config);

    // Only ADR rules, no rules-md
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.source).toMatch(/^docs\/adr\//);
    }
  });

  it('runs multiple calculators and combines results', async () => {
    const config = ConfigSchema.parse({
      ruleCalculators: [
        { name: 'rules-md', enabled: true },
        { name: 'adr', enabled: true, options: { path: 'docs/adr' } },
      ],
    });
    // project-adr has no RULES.md at root, but it does have ADRs
    const projectRoot = path.join(fixturesDir, 'project-adr');
    const rules = await runCalculators(projectRoot, config);

    // ADR rules only (no RULES.md files in project-adr)
    expect(rules).toHaveLength(2);
  });

  it('throws for unknown calculator name', async () => {
    const config = ConfigSchema.parse({
      ruleCalculators: [
        { name: 'nonexistent', enabled: true },
      ],
    });

    await expect(
      runCalculators(path.join(fixturesDir, 'project-simple'), config),
    ).rejects.toThrow('Unknown rule calculator: "nonexistent"');
  });
});
