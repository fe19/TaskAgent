const HEARTBEAT_MS = 20000;

/** Relays bus events to browsers as Server-Sent Events. */
export function createSseHub(bus) {
  const clients = new Set();

  const onEvent = (event) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(frame);
  };
  bus.on('event', onEvent);

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': keepalive\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    subscribe(req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },

    close() {
      clearInterval(heartbeat);
      bus.off('event', onEvent);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
