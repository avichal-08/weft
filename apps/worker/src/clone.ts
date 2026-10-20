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

export async function cloneRepo(
  url: string,
  ref: string | null,
  opts: { allowFileRepos: boolean },
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const protocol = new URL(url).protocol;
  if (protocol !== 'https:' && !(protocol === 'file:' && opts.allowFileRepos)) {
    throw new CloneError(`repository url scheme ${protocol} is not allowed`);
  }

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
    await run('git', args, {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    await cleanup();
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new CloneError(stderr || (err as Error).message);
  }
  return { dir, cleanup };
}
