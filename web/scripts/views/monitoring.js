import { $ } from '../ui.js';
import { get } from '../api-client.js';
import { formatNumber } from '../format.js';
import { BIN_WORDS, binRuns, binTokens, DEFAULT_RANGE, findRange, OUTCOME_GROUPS, RANGES, TOKEN_PARTS } from '/domain/run-stats.js';
import { renderStackedChart } from './stacked-chart.js';
import { renderLineChart } from './line-chart.js';
import { currentTab, onShow } from './tabs.js';

/** The Monitoring tab: runs completed over time by outcome, and tokens used over time. */
const RANGE_KEY = 'am.monitoring.range';
let range = DEFAULT_RANGE;
let stats = null;
let tokens = null;

function readStoredRange() {
  try {
    const stored = localStorage.getItem(RANGE_KEY);
    return findRange(stored) ? stored : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

const fmt = (iso, options) => new Date(iso).toLocaleString(undefined, options);

const TIME = { hour: '2-digit', minute: '2-digit' };

/** Axis label: "14:05" per 5 minutes or hour, "Mon 12" over a week, "12 Oct" over a month. */
function tickLabel(bin) {
  if (stats.bin !== 'day') return fmt(bin.start, TIME);
  if (stats.range === '7d') return fmt(bin.start, { weekday: 'short', day: 'numeric' });
  return fmt(bin.start, { day: 'numeric', month: 'short' });
}

function titleLabel(bin) {
  const day = fmt(bin.start, { weekday: 'short', day: 'numeric', month: 'short' });
  if (stats.bin === 'day') return day;
  return `${day}, ${fmt(bin.start, TIME)}–${fmt(bin.end, TIME)}`;
}

function renderRangeSwitch() {
  $('monitoring-range').replaceChildren(
    ...RANGES.map((r) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(r.id === range));
      button.dataset.range = r.id;
      button.textContent = r.label;
      return button;
    }),
  );
}

function renderFigures() {
  $('mon-total').textContent = stats.totals.total.toLocaleString();
  // Unknown, not 0%, when nothing finished.
  $('mon-success').textContent = stats.successRate == null ? 'n/a' : `${Math.round(stats.successRate * 100)}%`;
}

function renderLegend() {
  $('mon-legend').replaceChildren(
    ...OUTCOME_GROUPS.map((g) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = `legend-swatch seg-${g.id}`;
      const name = document.createElement('span');
      name.textContent = g.label;
      const count = document.createElement('strong');
      count.textContent = stats.totals[g.id].toLocaleString();
      item.append(swatch, name, count);
      return item;
    }),
  );
}

/** A table of the same numbers as a chart, newest first: it answers "what happened recently". */
function table(headers, bins, cells) {
  const node = document.createElement('table');
  const head = node.createTHead().insertRow();
  for (const text of ['Period', ...headers]) {
    const th = document.createElement('th');
    th.textContent = text;
    head.append(th);
  }
  const body = node.createTBody();
  for (const bin of [...bins].reverse()) {
    const row = body.insertRow();
    for (const value of [titleLabel(bin), ...cells(bin)]) {
      row.insertCell().textContent = typeof value === 'number' ? value.toLocaleString() : value;
    }
  }
  return node;
}

function renderTable() {
  $('mon-table').replaceChildren(
    table([...OUTCOME_GROUPS.map((g) => g.label), 'Total'], stats.bins, (bin) => [...OUTCOME_GROUPS.map((g) => bin.counts[g.id]), bin.total]),
  );
}

function renderChart() {
  const chart = $('mon-chart');
  if (stats.totals.total === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = `No runs completed in the last ${findRange(range).label}.`;
    chart.replaceChildren(empty);
    return;
  }
  renderStackedChart(chart, { bins: stats.bins, series: OUTCOME_GROUPS, tick: tickLabel, title: titleLabel });
}

function tokenTooltip(bin) {
  const heading = titleLabel(bin);
  if (bin.runs === 0) return { heading, rows: [], total: { value: '0', label: 'No runs' } };
  if (bin.total == null) return { heading, rows: [], total: { value: '?', label: 'No usage reported' } };
  return {
    heading,
    rows: TOKEN_PARTS.map((p) => ({ value: bin.parts[p.id].toLocaleString(), label: p.label })),
    total: { value: bin.total.toLocaleString(), label: `Tokens, ${bin.reported} run${bin.reported === 1 ? '' : 's'}` },
  };
}

function renderTokens() {
  const { totals } = tokens;
  // Unknown is shown as n/a, never as 0.
  $('tok-total').textContent = totals.reported > 0 ? formatNumber(totals.total) : 'n/a';
  $('tok-per-run').textContent = totals.reported > 0 ? formatNumber(Math.round(totals.total / totals.reported)) : 'n/a';

  const missing = totals.runs - totals.reported;
  const note = $('tok-note');
  note.hidden = missing === 0;
  note.textContent = `${missing} run${missing === 1 ? '' : 's'} reported no token usage and ${missing === 1 ? 'is' : 'are'} not counted; periods with only such runs show as gaps.`;

  const chart = $('tok-chart');
  if (totals.reported === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = `No token usage reported in the last ${findRange(range).label}.`;
    chart.replaceChildren(empty);
  } else {
    renderLineChart(chart, {
      bins: tokens.bins,
      id: 'tokens',
      value: (bin) => bin.total,
      format: (n) => formatNumber(n),
      tick: tickLabel,
      tooltip: tokenTooltip,
      label: `Tokens used per ${BIN_WORDS[tokens.bin]}, last ${findRange(range).label}`,
    });
  }

  $('tok-table').replaceChildren(
    table([...TOKEN_PARTS.map((p) => p.label), 'Total', 'Runs'], tokens.bins, (bin) => [
      ...TOKEN_PARTS.map((p) => (bin.total == null ? '–' : bin.parts[p.id])),
      bin.total ?? 'unknown',
      bin.runs,
    ]),
  );
}

function render() {
  renderRangeSwitch();
  if (!stats) return;
  renderFigures();
  renderChart();
  renderLegend();
  renderTable();
  renderTokens();
}

/** Fetches and re-renders; the old chart stays (dimmed) until the new data is in. */
export async function load() {
  if (currentTab() !== 'monitoring') return;
  const body = $('monitoring-body');
  body.dataset.loading = 'true';
  try {
    const data = await get(`/api/monitoring/runs?range=${range}`);
    stats = binRuns(data.runs, range);
    tokens = binTokens(data.runs, range);
    render();
  } catch (err) {
    const error = document.createElement('p');
    error.className = 'empty';
    error.textContent = `Could not load monitoring data: ${err.message}`;
    $('mon-chart').replaceChildren(error);
  } finally {
    delete body.dataset.loading;
  }
}

export function mount() {
  range = readStoredRange();
  renderRangeSwitch();
  $('monitoring-range').addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (!button || button.dataset.range === range) return;
    range = button.dataset.range;
    try {
      localStorage.setItem(RANGE_KEY, range);
    } catch {
      /* per-browser convenience only */
    }
    renderRangeSwitch();
    load();
  });
  onShow((tab) => {
    if (tab === 'monitoring') load();
  });
  // The chart's width follows its card.
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (stats && width !== lastWidth && currentTab() === 'monitoring') {
      renderChart();
      renderTokens();
    }
    lastWidth = width;
  }).observe($('mon-chart'));
}
