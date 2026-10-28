'use client';

import { ArrowUp, FolderGit2, GitBranch, Settings2 } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { createSessionAction } from '@/app/actions';
import type { FormState, RunMode } from '@/lib/types';
import { grow } from './composer';
import { ModeToggle } from './mode-toggle';

const SUGGESTIONS = [
  'Explain how this codebase is structured',
  'Find and fix the failing test',
  'Review the code for bugs and edge cases',
  'Add tests for the least tested module',
];

const field =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-faint focus:border-accent/50 focus:ring-4 focus:ring-accent-soft';

const modeFrom = (mode: string | undefined): RunMode => (mode === 'ask' ? 'ask' : 'code');

export function NewChatForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSessionAction, {});
  const [options, setOptions] = useState(false);
  const [mode, setMode] = useState<RunMode>(modeFrom(state.fields?.mode));
  const message = useRef<HTMLTextAreaElement>(null);
  const f = state.fields ?? {};

  return (
    <form action={action} className="grid grid-cols-1 gap-4">
      <div className="rounded-2xl border border-line-strong bg-surface shadow-card transition focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent-soft">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <FolderGit2 className="size-4 shrink-0 text-muted" />
            <input
              name="repoUrl"
              placeholder="https://github.com/you/repo"
              defaultValue={f.repoUrl}
              required
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-faint"
            />
          </label>
          <label className="flex w-40 items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <GitBranch className="size-4 shrink-0 text-muted" />
            <input
              name="baseRef"
              placeholder="main"
              defaultValue={f.baseRef}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-faint"
            />
          </label>
        </div>
        <textarea
          ref={message}
          name="message"
          rows={3}
          placeholder={
            mode === 'ask' ? 'Ask about the code…' : 'Ask about the code, or describe a change…'
          }
          defaultValue={f.message}
          required
          onInput={(e) => grow(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-6 outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-3">
          <div className="flex items-center gap-2">
            <ModeToggle mode={mode} onChange={setMode} disabled={pending} />
            <button
              type="button"
              onClick={() => setOptions((o) => !o)}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition ${options ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}
            >
              <Settings2 className="size-3.5" /> Options
            </button>
          </div>
          <div className="flex items-center gap-3">
            {state.error && <span className="text-xs text-bad">{state.error}</span>}
            <button
              disabled={pending}
              className="grid size-8 place-items-center rounded-full bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
              aria-label="Start chat"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <div
          className={`${options ? 'grid' : 'hidden'} gap-3 border-t border-line px-3 py-3 sm:grid-cols-3`}
        >
          <input
            name="testCommand"
            placeholder="Test command, e.g. npm test"
            defaultValue={f.testCommand}
            className={field}
          />
          <select name="provider" defaultValue={f.provider ?? ''} className={field}>
            <option value="">Default provider</option>
            <option value="gemini">Gemini</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
          <input
            name="model"
            placeholder="Model, e.g. gemini-2.5-flash"
            defaultValue={f.model}
            className={field}
          />
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              if (!message.current) return;
              message.current.value = s;
              message.current.focus();
              grow(message.current);
            }}
            className="rounded-full border border-line px-3 py-1.5 text-[13px] text-muted transition hover:border-line-strong hover:bg-surface hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
    </form>
  );
}
