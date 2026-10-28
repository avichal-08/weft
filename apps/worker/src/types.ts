import type { Db } from '@weft/db';
import type { LLMProvider, RetryOptions } from '@weft/llm';
import type { LiveMessage } from '@weft/queue';
import type { InstallCache } from './install-cache.ts';
import type { SessionSandboxes } from './session-sandboxes.ts';

export type RunConfig = {
  provider?: string;
  model?: string;
  maxSteps?: number;
  tokenBudget?: number;
};

export type WorkerDeps = {
  db: Db;
  workerId: string;
  sandboxImage: string;
  createLLM: (config: RunConfig) => LLMProvider;
  allowFileRepos?: boolean;
  tokenBudget?: number;
  watchIntervalMs?: number;
  diskLimitMb?: number;
  diskCheckMs?: number;
  retry?: RetryOptions;
  log?: (line: string) => void;
  live?: (runId: string, message: LiveMessage) => Promise<void>;
  installCache?: InstallCache;
  sessions?: SessionSandboxes;
};

export type RunOutcome =
  | { kind: 'skipped' }
  | { kind: 'completed'; status: 'succeeded' | 'failed' | 'error'; recorded: boolean }
  | { kind: 'fenced' };
