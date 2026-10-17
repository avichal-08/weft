import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  createAnthropicProvider,
  fromAnthropicContent,
  fromAnthropicStop,
  toAnthropicMessages,
} from '../../src/providers/anthropic.ts';

describe('anthropic mapping', () => {
  it('round-trips thinking blocks verbatim and drops foreign opaque blocks', () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const blocks = fromAnthropicContent([
      thinking as Anthropic.ContentBlock,
      { type: 'tool_use', id: 't1', name: 'add', input: { a: 1 } } as Anthropic.ContentBlock,
    ]);
    expect(blocks).toEqual([
      { type: 'opaque', provider: 'anthropic', data: thinking },
      { type: 'tool_call', id: 't1', name: 'add', input: { a: 1 } },
    ]);

    const params = toAnthropicMessages([
      { role: 'assistant', content: [...blocks, { type: 'opaque', provider: 'gemini', data: {} }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', callId: 't1', content: 'x', isError: true }],
      },
    ]);
    expect(params).toEqual([
      {
        role: 'assistant',
        content: [thinking, { type: 'tool_use', id: 't1', name: 'add', input: { a: 1 } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: true }],
      },
    ]);
  });

  it.each([
    ['end_turn', 'end'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ] as const)('stop %s -> %s', (reason, stop) => {
    expect(fromAnthropicStop(reason)).toBe(stop);
  });
});

describe('createAnthropicProvider', () => {
  const fakeClient = (impl: (body: unknown) => Promise<unknown>) =>
    ({ messages: { create: impl } }) as unknown as Anthropic;

  it('sends tools and normalises usage', async () => {
    let sent: Record<string, unknown> = {};
    const provider = createAnthropicProvider({
      model: 'claude-haiku-5-5',
      client: fakeClient((body) => {
        sent = body as Record<string, unknown>;
        return Promise.resolve({
          model: 'claude-haiku-5-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'hi' }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 90,
            cache_creation_input_tokens: null,
          },
        });
      }),
    });

    const res = await provider.complete({
      system: 's',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      tools: [{ name: 'add', description: 'adds', inputSchema: { type: 'object' } }],
    });

    expect(sent).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 's',
      tools: [{ name: 'add', description: 'adds', input_schema: { type: 'object' } }],
    });
    expect(res.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 90,
      cacheWriteTokens: 0,
    });
  });

  it('maps overloaded to a retryable error', async () => {
    const provider = createAnthropicProvider({
      model: 'm',
      client: fakeClient(() =>
        Promise.reject(
          Anthropic.APIError.generate(
            529,
            { type: 'overloaded_error' },
            'overloaded',
            new Headers(),
          ),
        ),
      ),
    });
    const err = await provider.complete({ system: 's', messages: [] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'overloaded', retryable: true, status: 529 });
  });
});
