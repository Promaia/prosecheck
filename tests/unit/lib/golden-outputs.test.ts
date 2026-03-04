import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { glob } from 'glob';
import path from 'node:path';
import { parseResultFile } from '../../../src/lib/results.js';

const GOLDEN_DIR = path.resolve('tests/fixtures/golden-outputs');

/** Load all golden output JSON files */
async function loadGoldenFiles(): Promise<{ name: string; content: string }[]> {
  const files = await glob('*.json', { cwd: GOLDEN_DIR });
  return Promise.all(
    files.sort().map(async (name) => ({
      name,
      content: await readFile(path.join(GOLDEN_DIR, name), 'utf-8'),
    })),
  );
}

describe('golden output contract tests', () => {
  it('has at least 8 golden files', async () => {
    const files = await loadGoldenFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('all golden files parse successfully', async () => {
    const files = await loadGoldenFiles();
    for (const { name, content } of files) {
      const result = parseResultFile(content, `golden-${name}`);
      expect(
        result.ok,
        `Failed to parse ${name}: ${'message' in result ? result.message : ''}`,
      ).toBe(true);
    }
  });

  it('status matches filename prefix', async () => {
    const files = await loadGoldenFiles();
    for (const { name, content } of files) {
      const result = parseResultFile(content, `golden-${name}`);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const expectedStatus = name.split('-')[0] ?? ''; // pass, warn, fail
      expect(
        result.result.status,
        `${name} should have status "${expectedStatus}"`,
      ).toBe(expectedStatus);
    }
  });

  it('warn/fail results have headline and non-empty comments', async () => {
    const files = await loadGoldenFiles();
    for (const { name, content } of files) {
      const result = parseResultFile(content, `golden-${name}`);
      if (!result.ok) continue;

      const r = result.result;
      if (r.status === 'warn' || r.status === 'fail') {
        expect(r.headline, `${name} should have headline`).toBeTruthy();
        expect(
          r.comments.length,
          `${name} should have non-empty comments`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('pass results do not require headline or comments', async () => {
    const files = await loadGoldenFiles();
    const passFiles = files.filter((f) => f.name.startsWith('pass-'));
    expect(passFiles.length).toBeGreaterThan(0);

    for (const { name, content } of passFiles) {
      const result = parseResultFile(content, `golden-${name}`);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.result.status).toBe('pass');
    }
  });
});

describe('prompt template regression', () => {
  it('DEFAULT_TEMPLATE contains output instruction and all three status examples', async () => {
    // Import the template by loading the module
    const promptModule = await import('../../../src/lib/prompt.js');
    // loadTemplate with a non-existent project root returns the default
    const template = await promptModule.loadTemplate(
      '/nonexistent-path-for-test',
    );

    // Should contain output instruction marker
    expect(template).toContain('Write your result as JSON');

    // Should contain all three status examples
    expect(template).toContain('"status": "pass"');
    expect(template).toContain('"status": "warn"');
    expect(template).toContain('"status": "fail"');

    // Should contain key schema fields
    expect(template).toContain('"headline"');
    expect(template).toContain('"comments"');
    expect(template).toContain('"rule"');
    expect(template).toContain('"source"');
  });

  it('all golden outputs parse against current RuleResultSchema', async () => {
    const { RuleResultSchema } =
      await import('../../../src/lib/config-schema.js');
    const files = await loadGoldenFiles();

    for (const { name, content } of files) {
      const parsed: unknown = JSON.parse(content);
      const validation = RuleResultSchema.safeParse(parsed);
      expect(
        validation.success,
        `${name} should validate against RuleResultSchema: ${
          !validation.success ? JSON.stringify(validation.error.issues) : ''
        }`,
      ).toBe(true);
    }
  });
});
