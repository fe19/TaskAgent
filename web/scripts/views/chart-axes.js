/** What every chart here shares: size, margins, round y-ticks, hairline grid, x labels, tooltip box. */

const SVG = 'http://www.w3.org/2000/svg';
export const HEIGHT = 220;
export const MARGIN = { top: 10, right: 10, bottom: 26, left: 40 };

export function el(name, attrs = {}, parent = null) {
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

/**
 * Empties `container` and draws the frame: an SVG at the container's width with the y grid and
 * tick labels. Returns what the marks need to place themselves.
 */
export function drawFrame(container, { max, count, formatTick = (t) => t.toLocaleString() }) {
  container.replaceChildren();
  const width = Math.max(280, container.clientWidth);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const ticks = niceTicks(max);
  const yMax = ticks.at(-1);
  const y = (value) => MARGIN.top + plotH - (value / yMax) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, role: 'img' }, container);
  const grid = el('g', { class: 'chart-grid' }, svg);
  for (const t of ticks) {
    el('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: y(t), y2: y(t), class: t === 0 ? 'chart-baseline' : '' }, grid);
    el('text', { x: MARGIN.left - 6, y: y(t), dy: '0.32em', 'text-anchor': 'end', class: 'chart-tick' }, grid).textContent =
      formatTick(t);
  }

  const slot = plotW / count;
  // Label only as many bins as fit, counted back from the newest so it is always labelled.
  const every = Math.ceil(count / Math.max(1, Math.floor(plotW / 52)));
  const labelled = (i) => (count - 1 - i) % every === 0;

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.append(tip);

  return { svg, tip, width, plotW, plotH, slot, y, yMax, labelled };
}

export function xLabel(svg, x, text) {
  el('text', { x, y: HEIGHT - 8, 'text-anchor': 'middle', class: 'chart-tick' }, svg).textContent = text;
}

/**
 * Fills the tooltip: a muted heading, then rows of `{ value, label, keyClass }` (values lead,
 * labels follow, a short line key in the series colour), then an optional total row.
 */
export function showTip(tip, { heading, rows, total = null, x, width }) {
  const p = (className, ...children) => {
    const node = document.createElement('p');
    node.className = className;
    node.append(...children);
    return node;
  };
  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };
  const row = ({ value, label, keyClass = '' }, extra = '') =>
    p(`chart-tip-row${extra}`, text('span', '', keyClass ? `chart-tip-key ${keyClass}` : ''), text('strong', value), text('span', label));

  tip.replaceChildren(
    text('p', heading, 'chart-tip-head'),
    ...rows.map((r) => row(r)),
    ...(total ? [row(total, ' chart-tip-total')] : []),
  );
  tip.hidden = false;
  // Keep the tooltip inside the chart: anchor left or right of the point.
  const flip = x > width * 0.6;
  tip.style.left = flip ? '' : `${x + 14}px`;
  tip.style.right = flip ? `${width - x + 14}px` : '';
}
