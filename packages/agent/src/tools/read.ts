import type { ToolArgs, ToolContext, ToolOutput } from '../types.ts';
import { fail, headLines, ok, outsideRoot, relativeArg, resolveInRoot } from './util.ts';

const SEARCH_TIMEOUT_MS = 30_000;
const GLOB_LIMIT = 200;
const MAX_LINE_CHARS = 2000;

export async function grep(ctx: ToolContext, args: ToolArgs['grep']): Promise<ToolOutput> {
  const target = resolveInRoot(ctx.root, args.path);
  if (!target) return outsideRoot(args.path);

  const argv = ['rg', '--color=never', '--sort=path', '--max-columns=300', '--max-columns-preview'];
  if (args.ignore_case) argv.push('--ignore-case');
  if (args.glob) argv.push('--glob', args.glob);
  if (args.mode === 'files') argv.push('--files-with-matches');
  if (args.mode === 'count') argv.push('--count', '--with-filename');
  if (args.mode === 'content') {
    argv.push('--line-number', '--with-filename', '--no-heading');
    if (args.context > 0) argv.push('--context', String(args.context));
  }
  argv.push('--regexp', args.pattern, '--', ...relativeArg(ctx.root, target));

  const res = await ctx.sandbox.exec(argv, { cwd: ctx.root, timeoutMs: SEARCH_TIMEOUT_MS });
  if (res.exitCode === 1) return ok('No matches.');
  if (res.exitCode !== 0) return fail(res.stderr.trim() || `grep failed (exit ${res.exitCode})`);
  return ok(
    headLines(res.stdout, args.head_limit, 'narrow with path, glob or a more specific pattern'),
  );
}

export async function glob(ctx: ToolContext, args: ToolArgs['glob']): Promise<ToolOutput> {
  const target = resolveInRoot(ctx.root, args.path);
  if (!target) return outsideRoot(args.path);

  const res = await ctx.sandbox.exec(
    [
      'rg',
      '--files',
      '--sortr=modified',
      '--glob',
      args.pattern,
      '--',
      ...relativeArg(ctx.root, target),
    ],
    { cwd: ctx.root, timeoutMs: SEARCH_TIMEOUT_MS },
  );
  if (res.exitCode === 1 && !res.stderr.trim()) return ok('No files found.');
  if (res.exitCode !== 0) return fail(res.stderr.trim() || `glob failed (exit ${res.exitCode})`);
  return ok(headLines(res.stdout, GLOB_LIMIT, 'use a more specific pattern or path'));
}

const VIEW_SCRIPT = `
[ -e "$3" ] || exit 3
[ -d "$3" ] && exit 4
[ -s "$3" ] && ! grep -Iq . "$3" && exit 5
awk -v s="$1" -v e="$2" -v max="$4" '
  NR >= s && NR <= e {
    line = $0
    if (length(line) > max) line = substr(line, 1, max) " [line truncated]"
    printf "%6d\\t%s\\n", NR, line
  }
  END { print NR > "/dev/stderr" }
' "$3"
`;

export async function viewFile(ctx: ToolContext, args: ToolArgs['view_file']): Promise<ToolOutput> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (!abs) return outsideRoot(args.path);

  const end = args.offset + args.limit - 1;
  const res = await ctx.sandbox.exec(
    ['sh', '-c', VIEW_SCRIPT, 'sh', String(args.offset), String(end), abs, String(MAX_LINE_CHARS)],
    { timeoutMs: SEARCH_TIMEOUT_MS },
  );

  if (res.exitCode === 3) return fail(`File not found: ${args.path}`);
  if (res.exitCode === 4) return fail(`${args.path} is a directory. Use glob to list files.`);
  if (res.exitCode === 5) return fail(`${args.path} is a binary file.`);
  if (res.exitCode !== 0) return fail(res.stderr.trim() || `view failed (exit ${res.exitCode})`);

  const total = Number(res.stderr.trim().split('\n').pop());
  if (total === 0) return ok('(empty file)');
  if (args.offset > total) {
    return fail(`offset ${args.offset} is past the end of ${args.path} (${total} lines).`);
  }

  const body = res.stdout.replace(/\n$/, '');
  if (end >= total) return ok(body);
  return ok(
    `${body}\n[lines ${args.offset}-${end} of ${total}; use offset=${end + 1} to read more]`,
  );
}
