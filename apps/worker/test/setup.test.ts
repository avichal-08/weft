import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectSetup } from '../src/setup.ts';

const dirs: string[] = [];

async function repo(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'weft-setup-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  return dir;
}

const pkg = (deps: Record<string, string> = { ms: '2.1.3' }) =>
  JSON.stringify({ dependencies: deps });

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('detectSetup', () => {
  it('skips repos without a package.json or without dependencies', async () => {
    expect(await detectSetup(await repo({ 'README.md': '# hi' }))).toBeNull();
    expect(await detectSetup(await repo({ 'package.json': pkg({}) }))).toBeNull();
    expect(await detectSetup(await repo({ 'package.json': '{ not json' }))).toBeNull();
  });

  it('uses npm ci with a package-lock', async () => {
    const plan = await detectSetup(
      await repo({ 'package.json': pkg(), 'package-lock.json': '{}' }),
    );
    expect(plan).toEqual({
      manager: 'npm',
      command: 'npm ci --no-audit --no-fund --loglevel=error',
    });
  });

  it('falls back to npm install without a lockfile', async () => {
    expect((await detectSetup(await repo({ 'package.json': pkg() })))?.command).toMatch(
      /^npm install /,
    );
  });

  it('prefers pnpm, then yarn, by lockfile', async () => {
    expect(
      await detectSetup(
        await repo({ 'package.json': pkg(), 'pnpm-lock.yaml': '', 'package-lock.json': '{}' }),
      ),
    ).toEqual({ manager: 'pnpm', command: 'pnpm install --frozen-lockfile' });
    expect(
      (await detectSetup(await repo({ 'package.json': pkg(), 'yarn.lock': '' })))?.command,
    ).toBe('yarn install --frozen-lockfile');
    expect(
      (await detectSetup(await repo({ 'package.json': pkg(), 'yarn.lock': '', '.yarnrc.yml': '' })))
        ?.command,
    ).toBe('yarn install --immutable');
  });

  it('uses bun with a bun lockfile, text or binary', async () => {
    for (const lock of ['bun.lock', 'bun.lockb']) {
      expect(await detectSetup(await repo({ 'package.json': pkg(), [lock]: '' }))).toEqual({
        manager: 'bun',
        command: 'bun install --frozen-lockfile',
      });
    }
  });

  it('follows packageManager when there is no lockfile', async () => {
    const managed = (packageManager: string) =>
      JSON.stringify({ packageManager, dependencies: { ms: '2.1.3' } });
    expect(await detectSetup(await repo({ 'package.json': managed('bun@1.3.6') }))).toEqual({
      manager: 'bun',
      command: 'bun install',
    });
    expect(await detectSetup(await repo({ 'package.json': managed('pnpm@10.33.0') }))).toEqual({
      manager: 'pnpm',
      command: 'pnpm install',
    });
    expect(await detectSetup(await repo({ 'package.json': managed('cargo@1') }))).toMatchObject({
      manager: 'npm',
    });
  });

  it('counts dev dependencies too', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
    });
    expect((await detectSetup(dir))?.manager).toBe('npm');
  });
});
