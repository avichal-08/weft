import { z } from 'zod';

const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'error', 'cancelled'] as const;

export const createRunBody = z.strictObject({
  repoUrl: z.url({ protocol: /^(https|file)$/ }),
  task: z.string().trim().min(1).max(10_000),
  testCommand: z.string().trim().min(1).max(1000),
  baseRef: z.string().trim().min(1).max(200).optional(),
  config: z
    .strictObject({
      provider: z.enum(['mock', 'anthropic', 'openai', 'gemini', 'openrouter']).optional(),
      model: z.string().min(1).max(200).optional(),
      maxSteps: z.number().int().min(1).max(100).optional(),
    })
    .default({}),
});

export const listRunsQuery = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const runIdParam = z.object({ id: z.uuid() });

export const definedOnly = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
