import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binRuns, findRange, OUTCOME_GROUPS, rangeStart } from '../../src/domain/run-stats.js';

// Local wall-clock times, so the tests hold in any time zone.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const NOW = local(2026, 10, 15, 14, 30).getTime(); // Thu 15 Oct 2026, 14:30
const run = (status, date) => ({ status, finished_at: date.toISOString() });

test('ranges start at the first hour or day they show', () => {
  assert.equal(rangeStart('24h', NOW).getTime(), local(2026, 10, 14, 15).getTime());
  assert.equal(rangeStart('7d', NOW).getTime(), local(2026, 10, 9).getTime());
  assert.equal(rangeStart('30d', NOW).getTime(), local(2026, 9, 16).getTime());
  assert.equal(rangeStart('1y', NOW), null);
  assert.equal(findRange('1y'), null);
});

test('every bin is present, oldest first, empty ones as zero', () => {
  const stats = binRuns([], '7d', NOW);
  assert.equal(stats.bins.length, 7);
  assert.equal(new Date(stats.bins[0].start).getDate(), 9);
  assert.equal(new Date(stats.bins.at(-1).start).getDate(), 15);
  assert.ok(stats.bins.every((b) => b.total === 0));
  assert.equal(stats.successRate, null, 'unknown, not 0%, when nothing finished');
});

test('runs are counted per local day and outcome', () => {
  const stats = binRuns(
    [
      run('succeeded', local(2026, 10, 15, 9)),
      run('succeeded', local(2026, 10, 15, 0, 5)),
      run('failed', local(2026, 10, 14, 23, 59)),
      run('timed_out', local(2026, 10, 14, 8)),
      run('cancelled', local(2026, 10, 13, 8)),
      run('interrupted', local(2026, 10, 13, 9)),
    ],
    '7d',
    NOW,
  );
  const byDay = Object.fromEntries(stats.bins.map((b) => [new Date(b.start).getDate(), b]));
  assert.deepEqual(byDay[15].counts, { succeeded: 2, stopped: 0, timed_out: 0, failed: 0 });
  assert.deepEqual(byDay[14].counts, { succeeded: 0, stopped: 0, timed_out: 1, failed: 1 });
  assert.equal(byDay[13].counts.stopped, 2, 'cancelled and interrupted are both "stopped"');
  assert.deepEqual(stats.totals, { succeeded: 2, stopped: 2, timed_out: 1, failed: 1, total: 6 });
  assert.equal(stats.successRate, 2 / 6);
});

test('the 24-hour range bins by hour', () => {
  const stats = binRuns([run('succeeded', local(2026, 10, 15, 14, 10)), run('failed', local(2026, 10, 15, 13, 59))], '24h', NOW);
  assert.equal(stats.bins.length, 24);
  assert.equal(stats.bins.at(-1).counts.succeeded, 1);
  assert.equal(stats.bins.at(-2).counts.failed, 1);
});

test('runs outside the range, still running or with unknown states are ignored', () => {
  const stats = binRuns(
    [
      run('succeeded', local(2026, 10, 8, 23)),
      run('succeeded', local(2026, 10, 16, 1)),
      { status: 'running', finished_at: null },
      run('mystery', local(2026, 10, 15, 9)),
    ],
    '7d',
    NOW,
  );
  assert.equal(stats.totals.total, 0);
});

test("SQLite's UTC timestamps without a zone are read as UTC", () => {
  const at = local(2026, 10, 15, 9);
  const sqlite = at.toISOString().replace('T', ' ').slice(0, 19);
  assert.equal(binRuns([{ status: 'succeeded', finished_at: sqlite }], '7d', NOW).bins.at(-1).total, 1);
});

test('outcome groups cover every terminal run status exactly once', () => {
  const statuses = OUTCOME_GROUPS.flatMap((g) => g.statuses).sort();
  assert.deepEqual(statuses, ['cancelled', 'failed', 'interrupted', 'succeeded', 'timed_out']);
});
