import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStores } from '../helpers.js';

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
