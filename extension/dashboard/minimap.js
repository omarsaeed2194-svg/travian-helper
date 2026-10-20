// Overview mini map: the player's villages, farm targets, oases the
// extension knows, raid targets and escape routes, drawn as an SVG.
import { esc } from '../src/ui.js';
import { sortedVillages } from '../src/shared.js';
import { t, coords } from '../src/i18n.js';

const WORLD = 401; // the map wraps around after 401 fields

// Coordinates relative to a centre, taking the shortest way round the world.
const wrap = (d) => ((((d + 200) % WORLD) + WORLD) % WORLD) - 200;

export function minimapSvg(data, scopeIds, size = 300) {
  const villages = sortedVillages(data.villages).filter((v) => v.x != null && v.y != null);
  if (!villages.length) return '';
  const c = villages.find((v) => scopeIds.has(v.id)) || villages[0];
  const at = (p) => ({ ...p, ux: c.x + wrap(p.x - c.x), uy: c.y + wrap(p.y - c.y) });
  const own = villages.map(at);
  const byId = Object.fromEntries(own.map((v) => [v.id, v]));
  const ownKey = new Set(own.map((v) => `${v.x}|${v.y}`));

  // Farm targets and raid targets (only of the villages shown).
  const farms = [];
  for (const l of data.farms || []) {
    if (!byId[l.villageId]) continue;
    for (const tg of l.targets || []) if (tg.x != null) farms.push({ ...at(tg), from: l.villageId, off: tg.enabled === false || l.enabled === false, list: l.name });
  }
  const raidKeys = new Set();
  for (const r of data.raids || []) for (const p of r.targets || []) raidKeys.add(`${p.x}|${p.y}`);

  // Fit the villages and farms; then add the oases that fall inside.
  const pts = [...own, ...farms];
  let minX = Math.min(...pts.map((p) => p.ux)), maxX = Math.max(...pts.map((p) => p.ux));
  let minY = Math.min(...pts.map((p) => p.uy)), maxY = Math.max(...pts.map((p) => p.uy));
  const span = Math.max(maxX - minX, maxY - minY, 14) + 6;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  minX = cx - span / 2; maxX = cx + span / 2; minY = cy - span / 2; maxY = cy + span / 2;
  const inside = (p) => p.ux >= minX && p.ux <= maxX && p.uy >= minY && p.uy <= maxY;
  const oases = Object.values(data.oases || {}).filter((o) => !o.notOasis && o.x != null).map(at).filter(inside)
    .filter((o) => !ownKey.has(`${o.x}|${o.y}`));

  // Field → pixel (y grows north in the game, down on screen).
  const k = size / span;
  const px = (p) => ((p.ux - minX) * k).toFixed(1);
  const py = (p) => ((maxY - p.uy) * k).toFixed(1);
  const r = Math.max(2.5, Math.min(7, k * 0.9));

  // Grid every 5, 10, 20 or 50 fields, depending on the zoom.
  const step = [5, 10, 20, 50, 100].find((s) => span / s <= 8) || 100;
  const grid = [];
  for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step) {
    const x = ((gx - minX) * k).toFixed(1);
    grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${size}" class="mm-grid${gx === 0 ? ' axis' : ''}"/>`);
  }
  for (let gy = Math.ceil(minY / step) * step; gy <= maxY; gy += step) {
    const y = ((maxY - gy) * k).toFixed(1);
    grid.push(`<line x1="0" y1="${y}" x2="${size}" y2="${y}" class="mm-grid${gy === 0 ? ' axis' : ''}"/>`);
  }

  const shown = (v) => scopeIds.has(v.id);
  const lines = [];
  for (const f of farms) if (shown(byId[f.from])) lines.push(`<line x1="${px(byId[f.from])}" y1="${py(byId[f.from])}" x2="${px(f)}" y2="${py(f)}" class="mm-farm-line"/>`);
  for (const p of data.escapes || []) {
    const from = byId[p.villageId], to = byId[p.targetVillageId];
    if (from && to && p.enabled !== false && shown(from)) lines.push(`<line x1="${px(from)}" y1="${py(from)}" x2="${px(to)}" y2="${py(to)}" class="mm-escape-line"/>`);
  }
  const title = (s) => `<title>${esc(s)}</title>`;
  const oasisMarks = oases.map((o) => {
    const raided = raidKeys.has(`${o.x}|${o.y}`);
    const a = typeof o.animals === 'object' && o.animals ? Object.values(o.animals).reduce((n, x) => n + (Number(x) || 0), 0) : Number(o.animals) || 0;
    const d = r * (raided ? 0.9 : 0.6);
    return `<g class="mm-oasis${raided ? ' raided' : ''}${o.owned ? ' owned' : ''}">${title(`${t('mm.oasis')} ${coords(o.x, o.y)}${a ? ` · ${t('mm.animals', { n: a })}` : ''}${raided ? ` · ${t('mm.raided')}` : ''}`)}<path d="M${px(o)} ${(py(o) - d).toFixed(1)}l${d} ${d}-${d} ${d}-${d}-${d}z"/></g>`;
  });
  const farmMarks = farms.map((f) => `<g class="mm-farm${f.off ? ' off' : ''}">${title(`${f.name || t('mm.farm')} ${coords(f.x, f.y)} · ${f.list}`)}<circle cx="${px(f)}" cy="${py(f)}" r="${(r * 0.6).toFixed(1)}"/></g>`);
  const villageMarks = own.map((v) => {
    const s = r * (shown(v) ? 1.35 : 1);
    return `<g class="mm-village${shown(v) ? ' on' : ''}${v.underAttack ? ' attacked' : ''}" data-filter="${esc(v.id)}" tabindex="0" role="button">${title(`${v.name} ${coords(v.x, v.y)}${v.underAttack ? ` · ${t('card.attack')}` : ''}`)}
      ${v.underAttack ? `<circle class="mm-ring" cx="${px(v)}" cy="${py(v)}" r="${(s * 1.9).toFixed(1)}"/>` : ''}
      <rect x="${(px(v) - s).toFixed(1)}" y="${(py(v) - s).toFixed(1)}" width="${(s * 2).toFixed(1)}" height="${(s * 2).toFixed(1)}" rx="${(s * 0.35).toFixed(1)}"/>
      ${own.length <= 12 ? `<text x="${px(v)}" y="${(py(v) - s - 4).toFixed(1)}" text-anchor="middle">${esc(v.name.length > 14 ? `${v.name.slice(0, 13)}…` : v.name)}</text>` : ''}
    </g>`;
  });
  const corner = (x, y) => `${Math.round(x)}|${Math.round(y)}`;
  const svg = `<svg class="minimap" viewBox="-14 -14 ${size + 28} ${size + 28}" role="img" aria-label="${esc(t('mm.title'))}">
    <rect x="0" y="0" width="${size}" height="${size}" class="mm-bg"/>
    ${grid.join('')}${lines.join('')}${oasisMarks.join('')}${farmMarks.join('')}${villageMarks.join('')}
    <text x="0" y="${size + 11}" class="mm-corner" direction="ltr">${corner(minX, minY)}</text>
    <text x="${size}" y="-5" class="mm-corner" text-anchor="end" direction="ltr">${corner(maxX, maxY)}</text>
  </svg>`;
  const legend = [
    ['mm-key village', t('mm.villages', { n: own.length })],
    farms.length ? ['mm-key farm', t('mm.farms', { n: farms.length })] : null,
    oases.length ? ['mm-key oasis', t('mm.oases', { n: oases.length })] : null,
    lines.some((l) => l.includes('mm-escape-line')) ? ['mm-key escape', t('mm.escapes')] : null,
    own.some((v) => v.underAttack) ? ['mm-key attacked', t('mm.attacked')] : null,
  ].filter(Boolean).map(([cls, label]) => `<span><i class="${cls}" aria-hidden="true"></i>${esc(label)}</span>`).join('');
  return `${svg}<div class="mm-legend">${legend}</div>`;
}
