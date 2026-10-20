'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { RunStatus } from '@/lib/types';

const DOT: Record<RunStatus, string> = {
  queued: 'bg-zinc-400',
  running: 'bg-blue-500 animate-pulse',
  succeeded: 'bg-emerald-500',
  failed: 'bg-amber-500',
  error: 'bg-red-500',
  cancelled: 'bg-zinc-400',
};

export function SidebarLink({
  href,
  status,
  children,
}: {
  href: string;
  status: RunStatus | null;
  children: ReactNode;
}) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      className={`flex items-start gap-2.5 rounded-md px-3 py-2 ${active ? 'bg-zinc-200 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
    >
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full ${status ? DOT[status] : 'bg-zinc-300'}`}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </Link>
  );
}
