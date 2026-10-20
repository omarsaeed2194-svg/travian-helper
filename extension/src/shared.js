// Constants and helpers shared by the background worker, popup and dashboard.
import { t, getLanguage, dateLocale } from './i18n.js';

export const RESOURCES = ['wood', 'clay', 'iron', 'crop'];
export const FIELD_RESOURCE = { 1: 'wood', 2: 'clay', 3: 'iron', 4: 'crop' };
export const resLabel = (k) => t(`res.${k}`);

const BUILDING_NAMES = {
  en: {
    1: 'Woodcutter', 2: 'Clay Pit', 3: 'Iron Mine', 4: 'Cropland', 5: 'Sawmill',
    6: 'Brickyard', 7: 'Iron Foundry', 8: 'Grain Mill', 9: 'Bakery', 10: 'Warehouse',
    11: 'Granary', 13: 'Smithy', 14: 'Tournament Square', 15: 'Main Building',
    16: 'Rally Point', 17: 'Marketplace', 18: 'Embassy', 19: 'Barracks', 20: 'Stable',
    21: 'Workshop', 22: 'Academy', 23: 'Cranny', 24: 'Town Hall', 25: 'Residence',
    26: 'Palace', 27: 'Treasury', 28: 'Trade Office', 29: 'Great Barracks',
    30: 'Great Stable', 31: 'City Wall', 32: 'Earth Wall', 33: 'Palisade',
    34: "Stonemason's Lodge", 35: 'Brewery', 36: 'Trapper', 37: "Hero's Mansion",
    38: 'Great Warehouse', 39: 'Great Granary', 40: 'Wonder of the World',
    41: 'Horse Drinking Trough', 42: 'Stone Wall', 43: 'Makeshift Wall',
    44: 'Command Center', 45: 'Waterworks', 46: 'Hospital',
  },
  ar: {
    1: 'الحطاب', 2: 'حفرة الطين', 3: 'منجم الحديد', 4: 'حقل القمح', 5: 'معمل النشارة',
    6: 'مصنع الطوب', 7: 'مسبك الحديد', 8: 'المطحنة', 9: 'المخبز', 10: 'المخزن',
    11: 'مخزن الحبوب', 13: 'الحداد', 14: 'ساحة البطولة', 15: 'المبنى الرئيسي',
    16: 'نقطة التجمع', 17: 'السوق', 18: 'السفارة', 19: 'الثكنة', 20: 'الإسطبل',
    21: 'المصانع الحربية', 22: 'الأكاديمية الحربية', 23: 'المخبأ', 24: 'البلدية', 25: 'السكن',
    26: 'القصر', 27: 'الخزنة', 28: 'المكتب التجاري', 29: 'الثكنة الكبيرة',
    30: 'الإسطبل الكبير', 31: 'السور', 32: 'السور الترابي', 33: 'الحاجز',
    34: 'كوخ الحجّار', 35: 'المعصرة', 36: 'الصياد', 37: 'قصر الأبطال',
    38: 'المخزن الكبير', 39: 'مخزن الحبوب الكبير', 40: 'معجزة العالم',
    41: 'ساقية الخيول', 42: 'السور الحجري', 43: 'السور المؤقت',
    44: 'مركز القيادة', 45: 'محطة المياه', 46: 'المستشفى',
  },
};

// Buildings that train troops, in the order shown in the dashboard.
export const TRAINING_BUILDINGS = [19, 20, 21, 29, 30, 25, 26];

// `fallback` is the name the game itself showed (already in the server's language).
export const buildingName = (gid, fallback) =>
  fallback || (BUILDING_NAMES[getLanguage()] || BUILDING_NAMES.en)[gid] ||
  (gid ? t('building.unknown', { gid }) : t('building.empty'));

export const DEFAULT_SETTINGS = {
  language: 'ar',
  theme: 'system',          // system | light | dark
  server: '',
  watchEnabled: true,       // periodically re-check villages and send alerts
  botEnabled: false,        // perform queued actions (build, train, farm, adventures)
  refreshMinutes: 10,
  jitterPercent: 25,
  pauseWhenPlaying: true,
  pauseMinutes: 3,
  maxQueue: 1,
  activeHours: { enabled: false, from: '08:00', to: '23:30' },
  farm: { enabled: false, intervalMinutes: 30, listIds: [], villageId: '' },
  adventure: { enabled: false },
  // Runs the villages without commands: picks upgrades when nothing is
  // queued, and sends the hero / farm lists. Oasis raids have their own rules.
  // construct: missing basics on free sites; quests: collect task rewards;
  // heroBag: top up a waiting upgrade from the hero's resources.
  autopilot: { enabled: false, build: true, fieldsMax: 10, adventures: true, farmLists: false, construct: true, quests: true, heroBag: false },
  alerts: { desktop: true, attacks: true, storage: true, storageHours: 1, starvation: true, loggedOut: true, botErrors: true },
  // control: answer commands sent from the chat; summaryHour: daily summary
  // at this hour (-1 = off).
  telegram: { token: '', chatId: '', control: true, summaryHour: 8 },
  discord: { webhookUrl: '' },
  // Read raid reports after farm rounds (experimental).
  reports: { enabled: false },
  // Culture points: focus = the autopilot builds for culture points;
  // celebrate = off | small | great, held in every village with a Town Hall.
  culture: { focus: false, celebrate: 'off' },
  // New villages: every village trains settlers once from Residence 10.
  expansion: { enabled: false, targets: [] },
  // The web app (Vercel): its address and the key from its Connect page.
  web: { url: '', key: '' },
  // Wounded troops healed in the Hospital, as resources allow.
  heal: { enabled: false, everyMinutes: 60 },
  // The brain (src/brain.js): runs every village on its own — builds like
  // the autopilot with field targets that grow with the village, trains
  // troops with `armyShare` % of what the stores pay for once they fill,
  // and sends the attack units away from an attack (`defense`). At most
  // `maxActions` trainings a round, every `everyMinutes` per village.
  // roles: { villageId: 'auto' | 'economy' | 'military' | 'off' }.
  brain: { enabled: false, armyShare: 30, maxActions: 3, everyMinutes: 30, defense: true, roles: {} },
};

export function mergeSettings(saved) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!saved) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = { ...out[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return keepInRange(out);
}

// Numbers that would make the bot run wild (every minute, negative waits)
// are brought back into range, whatever saved them.
function keepInRange(s) {
  const fix = (obj, key, min, max, def) => {
    if (!obj) return;
    const n = Number(obj[key]);
    obj[key] = obj[key] !== '' && obj[key] != null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const d = DEFAULT_SETTINGS;
  fix(s, 'refreshMinutes', 3, 240, d.refreshMinutes);
  fix(s, 'jitterPercent', 0, 60, d.jitterPercent);
  fix(s, 'pauseMinutes', 1, 240, d.pauseMinutes);
  fix(s, 'maxQueue', 1, 2, d.maxQueue);
  fix(s.farm, 'intervalMinutes', 5, 1440, d.farm.intervalMinutes);
  fix(s.heal, 'everyMinutes', 10, 720, d.heal.everyMinutes);
  fix(s.brain, 'armyShare', 5, 90, d.brain.armyShare);
  fix(s.brain, 'maxActions', 1, 10, d.brain.maxActions);
  fix(s.brain, 'everyMinutes', 10, 240, d.brain.everyMinutes);
  fix(s.autopilot, 'fieldsMax', 1, 21, d.autopilot.fieldsMax);
  fix(s.alerts, 'storageHours', 0, 48, d.alerts.storageHours);
  return s;
}

export const capacityFor = (res, k) => (k === 'crop' ? res.capacity.granary : res.capacity.warehouse);

// Project stock forward from the last snapshot using hourly production.
export function estimateStock(v, now = Date.now()) {
  if (!v || !v.resources || !v.resources.stock) return null;
  const { stock, production } = v.resources;
  const hours = (now - (v.resourcesAt || now)) / 3600000;
  const out = {};
  for (const k of RESOURCES) {
    const cap = capacityFor(v.resources, k) || Infinity;
    const prod = production ? production[k] || 0 : 0;
    out[k] = Math.max(0, Math.min(cap, Math.floor((stock[k] || 0) + prod * hours)));
  }
  return out;
}

// Hours until a resource is full (positive production) or empty (negative
// crop). Returns null when it is neither filling nor draining.
export function hoursUntilLimit(v, k, now = Date.now()) {
  const est = estimateStock(v, now);
  if (!est || !v.resources.production) return null;
  const prod = v.resources.production[k] || 0;
  const cap = capacityFor(v.resources, k);
  if (prod > 0 && cap) return (cap - est[k]) / prod;
  if (prod < 0) return est[k] / -prod;
  return null;
}

export function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  const body = d ? t('time.dh', { d, h }) : h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? `-${body}` : body;
}

export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return t('ago.never');
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return t('ago.now');
  if (s < 3600) return t('ago.m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.h', { n: Math.floor(s / 3600) });
  return t('ago.d', { n: Math.floor(s / 86400) });
}

export const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function withinActiveHours(cfg, date = new Date()) {
  if (!cfg || !cfg.enabled) return true;
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const now = date.getHours() * 60 + date.getMinutes();
  const from = toMin(cfg.from), to = toMin(cfg.to);
  if (from === to) return true; // 00:00–00:00: the whole day
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export function sortedVillages(villages) {
  return Object.values(villages || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function taskLabel(task, village) {
  if (task.kind === 'fields') {
    const what = task.resource && task.resource !== 'all' ? t(`fieldsOf.${task.resource}`) : t('task.allFields');
    return t('task.toLevel', { what, n: task.targetLevel });
  }
  const b = village && [...(village.fields || []), ...(village.buildings || [])].find((x) => x.slot === task.slot);
  const name = task.gid && (!b || !b.gid) ? buildingName(task.gid)
    : b ? buildingName(b.gid, b.name) : task.name || t('task.slot', { n: task.slot });
  return t('task.slotLabel', { name, slot: task.slot, n: task.targetLevel });
}

export function earliestQueueFinish(v, now = Date.now()) {
  return (v.buildQueue || []).map((b) => b.finishAt).filter((at) => at && at > now).sort((a, b) => a - b)[0] || null;
}

const covers = (stock, cost) => !!stock && RESOURCES.every((k) => (stock[k] || 0) >= (cost[k] || 0));

// Why a village's next queued upgrade can't start yet, or null when it can.
export function buildBlock(v, s, now = Date.now()) {
  const active = (v.buildQueue || []).filter((b) => !b.finishAt || b.finishAt > now);
  if (active.length >= s.maxQueue) return { reason: 'queue', until: earliestQueueFinish(v, now) };
  const w = v.buildWait;
  if (!w || now >= w.until) return null;
  // Resources can arrive before the game's estimate (trades, returning raids):
  // retry as soon as a snapshot taken after the wait began shows enough.
  if (w.reason === 'resources' && w.cost && (v.resourcesAt || 0) > w.at && covers(estimateStock(v, now), w.cost)) return null;
  return w;
}

// Plain-language reason shown in the popup and dashboard.
export function buildStatus(v, data, now = Date.now()) {
  const s = data.settings;
  const st = data.status || {};
  const queued = (data.tasks[v.id] || []).length > 0;
  const brain = !!(s.brain && s.brain.enabled);
  const auto = brain || (s.autopilot.enabled && s.autopilot.build);
  if (!queued && !auto) return null;
  if (!s.botEnabled && !s.autopilot.enabled && !brain) return { tone: 'muted', text: t('why.botOff') };
  if (st.state === 'otherDevice') return { tone: 'muted', text: t('why.otherDevice', { name: st.note }) };
  if (st.loggedOut) return { tone: 'bad', text: t('why.loggedOut') };
  if (s.pauseWhenPlaying && (st.userActiveUntil || 0) > now) {
    return { tone: 'warn', text: t('why.paused', { t: fmtDuration(st.userActiveUntil - now) }) };
  }
  if (!withinActiveHours(s.activeHours, new Date(now))) return { tone: 'muted', text: t('why.hours') };
  if (!queued && (v.autoIdleUntil || 0) > now) return { tone: 'muted', text: t('why.autoNothing') };
  const b = buildBlock(v, s, now);
  if (!b) return { tone: 'good', text: queued ? t('why.ready') : t('why.autoReady') };
  const left = b.until ? fmtDuration(b.until - now) : null;
  if (b.reason === 'queue') return { tone: 'muted', text: left ? t('why.queue', { t: left }) : t('why.queueUnknown') };
  if (b.reason === 'resources') return { tone: 'warn', text: t('why.resources', { t: left }) };
  return { tone: 'warn', text: t('why.blocked', { reason: b.text || t('reason.cannotYet'), t: left }) };
}
