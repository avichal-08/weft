import { parseDiff } from './diff.ts';

const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const DISABLES = /\b(skip|todo|only)\b/;
const words = (line: string): string[] => line.match(/\w+/g) ?? [];

function keeps(removed: string, added: string): boolean {
  if (COMMENT.test(added) && !COMMENT.test(removed)) return false;
  if (DISABLES.test(added) && !DISABLES.test(removed)) return false;
  const have = words(added);
  let i = 0;
  for (const w of words(removed)) {
    i = have.indexOf(w, i) + 1;
    if (i === 0) return false;
  }
  return true;
}

export function rewrittenLines(removed: readonly string[], added: readonly string[]): number {
  return removed.filter((r) => r.trim() && !added.some((a) => keeps(r, a))).length;
}

export function rewrittenTestLines(diff: string): number {
  return parseDiff(diff).reduce(
    (n, f) =>
      n +
      rewrittenLines(
        f.removedLines,
        f.addedLines.map((l) => l.text),
      ),
    0,
  );
}
