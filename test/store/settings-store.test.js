import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStores } from '../helpers.js';

test('reading returns typed values, not raw strings', () => {
  const { settings, close } = createStores();
  const s = settings.read();
  assert.equal(typeof s.max_concurrent_agents, 'number');
  assert.equal(typeof s.auto_dispatch, 'boolean');
  assert.ok(Array.isArray(s.allowed_tools));
  close();
});

test('an update is persisted and echoed back', () => {
  const { settings, close } = createStores();
  const updated = settings.update({ max_concurrent_agents: 5 });
  assert.equal(updated.max_concurrent_agents, 5);
  assert.equal(settings.read().max_concurrent_agents, 5);
  close();
});

test('a patch is atomic: one bad field writes nothing', () => {
  const { settings, close } = createStores();
  const before = settings.read();
  assert.throws(
    () => settings.update({ max_concurrent_agents: 4, model: 'nonsense' }),
    (err) => err.status === 400,
  );
  assert.equal(settings.read().max_concurrent_agents, before.max_concurrent_agents);
  close();
});

test('every error in a patch is reported together', () => {
  const { settings, close } = createStores();
  assert.throws(
    () => settings.update({ max_concurrent_agents: 0, max_runtime_minutes: 0 }),
    (err) => err.message.split(';').length === 2,
  );
  close();
});

test('the workspace root is resolved through the injected resolver', () => {
  const calls = [];
  const { settings, close } = createStores({
    resolvePath: (v) => {
      calls.push(v);
      return '/resolved/path';
    },
  });
  assert.equal(settings.update({ workspace_root: '~/agents' }).workspace_root, '/resolved/path');
  assert.deepEqual(calls, ['~/agents']);
  close();
});

test('a rejected path surfaces as a 400 and changes nothing', () => {
  const { settings, close } = createStores({
    resolvePath: () => {
      throw new Error('workspace_root is not writable');
    },
  });
  const before = settings.read().workspace_root;
  assert.throws(
    () => settings.update({ workspace_root: '/root' }),
    (err) => err.status === 400 && /not writable/.test(err.message),
  );
  assert.equal(settings.read().workspace_root, before);
  close();
});

test('list settings round-trip through storage as arrays', () => {
  const { settings, close } = createStores();
  const updated = settings.update({ allowed_tools: ['view', 'grep'], denied_commands: 'curl, wget' });
  assert.deepEqual(updated.allowed_tools, ['view', 'grep']);
  assert.deepEqual(updated.denied_commands, ['curl', 'wget']);
  assert.deepEqual(settings.read().denied_commands, ['curl', 'wget']);
  close();
});

test('an unset workspace root falls back to the configured default', () => {
  const { settings, close } = createStores({ workspaceRoot: '/tmp/default-ws' });
  assert.equal(settings.read().workspace_root, '/tmp/default-ws');
  close();
});
