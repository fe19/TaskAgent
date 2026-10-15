import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createLimitsRefresher, probeArgs, readClaudeLimits } from '../../src/agents/claude-limits-probe.js';

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));

test('the probe is the smallest call: Haiku, no tools, nothing saved, prompt last', () => {
  const args = probeArgs();
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'haiku']);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(args.at(-2), '--');
});

test('the probe resolves the limits the CLI reports', async () => {
  const limits = await readClaudeLimits({ bin: FAKE_CLAUDE });
  assert.deepEqual(limits.windows.map((w) => [w.id, w.utilization]), [['five_hour', 0.25], ['seven_day', 0.6]]);
});

test('a CLI that reports no limits is an error, not a reading', async () => {
  await assert.rejects(readClaudeLimits({ bin: '/nonexistent/claude' }), /not installed or not on PATH/);
});

test('refreshes are throttled and concurrent callers share one call', async () => {
  let calls = 0;
  let saved = null;
  let clock = 0;
  const refresher = createLimitsRefresher({
    read: async () => {
      calls += 1;
      return { status: 'allowed', windows: [] };
    },
    save: (l) => {
      saved = l;
    },
    now: () => clock,
    minIntervalMs: 60_000,
  });

  const [a, b] = await Promise.all([refresher.refresh(), refresher.refresh()]);
  assert.deepEqual([a, b], [{ refreshed: true }, { refreshed: true }]);
  assert.equal(calls, 1, 'two tabs loading at once cost one call');
  assert.ok(saved);

  clock = 30_000;
  assert.deepEqual(await refresher.refresh(), { refreshed: false });
  assert.equal(calls, 1, 'a reload within a minute reuses the reading');

  clock = 61_000;
  await refresher.refresh();
  assert.equal(calls, 2);
});

test('a failed refresh reports why and keeps the last reading', async () => {
  let saved = 'untouched';
  const refresher = createLimitsRefresher({
    read: async () => {
      throw new Error('not signed in');
    },
    save: (l) => {
      saved = l;
    },
  });
  assert.deepEqual(await refresher.refresh(), { refreshed: false, error: 'not signed in' });
  assert.equal(saved, 'untouched');
});
