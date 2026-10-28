import type { LLMProvider, Message, StopReason, Usage } from '@weft/llm';
import type { Sandbox } from '@weft/sandbox';
import type { z } from 'zod';
import type { TOOLS } from './tools/definitions.ts';

export type ToolName = keyof typeof TOOLS;

export type ToolArgs = { [K in ToolName]: z.output<(typeof TOOLS)[K]['schema']> };

export type ParsedToolCall = {
  [K in ToolName]: { ok: true; id: string; name: K; args: ToolArgs[K] };
}[ToolName];

export type InvalidToolCall = { ok: false; id: string; name: string; error: string };

export type ToolCallParse = ParsedToolCall | InvalidToolCall;

export type ToolContext = {
  sandbox: Sandbox;
  root: string;
  testCommand: string | null;
  testTimeoutMs: number;
  viewed: Map<string, string>;
};

export type ToolContextOptions = {
  sandbox: Sandbox;
  root: string;
  testCommand?: string | null;
  testTimeoutMs?: number;
};

export type EditResult =
  { ok: true; content: string; replacements: number; line: number } | { ok: false; error: string };

export type ToolOutput = {
  content: string;
  isError: boolean;
};

export type AgentMode = 'code' | 'ask';

export type AgentStatus =
  'finished' | 'max_steps' | 'budget' | 'no_tool_call' | 'max_tokens' | 'refusal' | 'aborted';

export type AgentEvent =
  | {
      type: 'llm';
      step: number;
      stopReason: StopReason;
      usage: Usage;
      latencyMs: number;
      text: string;
    }
  | {
      type: 'tool';
      step: number;
      id: string;
      name: string;
      args: unknown;
      isError: boolean;
      durationMs: number;
      output: string;
    };

export type ToolExecutor = (ctx: ToolContext, call: ParsedToolCall) => Promise<ToolOutput>;

export type AgentOptions = {
  llm: LLMProvider;
  ctx: ToolContext;
  task: string;
  history?: Message[];
  system?: string;
  overview?: boolean;
  mode?: AgentMode;
  maxSteps?: number;
  maxNudges?: number;
  maxTokens?: number;
  tokenBudget?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  execute?: ToolExecutor;
};

export type AgentResult = {
  status: AgentStatus;
  summary: string | undefined;
  steps: number;
  usage: Usage;
  messages: Message[];
  events: AgentEvent[];
};
