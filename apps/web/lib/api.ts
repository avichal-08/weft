import 'server-only';
import type { Run } from './types';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; body: ApiError };

export type ApiError = {
  error?: string;
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

export const listRuns = () => call<{ runs: Run[] }>('/runs?limit=50');
export const getRun = (id: string) => call<{ run: Run }>(`/runs/${id}`);
export const createRun = (body: unknown) =>
  call<{ run: Run }>('/runs', { method: 'POST', body: JSON.stringify(body) });
export const cancelRun = (id: string) =>
  call<{ run: Run }>(`/runs/${id}/cancel`, { method: 'POST' });
