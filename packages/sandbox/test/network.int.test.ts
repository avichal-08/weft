import { describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const reach = `node -e "fetch('https://registry.npmjs.org/').then(r => console.log(r.status), e => { console.log('blocked'); process.exit(7) })"`;
const countSleeps = `for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done | grep -c '^sleep 300' || true`;

describe('setup network', () => {
  it('has no network by default', async () => {
    const box = await createSandbox({ image });
    try {
      expect((await box.exec(reach, { timeoutMs: 20_000 })).exitCode).toBe(7);
    } finally {
      await box.destroy();
    }
  });

  it('reaches the registry during setup, then loses the network for good', async () => {
    const box = await createSandbox({ image, network: 'bridge' });
    try {
      const online = await box.exec(reach, { timeoutMs: 30_000 });
      expect(online).toMatchObject({ exitCode: 0, stdout: '200\n' });

      await box.exec('setsid sleep 300 > /dev/null 2>&1 &');
      await box.killStrays();
      await box.disconnectNetwork();

      expect((await box.exec(countSleeps)).stdout.trim()).toBe('0');
      expect((await box.exec(reach, { timeoutMs: 20_000 })).exitCode).toBe(7);
      const ifaces = await box.exec('ls /sys/class/net');
      expect(ifaces.stdout.trim().split('\n')).toEqual(['lo']);
    } finally {
      await box.destroy();
    }
  });

  it('can disconnect twice without failing', async () => {
    const box = await createSandbox({ image, network: 'bridge' });
    try {
      await box.disconnectNetwork();
      await expect(box.disconnectNetwork()).resolves.toBeUndefined();
    } finally {
      await box.destroy();
    }
  });
});
