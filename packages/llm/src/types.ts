import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import type { LLMError } from './errors.ts';

export type TextBlock = { type: 'text'; text: string };

export type ToolCallBlock = {
  type: 'tool_call';
  id: string;
  name: string;
  input: unknown;
  inputError?: string;
  raw?: unknown;
};

export type ToolResultBlock = {
  type: 'tool_result';
  callId: string;
  content: string;
  isError?: boolean;
};

export type OpaqueBlock = { type: 'opaque'; provider: string; data: unknown };

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock | OpaqueBlock;

export type Message = { role: 'user' | 'assistant'; content: ContentBlock[] };

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type CompletionRequest = {
  system: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type CompletionResponse = {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: Usage;
  model: string;
  latencyMs: number;
};

export interface LLMProvider {
  readonly provider: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export type LLMErrorKind =
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'not_found'
  | 'aborted'
  | 'unknown';

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryAfterMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: LLMError }) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AnthropicOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeoutMs?: number;
  effort?: Effort;
  client?: Anthropic;
};

export type OpenAICompatibleOptions = {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  client?: OpenAI;
};

export type MockTurn = {
  content: ContentBlock[];
  stopReason?: StopReason;
  usage?: Partial<Usage>;
};

export type MockScript = MockTurn[] | ((req: CompletionRequest, turn: number) => MockTurn | Error);

export type MockProvider = LLMProvider & { readonly calls: CompletionRequest[] };

export type ProviderName = 'mock' | 'anthropic' | 'openai' | 'gemini' | 'openrouter';

export type LLMConfig = {
  provider: ProviderName;
  model: string;
  apiKey: string | undefined;
  baseURL: string | undefined;
  timeoutMs: number | undefined;
};
