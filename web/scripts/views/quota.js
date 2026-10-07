import { $ } from '../ui.js';
import { get } from '../api-client.js';
import { aicToUsd } from '../store.js';
import { formatUsd } from '../format.js';

// The server caches GitHub's answer for a minute.
const POLL_MS = 60000;
let quota = null;

const resetDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;

function describe(q) {
  if (!q) return { value: '–', pct: '–', tip: 'Loading the Copilot quota…' };
  if (!q.available) return { value: 'n/a', pct: 'n/a', tip: q.reason };
  const resets = resetDay(q.reset_date) ? ` · resets ${resetDay(q.reset_date)}` : '';
  if (q.unlimited) return { value: '∞', pct: '∞', tip: `Unlimited Copilot premium requests${resets}` };
  const aic = Math.round(q.remaining_aic).toLocaleString();
  const of = q.entitlement_aic == null ? '' : ` of ${q.entitlement_aic.toLocaleString()}`;
  const pct = q.percent_remaining == null ? '' : ` (${Math.round(q.percent_remaining)}%)`;
  return {
    value: formatUsd(aicToUsd(q.remaining_aic)) ?? `${aic} AIC`,
    pct: q.percent_remaining == null ? 'n/a' : `${Math.round(q.percent_remaining)}%`,
    tip: `${aic}${of} AI Credits left this month${pct}${resets}. Whole GitHub Copilot account, not just these runs.`,
  };
}

export function render() {
  const { value, pct, tip } = describe(quota);
  $('stat-left').textContent = value;
  $('stat-left-pct').textContent = pct;
  for (const el of document.querySelectorAll('.quota-stat')) el.title = tip;
}

async function load() {
  try {
    quota = await get('/api/quota');
  } catch {
    quota = { available: false, reason: 'Server unreachable.' };
  }
  render();
}

export function mount() {
  load();
  setInterval(load, POLL_MS);
}
