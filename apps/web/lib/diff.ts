export type FileDiff = {
  path: string;
  additions: number;
  deletions: number;
  hunks: string;
};

export function parseDiff(diff: string): FileDiff[] {
  return diff
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith('diff --git '))
    .map((chunk) => {
      const lines = chunk.replace(/\n$/, '').split('\n');
      const path = /^diff --git a\/(\S+) b\/(\S+)/.exec(lines[0] ?? '')?.[2] ?? 'unknown';
      const start = lines.findIndex((l) => l.startsWith('@@'));
      const body = start >= 0 ? lines.slice(start) : [];
      return {
        path,
        additions: body.filter((l) => l.startsWith('+')).length,
        deletions: body.filter((l) => l.startsWith('-')).length,
        hunks: start >= 0 ? body.join('\n') : lines.slice(1).join('\n'),
      };
    });
}
