import type { RunStatus } from '@/lib/types';

const STYLES: Record<RunStatus, string> = {
  queued: 'bg-surface-2 text-muted',
  running: 'bg-accent-soft text-accent',
  succeeded: 'bg-ok-soft text-ok',
  failed: 'bg-warn-soft text-warn',
  error: 'bg-bad-soft text-bad',
  cancelled: 'bg-surface-2 text-muted',
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
