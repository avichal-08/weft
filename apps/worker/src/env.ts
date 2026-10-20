import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SANDBOX_IMAGE: z.string().min(1).default('weft-sandbox:dev'),
  WORKER_ID: z
    .string()
    .min(1)
    .default(`${hostname()}-${randomUUID().slice(0, 8)}`),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(1),
  ALLOW_FILE_REPOS: z.stringbool().default(false),
  JANITOR_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),
});

export const loadEnv = (env: NodeJS.ProcessEnv = process.env) => envSchema.parse(env);
