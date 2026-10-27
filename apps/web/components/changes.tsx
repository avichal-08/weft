import { ChevronRight, FileCode2, GitCommitHorizontal } from 'lucide-react';
import { parseDiff } from '@/lib/diff';
import type { Commit } from '@/lib/types';
import { DiffView } from './diff-view';

function Commits({ commits, repoUrl }: { commits: Commit[]; repoUrl: string }) {
  if (commits.length === 0) return null;
  const repo = repoUrl.replace(/\.git$/, '');
  return (
    <section className="grid gap-1.5">
      <h3 className="text-xs font-medium text-muted">Commits</h3>
      <ol className="grid gap-1 rounded-xl border border-line bg-surface p-1.5">
        {commits.map((c) => (
          <li key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm">
            <GitCommitHorizontal className="size-4 shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate">{c.message.split('\n')[0]}</span>
            {c.sha ? (
              <a
                href={
                  repo.startsWith('https://github.com/') ? `${repo}/commit/${c.sha}` : undefined
                }
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-muted hover:text-fg"
              >
                {c.sha.slice(0, 7)}
              </a>
            ) : (
              <span className="text-xs text-faint">not pushed</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Changes({
  diff,
  commits = [],
  repoUrl = '',
}: {
  diff: string | null;
  commits?: Commit[];
  repoUrl?: string;
}) {
  const files = diff ? parseDiff(diff) : [];
  if (files.length === 0 && commits.length === 0) {
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
      <Commits commits={commits} repoUrl={repoUrl} />
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
