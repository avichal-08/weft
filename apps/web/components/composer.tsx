'use client';

import { useActionState, useEffect, useRef } from 'react';
import { cancelRunAction, sendMessageAction } from '@/app/actions';
import type { FormState } from '@/lib/types';

export function Composer({
  sessionId,
  activeRunId,
  model,
}: {
  sessionId: string;
  activeRunId: string | null;
  model: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    sendMessageAction.bind(null, sessionId),
    {},
  );
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.sent) form.current?.reset();
  }, [state.sent]);

  const busy = activeRunId !== null;

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)] pt-6 pb-5">
      <form
        ref={form}
        action={action}
        className="rounded-xl border border-zinc-300 bg-white focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <textarea
          className="block max-h-60 min-h-12 w-full resize-none rounded-xl bg-transparent px-4 py-3 text-[15px] outline-none disabled:opacity-60"
          name="message"
          rows={2}
          placeholder={
            busy
              ? 'weft is working…'
              : 'Reply to weft…  (Enter to send, Shift+Enter for a new line)'
          }
          defaultValue={state.error ? state.fields?.message : undefined}
          disabled={busy || pending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <p className="min-w-0 truncate text-xs">
            {state.error ? (
              <span className="text-red-600 dark:text-red-400">{state.error}</span>
            ) : (
              <span className="text-zinc-400">{model ?? 'default model'}</span>
            )}
          </p>
          {busy ? (
            <button
              formAction={cancelRunAction.bind(null, activeRunId)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              disabled={pending}
            >
              {pending ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
