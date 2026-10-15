/**
 * When a task runs: once at `run_at`, or from `run_at` on, repeating. Times are stored in UTC
 * and repeated in the server's local time, so "daily 07:00" stays 07:00 across DST. Pure.
 */

export const REPEATS = [
  { id: 'hourly', label: 'Every hour' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { id: 'weekly', label: 'Every week' },
];
export const REPEAT_IDS = REPEATS.map((r) => r.id);

/** A start this far in the past is a typo, not "now". */
const PAST_TOLERANCE_MS = 60_000;

/**
 * Normalizes `{ run_at, repeat }` from a request. Returns `{ runAt, repeat }` (both null when
 * unscheduled) or `{ error }`.
 */
export function validateSchedule({ run_at: runAt = null, repeat = null } = {}, now = Date.now()) {
  const rule = repeat === '' || repeat === 'none' ? null : repeat;
  if (rule != null && !REPEAT_IDS.includes(rule)) {
    return { error: `repeat must be one of: none, ${REPEAT_IDS.join(', ')}` };
  }
  if (runAt == null || runAt === '') {
    if (rule) return { error: 'A repeating task needs a first start time (run_at)' };
    return { runAt: null, repeat: null };
  }
  const at = Date.parse(runAt);
  if (Number.isNaN(at)) return { error: 'run_at must be a date and time' };
  if (at < now - PAST_TOLERANCE_MS) return { error: 'run_at is in the past' };
  return { runAt: new Date(at).toISOString(), repeat: rule };
}

const HOUR_MS = 3_600_000;

/** One day or week later at the same local wall-clock time (so DST does not shift it). */
function step(date, repeat) {
  const d = new Date(date);
  d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1));
  // Weekdays: Saturday and Sunday are skipped.
  if (repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * The first occurrence of `repeat`, counted from the occurrence `anchor`, that is later than
 * `after`. Missed occurrences collapse: a server that was off for a week runs once, then
 * continues on schedule.
 */
export function nextOccurrence(repeat, anchor, after = Date.now()) {
  if (!REPEAT_IDS.includes(repeat)) return null;
  const start = Date.parse(anchor);
  const limit = typeof after === 'number' ? after : Date.parse(after);
  if (Number.isNaN(start) || Number.isNaN(limit)) return null;

  // Hourly is a fixed interval: jump straight past `after`.
  if (repeat === 'hourly') {
    const hours = start > limit ? 0 : Math.floor((limit - start) / HOUR_MS) + 1;
    return new Date(start + hours * HOUR_MS).toISOString();
  }
  // Days and weeks follow the calendar; even years of downtime are a few hundred steps.
  let d = new Date(start);
  while (d.getTime() <= limit) d = step(d, repeat);
  return d.toISOString();
}

export function repeatLabel(repeat) {
  return REPEATS.find((r) => r.id === repeat)?.label ?? null;
}

/** Whether a queued task waits for its start time rather than for a free slot. */
export function isWaitingForTime(task, now = Date.now()) {
  return task?.status === 'queued' && task.run_at != null && Date.parse(task.run_at) > now;
}
