/**
 * Finished runs over time, for the monitoring dashboard. Bins follow local time (hours or
 * days), so "today" means the operator's today. Pure: rows in, bins out.
 */

export const RANGES = [
  { id: '24h', label: '24 hours', bin: 'hour', count: 24 },
  { id: '7d', label: '7 days', bin: 'day', count: 7 },
  { id: '30d', label: '30 days', bin: 'day', count: 30 },
];
export const DEFAULT_RANGE = '7d';

/** Outcomes, bottom to top of a stack. Succeeded and failed never touch, for colour-blind readers. */
export const OUTCOME_GROUPS = [
  { id: 'succeeded', label: 'Succeeded', statuses: ['succeeded'] },
  { id: 'stopped', label: 'Stopped', statuses: ['cancelled', 'interrupted'] },
  { id: 'timed_out', label: 'Timed out', statuses: ['timed_out'] },
  { id: 'failed', label: 'Failed', statuses: ['failed'] },
];

const GROUP_OF = Object.fromEntries(OUTCOME_GROUPS.flatMap((g) => g.statuses.map((s) => [s, g.id])));

export function findRange(id) {
  return RANGES.find((r) => r.id === id) ?? null;
}

function binStart(date, bin) {
  const d = new Date(date);
  if (bin === 'hour') d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function nextBin(date, bin) {
  const d = new Date(date);
  if (bin === 'hour') d.setHours(d.getHours() + 1);
  else d.setDate(d.getDate() + 1);
  return d;
}

/** Start of the first bin: the current hour or day, minus the rest of the range. */
export function rangeStart(rangeId, now = Date.now()) {
  const range = findRange(rangeId);
  if (!range) return null;
  const d = binStart(now, range.bin);
  if (range.bin === 'hour') d.setHours(d.getHours() - (range.count - 1));
  else d.setDate(d.getDate() - (range.count - 1));
  return d;
}

/** SQLite's `datetime('now')` is UTC without a zone marker. */
function parseFinished(value) {
  if (!value) return NaN;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

const emptyCounts = () => Object.fromEntries(OUTCOME_GROUPS.map((g) => [g.id, 0]));

/**
 * Counts finished runs (`{ status, finished_at }`) per bin and outcome. Returns the bins
 * (oldest first, every bin present, empty ones as zero) and the totals for the range.
 */
export function binRuns(rows, rangeId, now = Date.now()) {
  const range = findRange(rangeId);
  if (!range) return null;

  const bins = [];
  for (let start = rangeStart(rangeId, now), i = 0; i < range.count; i += 1) {
    const end = nextBin(start, range.bin);
    bins.push({ start: start.toISOString(), end: end.toISOString(), counts: emptyCounts(), total: 0 });
    start = end;
  }

  const totals = { ...emptyCounts(), total: 0 };
  const first = Date.parse(bins[0].start);
  const last = Date.parse(bins.at(-1).end);
  for (const row of rows) {
    const group = GROUP_OF[row.status];
    const at = parseFinished(row.finished_at);
    if (!group || !(at >= first && at < last)) continue;
    const bin = bins.find((b) => at < Date.parse(b.end));
    bin.counts[group] += 1;
    bin.total += 1;
    totals[group] += 1;
    totals.total += 1;
  }

  return {
    range: range.id,
    bin: range.bin,
    bins,
    totals,
    // Unknown, not 0%, when nothing finished.
    successRate: totals.total > 0 ? totals.succeeded / totals.total : null,
  };
}
