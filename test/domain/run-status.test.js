import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_STATUSES,
  OUTCOME_WORD,
  TASK_STATUSES,
  finalActivity,
  isFailure,
  isLive,
  isTerminal,
  resolveFinalStatus,
  resultLabel,
  stoppingActivity,
} from '../../src/domain/run-status.js';

test('live and terminal are mutually exclusive', () => {
  for (const status of LIVE_STATUSES) {
    assert.ok(isLive(status));
    assert.ok(!isTerminal(status), `${status} cannot be both live and terminal`);
  }
});

test('everything that is not success reads as a failure', () => {
  assert.ok(!isFailure('succeeded'));
  for (const status of ['failed', 'timed_out', 'cancelled', 'interrupted']) {
    assert.ok(isFailure(status), status);
  }
});

test('a live run is not yet a failure', () => {
  assert.ok(!isFailure('running'));
  assert.ok(!isFailure('starting'));
});

test('every terminal task status has wording for the board', () => {
  for (const status of TASK_STATUSES) {
    if (!isTerminal(status)) continue;
    assert.ok(OUTCOME_WORD[status], `${status} has no outcome word`);
  }
});

test('finalActivity describes how a run ended, or nothing for a live one', () => {
  assert.equal(finalActivity('succeeded'), 'Completed');
  assert.match(finalActivity('timed_out'), /runtime limit/);
  assert.equal(finalActivity('running'), null);
});

test('unknown statuses are handled rather than crashing', () => {
  assert.ok(!isLive('nonsense'));
  assert.ok(!isTerminal('nonsense'));
  assert.equal(finalActivity('nonsense'), null);
});

test('a clean exit succeeds and a non-zero exit fails', () => {
  assert.equal(resolveFinalStatus({ exitCode: 0 }), 'succeeded');
  assert.equal(resolveFinalStatus({ exitCode: 1 }), 'failed');
  assert.equal(resolveFinalStatus({ exitCode: null }), 'failed');
});

test('a deliberate stop outranks the exit code', () => {
  // The CLI handles SIGTERM cleanly and still exits 0, so without this rule a
  // cancelled or timed-out agent would be recorded as a success.
  assert.equal(resolveFinalStatus({ exitCode: 0, stopReason: 'cancelled' }), 'cancelled');
  assert.equal(resolveFinalStatus({ exitCode: 0, stopReason: 'timed_out' }), 'timed_out');
  assert.equal(resolveFinalStatus({ exitCode: 143, stopReason: 'timed_out' }), 'timed_out');
});

test('only a terminal stop reason may become the recorded status', () => {
  assert.equal(resolveFinalStatus({ exitCode: 0, stopReason: 'nonsense' }), 'succeeded');
  assert.equal(resolveFinalStatus({ exitCode: 2, stopReason: 'nonsense' }), 'failed');
});

test('every status resolveFinalStatus can return is terminal', () => {
  for (const stopReason of [null, 'cancelled', 'timed_out']) {
    for (const exitCode of [0, 1]) {
      assert.ok(isTerminal(resolveFinalStatus({ exitCode, stopReason })));
    }
  }
});

test('stoppingActivity distinguishes a timeout from an operator stop', () => {
  assert.match(stoppingActivity('timed_out'), /runtime limit/);
  assert.match(stoppingActivity('cancelled'), /cancelled/i);
});

test('only a succeeded run has a "Result"', () => {
  assert.equal(resultLabel('succeeded'), 'Result');
  assert.equal(resultLabel('running'), 'Result');
  assert.match(resultLabel('timed_out'), /Last message/);
});
