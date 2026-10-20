import type { ToolEventData } from './types';

export type StepLabel = { verb: string; target?: string; extra?: string };

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
const oneLine = (s: string, max = 70) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const lineCount = (s: unknown) => (str(s) === '' ? 0 : str(s).split('\n').length);

export function describeStep({ name, args = {}, isError }: ToolEventData): StepLabel {
  switch (name) {
    case 'grep': {
      const where = args.glob
        ? ` in ${str(args.glob)}`
        : args.path && args.path !== '.'
          ? ` in ${str(args.path)}`
          : '';
      return { verb: 'Searched for', target: oneLine(str(args.pattern), 50), extra: where };
    }
    case 'glob':
      return { verb: 'Listed', target: str(args.pattern) };
    case 'view_file': {
      const offset = Number(args.offset ?? 1);
      return {
        verb: 'Read',
        target: str(args.path),
        extra: offset > 1 ? ` from line ${offset}` : '',
      };
    }
    case 'str_replace_edit':
      return {
        verb: isError ? 'Tried to edit' : 'Edited',
        target: str(args.path),
        extra: isError ? '' : ` +${lineCount(args.new_str)} −${lineCount(args.old_str)}`,
      };
    case 'create_file':
      return { verb: 'Created', target: str(args.path), extra: ` +${lineCount(args.content)}` };
    case 'run_command':
      return { verb: 'Ran', target: oneLine(str(args.command), 60) };
    case 'run_tests':
      return { verb: isError ? 'Tests failed' : 'Tests passed' };
    default:
      return { verb: name };
  }
}
