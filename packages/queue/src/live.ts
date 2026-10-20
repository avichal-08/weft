import type { Redis } from 'ioredis';

export type LiveEvent = {
  seq: number;
  type: 'llm' | 'tool';
  step: number;
  data: Record<string, unknown>;
  createdAt: string;
};

export type LivePhase = 'clone' | 'sandbox' | 'restore' | 'setup' | 'agent' | 'verify';

export type LiveMessage =
  | { kind: 'phase'; attempt: number; phase: LivePhase; detail?: string }
  | { kind: 'event'; attempt: number; event: LiveEvent }
  | { kind: 'end'; attempt: number };

export type LiveEntry = { id: string; message: LiveMessage };

export const LIVE_MAXLEN = 5000;
export const LIVE_TTL_SECONDS = 24 * 3600;
export const LIVE_ENDED_TTL_SECONDS = 3600;

export const liveKey = (runId: string) => `weft:live:${runId}`;

export async function publishLive(
  redis: Redis,
  runId: string,
  message: LiveMessage,
): Promise<void> {
  const key = liveKey(runId);
  const results = await redis
    .multi()
    .xadd(key, 'MAXLEN', '~', LIVE_MAXLEN, '*', 'm', JSON.stringify(message))
    .expire(key, message.kind === 'end' ? LIVE_ENDED_TTL_SECONDS : LIVE_TTL_SECONDS)
    .exec();
  const failed = results?.find(([err]) => err)?.[0];
  if (failed) throw failed;
}

export async function readLive(
  redis: Redis,
  runId: string,
  after: string,
  blockMs: number,
): Promise<LiveEntry[]> {
  const res = await redis.xread('COUNT', 500, 'BLOCK', blockMs, 'STREAMS', liveKey(runId), after);
  const entries = res?.[0]?.[1] ?? [];
  return entries.map(([id, fields]) => ({
    id,
    message: JSON.parse(fields[fields.indexOf('m') + 1]!) as LiveMessage,
  }));
}
