import { createToolContext, runAgent, type AgentEvent } from '@weft/agent';
import {
  appendRunEvents,
  claimRun,
  completeRun,
  getRun,
  getSession,
  recordProgress,
  type CompleteRunInput,
  type PhaseTiming,
  type NewRunEvent,
} from '@weft/db';
import { emptyUsage, LLMError, withRetry } from '@weft/llm';
import type { LiveMessage, LivePhase } from '@weft/queue';
import { createSandbox, imageId, type ExecResult, type Sandbox } from '@weft/sandbox';
import { CloneError, cloneRepo, type Checkout } from './clone.ts';
import { buildHistory, latestDiff } from './history.ts';
import { installKey, manifestPrint, manifestsAfter, type CacheHit } from './install-cache.ts';
import { diffHash, release, stillUsable, type KillHandler } from './session-sandboxes.ts';
import type { SetupPlan } from './setup.ts';
import { detectSetup, runSetup, SetupError } from './setup.ts';
import { describeEvent, describeRetry, shortId } from './log.ts';
import { toRunEvent } from './trace.ts';
import type { RunConfig, RunOutcome, WorkerDeps } from './types.ts';
import { DEFAULT_WATCH_INTERVAL_MS, watchRun } from './watch.ts';

export const REPO_ROOT = '/workspace/repo';

export class ApplyError extends Error {
  override name = 'ApplyError';
}
const DEFAULT_MAX_STEPS = 30;

export const DIFF_COMMAND = [
  'exclude=$(git rev-parse --git-path info/exclude)',
  'mkdir -p "$(dirname "$exclude")"',
  '{ grep -qx node_modules "$exclude" 2>/dev/null || echo node_modules >> "$exclude"; }',
  'git add -A',
  'git diff --cached --binary --no-color',
].join(' && ');

export async function executeRun(deps: WorkerDeps, runId: string): Promise<RunOutcome> {
  const { db, workerId } = deps;
  const run = await getRun(db, runId);
  if (!run) return { kind: 'skipped' };
  const attempt = await claimRun(db, runId, workerId);
  if (attempt === undefined) return { kind: 'skipped' };

  const config = run.config as RunConfig;
  const log = (line: string) => deps.log?.(`run ${shortId(runId)} ${line}`);
  const usage = { steps: 0, ...emptyUsage() };
  const abort = new AbortController();
  let fenced = false;
  let progress = Promise.resolve();
  let checkout: Checkout | undefined;
  let sandbox: Sandbox | undefined;
  let env:
    | {
        plan: SetupPlan | null;
        key: string | null;
        baseId: string | null;
        depsPrint: string;
        createdAt: number;
      }
    | undefined;
  let keepDiff: string | undefined;
  const onKilled: KillHandler = { current: () => {} };
  let checker: Sandbox | undefined;
  let build: { key: string; base: string } | undefined;
  let killed: string | undefined;
  const timings: PhaseTiming[] = [];
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      timings.push({ phase: name, ms: Math.round(performance.now() - started) });
    }
  };

  const lose = () => {
    if (fenced) return;
    fenced = true;
    abort.abort();
    void sandbox?.destroy().catch(() => {});
    void checker?.destroy().catch(() => {});
  };
  const stopWatching = watchRun(
    db,
    runId,
    attempt,
    deps.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS,
    lose,
  );

  const live = (message: LiveMessage) => {
    if (!deps.live || fenced) return;
    deps.live(runId, message).catch((err: unknown) => {
      log(`live publish failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const phase = (name: LivePhase, detail?: string) =>
    live({ kind: 'phase', attempt, phase: name, ...(detail ? { detail } : {}) });

  let pending: NewRunEvent[] = [];
  let seq = 0;
  const flushEvents = () => {
    progress = progress.then(async () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      try {
        await appendRunEvents(db, runId, attempt, batch);
      } catch (err) {
        log(`trace write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const finish = async (outcome: CompleteRunInput): Promise<RunOutcome> => {
    flushEvents();
    await progress;
    if (fenced) return { kind: 'fenced' };
    log(`timings: ${describeTimings(timings)}`);
    const recorded = await completeRun(db, runId, attempt, {
      steps: usage.steps,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      timings,
      ...outcome,
    });
    live({ kind: 'end', attempt });
    return { kind: 'completed', status: outcome.status, recorded };
  };

  const onEvent = (event: AgentEvent) => {
    log(describeEvent(event));
    const row = toRunEvent(event, seq++);
    pending.push(row);
    live({ kind: 'event', attempt, event: { ...row, createdAt: new Date().toISOString() } });
    if (event.type !== 'llm') return;
    flushEvents();
    usage.steps = event.step;
    usage.inputTokens += event.usage.inputTokens;
    usage.outputTokens += event.usage.outputTokens;
    usage.cacheReadTokens += event.usage.cacheReadTokens;
    const snapshot = {
      steps: usage.steps,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
    };
    progress = progress.then(async () => {
      if (!(await recordProgress(db, runId, attempt, snapshot))) lose();
    });
  };

  try {
    const previous =
      run.sessionId && run.turn && run.turn > 1
        ? ((await getSession(db, run.sessionId))?.turns ?? []).filter((t) => t.turn! < run.turn!)
        : [];

    const base = latestDiff(previous);
    const allowFileRepos = deps.allowFileRepos ?? false;
    let resumed = run.sessionId ? deps.sessions?.take(run.sessionId) : undefined;
    if (resumed) {
      phase('sandbox', 'resume');
      const entry = resumed;
      const stale = await timed('resume', () =>
        stillUsable(entry, base, run.repoUrl, run.baseRef, allowFileRepos),
      );
      if (stale) {
        log(`resume: starting fresh, the kept sandbox can't be used because ${stale}`);
        void release(entry);
        resumed = undefined;
      }
    }
    onKilled.current = (reason) => {
      killed = reason;
      log(`sandbox killed: ${reason}`);
      abort.abort();
    };

    const boxFrom = (image: string, network = false) =>
      createSandbox({
        image,
        owner: workerId,
        labels: { 'weft.run': runId },
        onKilled: (reason) => onKilled.current(reason),
        ...(network ? { network: 'bridge' as const } : {}),
        limits: {
          ...(env?.plan ? { memoryMb: 2048, workspaceMb: 2048, tmpMb: 512 } : {}),
          ...(deps.diskLimitMb ? { workspaceMb: deps.diskLimitMb } : {}),
        },
        ...(deps.diskCheckMs ? { diskCheckMs: deps.diskCheckMs } : {}),
      });

    if (resumed) {
      ({ checkout, sandbox } = resumed);
      const { plan, key, baseId, depsPrint, createdAt } = resumed;
      env = { plan, key, baseId, depsPrint, createdAt };
      log(`resume: continuing in the sandbox kept from the previous turn`);
    } else {
      phase('clone');
      checkout = await timed('clone', () =>
        cloneRepo(run.repoUrl, run.baseRef, { allowFileRepos }),
      );
      const { dir } = checkout;
      const baseId = deps.installCache ? await imageId(deps.sandboxImage) : null;
      const detect = () => depsAfter(dir, base, baseId ? { repoUrl: run.repoUrl, baseId } : null);
      const { plan, key } = await (baseId ? timed('cacheKey', detect) : detect());
      const cache = key ? deps.installCache! : null;
      const hit: CacheHit | null = cache && key ? await cache.lookup(key) : null;
      env = { plan, key, baseId, depsPrint: '', createdAt: Date.now() };

      phase('sandbox');
      sandbox = await timed('sandbox', () =>
        boxFrom(hit?.kind === 'image' ? hit.image : deps.sandboxImage, Boolean(plan && !hit)),
      );
      abort.signal.throwIfAborted();
      const box = sandbox;
      await timed('copy', () => box.putFiles(dir, REPO_ROOT));

      if (base) {
        phase('restore');
        const applied = await timed('apply', () =>
          box.exec(['git', 'apply', '--whitespace=nowarn', '-'], { cwd: REPO_ROOT, stdin: base }),
        );
        if (applied.exitCode !== 0) {
          throw new ApplyError(applied.stderr.trim() || 'git apply failed');
        }
      }

      if (hit?.kind === 'image') {
        log(`setup: dependencies already in ${hit.image.slice(0, 22)}, no network`);
      } else if (cache && key && baseId && hit?.kind === 'tar') {
        log('setup: restoring dependencies from cache');
        phase('setup', 'cache');
        await timed('cacheRestore', () => cache.restore(box, REPO_ROOT, hit.path));
        log(`setup: restored in ${seconds(timings.at(-1)!.ms)}s, no network`);
        build = { key, base: baseId };
      } else if (plan) {
        log(`setup: ${plan.command}`);
        phase('setup', plan.command);
        await timed('install', () => runSetup(box, REPO_ROOT, plan));
        log(`setup: done in ${seconds(timings.at(-1)!.ms)}s, network disconnected`);
        if (cache && key && baseId) {
          try {
            const bytes = await timed('cacheSave', () => cache.save(box, REPO_ROOT, key));
            if (bytes !== null) {
              log(
                `setup: cached ${(bytes / 1e6).toFixed(0)} MB in ${seconds(timings.at(-1)!.ms)}s`,
              );
              build = { key, base: baseId };
            }
          } catch (err) {
            log(`setup: caching failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      env.depsPrint = await manifestPrint(box, REPO_ROOT).catch(() => 'unknown');
    }
    const box = sandbox;
    const { dir } = checkout;
    const { plan } = env;
    const cleanImage = async (diff: string) => {
      const cache = deps.installCache;
      if (!cache || !env?.baseId) return null;
      const after = await depsAfter(dir, diff, { repoUrl: run.repoUrl, baseId: env.baseId }).catch(
        () => null,
      );
      const hit = after?.key ? await cache.lookup(after.key) : null;
      return hit?.kind === 'image' ? hit.image : null;
    };

    phase('agent');
    const ctx = createToolContext({ sandbox: box, root: REPO_ROOT, testCommand: run.testCommand });
    const result = await timed('agent', () =>
      runAgent({
        llm: withRetry(deps.createLLM(config), {
          ...deps.retry,
          onRetry: ({ attempt, delayMs, error }) => log(describeRetry(attempt, delayMs, error)),
        }),
        ctx,
        task: run.task,
        history: buildHistory(previous),
        maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
        signal: abort.signal,
        onEvent,
      }),
    );
    if (killed) return await finish(diskLimit(killed));
    if (result.status === 'aborted')
      return await finish({ status: 'error', failureKind: 'aborted' });

    const diff = await timed('diff', () => box.exec(DIFF_COMMAND, { cwd: REPO_ROOT }));
    if (diff.exitCode !== 0) {
      throw new Error(`collecting the diff failed: ${diff.stderr.trim() || diff.exitCode}`);
    }

    let verify: ExecResult | null = null;
    if (run.testCommand) {
      phase('verify');
      const clean = !plan ? deps.sandboxImage : await cleanImage(diff.stdout);
      let target = box;
      if (clean) {
        target = await timed('verifySandbox', async () => {
          checker = await boxFrom(clean);
          await checker.putFiles(dir, REPO_ROOT);
          if (diff.stdout) {
            const applied = await checker.exec(['git', 'apply', '--whitespace=nowarn', '-'], {
              cwd: REPO_ROOT,
              stdin: diff.stdout,
            });
            if (applied.exitCode !== 0) {
              throw new Error(`this turn's diff did not apply for verification: ${applied.stderr}`);
            }
          }
          return checker;
        });
      } else {
        log("verify: no clean dependencies yet, running the tests in the agent's sandbox");
      }
      verify = await timed('verify', () =>
        target.exec(run.testCommand!, { cwd: REPO_ROOT, timeoutMs: ctx.testTimeoutMs }),
      );
    }
    const passed = verify ? verify.exitCode === 0 : true;
    const reusable = await manifestPrint(box, REPO_ROOT).then(
      (print) => print === env!.depsPrint,
      () => false,
    );
    const keepIfRecorded = (outcome: RunOutcome) => {
      if (reusable && outcome.kind === 'completed' && outcome.recorded) keepDiff = diff.stdout;
      return outcome;
    };

    if (result.status === 'finished' && passed) {
      return keepIfRecorded(
        await finish({ status: 'succeeded', diff: diff.stdout, ...summaryOf(result.summary) }),
      );
    }
    return keepIfRecorded(
      await finish({
        status: 'failed',
        diff: diff.stdout,
        failureKind: result.status === 'finished' ? 'tests_failed' : result.status,
        failureDetail: !passed
          ? tail(verify!.stdout + verify!.stderr)
          : 'the agent stopped without replying',
        ...summaryOf(result.summary),
      }),
    );
  } catch (err) {
    if (killed) return await finish(diskLimit(killed));
    return await finish({ status: 'error', ...describeError(err) });
  } finally {
    stopWatching();
    const kept =
      keepDiff !== undefined &&
      !fenced &&
      !killed &&
      deps.sessions &&
      run.sessionId &&
      sandbox &&
      checkout &&
      env
        ? await deps.sessions.keep({
            ...env,
            sessionId: run.sessionId,
            sandbox,
            checkout,
            diffHash: diffHash(keepDiff),
            onKilled,
          })
        : false;
    if (kept) log('keeping the sandbox for the next turn');
    await Promise.all([kept ? undefined : sandbox?.destroy(), checker?.destroy()]).catch(() => {});
    if (!kept) await checkout?.cleanup();
    if (build) deps.installCache?.scheduleBuild(build.key, build.base);
  }
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);

export const describeTimings = (timings: PhaseTiming[]) =>
  timings.map(({ phase, ms }) => `${phase} ${seconds(ms)}s`).join(', ') || 'none';

async function depsAfter(
  dir: string,
  diff: string | null,
  cache: { repoUrl: string; baseId: string } | null,
): Promise<{ plan: SetupPlan | null; key: string | null }> {
  const files = await manifestsAfter(dir, diff).catch((err: unknown) => {
    throw new ApplyError(err instanceof Error ? err.message : String(err));
  });
  try {
    const plan = await detectSetup(files.dir);
    const key =
      plan && cache
        ? await installKey(files.dir, {
            repoUrl: cache.repoUrl,
            imageId: cache.baseId,
            command: plan.command,
          })
        : null;
    return { plan, key };
  } finally {
    await files.cleanup();
  }
}

const diskLimit = (reason: string): CompleteRunInput => ({
  status: 'error',
  failureKind: 'disk_limit',
  failureDetail: `the sandbox was stopped because ${reason}`,
});

const summaryOf = (summary: string | undefined) => (summary ? { summary } : {});

const tail = (text: string, max = 4000) => (text.length > max ? text.slice(-max) : text);

function describeError(err: unknown): { failureKind: string; failureDetail: string } {
  if (err instanceof CloneError) return { failureKind: 'clone_failed', failureDetail: err.message };
  if (err instanceof SetupError) return { failureKind: 'setup_failed', failureDetail: err.message };
  if (err instanceof ApplyError) {
    return {
      failureKind: 'apply_failed',
      failureDetail: `the previous turn's changes no longer apply to the branch: ${err.message}`,
    };
  }
  if (err instanceof LLMError)
    return { failureKind: `llm_${err.kind}`, failureDetail: err.message.slice(0, 2000) };
  return {
    failureKind: 'internal',
    failureDetail: err instanceof Error ? err.message : String(err),
  };
}
