import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { LLMError } from '../src/errors.ts';
import { createAnthropicProvider } from '../src/providers/anthropic.ts';
import { createMockProvider } from '../src/providers/mock.ts';
import {
  assembleStream,
  createOpenAICompatibleProvider,
} from '../src/providers/openai-compatible.ts';
import { withRetry } from '../src/retry.ts';
import type { TextEvent } from '../src/types.ts';

const req = { system: 's', messages: [] };

async function* chunks(...items: unknown[]) {
  for (const item of items) {
    await Promise.resolve();
    yield item as OpenAI.Chat.Completions.ChatCompletionChunk;
  }
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  model: 'm-001',
  choices: [{ index: 0, delta: d, finish_reason: finish }],
});

describe('assembleStream', () => {
  it('forwards text and rebuilds tool calls split across chunks, keeping extra fields', async () => {
    const texts: string[] = [];
    const out = await assembleStream(
      chunks(
        delta({ content: 'Let me ' }),
        delta({ content: 'look.' }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'c1',
              type: 'function',
              function: { name: 'grep', arguments: '{"pat' },
              extra_content: { google: { thought_signature: 'sig' } },
            },
          ],
        }),
        delta(
          { tool_calls: [{ index: 0, function: { arguments: 'tern":"add"}' } }] },
          'tool_calls',
        ),
        { model: 'm-001', choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } },
      ),
      (t) => texts.push(t),
    );
    expect(texts).toEqual(['Let me ', 'look.']);
    expect(out.message.content).toBe('Let me look.');
    expect(out.message.tool_calls).toEqual([
      {
        id: 'c1',
        type: 'function',
        function: { name: 'grep', arguments: '{"pattern":"add"}' },
        extra_content: { google: { thought_signature: 'sig' } },
      },
    ]);
    expect(out).toMatchObject({ finishReason: 'tool_calls', model: 'm-001' });
    expect(out.usage).toMatchObject({ prompt_tokens: 50, completion_tokens: 9 });
  });
});

describe('assembleStream with Gemini chunks', () => {
  it('takes whole tool calls that come without an index', async () => {
    const out = await assembleStream(
      chunks(
        delta({
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
              extra_content: { google: { thought_signature: 'sig' } },
            },
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"b.ts"}' },
            },
          ],
        }),
        delta({ role: 'assistant' }, 'stop'),
      ),
      () => {},
    );
    expect(
      out.message.tool_calls?.map((c) => [c.id, c.type === 'function' && c.function.arguments]),
    ).toEqual([
      ['call_1', '{"path":"a.ts"}'],
      ['call_2', '{"path":"b.ts"}'],
    ]);
    expect(out.message.tool_calls?.[0]).toHaveProperty(
      'extra_content.google.thought_signature',
      'sig',
    );
  });
});

describe('streaming providers', () => {
  it('streams an OpenAI-compatible reply and returns the same response shape', async () => {
    let sent: Record<string, unknown> = {};
    const provider = createOpenAICompatibleProvider({
      provider: 'gemini',
      model: 'm',
      apiKey: 'k',
      client: {
        chat: {
          completions: {
            create: (body: Record<string, unknown>) => {
              sent = body;
              return Promise.resolve(
                chunks(delta({ content: 'It ' }), delta({ content: 'adds.' }, 'stop'), {
                  model: 'm-001',
                  choices: [],
                  usage: { prompt_tokens: 10, completion_tokens: 2 },
                }),
              );
            },
          },
        },
      } as unknown as OpenAI,
    });
    const events: TextEvent[] = [];
    const res = await provider.complete({ ...req, onText: (e) => events.push(e) });
    expect(sent).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(events).toEqual([
      { type: 'text', text: 'It ' },
      { type: 'text', text: 'adds.' },
    ]);
    expect(res).toMatchObject({
      content: [{ type: 'text', text: 'It adds.' }],
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 2 },
    });
  });

  it('streams an Anthropic reply through messages.stream', async () => {
    const listeners: ((text: string) => void)[] = [];
    const provider = createAnthropicProvider({
      model: 'claude-haiku-5-5',
      client: {
        messages: {
          stream: () => ({
            on: (event: string, fn: (text: string) => void) => {
              if (event === 'text') listeners.push(fn);
            },
            finalMessage: () => {
              for (const fn of listeners) {
                fn('Hel');
                fn('lo');
              }
              return Promise.resolve({
                model: 'claude-haiku-5-5',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'Hello' }],
                usage: { input_tokens: 3, output_tokens: 2 },
              });
            },
          }),
        },
      } as unknown as Anthropic,
    });
    const texts: string[] = [];
    const res = await provider.complete({
      ...req,
      onText: (e) => {
        if (e.type === 'text') texts.push(e.text);
      },
    });
    expect(texts).toEqual(['Hel', 'lo']);
    expect(res).toMatchObject({ content: [{ type: 'text', text: 'Hello' }], stopReason: 'end' });
  });

  it('streams mock text in chunks', async () => {
    const mock = createMockProvider([{ content: [{ type: 'text', text: 'abcdefghijkl' }] }]);
    const texts: string[] = [];
    await mock.complete({ ...req, onText: (e) => e.type === 'text' && texts.push(e.text) });
    expect(texts.join('')).toBe('abcdefghijkl');
    expect(texts.length).toBeGreaterThan(1);
    expect(mock.calls[0]).not.toHaveProperty('onText');
  });
});

describe('withRetry while streaming', () => {
  const overloaded = new LLMError({ kind: 'overloaded', provider: 'mock', message: 'busy' });

  it('resets the streamed text before retrying, so a half reply is never duplicated', async () => {
    const inner = createMockProvider((r, turn) => {
      if (turn === 0) {
        r.onText?.({ type: 'text', text: 'half a rep' });
        return overloaded;
      }
      return { content: [{ type: 'text', text: 'full' }] };
    });
    const events: TextEvent[] = [];
    const res = await withRetry(inner, { sleep: () => Promise.resolve() }).complete({
      ...req,
      onText: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'text', text: 'half a rep' },
      { type: 'reset' },
      { type: 'text', text: 'full' },
    ]);
    expect(res.content).toEqual([{ type: 'text', text: 'full' }]);
  });

  it('sends no reset when nothing was streamed before the failure', async () => {
    const inner = createMockProvider((_, turn) =>
      turn === 0 ? overloaded : { content: [{ type: 'text', text: 'ok' }] },
    );
    const events: TextEvent[] = [];
    await withRetry(inner, { sleep: () => Promise.resolve() }).complete({
      ...req,
      onText: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  });
});
