import { tokens } from '@/lib/format';
import type { LlmEventData, RunEvent, ToolEventData } from '@/lib/types';

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

function clip(text: string, max = 80) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function summarize({ name, args = {} }: ToolEventData): string {
  switch (name) {
    case 'grep':
      return `"${clip(str(args.pattern), 50)}"${args.glob ? ` in ${str(args.glob)}` : ''}${args.path && args.path !== '.' ? ` under ${str(args.path)}` : ''}`;
    case 'glob':
      return str(args.pattern);
    case 'view_file': {
      const offset = Number(args.offset ?? 1);
      return offset > 1 ? `${str(args.path)} from line ${offset}` : str(args.path);
    }
    case 'str_replace_edit':
    case 'create_file':
      return str(args.path);
    case 'run_command':
      return clip(str(args.command));
    case 'finish':
      return clip(str(args.summary));
    default:
      return '';
  }
}

function EditPreview({ args }: { args: Record<string, unknown> }) {
  const lines = (prefix: string, text: unknown) =>
    str(text)
      .split('\n')
      .map((l) => `${prefix} ${l}`);
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-50 py-2 text-xs leading-5 dark:bg-zinc-950">
      {lines('-', args.old_str).map((l, i) => (
        <div key={`o${i}`} className="px-3 font-mono whitespace-pre text-red-700 dark:text-red-300">
          {l}
        </div>
      ))}
      {lines('+', args.new_str).map((l, i) => (
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

function ToolCall({ data }: { data: ToolEventData }) {
  const summary = summarize(data);
  return (
    <details
      open={data.isError}
      className="group rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <span className={data.isError ? 'text-red-600' : 'text-emerald-600'}>
          {data.isError ? '✗' : '✓'}
        </span>
        <span className="font-mono font-medium">{data.name}</span>
        {summary && (
          <span className="min-w-0 truncate font-mono text-xs text-zinc-500">{summary}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-zinc-400">{data.durationMs}ms</span>
        <span className="text-xs text-zinc-400 transition group-open:rotate-90">▸</span>
      </summary>
      <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {data.name === 'str_replace_edit' && data.args && <EditPreview args={data.args} />}
        {data.output && (
          <pre
            className={`mt-2 max-h-72 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap ${data.isError ? 'bg-red-500/10 text-red-800 dark:text-red-200' : 'bg-zinc-50 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300'}`}
          >
            {data.output}
          </pre>
        )}
      </div>
    </details>
  );
}

function ModelCall({ step, data }: { step: number; data: LlmEventData }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-14 shrink-0 font-mono text-xs font-semibold text-zinc-500">
        step {step}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-zinc-500">
          model {data.latencyMs !== undefined ? `${(data.latencyMs / 1000).toFixed(1)}s` : ''}
          {data.usage
            ? ` · ${tokens(data.usage.inputTokens)} in · ${data.usage.outputTokens} out`
            : ''}
        </p>
        {data.text?.trim() && (
          <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{data.text.trim()}</p>
        )}
      </div>
    </div>
  );
}

export function RunTimeline({ events, active }: { events: RunEvent[]; active: boolean }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        {active ? 'Waiting for the first step…' : 'No trace recorded for this run.'}
      </p>
    );
  }

  const steps = new Map<number, RunEvent[]>();
  for (const e of events) steps.set(e.step, [...(steps.get(e.step) ?? []), e]);

  return (
    <ol className="grid gap-5">
      {[...steps.entries()].map(([step, group]) => (
        <li key={step} className="grid gap-2">
          {group.map((e) =>
            e.type === 'llm' ? (
              <ModelCall key={e.seq} step={step} data={e.data} />
            ) : (
              <div key={e.seq} className="ml-[4.25rem]">
                <ToolCall data={e.data} />
              </div>
            ),
          )}
        </li>
      ))}
      {active && <li className="ml-[4.25rem] animate-pulse text-sm text-zinc-500">working…</li>}
    </ol>
  );
}
