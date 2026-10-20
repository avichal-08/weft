import type { AgentEvent } from '../src/index.ts';
import type { EvalCase } from './cases.ts';

const OTHER_LANGUAGES = /\.(py|go|rb|java|rs|php|cs|cpp|kt|swift)\b/;

export type Observed = {
  status: string;
  reply: string;
  edited: boolean;
  testsPass: boolean | null;
  checkPass: boolean | null;
};

export function wrongLanguageSearches(events: AgentEvent[]): number {
  return events.filter(
    (e) =>
      e.type === 'tool' &&
      (e.name === 'grep' || e.name === 'glob') &&
      OTHER_LANGUAGES.test(JSON.stringify(e.args)),
  ).length;
}

export function score(c: EvalCase, o: Observed): string[] {
  const problems: string[] = [];
  if (o.status !== 'finished') problems.push(`stopped: ${o.status}`);
  if (!c.expect.edits && o.edited) problems.push('edited files');
  if (c.expect.edits && !o.edited) problems.push('made no change');
  for (const re of c.expect.mentions ?? []) {
    if (!re.test(o.reply)) problems.push(`reply lacks /${re.source}/`);
  }
  const said = c.expect.forbidden ? o.reply.match(c.expect.forbidden) : null;
  if (said) problems.push(`reply says "${said[0]}"`);
  if (o.testsPass === false) problems.push('tests fail');
  if (o.checkPass === false) problems.push('check fails');
  return problems;
}
