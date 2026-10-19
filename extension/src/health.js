// Bot health: is the extension running, what is switched off and why, how
// each job did last time, recent errors, and how fresh each village's data
// is. Pure; the Health tab draws it.
import { sortedVillages, withinActiveHours, fmtAgo, fmtClock } from './shared.js';
import { leaseIsFresh } from './sync.js';
import { t } from './i18n.js';

const HOUR = 3600000;
const JOB_TYPES = ['refresh', 'build', 'train', 'farmList', 'farm', 'raid', 'escape', 'adventure', 'scan', 'quest', 'heroBag', 'reports', 'donate', 'celebrate', 'settlers', 'heal'];

// `tab`: the dashboard page where the thing is set up, linked from the row.
const row = (tone, label, value, detail = '', tab = null) => ({ tone, label, value, detail, tab });
const JOB_TAB = {
  build: 'build', train: 'troops', farmList: 'farms', farm: 'farms', raid: 'oasis', escape: 'defense', adventure: 'hero',
  scan: 'oasis', quest: 'autopilot', heroBag: 'hero', reports: 'farms', donate: 'defense', celebrate: 'culture', settlers: 'culture', heal: 'troops',
};

// "good" when everything is fine, else the worst tone found.
export function overallTone(sections) {
  const tones = sections.flatMap((s) => s.rows.map((r) => r.tone));
  return tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : 'good';
}

export function healthReport(data, now = Date.now()) {
  const s = data.settings;
  const st = data.status || {};
  const h = data.health || {};
  const villages = sortedVillages(data.villages);
  const auto = s.botEnabled || s.autopilot.enabled;
  const busy = s.watchEnabled || auto;
  const sections = [];

  // ---- Engine: is anything running at all?
  const engine = [];
  if (!s.server) engine.push(row('bad', t('health.server'), t('health.noServer'), t('health.noServerHelp'), 'settings'));
  else if (st.loggedOut) engine.push(row('bad', t('health.server'), t('status.loggedOut'), t('health.loggedOutHelp'), 'settings'));
  else engine.push(row('good', t('health.server'), new URL(s.server).host, st.lastPageAt ? t('health.lastPage', { ago: fmtAgo(st.lastPageAt, now) }) : '', 'settings'));
  const every = (s.refreshMinutes || 10) * 60000;
  if (st.state === 'working') engine.push(row('good', t('health.lastRun'), t('health.runningNow'), st.note || ''));
  else if (!busy) engine.push(row('muted', t('health.lastRun'), st.lastRunAt ? fmtAgo(st.lastRunAt, now) : '—', t('health.allOff')));
  else if (!st.lastRunAt) engine.push(row('warn', t('health.lastRun'), t('health.never'), t('health.neverHelp')));
  else {
    const late = now - st.lastRunAt;
    engine.push(row(late > Math.max(HOUR, every * 4) ? 'bad' : late > every * 2.5 ? 'warn' : 'good', t('health.lastRun'), fmtAgo(st.lastRunAt, now),
      late > every * 2.5 ? t('health.lateHelp') : t('health.everyN', { n: s.refreshMinutes })));
  }
  const other = leaseIsFresh(data.lease, now) && data.device && data.lease.deviceId !== data.device.id;
  if (other) engine.push(row('warn', t('health.device'), data.lease.deviceName, t('health.otherDeviceHelp'), 'settings'));
  else if (busy) engine.push(row('good', t('health.device'), t('health.thisDevice'), '', 'settings'));
  if ((st.userActiveUntil || 0) > now && s.pauseWhenPlaying) engine.push(row('warn', t('health.playing'), t('health.pausedUntil', { clock: fmtClock(st.userActiveUntil) }), t('health.playingHelp'), 'settings'));
  if (auto && !withinActiveHours(s.activeHours, new Date(now))) engine.push(row('warn', t('health.activeHours'), `${s.activeHours.from}–${s.activeHours.to}`, t('health.outsideHours'), 'settings'));
  if (st.pausedAll || st.tgPaused) engine.push(row('warn', t('health.pausedAll'), fmtAgo((st.pausedAll || {}).at || now, now), t('health.pausedAllHelp')));
  sections.push({ key: 'engine', title: t('health.engine'), rows: engine });

  // ---- Features: on, off, or on but unable to work — and why.
  const feat = [];
  const needAuto = (on, label, value, tab) => {
    if (!on) return row('muted', label, t('health.off'), '', tab);
    return auto ? row('good', label, value, '', tab) : row('warn', label, value, t('health.needsAutomation'), tab);
  };
  feat.push(row(s.watchEnabled ? 'good' : 'warn', t('toggle.watch'), s.watchEnabled ? t('health.on') : t('health.off'), s.watchEnabled ? '' : t('health.watchOffHelp')));
  const tasks = Object.values(data.tasks || {}).reduce((n, l) => n + l.length, 0);
  feat.push(row(s.botEnabled ? 'good' : 'muted', t('toggle.bot'), s.botEnabled ? t('health.on') : t('health.off'),
    !s.botEnabled && tasks ? t('health.tasksWaiting', { n: tasks }) : '', 'build'));
  if (!s.botEnabled && tasks) feat[feat.length - 1].tone = 'warn';
  const ap = s.autopilot;
  feat.push(row(ap.enabled ? 'good' : 'muted', t('toggle.autopilot'), ap.enabled ? t('health.on') : t('health.off'),
    ap.enabled ? ['build', 'adventures', 'farmLists', 'construct', 'quests', 'heroBag'].filter((k) => ap[k]).map((k) => t(`health.ap.${k}`)).filter(Boolean).join(t('list.sep')) : '', 'autopilot'));
  const lists = (data.farms || []).filter((l) => l.enabled !== false);
  feat.push(needAuto(lists.length > 0, t('health.farmLists'), t('health.nLists', { n: lists.length }), 'farms'));
  const raids = (data.raids || []).filter((r) => r.enabled !== false);
  feat.push(needAuto(raids.length > 0, t('health.raids'), t('health.nRules', { n: raids.length }), 'oasis'));
  const train = (data.training || []).filter((r) => r.enabled !== false);
  feat.push(needAuto(train.length > 0, t('health.training'), t('health.nRules', { n: train.length }), 'troops'));
  const plans = (data.escapes || []).filter((p) => p.enabled !== false);
  if (!plans.length) feat.push(row('muted', t('health.escapes'), t('health.off'), '', 'defense'));
  else if (!s.watchEnabled) feat.push(row('bad', t('health.escapes'), t('health.nPlans', { n: plans.length }), t('escape.warnWatch'), 'defense'));
  else if (villages.length < 2) feat.push(row('bad', t('health.escapes'), t('health.nPlans', { n: plans.length }), t('escape.warnOneVillage'), 'defense'));
  else feat.push(row('good', t('health.escapes'), t('health.nPlans', { n: plans.length }), t('health.escapesHelp'), 'defense'));
  const balance = s.merchants && s.merchants.enabled;
  if (balance) feat.push(needAuto(true, t('health.merchants'), t('health.on'), 'overview'));
  // Phone channels.
  const tg = s.telegram.token && s.telegram.chatId;
  const tgH = h.telegram || {};
  if (!tg) feat.push(row('muted', 'Telegram', t('health.notSetUp'), '', 'alerts'));
  else if (s.telegram.control !== false && tgH.at && !tgH.ok) feat.push(row('bad', 'Telegram', t('health.failing'), tgH.err || '', 'alerts'));
  else feat.push(row('good', 'Telegram', s.telegram.control !== false ? t('health.tgControl') : t('health.tgAlertsOnly'),
    tgH.okAt ? t('health.lastContact', { ago: fmtAgo(tgH.okAt, now) }) : '', 'alerts'));
  feat.push(row(s.discord.webhookUrl ? 'good' : 'muted', 'Discord', s.discord.webhookUrl ? t('health.on') : t('health.notSetUp'), '', 'alerts'));
  const web = s.web || {};
  const webH = h.web || {};
  if (!web.url || !web.key) feat.push(row('muted', t('health.web'), t('health.notSetUp'), '', 'settings'));
  else if (webH.at && !webH.ok) feat.push(row('bad', t('health.web'), t('health.failing'), webH.err || '', 'settings'));
  else feat.push(row('good', t('health.web'), web.url.replace(/^https?:\/\//, ''), webH.okAt ? t('health.lastContact', { ago: fmtAgo(webH.okAt, now) }) : '', 'settings'));
  const remote = h.remote || {};
  if (remote.at && !remote.ok && now - remote.at < 24 * HOUR) feat.push(row('bad', t('health.phoneAlerts'), t('health.failing'), remote.err || '', 'alerts'));
  sections.push({ key: 'features', title: t('health.features'), rows: feat });

  // ---- Jobs: last success and last failure of each kind of work.
  const jobs = [];
  for (const type of JOB_TYPES) {
    const j = (h.jobs || {})[type];
    if (!j) continue;
    const fails = (j.fails || []).filter((x) => now - x < 24 * HOUR).length;
    const lastBad = j.errAt && (!j.okAt || j.errAt > j.okAt);
    jobs.push({
      ...row(lastBad ? 'bad' : fails ? 'warn' : 'good', t(`health.job.${type}`), j.okAt ? fmtAgo(j.okAt, now) : '—', lastBad ? j.err : fails ? t('health.failsToday', { n: fails }) : '', JOB_TAB[type]),
      fails,
    });
  }
  sections.push({ key: 'jobs', title: t('health.jobs'), rows: jobs, empty: t('health.noJobs') });

  // ---- Errors in the last 24 hours.
  const errors = (data.log || []).filter((e) => e.level === 'error' && now - e.t < 24 * HOUR);
  sections.push({
    key: 'errors', title: t('health.errors'),
    rows: errors.slice(0, 8).map((e) => row('bad', fmtAgo(e.t, now), e.msg, e.villageId && data.villages[e.villageId] ? data.villages[e.villageId].name : '')),
    count: errors.length, empty: t('health.noErrors'),
  });

  // ---- Data: how old each village's information is.
  const fresh = villages.map((v) => {
    const age = now - (v.updatedAt || 0);
    const missing = [!v.buildings && t('health.missBuildings'), !v.troops && t('health.missTroops'), !v.resources && t('health.missResources')].filter(Boolean);
    const tone = !v.updatedAt ? 'warn' : busy && age > Math.max(2 * HOUR, every * 6) ? 'warn' : missing.length ? 'warn' : 'good';
    return row(tone, v.name, v.updatedAt ? fmtAgo(v.updatedAt, now) : t('health.never'), missing.length ? t('health.missing', { list: missing.join(t('list.sep')) }) : '');
  });
  sections.push({ key: 'data', title: t('health.data'), rows: fresh, empty: t('build.noVillages') });

  return { tone: overallTone(sections.filter((x) => x.key !== 'errors')), errors: errors.length, sections };
}
