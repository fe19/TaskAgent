/**
 * Finished runs over time, for the monitoring dashboard. Bins follow local time (5 minutes,
 * hours or days), so "today" means the operator's today. Pure: rows in, bins out.
 */

export const RANGES = [
  { id: '1h', label: '1 hour', bin: '5min', count: 12 },
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

/** What one bin spans, in words ("Tokens used per 5 minutes"). */
export const BIN_WORDS = { '5min': '5 minutes', hour: 'hour', day: 'day' };

function binStart(date, bin) {
  const d = new Date(date);
  if (bin === '5min') d.setMinutes(d.getMinutes() - (d.getMinutes() % 5), 0, 0);
  else if (bin === 'hour') d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d;
}

/** `steps` bins later (or earlier, if negative). Days follow the calendar, so DST is fine. */
function shiftBin(date, bin, steps = 1) {
  const d = new Date(date);
  if (bin === '5min') d.setMinutes(d.getMinutes() + 5 * steps);
  else if (bin === 'hour') d.setHours(d.getHours() + steps);
  else d.setDate(d.getDate() + steps);
  return d;
}

/** Start of the first bin: the current bin, minus the rest of the range. */
export function rangeStart(rangeId, now = Date.now()) {
  const range = findRange(rangeId);
  if (!range) return null;
  return shiftBin(binStart(now, range.bin), range.bin, -(range.count - 1));
}

/** SQLite's `datetime('now')` is UTC without a zone marker. */
function parseFinished(value) {
  if (!value) return NaN;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

const emptyCounts = () => Object.fromEntries(OUTCOME_GROUPS.map((g) => [g.id, 0]));

/** Every bin of the range, oldest first, each made by `make()`, plus a lookup for a row. */
function makeBins(range, now, make) {
  const bins = [];
  for (let start = rangeStart(range.id, now), i = 0; i < range.count; i += 1) {
    const end = shiftBin(start, range.bin);
    bins.push({ start: start.toISOString(), end: end.toISOString(), ...make() });
    start = end;
  }
  const first = Date.parse(bins[0].start);
  const last = Date.parse(bins.at(-1).end);
  const binOf = (row) => {
    const at = parseFinished(row.finished_at);
    return at >= first && at < last ? bins.find((b) => at < Date.parse(b.end)) : null;
  };
  return { bins, binOf };
}

/**
 * Counts finished runs (`{ status, finished_at }`) per bin and outcome. Returns the bins
 * (oldest first, every bin present, empty ones as zero) and the totals for the range.
 */
export function binRuns(rows, rangeId, now = Date.now()) {
  const range = findRange(rangeId);
  if (!range) return null;

  const { bins, binOf } = makeBins(range, now, () => ({ counts: emptyCounts(), total: 0 }));
  const totals = { ...emptyCounts(), total: 0 };
  for (const row of rows) {
    const group = GROUP_OF[row.status];
    const bin = group && binOf(row);
    if (!bin) continue;
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

export const TOKEN_PARTS = [
  { id: 'input_tokens', label: 'Input' },
  { id: 'output_tokens', label: 'Output' },
  { id: 'cache_read_tokens', label: 'Cache read' },
  { id: 'cache_write_tokens', label: 'Cache write' },
];

const hasUsage = (row) => TOKEN_PARTS.some((p) => row[p.id] != null);

/**
 * Tokens used per bin, by the runs that finished in it. A bin without runs used 0 tokens; a
 * bin whose runs reported no usage is unknown (`total: null`), never 0, so the line breaks.
 */
export function binTokens(rows, rangeId, now = Date.now()) {
  const range = findRange(rangeId);
  if (!range) return null;

  const emptyParts = () => Object.fromEntries(TOKEN_PARTS.map((p) => [p.id, 0]));
  const { bins, binOf } = makeBins(range, now, () => ({ parts: emptyParts(), total: 0, runs: 0, reported: 0 }));
  const totals = { ...emptyParts(), total: 0, runs: 0, reported: 0 };
  for (const row of rows) {
    const bin = binOf(row);
    if (!bin) continue;
    bin.runs += 1;
    totals.runs += 1;
    if (!hasUsage(row)) continue;
    bin.reported += 1;
    totals.reported += 1;
    for (const p of TOKEN_PARTS) {
      const n = Number(row[p.id] ?? 0);
      bin.parts[p.id] += n;
      bin.total += n;
      totals[p.id] += n;
      totals.total += n;
    }
  }
  for (const bin of bins) if (bin.runs > 0 && bin.reported === 0) bin.total = null;

  return { range: range.id, bin: range.bin, bins, totals };
}
