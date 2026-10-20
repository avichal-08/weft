'use client';

import { useActionState } from 'react';
import { createSessionAction } from '@/app/actions';
import type { FormState } from '@/lib/types';

const input =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const label = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400';

export function NewChatForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSessionAction, {});
  const f = state.fields ?? {};

  return (
    <form action={action} className="grid grid-cols-1 gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="repoUrl">
            Repository
          </label>
          <input
            className={input}
            id="repoUrl"
            name="repoUrl"
            placeholder="https://github.com/you/repo"
            defaultValue={f.repoUrl}
            required
          />
        </div>
        <div>
          <label className={label} htmlFor="baseRef">
            Branch (optional)
          </label>
          <input
            className={input}
            id="baseRef"
            name="baseRef"
            placeholder="main"
            defaultValue={f.baseRef}
          />
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-zinc-500">Options</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="testCommand">
              Test command
            </label>
            <input
              className={input}
              id="testCommand"
              name="testCommand"
              placeholder="npm test"
              defaultValue={f.testCommand}
            />
          </div>
          <div>
            <label className={label} htmlFor="provider">
              Provider
            </label>
            <select className={input} id="provider" name="provider" defaultValue={f.provider ?? ''}>
              <option value="">worker default</option>
              <option value="gemini">gemini</option>
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="openrouter">openrouter</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="model">
              Model
            </label>
            <input
              className={input}
              id="model"
              name="model"
              placeholder="gemini-2.5-flash"
              defaultValue={f.model}
            />
          </div>
        </div>
      </details>
      <div className="rounded-xl border border-zinc-300 bg-white focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          className="block min-h-28 w-full resize-y rounded-xl bg-transparent px-4 py-3 text-sm outline-none"
          name="message"
          placeholder="Ask about the code, or describe a change…"
          defaultValue={f.message}
          required
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
          <button
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            disabled={pending}
          >
            {pending ? 'Starting…' : 'Start chat'}
          </button>
        </div>
      </div>
    </form>
  );
}
