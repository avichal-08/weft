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
