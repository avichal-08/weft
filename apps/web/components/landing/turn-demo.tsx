import { Check, FileSearch, FilePen, FlaskConical, GitPullRequest, Search } from 'lucide-react';

const STEPS = [
  { Icon: Search, text: 'Searched for', code: 'get(', note: '1 file' },
  { Icon: FileSearch, text: 'Read', code: 'src/lru.js', note: '36 lines' },
  { Icon: FilePen, text: 'Edited', code: 'src/lru.js', note: '+4 −1', tone: 'text-ok' },
  {
    Icon: FlaskConical,
    text: 'Tests passed in a clean sandbox',
    code: '',
    note: 'all green',
    tone: 'text-ok',
  },
];

export function TurnDemo() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-px rounded-[18px] bg-gradient-to-b from-accent/40 via-line-strong to-transparent" />
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface/90 shadow-card backdrop-blur">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="ml-2 truncate font-mono text-[11px] text-faint">
            avichal-08/weft-playground · gemini-3.1-flash-lite
          </span>
        </div>
        <div className="grid gap-4 p-5 text-left">
          <p className="landing-rise ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-line bg-surface-2 px-3.5 py-2 text-sm">
            The LRU cache evicts the wrong key after a read. Fix it.
          </p>
          <ul className="grid gap-1.5 font-mono text-[12.5px]">
            {STEPS.map(({ Icon, text, code, note, tone }, i) => (
              <li
                key={text + code}
                className="landing-rise flex items-center gap-2.5 text-muted"
                style={{ animationDelay: `${0.5 + i * 0.45}s` }}
              >
                <Icon className={`size-3.5 shrink-0 ${tone ?? 'text-faint'}`} />
                <span>
                  {text} {code && <span className="text-fg">{code}</span>}
                </span>
                <span className={`ml-auto shrink-0 text-[11px] ${tone ?? 'text-faint'}`}>
                  {note}
                </span>
              </li>
            ))}
          </ul>
          <p
            className="landing-rise text-sm leading-6"
            style={{ animationDelay: `${0.5 + STEPS.length * 0.45}s` }}
          >
            <code className="rounded bg-code px-1 py-0.5 font-mono text-[12.5px]">get()</code> read
            the entry but never moved it to the front, so a key you had just used could be evicted.
            It now re-inserts on read, and a test covers it.
          </p>
          <div
            className="landing-rise flex items-center justify-between gap-3 rounded-xl border border-ok/25 bg-ok-soft px-3.5 py-2.5 text-[13px]"
            style={{ animationDelay: `${0.8 + STEPS.length * 0.45}s` }}
          >
            <span className="flex items-center gap-2 text-ok">
              <GitPullRequest className="size-4" /> Pull request opened
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Check className="size-3.5 text-ok" /> checks clean
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
