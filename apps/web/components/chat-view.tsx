import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRunEvents, getSession } from '@/lib/api';
import { duration, repoName, tokens } from '@/lib/format';
import { ACTIVE, type Run, type RunEvent } from '@/lib/types';
import { AutoRefresh } from './auto-refresh';
import { Composer } from './composer';
import { DiffView } from './diff-view';
import { RunTimeline } from './run-timeline';

function Reply({ run }: { run: Run }) {
  if (run.status === 'cancelled') {
    return <p className="text-sm text-zinc-500 italic">Stopped.</p>;
  }
  return (
    <div className="grid gap-2">
      {run.summary && <p className="text-sm leading-7 whitespace-pre-wrap">{run.summary}</p>}
      {run.status !== 'succeeded' && (
        <details className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <summary className="cursor-pointer">
            {run.failureKind === 'tests_failed'
              ? 'The tests still fail after this change.'
              : `This turn didn't complete (${run.failureKind ?? run.status}).`}
          </summary>
          {run.failureDetail && (
            <pre className="mt-2 max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {run.failureDetail}
            </pre>
          )}
        </details>
      )}
      {run.status === 'succeeded' && run.testCommand && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          ✓ tests pass ({run.testCommand})
        </p>
      )}
    </div>
  );
}

function Turn({ run, events }: { run: Run; events: RunEvent[] }) {
  const active = ACTIVE.includes(run.status);
  const work = `${run.steps} steps · ${duration(run.startedAt, run.finishedAt)} · ${tokens(run.inputTokens)} tokens`;

  return (
    <li className="grid grid-cols-1 gap-4">
      <div className="ml-auto max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap dark:bg-zinc-800">
        {run.task}
      </div>
      <div className="grid grid-cols-1 gap-3">
        <p className="font-mono text-xs font-semibold text-zinc-500">weft</p>
        {active ? (
          <RunTimeline events={events} active />
        ) : (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-zinc-500">
              <span className="transition group-open:rotate-90">▸</span>
              worked · {work}
              <Link href={`/runs/${run.id}`} className="ml-2 underline-offset-2 hover:underline">
                details
              </Link>
            </summary>
            <div className="mt-3">
              <RunTimeline events={events} active={false} />
            </div>
          </details>
        )}
        {!active && <Reply run={run} />}
      </div>
    </li>
  );
}

function latestDiff(turns: Run[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]!.diff !== null) return turns[i]!.diff;
  }
  return null;
}

function Changes({ diff }: { diff: string | null }) {
  const files = diff ? [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) : [];
  return (
    <section className="grid grid-cols-1 gap-3">
      <h2 className="text-sm font-semibold">
        Changes{' '}
        {files.length > 0 && (
          <span className="font-normal text-zinc-500">
            · {files.length} file{files.length === 1 ? '' : 's'}
          </span>
        )}
      </h2>
      {files.length === 0 ? (
        <p className="text-sm text-zinc-500">No changes yet.</p>
      ) : (
        <DiffView diff={diff!} />
      )}
    </section>
  );
}

export async function ChatView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getSession(id);
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) notFound();
    return <p className="p-8 text-sm text-red-600">Could not load this chat ({res.status}).</p>;
  }
  const session = res.data.session;
  const traces = await Promise.all(session.turns.map((t) => getRunEvents(t.id)));
  const last = session.turns.at(-1);
  const activeRunId = last && ACTIVE.includes(last.status) ? last.id : null;

  return (
    <div className="flex min-h-0 flex-1">
      <AutoRefresh active={activeRunId !== null} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6">
          <header className="border-b border-zinc-200 py-4 dark:border-zinc-800">
            <h1 className="truncate text-base font-semibold">{session.title}</h1>
            <p className="truncate font-mono text-xs text-zinc-500">
              {repoName(session.repoUrl)}
              {session.baseRef ? ` @ ${session.baseRef}` : ''}
              {session.config.model ? ` · ${session.config.model}` : ''}
            </p>
          </header>
          <ol className="grid flex-1 grid-cols-1 content-start gap-10 py-8">
            {session.turns.map((run, i) => {
              const trace = traces[i];
              return <Turn key={run.id} run={run} events={trace?.ok ? trace.data.events : []} />;
            })}
          </ol>
          <div className="xl:hidden">
            <Changes diff={latestDiff(session.turns)} />
          </div>
          <Composer sessionId={session.id} activeRunId={activeRunId} />
        </div>
      </div>
      <aside className="hidden w-[30rem] shrink-0 overflow-y-auto border-l border-zinc-200 p-5 xl:block dark:border-zinc-800">
        <Changes diff={latestDiff(session.turns)} />
      </aside>
    </div>
  );
}
