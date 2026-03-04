import { describe, it, expect } from 'vitest';
import { buildOrchestrationPrompt } from '../../../src/lib/orchestration-prompt.js';
import type { Rule } from '../../../src/types/index.js';

function makeRule(id: string, name: string): Rule {
  return {
    id,
    name,
    description: 'Test rule',
    inclusions: [],
    source: 'RULES.md',
  };
}

describe('buildOrchestrationPrompt', () => {
  it('builds sequential prompt when agentTeams is false', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/project/.prosecheck/working/prompts/rule-a.md');
    promptPaths.set('rule-b', '/project/.prosecheck/working/prompts/rule-b.md');

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [
        makeRule('rule-a', 'No Console Log'),
        makeRule('rule-b', 'Keep Functions Short'),
      ],
      agentTeams: false,
    });

    expect(result).toContain('lint agent');
    expect(result).toContain('No Console Log');
    expect(result).toContain('Keep Functions Short');
    expect(result).toContain('rule-a.md');
    expect(result).toContain('rule-b.md');
    expect(result).toContain('Read each prompt file');
    expect(result).toContain('Instructions');
    expect(result).toContain('rule-a.json');
    expect(result).toContain('rule-b.json');
    expect(result).not.toContain('orchestrator');
    expect(result).not.toContain('agent teams');
  });

  it('builds agent teams prompt when agentTeams is true', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/project/.prosecheck/working/prompts/rule-a.md');

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [makeRule('rule-a', 'No Console Log')],
      agentTeams: true,
    });

    expect(result).toContain('orchestrator');
    expect(result).toContain('agent teams');
    expect(result).toContain('No Console Log');
    expect(result).toContain('rule-a.md');
    expect(result).not.toContain('Instructions');
  });

  it('uses relative paths for prompt files', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/project/.prosecheck/working/prompts/rule-a.md');

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [makeRule('rule-a', 'Rule A')],
      agentTeams: false,
    });

    expect(result).toContain('.prosecheck/working/prompts/rule-a.md');
    expect(result).not.toContain(
      '/project/.prosecheck/working/prompts/rule-a.md',
    );
  });

  it('falls back to rule ID when rule name not found', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('unknown-rule', '/project/prompts/unknown-rule.md');

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [], // no matching rule
      agentTeams: false,
    });

    expect(result).toContain('unknown-rule');
  });

  it('handles empty prompt paths', () => {
    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths: new Map(),
      rules: [],
      agentTeams: false,
    });

    expect(result).toContain('lint agent');
  });
});
