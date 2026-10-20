// Inactive players: the map tells each village's population. A village
// that hasn't grown between two looks a day apart most likely belongs to a
// player who stopped playing, and makes a good farm. Pure.
import { distance } from './autopilot.js';

export const SPAN_MS = 20 * 3600000;   // looks this far apart before judging
const KEEP = 8;                         // population snapshots per village
const MAX_VILLAGES = 2000;

// Adds one map scan to the store ({ "x|y": village }), skipping the
// player's own villages; returns the new store.
export function recordMapVillages(store, list, now = Date.now(), own = []) {
  const out = { ...(store || {}) };
  const mine = new Set(own.map((v) => `${v.x}|${v.y}`));
  for (const m of list || []) {
    const key = `${m.x}|${m.y}`;
    if (mine.has(key)) continue;
    const prev = out[key];
    // A different village on the same spot (destroyed / resettled): start over.
    const same = prev && prev.did === m.did;
    const seen = same ? [...(prev.seen || [])] : [];
    const last = seen[seen.length - 1];
    if (!last || last[1] !== m.pop || now - last[0] > 3600000) seen.push([now, m.pop]);
    // The first look is the baseline a verdict needs: always kept.
    const kept = seen.length > KEEP ? [seen[0], ...seen.slice(-(KEEP - 1))] : seen;
    out[key] = { x: m.x, y: m.y, did: m.did, uid: m.uid, aid: m.aid, name: m.name, player: m.player, alliance: m.alliance, pop: m.pop, seen: kept };
  }
  // Keep the store small: drop the villages looked at longest ago.
  const keys = Object.keys(out);
  if (keys.length > MAX_VILLAGES) {
    keys.sort((a, b) => lastSeen(out[a]) - lastSeen(out[b]));
    for (const k of keys.slice(0, keys.length - MAX_VILLAGES)) delete out[k];
  }
  return out;
}
const lastSeen = (v) => ((v.seen || []).slice(-1)[0] || [0])[0];

// Villages of players who didn't grow anywhere over at least SPAN_MS,
// nearest to `from` first. Natars (player 1) are never farms.
export function inactiveCandidates(store, from, { maxDistance = 30, now = Date.now() } = {}) {
  const byPlayer = {};
  for (const v of Object.values(store || {})) (byPlayer[v.uid] = byPlayer[v.uid] || []).push(v);
  const out = [];
  for (const [uid, list] of Object.entries(byPlayer)) {
    // Natars: player 1, or by name where the map gives no player ids.
    if (Number(uid) <= 1 || /natar|ناتار/i.test(list[0].player || '')) continue;
    const judged = list.filter((v) => (v.seen || []).length >= 2 && v.seen[v.seen.length - 1][0] - v.seen[0][0] >= SPAN_MS);
    if (!judged.length) continue;
    if (list.some((v) => (v.seen || []).length >= 2 && v.seen[v.seen.length - 1][1] > v.seen[0][1])) continue; // grew somewhere
    for (const v of judged) {
      const d = from ? distance(from, v) : 0;
      if (d > maxDistance) continue;
      out.push({ ...v, distance: d, since: v.seen[0][0], change: v.seen[v.seen.length - 1][1] - v.seen[0][1] });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

// How far tracking has come: villages known, and when the first verdicts
// are possible.
export function trackingInfo(store, now = Date.now()) {
  const list = Object.values(store || {});
  const firsts = list.map((v) => (v.seen && v.seen[0] ? v.seen[0][0] : now));
  const ready = list.filter((v) => (v.seen || []).length >= 2 && v.seen[v.seen.length - 1][0] - v.seen[0][0] >= SPAN_MS).length;
  return { tracked: list.length, ready, firstAt: firsts.length ? Math.min(...firsts) : null, readyAt: firsts.length ? Math.min(...firsts) + SPAN_MS : null };
}
