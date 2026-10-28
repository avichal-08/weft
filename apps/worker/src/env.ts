import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
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
  TOKEN_BUDGET: z.coerce.number().int().min(10_000).default(500_000),
  JANITOR_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),
  INSTALL_CACHE_DIR: z.string().default(join(homedir(), '.cache', 'weft', 'installs')),
  INSTALL_CACHE_MAX_MB: z.coerce.number().int().min(0).default(10_240),
  SESSION_SANDBOXES_MAX: z.coerce.number().int().min(0).default(2),
  SESSION_SANDBOX_IDLE_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(10 * 60_000),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
});

export const loadEnv = (env: NodeJS.ProcessEnv = process.env) => envSchema.parse(env);
