import { LogOut, UserRound } from 'lucide-react';
import { Suspense } from 'react';
import { logoutAction } from '@/app/login/actions';
import { listSessions } from '@/lib/api';
import { ago, dayGroup, repoName, type DayGroup } from '@/lib/format';
import type { SessionSummary } from '@/lib/types';
import { SidebarFrame } from './sidebar-frame';
import { SidebarLink } from './sidebar-link';

const GROUPS: DayGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

async function SessionList() {
  const res = await listSessions();
  if (!res.ok) {
    return (
      <p className="mx-1 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2 text-xs text-bad">
        Can&apos;t reach the API
      </p>
    );
  }
  if (res.data.sessions.length === 0) {
    return <p className="px-3 text-xs leading-5 text-faint">Your chats will appear here.</p>;
  }
  const now = new Date();
  const grouped = new Map<DayGroup, SessionSummary[]>();
  for (const s of res.data.sessions) {
    const g = dayGroup(s.updatedAt, now);
    grouped.set(g, [...(grouped.get(g) ?? []), s]);
  }
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      {GROUPS.filter((g) => grouped.has(g)).map((g) => (
        <section key={g} className="grid min-w-0 grid-cols-1 gap-0.5">
          <h2 className="px-3 pb-1 text-[11px] font-medium text-faint">{g}</h2>
          {grouped.get(g)!.map((s) => (
            <SidebarLink
              key={s.id}
              href={`/sessions/${s.id}`}
              title={s.title}
              repo={repoName(s.repoUrl).split('/').at(-1) ?? ''}
              when={ago(s.updatedAt)}
              status={s.lastStatus}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-2 px-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-11 rounded-xl" />
      ))}
    </div>
  );
}

function Account() {
  return (
    <form action={logoutAction} className="border-t border-line p-3">
      <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <UserRound className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-4 font-medium">Owner</span>
          <span className="block text-[11px] text-faint">Signed in</span>
        </span>
        <button
          title="Sign out"
          aria-label="Sign out"
          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </form>
  );
}

export function Sidebar() {
  return (
    <SidebarFrame
      list={
        <Suspense fallback={<ListSkeleton />}>
          <SessionList />
        </Suspense>
      }
      account={<Account />}
    />
  );
}
