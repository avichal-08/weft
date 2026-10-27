import 'server-only';
import type { Run, RunEvent, Session, SessionSummary, SessionWithTurns } from './types';

export const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; body: ApiError };

export type ApiError = {
  error?: string;
  message?: string;
  issues?: { path: string; message: string }[];
};

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json()) as unknown;
  return res.ok
    ? { ok: true, data: body as T }
    : { ok: false, status: res.status, body: body as ApiError };
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
export const publishSession = (id: string) =>
  call<{ session: Session }>(`/sessions/${id}/publish`, { method: 'POST' });
export const sendMessage = (id: string, message: string) =>
  call<{ run: Run }>(`/sessions/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
