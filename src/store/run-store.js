import { finalActivity } from '../domain/run-status.js';

/** How many runs the overview shows. The board is a live view, not an archive. */
const RECENT_LIMIT = 50;
const EVENT_LIMIT = 100;

/** Run rows, activity events and mirrored token usage. */
export function createRunStore({ db }) {
  const statements = {
    insert: db.prepare(
      `INSERT INTO runs (task_id, session_id, workspace_dir, model, max_runtime_s,
                         status, current_activity)
       VALUES (?, ?, ?, ?, ?, 'starting', 'Launching agent')`,
    ),
    markRunning: db.prepare("UPDATE runs SET pid = ?, status = 'running' WHERE id = ?"),
    setActivity: db.prepare('UPDATE runs SET current_activity = ? WHERE id = ?'),
    setToolCalls: db.prepare('UPDATE runs SET tool_calls = ? WHERE id = ?'),
    recordCliResult: db.prepare(
      `UPDATE runs SET premium_requests = ?, lines_added = ?, lines_removed = ?,
                       files_modified = ?
        WHERE id = ?`,
    ),
    saveResult: db.prepare('UPDATE runs SET result_text = ? WHERE id = ?'),
    finish: db.prepare(
      `UPDATE runs SET status = ?, error = ?, exit_code = ?, finished_at = datetime('now'),
                       current_activity = COALESCE(?, current_activity)
        WHERE id = ?`,
    ),
    get: db.prepare(
      `SELECT r.*, t.title AS task_title, t.prompt AS task_prompt
         FROM runs r JOIN tasks t ON t.id = r.task_id
        WHERE r.id = ?`,
    ),
    getResult: db.prepare(
      `SELECT r.id, r.status, r.model, r.finished_at, r.workspace_dir, r.session_id,
              r.result_text, t.title AS task_title, t.prompt AS task_prompt
         FROM runs r JOIN tasks t ON t.id = r.task_id
        WHERE r.id = ?`,
    ),
    liveForTask: db.prepare(
      `SELECT id FROM runs WHERE task_id = ? AND finished_at IS NULL
        ORDER BY id DESC LIMIT 1`,
    ),
    // Live runs first, then newest finished — the board reads top to bottom.
    listRecent: db.prepare(
      `SELECT r.*, t.title AS task_title, t.prompt AS task_prompt
         FROM runs r JOIN tasks t ON t.id = r.task_id
        ORDER BY CASE WHEN r.finished_at IS NULL THEN 0 ELSE 1 END, r.id DESC
        LIMIT ?`,
    ),
    appendEvent: db.prepare(
      'INSERT INTO run_events (run_id, ts, kind, summary) VALUES (?, ?, ?, ?)',
    ),
    listEvents: db.prepare(
      `SELECT ts, kind, summary FROM run_events WHERE run_id = ?
        ORDER BY id DESC LIMIT ?`,
    ),
    getUsage: db.prepare('SELECT * FROM run_usage WHERE run_id = ?'),
    saveUsage: db.prepare(
      `INSERT INTO run_usage (run_id, model, api_calls, input_tokens, output_tokens,
                              cache_read_tokens, cache_write_tokens, reasoning_tokens,
                              nano_aiu, api_duration_ms, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(run_id) DO UPDATE SET
         model = excluded.model, api_calls = excluded.api_calls,
         input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
         cache_read_tokens = excluded.cache_read_tokens,
         cache_write_tokens = excluded.cache_write_tokens,
         reasoning_tokens = excluded.reasoning_tokens,
         nano_aiu = excluded.nano_aiu, api_duration_ms = excluded.api_duration_ms,
         synced_at = datetime('now')`,
    ),
  };

  return {
    create({ taskId, sessionId, workspaceDir, model, maxRuntimeSeconds }) {
      const { lastInsertRowid } = statements.insert.run(
        taskId,
        sessionId,
        workspaceDir,
        model,
        maxRuntimeSeconds,
      );
      return Number(lastInsertRowid);
    },

    markRunning: (runId, pid) => statements.markRunning.run(pid ?? null, runId),
    setActivity: (runId, text) => statements.setActivity.run(text, runId),
    setToolCalls: (runId, count) => statements.setToolCalls.run(count, runId),

    recordCliResult(runId, { premiumRequests, linesAdded, linesRemoved, filesModified }) {
      statements.recordCliResult.run(
        premiumRequests ?? null,
        linesAdded ?? null,
        linesRemoved ?? null,
        filesModified ? JSON.stringify(filesModified) : null,
        runId,
      );
    },

    saveResult: (runId, text) => statements.saveResult.run(text, runId),

    finish(runId, { status, error = null, exitCode = null }) {
      statements.finish.run(status, error, exitCode, finalActivity(status), runId);
    },

    get: (id) => statements.get.get(id) ?? null,
    getResult: (id) => statements.getResult.get(id) ?? null,
    liveRunIdForTask: (taskId) => statements.liveForTask.get(taskId)?.id ?? null,
    listRecent: (limit = RECENT_LIMIT) => statements.listRecent.all(limit),

    appendEvent(runId, { ts, kind, summary }) {
      statements.appendEvent.run(runId, ts ?? new Date().toISOString(), kind, summary);
    },

    /** Oldest first, so the timeline reads top to bottom. */
    listEvents: (runId, limit = EVENT_LIMIT) => statements.listEvents.all(runId, limit).reverse(),

    getUsage: (runId) => statements.getUsage.get(runId) ?? null,

    saveUsage(runId, usage) {
      if (!usage) return false;
      // A field the Copilot store did not report stays NULL; it never becomes 0.
      const value = (key) => usage[key] ?? null;
      statements.saveUsage.run(
        runId,
        value('model'),
        value('api_calls'),
        value('input_tokens'),
        value('output_tokens'),
        value('cache_read_tokens'),
        value('cache_write_tokens'),
        value('reasoning_tokens'),
        value('nano_aiu'),
        value('api_duration_ms'),
      );
      return true;
    },
  };
}
