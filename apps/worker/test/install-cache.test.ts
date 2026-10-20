import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evict, installKey, touchesManifests } from '../src/install-cache.ts';

const dirs: string[] = [];

async function tree(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'weft-cache-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const parts = { repoUrl: 'https://github.com/a/b', imageId: 'sha256:1', command: 'npm ci' };
const monorepo = {
  'package.json': '{"workspaces":["apps/*"]}',
  'package-lock.json': '{"v":1}',
  'apps/web/package.json': '{"dependencies":{"ms":"2.1.3"}}',
  'src/index.js': 'console.log(1)',
};

describe('installKey', () => {
  it('is stable for the same dependency files and ignores everything else', async () => {
    const a = await installKey(await tree(monorepo), parts);
    const b = await installKey(
      await tree({
        ...monorepo,
        'src/index.js': 'changed',
        'node_modules/x/package.json': '{}',
        '.git/package.json': '{}',
      }),
      parts,
    );
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('changes with the lockfile, a nested package.json, the repo, the image or the command', async () => {
    const key = await installKey(await tree(monorepo), parts);
    const changed = await Promise.all([
      installKey(await tree({ ...monorepo, 'package-lock.json': '{"v":2}' }), parts),
      installKey(await tree({ ...monorepo, 'apps/web/package.json': '{}' }), parts),
      installKey(await tree({ ...monorepo, 'apps/web/.npmrc': 'registry=x' }), parts),
      installKey(await tree(monorepo), { ...parts, repoUrl: 'https://github.com/c/d' }),
      installKey(await tree(monorepo), { ...parts, imageId: 'sha256:2' }),
      installKey(await tree(monorepo), { ...parts, command: 'npm install' }),
    ]);
    expect(new Set([key, ...changed]).size).toBe(7);
  });

  it('refuses to cache an install without a lockfile', async () => {
    expect(await installKey(await tree({ 'package.json': '{}' }), parts)).toBeNull();
  });
});

describe('touchesManifests', () => {
  const diff = (path: string) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;

  it('spots changes to dependency files anywhere in the repo', () => {
    expect(touchesManifests(diff('apps/web/package.json'))).toBe(true);
    expect(touchesManifests(diff('bun.lock'))).toBe(true);
    expect(touchesManifests(diff('src/package.json.ts'))).toBe(false);
    expect(touchesManifests(diff('src/index.js'))).toBe(false);
    expect(touchesManifests(null)).toBe(false);
  });
});

describe('evict', () => {
  it('drops the least recently used entries beyond the size limit', async () => {
    const dir = await tree({
      'old.tar': 'x'.repeat(40),
      'mid.tar': 'x'.repeat(40),
      'new.tar': 'x'.repeat(40),
      'note.txt': 'x'.repeat(500),
    });
    const at = (name: string, s: number) => utimes(join(dir, name), s, s);
    await Promise.all([at('old.tar', 1000), at('mid.tar', 2000), at('new.tar', 3000)]);

    expect(await evict({ dir, maxBytes: 100 })).toEqual([join(dir, 'old.tar')]);
    expect((await readdir(dir)).sort()).toEqual(['mid.tar', 'new.tar', 'note.txt']);
  });
});
