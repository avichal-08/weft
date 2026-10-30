import { notFound } from 'next/navigation';
import { cancelRunAction } from '@/app/actions';
import { getRun, runEventsFor } from '@/lib/api';
import { duration, repoName, time, tokens } from '@/lib/format';
import { ACTIVE } from '@/lib/types';
import { AutoRefresh } from './auto-refresh';
import { DiffView } from './diff-view';
import { RunTimeline } from './run-timeline';
import { StatusBadge } from './status-badge';
import { Timings } from './timings';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}

export async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getRun(id);
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) notFound();
    return <p className="text-sm text-bad">Could not load the run ({res.status}).</p>;
  }
  const { run } = res.data;
  const trace = await runEventsFor(run);
  const active = ACTIVE.includes(run.status);

  return (
    <div className="grid grid-cols-1 gap-8">
      <AutoRefresh active={active} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="font-mono text-xs text-muted">{run.id.slice(0, 8)}</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
            {run.task}
          </h1>
          <p className="mt-1 font-mono text-xs break-all text-muted sm:text-sm">
            {repoName(run.repoUrl)} · {run.testCommand}
            {run.config.model ? ` · ${run.config.model}` : ''}
          </p>
        </div>
        {active && (
          <form action={cancelRunAction.bind(null, run.id)}>
            <button className="rounded-full border border-line-strong px-3 py-1.5 text-sm font-medium transition hover:bg-surface-2">
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

      <section>
        <h2 className="mb-3 text-sm font-semibold">Activity</h2>
        <RunTimeline events={trace.ok ? trace.data.events : []} active={active} />
      </section>

      {run.timings && run.timings.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Where the time went</h2>
          <Timings timings={run.timings} />
        </section>
      )}

      {run.summary && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Summary</h2>
          <p className="text-sm leading-6">{run.summary}</p>
        </section>
      )}

      {run.failureKind && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Failure: <span className="font-mono text-warn">{run.failureKind}</span>
          </h2>
          {run.failureDetail && (
            <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-code p-3 font-mono text-xs whitespace-pre-wrap">
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
        <p className="text-sm text-muted">
          {run.status === 'queued'
            ? 'Waiting for a worker…'
            : 'The agent is working. This page updates live.'}
        </p>
      )}

      <p className="text-xs text-muted">
        Created {time(run.createdAt)}
        {run.workerId ? ` · worker ${run.workerId} · attempt ${run.attempt}` : ''}
        {run.cacheReadTokens ? ` · ${tokens(run.cacheReadTokens)} cached tokens` : ''}
      </p>
    </div>
  );
}
