import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Sandbox } from '@weft/sandbox';
import { describe, expect, it } from 'vitest';
import {
  diffHash,
  sessionSandboxes,
  stillUsable,
  type KeptSandbox,
} from '../src/session-sandboxes.ts';

const released: string[] = [];

function entry(sessionId: string, over: Partial<KeptSandbox> = {}): KeptSandbox {
  return {
    sessionId,
    sandbox: {
      exec: () => Promise.resolve({ exitCode: 0 }),
      destroy: () => {
        released.push(sessionId);
        return Promise.resolve();
      },
    } as unknown as Sandbox,
    checkout: { dir: '/tmp/x', commit: 'c1', cleanup: () => Promise.resolve() },
    plan: null,
    key: null,
    baseId: null,
    diffHash: diffHash(''),
    depsPrint: 'p',
    onKilled: { current: () => {} },
    createdAt: Date.now(),
    ...over,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('sessionSandboxes', () => {
  it('hands a kept sandbox out once', async () => {
    const pool = sessionSandboxes({ max: 2, idleMs: 60_000 });
    const kept = entry('s1');
    expect(await pool.keep(kept)).toBe(true);
    expect(pool.take('s1')).toBe(kept);
    expect(pool.take('s1')).toBeUndefined();
  });

  it('evicts the oldest session at the cap', async () => {
    released.length = 0;
    const pool = sessionSandboxes({ max: 2, idleMs: 60_000 });
    await pool.keep(entry('a'));
    await pool.keep(entry('b'));
    await pool.keep(entry('c'));
    expect(released).toEqual(['a']);
    expect(pool.size()).toBe(2);
    await pool.clear();
    expect(released.sort()).toEqual(['a', 'b', 'c']);
  });

  it('releases sandboxes left idle, and ones past their max age', async () => {
    released.length = 0;
    const pool = sessionSandboxes({ max: 2, idleMs: 50, maxAgeMs: 1000 });
    await pool.keep(entry('idle'));
    await wait(120);
    expect(pool.take('idle')).toBeUndefined();
    expect(released).toEqual(['idle']);

    await pool.keep(entry('old', { createdAt: Date.now() - 2000 }));
    expect(pool.size()).toBe(0);
    expect(released).toEqual(['idle', 'old']);
  });

  it('keeps nothing when disabled', async () => {
    const pool = sessionSandboxes({ max: 0, idleMs: 60_000 });
    expect(await pool.keep(entry('s1'))).toBe(false);
    expect(pool.size()).toBe(0);
  });
});

describe('stillUsable', () => {
  it('rejects a sandbox holding different changes than the ones recorded', async () => {
    expect(await stillUsable(entry('s'), 'diff --git a/x b/x', 'https://x/y', null, false)).toBe(
      'the recorded changes differ from what it holds',
    );
  });

  it('accepts a live sandbox on an unmoved branch, and rejects one that was killed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weft-usable-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t',
          'commit',
          '-q',
          '--allow-empty',
          '-m',
          'init',
        ],
        { cwd: dir },
      );
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
      const url = pathToFileURL(dir).href;
      const checkout = { dir, commit, cleanup: () => Promise.resolve() };

      expect(await stillUsable(entry('s', { checkout }), '', url, 'main', true)).toBeNull();

      const dead = entry('s', {
        checkout,
        sandbox: {
          exec: () => Promise.reject(new Error('sandbox was killed: it wrote 9 MB')),
        } as unknown as Sandbox,
      });
      expect(await stillUsable(dead, '', url, 'main', true)).toBe(
        'sandbox was killed: it wrote 9 MB',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
