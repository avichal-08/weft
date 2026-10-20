import { z } from 'zod';

const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'error', 'cancelled'] as const;

const repoFields = {
  repoUrl: z.url({ protocol: /^(https|file)$/ }),
  baseRef: z.string().trim().min(1).max(200).optional(),
  config: z
    .strictObject({
      provider: z.enum(['mock', 'anthropic', 'openai', 'gemini', 'openrouter']).optional(),
      model: z.string().min(1).max(200).optional(),
      maxSteps: z.number().int().min(1).max(100).optional(),
    })
    .default({}),
};

const message = z.string().trim().min(1).max(20_000);

export const createRunBody = z.strictObject({
  ...repoFields,
  task: z.string().trim().min(1).max(10_000),
  testCommand: z.string().trim().min(1).max(1000),
});

export const createSessionBody = z.strictObject({
  ...repoFields,
  message,
  testCommand: z.string().trim().min(1).max(1000).optional(),
});

export const sendMessageBody = z.strictObject({ message });

export const listSessionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const listRunsQuery = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const runIdParam = z.object({ id: z.uuid() });

export const listEventsQuery = z.object({
  attempt: z.coerce.number().int().min(1).optional(),
  afterSeq: z.coerce.number().int().min(-1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const streamQuery = z.object({
  attempt: z.coerce.number().int().min(0).optional(),
  after: z.coerce.number().int().min(-1).optional(),
});

export const definedOnly = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
