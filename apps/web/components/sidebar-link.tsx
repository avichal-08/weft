'use client';

import { CircleAlert, CircleX, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { RunStatus } from '@/lib/types';

function StatusIcon({ status }: { status: RunStatus | null }) {
  if (status === 'queued' || status === 'running') {
    return (
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent" aria-label="Working" />
    );
  }
  if (status === 'failed') {
    return <CircleAlert className="size-3.5 shrink-0 text-warn" aria-label="Last turn failed" />;
  }
  if (status === 'error') {
    return <CircleX className="size-3.5 shrink-0 text-bad" aria-label="Last turn errored" />;
  }
  return null;
}

export function SidebarLink({
  href,
  title,
  repo,
  when,
  status,
}: {
  href: string;
  title: string;
  repo: string;
  when: string;
  status: RunStatus | null;
}) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={`group relative grid min-w-0 gap-0.5 rounded-xl px-3 py-2 transition ${
        active ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      {active && (
        <span className="absolute top-2.5 bottom-2.5 left-0 w-0.5 rounded-full bg-accent" />
      )}
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${active ? 'font-medium text-fg' : 'text-fg/85 group-hover:text-fg'}`}
        >
          {title}
        </span>
        <StatusIcon status={status} />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
        <span className="min-w-0 truncate font-mono">{repo}</span>
        <span className="shrink-0">·</span>
        <span className="shrink-0">{when}</span>
      </span>
    </Link>
  );
}
