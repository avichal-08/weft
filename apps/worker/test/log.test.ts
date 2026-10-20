import { LLMError } from '@weft/llm';
import { describe, expect, it } from 'vitest';
import { describeEvent, describeOutcome, describeRetry, shortId } from '../src/log.ts';

describe('worker log lines', () => {
  it('shortens run ids', () => {
    expect(shortId('1b1e4ee1-65f1-40ad-a705-edbec9d7639d')).toBe('1b1e4ee1');
  });

  it('describes model steps and tool calls with timing', () => {
    const usage = { inputTokens: 1975, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(
      describeEvent({
        type: 'llm',
        step: 3,
        stopReason: 'tool_use',
        usage,
        latencyMs: 1700,
        text: '',
      }),
    ).toBe('#3 llm 1.7s in=1975 out=10');
    expect(
      describeEvent({
        type: 'tool',
        step: 3,
        id: 'c',
        name: 'view_file',
        args: {},
        isError: false,
        durationMs: 149,
        output: '',
      }),
    ).toBe('   ✓ view_file 149ms');
  });

  it('describes retries with their wait and reason', () => {
    const err = new LLMError({
      kind: 'rate_limit',
      provider: 'gemini',
      message: 'quota',
      status: 429,
    });
    expect(describeRetry(1, 45_000, err)).toBe('llm retry 1 in 45.0s: rate_limit (429)');
  });

  it('never calls a refused result an error', () => {
    expect(describeOutcome({ kind: 'fenced' })).toBe('stopped: cancelled or taken over');
    expect(describeOutcome({ kind: 'completed', status: 'error', recorded: false })).toBe(
      'error, not recorded: cancelled or taken over',
    );
    expect(describeOutcome({ kind: 'completed', status: 'succeeded', recorded: true })).toBe(
      'succeeded',
    );
    expect(describeOutcome({ kind: 'skipped' })).toBe('skipped: already finished or cancelled');
  });
});
