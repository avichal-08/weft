import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cancelRun, claimRun, completeRun, getRun } from '../src/runs.ts';
import { runs, sessions } from '../src/schema.ts';
import { addTurn, createSession, getSession, listSessions, titleFrom } from '../src/sessions.ts';
import { reset, testDb, type TestDb } from '../src/testing.ts';

let db: TestDb;
const input = {
  repoUrl: 'https://github.com/avichal-08/weft-playground',
  baseRef: 'bug/lru-recency',
  message: 'Why does the cache evict entries I just read?',
  config: { model: 'gemini-2.5-flash' },
};

async function finishTurn(runId: string) {
  const attempt = (await claimRun(db, runId, 'w'))!;
  await completeRun(db, runId, attempt, { status: 'succeeded', summary: 'done' });
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await reset(db);
});

describe('createSession', () => {
  it('creates the session and its first turn', async () => {
    const { session, run } = await createSession(db, input);
    expect(session).toMatchObject({
      title: 'Why does the cache evict entries I just read?',
      repoUrl: input.repoUrl,
      baseRef: 'bug/lru-recency',
      testCommand: null,
      config: { model: 'gemini-2.5-flash' },
    });
    expect(run).toMatchObject({
      sessionId: session.id,
      turn: 1,
      status: 'queued',
      task: input.message,
      repoUrl: input.repoUrl,
      baseRef: 'bug/lru-recency',
      testCommand: null,
      config: { model: 'gemini-2.5-flash' },
    });
  });
});

describe('addTurn', () => {
  it('refuses a new message while a turn is still active', async () => {
    const { session } = await createSession(db, input);
    expect(await addTurn(db, session.id, 'and another thing')).toEqual({
      ok: false,
      reason: 'busy',
    });
  });

  it('adds the next turn once the previous one finished', async () => {
    const { session, run } = await createSession(db, input);
    await finishTurn(run.id);

    const next = await addTurn(db, session.id, 'Now fix it');
    expect(next).toMatchObject({
      ok: true,
      run: { turn: 2, task: 'Now fix it', sessionId: session.id },
    });
  });

  it('allows a new message after a cancelled turn', async () => {
    const { session, run } = await createSession(db, input);
    await cancelRun(db, run.id);
    expect((await addTurn(db, session.id, 'try again')).ok).toBe(true);
  });

  it('lets only one of two simultaneous messages through', async () => {
    const { session, run } = await createSession(db, input);
    await finishTurn(run.id);

    const results = await Promise.all([
      addTurn(db, session.id, 'first'),
      addTurn(db, session.id, 'second'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'busy' }]);
  });

  it('reports unknown sessions', async () => {
    expect(await addTurn(db, '00000000-0000-4000-8000-000000000000', 'hi')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('getSession / listSessions', () => {
  it('returns the conversation in turn order', async () => {
    const { session, run } = await createSession(db, input);
    await finishTurn(run.id);
    await addTurn(db, session.id, 'Now fix it');

    const full = await getSession(db, session.id);
    expect(full?.turns.map((t) => [t.turn, t.task, t.status])).toEqual([
      [1, input.message, 'succeeded'],
      [2, 'Now fix it', 'queued'],
    ]);
  });

  it('lists the most recently active session first, with its latest status', async () => {
    const a = await createSession(db, { ...input, message: 'session a' });
    const b = await createSession(db, { ...input, message: 'session b' });
    await finishTurn(a.run.id);
    await addTurn(db, a.session.id, 'follow-up in a');

    const list = await listSessions(db);
    expect(list.map((s) => [s.title, s.turns, s.lastStatus])).toEqual([
      ['session a', 2, 'queued'],
      ['session b', 1, 'queued'],
    ]);
    expect(b.session.id).toBe(list[1]?.id);
  });

  it('deletes turns together with their session', async () => {
    const { session, run } = await createSession(db, input);
    await db.delete(sessions).where(eq(sessions.id, session.id));
    expect(await getRun(db, run.id)).toBeUndefined();
    expect(await db.select().from(runs).where(eq(runs.sessionId, session.id))).toEqual([]);
  });
});

describe('titleFrom', () => {
  it('flattens whitespace and shortens long messages', () => {
    expect(titleFrom('  fix\n the   bug ')).toBe('fix the bug');
    expect(titleFrom('x'.repeat(200))).toHaveLength(80);
  });
});
