import Link from 'next/link';
import { Suspense } from 'react';
import { listSessions } from '@/lib/api';
import { repoName } from '@/lib/format';
import { SidebarLink } from './sidebar-link';

async function SessionList() {
  const res = await listSessions();
  if (!res.ok) return <p className="px-3 text-xs text-red-500">API unreachable</p>;
  if (res.data.sessions.length === 0) {
    return <p className="px-3 text-xs text-zinc-500">No chats yet.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {res.data.sessions.map((s) => (
        <li key={s.id}>
          <SidebarLink href={`/sessions/${s.id}`} status={s.lastStatus}>
            <span className="block truncate text-sm">{s.title}</span>
            <span className="block truncate font-mono text-[11px] text-zinc-500">
              {repoName(s.repoUrl)}
            </span>
          </SidebarLink>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/" className="font-mono text-lg font-semibold tracking-tight">
          weft
        </Link>
      </div>
      <div className="px-3 pb-3">
        <Link
          href="/"
          className="block rounded-md border border-zinc-300 px-3 py-2 text-center text-sm hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          + New chat
        </Link>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Suspense fallback={<p className="px-3 text-xs text-zinc-500">Loading chats…</p>}>
          <SessionList />
        </Suspense>
      </nav>
    </aside>
  );
}
