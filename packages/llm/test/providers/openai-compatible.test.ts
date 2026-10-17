import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import {
  createOpenAICompatibleProvider,
  fromChatMessage,
  fromFinishReason,
  toChatMessages,
} from '../../src/providers/openai-compatible.ts';
import type { Message } from '../../src/types.ts';

describe('toChatMessages', () => {
  it('maps a tool round trip into assistant tool_calls and tool messages', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'add 1 and 2' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool_call', id: 'c1', name: 'add', input: { a: 1, b: 2 } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', callId: 'c1', content: '3' },
          { type: 'text', text: 'thanks' },
        ],
      },
    ];

    expect(toChatMessages('sys', messages)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'add 1 and 2' },
      {
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '3' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('sends back the raw tool call so provider extras survive', () => {
    const raw = {
      id: 'c1',
      type: 'function',
      function: { name: 'add', arguments: '{}' },
      extra_content: { google: { thought_signature: 'sig' } },
    };
    const out = toChatMessages('s', [
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'c1', name: 'add', input: {}, raw }],
      },
    ]);
    expect(out[1]).toMatchObject({ tool_calls: [raw] });
  });

  it('marks tool errors in the content', () => {
    const out = toChatMessages('s', [
      {
        role: 'user',
        content: [{ type: 'tool_result', callId: 'c', content: 'boom', isError: true }],
      },
    ]);
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'c', content: 'error: boom' });
  });

  it('drops opaque blocks from other providers', () => {
    const out = toChatMessages('s', [
      {
        role: 'assistant',
        content: [
          { type: 'opaque', provider: 'anthropic', data: { type: 'thinking' } },
          { type: 'text', text: 'hi' },
        ],
      },
    ]);
    expect(out[1]).toEqual({ role: 'assistant', content: 'hi' });
  });
});

describe('fromChatMessage', () => {
  const msg = (tool_calls: unknown[], content: string | null = null) =>
    ({ role: 'assistant', content, refusal: null, tool_calls }) as never;

  it('parses tool arguments', () => {
    const blocks = fromChatMessage(
      msg([{ id: 'c1', type: 'function', function: { name: 'add', arguments: '{"a":1}' } }], 'ok'),
    );
    expect(blocks).toMatchObject([
      { type: 'text', text: 'ok' },
      { type: 'tool_call', id: 'c1', name: 'add', input: { a: 1 } },
    ]);
  });

  it('keeps a bad-json call with an inputError instead of throwing', () => {
    const [block] = fromChatMessage(
      msg([{ id: 'c1', type: 'function', function: { name: 'add', arguments: '{oops' } }]),
    );
    expect(block).toMatchObject({ type: 'tool_call', input: undefined });
    expect(block).toHaveProperty('inputError');
  });

  it('fills in missing call ids', () => {
    const [block] = fromChatMessage(
      msg([{ id: '', type: 'function', function: { name: 'add', arguments: '{}' } }]),
    );
    expect(block).toMatchObject({ id: 'call_0', raw: { id: 'call_0' } });
  });
});

describe('fromFinishReason', () => {
  it('treats tool calls as tool_use even when the provider says stop', () => {
    expect(fromFinishReason('stop', true)).toBe('tool_use');
  });

  it.each([
    ['stop', 'end'],
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
    [null, 'other'],
  ] as const)('%s -> %s', (reason, stop) => {
    expect(fromFinishReason(reason, false)).toBe(stop);
  });
});

describe('createOpenAICompatibleProvider', () => {
  const fakeClient = (impl: () => Promise<unknown>) =>
    ({ chat: { completions: { create: impl } } }) as unknown as OpenAI;

  it('normalises usage with cached tokens split out', async () => {
    const provider = createOpenAICompatibleProvider({
      provider: 'gemini',
      model: 'm',
      apiKey: 'k',
      client: fakeClient(() =>
        Promise.resolve({
          model: 'm-001',
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 40 },
          },
        }),
      ),
    });
    const res = await provider.complete({ system: 's', messages: [] });
    expect(res).toMatchObject({
      model: 'm-001',
      stopReason: 'end',
      usage: { inputTokens: 60, cacheReadTokens: 40, outputTokens: 7, cacheWriteTokens: 0 },
    });
  });

  it('maps sdk errors to LLMError with retry-after', async () => {
    const provider = createOpenAICompatibleProvider({
      provider: 'openrouter',
      model: 'm',
      apiKey: 'k',
      client: fakeClient(() =>
        Promise.reject(
          OpenAI.APIError.generate(
            429,
            { message: 'slow down' },
            'slow down',
            new Headers({ 'retry-after': '2' }),
          ),
        ),
      ),
    });
    await expect(provider.complete({ system: 's', messages: [] })).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'rate_limit',
      provider: 'openrouter',
      status: 429,
      retryAfterMs: 2000,
    });
  });
});
