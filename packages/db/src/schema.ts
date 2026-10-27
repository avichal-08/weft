import type { PhaseTiming, PublishState } from './types.ts';
import { sql } from 'drizzle-orm';
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

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    repoUrl: text('repo_url').notNull(),
    baseRef: text('base_ref'),
    testCommand: text('test_command'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    branch: text('branch'),
    pushedTurn: integer('pushed_turn'),
    pushedSha: text('pushed_sha'),
    publishError: text('publish_error'),
    publishState: text('publish_state').$type<PublishState>(),
    prNumber: integer('pr_number'),
    prUrl: text('pr_url'),
  },
  (t) => [index('sessions_updated_idx').on(t.updatedAt.desc())],
);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    turn: integer('turn'),
    status: runStatus('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    workerId: text('worker_id'),

    repoUrl: text('repo_url').notNull(),
    baseRef: text('base_ref'),
    task: text('task').notNull(),
    testCommand: text('test_command'),
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
    timings: jsonb('timings').$type<PhaseTiming[]>(),
  },
  (t) => [
    index('runs_status_created_idx').on(t.status, t.createdAt),
    index('runs_created_idx').on(t.createdAt.desc()),
    uniqueIndex('runs_session_turn_idx').on(t.sessionId, t.turn),
    uniqueIndex('runs_one_active_turn_idx')
      .on(t.sessionId)
      .where(sql`${t.status} in ('queued', 'running')`),
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

export const commits = pgTable(
  'commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    turn: integer('turn').notNull(),
    message: text('message').notNull(),
    sha: text('sha'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('commits_session_idx').on(t.sessionId, t.createdAt)],
);

export const schema = { runStatus, sessions, runs, runEventType, runEvents, commits };
