import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/store/database.js';
import { createLimitsStore } from '../../src/store/assistant-limits.js';

test('the latest limits per assistant are kept, with when they were seen', () => {
  const db = openDatabase(':memory:');
  const limits = createLimitsStore({ db });
  assert.equal(limits.get('claude-code'), null);

  limits.save('claude-code', { status: 'allowed', windows: [{ id: 'five_hour', utilization: 0.1, resets_at: null }] });
  limits.save('claude-code', { status: 'allowed', windows: [{ id: 'five_hour', utilization: 0.2, resets_at: null }] });
  const saved = limits.get('claude-code');
  assert.equal(saved.windows[0].utilization, 0.2, 'a newer reading replaces the old one');
  assert.match(saved.observed_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  db.close();
});
