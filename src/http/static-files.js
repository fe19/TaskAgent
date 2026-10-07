import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/** Serves files from mounted directories (`{ urlPrefix: dir }`), traversal-safe. */
export function createStaticHandler(mounts) {
  const entries = Object.entries(mounts)
    .map(([prefix, dir]) => [prefix, resolve(dir)])
    .sort((a, b) => b[0].length - a[0].length); // Longest prefix wins.

  function locate(pathname) {
    for (const [prefix, root] of entries) {
      if (!pathname.startsWith(prefix)) continue;
      const relative = pathname.slice(prefix.length) || 'index.html';
      // normalize + prefix check defeats `../` traversal attempts.
      const filePath = join(root, normalize(`/${relative}`));
      return filePath.startsWith(root) ? filePath : null;
    }
    return null;
  }

  return async function serveStatic(req, res, url) {
    const filePath = locate(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!filePath) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Forbidden');
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-cache',
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  };
}
