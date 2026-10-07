import { TASK_STATUSES } from '../domain/run-status.js';
import { badRequest } from '../errors.js';

const MAX_PROMPT_CHARS = 10000;
const MAX_TITLE_CHARS = 80;

/** First prompt line, used as the tooltip. */
function deriveTitle(prompt) {
  const firstLine = prompt.trim().split('\n')[0].trim();
  return firstLine.length > MAX_TITLE_CHARS
    ? `${firstLine.slice(0, MAX_TITLE_CHARS - 3)}...`
    : firstLine;
}

export function createTaskStore({ db }) {
  const statements = {
    insert: db.prepare('INSERT INTO tasks (title, prompt, priority) VALUES (?, ?, ?)'),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    list: db.prepare(
      `SELECT t.*,
              (SELECT r.id FROM runs r WHERE r.task_id = t.id ORDER BY r.id DESC LIMIT 1)
                AS latest_run_id
         FROM tasks t
        ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                 t.priority DESC, t.id ASC`,
    ),
    setStatus: db.prepare(
      "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
    ),
    remove: db.prepare('DELETE FROM tasks WHERE id = ?'),
    // Guarded on status, so an edit can never race the scheduler's claim.
    editQueued: db.prepare(
      `UPDATE tasks SET title = ?, prompt = ?, priority = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'queued' RETURNING *`,
    ),
    hold: db.prepare(
      "UPDATE tasks SET status = 'queued', held = 1, updated_at = datetime('now') WHERE id = ?",
    ),
    requeue: db.prepare(
      "UPDATE tasks SET status = 'queued', held = 0, updated_at = datetime('now') WHERE id = ?",
    ),
    release: db.prepare(
      "UPDATE tasks SET held = 0, updated_at = datetime('now') WHERE id = ? AND status = 'queued'",
    ),
    countQueued: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'queued'"),
    // A single statement, so two scheduler passes can never claim one task.
    claimNext: db.prepare(
      `UPDATE tasks SET status = 'running', updated_at = datetime('now')
        WHERE id = (SELECT id FROM tasks WHERE status = 'queued' AND held = 0
                     ORDER BY priority DESC, id ASC LIMIT 1)
        RETURNING *`,
    ),
    claim: db.prepare(
      `UPDATE tasks SET status = 'running', held = 0, updated_at = datetime('now')
        WHERE id = ? AND status = 'queued' RETURNING *`,
    ),
  };

  function get(id) {
    return statements.get.get(id) ?? null;
  }

  function validate({ prompt, title, priority = 0 }) {
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (text.length === 0) throw badRequest('prompt is required');
    if (text.length > MAX_PROMPT_CHARS) {
      throw badRequest(`prompt must be ${MAX_PROMPT_CHARS} characters or fewer`);
    }

    const p = Number(priority);
    if (!Number.isInteger(p) || p < 0 || p > 9) {
      throw badRequest('priority must be a whole number between 0 and 9');
    }

    const finalTitle = (typeof title === 'string' && title.trim()) || deriveTitle(text);
    return [finalTitle, text, p];
  }

  function create(input) {
    const { lastInsertRowid } = statements.insert.run(...validate(input));
    return get(Number(lastInsertRowid));
  }

  /** Rewrites a queued task; null once it has left the queue. */
  function editQueued(id, input) {
    return statements.editQueued.get(...validate(input), id) ?? null;
  }

  function setStatus(id, status) {
    if (!TASK_STATUSES.includes(status)) throw new Error(`Invalid task status: ${status}`);
    statements.setStatus.run(status, id);
    return get(id);
  }

  function remove(id) {
    const task = get(id);
    if (!task) return { deleted: false, reason: 'not_found' };
    if (task.status === 'running') return { deleted: false, reason: 'running' };
    statements.remove.run(id);
    return { deleted: true };
  }

  return {
    create,
    editQueued,
    get,
    list: () => statements.list.all(),
    setStatus,
    remove,
    /** Queues a task for the scheduler to pick up. */
    requeue: (id) => (statements.requeue.run(id), get(id)),
    /** Queues a task that the scheduler skips until `release`. */
    hold: (id) => (statements.hold.run(id), get(id)),
    release: (id) => (statements.release.run(id), get(id)),
    /** Atomically moves the highest-priority queued, unheld task to `running`. */
    claimNext: () => statements.claimNext.get() ?? null,
    /** Claims one specific queued task, held or not. */
    claim: (id) => statements.claim.get(id) ?? null,
    countQueued: () => statements.countQueued.get().n,
  };
}
