import type { RunStatus } from '@/lib/types';

const STYLES: Record<RunStatus, string> = {
  queued: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  succeeded: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300',
  cancelled: 'bg-zinc-500/15 text-zinc-500',
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  );
}
