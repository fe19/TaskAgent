import { $ } from '../ui.js';
import { get } from '../api-client.js';
import { binRuns, DEFAULT_RANGE, findRange, OUTCOME_GROUPS, RANGES } from '/domain/run-stats.js';
import { renderStackedChart } from './stacked-chart.js';
import { currentTab, onShow } from './tabs.js';

/** The Monitoring tab: runs completed over time, by outcome. */
const RANGE_KEY = 'am.monitoring.range';
let range = DEFAULT_RANGE;
let stats = null;

function readStoredRange() {
  try {
    const stored = localStorage.getItem(RANGE_KEY);
    return findRange(stored) ? stored : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

const fmt = (iso, options) => new Date(iso).toLocaleString(undefined, options);

/** Axis label: "14:00" per hour, "Mon 12" over a week, "12 Oct" over a month. */
function tickLabel(bin) {
  if (stats.bin === 'hour') return fmt(bin.start, { hour: '2-digit', minute: '2-digit' });
  if (stats.range === '7d') return fmt(bin.start, { weekday: 'short', day: 'numeric' });
  return fmt(bin.start, { day: 'numeric', month: 'short' });
}

function titleLabel(bin) {
  const day = fmt(bin.start, { weekday: 'short', day: 'numeric', month: 'short' });
  if (stats.bin !== 'hour') return day;
  return `${day}, ${fmt(bin.start, { hour: '2-digit', minute: '2-digit' })}–${fmt(bin.end, { hour: '2-digit', minute: '2-digit' })}`;
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

function renderTable() {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const text of ['Period', ...OUTCOME_GROUPS.map((g) => g.label), 'Total']) {
    const th = document.createElement('th');
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();
  // Newest first: the table answers "what happened recently".
  for (const bin of [...stats.bins].reverse()) {
    const row = body.insertRow();
    for (const value of [titleLabel(bin), ...OUTCOME_GROUPS.map((g) => bin.counts[g.id]), bin.total]) {
      row.insertCell().textContent = typeof value === 'number' ? value.toLocaleString() : value;
    }
  }
  $('mon-table').replaceChildren(table);
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

function render() {
  renderRangeSwitch();
  if (!stats) return;
  renderFigures();
  renderChart();
  renderLegend();
  renderTable();
}

/** Fetches and re-renders; the old chart stays (dimmed) until the new data is in. */
export async function load() {
  if (currentTab() !== 'monitoring') return;
  const body = $('monitoring-body');
  body.dataset.loading = 'true';
  try {
    const data = await get(`/api/monitoring/runs?range=${range}`);
    stats = binRuns(data.runs, range);
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
    if (stats && width !== lastWidth && currentTab() === 'monitoring') renderChart();
    lastWidth = width;
  }).observe($('mon-chart'));
}
