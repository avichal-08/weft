import {
  getRun,
  getSession,
  recordPublishError,
  recordPullRequest,
  setPublishState,
  type Db,
} from '@weft/db';
import { parseRepo, type NewPullRequest, type PullRequest, type RepoRef } from '@weft/github';
import type { LLMProvider } from '@weft/llm';
import type { PublishJobData } from '@weft/queue';
import { branchName } from './publish.ts';
import { publishSession, type Publisher } from './publish-session.ts';
import { describePullRequest } from './pull-request.ts';
import type { RunConfig } from './types.ts';

export type GitHub = Publisher & {
  defaultBranch(ref: RepoRef): Promise<string>;
  findPullRequest(ref: RepoRef, branch: string): Promise<PullRequest | null>;
  openPullRequest(ref: RepoRef, pr: NewPullRequest): Promise<PullRequest>;
};

export type PublishJobDeps = {
  db: Db;
  github?: GitHub;
  createLLM?: (config: RunConfig) => LLMProvider;
  allowFileRepos?: boolean;
  log?: (line: string) => void;
  publish?: typeof publishSession;
};

export async function handlePublish(deps: PublishJobDeps, job: PublishJobData): Promise<void> {
  const { db } = deps;
  const { sessionId } = job;
  const log = (line: string) => deps.log?.(`publish ${sessionId.slice(0, 8)} ${line}`);
  await setPublishState(db, sessionId, 'pushing');
  try {
    const before = (await getSession(db, sessionId))!;
    const ref = parseRepo(before.repoUrl);
    const opening = job.openPullRequest && !before.prNumber && ref && deps.github;
    const text = opening
      ? await describePullRequest(before, deps.createLLM ? deps.createLLM(before.config) : null)
      : null;

    const pushed = await (deps.publish ?? publishSession)(
      deps,
      sessionId,
      text && !before.branch ? { branch: branchName(text.title, sessionId) } : {},
    );
    log(pushed ? `pushed turn ${pushed.pushedTurn} (${pushed.sha.slice(0, 7)})` : 'nothing new');
    const session = (await getSession(db, sessionId))!;

    if (opening && text && session.branch) {
      const github = deps.github!;
      const existing = await github.findPullRequest(ref, session.branch);
      const pr =
        existing ??
        (await github.openPullRequest(ref, {
          head: session.branch,
          base: session.baseRef ?? (await github.defaultBranch(ref)),
          ...text,
        }));
      await recordPullRequest(db, sessionId, { prNumber: pr.number, prUrl: pr.url });
      log(`${existing ? 'found' : 'opened'} pull request #${pr.number}`);
    }
    await setPublishState(db, sessionId, 'pushed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordPublishError(db, sessionId, message);
    log(`failed: ${message}`);
  }
}

export async function followUpPublish(db: Db, runId: string): Promise<PublishJobData | null> {
  const run = await getRun(db, runId);
  if (!run?.sessionId || run.status !== 'succeeded' || !run.turn) return null;
  const session = await getSession(db, run.sessionId);
  if (!session?.prNumber) return null;
  return { sessionId: session.id, turn: run.turn, openPullRequest: false };
}
