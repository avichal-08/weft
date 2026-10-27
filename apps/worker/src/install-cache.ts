import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { buildImage, hasImage, listImages, removeImage, type Sandbox } from '@weft/sandbox';
import { SETUP_TIMEOUT_MS, SetupError, type Manager } from './setup.ts';

export type DepsOrigin = { repoUrl: string; base: string; manager: Manager; depth: number };

export type DepsImageInfo = {
  key: string;
  bytes: number;
  repo: string | null;
  base: string | null;
  manager: string | null;
  depth: number;
  createdAt: number;
};

export type DepsImages = {
  has(key: string): Promise<boolean>;
  build(key: string, tar: string, origin: DepsOrigin): Promise<void>;
  remove(key: string): Promise<boolean>;
  list(): Promise<DepsImageInfo[]>;
};

export const repoId = (repoUrl: string) =>
  createHash('sha256').update(repoUrl).digest('hex').slice(0, 16);

export type InstallCacheConfig = {
  dir: string;
  maxBytes: number;
  images?: DepsImages;
  log?: (line: string) => void;
};

export type CacheHit = { kind: 'image'; image: string } | { kind: 'tar'; path: string };

export const DEPS_REPO = 'weft-deps';
export const MAX_DEPTH = 5;
export const depsImage = (key: string) => `${DEPS_REPO}:${key}`;

export function dockerDepsImages(dest: string): DepsImages {
  return {
    has: (key) => hasImage(depsImage(key)),
    async build(key, tar, origin) {
      const { size } = await stat(tar);
      await buildImage({
        base: origin.base,
        repo: DEPS_REPO,
        tag: key,
        tar,
        dest,
        labels: {
          'weft.deps': key,
          'weft.bytes': String(size),
          'weft.repo': repoId(origin.repoUrl),
          'weft.base': origin.base,
          'weft.manager': origin.manager,
          'weft.depth': String(origin.depth),
        },
      });
    },
    remove: (key) => removeImage(depsImage(key)),
    async list() {
      return (await listImages('weft.deps')).flatMap(({ labels, createdAt }) =>
        labels['weft.deps']
          ? [
              {
                key: labels['weft.deps'],
                bytes: Number(labels['weft.bytes']) || 0,
                repo: labels['weft.repo'] ?? null,
                base: labels['weft.base'] ?? null,
                manager: labels['weft.manager'] ?? null,
                depth: Number(labels['weft.depth']) || 0,
                createdAt,
              },
            ]
          : [],
      );
    },
  };
}

const LOCKFILES = new Set([
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
]);
const MANIFESTS = new Set([
  ...LOCKFILES,
  'package.json',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'bunfig.toml',
]);
const SKIP = new Set(['.git', 'node_modules']);

async function manifests(root: string, dir = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIP.has(entry.name)) found.push(...(await manifests(root, path)));
    else if (entry.isFile() && MANIFESTS.has(entry.name)) found.push(relative(root, path));
  }
  return found;
}

export async function installKey(
  root: string,
  parts: { repoUrl: string; imageId: string; command: string },
): Promise<string | null> {
  const files = (await manifests(root)).sort();
  if (!files.some((f) => LOCKFILES.has(basename(f)))) return null;
  const hash = createHash('sha256').update(
    `weft-install-v2\n${parts.repoUrl}\n${parts.imageId}\n${parts.command}\n`,
  );
  for (const file of files) {
    const digest = createHash('sha256')
      .update(await readFile(join(root, file)))
      .digest('hex');
    hash.update(`${file}\0${digest}\n`);
  }
  return hash.digest('hex');
}

export async function manifestPrint(sandbox: Sandbox, root: string): Promise<string> {
  const specs = [...MANIFESTS].map((name) => `:(glob)**/${name}`);
  const res = await sandbox.exec(
    [
      'sh',
      '-c',
      'git ls-files -z -co --exclude-standard -- "$@" | sort -z | xargs -0 -r sha256sum',
      'sh',
      ...specs,
      ':(exclude,glob)**/node_modules/**',
    ],
    { cwd: root },
  );
  if (res.exitCode !== 0) throw new Error(`hashing dependency files failed: ${res.stderr.trim()}`);
  return createHash('sha256').update(res.stdout).digest('hex');
}

export type Manifests = { dir: string; cleanup: () => Promise<void> };

export async function manifestsAfter(root: string, diff: string | null): Promise<Manifests> {
  if (!diff || !touchesManifests(diff)) return { dir: root, cleanup: () => Promise.resolve() };
  const dir = await mkdtemp(join(tmpdir(), 'weft-manifests-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    for (const file of await manifests(root)) {
      await mkdir(dirname(join(dir, file)), { recursive: true });
      await copyFile(join(root, file), join(dir, file));
    }
    const patch = join(dir, '.weft.patch');
    await writeFile(patch, diff);
    const include = [...MANIFESTS].flatMap((name) => [`--include=${name}`, `--include=*/${name}`]);
    await promisify(execFile)('git', ['apply', '--whitespace=nowarn', ...include, patch], {
      cwd: dir,
    });
    await rm(patch);
    return { dir, cleanup };
  } catch (err) {
    await cleanup();
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (err as Error).message, { cause: err });
  }
}

export function touchesManifests(diff: string | null): boolean {
  if (!diff) return false;
  return [...diff.matchAll(/^(?:--- a|\+\+\+ b)\/(.+)$/gm)].some(([, path]) =>
    MANIFESTS.has(basename(path!)),
  );
}

const mtime = (path: string) =>
  stat(path).then(
    (s) => s.mtimeMs,
    () => 0,
  );

async function touch(path: string) {
  const now = new Date();
  await utimes(path, now, now).catch(() => writeFile(path, ''));
}

type Entry = { name: string; bytes: number; used: number; remove: () => Promise<boolean> };

export async function evict({ dir, maxBytes, images }: InstallCacheConfig): Promise<string[]> {
  const tars: Entry[] = await Promise.all(
    (await readdir(dir))
      .filter((n) => n.endsWith('.tar'))
      .map(async (name) => {
        const { size, mtimeMs } = await stat(join(dir, name));
        const remove = () => rm(join(dir, name), { force: true }).then(() => true);
        return { name, bytes: size, used: mtimeMs, remove };
      }),
  );
  const built: Entry[] = await Promise.all(
    (await images?.list())?.map(async ({ key, bytes }) => {
      const marker = join(dir, `${key}.used`);
      const remove = async () => {
        if (!(await images!.remove(key))) return false;
        await rm(marker, { force: true });
        return true;
      };
      return { name: depsImage(key), bytes, used: await mtime(marker), remove };
    }) ?? [],
  );

  const removed: string[] = [];
  let total = 0;
  for (const entry of [...tars, ...built].sort((a, b) => b.used - a.used)) {
    total += entry.bytes;
    if (total <= maxBytes) continue;
    if (await entry.remove()) removed.push(entry.name);
  }
  return removed;
}

export function installCache(config: InstallCacheConfig) {
  const file = (key: string) => join(config.dir, `${key}.tar`);
  const marker = (key: string) => join(config.dir, `${key}.used`);
  const queued = new Set<string>();
  let builds = Promise.resolve();

  return {
    async lookup(key: string): Promise<CacheHit | null> {
      await mkdir(config.dir, { recursive: true });
      if (config.images && (await config.images.has(key))) {
        await touch(marker(key));
        return { kind: 'image', image: depsImage(key) };
      }
      const now = new Date();
      return utimes(file(key), now, now).then(
        () => ({ kind: 'tar', path: file(key) }),
        () => null,
      );
    },

    async nearest(origin: Omit<DepsOrigin, 'depth'>) {
      const repo = repoId(origin.repoUrl);
      const [best] = ((await config.images?.list()) ?? [])
        .filter(
          (i) =>
            i.repo === repo &&
            i.base === origin.base &&
            i.manager === origin.manager &&
            i.depth < MAX_DEPTH,
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      return best ? { key: best.key, image: depsImage(best.key), depth: best.depth } : null;
    },

    scheduleBuild(key: string, origin: DepsOrigin) {
      const images = config.images;
      if (!images || queued.has(key)) return;
      queued.add(key);
      builds = builds.then(async () => {
        const started = performance.now();
        try {
          if (!(await images.has(key))) await images.build(key, file(key), origin);
          await touch(marker(key));
          await rm(file(key), { force: true });
          const secs = ((performance.now() - started) / 1000).toFixed(1);
          config.log?.(`install cache: built ${depsImage(key).slice(0, 22)} in ${secs}s`);
          for (const name of await evict(config)) config.log?.(`install cache: evicted ${name}`);
        } catch (err) {
          config.log?.(
            `install cache: building ${depsImage(key).slice(0, 22)} failed, the tar stays: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          queued.delete(key);
        }
      });
    },

    idle: () => builds,

    async save(sandbox: Sandbox, root: string, key: string): Promise<number | null> {
      const found = await sandbox.exec(
        'find . -path ./.git -prune -o -name node_modules -type d -prune -print',
        { cwd: root },
      );
      const dirs = found.stdout.split('\n').filter(Boolean);
      if (dirs.length === 0) return null;

      await mkdir(config.dir, { recursive: true });
      const tmp = `${file(key)}.${randomUUID()}.tmp`;
      const out = createWriteStream(tmp);
      try {
        const res = await sandbox.exec(['tar', '-cf', '-', ...dirs], {
          cwd: root,
          stdout: out,
          timeoutMs: SETUP_TIMEOUT_MS,
        });
        out.end();
        await finished(out);
        if (res.exitCode !== 0) throw new Error(`tar exited ${res.exitCode}: ${res.stderr.trim()}`);
        await rename(tmp, file(key));
      } catch (err) {
        out.destroy();
        await rm(tmp, { force: true });
        throw err;
      }
      const { size } = await stat(file(key));
      await evict(config);
      return size;
    },

    async restore(sandbox: Sandbox, root: string, path: string): Promise<void> {
      const res = await sandbox.exec(['tar', '-xf', '-'], {
        cwd: root,
        stdin: createReadStream(path),
        timeoutMs: SETUP_TIMEOUT_MS,
      });
      if (res.exitCode === 0) return;
      await rm(path, { force: true });
      throw new SetupError(
        `restoring cached dependencies failed (exit code ${res.exitCode}), so the cache entry was dropped; send the message again to install fresh\n${res.stderr.slice(-2000)}`,
      );
    },
  };
}

export type InstallCache = ReturnType<typeof installCache>;
