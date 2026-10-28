'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  cancelRun,
  createCommit,
  createSession,
  draftCommit,
  publishSession,
  sendMessage,
  type ApiError,
} from '@/lib/api';
import type { FormState, RunMode } from '@/lib/types';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const modeOf = (form: FormData): RunMode => (form.get('mode') === 'ask' ? 'ask' : 'code');

const describe = (status: number, body: ApiError) =>
  body.issues?.map((i) => `${i.path || 'request'}: ${i.message}`).join(' · ') ??
  body.message ??
  body.error ??
  `request failed (${status})`;

export async function createSessionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fields = {
    repoUrl: text(form, 'repoUrl'),
    baseRef: text(form, 'baseRef'),
    testCommand: text(form, 'testCommand'),
    provider: text(form, 'provider'),
    model: text(form, 'model'),
    message: text(form, 'message'),
    mode: modeOf(form),
  };
  const res = await createSession({
    repoUrl: fields.repoUrl,
    message: fields.message,
    mode: fields.mode,
    ...(fields.baseRef ? { baseRef: fields.baseRef } : {}),
    ...(fields.testCommand ? { testCommand: fields.testCommand } : {}),
    config: {
      ...(fields.provider ? { provider: fields.provider } : {}),
      ...(fields.model ? { model: fields.model } : {}),
    },
  });
  if (!res.ok) return { error: describe(res.status, res.body), fields };
  redirect(`/sessions/${res.data.session.id}`);
}

export async function sendMessageAction(
  sessionId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const message = text(form, 'message');
  if (!message) return {};
  const res = await sendMessage(sessionId, message, modeOf(form));
  if (!res.ok) {
    const error =
      res.status === 409
        ? 'weft is still working on your last message.'
        : describe(res.status, res.body);
    return { error, fields: { message } };
  }
  refresh();
  return { sent: Date.now() };
}

export async function cancelRunAction(id: string): Promise<void> {
  await cancelRun(id);
  refresh();
}

export async function publishAction(sessionId: string): Promise<FormState> {
  const res = await publishSession(sessionId);
  if (!res.ok) return { error: describe(res.status, res.body) };
  refresh();
  return { sent: Date.now() };
}

export async function draftCommitAction(
  sessionId: string,
): Promise<{ message?: string; error?: string }> {
  const res = await draftCommit(sessionId);
  return res.ok ? { message: res.data.message } : { error: describe(res.status, res.body) };
}

export async function saveCommitAction(
  sessionId: string,
  message: string,
  openPullRequest: boolean,
): Promise<{ error?: string }> {
  const saved = await createCommit(sessionId, message);
  if (!saved.ok) return { error: describe(saved.status, saved.body) };
  if (openPullRequest) {
    const published = await publishSession(sessionId);
    if (!published.ok) {
      refresh();
      return {
        error: `Committed, but the pull request wasn't started: ${describe(published.status, published.body)}`,
      };
    }
  }
  refresh();
  return {};
}
