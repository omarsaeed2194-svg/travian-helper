// The brain's building plan: an ordered list of goals for each kind of
// village (all fields to a level, a building to a level) and the next step
// towards the first goal not reached yet. A building whose prerequisites
// are missing is no dead end: they are built first (and theirs, in turn).
// A goal that can't move now (refused by the game a moment ago, waiting for
// a level that is being built, no free site, ruled out by another
// building) is passed over for the next one, so a village never stalls
// behind one building. Prerequisites come from the game's own pages once
// it has shown them (account.buildReqs), else from the rules below. Among
// fields of the same level, the resource the next buildings need most (in
// hours of production) goes up first. Pure.
import { FIELD_RESOURCE, RESOURCES } from './shared.js';
import { wallGid } from './autopilot.js';
import { costOf } from './culture.js';

// What each building needs first: { gid: level }. 1–4 are resource fields
// (one field of that kind at the level).
export const REQS = {
  5: { 1: 10, 15: 5 }, 6: { 2: 10, 15: 5 }, 7: { 3: 10, 15: 5 }, 8: { 4: 5 }, 9: { 4: 10, 8: 5, 15: 5 },
  10: { 15: 1 }, 11: { 15: 1 }, 13: { 15: 3, 22: 1 }, 14: { 16: 15 }, 17: { 10: 1, 11: 1, 15: 3 },
  18: { 15: 1 }, 19: { 16: 1, 15: 3 }, 20: { 22: 5, 13: 3 }, 21: { 22: 10, 15: 5 }, 22: { 19: 3, 15: 3 },
  24: { 22: 10, 15: 10 }, 25: { 15: 5 }, 26: { 15: 5, 18: 1 }, 27: { 15: 10 }, 28: { 20: 10, 17: 20 },
  29: { 19: 20 }, 30: { 20: 20 }, 34: { 15: 5 }, 35: { 11: 20, 16: 10 }, 36: { 16: 1 }, 37: { 15: 3, 16: 1 },
  38: { 15: 10 }, 39: { 15: 10 }, 41: { 16: 10, 20: 20 }, 44: { 15: 5 }, 45: { 37: 10 },
  46: { 15: 10, 22: 15 }, 48: { 15: 10, 22: 15 },
};
// One of these per village: each rules out the others.
const EXCLUDES = { 25: [26, 44], 26: [25, 44], 44: [25, 26] };
// Never built by the brain (the Wonder of the World needs a special village).
const NEVER = new Set([40]);
const RALLY = 16;
const SPARTANS = 70;
export const maxLevel = (gid) => (gid >= 5 && gid <= 9 ? 5 : gid === 23 ? 10 : 20);

// Build orders, step by step: ['f', N] = every resource field to N;
// [gid, N] = that building to N ('wall' and 'hospital' depend on the tribe).
const GOALS = {
  economy: [
    ['f', 2], [15, 3], [RALLY, 1], [10, 3], [11, 3], [23, 3],
    ['f', 4], [15, 5], [17, 1], [19, 1], ['wall', 3], [10, 7], [11, 7],
    ['f', 6], [22, 1], [15, 10], [8, 5], [17, 5], ['wall', 8], [10, 12], [11, 12],
    ['f', 8], [19, 5], [22, 5], [13, 1],
    ['f', 10], [5, 5], [6, 5], [7, 5], [9, 5], [10, 16], [11, 16], [15, 15], ['wall', 15], [17, 10],
    [10, 20], [11, 20], [15, 20], ['wall', 20],
  ],
  military: [
    ['f', 2], [15, 3], [RALLY, 1], [10, 3], [11, 3], [19, 3],
    ['f', 4], [15, 5], [22, 1], [17, 1], [10, 7], [11, 7], [13, 1], [22, 5], [13, 3], [20, 1],
    ['f', 6], [19, 5], [20, 5], ['wall', 5], [15, 10], [8, 5], [10, 12], [11, 12], [RALLY, 5],
    ['f', 8], [19, 10], [20, 10], [13, 10], [22, 10], [21, 1], [RALLY, 10], ['wall', 10],
    ['f', 10], [9, 5], [13, 20], [19, 15], [20, 15], [21, 10], ['hospital', 1],
    [10, 20], [11, 20], [15, 20], [19, 20], [20, 20], ['wall', 20],
  ],
};

export const hospitalGid = (base) => (base === SPARTANS ? 48 : 46);

// The goals for a village, with the tribe's own wall and hospital; the
// capital (with the Palace) takes its fields further at the end.
export function goalsFor(role, v, base) {
  const list = GOALS[role] || GOALS.economy;
  const out = [];
  for (const [g, n] of list) {
    if (g === 'f') { out.push({ fields: n }); continue; }
    const gid = g === 'wall' ? wallGid(base) : g === 'hospital' ? hospitalGid(base) : g;
    if (gid) out.push({ gid, level: Math.min(n, maxLevel(gid)) });
  }
  if ((v.buildings || []).some((b) => b.gid === 26 && b.level > 0)) out.push({ fields: 12 });
  return out;
}

// Prerequisites for a building: the game's own list when it has shown one.
export function needsOf(gid, learned = {}) {
  const l = learned[gid];
  return l && l.need ? l.need : REQS[gid] || {};
}

// Learned from an empty site's page: each contract's prerequisites, and the
// buildings that rule it out. A building named without a level (the Wonder
// of the World) can't be had.
export function learnReqs(prev = {}, contracts = [], now = Date.now()) {
  const out = { ...prev };
  for (const c of contracts) {
    if (!c.gid || !Array.isArray(c.needs) || !c.needs.length) continue;
    const need = {};
    const not = [];
    for (const n of c.needs) {
      if (n.not) not.push(n.gid);
      else need[n.gid] = Math.max(need[n.gid] || 0, n.level || 1);
    }
    out[c.gid] = { need, not, at: now };
  }
  return out;
}

// Next step for one village: { step, goal, passed } where step is the
// upgrade ({ slot, gid, level, construct?, why: 'goal' | 'needed', forGid,
// forLevel }) and passed lists the goals skipped over and why.
export function nextBuild(v, { role = 'economy', base = null, learned = {}, skipSlots = [], skipGids = [], goals = null } = {}) {
  const fields = v.fields || [];
  const buildings = v.buildings || [];
  const prod = (v.resources && v.resources.production) || {};
  const usable = (b) => !b.underConstruction && !b.maxLevel && !skipSlots.includes(b.slot);
  // Levels done, and with what is being built counted (so nothing is picked twice).
  const done = (gid) => {
    const list = gid <= 4 ? fields : buildings;
    return Math.max(0, ...list.filter((b) => b.gid === gid).map((b) => b.level || 0));
  };
  const soon = (gid) => {
    const list = gid <= 4 ? fields : buildings;
    return Math.max(0, ...list.filter((b) => b.gid === gid).map((b) => (b.level || 0) + (b.underConstruction ? 1 : 0)));
  };
  const freeSite = () => {
    const site = buildings.filter((b) => !b.gid && b.slot >= 19 && b.slot <= 38 && !skipSlots.includes(b.slot)).sort((a, b) => a.slot - b.slot)[0];
    return site ? site.slot : null;
  };
  const special = (gid) => (gid === RALLY ? 39 : gid === wallGid(base) ? 40 : null);
  const list = goals || goalsFor(role, v, base);
  const met = (g) => (g.fields != null ? fields.length > 0 && fields.every((f) => f.level >= g.fields || f.maxLevel) : done(g.gid) >= g.level);
  // What the next buildings in the plan cost, in hours of what the village
  // makes: among fields of the same level, the resource furthest behind
  // goes up first.
  const behind = {};
  for (const g of list.filter((x) => x.gid && !met(x)).slice(0, 3)) {
    const c = costOf(g.gid, done(g.gid) + 1) || {};
    for (const k of RESOURCES) behind[k] = (behind[k] || 0) + (c[k] || 0) / Math.max(1, prod[k] || 0);
  }
  const lag = (gid) => behind[FIELD_RESOURCE[gid]] || 0;

  // A step to reach `target`, or { wait } with the reason it can't move now.
  const resolve = (target, depth, chain) => {
    if (depth > 6) return { wait: 'deep' };
    if (target.fields != null) {
      const low = fields.filter((f) => f.level < target.fields);
      const pick = low.filter(usable).sort((a, b) => a.level - b.level || lag(b.gid) - lag(a.gid) ||
        (prod[FIELD_RESOURCE[a.gid]] || 0) - (prod[FIELD_RESOURCE[b.gid]] || 0) || a.slot - b.slot)[0];
      return pick ? { step: { slot: pick.slot, gid: pick.gid, level: pick.level } } : { wait: low.length ? 'building' : 'done' };
    }
    const { gid, level } = target;
    if (soon(gid) >= level) return { wait: done(gid) >= level ? 'done' : 'building' };
    if (gid <= 4) {
      // A resource field as a prerequisite: the one closest to the level.
      const pick = fields.filter((f) => f.gid === gid && f.level < level && usable(f)).sort((a, b) => b.level - a.level || a.slot - b.slot)[0];
      return pick ? { step: { slot: pick.slot, gid, level: pick.level } } : { wait: 'building' };
    }
    if (NEVER.has(gid) || chain.includes(gid)) return { wait: 'never' };
    if (skipGids.includes(gid)) return { wait: 'refused' };
    const l = learned[gid] || {};
    const rivals = [...(EXCLUDES[gid] || []), ...(l.not || [])];
    if (rivals.some((g) => done(g) > 0 || soon(g) > 0)) return { wait: 'excluded' };
    // Prerequisites first, in turn; one that can't move now doesn't stop the others.
    let wait = null;
    for (const [g, n] of Object.entries(needsOf(gid, learned))) {
      if (done(Number(g)) >= n) continue;
      const r = resolve({ gid: Number(g), level: n }, depth + 1, [...chain, gid]);
      if (r.step) return { step: { ...r.step, forGid: r.step.forGid || gid, forLevel: r.step.forLevel || level } };
      wait = wait || (r.wait === 'building' ? 'needsBuilding' : r.wait === 'done' ? 'needsBuilding' : r.wait);
    }
    if (wait) return { wait };
    const have = buildings.filter((b) => b.gid === gid).sort((a, b) => b.level - a.level)[0];
    if (have) {
      if (have.underConstruction) return { wait: 'building' };
      if (have.maxLevel || have.level >= maxLevel(gid)) return { wait: 'done' };
      if (skipSlots.includes(have.slot)) return { wait: 'refused' };
      return { step: { slot: have.slot, gid, level: have.level } };
    }
    const sp = special(gid);
    if (sp) {
      const b = buildings.find((x) => x.slot === sp);
      if (!b || b.gid || skipSlots.includes(sp)) return { wait: 'noSite' };
      return { step: { slot: sp, gid, level: 0, construct: true } };
    }
    const slot = freeSite();
    return slot ? { step: { slot, gid, level: 0, construct: true } } : { wait: 'noSite' };
  };

  const passed = [];
  for (const goal of list) {
    if (met(goal)) continue;
    const r = resolve(goal, 0, []);
    if (r.step) {
      const step = { ...r.step, why: r.step.forGid ? 'needed' : 'goal' };
      return { step, goal, passed };
    }
    if (r.wait !== 'done') passed.push({ goal, reason: r.wait });
    if (passed.length >= 12) break;
  }
  return { step: null, goal: null, passed };
}
