import { getSession, recordPublishError, recordPush, type Db, type Run } from '@weft/db';
import { parseRepo } from '@weft/github';
import { branchName, publishTurns, PublishError, type PublishResult } from './publish.ts';

export type Publisher = {
  token(ref: { owner: string; repo: string }): Promise<string>;
  identity(): Promise<{ name: string; email: string }>;
};

export type PublishDeps = { db: Db; github?: Publisher; allowFileRepos?: boolean };

const LOCAL_AUTHOR = { name: 'weft', email: 'weft@localhost' };

const firstLine = (text: string) => text.trim().split('\n')[0]!.slice(0, 72);

function refusal(latest: Run | undefined): string | null {
  if (!latest) return 'the chat has no turns yet';
  if (latest.status === 'queued' || latest.status === 'running') {
    return 'the agent is still working on the latest message';
  }
  if (latest.status === 'failed' && latest.failureKind === 'tests_failed') {
    return "the latest turn's tests fail, so there is nothing to publish yet";
  }
  if (latest.status !== 'succeeded') return "the latest turn didn't finish";
  return null;
}

export async function publishSession(deps: PublishDeps, sessionId: string): Promise<PublishResult> {
  const session = await getSession(deps.db, sessionId);
  if (!session) throw new PublishError(`session ${sessionId} not found`);

  try {
    const why = refusal(session.turns.at(-1));
    if (why) throw new PublishError(why);

    const ref = parseRepo(session.repoUrl);
    const local = !ref && deps.allowFileRepos && session.repoUrl.startsWith('file:');
    if (!ref && !local) throw new PublishError('only GitHub repositories can be published');
    if (ref && !deps.github) throw new PublishError('the GitHub App is not configured');

    const pushedTurn = session.pushedTurn ?? 0;
    const pushed = session.turns.find((t) => t.turn === pushedTurn);
    const turns = session.turns
      .filter((t) => t.turn! > pushedTurn && t.status === 'succeeded' && t.diff !== null)
      .map((t) => ({ turn: t.turn!, diff: t.diff!, message: firstLine(t.summary ?? t.task) }));
    const branch = session.branch ?? branchName(session.title, session.id);

    const result = await publishTurns({
      repoUrl: session.repoUrl,
      baseRef: session.baseRef,
      branch,
      pushedDiff: session.pushedTurn ? (pushed?.diff ?? '') : null,
      turns,
      token: ref ? await deps.github!.token(ref) : null,
      author: ref ? await deps.github!.identity() : LOCAL_AUTHOR,
    });
    if (result) {
      await recordPush(deps.db, sessionId, {
        branch,
        pushedTurn: result.pushedTurn,
        pushedSha: result.sha,
      });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordPublishError(deps.db, sessionId, message);
    throw err;
  }
}
