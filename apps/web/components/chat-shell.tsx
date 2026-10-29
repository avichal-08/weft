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
  publish,
  children,
}: {
  title: string;
  repo: string;
  branch: string | null;
  working: boolean;
  stats: { files: number; additions: number; deletions: number };
  changes: ReactNode;
  publish?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !content.current) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur-xl sm:gap-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span className="truncate font-mono">{repo}</span>
              {branch && (
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-[11px]">
                  <GitBranch className="size-3" />
                  {branch}
                </span>
              )}
            </div>
          </div>
          {working && (
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2 py-1 text-xs font-medium text-accent sm:px-2.5"
              title="Working"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              <span className="hidden sm:inline">Working</span>
            </span>
          )}
          {publish}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Changes"
            className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-[13px] font-medium transition sm:px-3 ${open ? 'border-line-strong bg-surface-2' : 'border-line hover:border-line-strong hover:bg-surface-2'}`}
          >
            <FileDiff className="size-4 text-muted" />
            <span className="hidden sm:inline">Changes</span>
            {stats.files > 0 && (
              <span className="font-mono text-xs">
                <span className="text-ok">+{stats.additions}</span>{' '}
                <span className="text-bad">−{stats.deletions}</span>
              </span>
            )}
          </button>
        </header>
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          }}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          <div ref={content} className="flex min-h-full flex-col">
            {children}
          </div>
        </div>
      </div>
      {open && (
        <aside className="fixed inset-0 z-40 flex flex-col bg-bg md:static md:inset-auto md:z-auto md:w-[min(36rem,50vw)] md:shrink-0 md:border-l md:border-line">
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
