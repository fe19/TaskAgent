/**
 * Guards the unauthenticated API against other websites in the operator's browser:
 * `Host` stops DNS rebinding, `Origin` stops cross-site requests (e.g. a text/plain
 * POST that needs no CORS preflight). A missing `Origin` (curl, same-origin GET) is fine.
 */

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const WILDCARDS = ['0.0.0.0', '::', '[::]'];

/** Hostnames as `URL#hostname` spells them: IPv6 in brackets, lowercase. */
export function allowedHostnames(bindHost) {
  const names = new Set(LOOPBACK);
  const host = String(bindHost ?? '').toLowerCase();
  if (host && !WILDCARDS.includes(host)) names.add(host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);
  return names;
}

/** `host[:port]` → true when it names this server. */
function isLocalAuthority(authority, { hostnames, port }) {
  let url;
  try {
    url = new URL(`http://${authority}`);
  } catch {
    return false;
  }
  if (url.username || url.password || url.pathname !== '/') return false;
  return hostnames.has(url.hostname) && (url.port || '80') === String(port);
}

/** Returns null when the request may proceed, else the reason it is refused. */
export function localRequestRejection(headers, { bindHost, port }) {
  const target = { hostnames: allowedHostnames(bindHost), port };

  if (!headers.host || !isLocalAuthority(headers.host, target)) return 'Host is not this server';

  const origin = headers.origin;
  if (origin === undefined) return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return 'Origin is not this server';
  }
  if (parsed.protocol !== 'http:' || !isLocalAuthority(parsed.host, target)) return 'Origin is not this server';
  return null;
}
