import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLONE_TIMEOUT_MS = 120_000;

export class CloneError extends Error {
  override name = 'CloneError';
}

export type Checkout = { dir: string; commit: string; cleanup: () => Promise<void> };

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });

function checkScheme(url: string, allowFileRepos: boolean) {
  const protocol = new URL(url).protocol;
  if (protocol !== 'https:' && !(protocol === 'file:' && allowFileRepos)) {
    throw new CloneError(`repository url scheme ${protocol} is not allowed`);
  }
}

export async function remoteHead(
  url: string,
  ref: string | null,
  opts: { allowFileRepos: boolean },
): Promise<string | null> {
  checkScheme(url, opts.allowFileRepos);
  const { stdout } = await run('git', ['ls-remote', '--', url, ref ?? 'HEAD'], {
    timeout: 30_000,
    env: gitEnv(),
  });
  return stdout.split(/\s/, 1)[0] || null;
}

export async function cloneRepo(
  url: string,
  ref: string | null,
  opts: { allowFileRepos: boolean },
): Promise<Checkout> {
  checkScheme(url, opts.allowFileRepos);

  const dir = await mkdtemp(join(tmpdir(), 'weft-clone-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  const args = [
    'clone',
    '--quiet',
    '--depth',
    '1',
    ...(ref ? ['--branch', ref] : []),
    '--',
    url,
    dir,
  ];

  try {
    await run('git', args, { timeout: CLONE_TIMEOUT_MS, env: gitEnv() });
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return { dir, commit: stdout.trim(), cleanup };
  } catch (err) {
    await cleanup();
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new CloneError(stderr || (err as Error).message);
  }
}
