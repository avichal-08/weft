import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  appendRunEvents,
  claimRun,
  completeRun,
  getRun,
  getSession,
  recordPullRequest,
} from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockProvider } from '@weft/llm';
import type { PublishJobData } from '@weft/queue';
import { createApp } from '../src/app.ts';
import { fakeLive } from './fake-live.ts';

let db: TestDb;
let server: Server;
let base: string;
let queued: string[];
let published: PublishJobData[];
let queueDown: boolean;
let checks: Record<string, boolean>;

beforeAll(async () => {
  db = await testDb();
  const app = createApp({
    db,
    enqueue: (runId) => {
      if (queueDown) return Promise.reject(new Error('redis down'));
      queued.push(runId);
      return Promise.resolve();
    },
    enqueuePublish: (job) => {
      published.push(job);
      return Promise.resolve();
    },
    createLLM: () =>
      createMockProvider(() => ({ content: [{ type: 'text', text: 'Add isBlank helper' }] })),
    ready: () => Promise.resolve(checks),
    live: () => fakeLive().reader(),
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await reset(db);
  queued = [];
  published = [];
  queueDown = false;
  checks = { db: true, redis: true };
});

type ApiRun = { id: string; status: string; [key: string]: unknown };
type ApiSession = {
  id: string;
  title: string;
  turns?: ApiRun[] | number;
  lastStatus?: string | null;
  [key: string]: unknown;
};

type Body = {
  run?: ApiRun;
  session?: ApiSession;
  sessions?: ApiSession[];
  runs?: ApiRun[];
  error?: string;
  issues?: { path: string; message: string }[];
  [key: string]: unknown;
};

const runOf = (body: Body) => body.run!;
const idsOf = (body: Body) => body.runs!.map((r) => r.id);

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Body };
}

const post = (path: string, body: unknown) =>
  api(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

const valid = {
  repoUrl: 'https://github.com/avichal-08/weft-fixture',
  task: 'Make the failing test pass',
  testCommand: 'npm test',
};

describe('POST /runs', () => {
  it('creates a queued run and enqueues it', async () => {
    const res = await post('/runs', { ...valid, config: { provider: 'gemini', maxSteps: 20 } });

    expect(res.status).toBe(201);
    expect(res.body.run).toMatchObject({
      status: 'queued',
      task: valid.task,
      config: { maxSteps: 20 },
    });
    expect(res.headers.get('location')).toBe(`/runs/${runOf(res.body).id}`);
    expect(queued).toEqual([runOf(res.body).id]);
  });

  it.each([
    ['a missing task', { repoUrl: valid.repoUrl, testCommand: 'x' }, 'task'],
    ['a non-https repo url', { ...valid, repoUrl: 'ftp://example.com/r' }, 'repoUrl'],
    ['an unknown field', { ...valid, sudo: true }, ''],
    ['an out-of-range budget', { ...valid, config: { maxSteps: 1000 } }, 'config.maxSteps'],
    ['a blank task', { ...valid, task: '   ' }, 'task'],
  ])('rejects %s', async (_name, body, path) => {
    const res = await post('/runs', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.issues!.map((i) => i.path)).toContain(path);
    expect(queued).toEqual([]);
  });

  it('rejects malformed json', async () => {
    const res = await post('/runs', '{"task": ');
    expect(res).toMatchObject({ status: 400, body: { error: 'invalid_json' } });
  });

  it('keeps the run and answers 503 when the queue is down', async () => {
    queueDown = true;
    const res = await post('/runs', valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('queue_unavailable');
    expect((await getRun(db, runOf(res.body).id))?.status).toBe('queued');
  });
});

describe('GET /runs', () => {
  it('lists newest first and filters by status', async () => {
    const a = runOf((await post('/runs', valid)).body);
    const b = runOf((await post('/runs', valid)).body);
    await post(`/runs/${a.id}/cancel`, {});

    expect(idsOf((await api('/runs')).body)).toEqual([b.id, a.id]);
    expect(idsOf((await api('/runs?status=cancelled')).body)).toEqual([a.id]);
  });

  it('validates query parameters', async () => {
    expect((await api('/runs?limit=0')).status).toBe(400);
    expect((await api('/runs?status=weird')).status).toBe(400);
  });
});

describe('GET /runs/:id', () => {
  it('returns one run', async () => {
    const created = runOf((await post('/runs', valid)).body);
    const res = await api(`/runs/${created.id}`);
    expect(res).toMatchObject({ status: 200, body: { run: { id: created.id } } });
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await api('/runs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api('/runs/not-a-uuid')).status).toBe(400);
  });
});

describe('GET /runs/:id/events', () => {
  const llm = (seq: number) => ({
    seq,
    type: 'llm' as const,
    step: seq + 1,
    data: { text: `s${seq}` },
  });

  it('returns the current attempt by default, and pages with afterSeq', async () => {
    const run = runOf((await post('/runs', valid)).body);
    await claimRun(db, run.id, 'w1');
    await claimRun(db, run.id, 'w2');
    await appendRunEvents(db, run.id, 1, [llm(0)]);
    await appendRunEvents(db, run.id, 2, [llm(0), llm(1), llm(2)]);

    const all = await api(`/runs/${run.id}/events`);
    expect(all.body).toMatchObject({ attempt: 2, status: 'running' });
    expect((all.body.events as { seq: number }[]).map((e) => e.seq)).toEqual([0, 1, 2]);

    const newer = await api(`/runs/${run.id}/events?afterSeq=0`);
    expect((newer.body.events as { seq: number }[]).map((e) => e.seq)).toEqual([1, 2]);

    const old = await api(`/runs/${run.id}/events?attempt=1`);
    expect(old.body).toMatchObject({ attempt: 1, events: [{ seq: 0, data: { text: 's0' } }] });
  });

  it('answers 404 for unknown runs and 400 for bad queries', async () => {
    expect((await api('/runs/00000000-0000-4000-8000-000000000000/events')).status).toBe(404);
    const run = runOf((await post('/runs', valid)).body);
    expect((await api(`/runs/${run.id}/events?limit=0`)).status).toBe(400);
  });
});

describe('sessions', () => {
  const start = { repoUrl: valid.repoUrl, message: 'Why do the tests fail?', baseRef: 'bug/x' };

  async function finish(runId: string) {
    const attempt = (await claimRun(db, runId, 'w'))!;
    await completeRun(db, runId, attempt, { status: 'succeeded', summary: 'answered' });
  }

  it('starts a session with its first turn and enqueues it', async () => {
    const res = await post('/sessions', start);
    expect(res.status).toBe(201);
    expect(res.body.session).toMatchObject({
      title: start.message,
      baseRef: 'bug/x',
      testCommand: null,
    });
    expect(res.body.run).toMatchObject({ turn: 1, task: start.message, status: 'queued' });
    expect(res.headers.get('location')).toBe(`/sessions/${res.body.session!.id}`);
    expect(queued).toEqual([res.body.run!.id]);
  });

  it('holds a conversation: busy while working, next turn after', async () => {
    const { session, run } = (await post('/sessions', start)).body;

    const early = await post(`/sessions/${session!.id}/messages`, { message: 'and?' });
    expect(early).toMatchObject({ status: 409, body: { error: 'busy' } });

    await finish(run!.id);
    const next = await post(`/sessions/${session!.id}/messages`, { message: 'Now fix it' });
    expect(next).toMatchObject({ status: 201, body: { run: { turn: 2, task: 'Now fix it' } } });
    expect(queued).toEqual([run!.id, next.body.run!.id]);

    expect(next.body.run).toMatchObject({ mode: 'code' });

    const full = await api(`/sessions/${session!.id}`);
    expect((full.body.session!.turns as ApiRun[]).map((t) => [t.turn, t.status])).toEqual([
      [1, 'succeeded'],
      [2, 'queued'],
    ]);
  });

  it('lists sessions, most recent first', async () => {
    const a = (await post('/sessions', { ...start, message: 'first chat' })).body;
    await post('/sessions', { ...start, message: 'second chat' });
    await finish(a.run!.id);
    await post(`/sessions/${a.session!.id}/messages`, { message: 'back to the first' });

    const list = (await api('/sessions')).body.sessions!;
    expect(list.map((s) => [s.title, s.turns, s.lastStatus])).toEqual([
      ['first chat', 2, 'queued'],
      ['second chat', 1, 'queued'],
    ]);
  });

  it('validates input and reports unknown sessions', async () => {
    expect((await post('/sessions', { ...start, message: '  ' })).status).toBe(400);
    expect((await post('/sessions', { repoUrl: valid.repoUrl })).status).toBe(400);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await api(`/sessions/${unknown}`)).status).toBe(404);
    expect((await post(`/sessions/${unknown}/messages`, { message: 'hi' })).status).toBe(404);
    expect((await post(`/sessions/${unknown}/messages`, {})).status).toBe(400);
    expect(
      (await post(`/sessions/${unknown}/messages`, { message: 'hi', mode: 'plan' })).status,
    ).toBe(400);
  });

  it('answers 503 but keeps the session when the queue is down', async () => {
    queueDown = true;
    const res = await post('/sessions', start);
    expect(res.status).toBe(503);
    expect((await getRun(db, res.body.run!.id))?.status).toBe('queued');
  });
});

describe('POST /sessions/:id/publish', () => {
  async function chatWith(outcome: Parameters<typeof completeRun>[3]) {
    const { session, run } = (
      await post('/sessions', {
        repoUrl: 'https://github.com/avichal-08/weft-playground',
        message: 'Fix the cache',
      })
    ).body;
    const attempt = (await claimRun(db, run!.id, 'w'))!;
    await completeRun(db, run!.id, attempt, outcome);
    return session!.id;
  }

  it('asks for a commit first, then queues a publish that opens a pull request', async () => {
    const id = await chatWith({ status: 'succeeded', diff: 'diff --git a/a b/a\n' });
    expect(await post(`/sessions/${id}/publish`, {})).toMatchObject({
      status: 409,
      body: { error: 'uncommitted', message: 'commit your changes before opening a pull request' },
    });
    await post(`/sessions/${id}/commits`, { message: 'Change a' });
    const res = await post(`/sessions/${id}/publish`, {});
    expect(res.status).toBe(202);
    expect(res.body.session).toMatchObject({ publishState: 'queued' });
    expect(published).toEqual([{ sessionId: id, turn: 1, openPullRequest: true }]);
  });

  it("refuses while the latest turn's tests fail, with the reason", async () => {
    const id = await chatWith({ status: 'failed', failureKind: 'tests_failed', diff: 'd' });
    const res = await post(`/sessions/${id}/publish`, {});
    expect(res).toMatchObject({
      status: 409,
      body: {
        error: 'not_publishable',
        message: "the latest turn's tests fail, so there is nothing to publish yet",
      },
    });
    expect(published).toEqual([]);
  });

  it('404s for an unknown chat', async () => {
    const res = await post('/sessions/00000000-0000-4000-8000-000000000000/publish', {});
    expect(res.status).toBe(404);
  });
});

describe('commits', () => {
  async function chatWith(diff: string) {
    const { session, run } = (
      await post('/sessions', {
        repoUrl: 'https://github.com/avichal-08/weft-playground',
        message: 'Add isBlank',
      })
    ).body;
    const attempt = (await claimRun(db, run!.id, 'w'))!;
    await completeRun(db, run!.id, attempt, { status: 'succeeded', diff });
    return session!.id;
  }
  const diff =
    'diff --git a/src/strings.js b/src/strings.js\n--- a/src/strings.js\n+++ b/src/strings.js\n@@ -1 +1 @@\n-a\n+b\n';

  it('drafts a message, then saves the edited one', async () => {
    const id = await chatWith(diff);
    const draft = await post(`/sessions/${id}/commits/draft`, {});
    expect(draft).toMatchObject({ status: 200, body: { message: 'Add isBlank helper' } });

    const saved = await post(`/sessions/${id}/commits`, { message: '  Add isBlank to strings  ' });
    expect(saved.status).toBe(201);
    expect((await getSession(db, id))?.commits.map((c) => [c.turn, c.message])).toEqual([
      [1, 'Add isBlank to strings'],
    ]);
    expect(published).toEqual([]);

    const again = await post(`/sessions/${id}/commits/draft`, {});
    expect(again).toMatchObject({
      status: 409,
      body: { error: 'nothing_to_commit', message: 'nothing has changed since the last commit' },
    });
  });

  it('rejects an empty message', async () => {
    const id = await chatWith(diff);
    expect((await post(`/sessions/${id}/commits`, { message: '   ' })).status).toBe(400);
  });

  it('pushes the commit right away once the chat has a pull request', async () => {
    const id = await chatWith(diff);
    await recordPullRequest(db, id, { prNumber: 2, prUrl: 'https://github.com/x/y/pull/2' });
    await post(`/sessions/${id}/commits`, { message: 'Add isBlank' });
    expect(published).toEqual([{ sessionId: id, turn: 1, openPullRequest: false }]);
  });
});

describe('POST /runs/:id/cancel', () => {
  it('cancels once, then reports the run as finished', async () => {
    const created = runOf((await post('/runs', valid)).body);
    const first = await post(`/runs/${created.id}/cancel`, {});
    expect(first).toMatchObject({ status: 200, body: { run: { status: 'cancelled' } } });
    const second = await post(`/runs/${created.id}/cancel`, {});
    expect(second).toMatchObject({
      status: 409,
      body: { error: 'already_finished', status: 'cancelled' },
    });
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    expect((await api('/healthz')).status).toBe(200);
    expect(await api('/readyz')).toMatchObject({ status: 200, body: { db: true, redis: true } });
    checks = { db: true, redis: false };
    expect(await api('/readyz')).toMatchObject({ status: 503, body: { redis: false } });
  });

  it('answers unknown routes with json', async () => {
    expect(await api('/nope')).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });
});
