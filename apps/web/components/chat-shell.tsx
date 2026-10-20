'use client';

import { useState, type ReactNode } from 'react';

export function ChatShell({
  title,
  subtitle,
  working,
  changedFiles,
  changes,
  children,
}: {
  title: string;
  subtitle: string;
  working: boolean;
  changedFiles: number;
  changes: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            <p className="truncate text-xs text-zinc-500">{subtitle}</p>
          </div>
          {working && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
              <span className="size-1.5 animate-pulse rounded-full bg-current" />
              Working
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`rounded-md border px-3 py-1.5 text-sm ${open ? 'border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800' : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'}`}
          >
            Changes
            {changedFiles > 0 && <span className="ml-1.5 text-zinc-500">{changedFiles}</span>}
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
      {open && (
        <aside className="flex w-full max-w-xl shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium">Changes</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              aria-label="Close changes"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{changes}</div>
        </aside>
      )}
    </div>
  );
}
