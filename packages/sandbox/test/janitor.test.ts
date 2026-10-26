import { describe, expect, it } from 'vitest';
import type Docker from 'dockerode';
import { DEFAULT_REAP_POLICY, reapReason, reapSandboxes } from '../src/janitor.ts';
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

  it('leaves sandboxes docker is already removing', () => {
    expect(reapReason(box({ state: 'removing' }), policy, false)).toBeUndefined();
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

describe('reapSandboxes', () => {
  const failure = (statusCode: number, message: string) =>
    Object.assign(new Error(message), { statusCode });

  it('keeps sweeping past a failed removal and reports it', async () => {
    const failures: Record<string, Error> = {
      gone: failure(404, 'no such container'),
      busy: failure(409, 'removal is already in progress'),
      stuck: failure(500, 'device or resource busy'),
    };
    const removed: string[] = [];
    const docker = {
      listContainers: () =>
        Promise.resolve(
          ['gone', 'busy', 'stuck', 'ok'].map((id) => ({
            Id: id,
            State: 'exited',
            Created: 0,
            Labels: {},
          })),
        ),
      getContainer: (id: string) => ({
        remove: () => {
          if (failures[id]) return Promise.reject(failures[id]);
          removed.push(id);
          return Promise.resolve();
        },
      }),
    } as unknown as Docker;

    expect(await reapSandboxes({}, docker)).toEqual([
      { id: 'stuck', reason: 'not-running', error: 'device or resource busy' },
      { id: 'ok', reason: 'not-running' },
    ]);
    expect(removed).toEqual(['ok']);
  });
});
