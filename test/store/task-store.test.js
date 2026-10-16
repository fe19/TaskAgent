import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStores } from '../helpers.js';
import { openDatabase } from '../../src/store/database.js';
import { createTaskStore } from '../../src/store/task-store.js';

test('a task derives its title from the first line of the prompt', () => {
  const { tasks, close } = createStores();
  const task = tasks.create({ prompt: '  Create notes.md\nwith some detail  ' });
  assert.equal(task.title, 'Create notes.md');
  assert.equal(task.prompt, 'Create notes.md\nwith some detail');
  assert.equal(task.status, 'queued');
  close();
});

test('a very long first line is truncated for the title but kept in the prompt', () => {
  const { tasks, close } = createStores();
  const prompt = 'x'.repeat(200);
  const task = tasks.create({ prompt });
  assert.ok(task.title.length <= 80);
  assert.equal(task.prompt.length, 200);
  close();
});

test('an explicit title wins over the derived one', () => {
  const { tasks, close } = createStores();
  assert.equal(tasks.create({ prompt: 'anything', title: 'Chosen' }).title, 'Chosen');
  close();
});

test('an empty or whitespace prompt is rejected with a 400', () => {
  const { tasks, close } = createStores();
  for (const prompt of ['', '   ', null, undefined]) {
    assert.throws(
      () => tasks.create({ prompt }),
      (err) => err.status === 400 && /prompt is required/.test(err.message),
    );
  }
  close();
});

test('an oversized prompt is rejected', () => {
  const { tasks, close } = createStores();
  assert.throws(() => tasks.create({ prompt: 'x'.repeat(10001) }), /10000 characters/);
  close();
});

test('priority must be a whole number from 0 to 9', () => {
  const { tasks, close } = createStores();
  for (const priority of [-1, 10, 1.5, 'high']) {
    assert.throws(() => tasks.create({ prompt: 'p', priority }), /priority must be/);
  }
  assert.equal(tasks.create({ prompt: 'p', priority: 9 }).priority, 9);
  close();
});

test('claimNext takes the highest priority first, then the oldest', () => {
  const { tasks, close } = createStores();
  const normal = tasks.create({ prompt: 'normal' });
  const urgent = tasks.create({ prompt: 'urgent', priority: 9 });
  const second = tasks.create({ prompt: 'also normal' });

  assert.equal(tasks.claimNext().id, urgent.id);
  assert.equal(tasks.claimNext().id, normal.id);
  assert.equal(tasks.claimNext().id, second.id);
  assert.equal(tasks.claimNext(), null);
  close();
});

test('claiming flips the task to running in the same statement', () => {
  const { tasks, close } = createStores();
  const task = tasks.create({ prompt: 'claim me' });
  const claimed = tasks.claimNext();
  assert.equal(claimed.status, 'running', 'the returned row must already be claimed');
  assert.equal(tasks.get(task.id).status, 'running');
  close();
});

test('a task can only be claimed once', () => {
  const { tasks, close } = createStores();
  tasks.create({ prompt: 'only once' });
  assert.ok(tasks.claimNext());
  assert.equal(tasks.claimNext(), null);
  close();
});

test('countQueued only counts queued tasks', () => {
  const { tasks, close } = createStores();
  tasks.create({ prompt: 'a' });
  tasks.create({ prompt: 'b' });
  assert.equal(tasks.countQueued(), 2);
  tasks.claimNext();
  assert.equal(tasks.countQueued(), 1);
  close();
});

test('an invalid status is a programming error, not a stored value', () => {
  const { tasks, close } = createStores();
  const task = tasks.create({ prompt: 'x' });
  assert.throws(() => tasks.setStatus(task.id, 'exploded'), /Invalid task status/);
  close();
});

test('a running task cannot be deleted', () => {
  const { tasks, close } = createStores();
  const task = tasks.create({ prompt: 'busy' });
  tasks.setStatus(task.id, 'running');
  assert.deepEqual(tasks.remove(task.id), { deleted: false, reason: 'running' });
  assert.ok(tasks.get(task.id));
  close();
});

test('deleting a missing task reports not_found rather than succeeding', () => {
  const { tasks, close } = createStores();
  assert.deepEqual(tasks.remove(999), { deleted: false, reason: 'not_found' });
  close();
});

test('list puts running first, then queued, then everything else', () => {
  const { tasks, close } = createStores();
  const done = tasks.create({ prompt: 'done' });
  const queued = tasks.create({ prompt: 'queued' });
  const running = tasks.create({ prompt: 'running' });
  tasks.setStatus(done.id, 'succeeded');
  tasks.setStatus(running.id, 'running');

  assert.deepEqual(
    tasks.list().map((t) => t.id),
    [running.id, queued.id, done.id],
  );
  close();
});

test('list exposes the latest run id for each task', () => {
  const { tasks, runs, close } = createStores();
  const task = tasks.create({ prompt: 'two runs' });
  const make = () =>
    runs.create({
      taskId: task.id,
      sessionId: 's',
      workspaceDir: '/tmp/x',
      model: 'm',
      maxRuntimeSeconds: 10,
    });
  make();
  const second = make();
  assert.equal(tasks.list()[0].latest_run_id, second);
  close();
});

test('a queued task can be edited; the title follows the new prompt', () => {
  const { tasks, close } = createStores();
  const { id } = tasks.create({ prompt: 'old prompt' });
  const edited = tasks.editQueued(id, { prompt: '  New prompt\nmore  ', priority: 5 });
  assert.equal(edited.prompt, 'New prompt\nmore');
  assert.equal(edited.title, 'New prompt');
  assert.equal(edited.priority, 5);
  assert.throws(() => tasks.editQueued(id, { prompt: ' ' }), (err) => err.status === 400);
  tasks.claim(id);
  assert.equal(tasks.editQueued(id, { prompt: 'too late' }), null);
  assert.equal(tasks.get(id).prompt, 'New prompt\nmore');
  close();
});

/** A store whose clock the test moves. */
function scheduledStore() {
  const db = openDatabase(':memory:');
  const clock = { now: Date.parse('2026-10-15T10:00:00Z') };
  const tasks = createTaskStore({ db, now: () => clock.now });
  return { db, tasks, clock, at: (minutes) => new Date(clock.now + minutes * 60_000).toISOString() };
}

test('a task can be created with a start time and a repeat', () => {
  const { db, tasks, at } = scheduledStore();
  const task = tasks.create({ prompt: 'nightly report', run_at: at(60), repeat: 'daily' });
  assert.deepEqual([task.status, task.run_at, task.repeat], ['queued', at(60), 'daily']);
  assert.throws(() => tasks.create({ prompt: 'x', run_at: at(-10) }), /in the past/);
  assert.throws(() => tasks.create({ prompt: 'x', repeat: 'daily' }), /first start time/);
  db.close();
});

test('claimNext skips a task waiting for its time and takes it first once due', () => {
  const { db, tasks, clock, at } = scheduledStore();
  const later = tasks.create({ prompt: 'later', run_at: at(30), priority: 0 });
  const now = tasks.create({ prompt: 'now', priority: 9 });
  assert.equal(tasks.claimNext().id, now.id, 'a waiting task is not started early');
  assert.equal(tasks.claimNext(), null);

  clock.now += 31 * 60_000;
  assert.equal(tasks.claimNext().id, later.id);
  db.close();
});

test('a due scheduled task goes before unscheduled ones, whatever their priority', () => {
  const { db, tasks, clock, at } = scheduledStore();
  tasks.create({ prompt: 'urgent', priority: 9 });
  const scheduled = tasks.create({ prompt: 'scheduled', run_at: at(1) });
  clock.now += 2 * 60_000;
  assert.equal(tasks.claimNext().id, scheduled.id);
  db.close();
});

test('starting a one-off task uses up its start time; a repeating one keeps its anchor', () => {
  const { db, tasks, at } = scheduledStore();
  const once = tasks.create({ prompt: 'once', run_at: at(60) });
  const daily = tasks.create({ prompt: 'daily', run_at: at(60), repeat: 'daily' });
  assert.equal(tasks.claim(once.id).run_at, null, 'started by hand before its time');
  assert.equal(tasks.claim(daily.id).run_at, at(60));
  db.close();
});

test('listDue returns queued, unheld tasks whose time has come, earliest first', () => {
  const { db, tasks, clock, at } = scheduledStore();
  const second = tasks.create({ prompt: 'second', run_at: at(2) });
  const first = tasks.create({ prompt: 'first', run_at: at(1) });
  const held = tasks.create({ prompt: 'held', run_at: at(1) });
  tasks.create({ prompt: 'unscheduled' });
  tasks.create({ prompt: 'future', run_at: at(60) });
  db.prepare('UPDATE tasks SET held = 1 WHERE id = ?').run(held.id);

  clock.now += 3 * 60_000;
  assert.deepEqual(tasks.listDue().map((t) => t.id), [first.id, second.id]);
  db.close();
});

test('a retried repeating task resumes at its next occurrence; a passed one-off just queues', () => {
  const { db, tasks, clock, at } = scheduledStore();
  const daily = tasks.create({ prompt: 'daily', run_at: at(60), repeat: 'daily' });
  const once = tasks.create({ prompt: 'once', run_at: at(60) });
  tasks.setStatus(daily.id, 'cancelled');
  tasks.setStatus(once.id, 'cancelled');

  clock.now += 3 * 24 * 60 * 60_000; // three days later
  const resumed = tasks.requeue(daily.id);
  assert.ok(Date.parse(resumed.run_at) > clock.now, 'not due at once, even in Manual mode');
  assert.equal(new Date(resumed.run_at).getUTCMinutes(), new Date(at(60)).getUTCMinutes());
  assert.equal(tasks.requeue(once.id).run_at, null);
  db.close();
});

test('reschedule puts a task back in the queue for a new time', () => {
  const { db, tasks, at } = scheduledStore();
  const task = tasks.create({ prompt: 'daily', run_at: at(1), repeat: 'daily' });
  tasks.setStatus(task.id, 'succeeded');
  const back = tasks.reschedule(task.id, at(24 * 60));
  assert.deepEqual([back.status, back.run_at, back.held], ['queued', at(24 * 60), 0]);
  db.close();
});

test('editing a due task keeps its passed start time; a new past time is rejected', () => {
  const { db, tasks, clock, at } = scheduledStore();
  const runAt = at(1);
  const task = tasks.create({ prompt: 'due soon', run_at: runAt });
  clock.now += 5 * 60_000; // due, but say no slot was free
  assert.equal(tasks.editQueued(task.id, { prompt: 'edited', run_at: runAt }).run_at, runAt);
  assert.throws(() => tasks.editQueued(task.id, { prompt: 'edited', run_at: at(-2) }), /in the past/);
  assert.equal(tasks.editQueued(task.id, { prompt: 'unscheduled' }).run_at, null, 'clearing the time queues it normally');
  db.close();
});

test('a task can carry its own allowed sites; an edit without them keeps them', () => {
  const { db, tasks } = scheduledStore();
  const task = tasks.create({ prompt: 'read the news', allowed_sites: ['https://www.bbc.co.uk/news', 'WWW.BBC.CO.UK'] });
  assert.equal(task.allowed_sites, 'www.bbc.co.uk');
  assert.equal(tasks.editQueued(task.id, { prompt: 'read more news' }).allowed_sites, 'www.bbc.co.uk');
  assert.equal(tasks.allowSites(task.id, ['reuters.com']).allowed_sites, 'www.bbc.co.uk,reuters.com');
  assert.throws(() => tasks.create({ prompt: 'x', allowed_sites: ['not a site!'] }), /invalid websites/);
  db.close();
});
