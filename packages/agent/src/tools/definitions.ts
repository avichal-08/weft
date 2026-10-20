import { z } from 'zod';

const path = z.string().min(1).describe('Path relative to the repository root.');

export const TOOLS = {
  grep: {
    description:
      'Search file contents with ripgrep (regex). Start broad with mode "files" to find where ' +
      'something lives, then use mode "content" with context lines to read the matches. ' +
      'Respects .gitignore. Prefer this over run_command for searching.',
    schema: z.object({
      pattern: z.string().min(1).describe('Regular expression to search for.'),
      path: z.string().default('.').describe('File or directory to search in.'),
      glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts".'),
      mode: z
        .enum(['files', 'content', 'count'])
        .default('files')
        .describe('files: matching file paths. content: matching lines. count: matches per file.'),
      context: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(0)
        .describe('Lines of context around each match (content mode only).'),
      ignore_case: z.boolean().default(false),
      head_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Maximum number of output lines.'),
    }),
  },

  glob: {
    description:
      'Find files by name pattern, e.g. "**/*.test.ts". Returns paths, most recently modified ' +
      'first. Use this to explore the layout of the repository.',
    schema: z.object({
      pattern: z.string().min(1).describe('Glob pattern.'),
      path: z.string().default('.').describe('Directory to search in.'),
    }),
  },

  view_file: {
    description:
      'Read a file with line numbers. For large files, read a range with offset and limit ' +
      'instead of the whole file. Always view a file before editing it.',
    schema: z.object({
      path,
      offset: z.number().int().min(1).default(1).describe('First line to read (1-based).'),
      limit: z.number().int().min(1).max(2000).default(500).describe('Number of lines to read.'),
    }),
  },

  str_replace_edit: {
    description:
      'Replace an exact snippet of a file with new text. old_str must match the file exactly, ' +
      'including whitespace, and must appear exactly once unless replace_all is true. Include ' +
      'enough surrounding lines to make it unique. Fails if the file changed since you viewed it.',
    schema: z.object({
      path,
      old_str: z.string().min(1).describe('Exact text to replace.'),
      new_str: z.string().describe('Replacement text.'),
      replace_all: z.boolean().default(false).describe('Replace every occurrence.'),
    }),
  },

  create_file: {
    description:
      'Create a new file with the given content. Fails if the file already exists; use ' +
      'str_replace_edit to change existing files.',
    schema: z.object({
      path,
      content: z.string().describe('Full file content.'),
    }),
  },

  run_command: {
    description:
      'Run a shell command in the repository root, e.g. to build or run one test file. ' +
      'There is no network access. Output is truncated if it is very long.',
    schema: z.object({
      command: z.string().min(1).describe('Shell command to run.'),
      timeout_sec: z.number().int().min(1).max(600).default(120),
    }),
  },

  run_tests: {
    description:
      "Run the repository's configured test command and return its output. Run this to " +
      'check your change before calling finish.',
    schema: z.object({}),
  },

  finish: {
    description:
      'End your turn with a reply to the user. Put the answer to their question, or what you ' +
      'changed and why (naming the files), in summary. Calling it ends the turn.',
    schema: z.object({
      summary: z.string().min(1).describe('Your reply to the user.'),
    }),
  },
} as const;
