import { parseDiff } from '@/lib/diff';
import { DiffView } from './diff-view';

export function Changes({ diff }: { diff: string | null }) {
  const files = diff ? parseDiff(diff) : [];
  if (files.length === 0) return <p className="text-sm text-zinc-500">No changes yet.</p>;

  const added = files.reduce((n, f) => n + f.additions, 0);
  const removed = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-xs text-zinc-500">
        {files.length} file{files.length === 1 ? '' : 's'} changed ·{' '}
        <span className="text-emerald-600">+{added}</span>{' '}
        <span className="text-red-600">−{removed}</span>
      </p>
      {files.map((f) => (
        <details
          key={f.path}
          open
          className="group overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
            <span className="text-xs text-zinc-400 transition group-open:rotate-90">▸</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.path}</span>
            <span className="text-xs text-emerald-600">+{f.additions}</span>
            <span className="text-xs text-red-600">−{f.deletions}</span>
          </summary>
          <DiffView diff={f.hunks} bare />
        </details>
      ))}
    </div>
  );
}
