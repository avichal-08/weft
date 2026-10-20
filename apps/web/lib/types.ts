export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'error' | 'cancelled';

export type Run = {
  id: string;
  status: RunStatus;
  attempt: number;
  workerId: string | null;
  repoUrl: string;
  baseRef: string | null;
  task: string;
  testCommand: string;
  config: { provider?: string; model?: string; maxSteps?: number };
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  summary: string | null;
  diff: string | null;
  failureKind: string | null;
  failureDetail: string | null;
};

export type FormState = {
  error?: string;
  fields?: Record<string, string>;
};

export const ACTIVE: readonly RunStatus[] = ['queued', 'running'];
