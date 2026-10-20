import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { runs, schema } from './schema.ts';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStatus = Run['status'];

export type CreateRunInput = {
  repoUrl: string;
  task: string;
  testCommand: string;
  baseRef?: string;
  config?: Record<string, unknown>;
};

export type ListRunsOptions = {
  status?: RunStatus;
  limit?: number;
};

export type RunUsage = {
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type CompleteRunInput = Partial<RunUsage> & {
  status: 'succeeded' | 'failed' | 'error';
  summary?: string;
  diff?: string;
  failureKind?: string;
  failureDetail?: string;
};
