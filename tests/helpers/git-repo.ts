import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { execa } from 'execa';

export interface TestRepo {
  dir: string;
  cleanup: () => Promise<void>;
}

/** The subset of execa's signature used by our helpers. */
export type ExecaFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<unknown>;

export interface CreateTestRepoOptions {
  /** Temp directory name prefix (default: `"prosecheck-test"`) */
  prefix?: string;
  /** Exec function — defaults to real `execa`. Pass a mock for integration tests. */
  execFn?: ExecaFn;
}

export async function createTestRepo(
  options: CreateTestRepoOptions = {},
): Promise<TestRepo> {
  const { prefix = 'prosecheck-test', execFn = execa as ExecaFn } = options;
  const suffix = randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), `${prefix}-${suffix}`);
  await mkdir(dir, { recursive: true });

  await execFn('git', ['init'], { cwd: dir });
  await execFn('git', ['checkout', '-b', 'main'], { cwd: dir });
  await execFn('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await execFn('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  // Initial commit so HEAD exists
  const readmePath = path.join(dir, 'README.md');
  await writeFile(readmePath, '# test\n', 'utf-8');
  await gitCommit(dir, 'Initial commit', execFn);

  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function gitCommit(
  dir: string,
  message: string,
  execFn: ExecaFn = execa as ExecaFn,
): Promise<void> {
  await execFn('git', ['add', '-A'], { cwd: dir });
  await execFn('git', ['commit', '-m', message, '--allow-empty-message'], {
    cwd: dir,
  });
}

export async function writeTestFile(
  dir: string,
  relativePath: string,
  content = '// placeholder\n',
): Promise<void> {
  const fullPath = path.join(dir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}
