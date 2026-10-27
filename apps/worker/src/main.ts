import { createDb } from '@weft/db';
import { createProvider, loadLLMConfig } from '@weft/llm';
import { readFileSync } from 'node:fs';
import { githubApp } from '@weft/github';
import {
  createPublishQueue,
  createRedis,
  enqueuePublish,
  PUBLISH_QUEUE,
  publishLive,
  RUNS_QUEUE,
  type PublishJobData,
  type RunJobData,
} from '@weft/queue';
import { reapSandboxes } from '@weft/sandbox';
import { Worker } from 'bullmq';
import { loadEnv } from './env.ts';
import { executeRun, REPO_ROOT } from './execute.ts';
import { dockerDepsImages, installCache } from './install-cache.ts';
import { sessionSandboxes } from './session-sandboxes.ts';
import { describeOutcome, shortId } from './log.ts';
import { followUpPublish, handlePublish } from './publish-job.ts';
import type { RunConfig } from './types.ts';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const connection = createRedis(env.REDIS_URL);
const publisher = createRedis(env.REDIS_URL);

const cache = env.INSTALL_CACHE_DIR
  ? installCache({
      dir: env.INSTALL_CACHE_DIR,
      maxBytes: env.INSTALL_CACHE_MAX_MB * 1024 * 1024,
      images: dockerDepsImages(REPO_ROOT),
      log: (line) => console.log(line),
    })
  : null;

const github =
  env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY_PATH
    ? githubApp({
        appId: env.GITHUB_APP_ID,
        privateKey: readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8'),
      })
    : undefined;
const publishQueue = createPublishQueue(connection);

const sessions = sessionSandboxes({
  max: env.SESSION_SANDBOXES_MAX,
  idleMs: env.SESSION_SANDBOX_IDLE_MS,
  log: (line) => console.log(line),
});

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
    for (const { id, reason, error } of await reapSandboxes()) {
      console.log(
        error
          ? `janitor: could not remove sandbox ${id.slice(0, 12)} (${reason}): ${error}`
          : `janitor: removed sandbox ${id.slice(0, 12)} (${reason})`,
      );
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
    if (typeof job.data?.runId !== 'string') {
      console.error(`job ${job.id}: skipped, no run id in its data`);
      return { kind: 'skipped' };
    }
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
        live: (runId, message) => publishLive(publisher, runId, message),
        ...(cache ? { installCache: cache } : {}),
        sessions,
      },
      job.data.runId,
    );
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`run ${id} ${describeOutcome(outcome)} in ${secs}s`);
    const followUp = await followUpPublish(db, job.data.runId).catch(() => null);
    if (followUp) await enqueuePublish(publishQueue, followUp);
    return outcome;
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

const publishWorker = new Worker<PublishJobData>(
  PUBLISH_QUEUE,
  (job) =>
    handlePublish(
      {
        db,
        createLLM,
        allowFileRepos: env.ALLOW_FILE_REPOS,
        log: (line) => console.log(line),
        ...(github ? { github } : {}),
      },
      job.data,
    ),
  { connection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  console.error(`run ${job?.data.runId}: job failed`, err);
});

console.log(
  `weft worker ${env.WORKER_ID} ready (concurrency ${env.WORKER_CONCURRENCY}, image ${env.SANDBOX_IMAGE}, github app ${github ? 'on' : 'off'})`,
);

async function shutdown(signal: string) {
  console.log(`${signal}: finishing active runs, then exiting`);
  clearInterval(janitorTimer);
  await worker.close();
  await publishWorker.close();
  await publishQueue.close();
  await sessions.clear();
  await connection.quit();
  await publisher.quit();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
