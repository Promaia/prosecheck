import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';

export interface InitOptions {
  /** Project root directory */
  projectRoot: string;
  /** Whether to create a starter RULES.md */
  createRules: boolean;
}

const DEFAULT_CONFIG = {
  baseBranch: 'main',
  globalIgnore: ['node_modules/', 'dist/', '.git/'],
  ruleCalculators: [{ name: 'rules-md' }],
};

const STARTER_RULES = `# Rules

## No console.log in production code

Production source files should not contain \`console.log\` statements. Use a proper logging library instead.

**Scope:** \`src/\`

## Keep functions under 50 lines

Functions should be concise and focused. If a function exceeds 50 lines, consider refactoring it into smaller helper functions.

**Scope:** \`src/\`
`;

const GITIGNORE_ENTRIES = [
  '.prosecheck/working/',
  '.prosecheck/config.local.json',
  '.prosecheck/last-user-run',
];

/**
 * Initialize prosecheck in a project.
 *
 * 1. Create `.prosecheck/` directory
 * 2. Write default `config.json`
 * 3. Add entries to `.gitignore`
 * 4. Optionally create a starter `RULES.md`
 */
export async function init(options: InitOptions): Promise<void> {
  const { projectRoot, createRules } = options;
  const prosecheckDir = path.join(projectRoot, '.prosecheck');

  // Check if already initialized
  const configPath = path.join(prosecheckDir, 'config.json');
  if (await fileExists(configPath)) {
    process.stdout.write(
      'prosecheck is already initialized in this project.\n',
    );
    return;
  }

  // 1. Create directories (working/ shows users the full structure upfront;
  //    the engine wipes and recreates it on each lint run)
  await mkdir(prosecheckDir, { recursive: true });
  await mkdir(path.join(prosecheckDir, 'working'), { recursive: true });

  // 2. Write default config
  await writeFile(
    configPath,
    JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
    'utf-8',
  );
  process.stdout.write('Created .prosecheck/config.json\n');

  // 3. Update .gitignore
  await updateGitignore(projectRoot);

  // 4. Optionally create starter RULES.md
  if (createRules) {
    const rulesPath = path.join(projectRoot, 'RULES.md');
    if (await fileExists(rulesPath)) {
      process.stdout.write('RULES.md already exists, skipping.\n');
    } else {
      await writeFile(rulesPath, STARTER_RULES, 'utf-8');
      process.stdout.write('Created RULES.md with starter rules\n');
    }
  }

  process.stdout.write('prosecheck initialized successfully.\n');
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
