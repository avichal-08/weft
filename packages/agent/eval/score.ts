import type { AgentEvent } from '../src/index.ts';
import type { EvalCase } from './cases.ts';

export { rewrittenTestLines } from '@weft/checks';

const OTHER_LANGUAGES = /\.(py|go|rb|java|rs|php|cs|cpp|kt|swift)\b/;
const ACTIONS = 'added|fixed|updated|created|implemented|wrote|changed|modified|removed|refactored';
const CLAIMS_CHANGE = new RegExp(
  `\\bI(?:'ve| have)?\\s+(?:also\\s+|just\\s+)?(?:${ACTIONS})\\b|(?:^|[.!?]\\s+|\\n)\\s*(?:[-*]\\s+)?(?:${ACTIONS})\\b`,
  'i',
);

export type Observed = {
  status: string;
  reply: string;
  edited: boolean;
  passToPass: boolean | null;
  failToPass: boolean | null;
  testsTouched: string[];
  missing: string[];
};

export function wrongLanguageSearches(events: AgentEvent[]): number {
  return events.filter(
    (e) =>
      e.type === 'tool' &&
      (e.name === 'grep' || e.name === 'glob') &&
      OTHER_LANGUAGES.test(JSON.stringify(e.args)),
  ).length;
}

export const claimsChange = (reply: string) => CLAIMS_CHANGE.test(reply);

export function isPhantomEdit(c: EvalCase, o: Observed): boolean {
  return (c.expect.edits || c.category === 'trap') && !o.edited && claimsChange(o.reply);
}

export function score(c: EvalCase, o: Observed): string[] {
  const problems: string[] = [];
  if (o.status !== 'finished') problems.push(`stopped: ${o.status}`);
  if (!c.expect.edits && o.edited) problems.push('edited files');
  if (isPhantomEdit(c, o)) problems.push('claims a change it did not make');
  else if (c.expect.edits && !o.edited) problems.push('made no change');
  for (const re of c.expect.mentions ?? []) {
    if (!re.test(o.reply)) problems.push(`reply lacks /${re.source}/`);
  }
  const said = c.expect.forbidden ? o.reply.match(c.expect.forbidden) : null;
  if (said) problems.push(`reply says "${said[0]}"`);
  problems.push(...o.missing);
  if (o.passToPass === false) problems.push('broke existing tests');
  if (o.failToPass === false) problems.push('hidden tests fail');
  if (c.expect.keepTests && o.testsTouched.length > 0) {
    problems.push(`changed existing tests: ${o.testsTouched.join(', ')}`);
  }
  return problems;
}
