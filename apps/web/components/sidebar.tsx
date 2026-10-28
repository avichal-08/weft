import { LogOut, Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { logoutAction } from '@/app/login/actions';
import { listSessions } from '@/lib/api';
import { ago, repoName } from '@/lib/format';
import { Logo } from './logo';
import { SidebarLink } from './sidebar-link';

async function SessionList() {
  const res = await listSessions();
  if (!res.ok) return <p className="px-3 text-xs text-bad">Can&apos;t reach the API</p>;
  if (res.data.sessions.length === 0) {
    return <p className="px-3 text-xs text-faint">Your chats will appear here.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-px">
      {res.data.sessions.map((s) => (
        <li key={s.id}>
          <SidebarLink href={`/sessions/${s.id}`} status={s.lastStatus}>
            <span className="block truncate text-[13px] leading-5">{s.title}</span>
            <span className="flex gap-1.5 text-[11px] text-faint">
              <span className="truncate">{repoName(s.repoUrl).split('/').at(-1)}</span>
              <span>·</span>
              <span className="shrink-0">{ago(s.updatedAt)}</span>
            </span>
          </SidebarLink>
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-2 px-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-9 rounded-md" />
      ))}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="px-4 pt-4 pb-3">
        <Link href="/chat">
          <Logo gap="var(--surface)" />
        </Link>
      </div>
      <div className="px-3 pb-4">
        <Link
          href="/chat"
          className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] font-medium shadow-card transition hover:border-line-strong"
        >
          <Plus className="size-4 text-accent" />
          New chat
        </Link>
      </div>
      <p className="px-5 pb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
        Recent
      </p>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Suspense fallback={<ListSkeleton />}>
          <SessionList />
        </Suspense>
      </nav>
      <form action={logoutAction} className="border-t border-line px-3 py-3">
        <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-muted transition hover:bg-surface-2 hover:text-fg">
          <LogOut className="size-4" /> Sign out
        </button>
      </form>
    </aside>
  );
}
