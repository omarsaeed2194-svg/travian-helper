// What an incoming attack is likely to be, from the rally point: where it
// comes from, when it lands, and — with the time the bot first saw it —
// how fast it can be at most and at least. The slowest unit sets an army's
// speed, so that range says which units can be in it (rams and catapults
// are the slowest of all). When the army is small enough, the rally point
// also shows which kinds of units come. From that: a small attack is met
// with help from the player's own villages nearby; anything bigger (or
// unknown) gets the escape plan. Pure.
import { distance, troopsHome } from './autopilot.js';
import { isOffensive } from './brain.js';

// Fields per hour at normal speed, t1..t10, per tribe (approximate for the
// newer tribes).
export const SPEEDS = {
  0: [6, 5, 7, 16, 14, 10, 4, 3, 4, 5],     // Romans
  10: [7, 7, 6, 9, 10, 9, 4, 3, 4, 5],      // Teutons
  20: [7, 6, 17, 19, 16, 13, 4, 3, 5, 5],   // Gauls
  50: [7, 6, 7, 16, 15, 10, 4, 3, 4, 5],    // Egyptians
  60: [7, 6, 19, 16, 15, 14, 4, 3, 5, 5],   // Huns
  70: [6, 9, 8, 6, 16, 9, 4, 3, 4, 5],      // Spartans
};
const speedsOf = (base) => SPEEDS[base] || SPEEDS[0];
const SIEGE_TOP = 4;   // rams, catapults and chiefs go at most this fast
const FAST_LOW = 9;    // only horses and scouts are faster than this

// The server's troop speed: measured from the player's own sends when
// there are any, else guessed from the server's name ("x3").
export function speedFactor(account = {}, server = '') {
  if (account.troopSpeed > 0) return { factor: account.troopSpeed, measured: true };
  const m = /[./]x(\d+)\./.exec(server || '');
  return { factor: m ? Number(m[1]) : 1, measured: false };
}

// One own send seen on its confirmation page: the factor it shows.
export function speedSample(from, to, troops, base, seconds) {
  const d = from && to ? distance(from, to) : 0;
  const fields = Object.keys(troops || {}).filter((f) => troops[f] > 0 && /^t([1-9]|10)$/.test(f));
  if (!d || d > 20 || !seconds || !fields.length) return null; // the Tournament Square changes long trips
  const slowest = Math.min(...fields.map((f) => speedsOf(base)[Number(f.slice(1)) - 1]));
  return (d / (seconds / 3600)) / slowest;
}

// The rally point's list merged with what was seen before: the same attack
// keeps the time it was first seen. `after` is the last look that didn't
// show it yet (the attack left after that).
export function mergeIncoming(prev = [], parsed = [], now = Date.now(), after = null) {
  return parsed.filter((a) => a.secondsLeft != null).map((a) => {
    const arriveAt = now + a.secondsLeft * 1000;
    const old = prev.find((p) => p.from && a.from && p.from.x === a.from.x && p.from.y === a.from.y && Math.abs(p.arriveAt - arriveAt) <= 3000);
    return { ...a, arriveAt: old ? old.arriveAt : arriveAt, firstSeen: old ? old.firstSeen : now, after: old ? old.after : after };
  });
}

// One attack: its distance, the speed range, the units that can be its
// slowest, and what that makes it.
//   verdict: small (the rally point shows its kinds) | siege (rams,
//   catapults or a chief possible) | fast (horses or scouts only) | army |
//   unknown
export function analyzeAttack(a, v, factor = 1) {
  const d = a.from && v.x != null ? distance(a.from, v) : null;
  const sp = speedsOf(a.base);
  const kinds = (a.seen || []).filter((f) => /^t([1-9]|10)$/.test(f));
  let vmax = null, vmin = null, slowest = [];
  if (d != null && a.arriveAt && a.firstSeen && a.arriveAt > a.firstSeen) {
    vmax = d / ((a.arriveAt - a.firstSeen) / 3600000) / factor;
    if (a.after && a.after < a.firstSeen) vmin = d / ((a.arriveAt - a.after) / 3600000) / factor;
    slowest = sp.map((s, i) => ({ f: `t${i + 1}`, s })).filter((u) => u.f !== 't10' && u.s <= vmax * 1.05 && (vmin == null || u.s >= vmin * 0.95)).map((u) => u.f);
  }
  if (kinds.length) {
    const slow = Math.min(...kinds.map((f) => sp[Number(f.slice(1)) - 1]));
    return { d, vmin, vmax, slowest: kinds.filter((f) => sp[Number(f.slice(1)) - 1] === slow), kinds, verdict: 'small', siege: slow <= SIEGE_TOP };
  }
  if (vmax == null) return { d, vmin, vmax, slowest, kinds, verdict: 'unknown', siege: null };
  const siege = vmax <= SIEGE_TOP * 1.05 || slowest.some((f) => ['t7', 't8', 't9'].includes(f));
  const fast = vmin != null && vmin >= FAST_LOW * 0.95;
  return { d, vmin, vmax, slowest, kinds, verdict: fast ? 'fast' : vmax <= SIEGE_TOP * 1.05 ? 'siege' : 'army', siege };
}

// The answer for a village under attack: help from nearby villages for
// small attacks (the attack units stay home and fight too), the escape
// plan for anything bigger or not known. Null when nothing is coming.
export function attackVerdict(v, factor = 1, now = Date.now()) {
  const list = (v.incoming || []).filter((a) => a.arriveAt > now);
  if (!v.underAttack || !list.length) return null;
  const each = list.map((a) => ({ ...a, info: analyzeAttack(a, v, factor) }));
  const small = each.every((a) => a.info.verdict === 'small' && !a.info.siege);
  const first = Math.min(...each.map((a) => a.arriveAt));
  const worst = each.some((a) => a.info.siege) ? 'siege' : each.every((a) => a.info.verdict === 'fast') ? 'fast' : small ? 'small' : each.some((a) => a.info.verdict === 'unknown') ? 'unknown' : 'army';
  return { attacks: each, first, small, worst, escape: !small, reinforce: small };
}

// Help for a small attack: from each other village not attacked itself, a
// share of the defence at home (never attack units, chiefs or settlers),
// nearest first. The send itself checks it lands before the attack.
export function reinforcePlan(v, villages, base, share = 0.5) {
  const out = [];
  for (const h of Object.values(villages || {})) {
    if (h.id === v.id || h.underAttack || h.x == null || v.x == null) continue;
    const home = troopsHome(h);
    const troops = {};
    for (const [f, n] of Object.entries(home)) {
      if (n > 0 && f !== 't9' && f !== 't10' && !isOffensive(f, base)) {
        const k = Math.floor(n * share);
        if (k > 0) troops[f] = k;
      }
    }
    if (Object.keys(troops).length) out.push({ from: h.id, troops, distance: distance(h, v) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
