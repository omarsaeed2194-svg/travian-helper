// Raid reports for the extension's farm lists: which farm a report is
// about (by the village names in its subject), how the raid went, and when
// a farm should be paused. Pure.

export const RESULT = { 1: 'won', 2: 'losses', 3: 'lost' };
const KEEP_SEEN = 400;

// The farm target a report subject names: the list's own village and the
// target must both appear; the longest matching target name wins.
export function matchReport(subject, farms, villages) {
  let best = null;
  for (const l of farms || []) {
    const home = villages[l.villageId];
    if (!home || !home.name || !subject.includes(home.name)) continue;
    for (const tg of l.targets || []) {
      if (!tg.name || tg.name.length < 2 || tg.name === home.name || !subject.includes(tg.name)) continue;
      if (!best || tg.name.length > best.target.name.length) best = { list: l, target: tg };
    }
  }
  return best;
}

// Folds new reports into the farm lists. Returns the updated lists, what
// changed (for the log) and the ids now seen.
export function applyReports(farms, villages, reports, seen = [], now = Date.now()) {
  const known = new Set(seen);
  const lists = structuredClone(farms || []);
  const changes = [];
  // The page lists newest first; apply oldest first so streaks add up.
  for (const r of (reports || []).slice().reverse()) {
    if (known.has(r.id)) continue;
    known.add(r.id);
    if (!RESULT[r.result]) continue;
    const hit = matchReport(r.subject, lists, villages);
    if (!hit) continue;
    const tg = hit.target;
    const st = tg.stats = { raids: 0, full: 0, empty: 0, losses: 0, ...(tg.stats || {}) };
    st.raids += 1;
    if (r.carry === 'full') st.full += 1;
    if (r.carry === 'empty') st.empty += 1;
    st.lossStreak = r.result === 1 ? 0 : (st.lossStreak || 0) + 1;
    if (r.result !== 1) st.losses += 1;
    st.emptyStreak = r.carry === 'empty' ? (st.emptyStreak || 0) + 1 : 0;
    st.last = { at: now, result: RESULT[r.result], carry: r.carry || null };
    // Lost the raid, or losses twice running: stop sending there.
    let paused = false;
    if (tg.enabled !== false && (r.result === 3 || st.lossStreak >= 2)) {
      tg.enabled = false;
      tg.pausedBy = 'report';
      paused = true;
    }
    changes.push({ listId: hit.list.id, list: hit.list.name, target: tg.name, x: tg.x, y: tg.y, result: RESULT[r.result], carry: r.carry || null, paused });
  }
  return { farms: lists, changes, seen: [...known].slice(-KEEP_SEEN) };
}

// Best farms first: full bounties, few losses, many raids seen.
export function farmScore(tg) {
  const st = tg.stats;
  if (!st || !st.raids) return null;
  return Math.round(((st.full - st.empty * 0.5 - st.losses * 2) / st.raids) * 100);
}
