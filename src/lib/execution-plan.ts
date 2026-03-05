import type { Rule } from '../types/index.js';

// --- Types ---

export type InvocationType =
  | 'one-to-one'
  | 'one-to-many-teams'
  | 'one-to-many-single';

export type ClaudeToRuleShape =
  | 'one-to-one'
  | 'one-to-many-teams'
  | 'one-to-many-single';

export interface Invocation {
  /** How this invocation processes its rules */
  type: InvocationType;
  /** Rules assigned to this invocation */
  rules: Rule[];
}

/** A set of invocations that run in parallel */
export type ExecutionBatch = Invocation[];

/** A sequence of batches — each batch runs after the previous completes */
export type ExecutionPlan = ExecutionBatch[];

// --- Plan builder ---

export interface BuildExecutionPlanOptions {
  rules: Rule[];
  claudeToRuleShape: ClaudeToRuleShape;
  maxConcurrentAgents: number;
}

/**
 * Build an execution plan from rules and config.
 *
 * 1. Separate rules into ungrouped and grouped (keyed by group name).
 * 2. Build invocations for ungrouped rules based on `claudeToRuleShape`.
 * 3. Create one `one-to-many-single` invocation per group.
 * 4. Insert all invocations into batches respecting `maxConcurrentAgents`.
 */
export function buildExecutionPlan(
  options: BuildExecutionPlanOptions,
): ExecutionPlan {
  const { rules, claudeToRuleShape, maxConcurrentAgents } = options;
  const max = maxConcurrentAgents <= 0 ? Infinity : maxConcurrentAgents;

  // Separate grouped and ungrouped rules
  const ungrouped: Rule[] = [];
  const groups = new Map<string, Rule[]>();
  for (const rule of rules) {
    if (rule.group) {
      const existing = groups.get(rule.group);
      if (existing) {
        existing.push(rule);
      } else {
        groups.set(rule.group, [rule]);
      }
    } else {
      ungrouped.push(rule);
    }
  }

  // Build ungrouped invocations
  const ungroupedInvocations = buildUngroupedInvocations(
    ungrouped,
    claudeToRuleShape,
    max,
  );

  // Build group invocations (one-to-many-single each)
  const groupInvocations: Invocation[] = [];
  for (const [, groupRules] of groups) {
    groupInvocations.push({ type: 'one-to-many-single', rules: groupRules });
  }

  // Insert all invocations into batches
  const batches: ExecutionPlan = [];

  // Insert ungrouped first
  for (const inv of ungroupedInvocations) {
    insertInvocation(batches, inv, max);
  }

  // Insert group invocations (each counts as 1 agent)
  for (const inv of groupInvocations) {
    insertNoSplit(batches, inv, max);
  }

  return batches;
}

function buildUngroupedInvocations(
  rules: Rule[],
  shape: ClaudeToRuleShape,
  max: number,
): Invocation[] {
  if (rules.length === 0) return [];

  switch (shape) {
    case 'one-to-one':
      return rules.map((rule) => ({
        type: 'one-to-one' as const,
        rules: [rule],
      }));

    case 'one-to-many-teams': {
      // Pack rules into team invocations of up to `max` rules each
      const invocations: Invocation[] = [];
      for (let i = 0; i < rules.length; i += max) {
        const chunk = rules.slice(i, i + max);
        invocations.push({ type: 'one-to-many-teams', rules: chunk });
      }
      return invocations;
    }

    case 'one-to-many-single':
      return [{ type: 'one-to-many-single', rules }];
  }
}

/**
 * Count how many agents an invocation uses toward the batch limit.
 */
function agentCount(inv: Invocation): number {
  switch (inv.type) {
    case 'one-to-one':
      return 1;
    case 'one-to-many-teams':
      return inv.rules.length; // each sub-agent counts
    case 'one-to-many-single':
      return 1; // one agent processes all rules sequentially
  }
}

/**
 * Count the total agents in a batch.
 */
function batchAgentCount(batch: ExecutionBatch): number {
  let total = 0;
  for (const inv of batch) {
    total += agentCount(inv);
  }
  return total;
}

/**
 * Insert an invocation into the plan, potentially splitting teams.
 */
function insertInvocation(
  batches: ExecutionPlan,
  inv: Invocation,
  max: number,
): void {
  if (inv.type !== 'one-to-many-teams') {
    insertNoSplit(batches, inv, max);
    return;
  }

  // Teams can be split across batches
  let remaining = inv.rules;

  while (remaining.length > 0) {
    // Find or create a batch with space
    let inserted = false;

    for (const batch of batches) {
      const currentCount = batchAgentCount(batch);
      const available = max - currentCount;

      if (available <= 0) continue;

      if (remaining.length <= available) {
        // Whole team fits
        batch.push({ type: 'one-to-many-teams', rules: remaining });
        remaining = [];
        inserted = true;
        break;
      } else {
        // Split: fill this batch, continue with remainder
        const fit = remaining.slice(0, available);
        remaining = remaining.slice(available);
        batch.push({ type: 'one-to-many-teams', rules: fit });
        inserted = true;
        // Don't break — need to process remaining in next iteration
        break;
      }
    }

    if (!inserted) {
      // No batch had space — start a new one
      if (remaining.length <= max) {
        batches.push([{ type: 'one-to-many-teams', rules: remaining }]);
        remaining = [];
      } else {
        const fit = remaining.slice(0, max);
        remaining = remaining.slice(max);
        batches.push([{ type: 'one-to-many-teams', rules: fit }]);
      }
    }
  }
}

/**
 * Insert a non-splittable invocation (one-to-one, one-to-many-single, groups).
 * Each counts as 1 agent. Find the first batch with space or create a new one.
 */
function insertNoSplit(
  batches: ExecutionPlan,
  inv: Invocation,
  max: number,
): void {
  for (const batch of batches) {
    if (batchAgentCount(batch) < max) {
      batch.push(inv);
      return;
    }
  }

  // No batch has space
  batches.push([inv]);
}
