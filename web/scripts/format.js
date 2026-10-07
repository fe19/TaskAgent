export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function formatNumber(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function formatUsd(usd) {
  if (usd == null || Number.isNaN(usd)) return null;
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(usd >= 100 ? 0 : 2)}`;
}

export function formatBytes(bytes) {
  if (bytes == null) return null;
  const mb = bytes / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '–';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// SQLite stores UTC without a zone marker.
export function parseUtc(value) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : t;
}

export function elapsedMs(run) {
  const started = parseUtc(run.started_at);
  if (started == null) return null;
  const end = run.finished_at ? parseUtc(run.finished_at) : Date.now();
  return Math.max(0, (end ?? Date.now()) - started);
}
