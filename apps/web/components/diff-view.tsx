type Line = { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string; old?: number; new?: number };

function number(hunks: string): Line[] {
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const text of hunks.replace(/\n$/, '').split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(text);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      out.push({ kind: 'hunk', text: m[3]?.trim() ?? '' });
    } else if (text.startsWith('+')) {
      out.push({ kind: 'add', text: text.slice(1), new: newNo++ });
    } else if (text.startsWith('-')) {
      out.push({ kind: 'del', text: text.slice(1), old: oldNo++ });
    } else if (!text.startsWith('\\')) {
      out.push({ kind: 'ctx', text: text.slice(1), old: oldNo++, new: newNo++ });
    }
  }
  return out;
}

const ROW: Record<Line['kind'], string> = {
  add: 'bg-ok-soft',
  del: 'bg-bad-soft',
  ctx: '',
  hunk: 'bg-surface-2 text-faint',
};

export function DiffView({ diff }: { diff: string }) {
  const lines = number(diff);
  if (lines.length === 0) return <p className="px-4 py-3 text-sm text-muted">No changes.</p>;

  return (
    <div className="overflow-x-auto bg-code font-mono text-[12.5px] leading-[1.7]">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) =>
            l.kind === 'hunk' ? (
              <tr key={i} className={ROW.hunk}>
                <td colSpan={3} className="px-3 py-1 text-[11.5px]">
                  {l.text || '⋯'}
                </td>
              </tr>
            ) : (
              <tr key={i} className={ROW[l.kind]}>
                <td className="w-10 px-2 text-right text-faint select-none">{l.old ?? ''}</td>
                <td className="w-10 px-2 text-right text-faint select-none">{l.new ?? ''}</td>
                <td className="pr-4 whitespace-pre">
                  <span
                    className={`mr-2 inline-block w-3 select-none ${l.kind === 'add' ? 'text-ok' : l.kind === 'del' ? 'text-bad' : 'text-faint'}`}
                  >
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                  </span>
                  {l.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
