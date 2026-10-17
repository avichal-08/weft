import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';
import type { Sandbox } from '../src/types.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await createSandbox({ image });
});

afterAll(async () => {
  await sandbox.destroy();
});

describe('sandbox.exec', () => {
  it('separates stdout and stderr', async () => {
    const res = await sandbox.exec('echo out; echo err >&2');
    expect(res).toMatchObject({ exitCode: 0, stdout: 'out\n', stderr: 'err\n', truncated: false });
  });

  it('reports non-zero exit codes', async () => {
    expect((await sandbox.exec('exit 3')).exitCode).toBe(3);
    expect((await sandbox.exec(['false'])).exitCode).toBe(1);
  });

  it('runs as the unprivileged user in /workspace', async () => {
    const res = await sandbox.exec('id -u; pwd');
    expect(res.stdout).toBe('1000\n/workspace\n');
  });

  it('passes cwd and env', async () => {
    const res = await sandbox.exec('echo "$GREETING from $(pwd)"', {
      cwd: '/tmp',
      env: { GREETING: 'hi' },
    });
    expect(res.stdout).toBe('hi from /tmp\n');
  });

  it('caps runaway output without buffering it all', async () => {
    const res = await sandbox.exec('head -c 5000000 /dev/zero | tr "\\0" a', {
      maxOutputBytes: 1000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toHaveLength(1000);
    expect(res.truncated).toBe(true);
  });

  it('sees no network', async () => {
    const res = await sandbox.exec(
      'node -e "fetch(\'https://example.com\').then(()=>process.exit(0),()=>process.exit(7))"',
    );
    expect(res.exitCode).toBe(7);
  });
});
