import type { SessionWithTurns } from '@weft/db';
import type { LLMProvider } from '@weft/llm';

export type PullRequestText = { title: string; body: string };

const TITLE_CHARS = 70;

const SYSTEM = `You write GitHub pull request descriptions for changes made by a coding agent.
Reply with the title on the first line (plain text, at most ${TITLE_CHARS} characters, imperative mood, no prefix), then a blank line, then a short markdown body: what changed and why, as a few bullet points. Describe only what the changes do, as a person would. Do not mention how the change was made, and do not invent tests, issues or numbers.`;

export function changedFiles(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]!))];
}

function testing(session: SessionWithTurns): string {
  return session.testCommand ? `\n\n## Testing\n\n\`${session.testCommand}\` passes.` : '';
}

function fallback(session: SessionWithTurns, files: string[]): PullRequestText {
  const done = session.turns.filter((t) => t.status === 'succeeded' && t.summary);
  const lines = done.map((t) => `- ${t.summary!.trim().split('\n')[0]}`);
  return {
    title: session.title.slice(0, TITLE_CHARS),
    body: [...lines, '', `Files: ${files.map((f) => `\`${f}\``).join(', ')}`].join('\n'),
  };
}

function parse(text: string): PullRequestText | null {
  const [first, ...rest] = text.trim().split('\n');
  const title = first
    ?.replace(/^#+\s*/, '')
    .replace(/^title:\s*/i, '')
    .trim();
  const body = rest.join('\n').trim();
  if (!title || title.length > TITLE_CHARS * 2 || !body) return null;
  return { title: title.slice(0, TITLE_CHARS), body };
}

export async function describePullRequest(
  session: SessionWithTurns,
  llm: LLMProvider | null,
): Promise<PullRequestText> {
  const latest = session.turns.findLast((t) => t.status === 'succeeded' && t.diff);
  const files = changedFiles(latest?.diff ?? '');
  let text: PullRequestText | null = null;
  if (llm) {
    const chat = session.turns
      .map((t) => `User: ${t.task}\nAgent: ${t.summary ?? '(no reply)'}`)
      .join('\n\n');
    try {
      const res = await llm.complete({
        system: SYSTEM,
        maxTokens: 600,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: `${chat}\n\nFiles changed: ${files.join(', ')}` }],
          },
        ],
      });
      text = parse(res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'));
    } catch {
      text = null;
    }
  }
  const { title, body } = text ?? fallback(session, files);
  return { title, body: `${body}${testing(session)}` };
}
