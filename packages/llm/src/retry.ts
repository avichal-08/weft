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
  if (error.retryAfterMs !== undefined) return error.retryAfterMs;
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
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 120_000;
  const sleep = options.sleep ?? abortableSleep;

  return {
    provider: inner.provider,
    model: inner.model,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      let streamed = false;
      const onText = req.onText;
      const attemptReq: CompletionRequest = onText
        ? {
            ...req,
            onText: (event) => {
              if (event.type === 'text') streamed = true;
              onText(event);
            },
          }
        : req;
      for (let attempt = 1; ; attempt++) {
        try {
          return await inner.complete(attemptReq);
        } catch (err) {
          if (!(err instanceof LLMError) || !err.retryable || attempt >= maxAttempts) throw err;
          if (err.retryAfterMs !== undefined && err.retryAfterMs > maxRetryAfterMs) throw err;
          const delayMs = backoffDelay(attempt, err, delays);
          options.onRetry?.({ attempt, delayMs, error: err });
          if (streamed && onText) {
            streamed = false;
            onText({ type: 'reset' });
          }
          await sleep(delayMs, req.signal);
        }
      }
    },
  };
}
