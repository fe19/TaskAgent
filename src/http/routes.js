import { SETTING_SPEC } from '../domain/settings-schema.js';
import {
  AVAILABLE_TOOLS,
  CORE_DENIED_COMMANDS,
  CORE_SECRET_ENV_VARS,
  ENFORCED_GUARANTEES,
} from '../domain/permissions.js';
import { PASSED_ENV_PREFIXES, PASSED_ENV_VARS } from '../domain/environment.js';
import { resultFileName, resultMarkdown } from '../domain/result-document.js';
import { notFound } from '../errors.js';
import { presentAgent, presentRun, presentTask } from '../presenters.js';

/** Maps the JSON API onto the shared actions and stores. */
export function registerRoutes(router, { actions, settings, tasks, runs, scheduler, resources, quota }) {
  router
    .get('/api/health', () => ({
      ok: true,
      active_agents: scheduler.activeCount,
      capacity: scheduler.capacity(),
    }))
    .get('/api/resources', () => resources.sample())
    .get('/api/quota', () => quota.read())

    .get('/api/settings', () => ({
      settings: settings.read(),
      spec: SETTING_SPEC,
      permissions: {
        tools: AVAILABLE_TOOLS,
        core_denied_commands: CORE_DENIED_COMMANDS,
        enforced: ENFORCED_GUARANTEES,
      },
      environment: {
        passed: PASSED_ENV_VARS,
        passed_prefixes: PASSED_ENV_PREFIXES,
        core_secrets: CORE_SECRET_ENV_VARS,
      },
    }))
    .put('/api/settings', ({ body }) => ({ settings: actions.updateSettings(body) }))
    .put('/api/dispatch', ({ body }) => actions.setDispatch(body.running))

    .get('/api/tasks', () => ({ tasks: tasks.list().map(presentTask) }))
    .post('/api/tasks', ({ body }) => ({
      status: 201,
      body: { task: presentTask(actions.createTask(body)) },
    }))
    .put('/api/tasks/:id', ({ params, body }) => ({
      task: presentTask(actions.editTask(params.id, body)),
    }))
    .delete('/api/tasks/:id', async ({ params }) => {
      await actions.deleteTask(params.id);
      return { deleted: true };
    })
    .post('/api/tasks/:id/cancel', ({ params }) => {
      const result = actions.cancelTask(params.id);
      // 202: asked to stop, not yet exited.
      return result.stopping ? { status: 202, body: result } : result;
    })
    .post('/api/tasks/:id/requeue', ({ params }) => ({
      task: presentTask(actions.requeueTask(params.id)),
    }))
    .post('/api/tasks/:id/start', ({ params }) => ({
      task: presentTask(actions.startTask(params.id)),
    }))
    .post('/api/tasks/:id/move', async ({ params, body }) => ({
      task: presentTask(await actions.moveTask(params.id, body)),
    }))

    .get('/api/agents', () => ({
      agents: runs.listRecent().map((run) => presentAgent(run, runs.getUsage(run.id))),
      active: scheduler.activeCount,
      capacity: scheduler.capacity(),
      settings: settings.read(),
    }))
    .post('/api/agents/stop-all', async () => ({ stopped: await actions.stopAll() }))

    .get('/api/runs/:id', ({ params }) => {
      const run = runs.get(params.id);
      if (!run) throw notFound('Run not found');
      return { run: presentRun(run, runs.getUsage(run.id)), events: runs.listEvents(run.id) };
    })
    .get('/api/runs/:id/result', ({ res, params }) => {
      const run = runs.getResult(params.id);
      if (!run) throw notFound('Run not found');
      if (!run.result_text) throw notFound('This run produced no result');
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${resultFileName(run)}"`,
      });
      res.end(resultMarkdown(run));
    })
    .post('/api/runs/:id/stop', ({ params }) => {
      actions.stopRun(params.id);
      return { status: 202, body: { stopping: true } };
    });
}
