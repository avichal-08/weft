import { LLMError } from './errors.ts';
import type { CompletionRequest, CompletionResponse, LLMProvider, RetryOptions } from './types.ts';

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason as Error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function backoffDelay(
  attempt: number,
  error: LLMError,
  opts: Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'random'>>,
): number {
  if (error.retryAfterMs !== undefined) return Math.min(error.retryAfterMs, opts.maxDelayMs);
  const ceiling = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(opts.random() * ceiling);
}

export function withRetry(inner: LLMProvider, options: RetryOptions = {}): LLMProvider {
  const maxAttempts = options.maxAttempts ?? 4;
  const delays = {
    baseDelayMs: options.baseDelayMs ?? 1000,
    maxDelayMs: options.maxDelayMs ?? 30_000,
    random: options.random ?? Math.random,
  };
  const sleep = options.sleep ?? abortableSleep;

  return {
    provider: inner.provider,
    model: inner.model,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      for (let attempt = 1; ; attempt++) {
        try {
          return await inner.complete(req);
        } catch (err) {
          if (!(err instanceof LLMError) || !err.retryable || attempt >= maxAttempts) throw err;
          const delayMs = backoffDelay(attempt, err, delays);
          options.onRetry?.({ attempt, delayMs, error: err });
          await sleep(delayMs, req.signal);
        }
      }
    },
  };
}
