import { describe, expect, it } from 'vitest';
import { kindFromStatus, LLMError, retryAfterMs } from '../src/errors.ts';

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
