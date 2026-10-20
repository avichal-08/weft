import { describe, expect, it } from 'vitest';
import { LLMError } from '../src/errors.ts';
import type { LLMErrorKind } from '../src/types.ts';
import { createMockProvider } from '../src/providers/mock.ts';
import { backoffDelay, withRetry } from '../src/retry.ts';

const fail = (kind: LLMErrorKind, retryAfterMs?: number) =>
  new LLMError({ kind, provider: 'mock', message: kind, retryAfterMs });

const req = { system: 's', messages: [] };

function setup(outcomes: (LLMError | 'ok')[], maxAttempts = 4, maxRetryAfterMs?: number) {
  const inner = createMockProvider((_, turn) => {
    const o = outcomes[turn];
    return o === 'ok' || o === undefined ? { content: [{ type: 'text', text: 'done' }] } : o;
  });
  const slept: number[] = [];
  const provider = withRetry(inner, {
    maxAttempts,
    ...(maxRetryAfterMs ? { maxRetryAfterMs } : {}),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
  });
  return { inner, provider, slept };
}

describe('withRetry', () => {
  it('retries transient errors until success', async () => {
    const { inner, provider, slept } = setup([fail('rate_limit'), fail('server'), 'ok']);
    await expect(provider.complete(req)).resolves.toMatchObject({ stopReason: 'end' });
    expect(inner.calls).toHaveLength(3);
    expect(slept).toEqual([500, 1000]);
  });

  it('does not retry permanent errors', async () => {
    const { inner, provider } = setup([fail('bad_request'), 'ok']);
    await expect(provider.complete(req)).rejects.toMatchObject({ kind: 'bad_request' });
    expect(inner.calls).toHaveLength(1);
  });

  it('gives up after maxAttempts', async () => {
    const { inner, provider } = setup([fail('server'), fail('server'), fail('server')], 3);
    await expect(provider.complete(req)).rejects.toMatchObject({ kind: 'server' });
    expect(inner.calls).toHaveLength(3);
  });

  it('honours retry-after over backoff', async () => {
    const { provider, slept } = setup([fail('rate_limit', 7000), 'ok']);
    await provider.complete(req);
    expect(slept).toEqual([7000]);
  });

  it('waits as long as the server asks, beyond the backoff cap', async () => {
    const { provider, slept } = setup([fail('rate_limit', 54_000), 'ok']);
    await provider.complete(req);
    expect(slept).toEqual([54_000]);
  });

  it('gives up at once when the server asks for longer than maxRetryAfterMs', async () => {
    const { inner, provider, slept } = setup([fail('rate_limit', 6 * 3600_000), 'ok'], 4, 120_000);
    await expect(provider.complete(req)).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(inner.calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('rethrows non-llm errors untouched', async () => {
    const inner = createMockProvider(() => new TypeError('bug'));
    await expect(withRetry(inner).complete(req)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('backoffDelay', () => {
  const opts = { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0.999 };

  it('grows exponentially and caps', () => {
    const delays = [1, 2, 3, 4, 5].map((a) => backoffDelay(a, fail('server'), opts));
    expect(delays).toEqual([999, 1998, 3996, 7992, 7992]);
  });

  it('uses a server retry-after as given', () => {
    expect(backoffDelay(1, fail('rate_limit', 60_000), opts)).toBe(60_000);
  });
});
