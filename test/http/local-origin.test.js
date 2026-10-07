import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/http/server.js';
import { allowedHostnames, localRequestRejection } from '../../src/http/local-origin.js';
import { tempDir, removeDir } from '../helpers.js';

const FAKE_CLI = fileURLToPath(new URL('../fixtures/fake-copilot.mjs', import.meta.url));
const FAKE_GH = fileURLToPath(new URL('../fixtures/fake-gh.mjs', import.meta.url));

const LOCAL = { bindHost: '127.0.0.1', port: 4317 };
const check = (headers, target = LOCAL) => localRequestRejection(headers, target);

test('loopback hosts on the listening port are accepted', () => {
  for (const host of ['127.0.0.1:4317', 'localhost:4317', 'LOCALHOST:4317', '[::1]:4317']) {
    assert.equal(check({ host }), null, host);
  }
});

test('a foreign or missing Host is refused, which defeats DNS rebinding', () => {
  for (const host of [undefined, '', 'evil.example:4317', 'evil.example', '127.0.0.1.evil.example:4317']) {
    assert.equal(check({ host }), 'Host is not this server', String(host));
  }
});

test('Host on another port or with junk is refused', () => {
  for (const host of ['127.0.0.1:8080', '127.0.0.1', 'user@127.0.0.1:4317', '127.0.0.1:4317/x']) {
    assert.equal(check({ host }), 'Host is not this server', host);
  }
});

test('port 80 may be left out of Host', () => {
  assert.equal(check({ host: 'localhost' }, { bindHost: '127.0.0.1', port: 80 }), null);
});

test('a request without Origin is allowed (curl, same-origin GET)', () => {
  assert.equal(check({ host: '127.0.0.1:4317' }), null);
});

test('the UI’s own Origin is allowed, on any loopback spelling', () => {
  for (const origin of ['http://127.0.0.1:4317', 'http://localhost:4317', 'http://[::1]:4317']) {
    assert.equal(check({ host: '127.0.0.1:4317', origin }), null, origin);
  }
});

test('a cross-site Origin is refused even with a local Host', () => {
  for (const origin of [
    'https://evil.example',
    'http://evil.example:4317',
    'http://127.0.0.1:3000',
    'https://127.0.0.1:4317',
    'null',
    'garbage',
  ]) {
    assert.equal(check({ host: '127.0.0.1:4317', origin }), 'Origin is not this server', origin);
  }
});

test('a specific bind address is allowed besides loopback; a wildcard adds nothing', () => {
  assert.ok(allowedHostnames('192.168.1.5').has('192.168.1.5'));
  assert.ok(allowedHostnames('fe80::1').has('[fe80::1]'));
  assert.deepEqual([...allowedHostnames('0.0.0.0')], [...allowedHostnames('::')]);
  assert.equal(check({ host: '192.168.1.5:4317' }, { bindHost: '0.0.0.0', port: 4317 }), 'Host is not this server');
});

/** Raw requests: fetch cannot set Host. */
function raw(port, { method = 'GET', path = '/api/health', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function boot() {
  const root = tempDir('acr-origin-');
  const app = createApp({
    dbFile: ':memory:',
    workspaceRoot: join(root, 'workspaces'),
    copilotBin: FAKE_CLI,
    ghBin: FAKE_GH,
    usageRetries: 1,
    readUsage: () => null,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  return {
    app,
    port,
    cleanup: async () => {
      await app.close();
      removeDir(root);
    },
  };
}

test('the server refuses a cross-site text/plain POST that would create a task', async () => {
  const h = await boot();
  const res = await raw(h.port, {
    method: 'POST',
    path: '/api/tasks',
    headers: { host: `127.0.0.1:${h.port}`, origin: 'https://evil.example', 'content-type': 'text/plain' },
    body: JSON.stringify({ prompt: 'rm -rf ~' }),
  });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.text).error, 'Origin is not this server');
  assert.equal(h.app.tasks.list().length, 0);
  await h.cleanup();
});

test('the server refuses a rebound Host on API and static routes alike', async () => {
  const h = await boot();
  for (const path of ['/api/tasks', '/api/stream', '/']) {
    const res = await raw(h.port, { path, headers: { host: `evil.example:${h.port}` } });
    assert.equal(res.status, 403, path);
  }
  await h.cleanup();
});

test('the server still serves its own UI', async () => {
  const h = await boot();
  const headers = { host: `localhost:${h.port}`, origin: `http://localhost:${h.port}` };
  assert.equal((await raw(h.port, { headers })).status, 200);
  assert.equal((await raw(h.port, { path: '/', headers: { host: `127.0.0.1:${h.port}` } })).status, 200);
  await h.cleanup();
});
