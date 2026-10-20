'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { RunStatus } from '@/lib/types';

const DOT: Record<RunStatus, string> = {
  queued: 'bg-faint',
  running: 'bg-accent animate-pulse',
  succeeded: 'bg-ok/70',
  failed: 'bg-warn/80',
  error: 'bg-bad/80',
  cancelled: 'bg-faint',
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
      className={`flex items-start gap-2.5 rounded-lg px-3 py-2 transition ${active ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
    >
      <span
        className={`mt-[7px] size-1.5 shrink-0 rounded-full ${status ? DOT[status] : 'bg-faint'}`}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </Link>
  );
}
