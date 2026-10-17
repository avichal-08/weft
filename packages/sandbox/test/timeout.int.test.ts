import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';
import type { Sandbox } from '../src/types.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const countSleeps = `for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done | grep -c '^sleep 100' || true`;
let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await createSandbox({ image });
});

afterAll(async () => {
  await sandbox.destroy();
});

describe('exec timeouts', () => {
  it('stops a command that runs too long', async () => {
    const res = await sandbox.exec('sleep 30', { timeoutMs: 500 });
    expect(res).toMatchObject({ exitCode: 124, timedOut: true });
    expect(res.durationMs).toBeLessThan(3000);
  });

  it('does not flag fast commands', async () => {
    const res = await sandbox.exec('echo hi', { timeoutMs: 5000 });
    expect(res).toMatchObject({ exitCode: 0, timedOut: false });
  });

  it('kills child processes too', async () => {
    await sandbox.exec('sleep 100 & sleep 100 & wait', { timeoutMs: 500 });
    const left = await sandbox.exec(countSleeps);
    expect(left.stdout.trim()).toBe('0');
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const res = await sandbox.exec(`trap '' TERM; sleep 100`, { timeoutMs: 500 });
    expect(res).toMatchObject({ exitCode: 137, timedOut: true });
    expect(res.durationMs).toBeGreaterThanOrEqual(2400);
  });
});

describe('escaped processes', () => {
  it('sweeps processes that left the process group', async () => {
    const res = await sandbox.exec('setsid sleep 100', { timeoutMs: 500 });
    expect(res.timedOut).toBe(true);
    const left = await sandbox.exec(countSleeps);
    expect(left.stdout.trim()).toBe('0');
  });

  it('leaves the sandbox usable after a sweep', async () => {
    expect((await sandbox.exec('echo ok')).stdout).toBe('ok\n');
  });
});

describe('host backstop', () => {
  it('kills the sandbox when the in-sandbox timeout is disabled', async () => {
    const box = await createSandbox({ image });
    try {
      const res = await box.exec('kill -STOP $PPID; sleep 100', { timeoutMs: 500 });
      expect(res).toMatchObject({ exitCode: 137, timedOut: true });
      await expect(box.exec('echo still alive?')).rejects.toThrow(/escaped its timeout/);
    } finally {
      await box.destroy();
    }
  }, 20_000);
});
