import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, reconcileOrphanedRuns, DEFAULT_SETTINGS } from '../../src/store/database.js';
import { createStores } from '../helpers.js';

test('a fresh database is seeded with every default setting', () => {
  const db = openDatabase(':memory:');
  const rows = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]),
  );
  assert.deepEqual(rows, DEFAULT_SETTINGS);
  db.close();
});

test('dispatch is off by default so nothing starts unasked', () => {
  assert.equal(DEFAULT_SETTINGS.auto_dispatch, 'false');
});

test('re-opening does not overwrite changed settings', () => {
  const db = openDatabase(':memory:');
  db.prepare("UPDATE settings SET value = '7' WHERE key = 'max_concurrent_agents'").run();
  // The seed uses ON CONFLICT DO NOTHING, so a second boot must not reset it.
  const seed = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) seed.run(k, v);
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_agents'").get().value,
    '7',
  );
  db.close();
});

test('deleting a task cascades to its runs, events and usage', () => {
  const { db, tasks, runs, close } = createStores();
  const task = tasks.create({ prompt: 'cascade me' });
  const runId = runs.create({
    taskId: task.id,
    sessionId: 's1',
    workspaceDir: '/tmp/x',
    model: 'm',
    maxRuntimeSeconds: 10,
  });
  runs.appendEvent(runId, { kind: 'start', summary: 'hello' });
  runs.saveUsage(runId, { api_calls: 1, input_tokens: 1, nano_aiu: 1 });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM run_events').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM run_usage').get().n, 0);
  close();
});

test('runs left behind by a dead process are marked interrupted and requeued', () => {
  const { db, tasks, runs, close } = createStores();
  const task = tasks.create({ prompt: 'orphan me' });
  tasks.setStatus(task.id, 'running');
  const runId = runs.create({
    taskId: task.id,
    sessionId: 's1',
    workspaceDir: '/tmp/x',
    model: 'm',
    maxRuntimeSeconds: 10,
  });
  runs.markRunning(runId, 1234);

  assert.equal(reconcileOrphanedRuns(db), 1);

  const run = runs.get(runId);
  assert.equal(run.status, 'interrupted');
  assert.match(run.error, /Server restarted/);
  assert.ok(run.finished_at, 'an interrupted run must not look live');
  assert.equal(tasks.get(task.id).status, 'queued');
  close();
});

test('reconciliation leaves finished runs and their tasks alone', () => {
  const { db, tasks, runs, close } = createStores();
  const task = tasks.create({ prompt: 'already done' });
  tasks.setStatus(task.id, 'succeeded');
  const runId = runs.create({
    taskId: task.id,
    sessionId: 's1',
    workspaceDir: '/tmp/x',
    model: 'm',
    maxRuntimeSeconds: 10,
  });
  runs.finish(runId, { status: 'succeeded', exitCode: 0 });

  assert.equal(reconcileOrphanedRuns(db), 0);
  assert.equal(tasks.get(task.id).status, 'succeeded');
  close();
});

test('a legacy runtime in seconds is converted to whole minutes', async () => {
  const { tempDir, removeDir } = await import('../helpers.js');
  const dir = tempDir('acr-db-');
  const file = `${dir}/db.db`;
  openDatabase(file).close();
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec("DELETE FROM settings WHERE key = 'max_runtime_minutes'");
  raw.exec("INSERT INTO settings VALUES ('max_runtime_seconds', '300')");
  raw.close();

  const db = openDatabase(file);
  const keys = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  assert.equal(keys.max_runtime_minutes, '5');
  assert.equal('max_runtime_seconds' in keys, false);
  db.close();
  removeDir(dir);
});

test('an older tasks table gains the held column', async () => {
  const { tempDir, removeDir } = await import('../helpers.js');
  const dir = tempDir('acr-db-');
  const file = `${dir}/db.db`;
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, prompt TEXT, status TEXT DEFAULT 'queued', priority INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)");
  raw.exec("INSERT INTO tasks (title, prompt) VALUES ('t', 'p')");
  raw.close();

  const db = openDatabase(file);
  assert.equal(db.prepare('SELECT held FROM tasks').get().held, 0);
  db.close();
  removeDir(dir);
});
