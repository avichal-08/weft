import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendRunEvents, listRunEvents } from '../src/events.ts';
import { claimRun, createRun } from '../src/runs.ts';
import { runs } from '../src/schema.ts';
import { reset, testDb, type TestDb } from '../src/testing.ts';
import type { NewRunEvent } from '../src/types.ts';

let db: TestDb;
const input = { repoUrl: 'https://github.com/x/y', task: 't', testCommand: 'npm test' };

const llm = (seq: number, step: number): NewRunEvent => ({
  seq,
  type: 'llm',
  step,
  data: { latencyMs: 1500, usage: { inputTokens: 100, outputTokens: 10 }, text: '' },
});
const tool = (seq: number, step: number, name: string): NewRunEvent => ({
  seq,
  type: 'tool',
  step,
  data: { name, isError: false, durationMs: 150, output: 'ok' },
});

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await reset(db);
});

describe('run events', () => {
  it('stores events and returns them in order', async () => {
    const run = await createRun(db, input);
    await appendRunEvents(db, run.id, 1, [tool(1, 1, 'grep'), llm(0, 1)]);
    await appendRunEvents(db, run.id, 1, [llm(2, 2), tool(3, 2, 'view_file')]);

    const events = await listRunEvents(db, run.id, { attempt: 1 });
    expect(events.map((e) => [e.seq, e.type, e.step])).toEqual([
      [0, 'llm', 1],
      [1, 'tool', 1],
      [2, 'llm', 2],
      [3, 'tool', 2],
    ]);
    expect(events[1]?.data).toEqual({
      name: 'grep',
      isError: false,
      durationMs: 150,
      output: 'ok',
    });
    expect(events[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('keeps attempts apart', async () => {
    const run = await createRun(db, input);
    await claimRun(db, run.id, 'w1');
    await claimRun(db, run.id, 'w2');
    await appendRunEvents(db, run.id, 1, [llm(0, 1), llm(1, 2)]);
    await appendRunEvents(db, run.id, 2, [llm(0, 1)]);

    expect(await listRunEvents(db, run.id, { attempt: 1 })).toHaveLength(2);
    expect(await listRunEvents(db, run.id, { attempt: 2 })).toHaveLength(1);
  });

  it('pages with afterSeq and limit', async () => {
    const run = await createRun(db, input);
    await appendRunEvents(
      db,
      run.id,
      1,
      Array.from({ length: 6 }, (_, i) => llm(i, i + 1)),
    );

    const page = await listRunEvents(db, run.id, { attempt: 1, afterSeq: 2, limit: 2 });
    expect(page.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('ignores a re-sent batch instead of duplicating it', async () => {
    const run = await createRun(db, input);
    await appendRunEvents(db, run.id, 1, [llm(0, 1), tool(1, 1, 'grep')]);
    await appendRunEvents(db, run.id, 1, [llm(0, 1), tool(1, 1, 'grep'), llm(2, 2)]);

    expect((await listRunEvents(db, run.id, { attempt: 1 })).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('does nothing for an empty batch', async () => {
    const run = await createRun(db, input);
    await expect(appendRunEvents(db, run.id, 1, [])).resolves.toBeUndefined();
  });

  it('deletes events together with their run', async () => {
    const run = await createRun(db, input);
    await appendRunEvents(db, run.id, 1, [llm(0, 1)]);
    await db.delete(runs).where(eq(runs.id, run.id));
    expect(await listRunEvents(db, run.id, { attempt: 1 })).toEqual([]);
  });
});
