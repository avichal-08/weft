const LABELS: Record<string, string> = {
  clone: 'Clone repo',
  cacheKey: 'Hash manifests',
  resume: 'Check kept sandbox',
  sandbox: 'Start sandbox',
  copy: 'Copy repo in',
  apply: 'Apply previous turn',
  cacheRestore: 'Restore cached deps',
  install: 'Install deps',
  cacheSave: 'Save deps to cache',
  agent: 'Agent',
  verifySandbox: 'Prepare clean sandbox',
  verify: 'Run tests',
  diff: 'Collect diff',
};

const seconds = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function Timings({ timings }: { timings: { phase: string; ms: number }[] }) {
  const longest = Math.max(1, ...timings.map((t) => t.ms));
  const total = timings.reduce((n, t) => n + t.ms, 0);

  return (
    <div className="grid grid-cols-[6.5rem_1fr_3.5rem] sm:grid-cols-[10rem_1fr_4rem] items-center gap-x-3 gap-y-1.5 text-sm">
      {timings.map(({ phase, ms }) => (
        <div key={phase} className="contents">
          <span className="text-muted">{LABELS[phase] ?? phase}</span>
          <div className="h-2 rounded-full bg-surface-2">
            <div
              className="h-2 rounded-full bg-accent/70"
              style={{ width: `${(ms / longest) * 100}%` }}
            />
          </div>
          <span className="text-right font-mono text-xs">{seconds(ms)}</span>
        </div>
      ))}
      <span className="font-medium">Total</span>
      <span />
      <span className="text-right font-mono text-xs font-medium">{seconds(total)}</span>
    </div>
  );
}
