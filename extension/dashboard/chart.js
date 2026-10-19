// Resources-in-stock line chart for one village (last 24 hours).
// Plain SVG: legend, direct end labels, a crosshair tooltip on hover and
// arrow keys, and a table view that carries every value without hovering.
import { RESOURCES, resLabel, fmtNum, fmtClock } from '../src/shared.js';
import { t, isRtl } from '../src/i18n.js';

const SVG = 'http://www.w3.org/2000/svg';
const HEIGHT = 230;
const M = { top: 14, bottom: 26, axis: 46, end: 70 }; // axis = y-label side, end = label side

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n)));

function niceMax(v) {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

export function renderStockChart(root, points) {
  root.textContent = '';
  if (!points || points.length < 2) {
    const p = document.createElement('p');
    p.className = 'muted small chart-empty';
    p.textContent = t('chart.empty');
    root.appendChild(p);
    return;
  }
  const rtl = isRtl();
  const width = Math.max(320, root.clientWidth || 640);
  const plotL = rtl ? M.end : M.axis;
  const plotR = width - (rtl ? M.axis : M.end);
  const plotT = M.top;
  const plotB = HEIGHT - M.bottom;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const caps = [...new Set(points[points.length - 1].c.filter(Boolean))];
  const yMax = niceMax(Math.max(...caps, ...points.flatMap((p) => p.s)));
  // Time runs in reading direction: right to left in Arabic.
  const xOf = (tt) => { const f = (tt - t0) / Math.max(1, t1 - t0); return rtl ? plotR - f * (plotR - plotL) : plotL + f * (plotR - plotL); };
  const yOf = (v) => plotB - (v / yMax) * (plotB - plotT);

  // Legend (always present: four series).
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  RESOURCES.forEach((k, i) => {
    const item = document.createElement('span');
    const key = document.createElement('i');
    key.className = `key s${i + 1}`;
    item.appendChild(key);
    item.appendChild(document.createTextNode(resLabel(k)));
    legend.appendChild(item);
  });
  root.appendChild(legend);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  root.appendChild(wrap);
  const svg = el('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: 'chart', role: 'img', tabindex: '0', 'aria-label': t('chart.title') }, wrap);

  // Gridlines + y ticks.
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    const y = yOf(v);
    el('line', { x1: plotL, x2: plotR, y1: y, y2: y, class: i === 0 ? 'baseline' : 'grid' }, svg);
    const label = el('text', { x: rtl ? plotR + 8 : plotL - 8, y: y + 4, class: 'tick', 'text-anchor': rtl ? 'start' : 'end' }, svg);
    label.textContent = compact(v);
  }
  // Capacity reference lines.
  caps.forEach((cap) => {
    const y = yOf(cap);
    el('line', { x1: plotL, x2: plotR, y1: y, y2: y, class: 'cap' }, svg);
    const label = el('text', { x: rtl ? plotR - 4 : plotL + 4, y: y - 4, class: 'tick cap-label', 'text-anchor': rtl ? 'end' : 'start' }, svg);
    label.textContent = caps.length > 1 ? (cap === points[points.length - 1].c[0] ? t('chart.capWarehouse') : t('chart.capGranary')) : t('chart.capacity');
  });
  // X ticks: four evenly spaced times.
  for (let i = 0; i <= 3; i++) {
    const tt = t0 + ((t1 - t0) / 3) * i;
    const label = el('text', { x: xOf(tt), y: HEIGHT - 6, class: 'tick', 'text-anchor': i === 0 ? (rtl ? 'end' : 'start') : i === 3 ? (rtl ? 'start' : 'end') : 'middle' }, svg);
    label.textContent = i === 3 ? t('ov.now') : fmtClock(tt);
  }

  // Lines, end dots, and direct labels at the "now" end.
  const ends = [];
  RESOURCES.forEach((k, i) => {
    const d = points.map((p, j) => `${j ? 'L' : 'M'}${xOf(p.t).toFixed(1)},${yOf(p.s[i]).toFixed(1)}`).join('');
    el('path', { d, class: `line s${i + 1}` }, svg);
    const last = points[points.length - 1];
    el('circle', { cx: xOf(last.t), cy: yOf(last.s[i]), r: 4, class: `dot s${i + 1}` }, svg);
    ends.push({ k, y: yOf(last.s[i]), v: last.s[i] });
  });
  // Direct labels only when they don't collide; the legend carries identity otherwise.
  const sorted = ends.slice().sort((a, b) => a.y - b.y);
  const clear = sorted.every((e, i) => i === 0 || e.y - sorted[i - 1].y >= 13);
  if (clear) {
    for (const e of ends) {
      const label = el('text', { x: rtl ? plotL - 8 : plotR + 8, y: e.y + 4, class: 'end-label', 'text-anchor': rtl ? 'end' : 'start' }, svg);
      label.textContent = resLabel(e.k);
    }
  }

  // Crosshair + tooltip.
  const cross = el('line', { y1: plotT, y2: plotB, class: 'crosshair', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);
  let idx = points.length - 1;
  const show = (i) => {
    idx = Math.max(0, Math.min(points.length - 1, i));
    const p = points[idx];
    const x = xOf(p.t);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    cross.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const head = document.createElement('div');
    head.className = 'tip-time';
    head.textContent = fmtClock(p.t);
    tip.appendChild(head);
    RESOURCES.forEach((k, i) => {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const key = document.createElement('i');
      key.className = `key s${i + 1}`;
      const val = document.createElement('b');
      val.textContent = fmtNum(p.s[i]);
      val.dir = 'ltr';
      const name = document.createElement('span');
      name.textContent = resLabel(k);
      row.append(key, val, name);
      tip.appendChild(row);
    });
    tip.hidden = false;
    const tipW = 150;
    let left = x + 12;
    if (left + tipW > width) left = x - tipW - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${plotT}px`;
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const x = clientX - box.left;
    let bestI = 0, bestD = Infinity;
    points.forEach((p, i) => { const dd = Math.abs(xOf(p.t) - x); if (dd < bestD) { bestD = dd; bestI = i; } });
    return bestI;
  };
  el('rect', { x: plotL, y: plotT, width: plotR - plotL, height: plotB - plotT, class: 'hit' }, svg);
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) hide(); });
  svg.addEventListener('focus', () => show(idx));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const step = (rtl ? -1 : 1) * (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
    if (step) { e.preventDefault(); show(idx + step); }
  });

  // Table view: every half hour, newest first.
  const details = document.createElement('details');
  details.className = 'chart-table';
  const summary = document.createElement('summary');
  summary.textContent = t('chart.table');
  details.appendChild(summary);
  const table = document.createElement('table');
  table.className = 'list';
  const head = table.insertRow();
  for (const h of [t('th.at'), ...RESOURCES.map(resLabel)]) { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); }
  let lastT = Infinity;
  for (const p of points.slice().reverse()) {
    if (lastT - p.t < 29 * 60 * 1000) continue;
    lastT = p.t;
    const row = table.insertRow();
    row.insertCell().textContent = fmtClock(p.t);
    p.s.forEach((v) => { const c = row.insertCell(); c.textContent = fmtNum(v); c.className = 'mono'; });
  }
  details.appendChild(table);
  root.appendChild(details);
}
