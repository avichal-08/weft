'use client';

import { GitPullRequest, LoaderCircle } from 'lucide-react';
import { useActionState } from 'react';
import { publishAction } from '@/app/actions';
import type { FormState, Session } from '@/lib/types';

export function PublishButton({ session, working }: { session: Session; working: boolean }) {
  const [state, action, pending] = useActionState<FormState>(() => publishAction(session.id), {});
  const busy = pending || session.publishState === 'queued' || session.publishState === 'pushing';
  const problem = state.error ?? (session.publishState === 'failed' ? session.publishError : null);

  const control = session.prUrl ? (
    <a
      href={session.prUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 rounded-lg border border-ok/30 bg-ok-soft px-2.5 py-1.5 text-[13px] text-ok hover:border-ok/50"
    >
      {busy ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <GitPullRequest className="size-4" />
      )}
      <span>PR #{session.prNumber}</span>
      {busy && <span className="text-xs opacity-80">pushing…</span>}
    </a>
  ) : (
    <form action={action}>
      <button
        type="submit"
        disabled={busy || working}
        title={working ? 'Wait for weft to finish this turn' : undefined}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] transition enabled:hover:border-line-strong enabled:hover:bg-surface-2 disabled:opacity-60"
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin text-muted" />
        ) : (
          <GitPullRequest className="size-4 text-muted" />
        )}
        <span>{busy ? 'Opening PR…' : 'Create PR'}</span>
      </button>
    </form>
  );

  return (
    <div className="relative">
      {control}
      {problem && !busy && (
        <p className="absolute right-0 top-full z-10 mt-1.5 w-72 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn shadow-sm">
          {problem}
        </p>
      )}
    </div>
  );
}
