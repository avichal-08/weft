'use client';

import { GitCommitHorizontal, GitPullRequest, LoaderCircle } from 'lucide-react';
import { useActionState, useState } from 'react';
import { publishAction } from '@/app/actions';
import type { Finding, FormState, Session } from '@/lib/types';
import { CommitDialog, type CommitMode } from './commit-dialog';

const button =
  'flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium transition enabled:hover:border-line-strong enabled:hover:bg-surface-2 disabled:opacity-50';

export function ShipControls({
  session,
  working,
  uncommitted,
  findings,
}: {
  session: Session;
  working: boolean;
  uncommitted: boolean;
  findings: Finding[];
}) {
  const blocked = findings.find((f) => f.severity === 'block')?.message;
  const warnings = findings.filter((f) => f.severity === 'warn');
  const [mode, setMode] = useState<CommitMode | null>(null);
  const [state, publish, pending] = useActionState<FormState>(() => publishAction(session.id), {});
  const busy = pending || session.publishState === 'queued' || session.publishState === 'pushing';
  const problem = state.error ?? (session.publishState === 'failed' ? session.publishError : null);
  const waiting = working ? 'Wait for weft to finish this turn' : blocked;

  return (
    <div className="relative flex shrink-0 items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={() => setMode('commit')}
        aria-label="Commit"
        disabled={!uncommitted || working || busy || !!blocked}
        title={waiting ?? (uncommitted ? undefined : 'Nothing new to commit')}
        className={button}
      >
        <GitCommitHorizontal className="size-4 text-muted" />
        <span className="hidden sm:inline">Commit</span>
      </button>

      {session.prUrl ? (
        <a
          href={session.prUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok-soft px-3 py-1.5 text-[13px] font-medium text-ok hover:border-ok/50"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <GitPullRequest className="size-4" />
          )}
          <span>PR #{session.prNumber}</span>
          {busy && <span className="text-xs opacity-80">pushing…</span>}
        </a>
      ) : uncommitted ? (
        <button
          type="button"
          onClick={() => setMode('commit-pr')}
          aria-label="Create PR"
          disabled={working || busy || !!blocked}
          title={waiting}
          className={button}
        >
          <GitPullRequest className="size-4 text-muted" />
          <span className="hidden sm:inline">Create PR</span>
        </button>
      ) : (
        <form action={publish}>
          <button
            type="submit"
            aria-label="Create PR"
            disabled={busy || working || !!blocked}
            title={waiting}
            className={button}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin text-muted" />
            ) : (
              <GitPullRequest className="size-4 text-muted" />
            )}
            <span className="hidden sm:inline">{busy ? 'Opening PR…' : 'Create PR'}</span>
          </button>
        </form>
      )}

      {problem && !busy && (
        <p className="absolute top-full right-0 z-10 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn shadow-sm">
          {problem}
        </p>
      )}

      {mode && (
        <CommitDialog
          sessionId={session.id}
          mode={mode}
          warnings={warnings}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}
