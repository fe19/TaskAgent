import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readCopilotUsage, nanoAiuToAiu, defaultStorePath } from '../../src/store/copilot-usage.js';
import { tempDir, removeDir } from '../helpers.js';

/** Mimics the real Copilot CLI session store closely enough to join on. */
function fakeStore(rows) {
  const dir = tempDir('acr-usage-');
  const path = join(dir, 'session-store.db');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE assistant_usage_events (
    session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
    total_nano_aiu INTEGER, duration_ms INTEGER)`);
  const insert = db.prepare(
    'INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const r of rows) {
    insert.run(
      r.session_id,
      r.model ?? 'claude-haiku-4.5',
      r.input_tokens ?? 0,
      r.output_tokens ?? 0,
      r.cache_read_tokens ?? 0,
      r.cache_write_tokens ?? 0,
      r.reasoning_tokens ?? 0,
      r.total_nano_aiu ?? 0,
      r.duration_ms ?? 0,
    );
  }
  db.close();
  return { path, cleanup: () => removeDir(dir) };
}

test('usage for a session is summed across every API call', () => {
  const { path, cleanup } = fakeStore([
    { session_id: 'run-a', input_tokens: 100, output_tokens: 10, total_nano_aiu: 1e9, duration_ms: 500 },
    { session_id: 'run-a', input_tokens: 250, output_tokens: 20, total_nano_aiu: 5e8, duration_ms: 700 },
    { session_id: 'other', input_tokens: 999, output_tokens: 99, total_nano_aiu: 9e9 },
  ]);

  const usage = readCopilotUsage('run-a', path);
  assert.equal(usage.api_calls, 2);
  assert.equal(usage.input_tokens, 350);
  assert.equal(usage.output_tokens, 30);
  assert.equal(usage.nano_aiu, 1.5e9);
  assert.equal(usage.api_duration_ms, 1200);
  cleanup();
});

test('a session with no rows is unavailable, never zero', () => {
  const { path, cleanup } = fakeStore([{ session_id: 'someone-else' }]);
  assert.equal(readCopilotUsage('run-a', path), null);
  cleanup();
});

test('a missing session id or missing store returns null instead of throwing', () => {
  const { path, cleanup } = fakeStore([{ session_id: 'run-a' }]);
  assert.equal(readCopilotUsage('', path), null);
  assert.equal(readCopilotUsage(null, path), null);
  assert.equal(readCopilotUsage('run-a', '/no/such/store.db'), null);
  cleanup();
});

test('an unreadable or foreign database is tolerated', () => {
  const dir = tempDir('acr-usage-bad-');
  const path = join(dir, 'session-store.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE something_else (id INTEGER)');
  db.close();
  assert.equal(readCopilotUsage('run-a', path), null);
  removeDir(dir);
});

test('every model that served the run is listed', () => {
  const { path, cleanup } = fakeStore([
    { session_id: 'run-a', model: 'claude-haiku-4.5', input_tokens: 1 },
    { session_id: 'run-a', model: 'gpt-5.4', input_tokens: 1 },
    { session_id: 'run-a', model: 'claude-haiku-4.5', input_tokens: 1 },
  ]);
  const usage = readCopilotUsage('run-a', path);
  assert.equal(usage.model, 'claude-haiku-4.5, gpt-5.4', 'most used model comes first');
  cleanup();
});

test('nano-AIU converts at 1e9, and null stays null', () => {
  assert.equal(nanoAiuToAiu(2_500_000_000), 2.5);
  assert.equal(nanoAiuToAiu(0), 0);
  assert.equal(nanoAiuToAiu(null), null);
  assert.equal(nanoAiuToAiu(undefined), null);
});

test('the store path follows COPILOT_HOME when set', () => {
  const previous = process.env.COPILOT_HOME;
  const home = '/nonexistent/copilot-home';
  process.env.COPILOT_HOME = home;
  assert.equal(defaultStorePath(), join(home, 'session-store.db'));
  if (previous === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = previous;
});
