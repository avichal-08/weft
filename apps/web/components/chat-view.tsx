import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRunEvents, getSession } from '@/lib/api';
import { parseDiff } from '@/lib/diff';
import { repoName, tokens } from '@/lib/format';
import { ACTIVE, type Run, type RunEvent } from '@/lib/types';
import { Changes } from './changes';
import { AutoRefresh } from './auto-refresh';
import { ChatShell } from './chat-shell';
import { Composer } from './composer';
import { CopyButton } from './copy-button';
import { LiveWorkLog } from './live-work-log';
import { LogoMark } from './logo';
import { Prose } from './prose';
import { ShipControls } from './ship-controls';
import { WorkLog } from './work-log';

function Outcome({ run }: { run: Run }) {
  if (run.status === 'cancelled') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <CircleSlash className="size-4" /> Stopped
      </p>
    );
  }
  if (run.status === 'succeeded') return null;
  const why =
    run.failureKind === 'tests_failed'
      ? 'The tests still fail after this change'
      : run.failureKind?.startsWith('llm_')
        ? 'The model provider returned an error'
        : run.failureKind === 'apply_failed'
          ? 'The branch changed under this chat (was its PR merged?). Start a new chat'
          : run.failureKind === 'disk_limit'
            ? 'The sandbox ran out of disk space'
            : "This turn didn't finish";
  return (
    <details className="group rounded-xl border border-warn/25 bg-warn-soft text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-warn">
        <CircleAlert className="size-4 shrink-0" />
        <span className="flex-1">{why}</span>
        <span className="text-xs opacity-70 group-open:hidden">Details</span>
      </summary>
      {run.failureDetail && (
        <pre className="max-h-56 overflow-auto border-t border-warn/20 px-3.5 py-2.5 font-mono text-xs whitespace-pre-wrap text-muted">
          {run.failureDetail}
        </pre>
      )}
    </details>
  );
}

function Turn({ run, events, attempt }: { run: Run; events: RunEvent[]; attempt: number }) {
  const active = ACTIVE.includes(run.status);

  return (
    <li className="grid grid-cols-1 gap-6">
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-line bg-surface-2 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap">
        {run.task}
      </div>
      <div className="group/turn flex gap-3.5">
        <LogoMark className="mt-0.5 size-6 shrink-0" />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3">
          {active ? (
            <LiveWorkLog
              runId={run.id}
              attempt={attempt}
              events={events}
              startedAt={run.startedAt}
            />
          ) : (
            <WorkLog
              events={events}
              active={false}
              startedAt={run.startedAt}
              finishedAt={run.finishedAt}
              reply={run.summary}
            />
          )}
          {!active && run.summary && <Prose>{run.summary}</Prose>}
          {!active && <Outcome run={run} />}
          {!active && (
            <div className="-ml-1.5 flex items-center gap-1 text-xs text-faint opacity-0 transition group-hover/turn:opacity-100">
              {run.summary && <CopyButton text={run.summary} />}
              {run.testCommand && run.status === 'succeeded' && (
                <span className="flex items-center gap-1 px-1.5 text-ok">
                  <CircleCheck className="size-3.5" /> tests pass
                </span>
              )}
              <span className="px-1.5">
                {run.steps} steps · {tokens(run.inputTokens + run.outputTokens)} tokens
              </span>
              <Link
                href={`/runs/${run.id}`}
                className="rounded-md px-1.5 py-1 hover:bg-surface-3 hover:text-fg"
              >
                Inspect
              </Link>
            </div>
          )}
        </div>
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
    return <p className="p-8 text-sm text-bad">Could not load this chat ({res.status}).</p>;
  }
  const session = res.data.session;
  const traces = await Promise.all(session.turns.map((t) => getRunEvents(t.id)));
  const last = session.turns.at(-1);
  const activeRunId = last && ACTIVE.includes(last.status) ? last.id : null;
  const diff = latestDiff(session.turns);
  const lastCommit = session.commits.at(-1);
  const committed = lastCommit
    ? (session.turns.find((t) => t.turn === lastCommit.turn)?.diff ?? '')
    : '';
  const uncommitted = last?.status === 'succeeded' && !!last.diff && last.diff !== committed;
  const files = diff ? parseDiff(diff) : [];

  return (
    <ChatShell
      title={session.title}
      repo={repoName(session.repoUrl)}
      branch={session.baseRef}
      working={activeRunId !== null}
      stats={{
        files: files.length,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
      }}
      changes={<Changes diff={diff} commits={session.commits} repoUrl={session.repoUrl} />}
      publish={
        <ShipControls session={session} working={activeRunId !== null} uncommitted={uncommitted} />
      }
    >
      <AutoRefresh
        active={session.publishState === 'queued' || session.publishState === 'pushing'}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
        <ol className="grid flex-1 grid-cols-1 content-start gap-14 pt-10 pb-6">
          {session.turns.map((run, i) => {
            const trace = traces[i];
            return (
              <Turn
                key={run.id}
                run={run}
                events={trace?.ok ? trace.data.events : []}
                attempt={trace?.ok ? trace.data.attempt : run.attempt}
              />
            );
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
