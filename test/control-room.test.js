import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createControlRoom } from '../src/control-room.js';
import { tempDir, removeDir } from './helpers.js';

test('control room can run without creating an HTTP server', async () => {
  const root = tempDir('acr-control-room-');
  const services = createControlRoom({
    dbFile: join(root, 'control-room.db'),
    workspaceRoot: join(root, 'workspaces'),
  });
  try {
    assert.equal(services.settings.read().auto_dispatch, false);
    assert.equal(services.scheduler.activeCount, 0);
    assert.equal('server' in services, false);
  } finally {
    await services.close();
    removeDir(root);
  }
});
