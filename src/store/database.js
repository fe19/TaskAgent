import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_TOOL_IDS } from '../domain/permissions.js';
import { DEFAULT_ASSISTANT } from '../domain/assistants.js';
import { DEFAULT_USD_PER_AIC } from '../domain/settings-schema.js';

/** Schema, default settings and boot-time reconciliation. All SQL lives in store/. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  priority   INTEGER NOT NULL DEFAULT 0,
  held       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id       TEXT NOT NULL,
  assistant        TEXT NOT NULL DEFAULT 'copilot',
  pid              INTEGER,
  workspace_dir    TEXT NOT NULL,
  model            TEXT NOT NULL,
  max_runtime_s    INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'starting',
  current_activity TEXT,
  tool_calls       INTEGER NOT NULL DEFAULT 0,
  exit_code        INTEGER,
  error            TEXT,
  premium_requests REAL,
  lines_added      INTEGER,
  lines_removed    INTEGER,
  files_modified   TEXT,
  result_text      TEXT,
  result_path      TEXT,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at      TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS run_usage (
  run_id             INTEGER PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  model              TEXT,
  api_calls          INTEGER,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens   INTEGER,
  nano_aiu           INTEGER,
  cost_usd           REAL,
  api_duration_ms    INTEGER,
  synced_at          TEXT
);

CREATE TABLE IF NOT EXISTS assistant_limits (
  assistant   TEXT PRIMARY KEY,
  info        TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority DESC, id);
CREATE INDEX IF NOT EXISTS idx_runs_task    ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);
CREATE INDEX IF NOT EXISTS idx_events_run   ON run_events(run_id, id DESC);
`;

export const DEFAULT_SETTINGS = {
  assistant: DEFAULT_ASSISTANT,
  max_concurrent_agents: '2',
  model: 'claude-haiku-4.5',
  max_runtime_minutes: '10',
  reasoning_effort: 'default',
  claude_model: 'sonnet',
  claude_effort: 'default',
  // Off by default: queued tasks wait until the operator presses Start.
  auto_dispatch: 'false',
  usd_per_aic: String(DEFAULT_USD_PER_AIC),
  // Default tools on (web off); core denies (domain/permissions.js) always apply.
  allowed_tools: DEFAULT_TOOL_IDS.join(','),
  denied_commands: '',
  blocked_urls: '',
  secret_env_vars: '',
  // Only the allow-list in domain/environment.js reaches agents unless named here.
  passed_env_vars: '',
};

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // Added after release: a task paused from Working stays queued (held) until started by hand.
  addColumn(db, 'tasks', 'held', 'INTEGER NOT NULL DEFAULT 0');
  // Added with Claude Code: runs from before ran on Copilot, which never reports a dollar cost.
  addColumn(db, 'runs', 'assistant', "TEXT NOT NULL DEFAULT 'copilot'");
  addColumn(db, 'run_usage', 'cost_usd', 'REAL');

  const seed = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
  );
  // Legacy `max_runtime_seconds` → minutes, rounded up and clamped to 1–1000.
  db.exec(`INSERT OR IGNORE INTO settings (key, value)
             SELECT 'max_runtime_minutes', MIN(1000, MAX(1, (CAST(value AS INTEGER) + 59) / 60))
               FROM settings WHERE key = 'max_runtime_seconds';
           DELETE FROM settings WHERE key = 'max_runtime_seconds';`);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) seed.run(key, value);

  return db;
}

function addColumn(db, table, column, definition) {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Marks runs from a previous process as interrupted and requeues their tasks. */
export function reconcileOrphanedRuns(db) {
  const orphans = db
    .prepare("SELECT id, task_id FROM runs WHERE status IN ('starting','running')")
    .all();
  if (orphans.length === 0) return 0;

  const markInterrupted = db.prepare(
    `UPDATE runs SET status = 'interrupted',
                     error = 'Server restarted while this agent was running',
                     finished_at = datetime('now')
      WHERE id = ?`,
  );
  const requeue = db.prepare(
    `UPDATE tasks SET status = 'queued', updated_at = datetime('now')
      WHERE id = ? AND status = 'running'`,
  );

  for (const orphan of orphans) {
    markInterrupted.run(orphan.id);
    requeue.run(orphan.task_id);
  }
  return orphans.length;
}
