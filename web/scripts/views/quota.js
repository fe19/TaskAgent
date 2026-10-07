import { $ } from '../ui.js';
import { get } from '../api-client.js';
import { aicToUsd, state } from '../store.js';
import { formatUsd } from '../format.js';

// The server caches GitHub's answer for a minute; Claude limits are a local read.
const POLL_MS = 60000;
let quota = null;
let claudeLimits = null;

const isClaude = () => state.settings?.assistant === 'claude-code';

const resetDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;

/** Copilot: monthly AI Credits left, in dollars and percent. */
function describeCopilot(q) {
  const labels = { valueLabel: 'left', pctLabel: 'left' };
  if (!q) return { ...labels, value: '–', pct: '–', tip: 'Loading the Copilot quota…' };
  if (!q.available) return { ...labels, value: 'n/a', pct: 'n/a', tip: q.reason };
  const resets = resetDay(q.reset_date) ? ` · resets ${resetDay(q.reset_date)}` : '';
  if (q.unlimited) return { ...labels, value: '∞', pct: '∞', tip: `Unlimited Copilot premium requests${resets}` };
  const aic = Math.round(q.remaining_aic).toLocaleString();
  const of = q.entitlement_aic == null ? '' : ` of ${q.entitlement_aic.toLocaleString()}`;
  const pct = q.percent_remaining == null ? '' : ` (${Math.round(q.percent_remaining)}%)`;
  return {
    ...labels,
    value: formatUsd(aicToUsd(q.remaining_aic)) ?? `${aic} AIC`,
    pct: q.percent_remaining == null ? 'n/a' : `${Math.round(q.percent_remaining)}%`,
    tip: `${aic}${of} AI Credits left this month${pct}${resets}. Whole GitHub Copilot account, not just these runs.`,
  };
}

/** "15:00" today, otherwise "Fri 08:00". */
function until(iso) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString()
    ? time
    : `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

const WINDOW_NAMES = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet' };
const SHORT = { five_hour: '5h', seven_day: 'week' };

/** One Claude Code window: percent left and when it resets. */
function describeWindow(w, status) {
  if (!w) return { value: 'n/a', label: 'left', tip: '', level: '' };
  const name = WINDOW_NAMES[w.id] ?? w.id.replace(/_/g, ' ');
  const left = w.percent_left == null ? null : Math.round(w.percent_left);
  const when = w.resets_at ? until(w.resets_at) : null;
  const full = new Date(w.resets_at ?? 0).toLocaleString();
  const reached = status === 'rejected' && left === 0;
  return {
    value: left == null ? 'n/a' : `${left}%`,
    label: `${SHORT[w.id] ?? name} left${when ? ` · ${when}` : ''}`,
    tip: w.reset_since
      ? `Claude Code ${name} limit: reset since the last run, so it starts full again.`
      : `Claude Code ${name} limit: ${left ?? '?'}% left${w.resets_at ? `, resets ${full}` : ''}.${reached ? ' Limit reached.' : ''}`,
    level: reached || left === 0 ? 'out' : left != null && left < 20 ? 'low' : '',
  };
}

function describeClaude(l) {
  if (!l) return { value: '–', pct: '–', valueLabel: '5h left', pctLabel: 'week left', tip: 'Loading Claude Code limits…' };
  if (!l.available) return { value: 'n/a', pct: 'n/a', valueLabel: '5h left', pctLabel: 'week left', tip: l.reason };
  const byId = Object.fromEntries(l.windows.map((w) => [w.id, w]));
  // The two windows every subscription has; anything else stays in the tooltip.
  const first = describeWindow(byId.five_hour ?? l.windows[0], l.limit_status);
  const second = describeWindow(byId.seven_day ?? l.windows[1], l.limit_status);
  const seen = l.observed_at ? ` As of ${new Date(l.observed_at).toLocaleString()} (reported by the last Claude Code run).` : '';
  return {
    value: first.value,
    pct: second.value,
    valueLabel: first.label,
    pctLabel: second.label,
    tip: `${first.tip} ${second.tip}${seen}`.trim(),
    levels: [first.level, second.level],
  };
}

export function render() {
  const d = isClaude() ? describeClaude(claudeLimits) : describeCopilot(quota);
  $('stat-left').textContent = d.value;
  $('stat-left-pct').textContent = d.pct;
  $('stat-left-label').textContent = d.valueLabel;
  $('stat-left-pct-label').textContent = d.pctLabel;
  const stats = document.querySelectorAll('.quota-stat');
  stats.forEach((el, i) => {
    el.title = d.tip;
    el.dataset.level = d.levels?.[i] ?? '';
  });
}

/** Loads whatever the selected assistant reports. Claude limits change with every run. */
export async function load() {
  try {
    if (isClaude()) claudeLimits = await get('/api/claude-limits');
    else quota = await get('/api/quota');
  } catch {
    const down = { available: false, reason: 'Server unreachable.' };
    if (isClaude()) claudeLimits = down;
    else quota = down;
  }
  render();
}

export function mount() {
  load();
  setInterval(load, POLL_MS);
}
