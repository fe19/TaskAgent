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

/** A start time, short: "15:00" today, "Thu 23:00" within a week, else "30 Oct 23:00". */
export function formatWhen(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '–';
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  if (at.toDateString() === now.toDateString()) return time;
  const days = (at - now) / 86_400_000;
  if (days > -1 && days < 6) return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/** ISO → the value a `datetime-local` input shows (local time, minutes). */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
