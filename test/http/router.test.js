import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/http/router.js';

/** A response double recording what the router wrote. */
function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

const run = async (router, method, path, req = {}) => {
  const res = fakeRes();
  const handled = await router.handle({ method, ...req }, res, new URL(`http://x${path}`));
  return { handled, res, json: res.body ? JSON.parse(res.body) : null };
};

test('an unmatched path is reported as unhandled so static files get a turn', async () => {
  const router = createRouter().get('/api/tasks', () => ({ ok: true }));
  assert.equal((await run(router, 'GET', '/index.html')).handled, false);
});

test('the method is part of the match', async () => {
  const router = createRouter().get('/api/tasks', () => ({ ok: true }));
  assert.equal((await run(router, 'DELETE', '/api/tasks')).handled, false);
});

test('a returned payload becomes a 200 JSON response', async () => {
  const router = createRouter().get('/api/health', () => ({ ok: true }));
  const { res, json } = await run(router, 'GET', '/api/health');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(json, { ok: true });
});

test('a handler can choose its own status code', async () => {
  const router = createRouter().post('/api/tasks', () => ({ status: 201, body: { id: 1 } }), {
    readBody: false,
  });
  const { res, json } = await run(router, 'POST', '/api/tasks');
  assert.equal(res.statusCode, 201);
  assert.deepEqual(json, { id: 1 });
});

test('a handler that writes the response itself is left alone', async () => {
  const router = createRouter().get('/api/stream', ({ res }) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
  });
  const { handled, res } = await run(router, 'GET', '/api/stream');
  assert.equal(handled, true);
  assert.equal(res.headers['content-type'], 'text/event-stream');
  assert.equal(res.body, null, 'the router must not end the stream');
});

test(':id is captured as a number, not a string', async () => {
  let seen;
  const router = createRouter().get('/api/tasks/:id', ({ params }) => {
    seen = params.id;
    return {};
  });
  await run(router, 'GET', '/api/tasks/42');
  assert.equal(seen, 42);
  assert.equal(typeof seen, 'number');
});

test('a non-numeric id does not reach the handler', async () => {
  let called = false;
  const router = createRouter().get('/api/tasks/:id', () => {
    called = true;
    return {};
  });
  assert.equal((await run(router, 'GET', '/api/tasks/abc')).handled, false);
  assert.equal(called, false, 'a handler must never see NaN');
});

test('a path segment is not matched across a slash', async () => {
  const router = createRouter().get('/api/tasks/:id', () => ({}));
  assert.equal((await run(router, 'GET', '/api/tasks/1/extra')).handled, false);
});

test('several parameters in one pattern are all captured', async () => {
  let seen;
  const router = createRouter().get('/api/runs/:id/files/:name', ({ params }) => {
    seen = params;
    return {};
  });
  await run(router, 'GET', '/api/runs/7/files/out.txt');
  assert.deepEqual(seen, { id: 7, name: 'out.txt' });
});

test('the first matching route wins', async () => {
  const router = createRouter()
    .get('/api/a', () => ({ which: 'first' }))
    .get('/api/a', () => ({ which: 'second' }));
  assert.deepEqual((await run(router, 'GET', '/api/a')).json, { which: 'first' });
});

test('route registration is chainable', () => {
  const router = createRouter();
  assert.equal(
    router.get('/a', () => ({})),
    router,
  );
});
