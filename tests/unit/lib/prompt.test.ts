import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadTemplate,
  loadGlobalPrompt,
  buildPromptVariables,
  interpolateTemplate,
  generatePrompt,
  generatePrompts,
} from '../../../src/lib/prompt.js';
import { createRule } from '../../../src/lib/rule.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-prompt-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
  await mkdir(path.join(tmpDir, '.prosecheck'), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('loadTemplate', () => {
  it('returns default template when no custom template exists', async () => {
    const template = await loadTemplate(tmpDir);

    expect(template).toContain('{{ruleText}}');
    expect(template).toContain('{{comparisonRef}}');
    expect(template).toContain('{{changedFilesList}}');
    expect(template).toContain('{{outputPath}}');
  });

  it('loads custom template from .prosecheck/prompt-template.md', async () => {
    const customTemplate = 'Custom: {{ruleText}} ref={{comparisonRef}}';
    await writeFile(
      path.join(tmpDir, '.prosecheck/prompt-template.md'),
      customTemplate,
    );

    const template = await loadTemplate(tmpDir);

    expect(template).toBe(customTemplate);
  });
});

describe('loadGlobalPrompt', () => {
  it('returns undefined when no global prompt exists', async () => {
    const result = await loadGlobalPrompt(tmpDir);

    expect(result).toBeUndefined();
  });

  it('loads global prompt from .prosecheck/prompt.md', async () => {
    await writeFile(
      path.join(tmpDir, '.prosecheck/prompt.md'),
      'You are a strict code reviewer.\n',
    );

    const result = await loadGlobalPrompt(tmpDir);

    expect(result).toBe('You are a strict code reviewer.');
  });

  it('returns undefined for empty global prompt file', async () => {
    await writeFile(path.join(tmpDir, '.prosecheck/prompt.md'), '  \n');

    const result = await loadGlobalPrompt(tmpDir);

    expect(result).toBeUndefined();
  });
});

describe('buildPromptVariables', () => {
  it('builds variables from rule and context', () => {
    const rule = createRule(
      'No console.log',
      'Remove all console.log statements',
      ['src/'],
      'src/RULES.md',
    );

    const vars = buildPromptVariables(rule, 'abc123', ['src/foo.ts'], tmpDir);

    expect(vars.ruleText).toBe('# No console.log\n\nRemove all console.log statements');
    expect(vars.comparisonRef).toBe('abc123');
    expect(vars.changedFiles).toEqual(['src/foo.ts']);
    expect(vars.scope).toEqual(['src/']);
    expect(vars.outputPath).toContain('.prosecheck/working/outputs/');
    expect(vars.outputPath).toContain(`${rule.id}.json`);
    expect(vars.ruleId).toBe(rule.id);
  });

  it('uses "(all files)" when inclusions are empty', () => {
    const rule = createRule('Global rule', 'Applies everywhere', [], 'RULES.md');

    const vars = buildPromptVariables(rule, 'abc123', [], tmpDir);

    expect(vars.scope).toEqual(['(all files)']);
  });
});

describe('interpolateTemplate', () => {
  const rule = createRule(
    'No console.log',
    'Remove all console.log statements',
    ['src/'],
    'src/RULES.md',
  );

  it('replaces all template variables', () => {
    const template = '{{ruleName}} | {{ruleText}} | {{comparisonRef}} | {{changedFilesList}} | {{scopeList}} | {{outputPath}} | {{ruleId}} | {{ruleSource}}';
    const vars = buildPromptVariables(rule, 'abc123', ['src/foo.ts'], tmpDir);

    const result = interpolateTemplate(template, vars, rule);

    expect(result).toContain('No console.log');
    expect(result).toContain('# No console.log');
    expect(result).toContain('abc123');
    expect(result).toContain('`src/foo.ts`');
    expect(result).toContain('`src/`');
    expect(result).toContain(rule.id);
    expect(result).toContain('src/RULES.md');
  });

  it('formats changed files as markdown list', () => {
    const template = '{{changedFilesList}}';
    const vars = buildPromptVariables(
      rule,
      'abc123',
      ['src/a.ts', 'src/b.ts'],
      tmpDir,
    );

    const result = interpolateTemplate(template, vars, rule);

    expect(result).toBe('- `src/a.ts`\n- `src/b.ts`');
  });

  it('shows placeholder when no changed files', () => {
    const template = '{{changedFilesList}}';
    const vars = buildPromptVariables(rule, 'abc123', [], tmpDir);

    const result = interpolateTemplate(template, vars, rule);

    expect(result).toBe('- (no changed files)');
  });

  it('formats scope as markdown list', () => {
    const multiScopeRule = createRule(
      'Multi scope',
      'Desc',
      ['src/api/', 'src/lib/'],
      'RULES.md',
    );
    const template = '{{scopeList}}';
    const vars = buildPromptVariables(multiScopeRule, 'abc123', [], tmpDir);

    const result = interpolateTemplate(template, vars, multiScopeRule);

    expect(result).toBe('- `src/api/`\n- `src/lib/`');
  });
});

describe('generatePrompt', () => {
  const rule = createRule(
    'No console.log',
    'Remove all console.log statements',
    ['src/'],
    'src/RULES.md',
  );

  it('writes a prompt file and returns its path', async () => {
    const template = await loadTemplate(tmpDir);
    const promptPath = await generatePrompt(
      {
        projectRoot: tmpDir,
        rule,
        comparisonRef: 'abc123',
        changedFiles: ['src/foo.ts'],
      },
      template,
      undefined,
    );

    expect(promptPath).toContain(`${rule.id}.md`);

    const content = await readFile(promptPath, 'utf-8');
    expect(content).toContain('No console.log');
    expect(content).toContain('abc123');
    expect(content).toContain('src/foo.ts');
  });

  it('prepends global prompt when provided', async () => {
    const template = await loadTemplate(tmpDir);
    const promptPath = await generatePrompt(
      {
        projectRoot: tmpDir,
        rule,
        comparisonRef: 'abc123',
        changedFiles: [],
      },
      template,
      'You are a strict code reviewer.',
    );

    const content = await readFile(promptPath, 'utf-8');
    expect(content).toMatch(/^You are a strict code reviewer\./);
    expect(content).toContain('---');
    expect(content).toContain('No console.log');
  });
});

describe('generatePrompts', () => {
  it('generates prompt files for all rules', async () => {
    const ruleA = createRule('Rule A', 'Description A', ['src/'], 'src/RULES.md');
    const ruleB = createRule('Rule B', 'Description B', ['docs/'], 'docs/RULES.md');
    const rules = [ruleA, ruleB];

    const changedFilesByRule = new Map<string, string[]>();
    changedFilesByRule.set(ruleA.id, ['src/foo.ts']);
    changedFilesByRule.set(ruleB.id, ['docs/readme.md']);

    const result = await generatePrompts({
      projectRoot: tmpDir,
      rules,
      comparisonRef: 'abc123',
      changedFilesByRule,
    });

    expect(result.promptPaths.size).toBe(2);

    for (const rule of rules) {
      const promptPath = result.promptPaths.get(rule.id);
      expect(promptPath).toBeDefined();
      if (!promptPath) continue;
      const content = await readFile(promptPath, 'utf-8');
      expect(content).toContain(rule.name);
      expect(content).toContain('abc123');
    }
  });

  it('uses custom template and global prompt when present', async () => {
    await writeFile(
      path.join(tmpDir, '.prosecheck/prompt-template.md'),
      'CUSTOM: {{ruleName}} against {{comparisonRef}}',
    );
    await writeFile(
      path.join(tmpDir, '.prosecheck/prompt.md'),
      'GLOBAL SYSTEM PROMPT',
    );

    const ruleA = createRule('Rule A', 'Description A', ['src/'], 'src/RULES.md');
    const rules = [ruleA];
    const changedFilesByRule = new Map<string, string[]>();
    changedFilesByRule.set(ruleA.id, ['src/foo.ts']);

    const result = await generatePrompts({
      projectRoot: tmpDir,
      rules,
      comparisonRef: 'def456',
      changedFilesByRule,
    });

    const promptPath = result.promptPaths.get(ruleA.id);
    expect(promptPath).toBeDefined();
    if (!promptPath) return;
    const content = await readFile(promptPath, 'utf-8');
    expect(content).toMatch(/^GLOBAL SYSTEM PROMPT/);
    expect(content).toContain('CUSTOM: Rule A against def456');
  });

  it('handles rules with no changed files gracefully', async () => {
    const ruleA = createRule('Rule A', 'Description A', ['src/'], 'src/RULES.md');
    const rules = [ruleA];
    const changedFilesByRule = new Map<string, string[]>();
    // Rule A not in the map — should get empty changed files

    const result = await generatePrompts({
      projectRoot: tmpDir,
      rules,
      comparisonRef: 'abc123',
      changedFilesByRule,
    });

    expect(result.promptPaths.size).toBe(1);
    const promptPath = result.promptPaths.get(ruleA.id);
    expect(promptPath).toBeDefined();
    if (!promptPath) return;
    const content = await readFile(promptPath, 'utf-8');
    expect(content).toContain('(no changed files)');
  });
});
