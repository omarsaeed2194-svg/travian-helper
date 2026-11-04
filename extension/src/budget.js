// Each village's resources split between the army and the buildings at
// the player's ratio, and the troops the player wants it to reach.
//
// The split works like two purses inside the village's stores: the
// buildings' purse fills with (100 − army) % of what the village makes and
// is spent by building; everything else in the stores is the army's. So an
// army village at 80 % puts four fifths of its income into troops, and a
// building still goes up once its purse covers it (it doesn't need 20 % of
// the stores to pay for it).
//
// Troop targets: per kind (infantry from the barracks, cavalry from the
// stable, siege from the workshop) how many the village should have, and
// optionally which unit. Troops at home and in training count; the highest
// count of the last 12 hours stands in for troops that are out raiding.
// Pure.
import { RESOURCES, estimateStock, capacityFor } from './shared.js';
import { unitField } from './autopilot.js';
import { unitKind } from './units.js';

export const KINDS = { inf: [19, 29], cav: [20, 30], siege: [21] };
const PEAK_MS = 12 * 3600000;

// The player's choices for one village: { army, inf, cav, siege, infUnit, cavUnit, siegeUnit }.
export const villageCfg = (s, id) => (((s || {}).brain || {}).villages || {})[id] || {};

// Army share in % for a village: the player's number, else by role (the
// army village twice the general share), none while the village is small.
export function armyPct(v, role, s, stage = null) {
  const set = villageCfg(s, v.id).army;
  if (set !== '' && set != null && Number.isFinite(Number(set))) return Math.max(0, Math.min(100, Number(set)));
  if (role === 'off' || stage === 'start') return 0;
  const base = Math.max(5, Math.min(90, Number((s.brain || {}).armyShare) || 30));
  return role === 'military' ? Math.min(90, base * 2) : base;
}

// The buildings' purse after a new look at the stores: whatever came in
// since the last look (production, loot, merchants, the hero) is split by
// the village's ratio; what went out (troops, the player's own spending)
// comes off the army's part first. The brain's own buildings are paid from
// the purse when they start (see the build job).
export function laneUpdate(prev, res, pct, now = Date.now()) {
  if (!res || !res.stock) return prev || null;
  const stock = Object.fromEntries(RESOURCES.map((k) => [k, res.stock[k] || 0]));
  if (!prev || prev.pct !== pct || !prev.build || !prev.last) {
    return { pct, at: now, last: stock, build: Object.fromEntries(RESOURCES.map((k) => [k, Math.floor((stock[k] * (100 - pct)) / 100)])) };
  }
  const build = {};
  for (const k of RESOURCES) {
    const came = stock[k] - (prev.last[k] || 0);
    build[k] = Math.floor(Math.min(stock[k], (prev.build[k] || 0) + (came > 0 ? (came * (100 - pct)) / 100 : 0) + 1e-6));
  }
  return { pct, at: now, last: stock, build };
}

// The buildings' purse and the army's part now (estimated since the last look).
export function purses(v, now = Date.now()) {
  const est = estimateStock(v, now);
  const l = v.lanes;
  if (!est || !l || !l.build) return null;
  const keep = 1 - l.pct / 100;
  const h = Math.max(0, (now - l.at) / 3600000);
  const prod = (v.resources && v.resources.production) || {};
  const build = {}, army = {};
  for (const k of RESOURCES) {
    build[k] = Math.floor(Math.min(est[k], (l.build[k] || 0) + Math.max(0, prod[k] || 0) * keep * h));
    army[k] = Math.max(0, Math.floor(est[k] - build[k]));
  }
  return { build, army, stock: est, pct: l.pct };
}

// Can the buildings' purse pay `cost`? Else how long until it can.
export function buildBudget(v, cost, now = Date.now()) {
  const p = purses(v, now);
  if (!p || !cost || p.pct <= 0) return { ok: true };
  const prod = (v.resources && v.resources.production) || {};
  const keep = 1 - p.pct / 100;
  let wait = 0;
  for (const k of RESOURCES) {
    const lack = (cost[k] || 0) - p.build[k];
    if (lack <= 0) continue;
    // A resource about to overflow isn't held back.
    if (p.stock[k] >= 0.95 * (capacityFor(v.resources, k) || Infinity)) continue;
    const rate = Math.max(0, prod[k] || 0) * keep;
    wait = Math.max(wait, rate > 0 ? (lack / rate) * 3600000 : 6 * 3600000);
  }
  return wait ? { ok: false, waitMs: Math.min(6 * 3600000, Math.max(5 * 60000, wait)), purse: p.build } : { ok: true };
}

// The army's part as a share of the stores (the least of the four), 0..1.
export function armyRatio(v, now = Date.now()) {
  const p = purses(v, now);
  if (!p) return null;
  return Math.min(...RESOURCES.map((k) => (p.stock[k] > 0 ? p.army[k] / p.stock[k] : 1)));
}

// Which kind (inf / cav / siege) a unit belongs to in this village: by the
// building that trains it when known, else by what it is.
export function kindOf(v, field, unit) {
  for (const [kind, gids] of Object.entries(KINDS)) {
    if (gids.some((g) => ((v.units || {})[g] || []).some((u) => u.field === field))) return kind;
  }
  const k = unitKind(unit);
  return k === 'cav' ? 'cav' : k === 'ram' || k === 'cat' ? 'siege' : k === 'inf' ? 'inf' : null;
}

// Troops of each kind the village has now: at home (its own tribe's) and
// in training.
export function armyNow(v, base, now = Date.now()) {
  const out = { inf: 0, cav: 0, siege: 0 };
  const own = (unit) => {
    const n = Number(String(unit || '').replace(/^u/, ''));
    return base == null || (n > base && n <= base + 10);
  };
  for (const tr of v.troops || []) {
    if (tr.unit === 'hero' || !own(tr.unit)) continue;
    const k = kindOf(v, unitField(tr.unit), tr.unit);
    if (k) out[k] += tr.count || 0;
  }
  for (const [kind, gids] of Object.entries(KINDS)) {
    for (const g of gids) {
      for (const it of ((v.trainingQueue || {})[g] || {}).items || []) if (!it.finishAt || it.finishAt > now) out[kind] += it.count || 0;
    }
  }
  return out;
}

// The highest count of the last 12 hours, kept on the village.
export function peakUpdate(prev, counts, now = Date.now()) {
  const out = {};
  for (const k of Object.keys(KINDS)) {
    const p = prev && prev[k];
    out[k] = !p || now - p.at > PEAK_MS || counts[k] >= p.n ? { n: counts[k], at: now } : p;
  }
  return out;
}

// How far each kind is from the player's target: { inf: { have, want, left, unit } … }
// (only the kinds with a target).
export function targetsOf(v, s, base, now = Date.now()) {
  const cfg = villageCfg(s, v.id);
  const nowCount = armyNow(v, base, now);
  const out = {};
  for (const k of Object.keys(KINDS)) {
    const want = Math.max(0, Math.floor(Number(cfg[k]) || 0));
    if (!want) continue;
    const p = v.armyPeak && v.armyPeak[k];
    const have = Math.max(nowCount[k], p && now - p.at <= PEAK_MS ? p.n : 0);
    out[k] = { have, want, left: Math.max(0, want - have), unit: cfg[`${k}Unit`] || '' };
  }
  return out;
}
