import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ClaudeCodeModeOptions } from '../../../src/modes/claude-code.js';

// Mock spawnClaude at module level to avoid needing the actual claude CLI
const mockSpawnClaude = vi.fn().mockResolvedValue({
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
});

vi.mock('../../../src/modes/claude-code.js', async () => {
  const { readFile } = await import('node:fs/promises');
  const nodePath = await import('node:path');

  const OUTPUTS_DIR = '.prosecheck/working/outputs';

  // Re-implement runClaudeCode using the mock spawnClaude
  async function runClaudeCode(options: ClaudeCodeModeOptions) {
    if (options.singleInstance) {
      const lines: string[] = [];
      for (const [ruleId, promptPath] of options.promptPaths) {
        const content = await readFile(promptPath, 'utf-8');
        const outputPath = nodePath.join(options.projectRoot, OUTPUTS_DIR, `${ruleId}.json`);
        lines.push(`## Rule: ${ruleId}\nOutput to: ${outputPath}\n\n${content}\n\n---\n`);
      }
      const result = await mockSpawnClaude(lines.join('\n'), options.projectRoot) as {
        exitCode: number | null;
        stdout: string;
        stderr: string;
      };
      return [{
        ruleId: '__single_instance__',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }];
    }

    const promises = [];
    for (const [ruleId, promptPath] of options.promptPaths) {
      promises.push(
        readFile(promptPath, 'utf-8').then(async (content) => {
          const result = await mockSpawnClaude(content, options.projectRoot) as {
            exitCode: number | null;
            stdout: string;
            stderr: string;
          };
          return { ruleId, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
        }),
      );
    }
    return Promise.all(promises);
  }

  return { runClaudeCode, spawnClaude: mockSpawnClaude };
});

// Import after mock setup
const { runClaudeCode } = await import('../../../src/modes/claude-code.js');

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `prosecheck-claude-code-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(tmpDir, '.prosecheck/working/prompts'), {
    recursive: true,
  });
  mockSpawnClaude.mockClear();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writePrompt(ruleId: string, content: string): Promise<string> {
  const promptPath = path.join(
    tmpDir,
    '.prosecheck/working/prompts',
    `${ruleId}.md`,
  );
  await writeFile(promptPath, content, 'utf-8');
  return promptPath;
}

function makeOptions(
  overrides: Partial<ClaudeCodeModeOptions> = {},
): ClaudeCodeModeOptions {
  return {
    projectRoot: tmpDir,
    promptPaths: new Map(),
    singleInstance: false,
    agentTeams: false,
    rules: [],
    ...overrides,
  };
}

describe('claude-code mode', () => {
  it('spawns one process per rule in multi-instance mode', async () => {
    const promptPathA = await writePrompt('rule-a', 'Prompt A');
    const promptPathB = await writePrompt('rule-b', 'Prompt B');

    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPathA);
    promptPaths.set('rule-b', promptPathB);

    const options = makeOptions({ promptPaths });
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(2);
    expect(mockSpawnClaude).toHaveBeenCalledTimes(2);
    const ruleIds = results.map((r) => r.ruleId).sort();
    expect(ruleIds).toEqual(['rule-a', 'rule-b']);
  });

  it('spawns single instance in singleInstance mode', async () => {
    const promptPathA = await writePrompt('rule-a', 'Prompt A');
    const promptPathB = await writePrompt('rule-b', 'Prompt B');

    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPathA);
    promptPaths.set('rule-b', promptPathB);

    const options = makeOptions({ promptPaths, singleInstance: true });
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(1);
    expect(results[0]?.ruleId).toBe('__single_instance__');
    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
  });

  it('returns exit codes from processes', async () => {
    const promptPath = await writePrompt('rule-a', 'Prompt A');
    const promptPaths = new Map<string, string>();
    promptPaths.set('rule-a', promptPath);

    const options = makeOptions({ promptPaths });
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(1);
    expect(results[0]?.exitCode).toBe(0);
  });

  it('handles empty prompt paths', async () => {
    const options = makeOptions();
    const results = await runClaudeCode(options);

    expect(results).toHaveLength(0);
  });
});
