import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecResult, Sandbox } from '@weft/sandbox';
import { detectSetup, runIncrementalSetup, runSetup } from '../src/setup.ts';

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

function fakeSandbox(answers: ((command: string) => Partial<ExecResult> | undefined)[]) {
  const commands: string[] = [];
  const sandbox = {
    exec: (command: string | string[]) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      commands.push(text);
      const answer = answers.map((a) => a(text)).find(Boolean) ?? {};
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false, ...answer });
    },
    killStrays: () => Promise.resolve(),
    disconnectNetwork: () => Promise.resolve(),
  } as unknown as Sandbox;
  return { sandbox, commands };
}

const npm = { manager: 'npm' as const, command: 'npm ci --no-audit --no-fund --loglevel=error' };

describe('runIncrementalSetup', () => {
  it('installs on top of the existing node_modules when that works', async () => {
    const { sandbox, commands } = fakeSandbox([]);
    expect(await runIncrementalSetup(sandbox, '/w', npm)).toBe(true);
    expect(commands.some((c) => c.includes('npm install --no-save'))).toBe(true);
    expect(commands.some((c) => c.includes('npm ci'))).toBe(false);
  });

  it('wipes node_modules and installs fresh when the incremental install fails', async () => {
    const reasons: string[] = [];
    const { sandbox, commands } = fakeSandbox([
      (c) => (c.includes('--no-save') ? { exitCode: 1, stderr: 'ERESOLVE' } : undefined),
    ]);
    expect(await runIncrementalSetup(sandbox, '/w', npm, (why) => reasons.push(why))).toBe(false);
    const wipe = commands.findIndex((c) => c.includes('-name node_modules'));
    expect(wipe).toBeGreaterThan(commands.findIndex((c) => c.includes('--no-save')));
    expect(commands.findIndex((c) => c.includes('npm ci'))).toBeGreaterThan(wipe);
    expect(reasons).toEqual([
      expect.stringMatching(/^npm install --no-save .* failed \(exit code 1\)$/),
    ]);
  });

  it('installs fresh for package managers without an incremental command', async () => {
    const { sandbox, commands } = fakeSandbox([]);
    const pnpm = { manager: 'pnpm' as const, command: 'pnpm install --frozen-lockfile' };
    expect(await runIncrementalSetup(sandbox, '/w', pnpm)).toBe(false);
    expect(commands.filter((c) => c.includes('pnpm install'))).toHaveLength(1);
  });
});

describe('runSetup', () => {
  it('retries the install once after a network error', async () => {
    let calls = 0;
    const { sandbox } = fakeSandbox([
      (c) =>
        c.includes('npm ci') && calls++ === 0
          ? { exitCode: 1, stderr: 'npm error code ECONNRESET' }
          : undefined,
    ]);
    await runSetup(sandbox, '/w', npm);
    expect(calls).toBe(2);
  });

  it("doesn't retry a failure that isn't the network", async () => {
    let calls = 0;
    const { sandbox } = fakeSandbox([
      (c) =>
        c.includes('npm ci') && ++calls
          ? { exitCode: 1, stderr: 'ERESOLVE could not resolve' }
          : undefined,
    ]);
    await expect(runSetup(sandbox, '/w', npm)).rejects.toThrow(/npm ci .* failed \(exit code 1\)/);
    expect(calls).toBe(1);
  });
});
