import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollUsage, USAGE_RETRIES } from '../../src/agents/usage-sync.js';

const fast = { delayMs: 0 };

test('usage is returned as soon as the CLI has recorded it', async () => {
  const usage = await pollUsage('abc', { ...fast, read: (id) => ({ session: id }) });
  assert.deepEqual(usage, { session: 'abc' });
});

test('a read that is not ready yet is retried until it is', async () => {
  let calls = 0;
  const usage = await pollUsage('abc', {
    ...fast,
    read: () => (++calls < 3 ? null : { total_tokens: 7 }),
  });
  assert.equal(calls, 3);
  assert.deepEqual(usage, { total_tokens: 7 });
});

test('giving up returns null rather than a zeroed reading', async () => {
  let calls = 0;
  const usage = await pollUsage('abc', { ...fast, read: () => (calls++, null) });
  assert.equal(usage, null, 'no usage must never be reported as no tokens');
  assert.equal(calls, USAGE_RETRIES);
});

test('the retry budget is configurable so tests do not wait on it', async () => {
  let calls = 0;
  await pollUsage('abc', { ...fast, retries: 2, read: () => (calls++, null) });
  assert.equal(calls, 2);
});

test('the session id is what the usage is looked up by', async () => {
  const seen = [];
  await pollUsage('session-42', { ...fast, retries: 1, read: (id) => (seen.push(id), null) });
  assert.deepEqual(seen, ['session-42']);
});
