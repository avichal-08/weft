import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cancelRun,
  claimRun,
  completeRun,
  createRun,
  getRun,
  listRuns,
  recordProgress,
} from '../src/runs.ts';
import { reset, testDb, type TestDb } from '../src/testing.ts';

let db: TestDb;
const input = { repoUrl: 'https://github.com/x/y', task: 'fix it', testCommand: 'npm test' };
const usage = { steps: 3, inputTokens: 900, outputTokens: 40, cacheReadTokens: 0 };

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await reset(db);
});

describe('createRun / getRun / listRuns', () => {
  it('creates a queued run and reads it back', async () => {
    const run = await createRun(db, { ...input, config: { model: 'm' } });
    expect(run).toMatchObject({ status: 'queued', attempt: 0, config: { model: 'm' } });
    expect(await getRun(db, run.id)).toEqual(run);
  });

  it('returns undefined for unknown ids', async () => {
    expect(await getRun(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });

  it('lists newest first, filters by status and caps the limit', async () => {
    const a = await createRun(db, input);
    const b = await createRun(db, input);
    const c = await createRun(db, input);
    await claimRun(db, b.id, 'w1');

    expect((await listRuns(db)).map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect((await listRuns(db, { status: 'running' })).map((r) => r.id)).toEqual([b.id]);
    expect(await listRuns(db, { limit: 1 })).toHaveLength(1);
  });
});

describe('claimRun', () => {
  it('starts the run and hands out attempt 1', async () => {
    const run = await createRun(db, input);
    expect(await claimRun(db, run.id, 'worker-a')).toBe(1);
    expect(await getRun(db, run.id)).toMatchObject({
      status: 'running',
      attempt: 1,
      workerId: 'worker-a',
    });
    expect((await getRun(db, run.id))?.startedAt).toBeInstanceOf(Date);
  });

  it('lets a re-delivered job reclaim a running run with a new attempt', async () => {
    const run = await createRun(db, input);
    await claimRun(db, run.id, 'worker-a');
    expect(await claimRun(db, run.id, 'worker-b')).toBe(2);
    expect((await getRun(db, run.id))?.workerId).toBe('worker-b');
  });

  it('never hands out the same attempt twice, even concurrently', async () => {
    const run = await createRun(db, input);
    const attempts = await Promise.all([1, 2, 3, 4].map((i) => claimRun(db, run.id, `w${i}`)));
    expect([...attempts].sort()).toEqual([1, 2, 3, 4]);
  });

  it('refuses finished runs', async () => {
    const run = await createRun(db, input);
    await cancelRun(db, run.id);
    expect(await claimRun(db, run.id, 'w')).toBeUndefined();
  });
});

describe('fencing', () => {
  it('ignores writes from a stale attempt', async () => {
    const run = await createRun(db, input);
    const stale = (await claimRun(db, run.id, 'worker-a'))!;
    const current = (await claimRun(db, run.id, 'worker-b'))!;

    expect(await recordProgress(db, run.id, stale, usage)).toBe(false);
    expect(await completeRun(db, run.id, stale, { status: 'succeeded', diff: 'stale' })).toBe(
      false,
    );
    expect(await completeRun(db, run.id, current, { status: 'succeeded', diff: 'real' })).toBe(
      true,
    );

    expect(await getRun(db, run.id)).toMatchObject({ status: 'succeeded', diff: 'real' });
  });

  it('records progress and the outcome for the current attempt', async () => {
    const run = await createRun(db, input);
    const attempt = (await claimRun(db, run.id, 'w'))!;

    expect(await recordProgress(db, run.id, attempt, usage)).toBe(true);
    await completeRun(db, run.id, attempt, {
      status: 'failed',
      ...usage,
      steps: 5,
      failureKind: 'max_steps',
    });

    const done = await getRun(db, run.id);
    expect(done).toMatchObject({
      status: 'failed',
      steps: 5,
      inputTokens: 900,
      failureKind: 'max_steps',
    });
    expect(done?.finishedAt).toBeInstanceOf(Date);
  });

  it('cannot complete a run twice', async () => {
    const run = await createRun(db, input);
    const attempt = (await claimRun(db, run.id, 'w'))!;
    expect(await completeRun(db, run.id, attempt, { status: 'succeeded' })).toBe(true);
    expect(await completeRun(db, run.id, attempt, { status: 'error' })).toBe(false);
    expect((await getRun(db, run.id))?.status).toBe('succeeded');
  });
});

describe('cancelRun', () => {
  it('stops a worker from overwriting a cancelled run', async () => {
    const run = await createRun(db, input);
    const attempt = (await claimRun(db, run.id, 'w'))!;

    expect(await cancelRun(db, run.id)).toBe(true);
    expect(await completeRun(db, run.id, attempt, { status: 'succeeded' })).toBe(false);
    expect((await getRun(db, run.id))?.status).toBe('cancelled');
  });

  it('does nothing to finished runs', async () => {
    const run = await createRun(db, input);
    const attempt = (await claimRun(db, run.id, 'w'))!;
    await completeRun(db, run.id, attempt, { status: 'succeeded' });
    expect(await cancelRun(db, run.id)).toBe(false);
  });
});
