import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { appendRunEvents, cancelRun, claimRun, completeRun, createRun } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import type { LiveMessage } from '@weft/queue';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { fakeLive } from './fake-live.ts';

let db: TestDb;
let server: Server;
let base: string;
let live: ReturnType<typeof fakeLive>;

beforeAll(async () => {
  db = await testDb();
  const app = createApp({
    db,
    enqueue: () => Promise.resolve(),
    enqueuePublish: () => Promise.resolve(),
    ready: () => Promise.resolve({}),
    live: () => live.reader(),
    liveBlockMs: 100,
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await reset(db);
  live = fakeLive();
});

type Message = { event: string; id?: string; data: unknown };

async function sse(path: string, init: { headers?: Record<string, string>; ms?: number } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.ms ?? 5000);
  const messages: Message[] = [];
  try {
    const res = await fetch(base + path, { headers: init.headers ?? {}, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body!) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const fields = new Map<string, string>();
        for (const line of buf.slice(0, i).split('\n')) {
          const at = line.indexOf(': ');
          if (at > 0) fields.set(line.slice(0, at), line.slice(at + 2));
        }
        buf = buf.slice(i + 2);
        const event = fields.get('event');
        if (!event) continue;
        const id = fields.get('id');
        messages.push({ event, ...(id ? { id } : {}), data: JSON.parse(fields.get('data')!) });
        if (event === 'end') return messages;
      }
    }
  } catch (err) {
    if (!ctrl.signal.aborted) throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return messages;
}

const later = (fn: () => unknown, ms = 150) =>
  new Promise<void>((resolve, reject) =>
    setTimeout(() => {
      Promise.resolve(fn()).then(() => resolve(), reject);
    }, ms),
  );

const newRun = () =>
  createRun(db, { repoUrl: 'https://github.com/a/b', task: 't', testCommand: 'npm test' });

const row = (seq: number) => ({
  seq,
  type: 'llm' as const,
  step: seq + 1,
  data: { text: `s${seq}` },
});

const event = (attempt: number, seq: number): LiveMessage => ({
  kind: 'event',
  attempt,
  event: { ...row(seq), createdAt: '2026-01-01T00:00:00.000Z' },
});

const summary = (messages: Message[]) => messages.map((m) => m.id ?? m.event);

describe('GET /runs/:id/stream', () => {
  it('replays a finished run from postgres, then ends', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    await appendRunEvents(db, run.id, 1, [row(0), row(1)]);
    await completeRun(db, run.id, 1, { status: 'succeeded' });

    const messages = await sse(`/runs/${run.id}/stream`);
    expect(summary(messages)).toEqual(['1.0', '1.1', 'end']);
    expect(messages[1]).toMatchObject({ event: 'event', data: { seq: 1, data: { text: 's1' } } });
    expect(messages[2]?.data).toEqual({ status: 'succeeded' });
  });

  it('resumes after Last-Event-ID, or after ?attempt=&after=', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    await appendRunEvents(db, run.id, 1, [row(0), row(1), row(2)]);
    await completeRun(db, run.id, 1, { status: 'succeeded' });

    const byHeader = await sse(`/runs/${run.id}/stream`, { headers: { 'last-event-id': '1.0' } });
    expect(summary(byHeader)).toEqual(['1.1', '1.2', 'end']);
    expect(summary(await sse(`/runs/${run.id}/stream?attempt=1&after=1`))).toEqual(['1.2', 'end']);
  });

  it('streams phases and events the moment they are published', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    const started = performance.now();
    const [messages] = await Promise.all([
      sse(`/runs/${run.id}/stream`),
      later(async () => {
        live.publish(run.id, { kind: 'phase', attempt: 1, phase: 'setup', detail: 'npm ci' });
        live.publish(run.id, event(1, 0));
        live.publish(run.id, event(1, 0));
        live.publish(run.id, event(1, 1));
        await completeRun(db, run.id, 1, { status: 'succeeded' });
        live.publish(run.id, { kind: 'end', attempt: 1 });
      }),
    ]);

    expect(summary(messages)).toEqual(['phase', '1.0', '1.1', 'end']);
    expect(messages[0]?.data).toEqual({ phase: 'setup', detail: 'npm ci' });
    expect(messages.at(-1)?.data).toEqual({ status: 'succeeded' });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('relays streamed text, with its step and offset, before the event that completes it', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    const [messages] = await Promise.all([
      sse(`/runs/${run.id}/stream`),
      later(async () => {
        live.publish(run.id, { kind: 'text', attempt: 1, step: 1, offset: 0, text: 'It ' });
        live.publish(run.id, { kind: 'text', attempt: 1, step: 1, offset: 3, text: 'adds.' });
        live.publish(run.id, event(1, 0));
        await completeRun(db, run.id, 1, { status: 'succeeded' });
        live.publish(run.id, { kind: 'end', attempt: 1 });
      }),
    ]);

    expect(summary(messages)).toEqual(['text', 'text', '1.0', 'end']);
    expect(messages.slice(0, 2).map((m) => m.data)).toEqual([
      { step: 1, offset: 0, text: 'It ' },
      { step: 1, offset: 3, text: 'adds.' },
    ]);
    expect(messages[0]?.id).toBeUndefined();
  });

  it('picks up the first attempt of a queued run', async () => {
    const run = await newRun();
    const [messages] = await Promise.all([
      sse(`/runs/${run.id}/stream`),
      later(async () => {
        await claimRun(db, run.id, 'w');
        live.publish(run.id, { kind: 'phase', attempt: 1, phase: 'clone' });
        live.publish(run.id, event(1, 0));
        await completeRun(db, run.id, 1, { status: 'failed' });
        live.publish(run.id, { kind: 'end', attempt: 1 });
      }),
    ]);
    expect(summary(messages)).toEqual(['attempt', 'phase', '1.0', 'end']);
    expect(messages[0]?.data).toEqual({ attempt: 1 });
  });

  it('switches to a takeover attempt and drops what the old worker still sends', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w1');
    live.publish(run.id, event(1, 0));
    await claimRun(db, run.id, 'w2');
    live.publish(run.id, event(2, 0));
    live.publish(run.id, event(1, 1));

    const [messages] = await Promise.all([
      sse(`/runs/${run.id}/stream?attempt=1&after=0`),
      later(async () => {
        await completeRun(db, run.id, 2, { status: 'succeeded' });
        live.publish(run.id, { kind: 'end', attempt: 2 });
      }),
    ]);
    expect(summary(messages)).toEqual(['attempt', '2.0', 'end']);
  });

  it('ends when the run is cancelled, even without an end message', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    live.publish(run.id, event(1, 0));
    const [messages] = await Promise.all([
      sse(`/runs/${run.id}/stream`),
      later(() => cancelRun(db, run.id)),
    ]);
    expect(summary(messages)).toEqual(['1.0', 'end']);
    expect(messages[1]?.data).toEqual({ status: 'cancelled' });
  });

  it('falls back to postgres when the run has no live stream', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    await appendRunEvents(db, run.id, 1, [row(0), row(1)]);
    const [messages] = await Promise.all([
      sse(`/runs/${run.id}/stream`),
      later(() => cancelRun(db, run.id), 400),
    ]);
    expect(summary(messages)).toEqual(['1.0', '1.1', 'end']);
  });

  it('closes its redis reader when the client goes away', async () => {
    const run = await newRun();
    await claimRun(db, run.id, 'w');
    expect(await sse(`/runs/${run.id}/stream`, { ms: 300 })).toEqual([]);
    await later(() => {}, 100);
    expect(live.open).toBe(0);
  });

  it('answers 404 for unknown runs and 400 for bad cursors', async () => {
    expect((await fetch(`${base}/runs/00000000-0000-4000-8000-000000000000/stream`)).status).toBe(
      404,
    );
    const run = await newRun();
    expect((await fetch(`${base}/runs/${run.id}/stream?after=-5`)).status).toBe(400);
    expect(live.open).toBe(0);
  });
});
