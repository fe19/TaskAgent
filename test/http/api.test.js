import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/http/server.js';
import { tempDir, removeDir, waitFor } from '../helpers.js';

const FAKE_CLI = fileURLToPath(new URL('../fixtures/fake-copilot.mjs', import.meta.url));
const FAKE_GH = fileURLToPath(new URL('../fixtures/fake-gh.mjs', import.meta.url));

/** Boots the whole application on an ephemeral port, as a client would meet it. */
async function boot() {
  const root = tempDir('acr-api-');
  const app = createApp({
    dbFile: ':memory:',
    workspaceRoot: join(root, 'workspaces'),
    copilotBin: FAKE_CLI,
    ghBin: FAKE_GH,
    usageRetries: 1,
    readUsage: () => null,
  });

  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    return { status: res.status, body: isJson && text ? JSON.parse(text) : text, res };
  };

  return {
    app,
    base,
    call,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    cleanup: async () => {
      await app.close();
      removeDir(root);
    },
  };
}

test('the Copilot account quota is read through gh', async () => {
  const h = await boot();
  const { status, body } = await h.get('/api/quota');
  assert.equal(status, 200);
  assert.deepEqual(
    [body.available, body.remaining_aic, body.entitlement_aic, body.reset_date],
    [true, 88017.1, 120000, '2026-11-01T00:00:00.000Z'],
  );
  await h.cleanup();
});

test('health reports the pool state', async () => {
  const h = await boot();
  const { status, body } = await h.get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.active_agents, 0);
  assert.ok(body.capacity > 0);
  await h.cleanup();
});

test('settings come with the spec and permission catalogue the UI renders from', async () => {
  const h = await boot();
  const { body } = await h.get('/api/settings');
  assert.equal(typeof body.settings.max_concurrent_agents, 'number');
  assert.ok(body.spec.model.values.length > 0);
  assert.ok(body.permissions.tools.length > 0);
  assert.ok(body.permissions.core_denied_commands.includes('git push'));
  assert.ok(body.permissions.enforced.length > 0);
  await h.cleanup();
});

test('settings can be updated and are read back', async () => {
  const h = await boot();
  const { status, body } = await h.put('/api/settings', { max_concurrent_agents: 3 });
  assert.equal(status, 200);
  assert.equal(body.settings.max_concurrent_agents, 3);
  assert.equal((await h.get('/api/settings')).body.settings.max_concurrent_agents, 3);
  await h.cleanup();
});

test('an invalid setting is rejected with 400 and an explanation', async () => {
  const h = await boot();
  const { status, body } = await h.put('/api/settings', { max_concurrent_agents: 99 });
  assert.equal(status, 400);
  assert.match(body.error, /max_concurrent_agents/);
  await h.cleanup();
});

test('malformed JSON is a 400, not a crash', async () => {
  const h = await boot();
  const res = await fetch(`${h.base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  await h.cleanup();
});

test('a task is created queued and appears in the list with a short label', async () => {
  const h = await boot();
  const { status, body } = await h.post('/api/tasks', {
    prompt: 'What is the capital of France?',
  });
  assert.equal(status, 201);
  assert.equal(body.task.status, 'queued');
  assert.equal(body.task.short_label, 'Capital of France');

  const list = await h.get('/api/tasks');
  assert.equal(list.body.tasks.length, 1);
  await h.cleanup();
});

test('a new task does not start until dispatch is switched on', async () => {
  const h = await boot();
  await h.post('/api/tasks', { prompt: 'HANG please' });
  assert.equal((await h.get('/api/health')).body.active_agents, 0);

  const started = await h.put('/api/dispatch', { running: true });
  assert.equal(started.body.running, true);
  assert.equal(started.body.started, 1);
  assert.equal((await h.get('/api/health')).body.active_agents, 1);
  await h.cleanup();
});

test('dispatch requires an explicit boolean', async () => {
  const h = await boot();
  const { status, body } = await h.put('/api/dispatch', { running: 'yes' });
  assert.equal(status, 400);
  assert.match(body.error, /true or false/);
  await h.cleanup();
});

test('switching dispatch off leaves running agents alone but starts nothing new', async () => {
  const h = await boot();
  await h.put('/api/settings', { max_concurrent_agents: 1 });
  await h.post('/api/tasks', { prompt: 'HANG one' });
  await h.put('/api/dispatch', { running: true });
  await h.post('/api/tasks', { prompt: 'HANG two' });
  await h.put('/api/dispatch', { running: false });

  assert.equal((await h.get('/api/health')).body.active_agents, 1);
  const tasks = (await h.get('/api/tasks')).body.tasks;
  assert.equal(tasks.filter((t) => t.status === 'queued').length, 1);
  await h.cleanup();
});

test('an empty prompt is rejected', async () => {
  const h = await boot();
  const { status, body } = await h.post('/api/tasks', { prompt: '   ' });
  assert.equal(status, 400);
  assert.match(body.error, /prompt is required/);
  await h.cleanup();
});

test('a queued task can be deleted; a running one is stopped first', async () => {
  const h = await boot();
  const queued = (await h.post('/api/tasks', { prompt: 'delete me' })).body.task;
  assert.equal((await h.del(`/api/tasks/${queued.id}`)).status, 200);
  assert.equal((await h.get('/api/tasks')).body.tasks.length, 0);

  const running = (await h.post('/api/tasks', { prompt: 'HANG on' })).body.task;
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => (await h.get('/api/health')).body.active_agents === 1);
  assert.equal((await h.del(`/api/tasks/${running.id}`)).status, 200);
  assert.equal((await h.get('/api/health')).body.active_agents, 0, 'the agent was stopped');
  assert.equal((await h.get('/api/tasks')).body.tasks.length, 0);
  assert.equal((await h.get('/api/agents')).body.agents.length, 0, 'its runs went with it');
  await h.cleanup();
});

test('deleting a task that does not exist is a 404', async () => {
  const h = await boot();
  assert.equal((await h.del('/api/tasks/9999')).status, 404);
  await h.cleanup();
});

test('cancelling a queued task marks it cancelled without launching anything', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'never mind' })).body.task;
  assert.equal((await h.post(`/api/tasks/${task.id}/cancel`)).status, 200);
  assert.equal((await h.get('/api/tasks')).body.tasks[0].status, 'cancelled');
  await h.cleanup();
});

test('cancelling a running task stops its agent', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'HANG until cancelled' })).body.task;
  await h.put('/api/dispatch', { running: true });

  const { status, body } = await h.post(`/api/tasks/${task.id}/cancel`);
  assert.equal(status, 202, 'the stop is acknowledged before the process has exited');
  assert.equal(body.stopping, true);

  await waitFor(async () => (await h.get('/api/health')).body.active_agents === 0);
  assert.equal((await h.get('/api/tasks')).body.tasks[0].status, 'cancelled');
  await h.cleanup();
});

test('in auto mode a retried or dragged-back finished task runs again on its own', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'do the thing' })).body.task;
  await h.put('/api/dispatch', { running: true });
  const succeeded = (n) => async () =>
    (await h.get('/api/agents')).body.agents.filter((a) => a.status === 'succeeded').length === n;
  await waitFor(succeeded(1));

  const requeued = await h.post(`/api/tasks/${task.id}/requeue`);
  assert.equal(requeued.status, 200);
  await waitFor(succeeded(2));

  const moved = await h.post(`/api/tasks/${task.id}/move`, { from: 'done', to: 'queued' });
  assert.equal(moved.status, 200);
  await waitFor(succeeded(3));
  await h.cleanup();
});

test('in manual mode a retried task waits in the queue', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'FAIL once' })).body.task;
  await h.post(`/api/tasks/${task.id}/start`);
  await waitFor(async () => (await h.get('/api/tasks')).body.tasks[0].status === 'failed');
  await h.post(`/api/tasks/${task.id}/requeue`);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await h.get('/api/tasks')).body.tasks[0].status, 'queued');
  assert.equal((await h.post(`/api/tasks/${task.id}/start`)).status, 200);
  assert.equal((await h.post(`/api/tasks/${task.id}/start`)).status, 409);
  await h.cleanup();
});

test('dragging a running task back to Queued stops its agent and holds the task', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'HANG until moved' })).body.task;
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => (await h.get('/api/health')).body.active_agents === 1);

  const moved = await h.post(`/api/tasks/${task.id}/move`, { from: 'running', to: 'queued' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.task.status, 'queued');
  assert.equal(moved.body.task.held, 1);
  assert.equal((await h.get('/api/health')).body.active_agents, 0);
  const runs = (await h.get('/api/agents')).body.agents;
  assert.equal(runs[0].status, 'cancelled');

  const stale = await h.post(`/api/tasks/${task.id}/move`, { from: 'running', to: 'done' });
  assert.equal(stale.status, 409, 'a stale board cannot stop the wrong thing');
  await h.cleanup();
});

test('requeueing a task that is already queued is a conflict', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'queued already' })).body.task;
  const { status, body } = await h.post(`/api/tasks/${task.id}/requeue`);
  assert.equal(status, 409);
  assert.match(body.error, /already queued/);
  await h.cleanup();
});

test('a queued task prompt can be edited, but not once it has run', async () => {
  const h = await boot();
  const task = (await h.post('/api/tasks', { prompt: 'first draft' })).body.task;
  const edited = await h.put(`/api/tasks/${task.id}`, { prompt: 'Second draft', priority: 9 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.task.prompt, 'Second draft');
  assert.equal(edited.body.task.priority, 9);
  assert.equal(edited.body.task.short_label, 'Second draft');
  assert.equal((await h.put(`/api/tasks/${task.id}`, { prompt: '' })).status, 400);
  await h.post(`/api/tasks/${task.id}/cancel`);
  const late = await h.put(`/api/tasks/${task.id}`, { prompt: 'third' });
  assert.equal(late.status, 409);
  await h.cleanup();
});

test('the agents overview reports every run with its status and capacity', async () => {
  const h = await boot();
  await h.post('/api/tasks', { prompt: 'What is the capital of France?' });
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => {
    const { agents } = (await h.get('/api/agents')).body;
    return agents[0]?.status === 'succeeded';
  });

  const { body } = await h.get('/api/agents');
  const [agent] = body.agents;
  assert.equal(agent.short_label, 'Capital of France');
  assert.equal(agent.status, 'succeeded');
  assert.equal(agent.has_result, true);
  assert.ok(agent.started_at && agent.finished_at);
  assert.equal(typeof body.capacity, 'number');
  assert.ok(body.settings, 'the board can render without a second request');
  await h.cleanup();
});

test('an agent whose usage never arrived reports unavailable, not zero', async () => {
  const h = await boot();
  await h.post('/api/tasks', { prompt: 'no usage for me' });
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => (await h.get('/api/agents')).body.agents[0]?.finished_at);

  const [agent] = (await h.get('/api/agents')).body.agents;
  assert.equal(agent.usage, null);
  assert.equal(agent.usage_state, 'unavailable');
  await h.cleanup();
});

test('a run detail includes its prompt and event timeline', async () => {
  const h = await boot();
  await h.post('/api/tasks', { prompt: 'trace me' });
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => (await h.get('/api/agents')).body.agents[0]?.finished_at);
  const runId = (await h.get('/api/agents')).body.agents[0].id;

  const { body } = await h.get(`/api/runs/${runId}`);
  assert.equal(body.run.id, runId);
  assert.ok(body.events.length > 0);
  assert.ok(body.run.result, 'the detail view carries the full result text');
  assert.equal(body.run.task_prompt, 'trace me', 'the detail view carries the prompt');
  await h.cleanup();
});

test('a run result can be downloaded as markdown', async () => {
  const h = await boot();
  await h.post('/api/tasks', { prompt: 'produce a result' });
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => (await h.get('/api/agents')).body.agents[0]?.finished_at);
  const runId = (await h.get('/api/agents')).body.agents[0].id;

  const { status, body, res } = await h.get(`/api/runs/${runId}/result`);
  assert.equal(status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.match(res.headers.get('content-disposition'), /filename="ProduceResult-[a-z0-9-]+\.md"/);
  assert.match(body, /Created out\.txt/);
  assert.match(body, /## Prompt\n\nproduce a result/);
  await h.cleanup();
});

test('resources measure the running agents and fall back to zero when idle', async () => {
  const h = await boot();
  const idle = (await h.get('/api/resources')).body;
  assert.equal(idle.agents, 0);
  assert.equal(idle.cpu_percent, 0);
  assert.ok(idle.cores > 0 && idle.total_mem_bytes > 0);

  await h.post('/api/tasks', { prompt: 'HANG for a while' });
  await h.put('/api/dispatch', { running: true });
  await waitFor(async () => (await h.get('/api/health')).body.active_agents === 1);
  await waitFor(async () => (await h.get('/api/resources')).body.processes >= 1);
  const busy = (await h.get('/api/resources')).body;
  assert.equal(busy.agents, 1);
  assert.ok(busy.rss_bytes > 0, `rss ${busy.rss_bytes}`);
  await h.cleanup();
});

test('an unknown run is a 404 on both detail and result', async () => {
  const h = await boot();
  assert.equal((await h.get('/api/runs/4242')).status, 404);
  assert.equal((await h.get('/api/runs/4242/result')).status, 404);
  await h.cleanup();
});

test('stop-all cancels every live agent', async () => {
  const h = await boot();
  await h.put('/api/settings', { max_concurrent_agents: 2 });
  await h.post('/api/tasks', { prompt: 'HANG a' });
  await h.post('/api/tasks', { prompt: 'HANG b' });
  await h.put('/api/dispatch', { running: true });

  const { body } = await h.post('/api/agents/stop-all');
  assert.equal(body.stopped, 2);
  assert.equal((await h.get('/api/health')).body.active_agents, 0);
  await h.cleanup();
});

test('stopping a run that is not live is a 404', async () => {
  const h = await boot();
  assert.equal((await h.post('/api/runs/1234/stop')).status, 404);
  await h.cleanup();
});

test('an unknown API route is a JSON 404', async () => {
  const h = await boot();
  const { status, body } = await h.get('/api/nope');
  assert.equal(status, 404);
  assert.match(body.error, /Not found/i);
  await h.cleanup();
});

test('the SSE stream announces the connection and then relays live events', async () => {
  const h = await boot();
  const res = await fetch(`${h.base}/api/stream`);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readUntil = async (pattern) => {
    while (!pattern.test(buffer)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended before matching ${pattern}`);
      buffer += decoder.decode(value, { stream: true });
    }
  };

  await readUntil(/event: connected/);
  assert.match(buffer, /retry: \d+/, 'the browser is told how to reconnect');

  await h.post('/api/tasks', { prompt: 'notify me' });
  await readUntil(/event: task\.created/);

  await reader.cancel();
  await h.cleanup();
});

test('the UI is served, including the domain module the browser shares', async () => {
  const h = await boot();
  const page = await h.get('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>/);

  const domain = await h.get('/domain/run-status.js');
  assert.equal(domain.status, 200);
  assert.match(domain.body, /export/);
  assert.match(domain.res.headers.get('content-type'), /javascript/);
  await h.cleanup();
});

test('a path outside the web root is refused rather than served', async () => {
  const h = await boot();
  const res = await fetch(`${h.base}/../src/app.js`);
  assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
  await h.cleanup();
});
