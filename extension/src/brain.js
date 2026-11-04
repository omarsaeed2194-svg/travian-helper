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
import { armyPct, armyRatio, targetsOf, KINDS } from './budget.js';

export const BARRACKS = 19;
export const STABLE = 20;
export const WORKSHOP = 21;
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
// A unit the brain may train for `kind` when its own picks aren't there:
// no scouts, chiefs or settlers, and no attack units for defence.
export const armyUnit = (field, base, kind) => field !== 't9' && field !== 't10' && fieldKind(field, base) !== 'scout' &&
  (kind === 'off' || !isOffensive(field, base));
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

// Troops to train now, or why not: { builds: [{ gid, fields, left, kind,
// exact }], kind, share, why, pct, crop } or { skip }. The army's part of
// the stores pays (the village's army % — see src/budget.js), in each
// training building with under two hours queued; with targets set, only
// the kinds still short of theirs, never past them. Defence in economy
// villages and under attack, attack units in the army village, the
// player's own unit where they chose one; never more than the crop feeds.
export function trainPick(v, role, base, s, now = Date.now()) {
  if (role === 'off') return { skip: 'roleOff' };
  const fill = storageFill(v, now);
  if (fill == null) return { skip: 'noStock' };
  const attacked = !!v.underAttack;
  const stage = villageStage(v);
  const pct = armyPct(v, role, s, stage);
  const targets = targetsOf(v, s, base, now);
  const aimed = Object.keys(targets).length > 0;
  if (aimed && !attacked && Object.values(targets).every((x) => !x.left)) return { skip: 'targetsDone', pct, targets };
  if (pct <= 0 && !attacked) return { skip: stage === 'start' ? 'economyFirst' : 'noArmyShare', pct };
  const ratio = armyRatio(v, now);
  const share = attacked ? Math.max(ratio ?? 0, pct / 100, 0.3) : ratio ?? pct / 100;
  const est = estimateStock(v, now);
  const sum = RESOURCES.reduce((n, k) => n + est[k], 0);
  const cap = RESOURCES.reduce((n, k) => n + (capacityFor(v.resources, k) || 0), 0);
  // Worth a batch once the army's part is 5 % of the stores' size.
  if (!attacked && share * sum < 0.05 * cap) return { skip: 'saving', fill, pct };
  const prod = (v.resources && v.resources.production) || {};
  const crop = prod.crop != null ? prod.crop : null;
  if (!attacked && crop != null && crop < 10) return { skip: 'cropLow', fill, pct };
  const military = role === 'military';
  const kind = attacked || !military ? 'def' : 'off';
  // Under attack: defence in barracks and stable, targets or not.
  const short = aimed && !attacked;
  const cats = short ? Object.keys(targets).filter((k) => targets[k].left > 0) : military && kind === 'off' ? ['cav', 'inf'] : ['inf', 'cav'];
  const builds = [];
  for (const cat of cats) {
    const gid = KINDS[cat][0];
    if (level(v, gid) < 1) continue;
    if (busyFor(v, gid, now) > 2 * 3600000) continue; // two hours of training already queued
    const chosen = short && targets[cat].unit;
    let fields;
    if (chosen) fields = [chosen];
    else {
      const known = ((v.units || {})[gid] || []).map((u) => u.field);
      const prefs = gid === WORKSHOP ? ['t7', 't8'] : unitPrefs(base, kind, gid);
      // Never scouts (the brain doesn't scout), chiefs or settlers; for
      // defence never an attack unit.
      fields = known.length ? [...prefs.filter((f) => known.includes(f)), ...known.filter((f) => !prefs.includes(f) && armyUnit(f, base, gid === WORKSHOP ? 'off' : kind))] : prefs;
    }
    if (fields.length) builds.push({ gid, fields, left: short ? targets[cat].left : null, kind: gid === WORKSHOP ? 'off' : kind, exact: !!chosen });
  }
  if (!builds.length) return { skip: level(v, BARRACKS) < 1 && !aimed ? 'noBarracks' : 'queueFull', pct };
  const why = attacked ? 'attacked' : aimed ? 'target' : military ? 'army' : 'share';
  return { builds, gid: builds[0].gid, kind, share, why, fill, pct, targets, crop: attacked ? null : crop };
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
