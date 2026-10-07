import { createServer } from 'node:http';
import { createControlRoom } from '../control-room.js';
import { createRouter } from './router.js';
import { registerRoutes } from './routes.js';
import { createSseHub } from './sse.js';
import { createStaticHandler } from './static-files.js';
import { json } from './responses.js';

/** The web interface: control room + JSON API + SSE + static files. */
export function createApp(overrides = {}) {
  const room = createControlRoom(overrides);
  const router = createRouter();
  const sse = createSseHub(room.bus);
  registerRoutes(router, room);
  router.get('/api/stream', ({ req, res }) => sse.subscribe(req, res));

  // The browser imports the real domain modules via /domain/.
  const serveStatic = createStaticHandler({ '/': room.config.webDir, '/domain/': room.config.domainDir });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (!url.pathname.startsWith('/api/')) await serveStatic(req, res, url);
      else if (!(await router.handle(req, res, url))) json(res, 404, { error: 'Not found' });
    } catch (err) {
      if (res.headersSent) return void res.end();
      json(res, err.status ?? 500, { error: err.message || 'Internal error' });
    }
  });

  async function close() {
    sse.close();
    await new Promise((r) => server.close(r));
    await room.close();
  }

  return { ...room, server, close };
}
