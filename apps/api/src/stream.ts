import { getRun, listRunEvents, type Db, type Run, type RunEvent } from '@weft/db';
import type { LiveEvent } from '@weft/queue';
import type { LiveReader } from './types.ts';

export const DEFAULT_LIVE_BLOCK_MS = 5000;

const TERMINAL = new Set<string>(['succeeded', 'failed', 'error', 'cancelled']);

export type StreamCursor = { attempt?: number; after: number };

export type StreamOptions = {
  db: Db;
  reader: LiveReader;
  runId: string;
  cursor: StreamCursor;
  send: (event: string, data: unknown, id?: string) => void;
  ping: () => void;
  signal: AbortSignal;
  blockMs?: number;
};

export function parseCursor(
  lastEventId: string | undefined,
  query: { attempt?: number; after?: number },
): StreamCursor {
  const match = /^(\d+)\.(-?\d+)$/.exec(lastEventId ?? '');
  if (match) return { attempt: Number(match[1]), after: Number(match[2]) };
  return {
    ...(query.attempt === undefined ? {} : { attempt: query.attempt }),
    after: query.after ?? -1,
  };
}

const toLive = (e: RunEvent): LiveEvent => ({
  seq: e.seq,
  type: e.type,
  step: e.step,
  data: e.data,
  createdAt: e.createdAt.toISOString(),
});

export async function streamRun(opts: StreamOptions): Promise<void> {
  const { db, reader, runId, send, signal } = opts;
  const blockMs = opts.blockMs ?? DEFAULT_LIVE_BLOCK_MS;
  const run = await getRun(db, runId);
  let attempt = opts.cursor.attempt ?? run?.attempt ?? 0;
  let after = opts.cursor.after;
  let position = '0';

  const event = (e: LiveEvent) => {
    if (e.seq <= after) return;
    after = e.seq;
    send('event', e, `${attempt}.${e.seq}`);
  };
  const switchTo = (next: number) => {
    attempt = next;
    after = -1;
    send('attempt', { attempt });
  };
  const end = (run: Run | undefined) => send('end', { status: run?.status ?? null });

  // postgres is the truth: catches up a finished run, or a stream that expired or never existed
  const sync = async () => {
    const run = await getRun(db, runId);
    if (!run) return undefined;
    if (run.attempt > attempt) switchTo(run.attempt);
    if (attempt > 0) {
      for (const e of await listRunEvents(db, runId, { attempt, afterSeq: after, limit: 1000 })) {
        event(toLive(e));
      }
    }
    return run;
  };

  if (!run || TERMINAL.has(run.status)) return end(await sync());
  if (run.attempt > attempt) switchTo(run.attempt);

  while (!signal.aborted) {
    const entries = await reader.read(runId, position, blockMs);
    if (entries.length === 0) {
      opts.ping();
      const now = await sync();
      if (!now || TERMINAL.has(now.status)) return end(now);
      continue;
    }
    for (const { id, message } of entries) {
      position = id;
      if (message.attempt < attempt) continue;
      if (message.attempt > attempt) switchTo(message.attempt);
      if (message.kind === 'phase') {
        send('phase', { phase: message.phase, detail: message.detail ?? null });
      } else if (message.kind === 'event') {
        event(message.event);
      } else {
        return end(await sync());
      }
    }
  }
}
