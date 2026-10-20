import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRedis,
  LIVE_ENDED_TTL_SECONDS,
  liveKey,
  publishLive,
  readLive,
  type LiveMessage,
} from '../src/index.ts';

const redis = createRedis();
const reader = redis.duplicate();

afterAll(async () => {
  await redis.quit();
  await reader.quit();
});

const event = (seq: number): LiveMessage => ({
  kind: 'event',
  attempt: 1,
  event: {
    seq,
    type: 'tool',
    step: 1,
    data: { name: 'grep' },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
});

describe('live stream', () => {
  it('reads messages back in order, from any cursor', async () => {
    const runId = randomUUID();
    await publishLive(redis, runId, { kind: 'phase', attempt: 1, phase: 'clone' });
    await publishLive(redis, runId, event(0));
    await publishLive(redis, runId, event(1));

    const all = await readLive(reader, runId, '0', 100);
    expect(all.map((e) => e.message.kind)).toEqual(['phase', 'event', 'event']);
    expect(all[2]?.message).toEqual(event(1));

    const rest = await readLive(reader, runId, all[0]!.id, 100);
    expect(rest.map((e) => e.id)).toEqual([all[1]!.id, all[2]!.id]);
  });

  it('wakes a blocked reader as soon as a message is published', async () => {
    const runId = randomUUID();
    const started = performance.now();
    const read = readLive(reader, runId, '$', 5000);
    await new Promise((r) => setTimeout(r, 50));
    await publishLive(redis, runId, event(0));

    expect((await read).map((e) => e.message)).toEqual([event(0)]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('returns nothing when the block times out', async () => {
    expect(await readLive(reader, randomUUID(), '0', 50)).toEqual([]);
  });

  it('expires the stream an hour after the run ends', async () => {
    const runId = randomUUID();
    await publishLive(redis, runId, event(0));
    expect(await redis.ttl(liveKey(runId))).toBeGreaterThan(LIVE_ENDED_TTL_SECONDS);
    await publishLive(redis, runId, { kind: 'end', attempt: 1 });
    expect(await redis.ttl(liveKey(runId))).toBeLessThanOrEqual(LIVE_ENDED_TTL_SECONDS);
  });
});
