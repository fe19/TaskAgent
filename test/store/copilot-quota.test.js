import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createQuotaReader, ghCopilotUser, parseQuota } from '../../src/store/copilot-quota.js';

const FAKE_GH = fileURLToPath(new URL('../fixtures/fake-gh.mjs', import.meta.url));

test('the premium allowance is parsed; an account without one is null', () => {
  const quota = parseQuota({
    quota_reset_date: '2026-11-01',
    quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 120, percent_remaining: 40 } },
  });
  assert.deepEqual(quota, {
    unlimited: false,
    entitlement_aic: 300,
    remaining_aic: 120,
    percent_remaining: 40,
    overage_permitted: false,
    reset_date: '2026-11-01',
  });
  assert.equal(parseQuota({ quota_snapshots: {} }), null);
  assert.equal(parseQuota(null), null);
});

test('reads are cached, and a failure is reported instead of a number', async () => {
  let calls = 0;
  let clock = 0;
  const reader = createQuotaReader({
    fetchUser: async () => {
      calls += 1;
      if (calls === 2) throw new Error('offline');
      return { quota_snapshots: { premium_interactions: { entitlement: 10, remaining: 4 } } };
    },
    now: () => clock,
    cacheMs: 1000,
  });
  const [a, b] = await Promise.all([reader.read(), reader.read()]);
  assert.equal(a, b);
  assert.equal(a.remaining_aic, 4);
  assert.equal(calls, 1, 'concurrent reads share one call');

  clock = 1500;
  const failed = await reader.read();
  assert.equal(failed.available, false);
  assert.match(failed.reason, /offline/);
  assert.equal(failed.remaining_aic, undefined);
  assert.equal((await reader.read()).available, false, 'the failure is cached too');
  assert.equal(calls, 2);
});

test('gh is called with the quota endpoint, and its error surfaces', async () => {
  assert.equal((await ghCopilotUser(FAKE_GH)).quota_snapshots.premium_interactions.entitlement, 120000);
  process.env.FAKE_GH_FAIL = '1';
  try {
    await assert.rejects(ghCopilotUser(FAKE_GH), /gh auth login/);
  } finally {
    delete process.env.FAKE_GH_FAIL;
  }
  await assert.rejects(ghCopilotUser('/nonexistent/gh'));
});
