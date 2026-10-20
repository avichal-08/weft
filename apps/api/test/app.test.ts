import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { appendRunEvents, claimRun, getRun } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

let db: TestDb;
let server: Server;
let base: string;
let queued: string[];
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
    ready: () => Promise.resolve(checks),
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
  queueDown = false;
  checks = { db: true, redis: true };
});

type ApiRun = { id: string; status: string; [key: string]: unknown };
type Body = {
  run?: ApiRun;
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
