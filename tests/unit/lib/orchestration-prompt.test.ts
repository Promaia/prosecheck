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

  it('excludes rules not in the rules array', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('assigned-rule', '/project/prompts/assigned-rule.md');
    promptPaths.set('extra-rule', '/project/prompts/extra-rule.md');

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [
        {
          id: 'assigned-rule',
          name: 'Assigned Rule',
          description: '',
          inclusions: [],
          source: 'test',
        },
      ],
      agentTeams: false,
    });

    expect(result).toContain('Assigned Rule');
    expect(result).not.toContain('extra-rule');
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

  it('agent teams mode annotates rules with model when model is set', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/project/.prosecheck/working/prompts/rule-a.md');

    const rule = makeRule('rule-a', 'No Console Log');
    rule.model = 'haiku';

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [rule],
      agentTeams: true,
    });

    expect(result).toContain('(use haiku)');
    expect(result).toContain('No Console Log (use haiku)');
  });

  it('agent teams mode does not annotate when model is undefined', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/project/.prosecheck/working/prompts/rule-a.md');

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [makeRule('rule-a', 'No Console Log')],
      agentTeams: true,
    });

    expect(result).not.toContain('(use ');
  });

  it('includes model selection instruction section when annotations present', () => {
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', '/project/.prosecheck/working/prompts/rule-a.md');

    const rule = makeRule('rule-a', 'No Console Log');
    rule.model = 'opus';

    const result = buildOrchestrationPrompt({
      projectRoot: '/project',
      promptPaths,
      rules: [rule],
      agentTeams: true,
    });

    expect(result).toContain('## Model selection');
    expect(result).toContain('use that model for the teammate');
  });
});
