import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

export const runEventType = pgEnum('run_event_type', ['llm', 'tool']);

export const runEvents = pgTable(
  'run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    seq: integer('seq').notNull(),
    type: runEventType('type').notNull(),
    step: integer('step').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_events_run_attempt_seq_idx').on(t.runId, t.attempt, t.seq)],
);

export const schema = { runStatus, runs, runEventType, runEvents };
