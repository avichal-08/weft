import { describe, expect, it } from 'vitest';
import { kindFromStatus, LLMError, retryAfterMs, retryDelayFromBody } from '../src/errors.ts';

describe('kindFromStatus', () => {
  it.each([
    [429, 'rate_limit'],
    [529, 'overloaded'],
    [503, 'server'],
    [408, 'timeout'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [400, 'bad_request'],
    [413, 'bad_request'],
  ] as const)('%i -> %s', (status, kind) => {
    expect(kindFromStatus(status)).toBe(kind);
  });

  it('marks only transient kinds retryable', () => {
    const err = (kind: LLMError['kind']) => new LLMError({ kind, provider: 'x', message: '' });
    expect(err('rate_limit').retryable).toBe(true);
    expect(err('network').retryable).toBe(true);
    expect(err('bad_request').retryable).toBe(false);
    expect(err('auth').retryable).toBe(false);
    expect(err('aborted').retryable).toBe(false);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
  });

  it('prefers retry-after-ms', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '3', 'retry-after-ms': '250' }))).toBe(250);
  });

  it('reads an http date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfterMs({ 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }, now)).toBe(5000);
  });

  it('ignores garbage and missing headers', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
    expect(retryAfterMs(undefined)).toBeUndefined();
  });
});

const geminiBody = [
  {
    error: {
      code: 429,
      message: 'You exceeded your current quota ... Please retry in 54.67524425s.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '54s' },
      ],
    },
  },
];

describe('retryDelayFromBody', () => {
  it('reads RetryInfo from a real gemini 429 body', () => {
    expect(retryDelayFromBody(geminiBody)).toBe(54_000);
  });

  it('handles fractional durations and object bodies', () => {
    const body = {
      error: { details: [{ '@type': 'x/google.rpc.RetryInfo', retryDelay: '1.5s' }] },
    };
    expect(retryDelayFromBody(body)).toBe(1500);
  });

  it('falls back to the message', () => {
    expect(retryDelayFromBody(undefined, 'Please retry in 54.67524425s.')).toBe(54_676);
    expect(retryDelayFromBody({}, 'retry in 300ms')).toBe(300);
  });

  it('returns undefined when there is no hint', () => {
    expect(retryDelayFromBody({ error: { details: [] } }, 'slow down')).toBeUndefined();
    expect(retryDelayFromBody('not json')).toBeUndefined();
  });
});
