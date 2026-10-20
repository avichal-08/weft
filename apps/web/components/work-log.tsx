import { describeStep } from '@/lib/steps';
import type { RunEvent, ToolEventData } from '@/lib/types';
import { Prose } from './prose';

function EditDiff({ args }: { args: Record<string, unknown> }) {
  const lines = (prefix: string, value: unknown) =>
    String(value ?? '')
      .split('\n')
      .map((l) => `${prefix}${l}`);
  return (
    <pre className="overflow-x-auto rounded-md bg-zinc-50 py-2 text-xs leading-5 dark:bg-zinc-900">
      {lines('- ', args.old_str).map((l, i) => (
        <div key={`o${i}`} className="px-3 font-mono whitespace-pre text-red-700 dark:text-red-300">
          {l}
        </div>
      ))}
      {lines('+ ', args.new_str).map((l, i) => (
        <div
          key={`n${i}`}
          className="px-3 font-mono whitespace-pre text-emerald-700 dark:text-emerald-300"
        >
          {l}
        </div>
      ))}
    </pre>
  );
}

function Step({ data }: { data: ToolEventData }) {
  const { verb, target, extra } = describeStep(data);
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-0.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
        <span className={`w-3 shrink-0 text-xs ${data.isError ? 'text-red-500' : 'text-zinc-400'}`}>
          {data.isError ? '✗' : '•'}
        </span>
        <span className="min-w-0 truncate">
          {verb}
          {target && (
            <code className="ml-1.5 rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] dark:bg-zinc-800">
              {target}
            </code>
          )}
          {extra && <span className="text-zinc-400">{extra}</span>}
        </span>
      </summary>
      <div className="mt-1.5 mb-2 ml-5 grid grid-cols-1 gap-2">
        {data.name === 'str_replace_edit' && data.args && !data.isError && (
          <EditDiff args={data.args} />
        )}
        {data.output && (
          <pre
            className={`max-h-64 overflow-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap ${data.isError ? 'bg-red-500/10 text-red-800 dark:text-red-200' : 'bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'}`}
          >
            {data.output}
          </pre>
        )}
      </div>
    </details>
  );
}

function seconds(from: string | null, to: string | null) {
  if (!from) return '';
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function WorkLog({
  events,
  active,
  startedAt,
  finishedAt,
  reply,
  stats,
}: {
  events: RunEvent[];
  active: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  reply: string | null;
  stats: string;
}) {
  const items = events.filter(
    (e) =>
      (e.type === 'tool' && e.data.name !== 'finish') ||
      (e.type === 'llm' && e.data.text?.trim() && e.data.text.trim() !== reply?.trim()),
  );
  const last = items.at(-1);
  const current =
    active && last?.type === 'tool'
      ? `${describeStep(last.data).verb} ${describeStep(last.data).target ?? ''}`
      : '';

  if (!active && items.length === 0) return null;

  return (
    <details open={active} className="group/log">
      <summary
        title={stats}
        className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        {active ? (
          <span className="size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
        ) : (
          <span className="text-xs transition group-open/log:rotate-90">▸</span>
        )}
        <span>
          {active
            ? events.length === 0
              ? 'Starting…'
              : 'Working…'
            : `Worked for ${seconds(startedAt, finishedAt)}`}
        </span>
        {active && current && <span className="min-w-0 truncate text-zinc-400">{current}</span>}
      </summary>
      <div className="mt-3 ml-1.5 grid grid-cols-1 gap-1 border-l border-zinc-200 pl-4 dark:border-zinc-800">
        {items.map((e) =>
          e.type === 'tool' ? (
            <Step key={e.seq} data={e.data} />
          ) : (
            <div key={e.seq} className="py-1">
              <Prose muted>{e.data.text!.trim()}</Prose>
            </div>
          ),
        )}
      </div>
    </details>
  );
}
