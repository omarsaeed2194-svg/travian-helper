// The brain: a plan for every village from what the extension knows — its
// role (economy or army), how far along it is, what to build next (its
// role's build order, prerequisites first: src/buildplan.js), whether to
// train troops now (which units, how many), what to research and improve,
// and which troops leave when an attack comes. Pure; the background acts on it within the
// player's limits (no gold, no attacks on players, a few actions a round)
// and logs every decision with its reason.
import { RESOURCES, capacityFor, estimateStock, sortedVillages } from './shared.js';
import { troopsHome, unitField } from './autopilot.js';
import { nextBuild } from './buildplan.js';
import { fieldKind } from './units.js';

export const BARRACKS = 19;
export const STABLE = 20;
export const ACADEMY = 22;
export const SMITHY = 13;
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

// Crop each unit eats an hour, roughly: foot 1, horse 3 (the most a
// horse unit eats; scouts and siege in between).
const UPKEEP = { inf: 1, scout: 2, cav: 3, ram: 3, cat: 6 };
export const upkeepOf = (field, base) => UPKEEP[fieldKind(field, base)] || 1;

// Troops to train now, or why not: { builds: [{ gid, fields }], kind,
// share, why, fill, crop } or { skip }. Defence while attacked or in
// economy villages, attack units in the army village, in every training
// building that has under an hour queued; only once the stores are filling
// (the economy first) and never more than the crop can feed.
export function trainPick(v, role, base, s, now = Date.now()) {
  if (role === 'off') return { skip: 'roleOff' };
  const fill = storageFill(v, now);
  if (fill == null) return { skip: 'noStock' };
  const attacked = !!v.underAttack;
  const stage = villageStage(v);
  if (stage === 'start' && !attacked) return { skip: 'economyFirst' };
  const military = role === 'military';
  const want = military ? 0.3 : 0.6;
  if (fill < want && !attacked) return { skip: 'saving', fill };
  const prod = (v.resources && v.resources.production) || {};
  const crop = prod.crop != null ? prod.crop : null;
  if (!attacked && crop != null && crop < 10) return { skip: 'cropLow', fill };
  const kind = attacked || !military ? 'def' : 'off';
  const order = military && kind === 'off' ? [STABLE, BARRACKS] : [BARRACKS, STABLE];
  const builds = [];
  for (const gid of order) {
    if (level(v, gid) < 1) continue;
    if (busyFor(v, gid, now) > 3600000) continue; // an hour of training already queued
    const known = ((v.units || {})[gid] || []).map((u) => u.field);
    const prefs = unitPrefs(base, kind, gid);
    const fields = known.length ? [...prefs.filter((f) => known.includes(f)), ...known.filter((f) => !prefs.includes(f) && f !== 't10' && f !== 't9')] : prefs;
    if (fields.length) builds.push({ gid, fields });
  }
  if (!builds.length) return { skip: level(v, BARRACKS) < 1 ? 'noBarracks' : 'queueFull' };
  const why = attacked ? 'attacked' : military ? 'army' : 'storageFull';
  const base100 = Math.max(5, Math.min(90, Number(s.brain.armyShare) || 30));
  // The army village spends twice the share on troops.
  const share = (military && !attacked ? Math.min(90, base100 * 2) : base100) / 100;
  return { builds, gid: builds[0].gid, kind, share, why, fill, crop: attacked ? null : crop };
}

// Units worth researching and improving: the role's own, best first
// (the economy defends; the army village attacks, and defends too).
export function wantedUnits(role, base) {
  const kinds = role === 'military' ? ['off', 'def'] : ['def'];
  const out = [];
  for (const k of kinds) for (const gid of [BARRACKS, STABLE]) for (const f of unitPrefs(base, k, gid)) if (!out.includes(f)) out.push(f);
  return out;
}

// What to research in the Academy (22) or improve in the Smithy (13) now:
// { gid, field, unit } or { gid, look } (its page wasn't read lately) or
// { skip }. Only once the economy is past its start and the stores fill.
export function researchPick(v, role, base, gid, now = Date.now()) {
  if (role === 'off') return { skip: 'roleOff' };
  if (level(v, gid) < 1) return { skip: 'noBuilding' };
  if (villageStage(v) === 'start') return { skip: 'economyFirst' };
  const r = (v.research || {})[gid];
  if (!r || now - (r.at || 0) > 6 * 3600000) return { gid, look: true };
  if ((r.busyUntil || 0) > now) return { skip: 'busy' };
  const fill = storageFill(v, now);
  if (fill == null || fill < (role === 'military' ? 0.3 : 0.5)) return { skip: 'saving', fill };
  const wanted = wantedUnits(role, base);
  const units = (r.units || []).map((u) => ({ ...u, field: u.field || unitField(u.unit) })).filter((u) => wanted.includes(u.field));
  if (gid === ACADEMY) {
    const u = units.filter((x) => x.can).sort((a, b) => wanted.indexOf(a.field) - wanted.indexOf(b.field))[0];
    return u ? { gid, field: u.field, unit: u.unit, name: u.name } : { skip: 'nothing' };
  }
  // Smithy: the wanted unit with the lowest level, up to the Smithy's own.
  const cap = level(v, SMITHY);
  const u = units.filter((x) => x.can && (x.level || 0) < cap)
    .sort((a, b) => (a.level || 0) - (b.level || 0) || wanted.indexOf(a.field) - wanted.indexOf(b.field))[0];
  return u ? { gid, field: u.field, unit: u.unit, name: u.name, level: u.level || 0 } : { skip: 'nothing' };
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

// The brain's build step for one village, for pickAutoUpgrade: the next
// step of its role's build order (prerequisites first), or null.
export function brainBuilder(role, base, learned) {
  if (role === 'off') return null;
  return (v, skipSlots, skipGids) => {
    const r = nextBuild(v, { role, base, learned, skipSlots, skipGids });
    return r.step ? { ...r.step, goal: r.goal } : null;
  };
}

const skipsOf = (v, now) => (v.autoSkip && v.autoSkip.until > now ? v.autoSkip : {});

// The whole plan, village by village, for the dashboard and the bot.
export function brainPlan(data, s, now = Date.now(), base = null) {
  const list = sortedVillages(data.villages || {});
  const learned = (data.account || {}).buildReqs || {};
  return list.map((v) => {
    const role = villageRole(v, list, s);
    const sk = skipsOf(v, now);
    return {
      id: v.id, v, role, stage: villageStage(v), fieldsMax: fieldTarget(v),
      build: role === 'off' ? null : nextBuild(v, { role, base, learned, skipSlots: sk.slots || [], skipGids: sk.gids || [] }),
      train: trainPick(v, role, base, s, now),
      research: [ACADEMY, SMITHY].map((gid) => ({ gid, ...researchPick(v, role, base, gid, now) })),
      defense: defensePlan(v, base),
    };
  });
}
