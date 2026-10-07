import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminate, KILL_GRACE_MS } from '../../src/agents/process.js';

function fakeChild({ throwOn = null } = {}) {
  const signals = [];
  return {
    signals,
    kill(signal) {
      signals.push(signal);
      if (signal === throwOn) throw new Error('ESRCH');
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('a stop asks politely first', () => {
  const child = fakeChild();
  terminate(child, 10_000);
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('a process that ignores SIGTERM is killed after the grace period', async () => {
  const child = fakeChild();
  terminate(child, 1);
  await tick();
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('cancelling stops the escalation', async () => {
  const child = fakeChild();
  terminate(child, 1)();
  await tick();
  assert.deepEqual(child.signals, ['SIGTERM'], 'a process that already exited must not be killed');
});

test('a process that has already gone does not throw', async () => {
  const child = fakeChild({ throwOn: 'SIGTERM' });
  assert.doesNotThrow(() => terminate(child, 1));
  await tick();
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('terminating nothing is harmless', async () => {
  assert.doesNotThrow(() => terminate(undefined, 1)());
  await tick();
});

test('the default grace period leaves room for the CLI to flush its output', () => {
  assert.ok(KILL_GRACE_MS >= 1000);
});
