import { drawFrame, el, MARGIN, showTip, xLabel } from './chart-axes.js';

/**
 * A single-series line chart: a 2px line with a faint area wash, broken where a value is
 * unknown (null). A crosshair snaps to the nearest bin; the chart is focusable and the arrow
 * keys step through bins. Colour comes from CSS (`.line-<id>`).
 */

/** Path through the points, restarting after every null so unknown values show as gaps. */
function linePath(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.value == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p.x},${p.y}`;
    pen = true;
  }
  return d;
}

/** The same runs, closed down to the baseline, for the area wash. */
function areaPath(points, baseline) {
  const runs = [];
  let current = [];
  for (const p of points) {
    if (p.value == null) {
      if (current.length) runs.push(current);
      current = [];
    } else current.push(p);
  }
  if (current.length) runs.push(current);
  return runs
    .map((run) => `M${run[0].x},${baseline}${run.map((p) => `L${p.x},${p.y}`).join('')}L${run.at(-1).x},${baseline}Z`)
    .join('');
}

/**
 * @param container element the chart fills
 * @param bins      [{ ... }] in order; `value(bin)` gives the number or null
 * @param id        series id for colours (`.line-<id>`)
 * @param value     (bin) => number | null
 * @param format    (n) => short label for ticks
 * @param tick      (bin) => axis label
 * @param tooltip   (bin) => { heading, rows, total } for showTip
 * @param label     accessible name of the chart
 */
export function renderLineChart(container, { bins, id, value, format, tick, tooltip, label }) {
  const values = bins.map(value);
  const frame = drawFrame(container, { max: Math.max(0, ...values.filter((v) => v != null)), count: bins.length, formatTick: format });
  const { svg, tip, width, plotH, slot, y, labelled } = frame;
  const points = bins.map((bin, i) => {
    const v = values[i];
    return { x: MARGIN.left + i * slot + slot / 2, y: v == null ? null : y(v), value: v };
  });

  el('path', { d: areaPath(points, y(0)), class: `line-area line-${id}` }, svg);
  el('path', { d: linePath(points), class: `line-stroke line-${id}` }, svg);
  points.forEach((p, i) => {
    if (labelled(i)) xLabel(svg, p.x, tick(bins[i]));
  });

  // The newest known value gets an end dot, ringed in the surface colour.
  const last = [...points].reverse().find((p) => p.value != null);
  if (last) el('circle', { cx: last.x, cy: last.y, r: 4, class: `line-dot line-${id}` }, svg);

  const crosshair = el('line', { y1: MARGIN.top, y2: MARGIN.top + plotH, class: 'chart-crosshair', visibility: 'hidden' }, svg);
  const marker = el('circle', { r: 4, class: `line-dot line-${id}`, visibility: 'hidden' }, svg);

  let active = null;
  const show = (i) => {
    active = Math.max(0, Math.min(bins.length - 1, i));
    const p = points[active];
    crosshair.setAttribute('x1', p.x);
    crosshair.setAttribute('x2', p.x);
    crosshair.setAttribute('visibility', 'visible');
    if (p.value != null) {
      marker.setAttribute('cx', p.x);
      marker.setAttribute('cy', p.y);
      marker.setAttribute('visibility', 'visible');
    } else marker.setAttribute('visibility', 'hidden');
    showTip(tip, { ...tooltip(bins[active]), x: p.x, width });
  };
  const hide = () => {
    active = null;
    crosshair.setAttribute('visibility', 'hidden');
    marker.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };

  // One hit layer over the plot: the crosshair finds the nearest bin, so nobody aims at a 2px line.
  const hit = el('rect', { x: MARGIN.left, y: MARGIN.top, width: slot * bins.length, height: plotH, class: 'chart-hit', tabindex: 0 }, svg);
  hit.setAttribute('aria-label', `${label}. Use the arrow keys to read each period.`);
  hit.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    show(Math.floor((x - MARGIN.left) / slot));
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(bins.length - 1));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    show((active ?? bins.length - 1) + (event.key === 'ArrowRight' ? 1 : -1));
  });
}
