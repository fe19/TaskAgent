import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../src/events.js';
import { createActions } from '../src/actions.js';
import { createStores, recordEvents } from './helpers.js';

function setup() {
  const stores = createStores();
  const bus = new Bus();
  const scheduler = {
    ticks: 0,
    slots: 0,
    tick() { this.ticks += 1; return []; },
    startTask(id) { return this.slots > 0 ? stores.tasks.claim(id) : null; },
    stopRun: () => false,
    stopRunAndWait: async () => false,
    capacity() { return this.slots; },
    stopAll: async () => 0,
  };
  const actions = createActions({ ...stores, scheduler, bus });
  return { ...stores, bus, scheduler, actions, events: recordEvents(bus) };
}

test('creating a task publishes and asks the scheduler to dispatch', () => {
  const s = setup();
  const task = s.actions.createTask({ prompt: 'hello' });
  assert.equal(task.status, 'queued');
  assert.deepEqual(s.events.types(), ['task.created']);
  assert.equal(s.scheduler.ticks, 1);
  s.close();
});

test('cancel and requeue enforce task state with status-coded errors', () => {
  const s = setup();
  const { id } = s.actions.createTask({ prompt: 'hello' });
  assert.throws(() => s.actions.requeueTask(id), (err) => err.status === 409);
  assert.deepEqual(s.actions.cancelTask(id), { cancelled: true });
  assert.throws(() => s.actions.cancelTask(id), (err) => err.status === 409);
  assert.equal(s.actions.requeueTask(id).status, 'queued');
  assert.throws(() => s.actions.cancelTask(999), (err) => err.status === 404);
  s.close();
});

test('a retry is queued for the scheduler; a held task waits until started', () => {
  const s = setup();
  s.settings.update({ auto_dispatch: true });
  const { id } = s.actions.createTask({ prompt: 'hello' });
  s.actions.cancelTask(id);
  assert.throws(() => s.actions.startTask(id), (err) => err.status === 409, 'not queued');
  const ticks = s.scheduler.ticks;
  assert.equal(s.actions.requeueTask(id).held, 0);
  assert.equal(s.scheduler.ticks, ticks + 1, 'a retry asks the scheduler to dispatch');

  s.tasks.hold(id);
  assert.equal(s.tasks.claimNext(), null, 'the scheduler skips held tasks');
  assert.equal(s.actions.startTask(id).held, 0);
  assert.equal(s.tasks.claimNext().id, id);
  s.close();
});

test('manual mode starts a chosen task only when a slot is free', () => {
  const s = setup();
  const first = s.actions.createTask({ prompt: 'one' });
  const second = s.actions.createTask({ prompt: 'two', priority: 9 });
  assert.throws(() => s.actions.startTask(first.id), (err) => err.status === 409 && /slots are busy/.test(err.message));
  s.scheduler.slots = 1;
  assert.equal(s.actions.startTask(first.id).status, 'running', 'the chosen task, not the higher priority one');
  assert.equal(s.tasks.get(second.id).status, 'queued');
  s.close();
});

test('dispatch must be a boolean and is persisted', () => {
  const s = setup();
  assert.throws(() => s.actions.setDispatch('yes'), (err) => err.status === 400);
  assert.deepEqual(s.actions.setDispatch(true), { running: true, started: 0 });
  assert.equal(s.settings.read().auto_dispatch, true);
  s.close();
});

test('stopping a run that is not live is a 404', () => {
  const s = setup();
  assert.throws(() => s.actions.stopRun(1), (err) => err.status === 404);
  s.close();
});

test('moving a task between lanes maps onto start, cancel and retry', async () => {
  const s = setup();
  s.scheduler.slots = 1;
  const { id } = s.actions.createTask({ prompt: 'hello' });
  await assert.rejects(s.actions.moveTask(id, { from: 'queued', to: 'nowhere' }), (err) => err.status === 400);
  await assert.rejects(s.actions.moveTask(id, { from: 'done', to: 'queued' }), (err) => err.status === 409, 'stale from');
  assert.equal((await s.actions.moveTask(id, { from: 'queued', to: 'queued' })).status, 'queued', 'same lane: no-op');
  assert.equal((await s.actions.moveTask(id, { from: 'queued', to: 'done' })).status, 'cancelled');
  const requeued = await s.actions.moveTask(id, { from: 'done', to: 'queued' });
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.held, 0, 'only Working -> Queued holds');
  assert.equal((await s.actions.moveTask(id, { from: 'queued', to: 'running' })).status, 'running');
  await assert.rejects(s.actions.moveTask(id, { from: 'running', to: 'done' }), (err) => err.status === 409, 'no live agent');
  s.close();
});

test('dropping a finished task on Working retries and starts it, unless manual mode has no slot', async () => {
  const s = setup();
  const { id } = s.actions.createTask({ prompt: 'hello' });
  s.actions.cancelTask(id);
  await assert.rejects(s.actions.moveTask(id, { from: 'done', to: 'running' }), (err) => err.status === 409);
  assert.equal(s.tasks.get(id).status, 'cancelled', 'refused before requeueing');
  s.scheduler.slots = 1;
  assert.equal((await s.actions.moveTask(id, { from: 'done', to: 'running' })).status, 'running');
  s.close();
});

test('only a queued task can be edited, and an edit is published', () => {
  const s = setup();
  const { id } = s.actions.createTask({ prompt: 'hello' });
  assert.equal(s.actions.editTask(id, { prompt: 'hello again' }).prompt, 'hello again');
  assert.deepEqual(s.events.types(), ['task.created', 'task.updated']);
  s.actions.cancelTask(id);
  assert.throws(() => s.actions.editTask(id, { prompt: 'x' }), (err) => err.status === 409);
  assert.throws(() => s.actions.editTask(999, { prompt: 'x' }), (err) => err.status === 404);
  s.close();
});

test('an old run of an active task is dragged as a copy with the same prompt', async () => {
  const s = setup();
  const { id } = s.actions.createTask({ prompt: 'hello', priority: 5 });
  await assert.rejects(s.actions.moveTask(id, { from: 'done', to: 'queued' }), (err) => err.status === 409, 'no copy without the flag');
  await assert.rejects(s.actions.moveTask(id, { from: 'done', to: 'done', copy: true }), (err) => err.status === 400);

  const queued = await s.actions.moveTask(id, { from: 'done', to: 'queued', copy: true });
  assert.notEqual(queued.id, id);
  assert.deepEqual([queued.prompt, queued.priority, queued.status, queued.held], ['hello', 5, 'queued', 0]);

  await assert.rejects(s.actions.moveTask(id, { from: 'done', to: 'running', copy: true }), (err) => err.status === 409, 'manual mode, no slot');
  s.scheduler.slots = 1;
  const started = await s.actions.moveTask(id, { from: 'done', to: 'running', copy: true });
  assert.equal(started.status, 'running');
  assert.equal(s.tasks.list().length, 3);

  s.actions.cancelTask(id);
  await assert.rejects(s.actions.moveTask(id, { from: 'done', to: 'queued', copy: true }), (err) => err.status === 409, 'a finished task is retried, not copied');
  s.close();
});
