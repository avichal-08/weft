import {
  addTurn,
  cancelRun,
  createRun,
  createSession,
  getRun,
  commitRefusal,
  createCommit,
  getSession,
  publishRefusal,
  setPublishState,
  listRunEvents,
  listRuns,
  listSessions,
} from '@weft/db';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { ZodError } from 'zod';
import {
  commitBody,
  createRunBody,
  createSessionBody,
  definedOnly,
  listEventsQuery,
  listRunsQuery,
  listSessionsQuery,
  runIdParam,
  sendMessageBody,
  streamQuery,
} from './schemas.ts';
import { draftCommitMessage } from './commit-message.ts';
import { parseCursor, streamRun } from './stream.ts';
import type { AppDeps } from './types.ts';

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'invalid_request',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'body_too_large' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal' });
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/readyz', async (_req, res) => {
    const checks = await deps.ready();
    res.status(Object.values(checks).every(Boolean) ? 200 : 503).json(checks);
  });

  app.post('/runs', async (req, res) => {
    const body = createRunBody.parse(req.body);
    const run = await createRun(deps.db, definedOnly(body));
    try {
      await deps.enqueue(run.id);
    } catch (err) {
      console.error(`enqueue failed for run ${run.id}`, err);
      res.status(503).json({ error: 'queue_unavailable', run });
      return;
    }
    res.status(201).location(`/runs/${run.id}`).json({ run });
  });

  app.get('/runs', async (req, res) => {
    const query = definedOnly(listRunsQuery.parse(req.query));
    res.json({ runs: await listRuns(deps.db, query) });
  });

  app.get('/runs/:id', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const run = await getRun(deps.db, id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ run });
  });

  app.get('/runs/:id/events', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const query = definedOnly(listEventsQuery.parse(req.query));
    const run = await getRun(deps.db, id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const attempt = query.attempt ?? run.attempt;
    const events = await listRunEvents(deps.db, id, { ...query, attempt });
    res.json({ attempt, status: run.status, events });
  });

  app.get('/runs/:id/stream', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const query = definedOnly(streamQuery.parse(req.query));
    if (!(await getRun(deps.db, id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    const abort = new AbortController();
    const reader = deps.live();
    res.on('close', () => {
      abort.abort();
      reader.close();
    });
    try {
      await streamRun({
        db: deps.db,
        reader,
        runId: id,
        cursor: parseCursor(req.get('last-event-id'), query),
        send: (event, data, eventId) => {
          res.write(
            `event: ${event}\n${eventId ? `id: ${eventId}\n` : ''}data: ${JSON.stringify(data)}\n\n`,
          );
        },
        ping: () => res.write(': ping\n\n'),
        signal: abort.signal,
        ...(deps.liveBlockMs ? { blockMs: deps.liveBlockMs } : {}),
      });
    } catch (err) {
      if (!abort.signal.aborted) console.error(`stream for run ${id} failed`, err);
    } finally {
      reader.close();
      res.end();
    }
  });

  app.post('/runs/:id/cancel', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const run = await getRun(deps.db, id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!(await cancelRun(deps.db, id))) {
      res.status(409).json({ error: 'already_finished', status: run.status });
      return;
    }
    res.json({ run: await getRun(deps.db, id) });
  });

  const enqueueOr503 = async (runId: string): Promise<boolean> => {
    try {
      await deps.enqueue(runId);
      return true;
    } catch (err) {
      console.error(`enqueue failed for run ${runId}`, err);
      return false;
    }
  };

  app.post('/sessions', async (req, res) => {
    const body = createSessionBody.parse(req.body);
    const { session, run } = await createSession(deps.db, definedOnly(body));
    if (!(await enqueueOr503(run.id))) {
      res.status(503).json({ error: 'queue_unavailable', session, run });
      return;
    }
    res.status(201).location(`/sessions/${session.id}`).json({ session, run });
  });

  app.get('/sessions', async (req, res) => {
    const { limit } = listSessionsQuery.parse(req.query);
    res.json({ sessions: await listSessions(deps.db, limit) });
  });

  app.get('/sessions/:id', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const session = await getSession(deps.db, id);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ session });
  });

  app.post('/sessions/:id/commits/draft', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const session = await getSession(deps.db, id);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const why = commitRefusal(session);
    if (why) {
      res.status(409).json({ error: 'nothing_to_commit', message: why });
      return;
    }
    const llm = deps.createLLM ? deps.createLLM(session.config) : null;
    res.json({ message: await draftCommitMessage(session, llm) });
  });

  app.post('/sessions/:id/commits', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const { message } = commitBody.parse(req.body);
    const session = await getSession(deps.db, id);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const why = commitRefusal(session);
    if (why) {
      res.status(409).json({ error: 'nothing_to_commit', message: why });
      return;
    }
    const turn = session.turns.at(-1)!.turn!;
    const commit = await createCommit(deps.db, { sessionId: id, turn, message });
    if (session.prNumber) {
      await deps.enqueuePublish({ sessionId: id, turn, openPullRequest: false }).catch(() => {});
      await setPublishState(deps.db, id, 'queued');
    }
    res.status(201).json({ commit });
  });

  app.post('/sessions/:id/publish', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const session = await getSession(deps.db, id);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const why = publishRefusal(session.turns);
    if (why) {
      res.status(409).json({ error: 'not_publishable', message: why });
      return;
    }
    const turn = session.turns.at(-1)!.turn!;
    try {
      await deps.enqueuePublish({ sessionId: id, turn, openPullRequest: true });
    } catch {
      res.status(503).json({ error: 'queue_unavailable' });
      return;
    }
    await setPublishState(deps.db, id, 'queued');
    res.status(202).json({ session: { ...session, publishState: 'queued' } });
  });

  app.post('/sessions/:id/messages', async (req, res) => {
    const { id } = runIdParam.parse(req.params);
    const { message } = sendMessageBody.parse(req.body);
    const result = await addTurn(deps.db, id, message);
    if (!result.ok) {
      res
        .status(result.reason === 'busy' ? 409 : 404)
        .json(
          result.reason === 'busy'
            ? { error: 'busy', message: 'the agent is still working on the previous message' }
            : { error: 'not_found' },
        );
      return;
    }
    if (!(await enqueueOr503(result.run.id))) {
      res.status(503).json({ error: 'queue_unavailable', run: result.run });
      return;
    }
    res.status(201).json({ run: result.run });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler);

  return app;
}
