import { drawFrame, el, MARGIN, showTip, xLabel } from './chart-axes.js';

/**
 * A stacked column chart: one column per bin, one segment per series. Columns max 24px wide,
 * 2px surface gaps between segments, a 4px rounded top. Each column's whole slot is its
 * hover/focus target.
 */

const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** A rectangle whose top corners are rounded (the data end); the baseline stays square. */
function roundedTop(x, y, w, h) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param container element the chart fills (its width sets the chart's)
 * @param bins      [{ counts: { [seriesId]: n }, total }]
 * @param series    [{ id, label }], bottom to top; colours come from CSS (`.seg-<id>`)
 * @param tick      (bin) => axis label
 * @param title     (bin) => tooltip heading
 */
export function renderStackedChart(container, { bins, series, tick, title }) {
  const frame = drawFrame(container, { max: Math.max(...bins.map((b) => b.total)), count: bins.length });
  const { svg, tip, width, plotH, slot, y, yMax, labelled } = frame;
  const barW = Math.min(MAX_BAR, Math.max(2, slot * 0.7));

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
      if (j === visible.length - 1) el('path', { d: roundedTop(x, top, barW, drawn), class: `seg seg-${s.id}` }, column);
      else el('rect', { x, y: top, width: barW, height: drawn, class: `seg seg-${s.id}` }, column);
      base = top;
    });

    if (labelled(i)) xLabel(svg, x + barW / 2, tick(bin));

    // The hit target is the whole slot, not just the painted bar.
    const hit = el('rect', { x: MARGIN.left + i * slot, y: MARGIN.top, width: slot, height: plotH, class: 'chart-hit', tabindex: 0 }, column);
    hit.setAttribute('aria-label', `${title(bin)}: ${bin.total} runs, ${series.map((s) => `${bin.counts[s.id]} ${s.label.toLowerCase()}`).join(', ')}`);
    const show = () => {
      column.classList.add('is-active');
      showTip(tip, {
        heading: title(bin),
        rows: [...series].reverse().map((s) => ({ value: bin.counts[s.id].toLocaleString(), label: s.label, keyClass: `seg-${s.id}` })),
        total: { value: bin.total.toLocaleString(), label: 'Total' },
        x: x + barW / 2,
        width,
      });
    };
    const hide = () => {
      column.classList.remove('is-active');
      tip.hidden = true;
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
  });
}
