import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cancelRun, claimRun, completeRun, getRun } from '../src/runs.ts';
import { runs, sessions } from '../src/schema.ts';
import {
  addTurn,
  commitRefusal,
  createCommit,
  createSession,
  getSession,
  listSessions,
  latestWork,
  publishRefusal,
  pullRequestRefusal,
  recordCommitSha,
  recordPublishError,
  recordPullRequest,
  recordPush,
  setPublishState,
  titleFrom,
} from '../src/sessions.ts';
import { reset, testDb, type TestDb } from '../src/testing.ts';
import type { Run } from '../src/types.ts';

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

  it('stores the mode of each turn, code unless asked', async () => {
    const { session, run } = await createSession(db, input);
    expect(run.mode).toBe('code');
    await finishTurn(run.id);
    const next = await addTurn(db, session.id, 'What does this do?', 'ask');
    expect(next).toMatchObject({ ok: true, run: { turn: 2, mode: 'ask' } });
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

describe('recordPush / recordPublishError', () => {
  it('stores the branch and the last pushed turn, and clears an earlier error', async () => {
    const { session } = await createSession(db, input);
    expect(await getSession(db, session.id)).toMatchObject({ branch: null, pushedTurn: null });

    await recordPublishError(db, session.id, 'the latest turn failed its tests');
    expect((await getSession(db, session.id))?.publishError).toBe(
      'the latest turn failed its tests',
    );

    await recordPush(db, session.id, {
      branch: 'weft/why-cache-1a2b3c4d',
      pushedTurn: 2,
      pushedSha: 'abc123',
    });
    expect(await getSession(db, session.id)).toMatchObject({
      branch: 'weft/why-cache-1a2b3c4d',
      pushedTurn: 2,
      pushedSha: 'abc123',
      publishError: null,
    });
  });
});

describe('publish state', () => {
  it('moves queued → pushing → pushed or failed; a push alone does not finish it', async () => {
    const { session } = await createSession(db, input);
    await setPublishState(db, session.id, 'queued');
    expect((await getSession(db, session.id))?.publishState).toBe('queued');
    await recordPublishError(db, session.id, 'nope');
    expect((await getSession(db, session.id))?.publishState).toBe('failed');
    await setPublishState(db, session.id, 'pushing');
    await recordPush(db, session.id, { branch: 'weft/x-1', pushedTurn: 1, pushedSha: 'a' });
    expect((await getSession(db, session.id))?.publishState).toBe('pushing');
    await recordPullRequest(db, session.id, {
      prNumber: 3,
      prUrl: 'https://github.com/a/b/pull/3',
    });
    await setPublishState(db, session.id, 'pushed');
    expect(await getSession(db, session.id)).toMatchObject({
      publishState: 'pushed',
      prNumber: 3,
      prUrl: 'https://github.com/a/b/pull/3',
    });
  });
});

describe('publishRefusal', () => {
  const turn = (over: Partial<Run>): Run =>
    ({ status: 'succeeded', diff: '', failureKind: null, ...over }) as Run;

  it('allows a chat whose latest turn succeeded and that changed something', () => {
    expect(
      publishRefusal([turn({ diff: 'diff --git a/x b/x' }), turn({ diff: 'diff --git a/x b/x' })]),
    ).toBeNull();
  });

  it('explains every reason to refuse', () => {
    expect(publishRefusal([])).toBe('the chat has no turns yet');
    expect(publishRefusal([turn({ status: 'running' })])).toBe(
      'the agent is still working on the latest message',
    );
    expect(
      publishRefusal([turn({ status: 'failed', failureKind: 'tests_failed', diff: 'd' })]),
    ).toBe("the latest turn's tests fail, so there is nothing to publish yet");
    expect(publishRefusal([turn({ diff: 'd' }), turn({ status: 'error' })])).toBe(
      "the latest turn didn't finish",
    );
    expect(publishRefusal([turn({ diff: '' })])).toBe(
      'nothing in this chat has changed any files yet',
    );
  });

  it('judges the latest Code turn, so a question after a change neither blocks nor hides it', () => {
    const ask = (over: Partial<Run> = {}) => turn({ mode: 'ask', diff: 'd', ...over });
    expect(publishRefusal([turn({ diff: 'd' }), ask({ status: 'error' })])).toBeNull();
    expect(
      publishRefusal([turn({ status: 'failed', failureKind: 'tests_failed', diff: 'd' }), ask()]),
    ).toMatch(/tests fail/);
    expect(publishRefusal([turn({ diff: 'd' }), ask({ status: 'running' })])).toMatch(
      /still working/,
    );
    expect(publishRefusal([ask()])).toBe('nothing in this chat has changed any files yet');
  });
});

describe('commits', () => {
  async function chat(diff: string) {
    const { session, run } = await createSession(db, input);
    const attempt = (await claimRun(db, run.id, 'w'))!;
    await completeRun(db, run.id, attempt, { status: 'succeeded', diff, summary: 'done' });
    return session.id;
  }

  it('records commits in order with the session, sha empty until pushed', async () => {
    const id = await chat('diff --git a/a b/a\n');
    const first = await createCommit(db, { sessionId: id, turn: 1, message: 'Add a' });
    await recordCommitSha(db, first.id, 'abc123');
    const saved = await getSession(db, id);
    expect(saved?.commits.map((c) => ({ turn: c.turn, message: c.message, sha: c.sha }))).toEqual([
      { turn: 1, message: 'Add a', sha: 'abc123' },
    ]);
  });

  it('refuses a commit when nothing changed since the last one', async () => {
    const id = await chat('diff --git a/a b/a\n');
    expect(commitRefusal((await getSession(db, id))!)).toBeNull();

    await createCommit(db, { sessionId: id, turn: 1, message: 'Add a' });
    expect(commitRefusal((await getSession(db, id))!)).toBe(
      'nothing has changed since the last commit',
    );

    const next = await addTurn(db, id, 'more');
    if (!next.ok) throw new Error('refused');
    const attempt = (await claimRun(db, next.run.id, 'w'))!;
    await completeRun(db, next.run.id, attempt, {
      status: 'succeeded',
      diff: 'diff --git a/a b/a\n',
    });
    expect(commitRefusal((await getSession(db, id))!)).toBe(
      'nothing has changed since the last commit',
    );
  });

  it('commits the latest Code turn when a question came after it', async () => {
    const id = await chat('diff --git a/a b/a\n');
    const next = await addTurn(db, id, 'why?', 'ask');
    if (!next.ok) throw new Error('refused');
    const attempt = (await claimRun(db, next.run.id, 'w'))!;
    await completeRun(db, next.run.id, attempt, { status: 'error', failureKind: 'llm_server' });
    const session = (await getSession(db, id))!;
    expect(commitRefusal(session)).toBeNull();
    expect(latestWork(session.turns)?.turn).toBe(1);
  });

  it('applies the publish rules too', async () => {
    const { session, run } = await createSession(db, input);
    const attempt = (await claimRun(db, run.id, 'w'))!;
    await completeRun(db, run.id, attempt, {
      status: 'failed',
      failureKind: 'tests_failed',
      diff: 'd',
    });
    expect(commitRefusal((await getSession(db, session.id))!)).toMatch(/tests fail/);
  });

  it('only opens a pull request once every change is committed', async () => {
    const id = await chat('diff --git a/a b/a\n');
    const refusal = async () => pullRequestRefusal((await getSession(db, id))!);
    expect(await refusal()).toEqual({
      error: 'uncommitted',
      message: 'commit your changes before opening a pull request',
    });
    await createCommit(db, { sessionId: id, turn: 1, message: 'Add a' });
    expect(await refusal()).toBeNull();

    const next = await addTurn(db, id, 'more');
    if (!next.ok) throw new Error('refused');
    expect(await refusal()).toMatchObject({ error: 'not_publishable' });
    const attempt = (await claimRun(db, next.run.id, 'w'))!;
    await completeRun(db, next.run.id, attempt, {
      status: 'succeeded',
      diff: 'diff --git a/b b/b\n',
    });
    expect(await refusal()).toMatchObject({ error: 'uncommitted' });
  });
});
