import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWaitingForTime, nextOccurrence, repeatLabel, validateSchedule } from '../../src/domain/schedule.js';

// Local wall-clock times, so the tests hold in any time zone.
const local = (y, m, d, h = 7, min = 0) => new Date(y, m - 1, d, h, min);
const NOW = local(2026, 10, 15, 12).getTime(); // Thu 15 Oct 2026, 12:00

test('no start time and no repeat is an ordinary queued task', () => {
  assert.deepEqual(validateSchedule({}, NOW), { runAt: null, repeat: null });
  assert.deepEqual(validateSchedule({ run_at: '', repeat: 'none' }, NOW), { runAt: null, repeat: null });
});

test('a start time is normalized to UTC ISO', () => {
  const at = local(2026, 10, 15, 23);
  assert.deepEqual(validateSchedule({ run_at: at.toISOString() }, NOW), { runAt: at.toISOString(), repeat: null });
});

test('bad schedules are explained', () => {
  assert.match(validateSchedule({ run_at: 'tomorrow' }, NOW).error, /date and time/);
  assert.match(validateSchedule({ run_at: local(2026, 10, 14).toISOString() }, NOW).error, /in the past/);
  assert.match(validateSchedule({ repeat: 'daily' }, NOW).error, /first start time/);
  assert.match(validateSchedule({ run_at: local(2026, 10, 16).toISOString(), repeat: 'monthly' }, NOW).error, /repeat must be/);
});

test('a start just now (within a minute) is accepted, not rejected as past', () => {
  assert.ok(validateSchedule({ run_at: new Date(NOW - 30_000).toISOString() }, NOW).runAt);
});

test('daily repeats at the same local time', () => {
  const next = new Date(nextOccurrence('daily', local(2026, 10, 15, 7), NOW));
  assert.deepEqual([next.getDate(), next.getHours(), next.getMinutes()], [16, 7, 0]);
});

test('daily keeps its wall-clock time across a DST change', () => {
  // Across the last Sunday of October (end of summer time in Europe, a no-op elsewhere).
  const next = new Date(nextOccurrence('daily', local(2026, 10, 24, 7, 30), local(2026, 10, 24, 8).getTime()));
  assert.deepEqual([next.getDate(), next.getHours(), next.getMinutes()], [25, 7, 30]);
});

test('weekdays skip Saturday and Sunday', () => {
  // Friday 16 Oct 07:00 → Monday 19 Oct 07:00.
  const next = new Date(nextOccurrence('weekdays', local(2026, 10, 16, 7), local(2026, 10, 16, 8).getTime()));
  assert.deepEqual([next.getDay(), next.getDate(), next.getHours()], [1, 19, 7]);
});

test('weekly keeps the weekday', () => {
  const next = new Date(nextOccurrence('weekly', local(2026, 10, 15, 7), NOW));
  assert.deepEqual([next.getDay(), next.getDate()], [4, 22]);
});

test('hourly keeps the minute', () => {
  const next = new Date(nextOccurrence('hourly', local(2026, 10, 15, 9, 15), NOW));
  assert.deepEqual([next.getHours(), next.getMinutes()], [12, 15]);
});

test('occurrences missed while the server was off collapse into the next one', () => {
  // Anchored a month ago: the next run is tomorrow, not thirty catch-up runs.
  const next = new Date(nextOccurrence('daily', local(2026, 9, 15, 7), NOW));
  assert.deepEqual([next.getMonth() + 1, next.getDate(), next.getHours()], [10, 16, 7]);
  const hourly = new Date(nextOccurrence('hourly', local(2025, 10, 15, 9, 15), NOW));
  assert.deepEqual([hourly.getFullYear(), hourly.getHours(), hourly.getMinutes()], [2026, 12, 15]);
});

test('an anchor still in the future is the next occurrence itself', () => {
  const at = local(2026, 10, 15, 18);
  assert.equal(nextOccurrence('daily', at, NOW), at.toISOString());
});

test('unknown repeats and dates give no occurrence', () => {
  assert.equal(nextOccurrence('monthly', local(2026, 10, 15), NOW), null);
  assert.equal(nextOccurrence('daily', 'not a date', NOW), null);
});

test('only a queued task with a future start is waiting for its time', () => {
  const future = local(2026, 10, 15, 13).toISOString();
  assert.equal(isWaitingForTime({ status: 'queued', run_at: future }, NOW), true);
  assert.equal(isWaitingForTime({ status: 'queued', run_at: local(2026, 10, 15, 11).toISOString() }, NOW), false);
  assert.equal(isWaitingForTime({ status: 'running', run_at: future }, NOW), false);
  assert.equal(isWaitingForTime({ status: 'queued', run_at: null }, NOW), false);
  assert.equal(repeatLabel('weekdays'), 'Every weekday (Mon–Fri)');
});
