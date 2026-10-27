import type { ToolContext } from './types.ts';

const TOP_EXTENSIONS = 6;
const TOP_ENTRIES = 12;

export function summarizeFiles(files: string[], packageJson: string | null): string {
  const extensions = new Map<string, number>();
  const top = new Map<string, number>();
  for (const file of files) {
    const name = file.split('/').at(-1)!;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '(none)';
    extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
    const [first, ...rest] = file.split('/');
    const key = rest.length ? `${first}/` : first!;
    top.set(key, (top.get(key) ?? 0) + 1);
  }

  const byCount = [...extensions].sort((a, b) => b[1] - a[1]).slice(0, TOP_EXTENSIONS);
  const entries = [...top]
    .sort((a, b) => Number(b[0].endsWith('/')) - Number(a[0].endsWith('/')) || b[1] - a[1])
    .slice(0, TOP_ENTRIES)
    .map(([name, count]) => (name.endsWith('/') ? `${name} (${count} files)` : name));

  const lines = [
    `- ${files.length} files. By extension: ${byCount.map(([ext, n]) => `${ext} ${n}`).join(', ')}`,
    `- Top level: ${entries.join(', ')}${top.size > TOP_ENTRIES ? ', …' : ''}`,
  ];
  try {
    const scripts = (
      JSON.parse(packageJson ?? 'null') as { scripts?: Record<string, string> } | null
    )?.scripts;
    const shown = Object.entries(scripts ?? {}).filter(([name]) =>
      /^(test|build|lint|typecheck)/.test(name),
    );
    if (shown.length)
      lines.push(`- package.json scripts: ${shown.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  } catch {
    // not json
  }
  return lines.join('\n');
}

export async function repoOverview(ctx: ToolContext): Promise<string | null> {
  const listed = await ctx.sandbox.exec(['git', 'ls-files'], { cwd: ctx.root, timeoutMs: 10_000 });
  const files = listed.stdout.split('\n').filter(Boolean);
  if (listed.exitCode !== 0 || files.length === 0) return null;
  const pkg = files.includes('package.json')
    ? await ctx.sandbox.readFile(`${ctx.root}/package.json`).catch(() => null)
    : null;
  return summarizeFiles(files, pkg);
}
