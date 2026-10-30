import type { ExecResult } from '@weft/sandbox';
import type { ToolArgs, ToolContext, ToolOutput } from '../types.ts';
import { clip, fail, ok } from './util.ts';

const MAX_OUTPUT_CHARS = 30_000;

function describe(res: ExecResult, timeoutMs: number): string {
  const parts: string[] = [];
  if (res.timedOut) parts.push(`[timed out after ${timeoutMs / 1000}s and was killed]`);
  parts.push(`exit code: ${res.exitCode}`);
  if (res.stdout.trim()) parts.push(`stdout:\n${res.stdout.trimEnd()}`);
  if (res.stderr.trim()) parts.push(`stderr:\n${res.stderr.trimEnd()}`);
  if (res.truncated) parts.push('[output was cut at 1 MB]');
  return clip(parts.join('\n'), MAX_OUTPUT_CHARS);
}

export async function runCommand(
  ctx: ToolContext,
  args: ToolArgs['run_command'],
): Promise<ToolOutput> {
  const timeoutMs = args.timeout_sec * 1000;
  const res = await ctx.sandbox.exec(args.command, { cwd: ctx.root, timeoutMs });
  const text = describe(res, timeoutMs);
  return res.exitCode === 0 ? ok(text) : fail(text);
}

export async function runTests(ctx: ToolContext): Promise<ToolOutput> {
  if (!ctx.testCommand) {
    return fail('No test command is configured for this repository. Use run_command instead.');
  }
  const res = await ctx.sandbox.exec(ctx.testCommand, {
    cwd: ctx.root,
    timeoutMs: ctx.testTimeoutMs,
  });
  const verdict = res.exitCode === 0 ? 'Tests passed.' : 'Tests failed.';
  const text = `${verdict}\n${describe(res, ctx.testTimeoutMs)}`;
  return res.exitCode === 0 ? ok(text) : fail(text);
}
