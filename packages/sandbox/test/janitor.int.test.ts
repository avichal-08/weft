import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { afterAll, describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';
import { listSandboxes, reapSandboxes } from '../src/janitor.ts';

const docker = new Docker();
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const scope = { 'weft.test': `janitor-${randomUUID()}` };

async function waitUntilListedStopped(id: string) {
  for (let i = 0; i < 50; i++) {
    const info = (await listSandboxes(docker, scope)).find((s) => s.id === id);
    if (info?.state !== 'running') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`docker still lists ${id} as running`);
}

afterAll(async () => {
  await reapSandboxes({ labels: scope, minAgeMs: 0, maxAgeMs: 0 }, docker);
});

describe('reapSandboxes', () => {
  it('reaps stopped and orphaned sandboxes, keeps healthy ones', async () => {
    const healthy = await createSandbox({ image, owner: 'alive', labels: scope }, docker);
    const orphan = await createSandbox({ image, owner: 'gone', labels: scope }, docker);
    const stopped = await createSandbox({ image, owner: 'alive', labels: scope }, docker);
    await docker.getContainer(stopped.id).kill();
    await waitUntilListedStopped(stopped.id);

    const checked: string[] = [];
    const reaped = await reapSandboxes(
      {
        labels: scope,
        minAgeMs: 0,
        isOwnerAlive: (owner) => {
          checked.push(owner);
          return owner === 'alive';
        },
      },
      docker,
    );

    expect(reaped).toEqual(
      expect.arrayContaining([
        { id: orphan.id, reason: 'owner-dead' },
        { id: stopped.id, reason: 'not-running' },
      ]),
    );
    expect(reaped).toHaveLength(2);
    expect(checked.sort()).toEqual(['alive', 'gone']);

    const left = await listSandboxes(docker, scope);
    expect(left.map((s) => s.id)).toEqual([healthy.id]);
  });

  it('respects the grace period for new sandboxes', async () => {
    await createSandbox({ image, owner: 'gone', labels: scope }, docker);
    const reaped = await reapSandboxes({ labels: scope, isOwnerAlive: () => false }, docker);
    expect(reaped).toEqual([]);
  });

  it('reaps sandboxes that outlived the max age', async () => {
    const reaped = await reapSandboxes(
      { labels: scope, minAgeMs: 0, now: Date.now() + 2 * 60 * 60_000 },
      docker,
    );
    expect(reaped.length).toBeGreaterThan(0);
    expect(reaped.every((r) => r.reason === 'too-old')).toBe(true);
    expect(await listSandboxes(docker, scope)).toEqual([]);
  });
});
