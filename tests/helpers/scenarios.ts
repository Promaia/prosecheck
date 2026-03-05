import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import {
  createTestRepo,
  gitCommit,
  type TestRepo,
  type ExecaFn,
  type CreateTestRepoOptions,
} from './git-repo.js';

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

interface SetupProseCheckOptions {
  rules: string;
  configOverrides?: Record<string, unknown>;
}

async function setupProsecheck(
  dir: string,
  opts: SetupProseCheckOptions,
): Promise<void> {
  await mkdir(path.join(dir, '.prosecheck'), { recursive: true });
  const config = { baseBranch: 'main', ...opts.configOverrides };
  await writeFile(
    path.join(dir, '.prosecheck/config.json'),
    JSON.stringify(config),
    'utf-8',
  );
  await writeFile(path.join(dir, 'RULES.md'), opts.rules, 'utf-8');
}

// ---------------------------------------------------------------------------
// Scenario factories
// ---------------------------------------------------------------------------

export type ScenarioOptions = CreateTestRepoOptions;

/**
 * 1 rule (no TODO comments), source file with a `// TODO` violation.
 */
async function singleFailingRule(
  opts: ScenarioOptions = {},
): Promise<TestRepo> {
  const execFn = opts.execFn ?? (execa as ExecaFn);
  const repo = await createTestRepo({
    prefix: 'scenario-single-failing',
    ...opts,
  });

  await setupProsecheck(repo.dir, {
    rules:
      '# No TODO comments\n\nSource files must not contain TODO comments.\n',
  });
  await gitCommit(repo.dir, 'Add rules and config', execFn);

  await execFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
  await mkdir(path.join(repo.dir, 'src'), { recursive: true });
  await writeFile(
    path.join(repo.dir, 'src/app.ts'),
    '// TODO: fix this later\nexport const x = 1;\n',
    'utf-8',
  );
  await gitCommit(repo.dir, 'Add file with TODO', execFn);

  return repo;
}

/**
 * 1 rule (no TODO comments), source file with clean code (no violation).
 */
async function singlePassingRule(
  opts: ScenarioOptions = {},
): Promise<TestRepo> {
  const execFn = opts.execFn ?? (execa as ExecaFn);
  const repo = await createTestRepo({
    prefix: 'scenario-single-passing',
    ...opts,
  });

  await setupProsecheck(repo.dir, {
    rules:
      '# No TODO comments\n\nSource files must not contain TODO comments.\n',
  });
  await gitCommit(repo.dir, 'Add rules and config', execFn);

  await execFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
  await mkdir(path.join(repo.dir, 'src'), { recursive: true });
  await writeFile(
    path.join(repo.dir, 'src/app.ts'),
    'export const greeting = "hello world";\n',
    'utf-8',
  );
  await gitCommit(repo.dir, 'Add clean file', execFn);

  return repo;
}

/**
 * 2 rules (no TODO + no console.log), source file violating both.
 */
async function multiRuleViolations(
  opts: ScenarioOptions = {},
): Promise<TestRepo> {
  const execFn = opts.execFn ?? (execa as ExecaFn);
  const repo = await createTestRepo({
    prefix: 'scenario-multi-rule',
    ...opts,
  });

  const rules =
    [
      '# No TODO comments',
      '',
      'Source files must not contain TODO comments.',
      '',
      '# No console.log',
      '',
      'Do not use console.log in production source files.',
    ].join('\n') + '\n';

  await setupProsecheck(repo.dir, { rules });
  await gitCommit(repo.dir, 'Add rules and config', execFn);

  await execFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
  await mkdir(path.join(repo.dir, 'src'), { recursive: true });
  await writeFile(
    path.join(repo.dir, 'src/app.ts'),
    '// TODO: clean up\nconsole.log("debug");\nexport const x = 1;\n',
    'utf-8',
  );
  await gitCommit(repo.dir, 'Add file with violations', execFn);

  return repo;
}

/**
 * 2 rules (no console.log + keep functions short), `src/foo.ts` with console.log.
 * Used by integration pipeline tests.
 */
async function twoRulesMixed(opts: ScenarioOptions = {}): Promise<TestRepo> {
  const execFn = opts.execFn ?? (execa as ExecaFn);
  const repo = await createTestRepo({
    prefix: 'scenario-two-rules-mixed',
    ...opts,
  });

  const rules =
    [
      '# No console.log',
      '',
      'Do not use console.log in source files.',
      '',
      '# Keep functions short',
      '',
      'Functions should be under 50 lines.',
    ].join('\n') + '\n';

  await setupProsecheck(repo.dir, { rules });
  await gitCommit(repo.dir, 'Add rules and config', execFn);

  await execFn('git', ['checkout', '-b', 'feature'], { cwd: repo.dir });
  await mkdir(path.join(repo.dir, 'src'), { recursive: true });
  await writeFile(
    path.join(repo.dir, 'src/foo.ts'),
    'console.log("hello");\n',
    'utf-8',
  );
  await gitCommit(repo.dir, 'Add source file', execFn);

  return repo;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const scenarios: Record<
  string,
  (opts?: ScenarioOptions) => Promise<TestRepo>
> = {
  'single-failing-rule': singleFailingRule,
  'single-passing-rule': singlePassingRule,
  'multi-rule-violations': multiRuleViolations,
  'two-rules-mixed': twoRulesMixed,
};
