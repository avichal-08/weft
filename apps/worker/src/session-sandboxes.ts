import { createHash } from 'node:crypto';
import type { Sandbox } from '@weft/sandbox';
import { remoteHead, type Checkout } from './clone.ts';
import type { SetupPlan } from './setup.ts';

export type KillHandler = { current: (reason: string) => void };

export type KeptSandbox = {
  sessionId: string;
  sandbox: Sandbox;
  checkout: Checkout;
  plan: SetupPlan | null;
  key: string | null;
  baseId: string | null;
  diffHash: string;
  depsPrint: string;
  onKilled: KillHandler;
  createdAt: number;
};

export type SessionSandboxesOptions = {
  max: number;
  idleMs: number;
  maxAgeMs?: number;
  log?: (line: string) => void;
};

export const SESSION_SANDBOX_MAX_AGE_MS = 45 * 60_000;

export const diffHash = (diff: string | null) =>
  createHash('sha256')
    .update(diff ?? '')
    .digest('hex');

export async function stillUsable(
  entry: KeptSandbox,
  latest: string | null,
  repoUrl: string,
  ref: string | null,
  allowFileRepos: boolean,
): Promise<string | null> {
  if (entry.diffHash !== diffHash(latest)) return 'the recorded changes differ from what it holds';
  const head = await remoteHead(repoUrl, ref, { allowFileRepos }).catch(() => null);
  if (head !== entry.checkout.commit) return 'the branch has moved since it was cloned';
  try {
    const res = await entry.sandbox.exec('true', { timeoutMs: 5000 });
    if (res.exitCode !== 0) return 'it stopped responding';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

export async function release(entry: KeptSandbox): Promise<void> {
  await Promise.all([entry.sandbox.destroy(), entry.checkout.cleanup()]).catch(() => {});
}

export function sessionSandboxes(opts: SessionSandboxesOptions) {
  const maxAgeMs = opts.maxAgeMs ?? SESSION_SANDBOX_MAX_AGE_MS;
  const kept = new Map<string, { entry: KeptSandbox; timer: NodeJS.Timeout }>();

  const drop = async (sessionId: string, why: string) => {
    const slot = kept.get(sessionId);
    if (!slot) return;
    clearTimeout(slot.timer);
    kept.delete(sessionId);
    opts.log?.(`session sandbox for ${sessionId.slice(0, 8)} released (${why})`);
    await release(slot.entry);
  };

  return {
    take(sessionId: string): KeptSandbox | undefined {
      const slot = kept.get(sessionId);
      if (!slot) return undefined;
      clearTimeout(slot.timer);
      kept.delete(sessionId);
      if (Date.now() - slot.entry.createdAt <= maxAgeMs) return slot.entry;
      opts.log?.(`session sandbox for ${sessionId.slice(0, 8)} released (too old)`);
      void release(slot.entry);
      return undefined;
    },

    async keep(entry: KeptSandbox): Promise<boolean> {
      await drop(entry.sessionId, 'replaced');
      if (opts.max <= 0 || Date.now() - entry.createdAt > maxAgeMs) {
        await release(entry);
        return false;
      }
      while (kept.size >= opts.max) {
        await drop(kept.keys().next().value!, 'evicted for a newer session');
      }
      const timer = setTimeout(() => void drop(entry.sessionId, 'idle'), opts.idleMs).unref();
      kept.set(entry.sessionId, { entry, timer });
      return true;
    },

    async clear() {
      await Promise.all([...kept.keys()].map((id) => drop(id, 'shutdown')));
    },

    size: () => kept.size,
  };
}

export type SessionSandboxes = ReturnType<typeof sessionSandboxes>;
