import Anthropic from '@anthropic-ai/sdk';
import { kindFromStatus, LLMError, retryAfterMs } from '../errors.ts';
import type {
  AnthropicOptions,
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
  LLMProvider,
  Message,
  StopReason,
  ToolSpec,
} from '../types.ts';

const PROVIDER = 'anthropic';

export function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.flatMap((b): Anthropic.ContentBlockParam[] => {
      switch (b.type) {
        case 'text':
          return b.text ? [{ type: 'text', text: b.text }] : [];
        case 'tool_call':
          return [{ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} }];
        case 'tool_result':
          return [
            {
              type: 'tool_result',
              tool_use_id: b.callId,
              content: b.content,
              ...(b.isError ? { is_error: true } : {}),
            },
          ];
        case 'opaque':
          return b.provider === PROVIDER ? [b.data as Anthropic.ContentBlockParam] : [];
      }
    }),
  }));
}

export function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

export function fromAnthropicContent(content: Anthropic.ContentBlock[]): ContentBlock[] {
  return content.map((b): ContentBlock => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'tool_use') return { type: 'tool_call', id: b.id, name: b.name, input: b.input };
    return { type: 'opaque', provider: PROVIDER, data: b };
  });
}

export function fromAnthropicStop(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const base = { provider: PROVIDER, cause: err };
  if (err instanceof Anthropic.APIUserAbortError) {
    return new LLMError({ ...base, kind: 'aborted', message: 'request aborted' });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LLMError({ ...base, kind: 'timeout', message: err.message });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError({ ...base, kind: 'network', message: err.message });
  }
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    return new LLMError({
      ...base,
      kind: kindFromStatus(err.status),
      status: err.status,
      retryAfterMs: retryAfterMs(err.headers as Headers | undefined),
      message: err.message,
    });
  }
  return new LLMError({ ...base, kind: 'unknown', message: String(err) });
}

export function createAnthropicProvider(opts: AnthropicOptions): LLMProvider {
  const client =
    opts.client ??
    new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      timeout: opts.timeoutMs ?? 120_000,
      maxRetries: 0,
    });

  return {
    provider: PROVIDER,
    model: opts.model,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const started = performance.now();
      try {
        const params = {
          model: opts.model,
          max_tokens: req.maxTokens ?? 16_000,
          system: req.system,
          messages: toAnthropicMessages(req.messages),
          ...(req.tools?.length ? { tools: toAnthropicTools(req.tools) } : {}),
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        };
        const options = req.signal ? { signal: req.signal } : {};
        let res: Anthropic.Message;
        if (req.onText) {
          const onText = req.onText;
          const stream = client.messages.stream(params, options);
          stream.on('text', (text) => onText({ type: 'text', text }));
          res = await stream.finalMessage();
        } else {
          res = await client.messages.create(params, options);
        }
        return {
          content: fromAnthropicContent(res.content),
          stopReason: fromAnthropicStop(res.stop_reason),
          usage: {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
            cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
          },
          model: res.model,
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (err) {
        throw toLLMError(err);
      }
    },
  };
}
