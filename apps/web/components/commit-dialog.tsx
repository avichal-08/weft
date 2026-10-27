'use client';

import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { draftCommitAction, saveCommitAction } from '@/app/actions';

export type CommitMode = 'commit' | 'commit-pr';

export function CommitDialog({
  sessionId,
  mode,
  onClose,
}: {
  sessionId: string;
  mode: CommitMode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState('');
  const [drafting, setDrafting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    void draftCommitAction(sessionId).then((res) => {
      if (!current) return;
      setDrafting(false);
      if (res.error) setError(res.error);
      else setMessage(res.message ?? '');
    });
    return () => {
      current = false;
    };
  }, [sessionId]);

  const save = () =>
    startSaving(async () => {
      const res = await saveCommitAction(sessionId, message, mode === 'commit-pr');
      if (res.error) setError(res.error);
      else onClose();
    });

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-line bg-bg p-0 text-fg shadow-xl backdrop:bg-black/50"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="grid gap-3 p-5"
      >
        <h2 className="text-sm font-medium">
          {mode === 'commit-pr' ? 'Commit & create pull request' : 'Commit changes'}
        </h2>
        {drafting ? (
          <p className="flex h-32 items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" /> Writing a commit message…
          </p>
        ) : (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            autoFocus
            spellCheck
            aria-label="Commit message"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] leading-5 outline-none focus:border-line-strong"
          />
        )}
        <p className="text-xs text-faint">
          The first line is the subject. Edit anything before committing.
        </p>
        {error && (
          <p className="rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={drafting || saving || !message.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {saving && <LoaderCircle className="size-3.5 animate-spin" />}
            {mode === 'commit-pr' ? 'Commit & create PR' : 'Commit'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
