import Docker from 'dockerode';
import { OWNER_LABEL, SANDBOX_LABEL } from './spec.ts';
import type { Reaped, ReapOptions, ReapPolicy, ReapReason, SandboxInfo } from './types.ts';

export const DEFAULT_REAP_POLICY: ReapPolicy = {
  minAgeMs: 30_000,
  maxAgeMs: 60 * 60_000,
};

export function reapReason(
  info: SandboxInfo,
  policy: ReapPolicy,
  ownerAlive: boolean,
): ReapReason | undefined {
  if (info.ageMs < policy.minAgeMs) return undefined;
  if (info.state !== 'running') return 'not-running';
  if (info.ageMs > policy.maxAgeMs) return 'too-old';
  if (info.owner && !ownerAlive) return 'owner-dead';
  return undefined;
}

export async function listSandboxes(
  docker: Docker,
  labels: Record<string, string> = {},
  now = Date.now(),
): Promise<SandboxInfo[]> {
  const filters = [`${SANDBOX_LABEL}=1`, ...Object.entries(labels).map(([k, v]) => `${k}=${v}`)];
  const containers = await docker.listContainers({ all: true, filters: { label: filters } });
  return containers.map((c) => ({
    id: c.Id,
    state: c.State,
    ageMs: now - c.Created * 1000,
    owner: c.Labels[OWNER_LABEL],
  }));
}

export async function reapSandboxes(
  opts: ReapOptions = {},
  docker: Docker = new Docker(),
): Promise<Reaped[]> {
  const policy = {
    minAgeMs: opts.minAgeMs ?? DEFAULT_REAP_POLICY.minAgeMs,
    maxAgeMs: opts.maxAgeMs ?? DEFAULT_REAP_POLICY.maxAgeMs,
  };
  const alive = new Map<string, boolean>();
  const reaped: Reaped[] = [];

  for (const info of await listSandboxes(docker, opts.labels, opts.now)) {
    let ownerAlive = true;
    if (info.owner && opts.isOwnerAlive) {
      if (!alive.has(info.owner)) alive.set(info.owner, await opts.isOwnerAlive(info.owner));
      ownerAlive = alive.get(info.owner)!;
    }

    const reason = reapReason(info, policy, ownerAlive);
    if (!reason) continue;

    try {
      await docker.getContainer(info.id).remove({ force: true });
      reaped.push({ id: info.id, reason });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }

  return reaped;
}
