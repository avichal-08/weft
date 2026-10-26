'use client';

import {
  ChevronRight,
  FilePlus2,
  FileText,
  FlaskConical,
  FolderSearch,
  Pencil,
  Search,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { describeStep, type StepLabel } from '@/lib/steps';
import { elapsed } from '@/lib/format';
import type { LivePhase, RunEvent, ToolEventData } from '@/lib/types';
import { MarkdownText } from './markdown';

const PHASES: Record<LivePhase['phase'], string> = {
  clone: 'Cloning the repository',
  sandbox: 'Starting the sandbox',
  restore: 'Restoring earlier changes',
  setup: 'Installing dependencies',
  agent: 'Thinking',
  verify: 'Running the tests',
};

function Ticker({ since }: { since: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const tick = () => setText(elapsed(since, null));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);
  return text ? <span className="text-faint tabular-nums">{text}</span> : null;
}

function activity(events: RunEvent[], phase: LivePhase | null): StepLabel {
  if (phase?.phase === 'setup' && phase.detail === 'cache') {
    return { verb: 'Restoring cached dependencies' };
  }
  if (phase?.phase === 'sandbox' && phase.detail === 'resume') {
    return { verb: 'Resuming the sandbox' };
  }
  if (phase && phase.phase !== 'agent') {
    return {
      verb: PHASES[phase.phase],
      ...(phase.phase === 'setup' && phase.detail ? { target: phase.detail } : {}),
    };
  }
  const last = events.findLast((e) => e.type === 'tool');
  if (last?.type === 'tool' && last.data.name !== 'finish') return describeStep(last.data);
  return { verb: events.length > 0 || phase ? 'Thinking' : 'Starting' };
}

const ICONS: Record<string, LucideIcon> = {
  grep: Search,
  glob: FolderSearch,
  view_file: FileText,
  str_replace_edit: Pencil,
  create_file: FilePlus2,
  run_command: Terminal,
  run_tests: FlaskConical,
};

function EditPreview({ args }: { args: Record<string, unknown> }) {
  const rows = (sign: string, value: unknown, cls: string) =>
    String(value ?? '')
      .split('\n')
      .map((l, i) => (
        <div key={`${sign}${i}`} className={`px-3 whitespace-pre ${cls}`}>
          <span className="mr-2 select-none opacity-60">{sign}</span>
          {l}
        </div>
      ));
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-code py-2 font-mono text-[12px] leading-5">
      {rows('−', args.old_str, 'bg-bad-soft')}
      {rows('+', args.new_str, 'bg-ok-soft')}
    </div>
  );
}

function Step({ data }: { data: ToolEventData }) {
  const { verb, target, extra } = describeStep(data);
  const Icon = ICONS[data.name] ?? Terminal;
  return (
    <details className="group/step">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2 py-1 text-[13px] text-muted transition hover:bg-surface-2 hover:text-fg">
        <Icon className={`size-3.5 shrink-0 ${data.isError ? 'text-bad' : 'text-faint'}`} />
        <span className="min-w-0 flex-1 truncate">
          <span className={data.isError ? 'text-bad' : ''}>{verb}</span>
          {target && <span className="ml-1.5 font-mono text-[12px] text-fg/80">{target}</span>}
          {extra && (
            <span className="ml-1 font-mono text-[11.5px]">
              {extra.split(' ').map((part, i) =>
                part.startsWith('+') ? (
                  <span key={i} className="ml-1 text-ok">
                    {part}
                  </span>
                ) : part.startsWith('−') ? (
                  <span key={i} className="ml-1 text-bad">
                    {part}
                  </span>
                ) : (
                  <span key={i}> {part}</span>
                ),
              )}
            </span>
          )}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-faint opacity-0 transition group-hover/step:opacity-100 group-open/step:rotate-90 group-open/step:opacity-100" />
      </summary>
      <div className="mt-1.5 mb-2 ml-6 grid grid-cols-1 gap-2">
        {data.name === 'str_replace_edit' && data.args && !data.isError && (
          <EditPreview args={data.args} />
        )}
        {data.output && (
          <pre
            className={`max-h-72 overflow-auto rounded-lg border p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap ${data.isError ? 'border-bad/20 bg-bad-soft text-bad' : 'border-line bg-code text-muted'}`}
          >
            {data.output}
          </pre>
        )}
      </div>
    </details>
  );
}

export function WorkLog({
  events,
  active,
  phase = null,
  startedAt,
  finishedAt,
  reply,
}: {
  events: RunEvent[];
  active: boolean;
  phase?: LivePhase | null;
  startedAt: string | null;
  finishedAt: string | null;
  reply: string | null;
}) {
  const items = events.filter(
    (e) =>
      (e.type === 'tool' && e.data.name !== 'finish') ||
      (e.type === 'llm' && e.data.text?.trim() && e.data.text.trim() !== reply?.trim()),
  );
  const tools = items.filter((e) => e.type === 'tool').length;
  const now = activity(events, phase);

  if (!active && items.length === 0) return null;

  return (
    <details open={active} className="group/log">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-muted shadow-card transition hover:border-line-strong hover:text-fg">
        {active ? (
          <span className="size-2 animate-pulse rounded-full bg-accent" />
        ) : (
          <ChevronRight className="size-3.5 transition group-open/log:rotate-90" />
        )}
        {active ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shimmer-text truncate font-medium">
              {now.verb}
              {now.target && <span className="ml-1.5 font-mono text-[12px]">{now.target}</span>}
            </span>
            {startedAt && <Ticker since={startedAt} />}
          </span>
        ) : (
          <span>
            Worked for {elapsed(startedAt, finishedAt)}
            <span className="text-faint">
              {' '}
              · {tools} step{tools === 1 ? '' : 's'}
            </span>
          </span>
        )}
      </summary>
      <div className="mt-3 ml-3 grid grid-cols-1 gap-0.5 border-l border-line pl-3">
        {items.map((e) =>
          e.type === 'tool' ? (
            <Step key={e.seq} data={e.data} />
          ) : (
            <div key={e.seq} className="px-2 py-1.5">
              <MarkdownText size="sm">{e.data.text!.trim()}</MarkdownText>
            </div>
          ),
        )}
      </div>
    </details>
  );
}
