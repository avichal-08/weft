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
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

export type Assembled = {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  finishReason: string | null;
  usage: OpenAI.CompletionUsage | undefined;
  model: string;
};

export async function assembleStream(
  chunks: AsyncIterable<Chunk>,
  onText: (text: string) => void,
): Promise<Assembled> {
  let text = '';
  let finishReason: string | null = null;
  let usage: OpenAI.CompletionUsage | undefined;
  let model = '';
  const calls: (ChatToolCall & Record<string, unknown>)[] = [];

  for await (const chunk of chunks) {
    model ||= chunk.model;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices[0];
    if (!choice) continue;
    finishReason = choice.finish_reason ?? finishReason;
    const delta = choice.delta;
    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const {
        index,
        id,
        type: _type,
        function: fn,
        ...extra
      } = part as typeof part & {
        index?: number;
      };
      const at =
        index ??
        (id
          ? (() => {
              const found = calls.findIndex((c) => c.id === id);
              return found >= 0 ? found : calls.length;
            })()
          : Math.max(calls.length - 1, 0));
      const call = (calls[at] ??= {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      });
      if (id) call.id = id;
      if (fn?.name) call.function.name = fn.name;
      if (fn?.arguments) call.function.arguments += fn.arguments;
      Object.assign(call, extra);
    }
  }

  const toolCalls = calls.filter(Boolean);
  return {
    message: {
      role: 'assistant',
      content: text || null,
      refusal: null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    finishReason,
    usage,
    model,
  };
}

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
        const params = {
          model: opts.model,
          max_completion_tokens: req.maxTokens ?? 16_000,
          messages: toChatMessages(req.system, req.messages),
          ...(req.tools?.length ? { tools: toChatTools(req.tools) } : {}),
        };
        const options = req.signal ? { signal: req.signal } : {};
        let result: Assembled;
        if (req.onText) {
          const onText = req.onText;
          const chunks = await client.chat.completions.create(
            { ...params, stream: true, stream_options: { include_usage: true } },
            options,
          );
          result = await assembleStream(chunks, (text) => onText({ type: 'text', text }));
        } else {
          const res = await client.chat.completions.create(params, options);
          const choice = res.choices[0];
          if (!choice) {
            throw new LLMError({ provider: opts.provider, kind: 'server', message: 'no choices' });
          }
          result = {
            message: choice.message,
            finishReason: choice.finish_reason,
            usage: res.usage,
            model: res.model,
          };
        }
        const content = fromChatMessage(result.message);
        const cached = result.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        return {
          content,
          stopReason: fromFinishReason(
            result.finishReason,
            content.some((b) => b.type === 'tool_call'),
          ),
          usage: {
            inputTokens: (result.usage?.prompt_tokens ?? 0) - cached,
            outputTokens: result.usage?.completion_tokens ?? 0,
            cacheReadTokens: cached,
            cacheWriteTokens: 0,
          },
          model: result.model || opts.model,
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (err) {
        throw toLLMError(opts.provider, err);
      }
    },
  };
}
