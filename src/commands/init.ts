import { mkdir, writeFile, readFile, access, chmod } from 'node:fs/promises';
import path from 'node:path';
import {
  buildFullWorkflow,
  buildIncrementalPrWorkflow,
  buildMergeQueueWorkflow,
  WORKFLOW_HASH_CHECK,
} from '../templates/workflows.js';

export interface InitOptions {
  /** Project root directory */
  projectRoot: string;
  /** Whether to create a starter RULES.md */
  createRules: boolean;
  /** Generate a full-check GitHub Actions workflow */
  githubActions?: boolean;
  /** Generate incremental GitHub Actions workflows (PR + merge queue) */
  githubActionsIncremental?: boolean;
  /** Generate a hash-check GitHub Actions workflow */
  githubActionsHashCheck?: boolean;
  /** Install a git pre-push hook */
  gitPrePush?: boolean;
  /** Add a Claude Code Stop hook */
  claudeStopHook?: boolean;
  /** Include SARIF upload in generated workflows (default: true) */
  sarif?: boolean | undefined;
}

const DEFAULT_CONFIG = {
  baseBranch: 'main',
  globalIgnore: ['.git/', 'node_modules/', 'dist/', 'build/', '.prosecheck/'],
  ruleCalculators: [{ name: 'rules-md' }],
};

const STARTER_RULES = `# Rules

## No console.log in production code

Production source files should not contain \`console.log\` statements. Use a proper logging library instead.

## Keep functions under 50 lines

Functions should be concise and focused. If a function exceeds 50 lines, consider refactoring it into smaller helper functions.
`;

const GITIGNORE_ENTRIES = [
  '.prosecheck/working/',
  '.prosecheck/output.*',
  '.prosecheck/config.local.json',
  '.prosecheck/.runlock',
];

const PRE_PUSH_HOOK = `#!/bin/sh
# prosecheck pre-push hook
npx prosecheck lint
`;

/**
 * Initialize prosecheck in a project.
 *
 * First run creates `.prosecheck/` directory, config, and gitignore entries.
 * Subsequent runs skip base setup but still process integration flags.
 */
export async function init(options: InitOptions): Promise<void> {
  const { projectRoot } = options;
  const sarif = options.sarif ?? true;
  const prosecheckDir = path.join(projectRoot, '.prosecheck');
  const configPath = path.join(prosecheckDir, 'config.json');
  const alreadyInitialized = await fileExists(configPath);

  const hasIntegrationFlags =
    options.createRules ||
    options.githubActions ||
    options.githubActionsIncremental ||
    options.githubActionsHashCheck ||
    options.gitPrePush ||
    options.claudeStopHook;

  if (alreadyInitialized && !hasIntegrationFlags) {
    process.stdout.write(
      'prosecheck is already initialized in this project.\n',
    );
    return;
  }

  // Base setup (only on first init)
  if (!alreadyInitialized) {
    await mkdir(prosecheckDir, { recursive: true });
    await mkdir(path.join(prosecheckDir, 'working'), { recursive: true });

    await writeFile(
      configPath,
      JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
      'utf-8',
    );
    process.stdout.write('Created .prosecheck/config.json\n');

    await updateGitignore(projectRoot);
  }

  // Integration flags (run on every invocation when specified)
  if (options.createRules) {
    await createStarterRules(projectRoot);
  }

  if (options.githubActions) {
    await writeWorkflow(
      projectRoot,
      'prosecheck.yml',
      buildFullWorkflow(sarif),
    );
  }

  if (options.githubActionsIncremental) {
    await writeWorkflow(
      projectRoot,
      'prosecheck-incremental.yml',
      buildIncrementalPrWorkflow(sarif),
    );
    await writeWorkflow(
      projectRoot,
      'prosecheck-merge-queue.yml',
      buildMergeQueueWorkflow(sarif),
    );
    await setInteractiveLastRun(projectRoot, { write: true, read: true });
  }

  if (options.githubActionsHashCheck) {
    await writeWorkflow(
      projectRoot,
      'prosecheck-hash-check.yml',
      WORKFLOW_HASH_CHECK,
    );
    await setInteractiveLastRun(projectRoot, { write: true });
  }

  if (options.gitPrePush) {
    await installPrePushHook(projectRoot);
  }

  if (options.claudeStopHook) {
    await addClaudeStopHook(projectRoot);
  }

  if (!alreadyInitialized) {
    process.stdout.write('prosecheck initialized successfully.\n');
  }
}

// --- Helpers ---

async function createStarterRules(projectRoot: string): Promise<void> {
  const rulesPath = path.join(projectRoot, 'RULES.md');
  if (await fileExists(rulesPath)) {
    process.stdout.write('RULES.md already exists, skipping.\n');
  } else {
    await writeFile(rulesPath, STARTER_RULES, 'utf-8');
    process.stdout.write('Created RULES.md with starter rules\n');
  }
}

async function writeWorkflow(
  projectRoot: string,
  filename: string,
  content: string,
): Promise<void> {
  const workflowDir = path.join(projectRoot, '.github', 'workflows');
  const workflowPath = path.join(workflowDir, filename);

  if (await fileExists(workflowPath)) {
    process.stdout.write(`${filename} already exists, skipping.\n`);
    return;
  }

  await mkdir(workflowDir, { recursive: true });
  await writeFile(workflowPath, content, 'utf-8');
  process.stdout.write(`Created .github/workflows/${filename}\n`);
}

async function setInteractiveLastRun(
  projectRoot: string,
  fields: Record<string, boolean>,
): Promise<void> {
  const configPath = path.join(projectRoot, '.prosecheck', 'config.json');
  let config: Record<string, unknown> = {};

  try {
    const raw = await readFile(configPath, 'utf-8');
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Config may not exist yet if called during first init
  }

  const environments = (config['environments'] ?? {}) as Record<
    string,
    unknown
  >;
  const interactive = (environments['interactive'] ?? {}) as Record<
    string,
    unknown
  >;
  const lastRun = (interactive['lastRun'] ?? {}) as Record<string, unknown>;

  let changed = false;
  for (const [key, value] of Object.entries(fields)) {
    if (lastRun[key] !== value) {
      lastRun[key] = value;
      changed = true;
    }
  }

  if (!changed) return;

  interactive['lastRun'] = lastRun;
  environments['interactive'] = interactive;
  config['environments'] = environments;

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  const setFields = Object.entries(fields)
    .map(([k, v]) => `lastRun.${k}=${String(v)}`)
    .join(', ');
  process.stdout.write(
    `Set ${setFields} for interactive environment in config.json\n`,
  );
}

async function installPrePushHook(projectRoot: string): Promise<void> {
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'pre-push');

  if (await fileExists(hookPath)) {
    const existing = await readFile(hookPath, 'utf-8');
    if (existing.includes('prosecheck')) {
      process.stdout.write(
        'pre-push hook already contains prosecheck, skipping.\n',
      );
      return;
    }
    // Append to existing hook
    const separator = existing.endsWith('\n') ? '' : '\n';
    await writeFile(
      hookPath,
      existing + separator + '\n# prosecheck\nnpx prosecheck lint\n',
      'utf-8',
    );
    process.stdout.write('Appended prosecheck to existing pre-push hook\n');
  } else {
    await mkdir(hooksDir, { recursive: true });
    await writeFile(hookPath, PRE_PUSH_HOOK, 'utf-8');
    await chmod(hookPath, 0o755);
    process.stdout.write('Created .git/hooks/pre-push\n');
  }
}

async function addClaudeStopHook(projectRoot: string): Promise<void> {
  const claudeDir = path.join(projectRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  let settings: Record<string, unknown> = {};

  if (await fileExists(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Malformed JSON — start fresh
    }
  }

  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;
  const stopHooks = (hooks['Stop'] ?? []) as Array<Record<string, unknown>>;

  // Check if prosecheck hook already exists
  if (
    stopHooks.some((h) => {
      const cmd = h['command'];
      return typeof cmd === 'string' && cmd.includes('prosecheck');
    })
  ) {
    process.stdout.write(
      'Claude Stop hook already contains prosecheck, skipping.\n',
    );
    return;
  }

  stopHooks.push({
    matcher: '',
    command: 'npx prosecheck lint',
  });

  hooks['Stop'] = stopHooks;
  settings['hooks'] = hooks;

  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );
  process.stdout.write('Added prosecheck Stop hook to .claude/settings.json\n');
}

async function updateGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');

  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf-8');
  } catch {
    // No existing .gitignore
  }

  const linesToAdd: string[] = [];
  for (const entry of GITIGNORE_ENTRIES) {
    if (!existing.includes(entry)) {
      linesToAdd.push(entry);
    }
  }

  if (linesToAdd.length === 0) {
    return;
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const header = existing.includes('prosecheck') ? '' : '\n# prosecheck\n';
  const addition = separator + header + linesToAdd.join('\n') + '\n';

  await writeFile(gitignorePath, existing + addition, 'utf-8');
  process.stdout.write('Updated .gitignore\n');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
