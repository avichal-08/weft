'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelRun, createSession, sendMessage, type ApiError } from '@/lib/api';
import type { FormState } from '@/lib/types';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

const describe = (status: number, body: ApiError) =>
  body.issues?.map((i) => `${i.path || 'request'}: ${i.message}`).join(' · ') ??
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
  };
  const res = await createSession({
    repoUrl: fields.repoUrl,
    message: fields.message,
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
  const res = await sendMessage(sessionId, message);
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
