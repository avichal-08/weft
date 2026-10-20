import type { Db } from '@weft/db';
import type { LLMProvider, RetryOptions } from '@weft/llm';
import type { LiveMessage } from '@weft/queue';
import type { InstallCacheConfig } from './install-cache.ts';

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
  live?: (runId: string, message: LiveMessage) => Promise<void>;
  installCache?: InstallCacheConfig;
};

export type RunOutcome =
  | { kind: 'skipped' }
  | { kind: 'completed'; status: 'succeeded' | 'failed' | 'error'; recorded: boolean }
  | { kind: 'fenced' };
