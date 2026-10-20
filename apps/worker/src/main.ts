import { createDb } from '@weft/db';
import { createProvider, loadLLMConfig } from '@weft/llm';
import { createRedis, RUNS_QUEUE, type RunJobData } from '@weft/queue';
import { reapSandboxes } from '@weft/sandbox';
import { Worker } from 'bullmq';
import { loadEnv } from './env.ts';
import { executeRun } from './execute.ts';
import { describeOutcome, shortId } from './log.ts';
import type { RunConfig } from './types.ts';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const connection = createRedis(env.REDIS_URL);

const createLLM = (config: RunConfig) =>
  createProvider(
    loadLLMConfig({
      ...process.env,
      ...(config.provider ? { LLM_PROVIDER: config.provider } : {}),
      ...(config.model ? { LLM_MODEL: config.model } : {}),
    }),
  );

async function janitor() {
  try {
    for (const { id, reason } of await reapSandboxes()) {
      console.log(`janitor: removed sandbox ${id.slice(0, 12)} (${reason})`);
    }
  } catch (err) {
    console.error('janitor failed', err);
  }
}

await janitor();
const janitorTimer = setInterval(() => void janitor(), env.JANITOR_INTERVAL_MS);

const worker = new Worker<RunJobData>(
  RUNS_QUEUE,
  async (job) => {
    const id = shortId(job.data.runId);
    const started = performance.now();
    console.log(`run ${id} started (${job.data.runId})`);
    const outcome = await executeRun(
      {
        db,
        workerId: env.WORKER_ID,
        sandboxImage: env.SANDBOX_IMAGE,
        createLLM,
        allowFileRepos: env.ALLOW_FILE_REPOS,
        log: (line) => console.log(line),
      },
      job.data.runId,
    );
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`run ${id} ${describeOutcome(outcome)} in ${secs}s`);
    return outcome;
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

worker.on('failed', (job, err) => {
  console.error(`run ${job?.data.runId}: job failed`, err);
});

console.log(
  `weft worker ${env.WORKER_ID} ready (concurrency ${env.WORKER_CONCURRENCY}, image ${env.SANDBOX_IMAGE})`,
);

async function shutdown(signal: string) {
  console.log(`${signal}: finishing active runs, then exiting`);
  clearInterval(janitorTimer);
  await worker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
