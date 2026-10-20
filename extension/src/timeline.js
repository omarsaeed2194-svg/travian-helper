// What happens in the next hours, for the Overview timeline: builds and
// training finishing, troops arriving, storage filling up, crop running
// out, escapes, farm rounds and oasis raids. Pure; the dashboard draws it.
import { RESOURCES, resLabel, hoursUntilLimit } from './shared.js';
import { escapeTiming, escapeDone, donateTiming, donateDone } from './escape.js';
import { t } from './i18n.js';

const MOVE_KEYS = { att1: 'move.att1', att2: 'move.att2', att3: 'move.att3', def1: 'move.def1', def2: 'move.def2', def3: 'move.def3', adventure: 'move.adventure', hero_on_adventure: 'move.adventure' };
export const moveLabel = (kind) => t(MOVE_KEYS[kind] || (/settler/i.test(kind) ? 'move.settlers' : 'move.other'));

// Events between now and `hours` from now, earliest first. Each has `at`,
// a `kind` (attack, move, build, train, full, starve, escape, farm, raid),
// an `icon`, a `text` and the village.
export function timelineEvents(scope, data, now = Date.now(), hours = 6) {
  const end = now + hours * 3600000;
  const out = [];
  const add = (at, kind, icon, text, v) => { if (at && at > now && at <= end) out.push({ at, kind, icon, text, v: v ? v.id : null, vName: v ? v.name : '' }); };
  const s = data.settings || {};
  const on = s.botEnabled || (s.autopilot && s.autopilot.enabled) || !!(s.brain && s.brain.enabled);
  const ids = new Set(scope.map((v) => v.id));

  for (const v of scope) {
    for (const b of v.buildQueue || []) add(b.finishAt, 'build', '🏗', `${b.name}${b.level != null ? ` ${b.level}` : ''}`, v);
    for (const q of Object.values(v.trainingQueue || {})) {
      for (const it of q.items || []) add(it.finishAt, 'train', '🛡', `${it.count} × ${it.name || it.unit}`, v);
    }
    for (const m of v.movements || []) {
      const attack = m.kind === 'att1';
      add(m.arriveAt, attack ? 'attack' : 'move', attack ? '⚔' : '↩', `${moveLabel(m.kind)}${m.count > 1 ? ` × ${m.count}` : ''}`, v);
    }
    // Storage: the first resource to fill the warehouse, and the granary.
    const p = v.resources && v.resources.production;
    if (p) {
      let ware = null;
      for (const k of RESOURCES) {
        const h = hoursUntilLimit(v, k, now);
        if (h == null || h <= 0) continue;
        if (k === 'crop') {
          if (p.crop < 0) add(now + h * 3600000, 'starve', '🌾', t('tl.starve'), v);
          else add(now + h * 3600000, 'full', '📦', t('tl.full', { res: resLabel(k) }), v);
        } else if (p[k] > 0 && (!ware || h < ware.h)) ware = { h, k };
      }
      if (ware) add(now + ware.h * 3600000, 'full', '📦', t('tl.full', { res: resLabel(ware.k) }), v);
    }
    const plan = (data.escapes || []).find((x) => x.villageId === v.id && x.enabled !== false);
    const tm = plan && escapeTiming(v, plan, now);
    if (tm && plan.troops !== false && !escapeDone(v, tm.first)) add(Math.max(now + 1, tm.leaveAt), 'escape', '🏃', t('tl.escape'), v);
    const dt = plan && donateTiming(v, plan, now);
    if (dt && !donateDone(v, dt.first)) add(Math.max(now + 1, dt.at), 'donate', '💰', t('tl.donate'), v);
  }
  if (on) {
    for (const l of data.farms || []) {
      if (l.enabled === false || !ids.has(l.villageId) || !(l.targets || []).some((x) => x.enabled !== false)) continue;
      add(Math.max(now + 1, l.nextAt || now + 1), 'farm', '🐎', t('tl.farm', { list: l.name }), data.villages[l.villageId]);
    }
    for (const r of data.raids || []) {
      if (r.enabled === false || !ids.has(r.villageId)) continue;
      add(Math.max(now + 1, r.nextAt || now + 1), 'raid', '🌿', t('tl.raid'), data.villages[r.villageId]);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Spread markers over rows so close ones don't sit on top of each other:
// `gap` is the smallest distance (share of the width) between two on a row.
export function laneOf(events, start, span, gap = 0.035, maxLanes = 4) {
  const ends = [];
  return events.map((e) => {
    const x = (e.at - start) / span;
    let lane = ends.findIndex((last) => x - last >= gap);
    if (lane < 0) lane = ends.length < maxLanes ? ends.length : ends.indexOf(Math.min(...ends));
    ends[lane] = x;
    return { ...e, x, lane };
  });
}
