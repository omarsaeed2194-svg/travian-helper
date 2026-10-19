// New villages, one from every village: instead of taking one Residence to
// 20, each village takes its Residence (or Palace / Command Center) to 10
// and trains three settlers once — when a culture points slot is free —
// and the village they found does the same. Pure; the background acts on
// it and the Culture page shows it.
import { troopsHome, distance } from './autopilot.js';
import { unitKind } from './units.js';

export const SETTLERS = 3;
export const SLOT_LEVEL = 10;
const HOMES = [25, 26, 44]; // Residence, Palace, Command Center (Huns)
const RETRY_MS = 12 * 3600000;
const SENT_MS = 3 * 86400000; // settlers on their way: wait this long for the new village

const levelOf = (v, gid) => Math.max(0, ...(v.buildings || []).filter((b) => b.gid === gid).map((b) => b.level || 0));

// The building that trains settlers in a village (the highest of the three),
// or null.
export function settlerHome(v) {
  let best = null;
  for (const gid of HOMES) {
    const b = (v.buildings || []).filter((x) => x.gid === gid).sort((a, c) => (c.level || 0) - (a.level || 0))[0];
    if (b && (!best || (b.level || 0) > best.level)) best = { gid, slot: b.slot, level: b.level || 0, busy: !!b.underConstruction };
  }
  return best;
}

// Settlers at home and in training.
export function settlersOf(v, now = Date.now()) {
  const home = troopsHome(v).t10 || 0;
  let training = 0;
  for (const q of Object.values(v.trainingQueue || {})) {
    for (const it of q.items || []) if (unitKind(it.unit) === 'settler' && (!it.finishAt || it.finishAt > now)) training += it.count || 0;
  }
  return { home, training };
}

// Where to found the next village from `v`: the first of the player's own
// targets nobody has taken, else the nearest free valley the map showed.
export function targetFor(v, data, taken = new Set()) {
  const own = new Set(Object.values(data.villages || {}).map((x) => `${x.x}|${x.y}`));
  const mapTaken = new Set(Object.values(data.mapVillages || {}).map((x) => `${x.x}|${x.y}`));
  const free = (k) => !own.has(k) && !taken.has(k) && !mapTaken.has(k);
  for (const k of (data.settings.expansion || {}).targets || []) if (free(k)) {
    const [x, y] = k.split('|').map(Number);
    return { x, y, own: true };
  }
  if (v.x == null) return null;
  const list = Object.values(data.valleys || {}).filter((x) => free(`${x.x}|${x.y}`)).map((x) => ({ ...x, d: distance(x, v) })).sort((a, b) => a.d - b.d);
  return list[0] || null;
}

// The plan for every village: its step, what the autopilot or the bot
// should do there, and which villages are working on a new village now (one
// per free culture points slot, at least one).
//   step: founded | skipped | noSlot | sent | residence | waitSlot | train | training | ready | later
export function expansionPlan(data, now = Date.now()) {
  const s = data.settings.expansion || {};
  const state = data.expansion || {};
  const villages = Object.values(data.villages || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ex = (data.account || {}).expansion;
  const free = ex && ex.total != null ? Math.max(0, ex.total - ex.used) : 0;
  // Close to the next slot: settlers take hours to train, start already.
  const soon = !!ex && ex.pct != null && ex.pct >= 85;
  const rows = villages.map((v) => {
    const st = state[v.id] || {};
    const home = settlerHome(v);
    const set = settlersOf(v, now);
    let step;
    if (st.founded) step = 'founded';
    else if (st.skip) step = 'skipped';
    else if (st.noSlotAt && now - st.noSlotAt < RETRY_MS) step = 'noSlot';
    else if (set.home >= SETTLERS) step = 'ready';
    else if (st.readyCount && now - (st.readyAt || 0) < SENT_MS) step = 'sent';
    else if (set.home + set.training >= SETTLERS) step = 'training';
    else if (!home || home.level < SLOT_LEVEL) step = 'residence';
    else step = 'train';
    return { v, id: v.id, st, home, settlers: set, step };
  });
  // Settlers on their way hold a slot until the village is founded.
  const slotsFree = Math.max(0, free - rows.filter((r) => r.step === 'sent').length);
  // Who works on a new village now: ready and training first, then the
  // highest Residence, then the oldest village.
  const rank = { ready: 0, training: 1, train: 2, residence: 3 };
  const open = rows.filter((r) => r.step in rank).sort((a, b) => rank[a.step] - rank[b.step] || ((b.home && b.home.level) || 0) - ((a.home && a.home.level) || 0));
  const active = new Set(open.slice(0, Math.max(1, slotsFree)).map((r) => r.id));
  const taken = new Set();
  for (const r of rows) {
    if (!(r.step in rank)) continue;
    if (!active.has(r.id)) { r.step = 'later'; continue; }
    if (r.step === 'train' && !slotsFree && !soon) r.step = 'waitSlot';
    r.need = r.step === 'train' ? SETTLERS - r.settlers.home - r.settlers.training : 0;
    if (r.step === 'ready' || r.step === 'training' || r.step === 'train' || r.step === 'waitSlot') {
      r.target = targetFor(r.v, data, taken);
      if (r.target) taken.add(`${r.target.x}|${r.target.y}`);
    }
  }
  return { enabled: !!s.enabled, rows, active, slotsFree, slots: ex || null };
}

// For the autopilot: what to build in this village for the plan (the
// Residence up to 10, or the Main Building to 5 first), or null.
export function expansionBuild(v, plan, tribeBase = null) {
  const r = plan && plan.enabled && plan.rows.find((x) => x.id === v.id);
  if (!r || r.step !== 'residence' || !v.buildings) return null;
  if (r.home) {
    if (r.home.busy) return null;
    return { slot: r.home.slot, gid: r.home.gid, level: r.home.level, why: 'expansion' };
  }
  const main = (v.buildings || []).filter((b) => b.gid === 15).sort((a, b) => (b.level || 0) - (a.level || 0))[0];
  if (!main || (main.level || 0) < 5) return main && !main.underConstruction ? { slot: main.slot, gid: 15, level: main.level || 0, why: 'expansion' } : null;
  const site = v.buildings.filter((b) => !b.gid && b.slot >= 19 && b.slot <= 38).map((b) => b.slot).sort((a, b) => a - b)[0];
  return site ? { slot: site, gid: tribeBase === 60 ? 44 : 25, level: 0, why: 'expansion', construct: true } : null;
}

// Valley layouts the map names "{k.f1}" … "{k.f12}": wood-clay-iron-crop.
export const VALLEY_FIELDS = {
  1: '3-3-3-9', 2: '3-4-5-6', 3: '4-4-4-6', 4: '4-5-3-6', 5: '5-3-4-6', 6: '1-1-1-15',
  7: '4-4-3-7', 8: '3-4-4-7', 9: '4-3-4-7', 10: '3-5-4-6', 11: '4-3-5-6', 12: '5-4-3-6',
};

// A founding is noticed when the player has more villages than when this
// village's settlers were ready, and its settlers are gone.
export function foundedNow(st, v, villageCount, now = Date.now()) {
  if (!st || st.founded || !st.readyCount) return false;
  const set = settlersOf(v, now);
  return villageCount > st.readyCount && set.home < SETTLERS;
}
