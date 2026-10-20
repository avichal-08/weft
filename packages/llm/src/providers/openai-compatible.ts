import OpenAI from 'openai';
import { kindFromStatus, LLMError, retryAfterMs, retryDelayFromBody } from '../errors.ts';
import type {
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
  LLMProvider,
  Message,
  OpenAICompatibleOptions,
  StopReason,
  ToolSpec,
} from '../types.ts';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatToolCall = OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

export function toChatMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }];

  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const calls = m.content.flatMap((b): ChatToolCall[] =>
        b.type === 'tool_call'
          ? [
              (b.raw as ChatToolCall | undefined) ?? {
                id: b.id,
                type: 'function',
                function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
              },
            ]
          : [],
      );
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
      continue;
    }

    for (const b of m.content) {
      if (b.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: b.callId,
          content: b.isError ? `error: ${b.content}` : b.content,
        });
      }
    }
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    if (text) out.push({ role: 'user', content: text });
  }

  return out;
}

export function toChatTools(tools: ToolSpec[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export function fromChatMessage(
  msg: OpenAI.Chat.Completions.ChatCompletionMessage,
): ContentBlock[] {
  const content: ContentBlock[] = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });

  msg.tool_calls?.forEach((call, i) => {
    if (call.type !== 'function') return;
    const id = call.id || `call_${i}`;
    const raw = call.id ? call : { ...call, id };
    try {
      const input: unknown = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      content.push({ type: 'tool_call', id, name: call.function.name, input, raw });
    } catch {
      content.push({
        type: 'tool_call',
        id,
        name: call.function.name,
        input: undefined,
        inputError: `arguments were not valid JSON: ${call.function.arguments}`,
        raw,
      });
    }
  });

  return content;
}

export function fromFinishReason(reason: string | null, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_use';
  switch (reason) {
    case 'stop':
      return 'end';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

export function toLLMError(provider: string, err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const base = { provider, cause: err };
  if (err instanceof OpenAI.APIUserAbortError) {
    return new LLMError({ ...base, kind: 'aborted', message: 'request aborted' });
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new LLMError({ ...base, kind: 'timeout', message: err.message });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new LLMError({ ...base, kind: 'network', message: err.message });
  }
  if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
    return new LLMError({
      ...base,
      kind: kindFromStatus(err.status),
      status: err.status,
      retryAfterMs:
        retryAfterMs(err.headers as Headers | undefined) ??
        retryDelayFromBody(err.error, err.message),
      message: err.message,
    });
  }
  return new LLMError({ ...base, kind: 'unknown', message: String(err) });
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): LLMProvider {
  const client =
    opts.client ??
    new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.headers ? { defaultHeaders: opts.headers } : {}),
      timeout: opts.timeoutMs ?? 120_000,
      maxRetries: 0,
    });

  return {
    provider: opts.provider,
    model: opts.model,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const started = performance.now();
      try {
        const res = await client.chat.completions.create(
          {
            model: opts.model,
            max_completion_tokens: req.maxTokens ?? 16_000,
            messages: toChatMessages(req.system, req.messages),
            ...(req.tools?.length ? { tools: toChatTools(req.tools) } : {}),
          },
          req.signal ? { signal: req.signal } : {},
        );
        const choice = res.choices[0];
        if (!choice) {
          throw new LLMError({ provider: opts.provider, kind: 'server', message: 'no choices' });
        }
        const content = fromChatMessage(choice.message);
        const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        return {
          content,
          stopReason: fromFinishReason(
            choice.finish_reason,
            content.some((b) => b.type === 'tool_call'),
          ),
          usage: {
            inputTokens: (res.usage?.prompt_tokens ?? 0) - cached,
            outputTokens: res.usage?.completion_tokens ?? 0,
            cacheReadTokens: cached,
            cacheWriteTokens: 0,
          },
          model: res.model || opts.model,
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (err) {
        throw toLLMError(opts.provider, err);
      }
    },
  };
}
