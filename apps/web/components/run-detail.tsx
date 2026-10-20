import { notFound } from 'next/navigation';
import { cancelRunAction } from '@/app/actions';
import { getRun } from '@/lib/api';
import { duration, repoName, time, tokens } from '@/lib/format';
import { ACTIVE } from '@/lib/types';
import { AutoRefresh } from './auto-refresh';
import { DiffView } from './diff-view';
import { StatusBadge } from './status-badge';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-lg">{value}</p>
    </div>
  );
}

export async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getRun(id);
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) notFound();
    return <p className="text-sm text-red-600">Could not load the run ({res.status}).</p>;
  }
  const { run } = res.data;
  const active = ACTIVE.includes(run.status);

  return (
    <div className="grid gap-8">
      <AutoRefresh active={active} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="font-mono text-xs text-zinc-500">{run.id.slice(0, 8)}</span>
          </div>
          <h1 className="text-lg font-semibold">{run.task}</h1>
          <p className="mt-1 font-mono text-sm text-zinc-500">
            {repoName(run.repoUrl)} · {run.testCommand}
            {run.config.model ? ` · ${run.config.model}` : ''}
          </p>
        </div>
        {active && (
          <form action={cancelRunAction.bind(null, run.id)}>
            <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
              Cancel
            </button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Steps" value={String(run.steps)} />
        <Stat label="Input tokens" value={tokens(run.inputTokens)} />
        <Stat label="Output tokens" value={tokens(run.outputTokens)} />
        <Stat label="Duration" value={duration(run.startedAt, run.finishedAt)} />
      </div>

      {run.summary && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Summary</h2>
          <p className="text-sm leading-6">{run.summary}</p>
        </section>
      )}

      {run.failureKind && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Failure:{' '}
            <span className="font-mono text-amber-700 dark:text-amber-300">{run.failureKind}</span>
          </h2>
          {run.failureDetail && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-zinc-950">
              {run.failureDetail}
            </pre>
          )}
        </section>
      )}

      {run.diff !== null && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Diff</h2>
          <DiffView diff={run.diff} />
        </section>
      )}

      {active && (
        <p className="text-sm text-zinc-500">
          {run.status === 'queued'
            ? 'Waiting for a worker…'
            : 'The agent is working. This page updates live.'}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        Created {time(run.createdAt)}
        {run.workerId ? ` · worker ${run.workerId} · attempt ${run.attempt}` : ''}
        {run.cacheReadTokens ? ` · ${tokens(run.cacheReadTokens)} cached tokens` : ''}
      </p>
    </div>
  );
}
