import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'error',
  'cancelled',
]);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: runStatus('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    workerId: text('worker_id'),

    repoUrl: text('repo_url').notNull(),
    baseRef: text('base_ref'),
    task: text('task').notNull(),
    testCommand: text('test_command').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    steps: integer('steps').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),

    summary: text('summary'),
    diff: text('diff'),
    failureKind: text('failure_kind'),
    failureDetail: text('failure_detail'),
  },
  (t) => [
    index('runs_status_created_idx').on(t.status, t.createdAt),
    index('runs_created_idx').on(t.createdAt.desc()),
  ],
);

export const schema = { runStatus, runs };
