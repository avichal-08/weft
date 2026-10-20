function lineClass(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-zinc-500';
  if (line.startsWith('+')) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (line.startsWith('-')) return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (line.startsWith('@@')) return 'text-blue-600 dark:text-blue-400';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-zinc-500 font-semibold';
  return 'text-zinc-700 dark:text-zinc-300';
}

export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="text-sm text-zinc-500">No changes.</p>;
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 py-3 text-[13px] leading-6 dark:border-zinc-800 dark:bg-zinc-950">
      {diff
        .replace(/\n$/, '')
        .split('\n')
        .map((line, i) => (
          <div key={i} className={`px-4 font-mono whitespace-pre ${lineClass(line)}`}>
            {line || ' '}
          </div>
        ))}
    </pre>
  );
}
