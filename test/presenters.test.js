import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentAgent, presentRun, presentTask } from '../src/presenters.js';

const RUN = {
  id: 1,
  task_id: 2,
  session_id: 'abc',
  status: 'succeeded',
  model: 'claude-haiku-4.5',
  current_activity: 'Completed',
  tool_calls: 3,
  workspace_dir: '/tmp/ws/task-2',
  max_runtime_s: 300,
  started_at: '2026-01-01 10:00:00',
  finished_at: '2026-01-01 10:01:00',
  error: null,
  exit_code: 0,
  lines_added: null,
  lines_removed: null,
  files_modified: null,
  premium_requests: 0.33,
  task_title: 'Capital of France',
  task_prompt: 'What is the capital of France?',
};

const USAGE = {
  api_calls: 4,
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_tokens: 50,
  cache_write_tokens: 25,
  nano_aiu: 2_500_000_000,
  api_duration_ms: 4321,
  model: 'claude-haiku-4.5',
};

test('token totals are summed across all four buckets', () => {
  assert.equal(presentRun(RUN, USAGE).usage.total_tokens, 1275);
});

test('AIU is converted from nano-AIU', () => {
  assert.equal(presentRun(RUN, USAGE).usage.aiu, 2.5);
});

test('a run with usage is reported as available', () => {
  assert.equal(presentRun(RUN, USAGE).usage_state, 'available');
});

test('a finished run without usage is unavailable, and usage stays null', () => {
  const presented = presentRun(RUN, null);
  assert.equal(presented.usage_state, 'unavailable');
  assert.equal(presented.usage, null, 'no zero-filled usage object is invented');
});

test('a still-running run without usage is pending, not unavailable', () => {
  const live = { ...RUN, status: 'running', finished_at: null };
  assert.equal(presentRun(live, null).usage_state, 'pending');
});

test('absent code changes are null rather than a zero-filled object', () => {
  assert.equal(presentRun(RUN, USAGE).code_changes, null);
});

test('code changes are parsed, with files defaulting to an empty list', () => {
  const withChanges = { ...RUN, lines_added: 5, lines_removed: 2, files_modified: '["/tmp/a.txt"]' };
  assert.deepEqual(presentRun(withChanges, null).code_changes, {
    lines_added: 5,
    lines_removed: 2,
    files_modified: ['/tmp/a.txt'],
  });
  assert.deepEqual(
    presentRun({ ...withChanges, files_modified: null }, null).code_changes.files_modified,
    [],
  );
});

test('a run recording only removals is still reported', () => {
  assert.ok(presentRun({ ...RUN, lines_removed: 3 }, null).code_changes);
});

test('a missing run presents as null instead of throwing', () => {
  assert.equal(presentRun(null, null), null);
});

test('result text is exposed for the detail view, with no disk path', () => {
  const presented = presentRun({ ...RUN, result_text: 'Paris', result_path: '/r/1.md' }, null);
  assert.equal(presented.result, 'Paris');
  assert.equal('result_path' in presented, false);
});

test('the board view omits the result body but says one exists', () => {
  const agent = presentAgent({ ...RUN, result_text: 'Paris' }, USAGE);
  assert.equal(agent.has_result, true);
  assert.ok(!('result' in agent), 'the tile must not carry a potentially large result');
});

test('a run without a result reports has_result false', () => {
  assert.equal(presentAgent(RUN, null).has_result, false);
});

test('the board view carries a short label for the tile', () => {
  assert.equal(presentAgent(RUN, USAGE).short_label, 'Capital of France');
});

test('a task is presented with a short label alongside its full prompt', () => {
  const task = presentTask({ id: 1, title: 'Long title', prompt: 'Please create a file notes.md' });
  assert.equal(task.short_label, 'Create file notes.md');
  assert.equal(task.prompt, 'Please create a file notes.md', 'the original prompt is preserved');
});
