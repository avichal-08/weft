export type RunMode = 'code' | 'ask';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'error' | 'cancelled';

export type Run = {
  id: string;
  sessionId: string | null;
  turn: number | null;
  status: RunStatus;
  attempt: number;
  workerId: string | null;
  repoUrl: string;
  baseRef: string | null;
  task: string;
  mode: RunMode;
  testCommand: string | null;
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
  timings: { phase: string; ms: number }[] | null;
};

export type FormState = {
  error?: string;
  fields?: Record<string, string>;
  sent?: number;
};

export const ACTIVE: readonly RunStatus[] = ['queued', 'running'];

export type LivePhase = {
  phase: 'clone' | 'sandbox' | 'restore' | 'setup' | 'agent' | 'verify';
  detail: string | null;
};

export type LlmEventData = {
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  latencyMs?: number;
  text?: string;
};

export type ToolEventData = {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  isError: boolean;
  durationMs: number;
  output: string;
};

export type RunEvent =
  | { seq: number; step: number; type: 'llm'; data: LlmEventData; createdAt: string }
  | { seq: number; step: number; type: 'tool'; data: ToolEventData; createdAt: string };

export type Session = {
  id: string;
  title: string;
  repoUrl: string;
  baseRef: string | null;
  testCommand: string | null;
  config: { provider?: string; model?: string; maxSteps?: number };
  createdAt: string;
  updatedAt: string;
  branch: string | null;
  pushedTurn: number | null;
  publishState: 'queued' | 'pushing' | 'pushed' | 'failed' | null;
  publishError: string | null;
  prNumber: number | null;
  prUrl: string | null;
};

export type SessionSummary = Session & { turns: number; lastStatus: RunStatus | null };

export type Commit = {
  id: string;
  sessionId: string;
  turn: number;
  message: string;
  sha: string | null;
  createdAt: string;
};

export type SessionWithTurns = Session & { turns: Run[]; commits: Commit[] };
