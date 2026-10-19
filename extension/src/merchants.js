// Resource balance between the player's villages: which village has a
// resource piling up that another one is short of. Suggestions only — the
// player sends with the marketplace. Pure.
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
