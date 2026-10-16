import { TASK_STATUSES } from '../domain/run-status.js';
import { nextOccurrence, validateSchedule } from '../domain/schedule.js';
import { mergeSites, siteOf } from '../domain/web-access.js';
import { parseList } from '../domain/permissions.js';
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

// A one-off schedule is used up once the task starts; a repeating one keeps its anchor.
const START = `status = 'running', run_at = CASE WHEN repeat IS NULL THEN NULL ELSE run_at END,
               updated_at = datetime('now')`;
// ISO timestamps in UTC compare correctly as text.
const DUE = '(run_at IS NULL OR run_at <= ?)';

export function createTaskStore({ db, now = () => Date.now() }) {
  const statements = {
    insert: db.prepare('INSERT INTO tasks (title, prompt, priority, run_at, repeat, allowed_sites) VALUES (?, ?, ?, ?, ?, ?)'),
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
      `UPDATE tasks SET title = ?, prompt = ?, priority = ?, run_at = ?, repeat = ?, allowed_sites = ?,
                        updated_at = datetime('now')
        WHERE id = ? AND status = 'queued' RETURNING *`,
    ),
    setSites: db.prepare("UPDATE tasks SET allowed_sites = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"),
    hold: db.prepare(
      "UPDATE tasks SET status = 'queued', held = 1, run_at = ?, updated_at = datetime('now') WHERE id = ?",
    ),
    requeue: db.prepare(
      "UPDATE tasks SET status = 'queued', held = 0, run_at = ?, updated_at = datetime('now') WHERE id = ?",
    ),
    release: db.prepare(
      "UPDATE tasks SET held = 0, updated_at = datetime('now') WHERE id = ? AND status = 'queued'",
    ),
    countQueued: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'queued'"),
    // A single statement, so two scheduler passes can never claim one task. A task waiting
    // for its start time is skipped; once due, it goes first.
    claimNext: db.prepare(
      `UPDATE tasks SET ${START}
        WHERE id = (SELECT id FROM tasks WHERE status = 'queued' AND held = 0 AND ${DUE}
                     ORDER BY run_at IS NULL, priority DESC, id ASC LIMIT 1)
        RETURNING *`,
    ),
    // Starting by hand works before the start time too.
    claim: db.prepare(
      `UPDATE tasks SET ${START}, held = 0
        WHERE id = ? AND status = 'queued' RETURNING *`,
    ),
    listDue: db.prepare(
      `SELECT * FROM tasks
        WHERE status = 'queued' AND held = 0 AND run_at IS NOT NULL AND run_at <= ?
        ORDER BY run_at, priority DESC, id`,
    ),
    reschedule: db.prepare(
      `UPDATE tasks SET status = 'queued', held = 0, run_at = ?, updated_at = datetime('now')
        WHERE id = ? RETURNING *`,
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

  /** `current`: an unchanged start time may already have passed (due, waiting for a slot). */
  function validateWhen(input, current = null) {
    const unchanged = current?.run_at != null && Date.parse(input.run_at) === Date.parse(current.run_at);
    const schedule = validateSchedule(input, unchanged ? Date.parse(current.run_at) : now());
    if (schedule.error) throw badRequest(schedule.error);
    return [schedule.runAt, schedule.repeat];
  }

  /**
   * Where a task back in the queue starts: a repeating one at its next occurrence, a one-off
   * whose time has passed as soon as it is started (Auto) or by hand (Manual).
   */
  function startTimeOnRequeue(id) {
    const task = get(id);
    if (!task?.run_at) return null;
    if (task.repeat) return nextOccurrence(task.repeat, task.run_at, now());
    return Date.parse(task.run_at) > now() ? task.run_at : null;
  }

  /** Sites allowed for this task only, as stored text. Missing input keeps `current`. */
  function validateSites(input, current = '') {
    if (input.allowed_sites === undefined) return current;
    const invalid = parseList(input.allowed_sites).filter((entry) => !siteOf(entry));
    if (invalid.length > 0) throw badRequest(`allowed_sites contains invalid websites: ${invalid.join(', ')}`);
    return mergeSites(parseList(input.allowed_sites)).join(',');
  }

  function create(input) {
    const { lastInsertRowid } = statements.insert.run(...validate(input), ...validateWhen(input), validateSites(input));
    return get(Number(lastInsertRowid));
  }

  /** Rewrites a queued task; null once it has left the queue. */
  function editQueued(id, input) {
    const current = get(id);
    return (
      statements.editQueued.get(...validate(input), ...validateWhen(input, current), validateSites(input, current?.allowed_sites), id) ??
      null
    );
  }

  /** Adds sites this task may reach, in any state (e.g. before a retry). */
  function allowSites(id, sites) {
    const current = get(id);
    if (!current) return null;
    const added = validateSites({ allowed_sites: parseList(sites) });
    return statements.setSites.get(mergeSites(parseList(current.allowed_sites), parseList(added)).join(','), id);
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
    requeue: (id) => (statements.requeue.run(startTimeOnRequeue(id), id), get(id)),
    /** Queues a task that the scheduler skips until `release`. */
    hold: (id) => (statements.hold.run(startTimeOnRequeue(id), id), get(id)),
    release: (id) => (statements.release.run(id), get(id)),
    /** Atomically moves the next due, unheld queued task to `running`. */
    claimNext: () => statements.claimNext.get(new Date(now()).toISOString()) ?? null,
    /** Claims one specific queued task, held or not. */
    claim: (id) => statements.claim.get(id) ?? null,
    countQueued: () => statements.countQueued.get().n,
    /** Queued tasks whose start time has come, earliest first. */
    listDue: () => statements.listDue.all(new Date(now()).toISOString()),
    /** Back to the queue, waiting for `runAt`. */
    reschedule: (id, runAt) => statements.reschedule.get(runAt, id) ?? null,
    allowSites,
  };
}
