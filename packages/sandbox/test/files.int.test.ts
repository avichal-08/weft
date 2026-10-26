import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';
import type { Sandbox } from '../src/types.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
let sandbox: Sandbox;
let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'weft-files-'));
  await mkdir(join(repo, 'src'));
  await mkdir(join(repo, 'node_modules'));
  await writeFile(join(repo, 'src', 'index.ts'), 'export const x = 1;\n');
  await writeFile(join(repo, 'my notes.md'), 'spaces are fine\n');
  await writeFile(join(repo, 'run.sh'), '#!/bin/sh\necho ran\n');
  await chmod(join(repo, 'run.sh'), 0o755);
  await writeFile(join(repo, 'node_modules', 'big.js'), 'skip me\n');
  sandbox = await createSandbox({ image });
});

afterAll(async () => {
  await sandbox.destroy();
  await rm(repo, { recursive: true, force: true });
});

describe('putFiles', () => {
  it('copies a directory tree into the workspace', async () => {
    await sandbox.putFiles(repo, '/workspace/repo');
    expect(await sandbox.readFile('/workspace/repo/src/index.ts')).toBe('export const x = 1;\n');
    expect(await sandbox.readFile('/workspace/repo/my notes.md')).toBe('spaces are fine\n');
  });

  it('gives files to the sandbox user and keeps the executable bit', async () => {
    const res = await sandbox.exec('stat -c "%u %A" run.sh && ./run.sh', {
      cwd: '/workspace/repo',
    });
    expect(res.stdout).toBe('1000 -rwxr-xr-x\nran\n');
  });

  it('can skip paths', async () => {
    await sandbox.putFiles(repo, '/workspace/slim', {
      ignore: (path) => path.includes('node_modules'),
    });
    const res = await sandbox.exec('ls -A /workspace/slim');
    expect(res.stdout.split('\n')).not.toContain('node_modules');
    expect(res.stdout).toContain('src');
  });

  it('fails cleanly when the target filesystem is full', async () => {
    const big = await mkdtemp(join(tmpdir(), 'weft-big-'));
    await writeFile(join(big, 'blob.bin'), Buffer.alloc(3 * 1024 * 1024, 1));
    const tiny = await createSandbox({ image, limits: { tmpMb: 1 } });
    try {
      await expect(tiny.putFiles(big, '/tmp/in')).rejects.toThrow(
        /copying .* failed: tar: .*Wrote only/,
      );
      expect((await tiny.exec('echo alive')).stdout).toBe('alive\n');
    } finally {
      await tiny.destroy();
      await rm(big, { recursive: true, force: true });
    }
  });
});

describe('readFile', () => {
  it('throws for a missing file', async () => {
    await expect(sandbox.readFile('/workspace/nope.txt')).rejects.toThrow(/No such file/);
  });

  it('refuses files over the size limit', async () => {
    await sandbox.exec('head -c 5000 /dev/zero > /tmp/big');
    await expect(sandbox.readFile('/tmp/big', { maxBytes: 1000 })).rejects.toThrow(/larger than/);
  });
});

describe('exec stdin', () => {
  it('feeds a string to the command', async () => {
    const res = await sandbox.exec('wc -c', { stdin: 'hello' });
    expect(res.stdout.trim()).toBe('5');
  });
});
