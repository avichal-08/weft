import { claimRun, completeRun, createRun } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reconcileRuns, type JobLookup } from '../src/reconcile.ts';

let db: TestDb;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await reset(db);
});

const run = () => createRun(db, { repoUrl: 'https://x/y', task: 't' });

function queue(states: Record<string, string>) {
  const removed: string[] = [];
  const lookup: JobLookup = {
    getJob: (id) =>
      Promise.resolve(
        states[id]
          ? {
              getState: () => Promise.resolve(states[id]!),
              remove: () => {
                removed.push(id);
                return Promise.resolve();
              },
            }
          : undefined,
      ),
  };
  return { lookup, removed };
}

describe('reconcileRuns', () => {
  it('requeues queued and running runs whose job is gone or finished, and leaves live ones', async () => {
    const lost = await run();
    const waiting = await run();
    const stale = await run();
    const orphaned = await run();
    await claimRun(db, orphaned.id, 'dead-worker');
    const done = await run();
    const attempt = (await claimRun(db, done.id, 'w'))!;
    await completeRun(db, done.id, attempt, { status: 'succeeded' });

    const { lookup, removed } = queue({ [waiting.id]: 'waiting', [stale.id]: 'completed' });
    const enqueued: string[] = [];
    const requeued = await reconcileRuns(db, lookup, (id) => {
      enqueued.push(id);
      return Promise.resolve();
    });

    expect(new Set(requeued)).toEqual(new Set([lost.id, stale.id, orphaned.id]));
    expect(enqueued).toEqual(requeued);
    expect(removed).toEqual([stale.id]);
  });
});
