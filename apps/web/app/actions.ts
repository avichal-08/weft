'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelRun, createRun } from '@/lib/api';
import type { FormState } from '@/lib/types';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function createRunAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fields = {
    repoUrl: text(form, 'repoUrl'),
    task: text(form, 'task'),
    testCommand: text(form, 'testCommand'),
    provider: text(form, 'provider'),
    model: text(form, 'model'),
    maxSteps: text(form, 'maxSteps'),
  };

  const config = {
    ...(fields.provider ? { provider: fields.provider } : {}),
    ...(fields.model ? { model: fields.model } : {}),
    ...(fields.maxSteps ? { maxSteps: Number(fields.maxSteps) } : {}),
  };
  const res = await createRun({
    repoUrl: fields.repoUrl,
    task: fields.task,
    testCommand: fields.testCommand,
    config,
  });

  if (!res.ok) {
    const issues = res.body.issues?.map((i) => `${i.path || 'request'}: ${i.message}`).join(' · ');
    return { error: issues ?? res.body.error ?? `request failed (${res.status})`, fields };
  }
  redirect(`/runs/${res.data.run.id}`);
}

export async function cancelRunAction(id: string): Promise<void> {
  await cancelRun(id);
  refresh();
}
