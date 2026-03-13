import { describe, it, expect } from 'vitest';
import { buildExecutionPlan } from '../../../src/lib/execution-plan.js';
import type { Invocation } from '../../../src/lib/execution-plan.js';
import type { Rule } from '../../../src/types/index.js';

function makeRule(name: string, group?: string, model?: string): Rule {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    description: `Rule: ${name}`,
    inclusions: [],
    source: 'RULES.md',
    ...(group ? { group } : {}),
    ...(model ? { model } : {}),
  };
}

/** Get a batch from the plan, failing if out of bounds */
function batch(plan: Invocation[][], index: number): Invocation[] {
  const b = plan[index];
  expect(b, `expected batch at index ${String(index)}`).toBeDefined();
  return b as Invocation[];
}

/** Get an invocation from a batch, failing if out of bounds */
function inv(b: Invocation[], index: number): Invocation {
  const i = b[index];
  expect(i, `expected invocation at index ${String(index)}`).toBeDefined();
  return i as Invocation;
}

describe('buildExecutionPlan', () => {
  describe('one-to-one', () => {
    it('creates one invocation per rule', () => {
      const rules = [makeRule('A'), makeRule('B'), makeRule('C')];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 0,
      });
      // All in one batch (unlimited)
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(3);
      expect(b0.every((i) => i.type === 'one-to-one')).toBe(true);
      expect(b0.every((i) => i.rules.length === 1)).toBe(true);
    });

    it('splits into batches by maxConcurrentAgents', () => {
      const rules = [
        makeRule('A'),
        makeRule('B'),
        makeRule('C'),
        makeRule('D'),
        makeRule('E'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 2,
      });
      expect(plan).toHaveLength(3);
      expect(batch(plan, 0)).toHaveLength(2);
      expect(batch(plan, 1)).toHaveLength(2);
      expect(batch(plan, 2)).toHaveLength(1);
    });
  });

  describe('one-to-many-teams', () => {
    it('packs all rules into one invocation when unlimited', () => {
      const rules = [makeRule('A'), makeRule('B'), makeRule('C')];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-teams',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(1);
      expect(inv(b0, 0).type).toBe('one-to-many-teams');
      expect(inv(b0, 0).rules).toHaveLength(3);
    });

    it('splits teams by maxConcurrentAgents', () => {
      const rules = [
        makeRule('A'),
        makeRule('B'),
        makeRule('C'),
        makeRule('D'),
        makeRule('E'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-teams',
        maxConcurrentAgents: 2,
      });
      // 5 rules, max 2 agents → teams of 2, 2, 1
      expect(plan).toHaveLength(3);
      expect(inv(batch(plan, 0), 0).rules).toHaveLength(2);
      expect(inv(batch(plan, 1), 0).rules).toHaveLength(2);
      expect(inv(batch(plan, 2), 0).rules).toHaveLength(1);
    });
  });

  describe('one-to-many-single', () => {
    it('puts all rules in one invocation', () => {
      const rules = [makeRule('A'), makeRule('B'), makeRule('C')];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-single',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(1);
      expect(inv(b0, 0).type).toBe('one-to-many-single');
      expect(inv(b0, 0).rules).toHaveLength(3);
    });

    it('counts as 1 agent regardless of rule count', () => {
      const rules = [makeRule('A'), makeRule('B'), makeRule('C')];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-single',
        maxConcurrentAgents: 1,
      });
      // Single invocation counts as 1 agent, fits in one batch
      expect(plan).toHaveLength(1);
      expect(batch(plan, 0)).toHaveLength(1);
    });
  });

  describe('groups', () => {
    it('creates separate one-to-many-single invocations per group', () => {
      const rules = [
        makeRule('A', 'perf'),
        makeRule('B', 'perf'),
        makeRule('C', 'style'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 0,
      });
      // No ungrouped rules, two group invocations
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(2);
      expect(inv(b0, 0).type).toBe('one-to-many-single');
      expect(inv(b0, 0).rules).toHaveLength(2); // perf group
      expect(inv(b0, 1).type).toBe('one-to-many-single');
      expect(inv(b0, 1).rules).toHaveLength(1); // style group
    });

    it('interleaves groups with ungrouped rules under maxConcurrentAgents', () => {
      const rules = [
        makeRule('U1'),
        makeRule('U2'),
        makeRule('G1', 'grp'),
        makeRule('G2', 'grp'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 2,
      });
      // Batch 1: U1 + U2 (2 agents, full)
      // Batch 2: grp group (1 agent)
      expect(plan).toHaveLength(2);
      expect(batch(plan, 0)).toHaveLength(2); // U1, U2
      expect(batch(plan, 1)).toHaveLength(1); // grp group
    });

    it('packs group into existing batch with space', () => {
      const rules = [
        makeRule('U1'),
        makeRule('G1', 'grp'),
        makeRule('G2', 'grp'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 3,
      });
      // U1 (1 agent) + grp (1 agent) = 2, fits in one batch
      expect(plan).toHaveLength(1);
      expect(batch(plan, 0)).toHaveLength(2);
    });
  });

  describe('mixed ungrouped and grouped', () => {
    it('handles teams + groups together', () => {
      const rules = [
        makeRule('U1'),
        makeRule('U2'),
        makeRule('U3'),
        makeRule('G1', 'grp'),
        makeRule('G2', 'grp'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-teams',
        maxConcurrentAgents: 2,
      });
      // Ungrouped: 3 rules in teams of max 2 → team(U1,U2) in batch 1, team(U3) in batch 2
      // Group: grp (1 agent) → fits in batch 2 (which has 1 agent from U3)
      expect(plan).toHaveLength(2);
      expect(batch(plan, 0)).toHaveLength(1); // team of 2
      expect(inv(batch(plan, 0), 0).rules).toHaveLength(2);
      expect(batch(plan, 1)).toHaveLength(2); // team of 1 + group
    });
  });

  describe('edge cases', () => {
    it('handles empty rules', () => {
      const plan = buildExecutionPlan({
        rules: [],
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(0);
    });

    it('handles all rules in one group', () => {
      const rules = [makeRule('A', 'grp'), makeRule('B', 'grp')];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(1);
      expect(inv(b0, 0).type).toBe('one-to-many-single');
      expect(inv(b0, 0).rules).toHaveLength(2);
    });

    it('team splitting across multiple batches', () => {
      const rules = Array.from({ length: 7 }, (_, i) =>
        makeRule(`R${String(i)}`),
      );
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-teams',
        maxConcurrentAgents: 3,
      });
      // 7 rules → teams split into 3, 3, 1
      expect(plan).toHaveLength(3);
      expect(inv(batch(plan, 0), 0).rules).toHaveLength(3);
      expect(inv(batch(plan, 1), 0).rules).toHaveLength(3);
      expect(inv(batch(plan, 2), 0).rules).toHaveLength(1);
    });
  });

  describe('model partitioning', () => {
    it('one-to-many-single with mixed models creates separate invocations per model', () => {
      const rules = [
        makeRule('A', undefined, 'haiku'),
        makeRule('B', undefined, 'opus'),
        makeRule('C', undefined, 'haiku'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-single',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      // Two invocations: one for haiku, one for opus
      expect(b0).toHaveLength(2);
      const haikuInv = b0.find((i) => i.model === 'haiku');
      const opusInv = b0.find((i) => i.model === 'opus');
      expect(haikuInv?.rules).toHaveLength(2);
      expect(opusInv?.rules).toHaveLength(1);
    });

    it('one-to-many-single with uniform models creates one invocation', () => {
      const rules = [
        makeRule('A', undefined, 'sonnet'),
        makeRule('B', undefined, 'sonnet'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-single',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(1);
      expect(inv(b0, 0).model).toBe('sonnet');
      expect(inv(b0, 0).rules).toHaveLength(2);
    });

    it('groups with mixed models split into separate invocations per (group, model)', () => {
      const rules = [
        makeRule('A', 'perf', 'haiku'),
        makeRule('B', 'perf', 'opus'),
        makeRule('C', 'perf', 'haiku'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      // Two invocations: perf/haiku and perf/opus
      expect(b0).toHaveLength(2);
      const haikuInv = b0.find((i) => i.model === 'haiku');
      const opusInv = b0.find((i) => i.model === 'opus');
      expect(haikuInv?.rules).toHaveLength(2);
      expect(opusInv?.rules).toHaveLength(1);
    });

    it('one-to-one sets model on each invocation from the rule', () => {
      const rules = [
        makeRule('A', undefined, 'haiku'),
        makeRule('B', undefined, 'opus'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-one',
        maxConcurrentAgents: 0,
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(2);
      expect(inv(b0, 0).model).toBe('haiku');
      expect(inv(b0, 1).model).toBe('opus');
    });

    it('one-to-many-teams sets model to teamsOrchestratorModel', () => {
      const rules = [
        makeRule('A', undefined, 'haiku'),
        makeRule('B', undefined, 'opus'),
      ];
      const plan = buildExecutionPlan({
        rules,
        claudeToRuleShape: 'one-to-many-teams',
        maxConcurrentAgents: 0,
        teamsOrchestratorModel: 'sonnet',
      });
      expect(plan).toHaveLength(1);
      const b0 = batch(plan, 0);
      expect(b0).toHaveLength(1);
      expect(inv(b0, 0).model).toBe('sonnet');
    });
  });
});
