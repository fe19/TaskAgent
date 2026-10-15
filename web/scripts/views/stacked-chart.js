/**
 * A stacked column chart in plain SVG: one column per bin, one segment per series.
 * Columns max 24px wide, 2px surface gaps between segments, a 4px rounded top, hairline grid.
 * Each column's whole slot is its hover/focus target. All text goes in via textContent.
 */

const SVG = 'http://www.w3.org/2000/svg';
const HEIGHT = 220;
const MARGIN = { top: 10, right: 8, bottom: 26, left: 34 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

/** A round axis maximum and its ticks: steps of 1, 2 or 5 × 10^n, at most 4 intervals. */
export function niceTicks(max) {
  const top = Math.max(1, max);
  const raw = top / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw));
  const ticks = [];
  for (let t = 0; t < top + step; t += step) ticks.push(t);
  return ticks;
}

/** A rectangle whose top corners are rounded (the data end); the baseline stays square. */
function roundedTop(x, y, w, h) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param container element the chart fills (its width sets the chart's)
 * @param bins      [{ counts: { [seriesId]: n }, total }]
 * @param series    [{ id, label }], bottom to top; colours come from CSS (`.seg-<id>`)
 * @param tick      (bin, i) => axis label, or '' to skip
 * @param title     (bin) => tooltip heading
 */
export function renderStackedChart(container, { bins, series, tick, title }) {
  container.replaceChildren();
  const width = Math.max(280, container.clientWidth);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const ticks = niceTicks(Math.max(...bins.map((b) => b.total)));
  const yMax = ticks.at(-1);
  const y = (value) => MARGIN.top + plotH - (value / yMax) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, role: 'img' }, container);

  // Gridlines and y ticks first, so marks sit on top.
  const grid = el('g', { class: 'chart-grid' }, svg);
  for (const t of ticks) {
    el('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: y(t), y2: y(t), class: t === 0 ? 'chart-baseline' : '' }, grid);
    el('text', { x: MARGIN.left - 6, y: y(t), dy: '0.32em', 'text-anchor': 'end', class: 'chart-tick' }, grid).textContent =
      t.toLocaleString();
  }

  const slot = plotW / bins.length;
  const barW = Math.min(MAX_BAR, Math.max(2, slot * 0.7));
  // Label only as many columns as fit, evenly.
  const every = Math.ceil(bins.length / Math.max(1, Math.floor(plotW / 52)));

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.append(tip);

  bins.forEach((bin, i) => {
    const x = MARGIN.left + i * slot + (slot - barW) / 2;
    const column = el('g', { class: 'chart-column' }, svg);

    let base = y(0);
    const visible = series.filter((s) => bin.counts[s.id] > 0);
    visible.forEach((s, j) => {
      const h = (bin.counts[s.id] / yMax) * plotH;
      // The gap sits below every segment but the bottom one; tiny segments stay visible.
      const gap = j === 0 ? 0 : GAP;
      const drawn = Math.max(1, h - gap);
      const top = base - gap - drawn;
      const isTop = j === visible.length - 1;
      if (isTop) el('path', { d: roundedTop(x, top, barW, drawn), class: `seg seg-${s.id}` }, column);
      else el('rect', { x, y: top, width: barW, height: drawn, class: `seg seg-${s.id}` }, column);
      base = top;
    });

    const label = (i === bins.length - 1 || (bins.length - 1 - i) % every === 0) ? tick(bin, i) : '';
    if (label) {
      el('text', { x: x + barW / 2, y: HEIGHT - 8, 'text-anchor': 'middle', class: 'chart-tick' }, svg).textContent = label;
    }

    // The hit target is the whole slot, not just the painted bar.
    const hit = el('rect', {
      x: MARGIN.left + i * slot, y: MARGIN.top, width: slot, height: plotH, class: 'chart-hit', tabindex: 0,
    }, column);
    hit.setAttribute('aria-label', `${title(bin)}: ${bin.total} runs, ${series.map((s) => `${bin.counts[s.id]} ${s.label.toLowerCase()}`).join(', ')}`);
    const show = () => showTip(tip, column, { bin, series, heading: title(bin), x: x + barW / 2, width });
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', () => hideTip(tip, column));
    hit.addEventListener('blur', () => hideTip(tip, column));
  });
}

/** Values lead, labels follow; a short line key in the series colour marks each row. */
function showTip(tip, column, { bin, series, heading, x, width }) {
  column.classList.add('is-active');
  const head = document.createElement('p');
  head.className = 'chart-tip-head';
  head.textContent = heading;
  const rows = [...series].reverse().map((s) => {
    const row = document.createElement('p');
    row.className = 'chart-tip-row';
    const key = document.createElement('span');
    key.className = `chart-tip-key seg-${s.id}`;
    const value = document.createElement('strong');
    value.textContent = bin.counts[s.id].toLocaleString();
    const name = document.createElement('span');
    name.textContent = s.label;
    row.append(key, value, name);
    return row;
  });
  const total = document.createElement('p');
  total.className = 'chart-tip-row chart-tip-total';
  const totalValue = document.createElement('strong');
  totalValue.textContent = bin.total.toLocaleString();
  const totalName = document.createElement('span');
  totalName.textContent = 'Total';
  total.append(document.createElement('span'), totalValue, totalName);
  tip.replaceChildren(head, ...rows, total);
  tip.hidden = false;
  // Keep the tooltip inside the chart: anchor left or right of the column.
  const left = x > width * 0.6;
  tip.style.left = left ? '' : `${x + 14}px`;
  tip.style.right = left ? `${width - x + 14}px` : '';
}

function hideTip(tip, column) {
  column.classList.remove('is-active');
  tip.hidden = true;
}
