import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStores } from '../helpers.js';

function seed(stores, prompt = 'do a thing') {
  const task = stores.tasks.create({ prompt });
  const runId = stores.runs.create({
    taskId: task.id,
    sessionId: `session-${task.id}`,
    workspaceDir: `/tmp/ws/task-${task.id}`,
    model: 'claude-haiku-4.5',
    maxRuntimeSeconds: 60,
  });
  return { task, runId };
}

test('a new run starts as "starting" with a launching activity', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  const run = stores.runs.get(runId);
  assert.equal(run.status, 'starting');
  assert.equal(run.current_activity, 'Launching agent');
  assert.equal(run.finished_at, null);
  assert.equal(run.tool_calls, 0);
  stores.close();
});

test('markRunning records the pid and flips the status', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.markRunning(runId, 4242);
  const run = stores.runs.get(runId);
  assert.equal(run.pid, 4242);
  assert.equal(run.status, 'running');
  stores.close();
});

test('a missing pid is stored as null rather than undefined', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.markRunning(runId, undefined);
  assert.equal(stores.runs.get(runId).pid, null);
  stores.close();
});

test('finishing sets the terminal activity for the status', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.finish(runId, { status: 'succeeded', exitCode: 0 });
  const run = stores.runs.get(runId);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.current_activity, 'Completed');
  assert.equal(run.exit_code, 0);
  assert.ok(run.finished_at);
  stores.close();
});

test('an unknown terminal status keeps the last real activity', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.setActivity(runId, 'Reading notes.md');
  stores.runs.finish(runId, { status: 'interrupted' });
  assert.equal(stores.runs.get(runId).current_activity, 'Reading notes.md');
  stores.close();
});

test('CLI result metrics are stored, with file lists as JSON', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.recordCliResult(runId, {
    premiumRequests: 0.33,
    linesAdded: 4,
    linesRemoved: 1,
    filesModified: ['/tmp/a.txt'],
  });
  const run = stores.runs.get(runId);
  assert.equal(run.premium_requests, 0.33);
  assert.equal(run.lines_added, 4);
  assert.deepEqual(JSON.parse(run.files_modified), ['/tmp/a.txt']);
  stores.close();
});

test('absent code changes stay null rather than becoming zero', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.recordCliResult(runId, {});
  const run = stores.runs.get(runId);
  assert.equal(run.lines_added, null);
  assert.equal(run.files_modified, null);
  stores.close();
});

test('events are stored newest-first but read oldest-first', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  for (const summary of ['first', 'second', 'third']) {
    stores.runs.appendEvent(runId, { kind: 'tool', summary });
  }
  assert.deepEqual(
    stores.runs.listEvents(runId).map((e) => e.summary),
    ['first', 'second', 'third'],
  );
  stores.close();
});

test('the event list is capped and keeps the most recent entries', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  for (let i = 0; i < 10; i += 1) stores.runs.appendEvent(runId, { kind: 'tool', summary: `e${i}` });
  const events = stores.runs.listEvents(runId, 3);
  assert.deepEqual(
    events.map((e) => e.summary),
    ['e7', 'e8', 'e9'],
  );
  stores.close();
});

test('liveRunIdForTask finds the unfinished run and forgets it once finished', () => {
  const stores = createStores();
  const { task, runId } = seed(stores);
  assert.equal(stores.runs.liveRunIdForTask(task.id), runId);
  stores.runs.finish(runId, { status: 'succeeded', exitCode: 0 });
  assert.equal(stores.runs.liveRunIdForTask(task.id), null);
  stores.close();
});

test('listRecent puts live runs first, then the newest finished', () => {
  const stores = createStores();
  const first = seed(stores, 'first');
  const second = seed(stores, 'second');
  const live = seed(stores, 'live');
  stores.runs.finish(first.runId, { status: 'succeeded', exitCode: 0 });
  stores.runs.finish(second.runId, { status: 'failed', exitCode: 1 });

  assert.deepEqual(
    stores.runs.listRecent().map((r) => r.id),
    [live.runId, second.runId, first.runId],
  );
  stores.close();
});

test('listRecent joins the task so the board can label the tile', () => {
  const stores = createStores();
  seed(stores, 'Create notes.md');
  const [row] = stores.runs.listRecent();
  assert.equal(row.task_title, 'Create notes.md');
  assert.equal(row.task_prompt, 'Create notes.md');
  stores.close();
});

test('saving usage twice updates rather than duplicating', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.saveUsage(runId, { api_calls: 1, input_tokens: 10, nano_aiu: 5 });
  stores.runs.saveUsage(runId, { api_calls: 2, input_tokens: 20, nano_aiu: 9 });
  const usage = stores.runs.getUsage(runId);
  assert.equal(usage.api_calls, 2);
  assert.equal(usage.input_tokens, 20);
  stores.close();
});

test('saving null usage is a no-op, so nothing is invented', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  assert.equal(stores.runs.saveUsage(runId, null), false);
  assert.equal(stores.runs.getUsage(runId), null);
  stores.close();
});

test('a stored result comes back with what its download needs', () => {
  const stores = createStores();
  const { runId } = seed(stores);
  stores.runs.saveResult(runId, 'the answer');
  const result = stores.runs.getResult(runId);
  assert.equal(result.result_text, 'the answer');
  assert.ok(result.task_title && result.task_prompt && result.model);
  assert.equal(stores.runs.getResult(9999), null);
  stores.close();
});
