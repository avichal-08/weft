import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRunEvents, getSession } from '@/lib/api';
import { parseDiff } from '@/lib/diff';
import { repoName, tokens } from '@/lib/format';
import { ACTIVE, type Run, type RunEvent } from '@/lib/types';
import { AutoRefresh } from './auto-refresh';
import { Changes } from './changes';
import { ChatShell } from './chat-shell';
import { Composer } from './composer';
import { Prose } from './prose';
import { WorkLog } from './work-log';

function Outcome({ run }: { run: Run }) {
  if (run.status === 'cancelled') return <p className="text-sm text-zinc-500 italic">Stopped.</p>;
  if (run.status === 'succeeded') return null;
  const why =
    run.failureKind === 'tests_failed'
      ? 'The tests still fail after this change.'
      : run.failureKind?.startsWith('llm_')
        ? 'The model provider returned an error, so this turn stopped.'
        : run.failureKind === 'apply_failed'
          ? "The earlier changes don't apply to the branch any more."
          : "This turn didn't finish.";
  return (
    <details className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
      <summary className="cursor-pointer">{why}</summary>
      {run.failureDetail && (
        <pre className="mt-2 max-h-56 overflow-auto font-mono text-xs whitespace-pre-wrap opacity-80">
          {run.failureDetail}
        </pre>
      )}
    </details>
  );
}

function Turn({ run, events }: { run: Run; events: RunEvent[] }) {
  const active = ACTIVE.includes(run.status);
  const stats = `${run.steps} steps · ${tokens(run.inputTokens)} in · ${tokens(run.outputTokens)} out`;

  return (
    <li className="grid grid-cols-1 gap-5">
      <div className="ml-auto max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap dark:bg-zinc-800/80">
        {run.task}
      </div>
      <div className="group/turn grid grid-cols-1 gap-3">
        <WorkLog
          events={events}
          active={active}
          startedAt={run.startedAt}
          finishedAt={run.finishedAt}
          reply={run.summary}
          stats={stats}
        />
        {!active && run.summary && <Prose>{run.summary}</Prose>}
        {!active && <Outcome run={run} />}
        {!active && (
          <div className="flex gap-3 text-xs text-zinc-400 opacity-0 transition group-hover/turn:opacity-100">
            {run.testCommand && run.status === 'succeeded' && <span>✓ tests pass</span>}
            <span>{stats}</span>
            <Link
              href={`/runs/${run.id}`}
              className="hover:text-zinc-600 hover:underline dark:hover:text-zinc-200"
            >
              details
            </Link>
          </div>
        )}
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
  const diff = latestDiff(session.turns);

  const subtitle = [
    repoName(session.repoUrl),
    session.baseRef ? `branch ${session.baseRef}` : null,
    session.config.model ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ChatShell
      title={session.title}
      subtitle={subtitle}
      working={activeRunId !== null}
      changedFiles={diff ? parseDiff(diff).length : 0}
      changes={<Changes diff={diff} />}
    >
      <AutoRefresh active={activeRunId !== null} />
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6">
        <ol className="grid flex-1 grid-cols-1 content-start gap-12 py-10">
          {session.turns.map((run, i) => {
            const trace = traces[i];
            return <Turn key={run.id} run={run} events={trace?.ok ? trace.data.events : []} />;
          })}
        </ol>
        <Composer
          sessionId={session.id}
          activeRunId={activeRunId}
          model={session.config.model ?? null}
        />
      </div>
    </ChatShell>
  );
}
