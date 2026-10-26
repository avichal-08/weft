import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evict,
  installCache,
  installKey,
  touchesManifests,
  type DepsImages,
} from '../src/install-cache.ts';

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

function fakeImages(
  sizes: Record<string, number> = {},
  opts: { inUse?: string[]; fail?: boolean } = {},
) {
  const built: string[] = [];
  const images: DepsImages = {
    has: (key) => Promise.resolve(key in sizes),
    build(key) {
      if (opts.fail) return Promise.reject(new Error('commit failed'));
      built.push(key);
      sizes[key] = 1;
      return Promise.resolve();
    },
    remove(key) {
      if (opts.inUse?.includes(key)) return Promise.resolve(false);
      delete sizes[key];
      return Promise.resolve(true);
    },
    list: () => Promise.resolve(Object.entries(sizes).map(([key, bytes]) => ({ key, bytes }))),
  };
  return { images, built, sizes };
}

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

    expect(await evict({ dir, maxBytes: 100 })).toEqual(['old.tar']);
    expect((await readdir(dir)).sort()).toEqual(['mid.tar', 'new.tar', 'note.txt']);
  });

  it('ranks images and tars together, and skips an image that is in use', async () => {
    const dir = await tree({ 'tar1.tar': 'x'.repeat(40), 'img1.used': '', 'img2.used': '' });
    const at = (name: string, s: number) => utimes(join(dir, name), s, s);
    await Promise.all([at('img1.used', 1000), at('img2.used', 2000), at('tar1.tar', 3000)]);
    const { images, sizes } = fakeImages({ img1: 40, img2: 40, orphan: 40 }, { inUse: ['img1'] });

    expect(await evict({ dir, maxBytes: 80, images })).toEqual(['weft-deps:orphan']);
    expect(Object.keys(sizes)).toEqual(['img1', 'img2']);
    expect((await readdir(dir)).sort()).toEqual(['img1.used', 'img2.used', 'tar1.tar']);
  });
});

describe('installCache', () => {
  it('prefers the image over the tar', async () => {
    const dir = await tree({ 'k.tar': 'x' });
    const { images } = fakeImages({ k: 1 });
    expect(await installCache({ dir, maxBytes: 1e9, images }).lookup('k')).toEqual({
      kind: 'image',
      image: 'weft-deps:k',
    });
    expect(await installCache({ dir, maxBytes: 1e9 }).lookup('k')).toEqual({
      kind: 'tar',
      path: join(dir, 'k.tar'),
    });
    expect(await installCache({ dir, maxBytes: 1e9, images }).lookup('other')).toBeNull();
  });

  it('builds each key once in the background, then drops the tar', async () => {
    const dir = await tree({ 'k.tar': 'x' });
    const { images, built } = fakeImages();
    const lines: string[] = [];
    const cache = installCache({ dir, maxBytes: 1e9, images, log: (l) => lines.push(l) });

    cache.scheduleBuild('k', 'sha256:base');
    cache.scheduleBuild('k', 'sha256:base');
    await cache.idle();

    expect(built).toEqual(['k']);
    expect(await readdir(dir)).toEqual(['k.used']);
    expect(lines[0]).toMatch(/^install cache: built weft-deps:k in \d+\.\ds$/);
    expect(await cache.lookup('k')).toEqual({ kind: 'image', image: 'weft-deps:k' });
  });

  it('keeps the tar when the build fails', async () => {
    const dir = await tree({ 'k.tar': 'x' });
    const lines: string[] = [];
    const cache = installCache({
      dir,
      maxBytes: 1e9,
      images: fakeImages({}, { fail: true }).images,
      log: (l) => lines.push(l),
    });

    cache.scheduleBuild('k', 'sha256:base');
    await cache.idle();

    expect(await readdir(dir)).toEqual(['k.tar']);
    expect(lines[0]).toMatch(/failed, the tar stays: commit failed/);
    expect(await cache.lookup('k')).toEqual({ kind: 'tar', path: join(dir, 'k.tar') });
  });
});
