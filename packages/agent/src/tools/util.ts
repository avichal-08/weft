import { posix } from 'node:path';
import type { ToolOutput } from '../types.ts';

export const ok = (content: string): ToolOutput => ({ content, isError: false });
export const fail = (content: string): ToolOutput => ({ content, isError: true });

export function resolveInRoot(root: string, path: string): string | undefined {
  const abs = posix.resolve(root, path);
  return abs === root || abs.startsWith(`${root}/`) ? abs : undefined;
}

export function relativeArg(root: string, abs: string): string[] {
  const rel = posix.relative(root, abs);
  return rel ? [rel] : [];
}

export const outsideRoot = (path: string) =>
  fail(`Path "${path}" is outside the repository. Use a path relative to the repository root.`);

export function headLines(text: string, limit: number, hint: string): string {
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines.length <= limit) return lines.join('\n');
  return `${lines.slice(0, limit).join('\n')}\n[showing ${limit} of ${lines.length} lines; ${hint}]`;
}
