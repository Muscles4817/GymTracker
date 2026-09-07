// Hand-rolled SVG charts. No library, so nothing to rot over the years.
//
// Design rules followed here (see the project README):
//   - one measure per plot, never a second y-axis
//   - single-series charts use categorical slot 1; the title names the series,
//     so no legend box is needed
//   - solid hairline grid + axes, thin marks, 4px rounded data-ends on bars
//   - a 2px surface gap between adjacent bars, a 2px surface ring on markers
//   - selective direct labels (endpoint / extreme only), never one per point
//   - every chart ships a table view; tooltips enhance, they never gate a value

import { esc, node, icon } from './ui.js';

const M = { t: 18, r: 16, b: 30, l: 48 };

// ---------------------------------------------------------------- scales

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const NICE_INTS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** integer: for counts (sets, reps) — a "1.5 sets" gridline is meaningless. */
function ticks(min, max, count = 4, integer = false) {
  if (max === min) {
    max = min + 1;
  }
  let step = niceStep((max - min) / count);
  if (integer) {
    step = NICE_INTS.find((v) => v >= step) ?? Math.ceil(step / 1000) * 1000;
  }
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return { values: out, lo, hi: out[out.length - 1] };
}

// Rounded only at the data end, anchored to the baseline.
function barPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0.5) return `M${x} ${y + h}h${w}`;
  return `M${x} ${y + h}V${y + rr}a${rr} ${rr} 0 0 1 ${rr} ${-rr}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h}Z`;
}

function hBarPath(x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w);
  if (w <= 0.5) return `M${x} ${y}v${h}`;
  return `M${x} ${y}h${w - rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - 2 * rr}a${rr} ${rr} 0 0 1 ${-rr} ${rr}H${x}Z`;
}

const axisLabel = (x, y, text, anchor = 'middle', cls = 'ax') =>
  `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;

function gridAndAxis(w, h, tk, fmtY) {
  const span = tk.hi - tk.lo || 1;
  const yOf = (v) => M.t + (h - M.t - M.b) * (1 - (v - tk.lo) / span);
  let out = '';
  for (const v of tk.values) {
    const y = yOf(v);
    out += `<line class="grid" x1="${M.l}" y1="${y}" x2="${w - M.r}" y2="${y}"/>`;
    out += axisLabel(M.l - 8, y + 3.5, fmtY(v), 'end');
  }
  out += `<line class="axis" x1="${M.l}" y1="${h - M.b}" x2="${w - M.r}" y2="${h - M.b}"/>`;
  return { markup: out, yOf };
}

// ---------------------------------------------------------------- card shell

/**
 * Mount a chart that re-renders at its true pixel width (so labels never shrink)
 * and carries a table-view twin.
 *
 * render(width) -> svg inner markup, using the `hit` class + data-tip for hover.
 */
export function chartCard({ title, subtitle = '', height = 200, render, table, note = '' }) {
  const card = node(`
    <section class="card chart-card">
      <header class="chart-head">
        <div>
          <h3 class="chart-title">${esc(title)}</h3>
          ${subtitle ? `<p class="chart-sub">${esc(subtitle)}</p>` : ''}
        </div>
        ${table ? `<button class="icon-btn chart-toggle" type="button" aria-label="Show data table" title="Show data table">${icon('list')}</button>` : ''}
      </header>
      <div class="chart-plot"><div class="chart-tip" hidden></div></div>
      ${note ? `<p class="chart-note">${esc(note)}</p>` : ''}
      <div class="chart-table" hidden></div>
    </section>`);

  const plot = card.querySelector('.chart-plot');
  const tip = card.querySelector('.chart-tip');
  const tableWrap = card.querySelector('.chart-table');

  const draw = () => {
    const w = Math.max(240, Math.round(plot.clientWidth || card.clientWidth || 320));
    const inner = render(w, height);
    plot.insertAdjacentHTML(
      'afterbegin',
      `<svg class="chart" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img" aria-label="${esc(title)}">${inner}</svg>`
    );
    const old = plot.querySelectorAll('svg.chart');
    for (let i = 1; i < old.length; i++) old[i].remove();
  };

  // Tooltip: pointer events on the generous .hit rects, not on the marks.
  plot.addEventListener('pointerover', (ev) => {
    const hit = ev.target.closest('.hit');
    if (!hit) return;
    tip.innerHTML = hit.dataset.tip || '';
    tip.hidden = false;
    const px = Number(hit.dataset.tx || 0);
    const py = Number(hit.dataset.ty || 0);
    const bounds = plot.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(bounds.width - tip.offsetWidth - 4, px - tip.offsetWidth / 2)) + 'px';
    tip.style.top = Math.max(0, py - tip.offsetHeight - 10) + 'px';
    plot.querySelectorAll('.mark-active').forEach((m) => m.classList.remove('mark-active'));
    hit.classList.add('mark-active');
  });
  plot.addEventListener('pointerleave', () => {
    tip.hidden = true;
    plot.querySelectorAll('.mark-active').forEach((m) => m.classList.remove('mark-active'));
  });

  if (table) {
    const btn = card.querySelector('.chart-toggle');
    btn.addEventListener('click', () => {
      const showing = !tableWrap.hidden;
      if (showing) {
        tableWrap.hidden = true;
        plot.hidden = false;
        btn.setAttribute('aria-label', 'Show data table');
      } else {
        const t = table();
        tableWrap.innerHTML = `
          <table class="data-table">
            <thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${t.rows
              .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
              .join('')}</tbody>
          </table>`;
        tableWrap.hidden = false;
        plot.hidden = true;
        btn.setAttribute('aria-label', 'Show chart');
      }
    });
  }

  // Redraw on width change (rotation, sidebar, window resize).
  const ro = new ResizeObserver(() => draw());
  requestAnimationFrame(() => {
    draw();
    ro.observe(plot);
  });
  card._destroy = () => ro.disconnect();
  return card;
}

// ---------------------------------------------------------------- vertical bars

/**
 * data: [{ label, value, tip }] — one measure, one color.
 * Direct-labels the maximum bar only; the axis and tooltip carry the rest.
 */
export function verticalBars({ data, fmtValue = (v) => String(v), fmtY = (v) => String(v), everyNthLabel = 1, integerY = false }) {
  return (w, h) => {
    if (!data.length) return emptyPlot(w, h, 'No data yet');
    const max = Math.max(...data.map((d) => d.value), 0);
    const tk = ticks(0, max || 1, 4, integerY);
    const { markup: chrome, yOf } = gridAndAxis(w, h, tk, fmtY);

    const plotW = w - M.l - M.r;
    const band = plotW / data.length;
    const barW = Math.max(3, Math.min(46, band - 2)); // 2px surface gap between bars
    const base = yOf(tk.lo);
    const maxIdx = data.reduce((bi, d, i) => (d.value > data[bi].value ? i : bi), 0);

    let bars = '';
    let hits = '';
    let labels = '';
    data.forEach((d, i) => {
      const cx = M.l + band * i + band / 2;
      const x = cx - barW / 2;
      const y = yOf(d.value);
      const bh = Math.max(0, base - y);
      bars += `<path class="bar" d="${barPath(x, y, barW, bh, 4)}"/>`;
      hits += `<rect class="hit" x="${M.l + band * i}" y="${M.t}" width="${band}" height="${h - M.b - M.t}" fill="transparent" data-tx="${cx}" data-ty="${y}" data-tip="${esc(d.tip || `${d.label}: ${fmtValue(d.value)}`)}"/>`;
      // Stride backwards from the last point: the newest label always shows and
      // no neighbour ever lands close enough to overlap it.
      if ((data.length - 1 - i) % everyNthLabel === 0) {
        labels += axisLabel(cx, h - M.b + 15, d.label);
      }
      if (i === maxIdx && d.value > 0) {
        labels += `<text class="direct" x="${cx}" y="${y - 7}" text-anchor="middle">${esc(fmtValue(d.value))}</text>`;
      }
    });
    return chrome + bars + labels + hits;
  };
}

// ---------------------------------------------------------------- line

/**
 * data: [{ label, value, tip }] in time order. One measure.
 * Direct-labels the last point; markers get a 2px surface ring.
 */
export function lineSeries({ data, fmtValue = (v) => String(v), fmtY = (v) => String(v), zeroBased = false, everyNthLabel = null, integerY = false }) {
  return (w, h) => {
    if (!data.length) return emptyPlot(w, h, 'No sessions logged yet');
    if (data.length === 1) return singlePoint(w, h, data[0], fmtValue);

    const vals = data.map((d) => d.value);
    const integer = integerY || vals.every((v) => Number.isInteger(v) && Math.abs(v) < 40);
    const lo = zeroBased ? 0 : Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || Math.max(1, hi * 0.05);
    const tk = ticks(zeroBased ? 0 : lo - pad, hi + pad, 4, integer);
    const { markup: chrome, yOf } = gridAndAxis(w, h, tk, fmtY);

    const plotW = w - M.l - M.r;
    const step = data.length > 1 ? plotW / (data.length - 1) : 0;
    const xOf = (i) => M.l + step * i;

    const pts = data.map((d, i) => [xOf(i), yOf(d.value)]);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

    const nth = everyNthLabel ?? Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 62))));
    let labels = '';
    let marks = '';
    let hits = '';
    const dense = data.length > 26;

    data.forEach((d, i) => {
      const [x, y] = pts[i];
      if ((data.length - 1 - i) % nth === 0) labels += axisLabel(x, h - M.b + 15, d.label);
      if (!dense || i === data.length - 1) {
        marks += `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`;
      }
      hits += `<rect class="hit" x="${(x - step / 2).toFixed(1)}" y="${M.t}" width="${Math.max(step, 24).toFixed(1)}" height="${h - M.b - M.t}" fill="transparent" data-tx="${x.toFixed(1)}" data-ty="${y.toFixed(1)}" data-tip="${esc(d.tip || `${d.label}: ${fmtValue(d.value)}`)}"/>`;
    });

    const last = data[data.length - 1];
    const [lx, ly] = pts[pts.length - 1];
    const anchor = lx > w - M.r - 44 ? 'end' : 'start';
    labels += `<text class="direct" x="${(anchor === 'end' ? lx - 8 : lx + 8).toFixed(1)}" y="${(ly - 9).toFixed(1)}" text-anchor="${anchor}">${esc(fmtValue(last.value))}</text>`;

    return `${chrome}<path class="line" d="${path}"/>${marks}${labels}${hits}`;
  };
}

function singlePoint(w, h, d, fmtValue) {
  const cx = w / 2;
  const cy = h / 2 - 6;
  return `
    <circle class="pt" cx="${cx}" cy="${cy}" r="5"/>
    <text class="direct" x="${cx}" y="${cy - 14}" text-anchor="middle">${esc(fmtValue(d.value))}</text>
    <text class="ax" x="${cx}" y="${cy + 24}" text-anchor="middle">${esc(d.label)}</text>
    <text class="ax" x="${cx}" y="${cy + 42}" text-anchor="middle">One session so far — the trend appears from the second</text>`;
}

// ---------------------------------------------------------------- horizontal bars

/**
 * Nominal categories, so every bar is one color (never a value ramp).
 * Values are labelled outside the bar end, so nothing is clipped.
 */
export function horizontalBars({ data, fmtValue = (v) => String(v), rowH = 26 }) {
  return (w) => {
    if (!data.length) return emptyPlot(w, rowH * 4, 'No sets logged in this window');
    const max = Math.max(...data.map((d) => d.value), 1);
    const labelW = Math.min(104, Math.max(70, ...data.map((d) => d.label.length * 7)));
    const valueW = 52;
    const trackW = Math.max(30, w - labelW - valueW - 12);
    let out = '';
    data.forEach((d, i) => {
      const y = i * rowH;
      const bh = rowH - 10; // leaves a 2px+ surface gap between adjacent bars
      const bw = (d.value / max) * trackW;
      out += `<text class="ax row-label" x="${labelW - 10}" y="${y + bh / 2 + 4}" text-anchor="end">${esc(d.label)}</text>`;
      out += `<path class="bar" d="${hBarPath(labelW, y + 1, bw, bh, 4)}"/>`;
      out += `<text class="direct" x="${labelW + bw + 8}" y="${y + bh / 2 + 4}" text-anchor="start">${esc(fmtValue(d.value))}</text>`;
      out += `<rect class="hit" x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent" data-tx="${labelW + bw}" data-ty="${y + 6}" data-tip="${esc(`${d.label}: ${fmtValue(d.value)}`)}"/>`;
    });
    return out;
  };
}

export const horizontalBarsHeight = (n, rowH = 26) => Math.max(rowH, n * rowH + 6);

// ---------------------------------------------------------------- calendar heatmap

/**
 * Sequential single-hue ramp (near-zero recedes toward the surface) + a scale
 * legend, so magnitude is never carried by an unlabelled color alone.
 */
export function calendarHeatmap({ days, valueByDay, fmtValue = (v) => String(v), weeks = 26 }) {
  return (w, h) => {
    const cell = 12;
    const gap = 3;
    const colW = cell + gap;
    const cols = Math.min(weeks, Math.max(8, Math.floor((w - 30) / colW)));
    const values = [...valueByDay.values()].filter((v) => v > 0);
    const peak = values.length ? Math.max(...values) : 1;
    const bucket = (v) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / peak) * 5)));

    // Column 0 = oldest week; each column is Mon..Sun top to bottom.
    const today = new Date();
    const todayDow = (today.getDay() + 6) % 7;
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - todayDow);

    let cells = '';
    let months = '';
    let lastMonth = -1;
    for (let c = 0; c < cols; c++) {
      const weekStart = new Date(lastMonday);
      weekStart.setDate(lastMonday.getDate() - (cols - 1 - c) * 7);
      const x = 30 + c * colW;
      if (weekStart.getMonth() !== lastMonth) {
        lastMonth = weekStart.getMonth();
        months += `<text class="ax" x="${x}" y="10" text-anchor="start">${weekStart.toLocaleDateString(undefined, { month: 'short' })}</text>`;
      }
      for (let r = 0; r < 7; r++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + r);
        if (d > today) continue;
        const p = (n) => String(n).padStart(2, '0');
        const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const v = valueByDay.get(key) || 0;
        const y = 18 + r * colW;
        const tipText = v > 0 ? `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} — ${fmtValue(v)}` : `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} — rest day`;
        cells += `<rect class="cell heat-${bucket(v)} hit" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" data-tx="${x + cell / 2}" data-ty="${y}" data-tip="${esc(tipText)}"/>`;
      }
    }
    const dowLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
      .map((l, r) => (l ? `<text class="ax" x="24" y="${18 + r * colW + 9.5}" text-anchor="end">${l}</text>` : ''))
      .join('');

    // Scale legend
    const legY = 18 + 7 * colW + 10;
    let legend = `<text class="ax" x="30" y="${legY + 9.5}" text-anchor="start">Less</text>`;
    for (let i = 0; i <= 5; i++) {
      legend += `<rect class="cell heat-${i}" x="${64 + i * colW}" y="${legY}" width="${cell}" height="${cell}" rx="2.5"/>`;
    }
    legend += `<text class="ax" x="${64 + 6 * colW + 4}" y="${legY + 9.5}" text-anchor="start">More (${fmtValue(peak)})</text>`;
    void h;
    return months + dowLabels + cells + legend;
  };
}

export const calendarHeatmapHeight = () => 18 + 7 * 15 + 10 + 12 + 8;

// ---------------------------------------------------------------- misc

function emptyPlot(w, h, message) {
  return `<text class="ax" x="${w / 2}" y="${h / 2}" text-anchor="middle">${esc(message)}</text>`;
}
