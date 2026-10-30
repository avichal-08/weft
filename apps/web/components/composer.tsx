'use client';

import { ArrowUp, Square } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { cancelRunAction, sendMessageAction } from '@/app/actions';
import { ModeToggle } from '@/components/mode-toggle';
import { useShowPendingTurn } from '@/components/pending-turn';
import type { FormState, RunMode } from '@/lib/types';

export function grow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
}

export function Composer({
  sessionId,
  activeRunId,
  model,
  defaultMode,
}: {
  sessionId: string;
  activeRunId: string | null;
  model: string | null;
  defaultMode: RunMode;
}) {
  const [mode, setMode] = useState(defaultMode);
  const showPending = useShowPendingTurn();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, data) => {
    const message = String(data.get('message') ?? '').trim();
    if (message) {
      showPending({ message, mode: data.get('mode') === 'ask' ? 'ask' : 'code' });
      if (input.current) {
        input.current.value = '';
        grow(input.current);
      }
    }
    return sendMessageAction(sessionId, prev, data);
  }, {});
  const busy = activeRunId !== null;

  useEffect(() => {
    if (state.sent) {
      form.current?.reset();
      grow(input.current);
    }
  }, [state.sent]);

  useEffect(() => {
    if (state.error && input.current && !input.current.value) {
      input.current.value = state.fields?.message ?? '';
      grow(input.current);
    }
  }, [state.error, state.fields]);

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-bg from-60% to-transparent pt-8 pb-5">
      <form
        ref={form}
        action={action}
        className="rounded-[22px] border border-line-strong bg-surface/90 shadow-card backdrop-blur-xl transition focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent-soft"
      >
        <textarea
          ref={input}
          className="block max-h-60 w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[15px] leading-6 outline-none placeholder:text-faint disabled:opacity-60"
          name="message"
          rows={1}
          placeholder={
            busy ? 'weft is working…' : mode === 'ask' ? 'Ask about the code…' : 'Reply to weft…'
          }
          defaultValue={state.error ? state.fields?.message : undefined}
          disabled={busy || pending}
          onInput={(e) => grow(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
          <ModeToggle mode={mode} onChange={setMode} disabled={busy || pending} />
          <span className="mr-auto min-w-0 truncate text-xs">
            {state.error ? (
              <span className="text-bad">{state.error}</span>
            ) : (
              <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted">
                {model ?? 'default model'}
              </span>
            )}
          </span>
          {busy ? (
            <button
              formAction={cancelRunAction.bind(null, activeRunId)}
              className="grid size-9 place-items-center rounded-full bg-fg text-bg transition hover:opacity-80"
              aria-label="Stop"
              title="Stop"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              className="grid size-9 place-items-center rounded-full bg-fg text-bg transition hover:opacity-85 disabled:opacity-40"
              disabled={pending}
              aria-label="Send"
              title="Send (Enter)"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </form>
      <p className="mt-2 text-center text-[11px] text-faint">
        {mode === 'ask'
          ? "Ask mode is read-only: weft answers from the code and won't change files."
          : 'weft works in an isolated sandbox.'}{' '}
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
