import { posix } from 'node:path';
import picomatch from 'picomatch';

export const RG_BASE = ['rg', '--color=never', '--hidden', '--glob', '!.git', '--null'];

export function pathMatcher(pattern: string, base: string): (path: string) => boolean {
  const isMatch = picomatch(pattern, { dot: true, basename: !pattern.includes('/') });
  return (path) => {
    const rel = base ? posix.relative(base, path) : path;
    return isMatch(rel || posix.basename(path));
  };
}

export const nullSeparated = (stdout: string): string[] => stdout.split('\0').filter(Boolean);

export function formatLines(stdout: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line === '--') {
      if (out.length > 0 && out.at(-1) !== '--') out.push('--');
      continue;
    }
    const nul = line.indexOf('\0');
    if (nul < 0) continue;
    const path = line.slice(0, nul);
    if (!keep(path)) continue;
    const rest = line.slice(nul + 1);
    const sep = /^\d+-/.test(rest) ? '-' : ':';
    out.push(`${path}${sep}${rest}`);
  }
  while (out.at(-1) === '--') out.pop();
  return out;
}
