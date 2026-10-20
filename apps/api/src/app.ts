import { cancelRun, createRun, getRun, listRunEvents, listRuns } from '@weft/db';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { ZodError } from 'zod';
import {
  createRunBody,
  definedOnly,
  listEventsQuery,
  listRunsQuery,
  runIdParam,
} from './schemas.ts';
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

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler);

  return app;
}
