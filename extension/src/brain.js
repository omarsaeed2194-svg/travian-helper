// The brain: a plan for every village from what the extension knows — its
// role (economy or army), how far along it is, how high its fields should
// go, whether to train troops now (which unit, how many) and which troops
// leave when an attack comes. Pure; the background acts on it within the
// player's limits (no gold, no attacks on players, a few actions a round)
// and logs every decision with its reason.
import { RESOURCES, capacityFor, estimateStock, sortedVillages } from './shared.js';
import { troopsHome } from './autopilot.js';

export const BARRACKS = 19;
export const STABLE = 20;
const PALACE = 26;

// Units each tribe trains for defence and for attack, per building, best
// first; the first one the village can train is used.
const UNITS = {
  0: { def: { 19: ['t2', 't1'], 20: ['t6'] }, off: { 19: ['t3', 't1'], 20: ['t5', 't6'] } },   // Romans
  10: { def: { 19: ['t2', 't1'], 20: ['t5'] }, off: { 19: ['t3', 't1'], 20: ['t6', 't5'] } },  // Teutons
  20: { def: { 19: ['t1'], 20: ['t5'] }, off: { 19: ['t2', 't1'], 20: ['t4', 't6'] } },        // Gauls
  50: { def: { 19: ['t2', 't1'], 20: ['t5'] }, off: { 19: ['t3', 't1'], 20: ['t6', 't5'] } },  // Egyptians
  60: { def: { 19: ['t1'], 20: ['t5'] }, off: { 19: ['t2', 't1'], 20: ['t4', 't6'] } },        // Huns
  70: { def: { 19: ['t3', 't1'], 20: ['t5'] }, off: { 19: ['t4', 't1'], 20: ['t6', 't5'] } },  // Spartans
};
// Units that attack far better than they defend, and siege: they leave
// when an attack comes. The rest stay and defend.
const OFFENSIVE = { 0: ['t3', 't5'], 10: ['t1', 't3', 't6'], 20: ['t2', 't4', 't6'], 50: ['t3', 't6'], 60: ['t2', 't4', 't6'], 70: ['t4', 't6'] };
const SIEGE = ['t7', 't8'];

export const unitPrefs = (base, kind, gid) => ((UNITS[base] || UNITS[0])[kind] || {})[gid] || [];
export const isOffensive = (field, base) => SIEGE.includes(field) || (OFFENSIVE[base] || OFFENSIVE[0]).includes(field);

const level = (v, gid) => Math.max(0, ...(v.buildings || []).filter((b) => b.gid === gid).map((b) => b.level || 0));
const avgField = (v) => { const f = v.fields || []; return f.length ? f.reduce((n, x) => n + (x.level || 0), 0) / f.length : 0; };
const cropMade = (v) => { const p = (v.resources && v.resources.production) || {}; return p.cropGross ?? p.crop ?? 0; };

// How full the stores are: the fullest resource, 0..1 (null when unknown).
export function storageFill(v, now = Date.now()) {
  const est = estimateStock(v, now);
  if (!est || !v.resources || !v.resources.capacity) return null;
  return Math.max(...RESOURCES.map((k) => est[k] / (capacityFor(v.resources, k) || Infinity)));
}

// start: fields below 3 on average; grow: below 7; strong: from there.
export function villageStage(v) {
  const a = avgField(v);
  return a < 3 ? 'start' : a < 7 ? 'grow' : 'strong';
}

// The player's choice, else: with three villages or more, the one making
// the most crop feeds the army; the others build the economy and defend.
export function villageRole(v, list, s) {
  const set = ((s.brain || {}).roles || {})[v.id];
  if (set && set !== 'auto') return set;
  if (list.length < 3) return 'economy';
  const best = list.reduce((a, b) => (cropMade(b) > cropMade(a) ? b : a));
  return best.id === v.id ? 'military' : 'economy';
}

// How high the autopilot takes this village's fields now: up with the
// village (only the capital, with the Palace, goes past 10).
export function fieldTarget(v) {
  const cap = level(v, PALACE) > 0 ? 12 : 10;
  return Math.min(cap, { start: 5, grow: 8, strong: cap }[villageStage(v)]);
}

const busyFor = (v, gid, now) => {
  const q = (v.trainingQueue || {})[gid];
  const ends = ((q && q.items) || []).map((i) => i.finishAt || 0);
  return ends.length ? Math.max(...ends) - now : 0;
};

// Troops to train now, or why not: { gid, fields, kind, share, why } or
// { skip }. Defence while attacked or in economy villages, attack units in
// the army village; only once the stores are filling (the economy first).
export function trainPick(v, role, base, s, now = Date.now()) {
  if (role === 'off') return { skip: 'roleOff' };
  const fill = storageFill(v, now);
  if (fill == null) return { skip: 'noStock' };
  const attacked = !!v.underAttack;
  const stage = villageStage(v);
  if (stage === 'start' && !attacked) return { skip: 'economyFirst' };
  const want = role === 'military' ? 0.35 : 0.6;
  if (fill < want && !attacked) return { skip: 'saving', fill };
  const kind = attacked || role !== 'military' ? 'def' : 'off';
  const order = role === 'military' && kind === 'off' ? [STABLE, BARRACKS] : [BARRACKS, STABLE];
  for (const gid of order) {
    if (level(v, gid) < 1) continue;
    if (busyFor(v, gid, now) > 3600000) continue; // an hour of training already queued
    const known = ((v.units || {})[gid] || []).map((u) => u.field);
    const prefs = unitPrefs(base, kind, gid);
    const fields = known.length ? [...prefs.filter((f) => known.includes(f)), ...known.filter((f) => !prefs.includes(f) && f !== 't10' && f !== 't9')] : prefs;
    if (!fields.length) continue;
    const why = attacked ? 'attacked' : role === 'military' ? 'army' : 'storageFull';
    return { gid, fields, kind, share: Math.max(5, Math.min(90, Number(s.brain.armyShare) || 30)) / 100, why, fill };
  }
  return { skip: level(v, BARRACKS) < 1 ? 'noBarracks' : 'queueFull' };
}

// When an attack is coming: the attack units at home leave for the nearest
// safe village (the defence stays). Null when there is nothing to move.
export function defensePlan(v, base) {
  if (!v.underAttack) return null;
  const home = troopsHome(v);
  const units = Object.keys(home).filter((f) => home[f] > 0 && isOffensive(f, base)).sort();
  if (!units.length) return null;
  return { villageId: v.id, targetVillageId: '', units, hero: true, leadSeconds: 90, troops: true, spend: null, donate: null, enabled: true, brain: true };
}

// The whole plan, village by village, for the dashboard and the bot.
export function brainPlan(data, s, now = Date.now(), base = null) {
  const list = sortedVillages(data.villages || {});
  return list.map((v) => {
    const role = villageRole(v, list, s);
    return { id: v.id, v, role, stage: villageStage(v), fieldsMax: fieldTarget(v), train: trainPick(v, role, base, s, now), defense: defensePlan(v, base) };
  });
}
