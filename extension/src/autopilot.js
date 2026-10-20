// Autopilot decisions, kept free of browser APIs so they can be tested:
// which upgrade to start next when the player queued nothing, and which
// oases a raid rule may hit.
import { RESOURCES, FIELD_RESOURCE, capacityFor, estimateStock } from './shared.js';
import { savingFor, bestCpUpgrade } from './culture.js';
import { expansionBuild } from './expansion.js';

const MAP_SIZE = 401; // standard Travian map, -200..200
export const MAP_EDGE = (MAP_SIZE - 1) / 2; // coordinates go from -200 to 200

// u21 (Phalanx) → t1: every tribe has a block of ten unit numbers.
export function unitField(unit) {
  if (unit === 'hero') return 't11';
  const n = Number(String(unit || '').replace(/^u/, ''));
  return n > 0 ? `t${((n - 1) % 10) + 1}` : null;
}

// Troops at home by form field (t1..t10); the hero is never counted.
export function troopsHome(v) {
  const out = {};
  for (const tr of v.troops || []) {
    const field = unitField(tr.unit);
    if (field && field !== 't11') out[field] = (out[field] || 0) + tr.count;
  }
  return out;
}

// Distance on a map that wraps around at the edges.
export function distance(a, b) {
  const wrap = (d) => Math.min(Math.abs(d), MAP_SIZE - Math.abs(d));
  return Math.hypot(wrap(a.x - b.x), wrap(a.y - b.y));
}

export const oasisKey = (x, y) => `${x}|${y}`;

const lowest = (list) => list.slice().sort((a, b) => a.level - b.level)[0] || null;

// Building categories on an empty site's page (build.php?id=N&category=C).
const MILITARY = new Set([12, 13, 14, 19, 20, 21, 22, 29, 30, 36, 37, 41, 46]);
const RESOURCE_BUILDINGS = new Set([5, 6, 7, 8, 9]);
export const buildCategory = (gid) => (RESOURCE_BUILDINGS.has(gid) ? 3 : MILITARY.has(gid) ? 2 : 1);

// Each tribe's wall (slot 40).
const WALLS = { 0: 31, 10: 32, 20: 33, 50: 42, 60: 43, 70: 47 };
export const wallGid = (tribeBase) => WALLS[tribeBase] || null;

// What every village needs, in order, with the levels the game asks for
// first and the average field level before it is worth the resources.
const ESSENTIAL = [
  { gid: 10, need: { 15: 1 }, minAvg: 2, fills: ['wood', 'clay', 'iron'] }, // warehouse
  { gid: 11, need: { 15: 1 }, minAvg: 2, fills: ['crop'] },                  // granary
  { gid: 16, need: {}, slot: 39, minAvg: 1 },           // rally point
  { gid: 23, need: {}, minAvg: 2 },                     // cranny
  { gid: 17, need: { 15: 3, 10: 1, 11: 1 }, minAvg: 3 }, // marketplace
  { gid: 19, need: { 15: 3, 16: 1 }, minAvg: 3 },       // barracks
  { gid: 'wall', need: {}, slot: 40, minAvg: 3 },
];

// A building the village is missing, on a free site, once the game would
// allow it; null when there is nothing to construct. Storage comes early
// when it is filling up.
export function pickConstruct(v, tribeBase = null, skip = [], now = Date.now(), skipGids = []) {
  if (!v.buildings || !v.buildings.length) return null;
  const has = (gid) => v.buildings.some((b) => b.gid === gid && (b.level > 0 || b.underConstruction));
  const level = (gid) => Math.max(0, ...v.buildings.filter((b) => b.gid === gid).map((b) => b.level || 0));
  // Only a site the game showed as empty counts; one missing from the data might not be.
  const empty = (slot) => { const b = v.buildings.find((x) => x.slot === slot); return !skip.includes(slot) && !!b && !b.gid; };
  const fields = v.fields || [];
  const avg = fields.length ? fields.reduce((n, f) => n + f.level, 0) / fields.length : 0;
  const sites = v.buildings.filter((b) => !b.gid && b.slot >= 19 && b.slot <= 38 && !skip.includes(b.slot)).map((b) => b.slot).sort((a, b) => a - b);
  const est = estimateStock(v, now);
  const filling = (list) => !!est && list.some((k) => est[k] / (capacityFor(v.resources, k) || Infinity) >= 0.8);
  for (const e of ESSENTIAL) {
    const gid = e.gid === 'wall' ? wallGid(tribeBase) : e.gid;
    if (!gid || has(gid) || skipGids.includes(gid) || (avg < (e.minAvg || 0) && !(e.fills && filling(e.fills)))) continue;
    if (Object.entries(e.need).some(([g, n]) => level(Number(g)) < n)) continue;
    const slot = e.slot ? (empty(e.slot) ? e.slot : null) : sites[0];
    if (slot) return { slot, gid, level: 0, why: 'construct', construct: true };
  }
  return null;
}

// The next upgrade for a village with nothing queued, or null. In order:
// a storage that is nearly full, crop when the village is close to
// starving, (new-village plan) the Residence to 10, (culture focus) saving
// for a celebration, missing basic buildings, (culture focus) the most
// culture points per resource, the Main Building when it lags behind the
// fields, then the lowest resource field (favouring the resource produced
// least).
export function pickAutoUpgrade(v, s, now = Date.now(), tribeBase = null, plan = null) {
  const ap = s.autopilot;
  const skip = v.autoSkip && v.autoSkip.until > now ? v.autoSkip.slots || [] : [];
  const free = (b) => b && !b.underConstruction && !b.maxLevel && !skip.includes(b.slot);
  const fields = (v.fields || []).filter(free);
  const buildings = (v.buildings || []).filter(free);
  const prod = (v.resources && v.resources.production) || {};
  const est = estimateStock(v, now);

  // 1. Storage almost full: more production would be thrown away.
  if (est) {
    for (const k of RESOURCES) {
      const cap = capacityFor(v.resources, k);
      if (!cap || est[k] / cap < 0.9) continue;
      const store = lowest(buildings.filter((b) => b.gid === (k === 'crop' ? 11 : 10) && b.level < 20));
      if (store) return { slot: store.slot, gid: store.gid, level: store.level, why: 'storage', res: k };
    }
  }

  const below = (f) => f.level < ap.fieldsMax;
  // 2. Crop margin too thin to keep troops fed.
  const total = (prod.wood || 0) + (prod.clay || 0) + (prod.iron || 0) + Math.max(0, prod.crop || 0);
  if (prod.crop != null && prod.crop < Math.max(5, total * 0.05)) {
    const crop = lowest(fields.filter((f) => FIELD_RESOURCE[f.gid] === 'crop' && below(f)));
    if (crop) return { slot: crop.slot, gid: crop.gid, level: crop.level, why: 'crop' };
  }

  // 2b. New-village plan: this village's Residence (or Palace) to 10.
  const skipGids = v.autoSkip && v.autoSkip.until > now ? v.autoSkip.gids || [] : [];
  const exp = expansionBuild(v, plan, tribeBase, { slots: skip, gids: skipGids });
  if (exp) return exp;

  // 3. Culture points focus, part 1: a celebration is due — save for it
  // (or first make the storage big enough to hold its cost).
  const cu = s.culture || {};
  if (cu.focus) {
    const failedLately = (v.celebrationFailAt || 0) > now - 12 * 3600000;
    const save = failedLately ? null : savingFor(v, cu.celebrate, now);
    if (save && save.tooSmall) {
      const short = RESOURCES.find((k) => (capacityFor(v.resources, k) || 0) < save.cost[k]);
      const store = lowest(buildings.filter((b) => b.gid === (short === 'crop' ? 11 : 10) && b.level < 20));
      if (store) return { slot: store.slot, gid: store.gid, level: store.level, why: 'celebration' };
    } else if (save) {
      return { saving: true, why: 'saving', kind: save.kind };
    }
  }

  // 4. A building the village still lacks (warehouse, rally point…).
  if (ap.construct) {
    const c = pickConstruct(v, tribeBase, skip, now, skipGids);
    if (c) return c;
  }

  // 5. Culture points focus, part 2: the most culture points per resource.
  if (cu.focus) {
    const cp = bestCpUpgrade(v, { skip, skipGids });
    if (cp) return cp;
  }

  // 6. Main Building keeps pace with the fields (it speeds up all building).
  const all = v.fields || [];
  const avg = all.length ? all.reduce((n, f) => n + f.level, 0) / all.length : 0;
  const main = lowest(buildings.filter((b) => b.gid === 15));
  if (main && main.level < Math.min(10, Math.floor(avg))) return { slot: main.slot, gid: 15, level: main.level, why: 'main' };

  // 7. Lowest field; among equals, the resource with the lowest production.
  const candidates = fields.filter(below);
  candidates.sort((a, b) => a.level - b.level ||
    (prod[FIELD_RESOURCE[a.gid]] || 0) - (prod[FIELD_RESOURCE[b.gid]] || 0) || a.slot - b.slot);
  const f = candidates[0];
  return f ? { slot: f.slot, gid: f.gid, level: f.level, why: 'fields' } : null;
}

// What a waiting upgrade still lacks, per resource, rounded up to whole
// hundreds (the hero's bag moves resources in any amount, but the stock
// estimate is never exact); null when the village already has enough.
export function bagShortfall(v, cost, now = Date.now()) {
  const est = estimateStock(v, now);
  if (!est || !cost) return null;
  const out = {};
  for (const k of RESOURCES) {
    const lack = (cost[k] || 0) - est[k];
    out[k] = lack > 0 ? Math.ceil(lack / 100) * 100 : 0;
  }
  return RESOURCES.some((k) => out[k] > 0) ? out : null;
}

// Oases a raid rule may hit now, nearest first: inside its radius, not owned,
// no animals seen at the last check, and not raided within the cool-down.
export function raidTargets(v, rule, oases, now = Date.now()) {
  const cooldown = Math.max(rule.everyMinutes || 30, 30) * 60000;
  const out = [];
  const seen = new Set();
  const add = (o) => {
    const key = oasisKey(o.x, o.y);
    if (seen.has(key)) return;
    seen.add(key);
    const d = distance(v, o);
    // Unknown distance (village coordinates not read yet) is never "inside".
    if (!(d <= rule.radius) && !o.manual) return;
    if (o.owned || o.notOasis) return;
    if (o.raidedAt && now - o.raidedAt < cooldown) return;
    // Animals seen recently: leave it for a while (they don't leave by themselves).
    if (o.animals > 0 && o.checkedAt && now - o.checkedAt < 3 * 3600000) return;
    out.push({ ...o, key, distance: d });
  };
  for (const tgt of rule.targets || []) add({ ...(oases[oasisKey(tgt.x, tgt.y)] || {}), x: tgt.x, y: tgt.y, manual: true });
  for (const o of Object.values(oases || {})) add(o);
  return out.sort((a, b) => a.distance - b.distance);
}

// ------------------------------------------------------------ farm lists ---
// Troops for one target: { t1: 5, t4: 2 } with whole positive numbers only
// (t1..t10; the hero never goes on farm runs).
export function cleanTroops(troops) {
  const out = {};
  for (const [f, n] of Object.entries(troops || {})) {
    const m = /^t(\d+)$/.exec(f);
    const v = Math.floor(Number(n));
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10 && v > 0) out[f] = v;
  }
  return out;
}

export const coversTroops = (home, troops) => Object.entries(troops).every(([f, n]) => (home[f] || 0) >= n);

// Targets to send to this round: switched on, with troops set, the ones
// waiting longest first (never sent = first), then in list order.
export function farmTargets(list) {
  return (list.targets || [])
    .map((tg, i) => ({ ...tg, order: i }))
    .filter((tg) => tg.enabled !== false && Object.keys(cleanTroops(tg.troops)).length)
    .sort((a, b) => (a.lastSentAt || 0) - (b.lastSentAt || 0) || a.order - b.order);
}

// Coordinates pasted one per line: "12|-34", "(12|−34) Name", "12,-34 name"…
// Travian copies coordinates with direction marks and a real minus sign.
export function parseCoordList(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/[−–]/g, '-').trim();
    if (!line) continue;
    const m = /^\(?\s*(-?\d{1,3})\s*[|,;/\s]\s*(-?\d{1,3})\s*\)?\s*(.*)$/.exec(line);
    if (!m) { out.push({ error: raw.trim() }); continue; }
    const x = Number(m[1]), y = Number(m[2]);
    if (Math.abs(x) > MAP_EDGE || Math.abs(y) > MAP_EDGE) { out.push({ error: raw.trim() }); continue; }
    out.push({ x, y, name: m[3].replace(/^[-–:·\s]+/, '').slice(0, 40) });
  }
  return out;
}
