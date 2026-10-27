import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Docker from 'dockerode';
import { pack } from 'tar-fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';
import { buildImage, hasImage, listImages, removeImage } from '../src/image.ts';

const docker = new Docker();
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const repo = 'weft-deps-test';
let dir: string;
let tar: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'weft-image-'));
  const src = join(dir, 'src');
  await mkdir(join(src, 'node_modules/left-pad'), { recursive: true });
  await writeFile(join(src, 'node_modules/left-pad/index.js'), 'module.exports = 1;\n');
  tar = join(dir, 'deps.tar');
  await pipeline(pack(src), createWriteStream(tar));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  for (const img of await docker.listImages({ filters: { reference: [repo] } })) {
    await docker
      .getImage(img.Id)
      .remove({ force: true })
      .catch(() => {});
  }
});

describe('buildImage', () => {
  it('turns a tar into an image that sandboxes start from, copy-on-write', async () => {
    const id = await buildImage(
      { base: image, repo, tag: 'ok', tar, dest: '/workspace/repo', labels: { 'weft.deps': 'k1' } },
      docker,
    );
    const info = await docker.getImage(`${repo}:ok`).inspect();
    expect(info.Id).toBe(id);
    expect(info.Config.Labels?.['weft.deps']).toBe('k1');
    expect(info.Config.User).toBe('1000:1000');

    const sandbox = await createSandbox({ image: `${repo}:ok` }, docker);
    try {
      const read = await sandbox.exec('cat /workspace/repo/node_modules/left-pad/index.js');
      expect(read.stdout).toBe('module.exports = 1;\n');
      const write = await sandbox.exec('echo 2 > /workspace/repo/node_modules/left-pad/index.js');
      expect(write.exitCode).toBe(0);
    } finally {
      await sandbox.destroy();
    }

    const fresh = await createSandbox({ image: `${repo}:ok` }, docker);
    try {
      expect((await fresh.exec('cat /workspace/repo/node_modules/left-pad/index.js')).stdout).toBe(
        'module.exports = 1;\n',
      );
    } finally {
      await fresh.destroy();
    }
  }, 120_000);

  it('removes its helper container and tags nothing when unpacking fails', async () => {
    const bad = join(dir, 'bad.tar');
    await writeFile(bad, 'not a tar');
    await expect(
      buildImage(
        {
          base: image,
          repo,
          tag: 'bad',
          tar: bad,
          dest: '/workspace/repo',
          labels: { 'weft.deps': 'bad' },
        },
        docker,
      ),
    ).rejects.toThrow(/unpacking/);
    await expect(docker.getImage(`${repo}:bad`).inspect()).rejects.toMatchObject({
      statusCode: 404,
    });
    const left = await docker.listContainers({ all: true, filters: { label: ['weft.deps=bad'] } });
    expect(left).toHaveLength(0);
  });

  it('finds images by label, refuses to remove one in use, and treats missing as removed', async () => {
    await buildImage(
      {
        base: image,
        repo,
        tag: 'use',
        tar,
        dest: '/workspace/repo',
        labels: { 'weft.deps': 'k2' },
      },
      docker,
    );
    expect(await hasImage(`${repo}:use`, docker)).toBe(true);
    expect((await listImages('weft.deps=k2', docker)).map((i) => i.tags)).toEqual([
      [`${repo}:use`],
    ]);
    const [listed] = await listImages('weft.deps=k2', docker);
    expect(Date.now() - listed!.createdAt).toBeLessThan(10 * 60_000);

    const sandbox = await createSandbox({ image: `${repo}:use` }, docker);
    try {
      expect(await removeImage(`${repo}:use`, docker)).toBe(false);
    } finally {
      await sandbox.destroy();
    }
    expect(await removeImage(`${repo}:use`, docker)).toBe(true);
    expect(await hasImage(`${repo}:use`, docker)).toBe(false);
    expect(await removeImage(`${repo}:use`, docker)).toBe(true);
  }, 120_000);
});
