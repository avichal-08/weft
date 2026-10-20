import type { ToolArgs, ToolContext, ToolOutput } from '../types.ts';
import { applyEdit, snippet } from './edit.ts';
import { fail, ok, outsideRoot, resolveInRoot, sha256 } from './util.ts';

const MAX_EDIT_BYTES = 2 * 1024 * 1024;
const IO_TIMEOUT_MS = 30_000;

const READ_WITH_HASH = 'sha256sum -- "$1" | cut -c1-64 && cat -- "$1"';
const WRITE = 'cat > "$1"';
const CREATE = '[ -e "$1" ] && exit 3; mkdir -p -- "$(dirname -- "$1")" && set -C && cat > "$1"';

export async function strReplaceEdit(
  ctx: ToolContext,
  args: ToolArgs['str_replace_edit'],
): Promise<ToolOutput> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (!abs) return outsideRoot(args.path);

  const viewedHash = ctx.viewed.get(abs);
  if (!viewedHash) return fail(`View ${args.path} with view_file before editing it.`);

  const read = await ctx.sandbox.exec(['sh', '-c', READ_WITH_HASH, 'sh', abs], {
    maxOutputBytes: MAX_EDIT_BYTES,
    timeoutMs: IO_TIMEOUT_MS,
  });
  if (read.exitCode !== 0) return fail(read.stderr.trim() || `could not read ${args.path}`);
  if (read.truncated) return fail(`${args.path} is too large to edit with str_replace_edit.`);

  const hash = read.stdout.slice(0, 64);
  if (hash !== viewedHash) {
    return fail(`${args.path} changed since you last viewed it. View it again before editing.`);
  }

  const edit = applyEdit(read.stdout.slice(65), args.old_str, args.new_str, args.replace_all);
  if (!edit.ok) return fail(edit.error);

  const write = await ctx.sandbox.exec(['sh', '-c', WRITE, 'sh', abs], {
    stdin: Buffer.from(edit.content, 'utf8'),
    timeoutMs: IO_TIMEOUT_MS,
  });
  if (write.exitCode !== 0) return fail(write.stderr.trim() || `could not write ${args.path}`);

  ctx.viewed.set(abs, sha256(Buffer.from(edit.content, 'utf8')));
  const what = edit.replacements === 1 ? 'Edited' : `Replaced ${edit.replacements} occurrences in`;
  return ok(
    `${what} ${args.path}. Around line ${edit.line} now:\n${snippet(edit.content, edit.line)}`,
  );
}

export async function createFile(
  ctx: ToolContext,
  args: ToolArgs['create_file'],
): Promise<ToolOutput> {
  const abs = resolveInRoot(ctx.root, args.path);
  if (!abs) return outsideRoot(args.path);

  const data = Buffer.from(args.content, 'utf8');
  const res = await ctx.sandbox.exec(['sh', '-c', CREATE, 'sh', abs], {
    stdin: data,
    timeoutMs: IO_TIMEOUT_MS,
  });
  if (res.exitCode === 3) {
    return fail(`${args.path} already exists. Use str_replace_edit to change it.`);
  }
  if (res.exitCode !== 0) return fail(res.stderr.trim() || `could not create ${args.path}`);

  ctx.viewed.set(abs, sha256(data));
  const lines = args.content === '' ? 0 : args.content.replace(/\n$/, '').split('\n').length;
  return ok(`Created ${args.path} (${lines} lines).`);
}
