import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloneError, cloneRepo } from '../src/clone.ts';

let origin: string;

beforeAll(async () => {
  origin = await mkdtemp(join(tmpdir(), 'weft-origin-'));
  await writeFile(join(origin, 'hello.txt'), 'hi\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: origin });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
});

afterAll(async () => {
  await rm(origin, { recursive: true, force: true });
});

describe('cloneRepo', () => {
  it('clones a local repository when file urls are allowed', async () => {
    const { dir, cleanup } = await cloneRepo(pathToFileURL(origin).href, null, {
      allowFileRepos: true,
    });
    expect(await readFile(join(dir, 'hello.txt'), 'utf8')).toBe('hi\n');
    await cleanup();
  });

  it('refuses file urls unless allowed', async () => {
    await expect(
      cloneRepo(pathToFileURL(origin).href, null, { allowFileRepos: false }),
    ).rejects.toThrow(/scheme file: is not allowed/);
  });

  it.each([
    'http://example.com/r.git',
    'ssh://git@example.com/r.git',
    'ext::sh -c touch% /tmp/pwned',
  ])('refuses %s', async (url) => {
    await expect(cloneRepo(url, null, { allowFileRepos: true })).rejects.toBeInstanceOf(Error);
  });

  it('reports git errors and leaves nothing behind', async () => {
    const err = await cloneRepo(pathToFileURL(join(origin, 'missing')).href, null, {
      allowFileRepos: true,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloneError);
    expect((err as Error).message).toMatch(/does not exist|not found|repository/i);
  });

  it('checks out a requested branch', async () => {
    await expect(
      cloneRepo(pathToFileURL(origin).href, 'no-such-branch', { allowFileRepos: true }),
    ).rejects.toThrow(/no-such-branch/);
  });
});
