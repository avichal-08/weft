import { describe, expect, it } from 'vitest';
import { DEFAULT_REAP_POLICY, reapReason } from '../src/janitor.ts';
import type { SandboxInfo } from '../src/types.ts';

const policy = DEFAULT_REAP_POLICY;
const box = (over: Partial<SandboxInfo> = {}): SandboxInfo => ({
  id: 'c1',
  state: 'running',
  ageMs: 5 * 60_000,
  owner: 'worker-1',
  ...over,
});

describe('reapReason', () => {
  it('keeps healthy sandboxes', () => {
    expect(reapReason(box(), policy, true)).toBeUndefined();
  });

  it('never touches very young sandboxes, which may still be starting', () => {
    expect(reapReason(box({ state: 'created', ageMs: 1000 }), policy, false)).toBeUndefined();
  });

  it('reaps stopped sandboxes', () => {
    expect(reapReason(box({ state: 'exited' }), policy, true)).toBe('not-running');
  });

  it('keeps paused sandboxes, which docker commit pauses for minutes, until the max age', () => {
    expect(reapReason(box({ state: 'paused' }), policy, true)).toBeUndefined();
    expect(reapReason(box({ state: 'paused', ageMs: 2 * 60 * 60_000 }), policy, true)).toBe(
      'too-old',
    );
  });

  it('reaps sandboxes past the max age', () => {
    expect(reapReason(box({ ageMs: 2 * 60 * 60_000 }), policy, true)).toBe('too-old');
  });

  it('reaps sandboxes whose owner is gone', () => {
    expect(reapReason(box(), policy, false)).toBe('owner-dead');
  });

  it('ignores owner liveness for sandboxes without an owner', () => {
    expect(reapReason(box({ owner: undefined }), policy, false)).toBeUndefined();
  });
});
