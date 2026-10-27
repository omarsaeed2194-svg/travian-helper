// Culture points: what each building produces, what the next level costs,
// which upgrade buys the most culture points per resource, celebrations,
// and how fast the account moves towards its next village. Pure.
import { RESOURCES, estimateStock, capacityFor } from './shared.js';

// Culture points per day of a building at level L: round(base × 1.2^L).
// Bases checked against the game's own pages (cranny, warehouse, granary 1;
// residence 2; marketplace 3; embassy 4; town hall, palace 5; treasury 6).
const CP_BASE = {
  1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 2, 13: 2, 14: 1, 15: 2, 16: 1, 17: 3, 18: 4,
  19: 1, 20: 2, 21: 3, 22: 4, 23: 1, 24: 5, 25: 2, 26: 5, 27: 6, 28: 3, 29: 1, 30: 2, 31: 1, 32: 1, 33: 1, 34: 1, 35: 4,
  36: 1, 37: 1, 38: 1, 39: 1, 41: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1,
};
export const cpAt = (gid, level) => (level > 0 ? Math.round((CP_BASE[gid] ?? 1) * 1.2 ** level) : 0);

// Building costs: level-1 cost × k^(level-1), rounded to 5.
const COST = {
  1: [40, 100, 50, 60, 1.67], 2: [80, 40, 80, 50, 1.67], 3: [100, 80, 30, 60, 1.67], 4: [70, 90, 70, 20, 1.67],
  5: [520, 380, 290, 90, 1.8], 6: [440, 480, 320, 50, 1.8], 7: [200, 450, 510, 120, 1.8], 8: [500, 440, 380, 1240, 1.8], 9: [1200, 1480, 870, 1600, 1.8],
  10: [130, 160, 90, 40, 1.28], 11: [80, 100, 70, 20, 1.28], 13: [130, 210, 410, 130, 1.28], 14: [1750, 2250, 1530, 240, 1.28],
  15: [70, 40, 60, 20, 1.28], 16: [110, 160, 90, 70, 1.28], 17: [80, 70, 120, 70, 1.28], 18: [180, 130, 150, 80, 1.28],
  19: [210, 140, 260, 120, 1.28], 20: [260, 140, 220, 100, 1.28], 21: [460, 510, 600, 320, 1.28], 22: [220, 160, 90, 40, 1.28],
  23: [40, 50, 30, 10, 1.28], 24: [1250, 1110, 1260, 600, 1.28], 25: [580, 460, 350, 180, 1.28], 26: [550, 800, 750, 250, 1.28],
  27: [2880, 2740, 2580, 990, 1.26], 28: [1400, 1330, 1200, 400, 1.28], 29: [630, 420, 780, 360, 1.28], 30: [780, 420, 660, 300, 1.28],
  31: [70, 90, 170, 70, 1.28], 32: [120, 200, 0, 80, 1.28], 33: [160, 100, 80, 60, 1.28], 34: [155, 130, 125, 70, 1.28],
  35: [1460, 930, 1250, 1740, 1.4], 36: [100, 100, 100, 100, 1.28], 37: [700, 670, 700, 240, 1.33], 38: [650, 800, 450, 200, 1.28],
  39: [400, 500, 350, 100, 1.28], 41: [780, 420, 660, 540, 1.28], 42: [110, 160, 70, 60, 1.28], 43: [50, 80, 40, 30, 1.28],
  44: [1600, 1250, 1050, 200, 1.22], 45: [910, 945, 910, 340, 1.31], 46: [320, 280, 420, 360, 1.28],
  47: [70, 90, 170, 70, 1.28], 48: [320, 280, 420, 360, 1.28], // Spartans: taken as the City Wall and the Hospital
};
export function costOf(gid, level) {
  const c = COST[gid];
  if (!c || level < 1) return null;
  const f = c[4] ** (level - 1);
  const r = (x) => Math.round((x * f) / 5) * 5;
  return { wood: r(c[0]), clay: r(c[1]), iron: r(c[2]), crop: r(c[3]) };
}
const total = (cost) => RESOURCES.reduce((n, k) => n + (cost[k] || 0), 0);

const MAX_LEVEL = { 23: 10, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5 };
const maxLevel = (gid) => MAX_LEVEL[gid] || 20;

// What has to stand before a building can be put up.
const NEEDS = {
  17: { 10: 1, 11: 1, 15: 3 }, 18: { 15: 1 }, 19: { 16: 1, 15: 3 }, 22: { 19: 3, 15: 3 }, 24: { 22: 10, 15: 10 }, 27: { 15: 10 },
};
// Buildings worth putting up for their culture points, in that order.
const CP_NEW = [18, 17, 19, 22, 24];

export const CELEBRATIONS = {
  small: { cost: { wood: 6400, clay: 6650, iron: 5940, crop: 1340 }, cp: 500, townHall: 1 },
  great: { cost: { wood: 29700, clay: 33250, iron: 32000, crop: 6700 }, cp: 2000, townHall: 10 },
};

const levelOf = (v, gid) => Math.max(0, ...(v.buildings || []).filter((b) => b.gid === gid).map((b) => b.level || 0));

// Culture points a village makes per day, from what's built (an estimate:
// artworks, celebrations and the hero's helmet aren't counted).
export function villageCp(v) {
  return [...(v.fields || []), ...(v.buildings || [])].reduce((n, b) => n + (b.gid ? cpAt(b.gid, b.level || 0) : 0), 0);
}

// The celebration a village should hold (or null): the kind chosen, if its
// Town Hall is high enough, else a small one.
export function celebrationFor(v, kind) {
  if (!kind || kind === 'off') return null;
  const th = levelOf(v, 24);
  if (th < 1) return null;
  const k = kind === 'great' && th >= CELEBRATIONS.great.townHall ? 'great' : 'small';
  return { kind: k, ...CELEBRATIONS[k] };
}

// Whether the village is saving for its next celebration: one is wanted,
// none is running, and the storage can hold its cost.
export function savingFor(v, kind, now = Date.now()) {
  const c = celebrationFor(v, kind);
  if (!c || (v.celebrationUntil || 0) > now || !v.resources) return null;
  const fits = RESOURCES.every((k) => (capacityFor(v.resources, k) || 0) >= c.cost[k]);
  return fits ? c : { ...c, tooSmall: true };
}

export function canAfford(v, cost, now = Date.now()) {
  const est = estimateStock(v, now);
  return !!est && RESOURCES.every((k) => est[k] >= (cost[k] || 0));
}

// The upgrade (or new building) with the most culture points per resource
// in a village. Looks two levels ahead so a level that rounds to no gain
// doesn't hide a good building. Skips what the storage can't pay for.
export function bestCpUpgrade(v, { skip = [], skipGids = [] } = {}) {
  if (!v.buildings) return null;
  // Each resource against its own store (warehouse, or granary for crop).
  const capOf = (k) => (v.resources ? capacityFor(v.resources, k) || Infinity : Infinity);
  const fits = (cost) => RESOURCES.every((k) => (cost[k] || 0) <= capOf(k));
  const score = (gid, from) => {
    const top = maxLevel(gid);
    if (from >= top) return null;
    const c1 = costOf(gid, from + 1);
    if (!c1 || !fits(c1)) return null;
    const to = Math.min(top, from + 2);
    let cost = total(c1);
    if (to > from + 1) cost += total(costOf(gid, to));
    const gain = cpAt(gid, to) - cpAt(gid, from);
    return gain > 0 ? { gain: cpAt(gid, from + 1) - cpAt(gid, from), score: gain / cost, cost: c1 } : null;
  };
  const out = [];
  for (const b of v.buildings) {
    if (!b.gid || b.underConstruction || b.maxLevel || skip.includes(b.slot) || skipGids.includes(b.gid)) continue;
    const s = score(b.gid, b.level || 0);
    if (s) out.push({ slot: b.slot, gid: b.gid, level: b.level || 0, why: 'culture', ...s });
  }
  // New buildings on a free site, once the game allows them.
  const site = v.buildings.filter((b) => !b.gid && b.slot >= 19 && b.slot <= 38 && !skip.includes(b.slot)).map((b) => b.slot).sort((a, b) => a - b)[0];
  if (site) {
    for (const gid of CP_NEW) {
      if (levelOf(v, gid) > 0 || v.buildings.some((b) => b.gid === gid) || skipGids.includes(gid)) continue;
      if (Object.entries(NEEDS[gid] || {}).some(([g, n]) => levelOf(v, Number(g)) < n)) continue;
      const s = score(gid, 0);
      if (s) out.push({ slot: site, gid, level: 0, why: 'culture', construct: true, ...s });
    }
  }
  out.sort((a, b) => b.score - a.score || total(a.cost) - total(b.cost));
  return out[0] || null;
}

// Pace towards the next village from the sidebar's progress bar: the
// share gained per hour over the recent looks, and when it reaches 100 %.
export function expansionEta(history, now = Date.now()) {
  const list = (history || []).filter((h) => h && h.pct != null);
  if (list.length < 2) return null;
  const last = list[list.length - 1];
  // Same slot count only: the bar starts over when a slot opens.
  const same = list.filter((h) => h.total === last.total && last.at - h.at <= 3 * 86400000);
  const first = same[0];
  if (!first || last.at - first.at < 3600000 || last.pct <= first.pct) return null;
  const perHour = (last.pct - first.pct) / ((last.at - first.at) / 3600000);
  return { perHour, at: last.at + ((100 - last.pct) / perHour) * 3600000 };
}
