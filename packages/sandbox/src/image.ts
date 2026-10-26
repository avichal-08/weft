import { createReadStream } from 'node:fs';
import Docker from 'dockerode';
import { createSandbox } from './docker.ts';

export type BuildImageOptions = {
  base: string;
  repo: string;
  tag: string;
  tar: string;
  dest: string;
  labels?: Record<string, string>;
  timeoutMs?: number;
};

export const DEFAULT_BUILD_TIMEOUT_MS = 600_000;

export async function buildImage(
  opts: BuildImageOptions,
  docker: Docker = new Docker(),
): Promise<string> {
  const helper = await createSandbox(
    { image: opts.base, ...(opts.labels ? { labels: opts.labels } : {}) },
    docker,
  );
  try {
    const res = await helper.exec(
      ['sh', '-c', 'mkdir -p -- "$1" && exec tar -x -f - -C "$1"', 'sh', opts.dest],
      { stdin: createReadStream(opts.tar), timeoutMs: opts.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS },
    );
    if (res.exitCode !== 0) {
      throw new Error(`unpacking ${opts.tar} failed: ${res.stderr.trim() || res.exitCode}`);
    }
    const { Id } = (await docker.getContainer(helper.id).commit({
      repo: opts.repo,
      tag: opts.tag,
    })) as { Id: string };
    return Id;
  } finally {
    await helper.destroy().catch(() => {});
  }
}

export type ImageInfo = { id: string; tags: string[]; labels: Record<string, string> };

const isStatus = (err: unknown, code: number) =>
  typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === code;

export async function hasImage(ref: string, docker: Docker = new Docker()): Promise<boolean> {
  try {
    await docker.getImage(ref).inspect();
    return true;
  } catch (err) {
    if (isStatus(err, 404)) return false;
    throw err;
  }
}

export async function removeImage(ref: string, docker: Docker = new Docker()): Promise<boolean> {
  try {
    await docker.getImage(ref).remove();
    return true;
  } catch (err) {
    if (isStatus(err, 404)) return true;
    if (isStatus(err, 409)) return false;
    throw err;
  }
}

export async function listImages(
  label: string,
  docker: Docker = new Docker(),
): Promise<ImageInfo[]> {
  const images = await docker.listImages({ filters: { label: [label] } });
  return images.map((i) => ({ id: i.Id, tags: i.RepoTags ?? [], labels: i.Labels ?? {} }));
}
