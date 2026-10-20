import { ChevronRight, FileCode2 } from 'lucide-react';
import { parseDiff } from '@/lib/diff';
import { DiffView } from './diff-view';

export function Changes({ diff }: { diff: string | null }) {
  const files = diff ? parseDiff(diff) : [];
  if (files.length === 0) {
    return (
      <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
        <FileCode2 className="size-5 text-faint" />
        <p className="text-sm text-muted">No changes yet</p>
        <p className="text-xs text-faint">Files weft edits in this chat will show up here.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {files.map((f) => (
        <details
          key={f.path}
          open
          className="group overflow-hidden rounded-xl border border-line bg-surface"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-surface-2">
            <ChevronRight className="size-3.5 shrink-0 text-faint transition group-open:rotate-90" />
            <FileCode2 className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{f.path}</span>
            <span className="font-mono text-xs text-ok">+{f.additions}</span>
            <span className="font-mono text-xs text-bad">−{f.deletions}</span>
          </summary>
          <div className="border-t border-line">
            <DiffView diff={f.hunks} />
          </div>
        </details>
      ))}
    </div>
  );
}
