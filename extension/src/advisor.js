// Game tips worked out from what the extension knows about each village.
// Pure functions: they read state and return tips; the dashboard renders
// them and re-runs them whenever anything changes.
import {
  RESOURCES, FIELD_RESOURCE, resLabel, hoursUntilLimit, buildingName, fmtDuration, fmtAgo,
} from './shared.js';
import { t, ltr } from './i18n.js';
import { escapeStatus } from './escape.js';

export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, good: 3 };

const MAIN_BUILDING = 15;
const WAREHOUSE = 10;
const GRANARY = 11;
const CRANNY = 23;
const MARKETPLACE = 17;
const RALLY_POINT = 16;
const WALLS = [31, 32, 33, 42, 43, 47];
const WALL_SLOT = 40; // every tribe's wall sits here, whatever it's called
const STALE_MS = 60 * 60 * 1000;

// Resource bonus buildings and what they need (Travian Legends rules).
const BONUS_BUILDINGS = [
  { gid: 5, res: 'wood', field: 10, main: 5 },             // Sawmill
  { gid: 6, res: 'clay', field: 10, main: 5 },             // Brickyard
  { gid: 7, res: 'iron', field: 10, main: 5 },             // Iron Foundry
  { gid: 8, res: 'crop', field: 5, main: 0 },              // Grain Mill
  { gid: 9, res: 'crop', field: 10, main: 5, needs: 8 },   // Bakery (Grain Mill 5)
];

const buildingsOf = (v) => v.buildings || [];
const best = (v, gid) => buildingsOf(v).filter((b) => b.gid === gid).sort((a, b) => b.level - a.level)[0] || null;
const levelOf = (v, gid) => { const b = best(v, gid); return b ? b.level : 0; };
// The village wall: whatever stands in the wall slot (City Wall, Palisade,
// Defensive Wall, …), or a known wall type anywhere.
export const wallOf = (v) => buildingsOf(v).find((b) => b.slot === WALL_SLOT && b.gid > 0 && (b.level > 0 || b.underConstruction))
  || buildingsOf(v).find((b) => WALLS.includes(b.gid) && (b.level > 0 || b.underConstruction)) || null;
const queued = (data, v, slot) => (data.tasks[v.id] || []).some((task) => task.slot === slot);

function fieldStats(v) {
  const out = {};
  for (const k of RESOURCES) out[k] = { min: Infinity, max: 0, count: 0 };
  for (const f of v.fields || []) {
    const k = FIELD_RESOURCE[f.gid];
    if (!k) continue;
    out[k].min = Math.min(out[k].min, f.level);
    out[k].max = Math.max(out[k].max, f.level);
    out[k].count += 1;
  }
  return out;
}

// An "upgrade this building" button, unless it's already in the queue.
function upgradeAction(data, v, b, label) {
  if (!b || b.maxLevel || queued(data, v, b.slot)) return null;
  return { type: 'addTask', label, villageId: v.id, task: { kind: 'upgrade', slot: b.slot, targetLevel: b.level + 1, name: buildingName(b.gid, b.name) } };
}

export function adviseVillage(v, data, now = Date.now()) {
  const tips = [];
  const add = (sev, icon, text, action) => tips.push({ sev, icon, text, action: action || null, villageId: v.id });
  const res = v.resources;
  const prod = res && res.production;
  const scanned = !!v.buildingsAt;

  // --- Defence -----------------------------------------------------------
  if (v.underAttack) {
    const first = (v.movements || []).filter((m) => m.kind === 'att1' && m.arriveAt > now).map((m) => m.arriveAt).sort((a, b) => a - b)[0];
    const plan = (data.escapes || []).find((p) => p.villageId === v.id && p.enabled !== false);
    const escape = escapeStatus(v, plan, data.villages, now);
    add('critical', 'attack', t('tip.attack', { when: first ? t('tip.attackIn', { t: fmtDuration(first - now) }) : t('tip.attackSoon') }) +
      (escape ? ` ${t('tip.escapePart', { s: escape.text })}` : ''),
    escape ? null : { type: 'tab', tab: 'defense', villageId: v.id, label: t('tip.actEscape') });
    if (scanned && !levelOf(v, CRANNY)) add('warning', 'shield', t('tip.crannyUrgent'));
    if (scanned && !wallOf(v)) add('warning', 'shield', t('tip.wallUrgent'));
  }

  // --- Food --------------------------------------------------------------
  if (prod && prod.crop < 0) {
    const hrs = hoursUntilLimit(v, 'crop', now);
    add('critical', 'crop', t('tip.starving', { p: ltr(prod.crop), t: fmtDuration((hrs || 0) * 3600000) }),
      v.fields ? { type: 'addFields', label: t('tip.actFields', { res: resLabel('crop') }), villageId: v.id, resource: 'crop', targetLevel: fieldStats(v).crop.min + 1 } : null);
  } else if (prod && prod.cropGross && prod.crop < Math.max(10, prod.cropGross * 0.1)) {
    add('warning', 'crop', t('tip.cropLow', { p: ltr(`+${prod.crop}`) }),
      v.fields ? { type: 'addFields', label: t('tip.actFields', { res: resLabel('crop') }), villageId: v.id, resource: 'crop', targetLevel: fieldStats(v).crop.min + 1 } : null);
  }

  // --- Storage -----------------------------------------------------------
  if (res && prod) {
    const soonest = (keys) => keys.map((k) => ({ k, h: prod[k] > 0 ? hoursUntilLimit(v, k, now) : null }))
      .filter((x) => x.h != null).sort((a, b) => a.h - b.h)[0];
    const checks = [
      { keys: ['wood', 'clay', 'iron'], gid: WAREHOUSE, full: 'tip.warehouseFull', soon: 'tip.warehouseSoon' },
      { keys: ['crop'], gid: GRANARY, full: 'tip.granaryFull', soon: 'tip.granarySoon' },
    ];
    for (const c of checks) {
      const s = soonest(c.keys);
      if (!s || s.h > 2) continue;
      const b = best(v, c.gid);
      const params = { lvlPart: b ? t('tip.lvlPart', { lvl: b.level }) : '', t: fmtDuration(s.h * 3600000), res: resLabel(s.k) };
      add(s.h <= 0 ? 'critical' : 'warning', 'storage', t(s.h <= 0 ? c.full : c.soon, params),
        upgradeAction(data, v, b, t('tip.actUpgrade', { b: buildingName(c.gid) })));
    }
  }

  // --- Troops ------------------------------------------------------------
  // Barracks standing still while the warehouse fills: spend it on troops.
  const barracks = (v.trainingQueue || {})[19];
  if (barracks && !barracks.unknown && !barracks.items.some((i) => !i.finishAt || i.finishAt > now) && prod) {
    const h = Math.min(...['wood', 'clay', 'iron'].map((k) => (prod[k] > 0 ? hoursUntilLimit(v, k, now) ?? Infinity : Infinity)));
    if (h <= 2) add('info', 'shield', t('tip.barracksIdle'), { type: 'tab', tab: 'troops', villageId: v.id, label: t('tip.actTrain') });
  }

  // --- Builders ----------------------------------------------------------
  const ap = data.settings.autopilot;
  const active = (v.buildQueue || []).filter((b) => !b.finishAt || b.finishAt > now);
  if (v.buildQueue && !active.length && !(data.tasks[v.id] || []).length && !(ap.enabled && ap.build)) {
    add('info', 'build', t('tip.idle'), { type: 'tab', tab: 'build', villageId: v.id, label: t('tip.actPlan') });
  }

  // --- Economy -----------------------------------------------------------
  if (prod && v.fields) {
    const raw = ['wood', 'clay', 'iron'].map((k) => ({ k, p: prod[k] || 0 })).sort((a, b) => a.p - b.p);
    const low = raw[0], high = raw[raw.length - 1];
    if (high.p > 0 && low.p < high.p * 0.7) {
      const stats = fieldStats(v);
      add('info', 'balance', t('tip.balance', { low: resLabel(low.k), lp: ltr(low.p), high: resLabel(high.k), hp: ltr(high.p) }),
        { type: 'addFields', label: t('tip.actFields', { res: resLabel(low.k) }), villageId: v.id, resource: low.k, targetLevel: stats[low.k].min + 1 });
    }
  }
  if (scanned && v.fields) {
    const stats = fieldStats(v);
    const main = levelOf(v, MAIN_BUILDING);
    for (const bb of BONUS_BUILDINGS) {
      if (best(v, bb.gid)) continue;
      if (stats[bb.res].max < bb.field || main < bb.main) continue;
      if (bb.needs && levelOf(v, bb.needs) < 5) continue;
      add('info', 'bonus', t('tip.bonusReady', { b: buildingName(bb.gid), res: resLabel(bb.res) }));
    }
  }

  // --- Infrastructure ----------------------------------------------------
  if (scanned) {
    const main = best(v, MAIN_BUILDING);
    if (main && main.level < 5) {
      add('info', 'build', t('tip.mainBuilding', { lvl: main.level }), upgradeAction(data, v, main, t('tip.actUpgrade', { b: buildingName(MAIN_BUILDING) })));
    }
    if (!v.underAttack && !levelOf(v, CRANNY)) add('info', 'shield', t('tip.cranny'));
    if (!v.underAttack && !wallOf(v)) add('info', 'shield', t('tip.wall'));
    const rally = buildingsOf(v).find((b) => b.slot === 39);
    if (rally && rally.level === 0 && !rally.underConstruction) add('info', 'build', t('tip.rally'));
    if (Object.keys(data.villages).length > 1 && !best(v, MARKETPLACE)) add('info', 'build', t('tip.market'));
  }

  // --- Data freshness ----------------------------------------------------
  if (v.updatedAt && now - v.updatedAt > STALE_MS) add('info', 'clock', t('tip.stale', { ago: fmtAgo(v.updatedAt, now) }));

  return tips;
}

export function adviseAccount(data, now = Date.now()) {
  const tips = [];
  const add = (sev, icon, text, action) => tips.push({ sev, icon, text, action: action || null, villageId: null });
  const s = data.settings;
  const hero = data.account.hero || {};
  if (data.status.loggedOut) add('critical', 'alert', t('status.loggedOut'));
  if (!s.watchEnabled && !s.botEnabled && !s.autopilot.enabled && !(s.brain && s.brain.enabled)) {
    add('warning', 'alert', t('tip.watchOff'), { type: 'setting', label: t('tip.actEnable'), patch: { watchEnabled: true } });
  } else if (!s.telegram.token && !s.discord.webhookUrl) {
    add('info', 'alert', t('tip.phone'), { type: 'tab', tab: 'alerts', label: t('tip.actSetup') });
  }
  const ap = s.autopilot;
  if (hero.adventures > 0 && hero.home && !s.adventure.enabled && !(ap.enabled && ap.adventures)) {
    add('info', 'hero', t('tip.adventures', { n: hero.adventures }), { type: 'setting', label: t('tip.actEnable'), patch: { adventure: { ...s.adventure, enabled: true } } });
  }
  const ex = data.account.expansion;
  if (ex && ex.total != null && ex.used < ex.total) add('info', 'bonus', t('tip.freeSlot', { used: ex.used, n: ex.total }), { type: 'tab', tab: 'culture', label: t('tip.actCulture') });
  if (hero.levelUp && s.server) add('info', 'hero', t('tip.heroLevelUp'), { type: 'open', url: `${s.server}/hero`, label: t('tip.actOpenGame') });
  if (data.account.questClaimable && s.server && !(ap.enabled && ap.quests)) {
    add('info', 'bonus', t('tip.quests'), { type: 'open', url: `${s.server}/tasks`, label: t('tip.actOpenGame') });
  }
  const lists = (data.account.farmLists || []).length;
  if (lists && !s.farm.enabled && !(ap.enabled && ap.farmLists)) {
    add('info', 'farm', t('tip.farm', { n: lists }), { type: 'setting', label: t('tip.actEnable'), patch: { farm: { ...s.farm, enabled: true } } });
  }
  return tips;
}

// Every tip for the current filter, most urgent first.
export function adviseAll(data, villageIds, now = Date.now()) {
  const tips = [...adviseAccount(data, now)];
  for (const id of villageIds) {
    const v = data.villages[id];
    if (v) tips.push(...adviseVillage(v, data, now));
  }
  return tips.sort((a, b) => SEVERITY_ORDER[a.sev] - SEVERITY_ORDER[b.sev]);
}
