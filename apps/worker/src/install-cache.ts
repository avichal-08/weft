import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { finished } from 'node:stream/promises';
import type { Sandbox } from '@weft/sandbox';
import { SETUP_TIMEOUT_MS, SetupError } from './setup.ts';

export type InstallCacheConfig = { dir: string; maxBytes: number };

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
    `weft-install-v1\n${parts.repoUrl}\n${parts.imageId}\n${parts.command}\n`,
  );
  for (const file of files) {
    const digest = createHash('sha256')
      .update(await readFile(join(root, file)))
      .digest('hex');
    hash.update(`${file}\0${digest}\n`);
  }
  return hash.digest('hex');
}

export function touchesManifests(diff: string | null): boolean {
  if (!diff) return false;
  return [...diff.matchAll(/^(?:--- a|\+\+\+ b)\/(.+)$/gm)].some(([, path]) =>
    MANIFESTS.has(basename(path!)),
  );
}

export async function evict({ dir, maxBytes }: InstallCacheConfig): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.tar'));
  const entries = await Promise.all(
    names.map(async (name) => ({ path: join(dir, name), ...(await stat(join(dir, name))) })),
  );
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removed: string[] = [];
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
    if (total <= maxBytes) continue;
    await rm(entry.path, { force: true });
    removed.push(entry.path);
  }
  return removed;
}

export function installCache(config: InstallCacheConfig) {
  const file = (key: string) => join(config.dir, `${key}.tar`);

  return {
    async lookup(key: string): Promise<string | null> {
      const now = new Date();
      return utimes(file(key), now, now).then(
        () => file(key),
        () => null,
      );
    },

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
