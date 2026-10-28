import 'server-only';
import type {
  Commit,
  Run,
  RunEvent,
  RunMode,
  Session,
  SessionSummary,
  SessionWithTurns,
} from './types';

export const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; body: ApiError };

export type ApiError = {
  error?: string;
  message?: string;
  issues?: { path: string; message: string }[];
};

const UNREACHABLE: ApiError = {
  error: 'api_unreachable',
  message: "Can't reach the weft API. Is it running?",
};

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    return { ok: false, status: 503, body: UNREACHABLE };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok && body !== null) return { ok: true, data: body as T };
  return {
    ok: false,
    status: res.ok ? 502 : res.status,
    body: (body as ApiError | null) ?? { error: `http_${res.status}` },
  };
}

export const getRun = (id: string) => call<{ run: Run }>(`/runs/${id}`);
export const getRunEvents = (id: string) =>
  call<{ attempt: number; status: string; events: RunEvent[] }>(`/runs/${id}/events?limit=1000`);
export const cancelRun = (id: string) =>
  call<{ run: Run }>(`/runs/${id}/cancel`, { method: 'POST' });
export const listSessions = () => call<{ sessions: SessionSummary[] }>('/sessions?limit=50');
export const getSession = (id: string) => call<{ session: SessionWithTurns }>(`/sessions/${id}`);
export const createSession = (body: unknown) =>
  call<{ session: Session; run: Run }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const draftCommit = (id: string) =>
  call<{ message: string }>(`/sessions/${id}/commits/draft`, { method: 'POST' });
export const createCommit = (id: string, message: string) =>
  call<{ commit: Commit }>(`/sessions/${id}/commits`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
export const publishSession = (id: string) =>
  call<{ session: Session }>(`/sessions/${id}/publish`, { method: 'POST' });
export const sendMessage = (id: string, message: string, mode: RunMode) =>
  call<{ run: Run }>(`/sessions/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message, mode }),
  });
