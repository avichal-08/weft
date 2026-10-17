import type { LLMErrorKind } from './types.ts';

const RETRYABLE: ReadonlySet<LLMErrorKind> = new Set([
  'rate_limit',
  'overloaded',
  'server',
  'timeout',
  'network',
]);

export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(opts: {
    kind: LLMErrorKind;
    provider: string;
    message: string;
    status?: number | undefined;
    retryAfterMs?: number | undefined;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'LLMError';
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function kindFromStatus(status: number): LLMErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status === 408) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

type HeaderBag = Headers | Record<string, string | null | undefined> | undefined;

function header(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  return (headers as Record<string, string | undefined>)[name] ?? undefined;
}

export function retryAfterMs(headers: HeaderBag, now = Date.now()): number | undefined {
  const ms = header(headers, 'retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const ra = header(headers, 'retry-after');
  if (!ra) return undefined;
  if (Number.isFinite(Number(ra))) return Math.max(0, Number(ra) * 1000);
  const at = Date.parse(ra);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
