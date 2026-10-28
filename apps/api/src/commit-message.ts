import { lastCommittedDiff, latestWork, type SessionWithTurns } from '@weft/db';
import type { LLMProvider } from '@weft/llm';

export type FileChange = { path: string; status: 'added' | 'changed' | 'reverted' };

const SUBJECT_CHARS = 72;
const DELTA_CHARS = 12_000;

const SYSTEM = `You write git commit messages.
Reply with only the message: a subject line in the imperative mood, at most ${SUBJECT_CHARS} characters, no trailing period, no prefix. Add a blank line and a short body only if the subject can't carry the change on its own. Describe the code change itself, as a person would; never mention who or what made it.`;

export function sections(diff: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const part of diff.split(/^(?=diff --git )/m)) {
    const path = /^diff --git a\/.+? b\/(.+)$/m.exec(part)?.[1];
    if (path) files.set(path, part);
  }
  return files;
}

export function changesSince(previous: string, current: string): FileChange[] {
  const before = sections(previous);
  const after = sections(current);
  const changes: FileChange[] = [];
  for (const [path, part] of after) {
    if (!before.has(path)) changes.push({ path, status: 'added' });
    else if (before.get(path) !== part) changes.push({ path, status: 'changed' });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push({ path, status: 'reverted' });
  }
  return changes;
}

function describeDelta(previous: string, current: string, changes: FileChange[]): string {
  const before = sections(previous);
  const after = sections(current);
  const parts = changes.map(({ path, status }) => {
    if (status === 'added') return `${path} (newly changed):\n${after.get(path)}`;
    if (status === 'reverted') return `${path}: changes from the last commit were undone`;
    return `${path} at the last commit:\n${before.get(path)}\n${path} now:\n${after.get(path)}`;
  });
  const text = parts.join('\n\n');
  return text.length > DELTA_CHARS ? `${text.slice(0, DELTA_CHARS)}\n[cut]` : text;
}

export function fallbackMessage(changes: FileChange[]): string {
  const paths = changes.map((c) => c.path);
  if (paths.length === 0) return 'Update files';
  if (paths.length <= 3) return `Update ${paths.join(', ')}`.slice(0, SUBJECT_CHARS);
  return `Update ${paths.length} files`;
}

function clean(text: string): string | null {
  const lines = text
    .trim()
    .replace(/^```\w*\n?|\n?```$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim()
    .split('\n');
  const subject = lines[0]
    ?.replace(/^(subject|commit message):\s*/i, '')
    .replace(/\.$/, '')
    .trim();
  if (!subject) return null;
  const body = lines.slice(1).join('\n').trim();
  return [subject.slice(0, SUBJECT_CHARS), ...(body ? ['', body] : [])].join('\n');
}

export async function draftCommitMessage(
  session: SessionWithTurns,
  llm: LLMProvider | null,
): Promise<string> {
  const previous = lastCommittedDiff(session);
  const current = latestWork(session.turns)?.diff ?? '';
  const changes = changesSince(previous, current);
  if (!llm) return fallbackMessage(changes);

  const since = session.commits.at(-1)?.turn ?? 0;
  const asked = session.turns
    .filter((t) => t.turn! > since && t.mode !== 'ask')
    .map((t) => `- ${t.task}`)
    .join('\n');
  try {
    const res = await llm.complete({
      system: SYSTEM,
      maxTokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `What was asked:\n${asked}\n\nChanges since the last commit:\n${describeDelta(previous, current, changes)}`,
            },
          ],
        },
      ],
    });
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    return clean(text) ?? fallbackMessage(changes);
  } catch {
    return fallbackMessage(changes);
  }
}
