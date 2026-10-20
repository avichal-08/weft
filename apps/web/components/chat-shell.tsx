'use client';

import { FileDiff, GitBranch, PanelRightClose } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ChatShell({
  title,
  repo,
  branch,
  working,
  stats,
  changes,
  revision,
  children,
}: {
  title: string;
  repo: string;
  branch: string | null;
  working: boolean;
  stats: { files: number; additions: number; deletions: number };
  changes: ReactNode;
  revision: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el || seen.current === revision) return;
    const first = seen.current === null;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    seen.current = revision;
    if (first || nearBottom)
      el.scrollTo({ top: el.scrollHeight, behavior: first ? 'instant' : 'smooth' });
  }, [revision]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-5 py-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span className="truncate font-mono">{repo}</span>
              {branch && (
                <span className="flex shrink-0 items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
                  <GitBranch className="size-3" />
                  {branch}
                </span>
              )}
            </div>
          </div>
          {working && (
            <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              Working
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition ${open ? 'border-line-strong bg-surface-2' : 'border-line hover:border-line-strong hover:bg-surface-2'}`}
          >
            <FileDiff className="size-4 text-muted" />
            <span>Changes</span>
            {stats.files > 0 && (
              <span className="font-mono text-xs">
                <span className="text-ok">+{stats.additions}</span>{' '}
                <span className="text-bad">−{stats.deletions}</span>
              </span>
            )}
          </button>
        </header>
        <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
      {open && (
        <aside className="flex w-[min(36rem,50vw)] shrink-0 flex-col border-l border-line bg-bg">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 className="text-sm font-medium">Changes</h2>
              <p className="text-xs text-muted">
                {stats.files === 0
                  ? 'Nothing changed yet'
                  : `${stats.files} file${stats.files === 1 ? '' : 's'} changed in this chat`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
              aria-label="Close changes"
            >
              <PanelRightClose className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{changes}</div>
        </aside>
      )}
    </div>
  );
}
