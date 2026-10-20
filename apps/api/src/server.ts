import { createDb } from '@weft/db';
import { createRedis, createRunsQueue, enqueueRun, readLive } from '@weft/queue';
import { createApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const queue = createRunsQueue(redis);

const ok = (p: Promise<unknown>) =>
  p.then(
    () => true,
    () => false,
  );

const app = createApp({
  db,
  enqueue: (runId) => enqueueRun(queue, runId),
  live: () => {
    const conn = redis.duplicate();
    return {
      read: (runId, after, blockMs) => readLive(conn, runId, after, blockMs),
      close: () => conn.disconnect(),
    };
  },
  ready: async () => ({
    db: await ok(pool.query('select 1')),
    redis: await ok(redis.ping()),
  }),
});

const server = app.listen(env.PORT, () => {
  console.log(`weft api listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  server.close();
  await queue.close();
  await redis.quit();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
