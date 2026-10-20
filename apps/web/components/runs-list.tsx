import Link from 'next/link';
import { listRuns } from '@/lib/api';
import { duration, repoName, time, tokens } from '@/lib/format';
import { ACTIVE } from '@/lib/types';
import { AutoRefresh } from './auto-refresh';
import { StatusBadge } from './status-badge';

export async function RunsList() {
  const res = await listRuns();
  if (!res.ok) {
    return (
      <p className="text-sm text-red-600">Could not reach the API ({res.status}). Is it running?</p>
    );
  }
  const { runs } = res.data;
  if (runs.length === 0) return <p className="text-sm text-zinc-500">No runs yet.</p>;

  return (
    <>
      <AutoRefresh active={runs.some((r) => ACTIVE.includes(r.status))} />
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/runs/${run.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <StatusBadge status={run.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{run.task}</p>
                <p className="truncate font-mono text-xs text-zinc-500">{repoName(run.repoUrl)}</p>
              </div>
              <div className="hidden text-right text-xs text-zinc-500 sm:block">
                <p>
                  {run.steps} steps · {tokens(run.inputTokens)} tokens
                </p>
                <p>
                  {run.finishedAt ? duration(run.startedAt, run.finishedAt) : time(run.createdAt)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
