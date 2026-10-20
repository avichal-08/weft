import type { Db } from '@weft/db';
import type { LLMProvider, RetryOptions } from '@weft/llm';

export type RunConfig = {
  provider?: string;
  model?: string;
  maxSteps?: number;
};

export type WorkerDeps = {
  db: Db;
  workerId: string;
  sandboxImage: string;
  createLLM: (config: RunConfig) => LLMProvider;
  allowFileRepos?: boolean;
  watchIntervalMs?: number;
  retry?: RetryOptions;
  log?: (line: string) => void;
};

export type RunOutcome =
  | { kind: 'skipped' }
  | { kind: 'completed'; status: 'succeeded' | 'failed' | 'error'; recorded: boolean }
  | { kind: 'fenced' };
