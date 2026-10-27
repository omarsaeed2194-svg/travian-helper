// Resource balance between the player's villages: which village has a
// resource piling up that another one is short of (suggestions for the
// player), and what the brain sends by itself (transferPlan). Pure.
import { RESOURCES, estimateStock, capacityFor, sortedVillages } from './shared.js';
import { distance } from './autopilot.js';

const HIGH = 0.85;  // a donor's storage this full…
const LOW = 0.35;   // …helps a village this empty
const TARGET = 0.6; // fill both towards this level

const hasMarket = (v) => (v.buildings || []).some((b) => b.gid === 17 && b.level > 0);

// Suggested transfers, at most one per sending village, nearest receiver
// first. Amounts are rounded down to hundreds.
export function balancePlan(villages, now = Date.now()) {
  const list = sortedVillages(villages).map((v) => ({ v, est: estimateStock(v, now) })).filter((x) => x.est && x.v.x != null);
  const fill = (x, k) => x.est[k] / (capacityFor(x.v.resources, k) || Infinity);
  const out = [];
  for (const from of list) {
    const give = {};
    let receiver = null;
    for (const k of RESOURCES) {
      if (fill(from, k) < HIGH) continue;
      const takers = list.filter((to) => to !== from && !to.v.underAttack && fill(to, k) <= LOW)
        .sort((a, b) => distance(from.v, a.v) - distance(from.v, b.v));
      const to = receiver || takers[0];
      if (!to || (receiver && !takers.includes(receiver))) continue;
      const capFrom = capacityFor(from.v.resources, k), capTo = capacityFor(to.v.resources, k);
      const amount = Math.floor(Math.min(from.est[k] - capFrom * TARGET, capTo * TARGET - to.est[k]) / 100) * 100;
      if (amount < 100) continue;
      receiver = to;
      give[k] = amount;
    }
    if (receiver) {
      out.push({ from: from.v.id, to: receiver.v.id, amounts: give, market: hasMarket(from.v), distance: distance(from.v, receiver.v) });
    }
  }
  return out;
}

const KEEP = 0.4; // a sender keeps this much of its own storage

// What the brain sends (src/background.js does it with the marketplace):
// a village waiting to build for resources it lacks — or one nearly empty —
// gets them from the nearest village with a marketplace and plenty to
// spare. One transfer per sender, none to or from a village under attack,
// none to a village with a transfer still on its way, none from one that
// waits to build itself. Amounts in hundreds; the merchants at hand cut
// them down further when sending.
export function transferPlan(villages, now = Date.now()) {
  const list = sortedVillages(villages).map((v) => ({ v, est: estimateStock(v, now) })).filter((x) => x.est && x.v.x != null && x.v.resources);
  const cap = (x, k) => capacityFor(x.v.resources, k) || 0;
  const waiting = (v) => !!(v.buildWait && v.buildWait.reason === 'resources' && v.buildWait.cost && v.buildWait.until > now);
  const needs = [];
  for (const to of list) {
    if (to.v.underAttack || (to.v.transferPending && to.v.transferPending.until > now)) continue;
    const build = waiting(to.v);
    const want = {};
    for (const k of RESOURCES) {
      const c = cap(to, k);
      if (!c) continue;
      const room = Math.max(0, c * 0.9 - to.est[k]);
      const lack = build ? (to.v.buildWait.cost[k] || 0) - to.est[k] : to.est[k] / c <= LOW ? c * TARGET - to.est[k] : 0;
      const n = Math.min(lack, room);
      if (n >= 100) want[k] = n;
    }
    if (Object.keys(want).length) needs.push({ to, want, why: build ? 'build' : 'low' });
  }
  needs.sort((a, b) => (a.why === b.why ? 0 : a.why === 'build' ? -1 : 1));
  const used = new Set();
  const out = [];
  for (const n of needs) {
    const donors = list.filter((from) => from !== n.to && !used.has(from.v.id) && hasMarket(from.v) && !from.v.underAttack &&
      !waiting(from.v) && !((from.v.transferAt || 0) > now))
      .sort((a, b) => distance(a.v, n.to.v) - distance(b.v, n.to.v));
    for (const from of donors) {
      const give = {};
      for (const [k, lack] of Object.entries(n.want)) {
        const c = cap(from, k);
        // To fill a nearly empty village, only from one nearly full.
        if (n.why === 'low' && from.est[k] / (c || Infinity) < HIGH) continue;
        const amount = Math.floor(Math.min(lack, from.est[k] - c * KEEP) / 100) * 100;
        if (amount >= 100) give[k] = amount;
      }
      if (!Object.keys(give).length) continue;
      used.add(from.v.id);
      out.push({ from: from.v.id, to: n.to.v.id, amounts: give, why: n.why, distance: distance(from.v, n.to.v) });
      break;
    }
  }
  return out;
}

// Amounts cut to what the free merchants carry, in proportion, in hundreds.
export function fitMerchants(amounts, free, carry) {
  const total = RESOURCES.reduce((n, k) => n + (amounts[k] || 0), 0);
  const room = free != null && carry ? free * carry : Infinity;
  if (!total || room <= 0) return null;
  const f = Math.min(1, room / total);
  const out = {};
  for (const k of RESOURCES) if (amounts[k]) out[k] = Math.floor((amounts[k] * f) / 100) * 100;
  return RESOURCES.some((k) => out[k] > 0) ? out : null;
}
