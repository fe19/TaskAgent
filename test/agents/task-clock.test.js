import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/store/database.js';
import { createTaskStore } from '../../src/store/task-store.js';
import { TaskClock } from '../../src/agents/task-clock.js';
import { Bus } from '../../src/events.js';
import { recordEvents } from '../helpers.js';

/** A real task store and a stub scheduler with a fixed number of free slots. */
function harness({ slots = 2 } = {}) {
  const db = openDatabase(':memory:');
  const time = { now: Date.parse('2026-10-15T10:00:00Z') };
  const tasks = createTaskStore({ db, now: () => time.now });
  const started = [];
  const scheduler = {
    free: slots,
    capacity() {
      return this.free;
    },
    startTask(id) {
      if (this.free === 0 || !tasks.claim(id)) return null;
      this.free -= 1;
      started.push(id);
      return { id };
    },
  };
  const bus = new Bus();
  const events = recordEvents(bus);
  const clock = new TaskClock({ tasks, scheduler, bus, now: () => time.now, tickMs: 60_000 });
  const at = (minutes) => new Date(time.now + minutes * 60_000).toISOString();
  return { db, tasks, scheduler, bus, events, clock, time, started, at };
}

test('a scheduled task starts when its time comes, not before', () => {
  const h = harness();
  const task = h.tasks.create({ prompt: 'at ten past', run_at: h.at(10) });
  assert.equal(h.clock.tick(), 0);

  h.time.now += 10 * 60_000;
  assert.equal(h.clock.tick(), 1);
  assert.deepEqual(h.started, [task.id]);
  assert.equal(h.tasks.get(task.id).status, 'running');
  h.db.close();
});

test('due tasks start as slots allow; the rest stay due for the next tick', () => {
  const h = harness({ slots: 1 });
  const a = h.tasks.create({ prompt: 'a', run_at: h.at(1) });
  const b = h.tasks.create({ prompt: 'b', run_at: h.at(2) });
  h.time.now += 3 * 60_000;

  assert.equal(h.clock.tick(), 1);
  assert.deepEqual(h.started, [a.id], 'the earliest first');
  assert.equal(h.tasks.get(b.id).status, 'queued');

  h.scheduler.free = 1;
  h.clock.tick();
  assert.deepEqual(h.started, [a.id, b.id]);
  h.db.close();
});

test('unscheduled and held tasks are left to the normal queue', () => {
  const h = harness();
  h.tasks.create({ prompt: 'plain' });
  const held = h.tasks.create({ prompt: 'held', run_at: h.at(1) });
  h.db.prepare('UPDATE tasks SET held = 1 WHERE id = ?').run(held.id);
  h.time.now += 2 * 60_000;
  assert.equal(h.clock.tick(), 0);
  h.db.close();
});

test('after each run a repeating task is queued again for its next occurrence', () => {
  const h = harness();
  const daily = h.tasks.create({ prompt: 'daily', run_at: h.at(1), repeat: 'daily' });
  h.time.now += 2 * 60_000;
  h.clock.start();
  assert.deepEqual(h.started, [daily.id], 'start() catches up straight away');

  h.tasks.setStatus(daily.id, 'succeeded');
  h.bus.publish('run.finished', { taskId: daily.id, status: 'succeeded' });
  const next = h.tasks.get(daily.id);
  assert.equal(next.status, 'queued');
  assert.equal(Date.parse(next.run_at) - Date.parse(h.at(-1)), 24 * 60 * 60_000, 'same time tomorrow');
  assert.equal(h.events.payload('task.rescheduled').runAt, next.run_at);
  h.clock.stop();
  h.db.close();
});

test('a stopped or failed run does not end the series', () => {
  const h = harness();
  const task = h.tasks.create({ prompt: 'hourly', run_at: h.at(1), repeat: 'hourly' });
  h.tasks.claim(task.id);
  h.tasks.setStatus(task.id, 'cancelled');
  assert.ok(h.clock.afterRun(task.id));
  assert.equal(h.tasks.get(task.id).status, 'queued');
  h.db.close();
});

test('one-off and deleted tasks are not rescheduled', () => {
  const h = harness();
  const once = h.tasks.create({ prompt: 'once', run_at: h.at(1) });
  h.tasks.claim(once.id);
  h.tasks.setStatus(once.id, 'succeeded');
  assert.equal(h.clock.afterRun(once.id), null);
  assert.equal(h.tasks.get(once.id).status, 'succeeded');
  assert.equal(h.clock.afterRun(9999), null);
  h.db.close();
});

test('stop() detaches from the bus', () => {
  const h = harness();
  const daily = h.tasks.create({ prompt: 'daily', run_at: h.at(1), repeat: 'daily' });
  h.clock.start();
  h.clock.stop();
  h.tasks.setStatus(daily.id, 'succeeded');
  h.bus.publish('run.finished', { taskId: daily.id });
  assert.equal(h.tasks.get(daily.id).status, 'succeeded');
  h.db.close();
});
