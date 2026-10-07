import { json, readJsonBody } from './responses.js';

// `:id` matches digits only and arrives as a number.
const PARAM = /:([A-Za-z_]+)/g;

function compile(pattern) {
  const names = [];
  const source = pattern.replace(PARAM, (_, name) => {
    names.push(name);
    return name === 'id' ? '(\\d+)' : '([^/]+)';
  });
  return { regex: new RegExp(`^${source}$`), names };
}

/**
 * Handlers return a payload (200), `{ status, body }`, or undefined when they
 * wrote the response themselves.
 */
export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler, options = {}) => {
    routes.push({ method, ...compile(pattern), handler, ...options });
    return router;
  };

  const router = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),

    /** Resolves true when a route handled the request. */
    async handle(req, res, url) {
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = url.pathname.match(route.regex);
        if (!match) continue;

        const params = Object.fromEntries(
          route.names.map((name, i) => [name, name === 'id' ? Number(match[i + 1]) : match[i + 1]]),
        );
        const hasBody = route.readBody !== false && (req.method === 'POST' || req.method === 'PUT');
        const body = hasBody ? await readJsonBody(req) : undefined;
        const result = await route.handler({ req, res, url, params, body });

        if (result === undefined) return true;
        if (result && typeof result === 'object' && 'status' in result) json(res, result.status, result.body);
        else json(res, 200, result);
        return true;
      }
      return false;
    },
  };
  return router;
}
