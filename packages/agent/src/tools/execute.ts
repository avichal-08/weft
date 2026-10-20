import type { ParsedToolCall, ToolContext, ToolContextOptions, ToolOutput } from '../types.ts';
import { glob, grep, viewFile } from './read.ts';
import { finish, runCommand, runTests } from './run.ts';
import { createFile, strReplaceEdit } from './write.ts';

export const DEFAULT_TEST_TIMEOUT_MS = 300_000;

export function createToolContext(opts: ToolContextOptions): ToolContext {
  return {
    sandbox: opts.sandbox,
    root: opts.root,
    testCommand: opts.testCommand,
    testTimeoutMs: opts.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
    viewed: new Map(),
  };
}

export async function executeTool(ctx: ToolContext, call: ParsedToolCall): Promise<ToolOutput> {
  switch (call.name) {
    case 'grep':
      return grep(ctx, call.args);
    case 'glob':
      return glob(ctx, call.args);
    case 'view_file':
      return viewFile(ctx, call.args);
    case 'str_replace_edit':
      return strReplaceEdit(ctx, call.args);
    case 'create_file':
      return createFile(ctx, call.args);
    case 'run_command':
      return runCommand(ctx, call.args);
    case 'run_tests':
      return runTests(ctx);
    case 'finish':
      return finish(ctx, call.args);
  }
}
