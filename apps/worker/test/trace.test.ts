import { describe, expect, it } from 'vitest';
import { capArgs, toRunEvent } from '../src/trace.ts';

describe('capArgs', () => {
  it('cuts long strings anywhere in the args and says how much was cut', () => {
    const args = { path: 'a.js', content: 'x'.repeat(5000), nested: [{ text: 'y'.repeat(3000) }] };
    const capped = capArgs(args, 100) as {
      path: string;
      content: string;
      nested: { text: string }[];
    };
    expect(capped.path).toBe('a.js');
    expect(capped.content).toBe(`${'x'.repeat(100)}… [4900 more characters]`);
    expect(capped.nested[0]?.text.startsWith('y'.repeat(100))).toBe(true);
  });

  it('leaves numbers, booleans and short strings alone', () => {
    expect(capArgs({ offset: 40, replace_all: false, path: 'x' })).toEqual({
      offset: 40,
      replace_all: false,
      path: 'x',
    });
  });
});

describe('toRunEvent', () => {
  it('maps a model step', () => {
    const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(
      toRunEvent(
        { type: 'llm', step: 2, stopReason: 'tool_use', usage, latencyMs: 900, text: 'hmm' },
        4,
      ),
    ).toEqual({
      seq: 4,
      type: 'llm',
      step: 2,
      data: { stopReason: 'tool_use', usage, latencyMs: 900, text: 'hmm' },
    });
  });

  it('maps a tool call', () => {
    expect(
      toRunEvent(
        {
          type: 'tool',
          step: 2,
          id: 'c1',
          name: 'grep',
          args: { pattern: 'add' },
          isError: false,
          durationMs: 120,
          output: 'src/a.js',
        },
        5,
      ),
    ).toEqual({
      seq: 5,
      type: 'tool',
      step: 2,
      data: {
        id: 'c1',
        name: 'grep',
        args: { pattern: 'add' },
        isError: false,
        durationMs: 120,
        output: 'src/a.js',
      },
    });
  });
});
