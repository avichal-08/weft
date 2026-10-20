'use client';

import { useActionState } from 'react';
import { createRunAction } from '@/app/actions';
import type { FormState } from '@/lib/types';

const input =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const label = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400';

export function NewRunForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createRunAction, {});
  const f = state.fields ?? {};

  return (
    <form
      action={action}
      className="grid gap-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
    >
      <div>
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
        <label className={label} htmlFor="task">
          Task
        </label>
        <textarea
          className={`${input} min-h-20`}
          id="task"
          name="task"
          placeholder="The test suite is failing. Find the bug and fix it so all tests pass."
          defaultValue={f.task}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="testCommand">
            Test command
          </label>
          <input
            className={input}
            id="testCommand"
            name="testCommand"
            defaultValue={f.testCommand ?? 'npm test'}
            required
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
            <option value="mock">mock</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="maxSteps">
            Max steps
          </label>
          <input
            className={input}
            id="maxSteps"
            name="maxSteps"
            type="number"
            min={1}
            max={100}
            defaultValue={f.maxSteps ?? '30'}
          />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="model">
          Model (optional)
        </label>
        <input
          className={input}
          id="model"
          name="model"
          placeholder="gemini-2.5-flash"
          defaultValue={f.model}
        />
      </div>
      {state.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <div>
        <button
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={pending}
        >
          {pending ? 'Starting…' : 'Start run'}
        </button>
      </div>
    </form>
  );
}
