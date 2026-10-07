import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scheduler } from '../../src/agents/scheduler.js';
import { Bus } from '../../src/events.js';
import { createStores, tempDir, removeDir, recordEvents, waitFor } from '../helpers.js';

const FAKE_CLI = fileURLToPath(new URL('../fixtures/fake-copilot.mjs', import.meta.url));

function harness({ settings: patch = {} } = {}) {
  const root = tempDir('acr-sched-');
  const workspaceRoot = join(root, 'workspaces');
  const stores = createStores({ workspaceRoot });
  // These tests drive the fake Copilot CLI; Claude Code has its own in agent-run.test.js.
  stores.settings.update({ assistant: 'copilot', auto_dispatch: true, ...patch });

  const bus = new Bus();
  const scheduler = new Scheduler({
    settings: stores.settings,
    tasks: stores.tasks,
    runs: stores.runs,
    bus,
    agentOptions: {
      workspaceRoot,
      copilotBin: FAKE_CLI,
      usageRetries: 1,
      readUsage: () => null,
    },
  });

  return {
    scheduler,
    stores,
    events: recordEvents(bus),
    cleanup: async () => {
      await scheduler.shutdown();
      stores.close();
      removeDir(root);
    },
  };
}

test('queued tasks stay put until dispatch is switched on', async () => {
  const h = harness({ settings: { auto_dispatch: false } });
  h.stores.tasks.create({ prompt: 'do not start me' });

  assert.deepEqual(h.scheduler.tick(), []);
  assert.equal(h.scheduler.activeCount, 0);
  assert.equal(h.stores.tasks.countQueued(), 1, 'the task is still queued, not lost');

  h.stores.settings.update({ auto_dispatch: true });
  assert.equal(h.scheduler.tick().length, 1);
  await h.cleanup();
});

test('manual mode starts exactly the chosen task, within capacity', async () => {
  const h = harness({ settings: { auto_dispatch: false, max_concurrent_agents: 1 } });
  const a = h.stores.tasks.create({ prompt: 'HANG a', priority: 9 });
  const b = h.stores.tasks.create({ prompt: 'HANG b' });

  assert.ok(h.scheduler.startTask(b.id));
  assert.equal(h.stores.tasks.get(b.id).status, 'running');
  assert.equal(h.scheduler.startTask(a.id), null, 'no free slot');
  assert.equal(h.stores.tasks.get(a.id).status, 'queued');
  assert.equal(h.scheduler.startTask(b.id), null, 'not queued any more');
  await h.cleanup();
});

test('concurrency never exceeds the configured maximum', async () => {
  const h = harness({ settings: { max_concurrent_agents: 2 } });
  for (let i = 0; i < 5; i += 1) h.stores.tasks.create({ prompt: `HANG task ${i}` });

  assert.equal(h.scheduler.tick().length, 2);
  assert.equal(h.scheduler.activeCount, 2);
  assert.equal(h.scheduler.tick().length, 0, 'a second tick cannot exceed capacity');
  assert.equal(h.stores.tasks.countQueued(), 3);
  await h.cleanup();
});

test('capacity reports the free slots', async () => {
  const h = harness({ settings: { max_concurrent_agents: 3 } });
  assert.equal(h.scheduler.capacity(), 3);
  h.stores.tasks.create({ prompt: 'HANG here' });
  h.scheduler.tick();
  assert.equal(h.scheduler.capacity(), 2);
  await h.cleanup();
});

test('a freed slot pulls the next queued task automatically', async () => {
  const h = harness({ settings: { max_concurrent_agents: 1 } });
  h.stores.tasks.create({ prompt: 'first task' });
  h.stores.tasks.create({ prompt: 'second task' });

  h.scheduler.tick();
  await waitFor(
    () => h.scheduler.activeCount === 0 && h.stores.tasks.countQueued() === 0,
  );
  assert.ok(
    h.stores.tasks.list().every((t) => t.status === 'succeeded'),
    'both ran, one after the other, without a second explicit tick',
  );
  await h.cleanup();
});

test('an empty queue is a no-op', async () => {
  const h = harness();
  assert.deepEqual(h.scheduler.tick(), []);
  assert.equal(h.events.find('scheduler.dispatched'), null);
  await h.cleanup();
});

test('a dispatch is announced once with the number started', async () => {
  const h = harness({ settings: { max_concurrent_agents: 2 } });
  h.stores.tasks.create({ prompt: 'HANG a' });
  h.stores.tasks.create({ prompt: 'HANG b' });
  h.scheduler.tick();
  assert.deepEqual(h.events.payload('scheduler.dispatched'), { count: 2 });
  await h.cleanup();
});

test('a re-entrant tick cannot double-dispatch the same task', async () => {
  const h = harness({ settings: { max_concurrent_agents: 2 } });
  h.stores.tasks.create({ prompt: 'HANG once' });

  const bus = h.scheduler.bus;
  let reentered = 0;
  bus.on('event', (e) => {
    if (e.type === 'run.started' && reentered === 0) {
      reentered += 1;
      h.scheduler.tick(); // re-entrant call from inside dispatch
    }
  });

  h.scheduler.tick();
  assert.equal(h.scheduler.activeCount, 1);
  await h.cleanup();
});

test('a task whose agent cannot be spawned is failed, not stranded as running', async () => {
  const h = harness();
  h.scheduler.agentOptions.workspaceRoot = '/proc/nonexistent/forbidden';
  const task = h.stores.tasks.create({ prompt: 'cannot start' });

  h.scheduler.tick();
  assert.equal(h.stores.tasks.get(task.id).status, 'failed');
  assert.equal(h.scheduler.activeCount, 0);
  assert.equal(h.events.payload('scheduler.error').taskId, task.id);
  await h.cleanup();
});

test('a single run can be stopped by id', async () => {
  const h = harness();
  h.stores.tasks.create({ prompt: 'HANG until stopped' });
  const [run] = h.scheduler.tick();

  assert.equal(h.scheduler.stopRun(run.runId), true);
  assert.equal((await run.exited).status, 'cancelled');
  await h.cleanup();
});

test('a stopped run frees its slot before its usage sync ends, and shutdown still waits for it', async () => {
  const h = harness({ settings: { auto_dispatch: false, max_concurrent_agents: 1 } });
  h.scheduler.agentOptions.usageRetries = 4; // ~2 s of polling
  const a = h.stores.tasks.create({ prompt: 'HANG a' });
  const b = h.stores.tasks.create({ prompt: 'HANG b' });
  const run = h.scheduler.startTask(a.id);

  let synced = false;
  run.exited.then(() => { synced = true; });
  assert.equal(await h.scheduler.stopRunAndWait(run.runId), true);
  assert.equal(h.stores.tasks.get(a.id).status, 'cancelled');
  assert.equal(synced, false, 'usage is still being fetched');
  assert.equal(h.scheduler.capacity(), 1, 'the slot is free already');
  assert.ok(h.scheduler.startTask(b.id), 'the next task can start at once');

  await h.scheduler.shutdown();
  assert.equal(synced, true, 'shutdown waits for usage writes before the db closes');
  await h.cleanup();
});

test('stopping an unknown or already finished run reports false', async () => {
  const h = harness();
  assert.equal(h.scheduler.stopRun(9999), false);
  await h.cleanup();
});

test('stopAll cancels every active run and waits for them', async () => {
  const h = harness({ settings: { max_concurrent_agents: 2 } });
  h.stores.tasks.create({ prompt: 'HANG a' });
  h.stores.tasks.create({ prompt: 'HANG b' });
  h.scheduler.tick();

  assert.equal(await h.scheduler.stopAll(), 2);
  assert.equal(h.scheduler.activeCount, 0);
  assert.ok(
    h.stores.tasks.list().every((t) => t.status === 'cancelled'),
    'every task reflects the cancellation',
  );
  await h.cleanup();
});

test('after shutdown no further task is dispatched', async () => {
  const h = harness();
  await h.scheduler.shutdown();
  h.stores.tasks.create({ prompt: 'too late' });

  assert.deepEqual(h.scheduler.tick(), []);
  assert.equal(h.stores.tasks.countQueued(), 1);
  await h.cleanup();
});

test('runs use the workspace root from settings when none is injected', async () => {
  const root = tempDir('acr-sched-ws-');
  const workspaceRoot = join(root, 'from-settings');
  const stores = createStores({ resolvePath: (v) => String(v) });
  stores.settings.update({ assistant: 'copilot', auto_dispatch: true, workspace_root: workspaceRoot });

  const scheduler = new Scheduler({
    settings: stores.settings,
    tasks: stores.tasks,
    runs: stores.runs,
    bus: new Bus(),
    agentOptions: {
      copilotBin: FAKE_CLI,
      usageRetries: 1,
      readUsage: () => null,
    },
  });

  stores.tasks.create({ prompt: 'HANG in the configured root' });
  const [run] = scheduler.tick();
  assert.ok(run.workspace.startsWith(workspaceRoot));

  await scheduler.shutdown();
  stores.close();
  removeDir(root);
});
