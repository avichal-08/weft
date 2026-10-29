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
    <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-code py-2 text-xs leading-5">
      {lines('-', args.old_str).map((l, i) => (
        <div key={`o${i}`} className="px-3 font-mono whitespace-pre text-bad">
          {l}
        </div>
      ))}
      {lines('+', args.new_str).map((l, i) => (
        <div key={`n${i}`} className="px-3 font-mono whitespace-pre text-ok">
          {l}
        </div>
      ))}
    </pre>
  );
}

function ToolCall({ data }: { data: ToolEventData }) {
  const summary = summarize(data);
  return (
    <details open={data.isError} className="group rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <span className={data.isError ? 'text-bad' : 'text-ok'}>{data.isError ? '✗' : '✓'}</span>
        <span className="font-mono font-medium">{data.name}</span>
        {summary && (
          <span className="min-w-0 truncate font-mono text-xs text-muted">{summary}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-faint">{data.durationMs}ms</span>
        <span className="text-xs text-faint transition group-open:rotate-90">▸</span>
      </summary>
      <div className="border-t border-line px-3 py-2">
        {data.name === 'str_replace_edit' && data.args && <EditPreview args={data.args} />}
        {data.output && (
          <pre
            className={`mt-2 max-h-72 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap ${data.isError ? 'bg-bad-soft text-bad' : 'bg-code text-fg'}`}
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
      <span className="w-10 shrink-0 font-mono text-xs font-semibold text-muted sm:w-14">
        step {step}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">
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
      <p className="text-sm text-muted">
        {active ? 'Waiting for the first step…' : 'No trace recorded for this run.'}
      </p>
    );
  }

  const steps = new Map<number, RunEvent[]>();
  for (const e of events) steps.set(e.step, [...(steps.get(e.step) ?? []), e]);

  return (
    <ol className="grid grid-cols-1 gap-5">
      {[...steps.entries()].map(([step, group]) => (
        <li key={step} className="grid grid-cols-1 gap-2">
          {group.map((e) =>
            e.type === 'llm' ? (
              <ModelCall key={e.seq} step={step} data={e.data} />
            ) : (
              <div key={e.seq} className="ml-0 sm:ml-[4.25rem]">
                <ToolCall data={e.data} />
              </div>
            ),
          )}
        </li>
      ))}
      {active && (
        <li className="ml-0 animate-pulse sm:ml-[4.25rem] text-sm text-muted">working…</li>
      )}
    </ol>
  );
}
