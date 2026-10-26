import { describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
};

describe('disk watchdog', () => {
  it('kills a sandbox that writes past its workspace limit', async () => {
    const killed: string[] = [];
    const sandbox = await createSandbox({
      image,
      limits: { workspaceMb: 5 },
      diskCheckMs: 200,
      onKilled: (reason) => killed.push(reason),
    });
    try {
      await sandbox.exec('head -c 20000000 /dev/urandom > /home/node/blob');
      await until(() => killed.length > 0);
      expect(killed).toEqual([
        expect.stringMatching(/^it wrote \d+ MB, over its 5 MB disk limit$/),
      ]);
      await expect(sandbox.exec('echo alive')).rejects.toThrow(/sandbox was killed: it wrote/);
    } finally {
      await sandbox.destroy();
    }
  });

  it('leaves a sandbox under its limit alone, and stops checking once destroyed', async () => {
    const killed: string[] = [];
    const sandbox = await createSandbox({
      image,
      limits: { workspaceMb: 50 },
      diskCheckMs: 100,
      onKilled: (reason) => killed.push(reason),
    });
    await sandbox.exec('head -c 1000000 /dev/urandom > /workspace/small');
    await new Promise((r) => setTimeout(r, 600));
    expect((await sandbox.exec('echo alive')).stdout).toBe('alive\n');
    await sandbox.destroy();
    await new Promise((r) => setTimeout(r, 300));
    expect(killed).toEqual([]);
  });
});
