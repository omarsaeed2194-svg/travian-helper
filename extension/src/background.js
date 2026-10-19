// Background service worker: stores what the content script reports, raises
// alerts, and drives a dedicated "bot tab" to run queued actions.
import {
  RESOURCES, resLabel, FIELD_RESOURCE, mergeSettings, capacityFor,
  estimateStock, fmtDuration, fmtClock, withinActiveHours, sortedVillages, taskLabel, buildingName,
  buildBlock, fmtNum,
} from './shared.js';
import { pickAutoUpgrade, troopsHome, raidTargets, oasisKey, farmTargets, coversTroops, cleanTroops, buildCategory, bagShortfall, distance } from './autopilot.js';
import { tribeBase } from './units.js';
import { recordMapVillages } from './inactive.js';
import { applyReports } from './reports.js';
import { savingFor, canAfford, CELEBRATIONS } from './culture.js';
import { expansionPlan, settlerHome, foundedNow, SETTLERS } from './expansion.js';
import { SNAPSHOT_KEYS, webBase, snapshotOf, hashOf, cleanRemote } from './web.js';
import { firstAttack, escapeTiming, escapeDone, escapeDue, escapeTarget, escapeTroops, TOO_LATE_MS, donateTiming, donateDone, donateDue, donationAmounts, amountsText, sameAttack } from './escape.js';
import { parseCommand, statusText, summaryText, helpText } from './telegram.js';
import { t, setLanguage, coords, ltr } from './i18n.js';
import {
  COMMAND_KEYS, commandsOf, schedulePush, pushCommands, pullCommands, mayRun, renewLease, getDevice,
} from './sync.js';

const LOG_LIMIT = 300;
const PAGE_TIMEOUT_MS = 45000;
const BUILDINGS_RESCAN_MS = 3 * 3600 * 1000;
const STORAGE_REALERT_MS = 6 * 3600 * 1000;
const MAX_BUILD_ATTEMPTS = 6;
const HISTORY_STEP_MS = 5 * 60 * 1000;
const HISTORY_KEEP_MS = 24 * 3600 * 1000;
const AUTO_IDLE_MS = 30 * 60 * 1000;      // autopilot found nothing to build: look again later
const AUTO_SKIP_MS = 2 * 3600 * 1000;     // an upgrade the game refused: try others first
const SCAN_EVERY_MS = 12 * 3600 * 1000;   // re-scan the map for oases
const TROOP_BUILDINGS = [19, 20, 21, 29, 30];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const jittered = (ms, pct) => Math.round(ms * (1 + ((Math.random() * 2 - 1) * pct) / 100));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- storage --
// Every read-modify-write of chrome.storage goes through this queue so the
// bot loop, page reports and dashboard edits never overwrite each other.
// Never call update() (or log()) from inside an update callback.
let queue = Promise.resolve();
function update(keys, fn) {
  const run = queue.then(async () => {
    const data = await chrome.storage.local.get(keys);
    const result = await fn(data);
    await chrome.storage.local.set(data);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
const read = (keys) => chrome.storage.local.get(keys);
async function getSettings() {
  const s = mergeSettings((await read(['settings'])).settings);
  setLanguage(s.language);
  return s;
}

// Failure text from the content script: a reason code, or a raw message.
const reasonText = (res) => (res.code ? t(`reason.${res.code}`) : res.reason || '');

async function log(level, msg, villageId) {
  await update(['log', 'stats'], (d) => {
    d.log = d.log || [];
    d.log.unshift({ t: Date.now(), level, msg, villageId: villageId || null });
    if (d.log.length > LOG_LIMIT) d.log.length = LOG_LIMIT;
    if (level === 'error') d.stats = { since: Date.now(), ...(d.stats || {}), errors: ((d.stats || {}).errors || 0) + 1 };
  });
}

// Counters for the daily summary, reset each time it is sent.
async function bump(key, n = 1) {
  if (!n) return;
  await update(['stats'], (d) => { d.stats = { since: Date.now(), ...(d.stats || {}) }; d.stats[key] = (d.stats[key] || 0) + n; });
}

async function setStatus(patch) {
  await update(['status'], (d) => { d.status = { ...(d.status || {}), ...patch }; });
}

// Bookkeeping for the Health tab: how each job and each outside service
// did the last time it ran.
async function noteJob(type, ok, err) {
  await update(['health'], (d) => {
    const h = d.health = d.health || {};
    const j = (h.jobs = h.jobs || {})[type] = { ...((h.jobs || {})[type] || {}) };
    const now = Date.now();
    if (ok) j.okAt = now;
    else { j.errAt = now; j.err = String(err || '').slice(0, 200); j.fails = [...(j.fails || []).filter((x) => now - x < 86400000), now].slice(-50); }
  });
}
async function noteService(name, ok, err) {
  await update(['health'], (d) => {
    const h = d.health = d.health || {};
    h[name] = { ...(h[name] || {}), at: Date.now(), ok, ...(ok ? { okAt: Date.now() } : { err: String(err || '').slice(0, 200), errAt: Date.now() }) };
  });
}

// ----------------------------------------------------------------- alerts --
async function sendAlert({ title, body, kind, sticky, villageId }) {
  const s = await getSettings();
  if (kind && s.alerts[kind] === false) return;
  await log('alert', `${title} — ${body}`, villageId);
  if (s.alerts.desktop) {
    chrome.notifications.create(`tvh-${Date.now()}-${uid()}`, {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title, message: body, priority: 2, requireInteraction: !!sticky,
    });
  }
  await sendRemote(s, `${title}\n${body}`);
}

async function sendRemote(s, text) {
  const jobs = [];
  if (s.telegram.token && s.telegram.chatId) {
    jobs.push(fetch(`https://api.telegram.org/bot${encodeURIComponent(s.telegram.token)}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: s.telegram.chatId, text }),
    }).then((r) => { if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`); }));
  }
  if (/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(s.discord.webhookUrl || '')) {
    jobs.push(fetch(s.discord.webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    }).then((r) => { if (!r.ok) throw new Error(`Discord HTTP ${r.status}`); }));
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (failed.length) await log('error', t('log.remoteFailed', { e: failed.join(', ') }));
  if (jobs.length) await noteService('remote', !failed.length, failed.join(', '));
  return { sent: jobs.length, failed };
}

async function refreshBadge() {
  const { villages = {}, status = {}, settings } = await read(['villages', 'status', 'settings']);
  const s = mergeSettings(settings);
  const attacked = Object.values(villages).filter((v) => v.underAttack).length;
  let text = '', color = '#16a34a';
  if (attacked) { text = String(attacked); color = '#dc2626'; }
  else if (status.loggedOut) { text = '!'; color = '#ea580c'; }
  else if (s.autopilot.enabled) { text = 'AUTO'; }
  else if (s.botEnabled) { text = 'ON'; }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// ------------------------------------------------------- page processing --
async function processPage(state, tabId) {
  const now = Date.now();
  const { workerTabId } = await chrome.storage.session.get('workerTabId');
  const fromWorker = tabId != null && tabId === workerTabId;
  const alerts = [];
  const notes = [];
  const events = []; // [level, message, villageId] for the activity log

  await update(['settings', 'villages', 'account', 'status', 'alertMemo', 'history', 'oases'], (d) => {
    const s = mergeSettings(d.settings);
    setLanguage(s.language);
    d.status = d.status || {};
    d.alertMemo = d.alertMemo || {};

    if (state.type === 'login') {
      if (!d.status.loggedOut) {
        alerts.push({ kind: 'loggedOut', title: t('alert.loggedOut.title'), body: t('alert.loggedOut.body'), sticky: true });
      }
      d.status.loggedOut = true;
      return;
    }
    d.status.loggedOut = false;
    d.status.lastPageAt = now;

    if (s.server !== state.server) {
      if (s.server) {
        d.villages = {};
        notes.push(t('log.serverSwitch', { s: state.server }));
      }
      s.server = state.server;
      d.settings = s;
    }

    d.villages = d.villages || {};
    const listed = state.villages || [];
    const attackAlerts = {};
    listed.forEach((vi, order) => {
      const v = d.villages[vi.id] || (d.villages[vi.id] = { id: vi.id });
      const wasAttacked = !!v.underAttack;
      Object.assign(v, { name: vi.name, x: vi.x, y: vi.y, order, underAttack: vi.underAttack });
      if (vi.underAttack && !wasAttacked) {
        v.needsRefresh = true; // fetch arrival times on the next tick
        attackAlerts[vi.id] = { villageId: vi.id, kind: 'attacks', sticky: true, title: t('alert.attack.title', { v: vi.name }), body: t('alert.attack.body', { xy: coords(vi.x, vi.y) }) };
      }
      if (!vi.underAttack && wasAttacked) events.push(['info', t('log.attackOver', { v: vi.name }), vi.id]);
      if (!vi.underAttack) v.incomingAttacks = 0;
    });
    if (listed.length) {
      const ids = new Set(listed.map((v) => v.id));
      for (const id of Object.keys(d.villages)) if (!ids.has(id)) delete d.villages[id];
      for (const id of Object.keys(d.history || {})) if (!ids.has(id)) delete d.history[id];
    }

    const v = state.villageId && d.villages[state.villageId];
    if (v) {
      if (state.resources) {
        v.resources = state.resources;
        v.resourcesAt = now;
        // A point every few minutes, kept for a day, for the dashboard chart.
        const r = state.resources;
        d.history = d.history || {};
        const h = d.history[v.id] || (d.history[v.id] = []);
        if (r.stock && (!h.length || now - h[h.length - 1].t >= HISTORY_STEP_MS)) {
          h.push({ t: now, s: [r.stock.wood, r.stock.clay, r.stock.iron, r.stock.crop], c: [r.capacity.warehouse, r.capacity.granary] });
          while (h.length && now - h[0].t > HISTORY_KEEP_MS) h.shift();
        }
      }
      if (state.type === 'dorf1' || state.type === 'dorf2') {
        v.queueAt = now;
        v.buildQueue = (state.buildQueue || []).map((b) => ({
          name: b.name, level: b.level, finishAt: b.secondsLeft != null ? now + b.secondsLeft * 1000 : null,
        }));
      }
      // Report finished upgrades: compare levels with what we saw last time.
      const levelUps = (before, after) => {
        const old = Object.fromEntries((before || []).map((b) => [b.slot, b]));
        for (const b of after) {
          const prev = old[b.slot];
          if (prev && prev.gid === b.gid && b.level > prev.level) {
            events.push(['success', t('log.levelUp', { name: buildingName(b.gid, b.name), n: b.level }), v.id]);
          }
        }
      };
      if (state.fields) { levelUps(v.fields, state.fields); v.fields = state.fields; v.fieldsAt = now; }
      if (state.buildings) { levelUps(v.buildings, state.buildings); v.buildings = state.buildings; v.buildingsAt = now; }
      if (state.troops) { v.troops = state.troops; v.troopsAt = now; }
      if (state.buildPage) {
        const bp = state.buildPage;
        const slotBuilding = (v.buildings || []).find((b) => b.slot === bp.slot);
        const gid = Number(new URL(state.url).searchParams.get('gid')) || (slotBuilding && slotBuilding.gid);
        if (gid && bp.trainable && bp.trainable.length) v.units = { ...(v.units || {}), [gid]: bp.trainable.map(({ field, unit, name }) => ({ field, unit, name })) };
        if (gid && bp.trainingQueue) {
          const items = bp.trainingQueue.map((q) => ({ unit: q.unit, name: q.name, count: q.count, finishAt: q.secondsLeft != null ? now + q.secondsLeft * 1000 : null }));
          v.trainingQueue = { ...(v.trainingQueue || {}), [gid]: { at: now, items } };
        }
        // Town Hall: is a celebration running, and until when.
        if (bp.celebration) {
          v.celebrationUntil = bp.celebration.running ? now + (bp.celebration.secondsLeft || 0) * 1000 : 0;
          v.celebrationSeenAt = now;
        }
      }
      if (state.movements) {
        // Timers are whole seconds read at load time, so each read lands a
        // second or so off: keep the earlier time for the same movement.
        const prev = v.movements || [];
        v.movements = state.movements.map((m) => {
          let arriveAt = m.secondsLeft != null ? now + m.secondsLeft * 1000 : null;
          const same = arriveAt && prev.find((p) => p.kind === m.kind && p.arriveAt && Math.abs(p.arriveAt - arriveAt) <= 2500);
          if (same) arriveAt = same.arriveAt;
          return { ...m, arriveAt };
        });
        v.movementsAt = now;
        const incoming = v.movements.filter((m) => m.kind === 'att1');
        const count = incoming.reduce((n, m) => n + (m.count || 1), 0);
        if (count > (v.incomingAttacks || 0)) {
          const first = incoming.map((m) => m.arriveAt).filter(Boolean).sort((a, b) => a - b)[0];
          attackAlerts[v.id] = {
            villageId: v.id, kind: 'attacks', sticky: true,
            title: t('alert.attacks.title', { n: count, v: v.name }),
            body: first ? t('alert.attacks.first', { t: fmtDuration(first - now), clock: fmtClock(first) }) : t('alert.attacks.noTime', { xy: coords(v.x, v.y) }),
          };
        }
        v.incomingAttacks = count;
        v.needsRefresh = false;
      }
      v.updatedAt = now;

      if (state.resources && state.resources.production) {
        const res = state.resources;
        const filling = [];
        for (const k of RESOURCES) {
          const prod = res.production[k];
          const stock = res.stock[k];
          const cap = capacityFor(res, k);
          if (prod > 0 && cap && stock != null) {
            const hours = (cap - stock) / prod;
            const key = `full:${v.id}:${k}`;
            if (hours <= s.alerts.storageHours && now - (d.alertMemo[key] || 0) > STORAGE_REALERT_MS) {
              d.alertMemo[key] = now;
              filling.push(hours <= 0 ? t('alert.storage.full', { res: resLabel(k) }) : t('alert.storage.fullIn', { res: resLabel(k), t: fmtDuration(hours * 3600000) }));
            }
          }
          if (k === 'crop' && prod < 0 && stock != null) {
            const hours = stock / -prod;
            const key = `starve:${v.id}`;
            if (hours <= 3 && now - (d.alertMemo[key] || 0) > STORAGE_REALERT_MS) {
              d.alertMemo[key] = now;
              alerts.push({ villageId: v.id, kind: 'starvation', title: t('alert.starve.title', { v: v.name }), body: t('alert.starve.body', { t: fmtDuration(hours * 3600000), p: ltr(prod) }), sticky: true });
            }
          }
        }
        if (filling.length) {
          alerts.push({ villageId: v.id, kind: 'storage', title: t('alert.storage.title', { v: v.name }), body: t('alert.storage.body', { list: filling.join(t('list.sep')) }) });
        }
      }
    }
    alerts.push(...Object.values(attackAlerts));

    // A map tile: remember oases (and what guards them) for raids.
    const tile = state.tile;
    if (tile && tile.x != null && tile.y != null) {
      d.oases = d.oases || {};
      const key = oasisKey(tile.x, tile.y);
      const prev = d.oases[key];
      if (tile.isOasis || prev) {
        d.oases[key] = { ...(prev || {}), x: tile.x, y: tile.y, owned: tile.owned, animals: tile.animals, checkedAt: now, notOasis: !tile.isOasis && !(prev && prev.fromScan) };
      }
    }

    d.account = d.account || {};
    if (state.account) {
      d.account.gold = state.account.gold;
      d.account.silver = state.account.silver;
      d.account.hero = state.account.hero;
    }
    if (state.account) d.account.questClaimable = !!state.account.questClaimable;
    // Villages / slots and the bar towards the next slot (culture points).
    const ex = state.account && state.account.expansion;
    if (ex && ex.total != null) {
      const prev = d.account.expansion;
      if (prev && prev.total != null && ex.total > prev.total) {
        alerts.push({ title: t('alert.newSlot.title'), body: t('alert.newSlot.body', { used: ex.used, n: ex.total }) });
      }
      d.account.expansion = { ...ex, at: now };
      const hist = d.account.cpHistory || [];
      const last = hist[hist.length - 1];
      if (!last || now - last.at > 20 * 60000 || last.total !== ex.total) d.account.cpHistory = [...hist, { at: now, pct: ex.pct, total: ex.total }].slice(-120);
    }
    if (state.quests && state.quests.loaded) d.account.questClaimable = state.quests.claimable > 0;
    if (state.inventory && state.inventory.loaded) {
      const it = state.inventory.items || {};
      d.account.heroBag = { wood: it['145'] || 0, clay: it['146'] || 0, iron: it['147'] || 0, crop: it['148'] || 0, at: now };
    }
    if (state.farmLists) d.account.farmLists = state.farmLists;
    d.account.updatedAt = now;
  });

  for (const n of notes) await log('info', n);
  for (const [level, msg, vid] of events) await log(level, msg, vid);
  for (const a of alerts) await sendAlert(a);
  await bump('completed', events.filter((e) => e[0] === 'success').length);
  await bump('attacks', alerts.filter((a) => a.kind === 'attacks').length);
  await refreshBadge();
  await armEscapes();
  return fromWorker ? { worker: true, badge: t('badge.worker') } : { worker: false };
}

// ---------------------------------------------------------- troop escape --
// An escape due now interrupts whatever the bot is doing (see runJobs).
let urgent = false;
const kicked = new Set(); // escapes already started from a page report

// Keep one alarm per protected village at the moment its troops must start
// leaving, and tell the player when an attack their troops dodged is over.
// One at a time: a call that read the villages before an attack showed up
// must not clear the timer a newer call just set.
let arming = Promise.resolve();
function armEscapes() {
  arming = arming.then(armEscapesNow, armEscapesNow);
  return arming;
}

async function armEscapesNow() {
  const { villages = {}, escapes = [] } = await read(['villages', 'escapes']);
  const now = Date.now();
  const wanted = new Map();
  for (const plan of escapes) {
    const v = villages[plan.villageId];
    if (!v || plan.enabled === false || plan.troops === false) continue;
    const tm = escapeTiming(v, plan, now);
    if (!tm || tm.first - now < TOO_LATE_MS || escapeDone(v, tm.first)) continue;
    if (tm.startAt > now + 1000) wanted.set(`escape:${v.id}`, tm.startAt);
    else if (!kicked.has(`${v.id}:${tm.first}`)) {
      kicked.add(`${v.id}:${tm.first}`);
      urgent = true;
      tick(false, true);
    }
  }
  // Donations have their own timer, usually later than the troops'.
  for (const plan of escapes) {
    const v = villages[plan.villageId];
    if (!v || plan.enabled === false || !plan.donate) continue;
    const tm = donateTiming(v, plan, now);
    if (!tm || tm.first - now < TOO_LATE_MS || donateDone(v, tm.first)) continue;
    if (tm.startAt > now + 1000) wanted.set(`donate:${v.id}`, tm.startAt);
    else if (!kicked.has(`d:${v.id}:${tm.first}`)) {
      kicked.add(`d:${v.id}:${tm.first}`);
      urgent = true;
      tick(false, true);
    }
  }
  const alarms = await chrome.alarms.getAll();
  for (const a of alarms) if ((a.name.startsWith('escape:') || a.name.startsWith('donate:')) && !wanted.has(a.name)) await chrome.alarms.clear(a.name);
  for (const [name, when] of wanted) {
    const have = alarms.find((a) => a.name === name);
    if (!have || Math.abs(have.scheduledTime - when) > 1000) await chrome.alarms.create(name, { when });
  }
  // Attack over: the troops are still sitting in the other village.
  for (const plan of escapes) {
    const v = villages[plan.villageId];
    const st = v && v.escape;
    if (!st || st.status !== 'sent' || st.overNotified || v.underAttack || firstAttack(v, now)) continue;
    await update(['villages'], (d) => { const x = d.villages && d.villages[v.id]; if (x && x.escape) x.escape.overNotified = true; });
    const to = villages[st.to];
    await sendAlert({ kind: 'attacks', villageId: v.id, title: t('alert.escapeOver.title', { v: v.name }), body: t('alert.escapeOver.body', { to: to ? to.name : '?' }) });
  }
}

// Villages with an escape plan that are under attack but whose arrival time
// isn't known (or is old): read their main page first.
function escapeRefreshIds(data, now) {
  const { villages = {}, escapes = [] } = data;
  return escapes.filter((p) => p.enabled !== false).map((p) => villages[p.villageId]).filter((v) => v && v.underAttack &&
    (v.needsRefresh || (!firstAttack(v, now) && (!v.movementsAt || now - v.movementsAt > 5 * 60000)))).map((v) => v.id);
}

function planEscapes(data, now) {
  const { villages = {}, escapes = [], schedule = {} } = data;
  const forced = new Set(schedule.escapeNow || []);
  const jobs = escapes.filter((p) => villages[p.villageId] && escapeDue(villages[p.villageId], p, now, forced.has(p.villageId)))
    .map((p) => ({ type: 'escape', planId: p.id, force: forced.has(p.villageId), label: t('job.escape', { v: villages[p.villageId].name }) }));
  for (const p of escapes) {
    const v = villages[p.villageId];
    if (v && donateDue(v, p, now)) jobs.push({ type: 'donate', planId: p.id, label: t('job.donate', { v: v.name }) });
  }
  // "Test donation" from the Defense page: a small amount, right now.
  const test = schedule.donateTest && villages[schedule.donateTest.villageId];
  if (test) jobs.push({ type: 'donate', villageId: test.id, test: true, label: t('job.donateTest', { v: test.name }) });
  return jobs;
}

// Runs before anything else and ignores "pause while playing", active hours
// and the automation switches: the plan itself is the player's go-ahead.
async function runEscapeStage(tabId, s) {
  urgent = false;
  let data = await read(DATA_KEYS);
  const ids = escapeRefreshIds(data, Date.now());
  if (ids.length) await runJobs(tabId, [{ type: 'refresh', villageIds: ids, quick: true, label: t('job.refreshAttacked') }], s, true);
  data = await read(DATA_KEYS);
  const jobs = planEscapes(data, Date.now());
  if (jobs.length) await runJobs(tabId, jobs, s, true);
}

const troopsText = (v, troops) => {
  const names = {};
  for (const x of v.troops || []) names[x.unit === 'hero' ? 't11' : `t${((Number(x.unit.slice(1)) - 1) % 10) + 1}`] = x.name;
  return Object.entries(troops).map(([f, n]) => `${n} ${names[f] || f}`).join(t('list.sep'));
};

// ------------------------------------------------------------- bot tab ----
const waiters = new Map(); // tabId -> { resolve, reject, timer }

function waitForPage(tabId, timeout = PAGE_TIMEOUT_MS) {
  const prev = waiters.get(tabId);
  if (prev) { clearTimeout(prev.timer); prev.reject(new Error('Superseded')); }
  let entry;
  const promise = new Promise((resolve, reject) => {
    entry = {
      resolve, reject,
      timer: setTimeout(() => { waiters.delete(tabId); reject(new Error(t('err.timeout'))); }, timeout),
    };
  });
  waiters.set(tabId, entry);
  promise.cancel = () => {
    if (waiters.get(tabId) === entry) { clearTimeout(entry.timer); waiters.delete(tabId); }
  };
  promise.catch(() => {});
  return promise;
}

function resolvePage(tabId, state) {
  const w = waiters.get(tabId);
  if (!w) return;
  waiters.delete(tabId);
  clearTimeout(w.timer);
  w.resolve(state);
}

async function navigate(tabId, url, timeout = PAGE_TIMEOUT_MS) {
  const page = waitForPage(tabId, timeout);
  await chrome.tabs.update(tabId, { url });
  const state = await page;
  if (state.type === 'login') throw Object.assign(new Error(t('err.loggedOut')), { loggedOut: true });
  return state;
}

// Ask the content script to click something. If the click navigates, wait
// for the next page and return it alongside the content script's answer.
async function act(tabId, action, expectNavigation) {
  const page = expectNavigation ? waitForPage(tabId) : null;
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: 'ACTION', action });
  } catch (e) {
    if (/Receiving end does not exist/i.test(e.message)) {
      res = { ok: false, code: 'notLoaded' };
    } else {
      // The page navigated away before answering; treat the click as done.
      res = { ok: true, navigating: true, lost: true };
    }
  }
  if (!res || !res.ok) {
    if (page) page.cancel();
    return { res: res || { ok: false, code: 'noResponse' } };
  }
  return { res, page: page ? await page : null };
}

async function ensureWorkerTab(server) {
  const { workerTabId } = await chrome.storage.session.get('workerTabId');
  if (workerTabId != null) {
    try {
      const existing = await chrome.tabs.get(workerTabId);
      const url = existing.url || existing.pendingUrl || '';
      if (url.startsWith(server)) return workerTabId;
    } catch (e) { /* closed */ }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false, pinned: true });
  await chrome.storage.session.set({ workerTabId: tab.id });
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) { /* older Chrome */ }
  await navigate(tab.id, `${server}/dorf1.php`);
  return tab.id;
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { workerTabId } = await chrome.storage.session.get('workerTabId');
  if (tabId === workerTabId) await chrome.storage.session.remove('workerTabId');
  const w = waiters.get(tabId);
  if (w) { waiters.delete(tabId); clearTimeout(w.timer); w.reject(new Error(t('err.tabClosed'))); }
});

// ------------------------------------------------------------------ jobs ---
function pickField(v, task) {
  const stock = estimateStock(v) || {};
  const candidates = (v.fields || []).filter((f) =>
    !f.underConstruction && !f.maxLevel && f.level < task.targetLevel &&
    (!task.resource || task.resource === 'all' || FIELD_RESOURCE[f.gid] === task.resource));
  candidates.sort((a, b) => a.level - b.level || (stock[FIELD_RESOURCE[a.gid]] || 0) - (stock[FIELD_RESOURCE[b.gid]] || 0));
  return candidates[0] || null;
}

async function removeTask(villageId, taskId) {
  await update(['tasks'], (d) => {
    d.tasks = d.tasks || {};
    d.tasks[villageId] = (d.tasks[villageId] || []).filter((x) => x.id !== taskId);
  });
}

async function patchVillage(villageId, patch) {
  await update(['villages'], (d) => {
    if (d.villages && d.villages[villageId]) Object.assign(d.villages[villageId], patch);
  });
}

async function patchSchedule(patch) {
  await update(['schedule'], (d) => { d.schedule = { ...(d.schedule || {}), ...patch }; });
}

// ------------------------------------------------------------ sending ------
// Problems with the page itself: later sends in the same round would fail too.
const FATAL_SEND = new Set(['noCoordInput', 'noRaidOption', 'noReinforceOption', 'noSendButton', 'notLoaded', 'noResponse', 'unknownAction']);

// Rally point → fill in `troops` for (x, y) → confirm. Returns { ok } or
// { ok: false, reason, short?, fatal? }. `available` is what the form showed
// before this send (troops at home that can actually leave).
async function sendTroops(tabId, s, vid, { x, y, troops, mission = 'raid' }) {
  const form = await navigate(tabId, `${s.server}/build.php?newdid=${encodeURIComponent(vid)}&gid=16&tt=2`);
  const sp = form.sendPage;
  if (!sp || sp.stage !== 'form') return { ok: false, fatal: true, reason: t('reason.noSendForm') };
  const available = sp.available;
  if (typeof troops === 'function') troops = troops(available);
  if (!Object.keys(troops).length) return { ok: false, empty: true, available, reason: t('reason.notEnoughTroops') };
  if (Object.entries(troops).some(([f, n]) => available[f] != null && available[f] < n)) {
    return { ok: false, short: true, available, reason: t('reason.notEnoughTroops') };
  }
  const { res, page: confirm } = await act(tabId, { kind: 'sendForm', x, y, troops, mission }, true);
  if (!res.ok) return { ok: false, fatal: FATAL_SEND.has(res.code), available, reason: reasonText(res) };
  const cp = confirm && confirm.sendPage;
  // The game shows the form again with its own message (beginner's
  // protection, no village there…): that target fails, others may not.
  if (!cp || cp.stage !== 'confirm') return { ok: false, available, reason: (cp && cp.error) || t('reason.noConfirmPage') };
  const { res: res2, page: after } = await act(tabId, { kind: 'sendConfirm', x, y, mission }, true);
  if (!res2.ok) return { ok: false, available, reason: reasonText(res2) };
  if (after && after.sendPage && after.sendPage.stage === 'confirm') {
    return { ok: false, available, reason: after.sendPage.error || t('reason.stillOnConfirm') };
  }
  return { ok: true, available, sent: troops };
}

// Opens an oasis right before raiding it. Only an unoccupied oasis with no
// animals passes. `trusted`: the player (or the map) already said it is one.
async function checkOasis(tabId, s, x, y, trusted) {
  const xy = coords(x, y);
  const page = await navigate(tabId, `${s.server}/position_details.php?x=${x}&y=${y}`);
  const tile = page.tile;
  if (!tile) return { ok: false, level: 'error', msg: t('log.raidNoTile', { xy }) };
  if (tile.owned) return { ok: false, level: 'info', msg: t('log.raidOwned', { xy }) };
  if (!tile.isOasis && !trusted) return { ok: false, level: 'info', msg: t('log.raidNotOasis', { xy }) };
  if (tile.animals == null) return { ok: false, level: 'error', msg: t('log.raidNoTile', { xy }) };
  if (tile.animals > 0) return { ok: false, level: 'info', msg: t('log.raidAnimals', { xy, n: tile.animals }) };
  return { ok: true };
}

const JOBS = {
  // Move the village's troops out before the attack lands.
  async escape(tabId, job, s) {
    const { escapes = [] } = await read(['escapes']);
    const plan = escapes.find((p) => p.id === job.planId);
    if (!plan) return;
    const vid = plan.villageId;
    await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`); // fresh arrival times
    const { villages = {} } = await read(['villages']);
    const v = villages[vid];
    if (!v) return;
    await update(['schedule'], (d) => { if (d.schedule && d.schedule.escapeNow) d.schedule.escapeNow = d.schedule.escapeNow.filter((x) => x !== vid); });
    const tm = escapeDue(v, plan, Date.now(), job.force);
    if (!tm) return; // attack recalled, or already handled
    const setState = (patch) => update(['villages'], (d) => {
      const x = d.villages && d.villages[vid];
      if (x) x.escape = { ...(x.escape && sameAttack(x.escape.forAttack, tm.first) ? x.escape : {}), forAttack: tm.first, at: Date.now(), ...patch };
    });
    const lands = fmtClock(tm.first);
    const dest = escapeTarget(v, plan, villages);
    if (!dest) {
      await setState({ status: 'failed', tries: 99, reason: t('reason.noSafeVillage') });
      await sendAlert({ kind: 'attacks', sticky: true, villageId: vid, title: t('alert.escapeFailed.title', { v: v.name }), body: t('alert.escapeFailed.body', { reason: t('reason.noSafeVillage'), clock: lands }) });
      return;
    }
    const r = await sendTroops(tabId, s, vid, { x: dest.village.x, y: dest.village.y, troops: (available) => escapeTroops(plan, available), mission: 'reinforce' });
    // Troops first; then what's in storage goes into training so there is
    // less to steal.
    if (plan.spend) await spendBeforeAttack(tabId, s, plan, vid, tm.first).catch((e) => log('error', t('log.spendFailed', { reason: e.message }), vid));
    if (r.empty) {
      await setState({ status: 'nothing', to: dest.village.id });
      await log('info', t('log.escapeNothing', { lands }), vid);
      return;
    }
    if (r.ok) {
      const what = troopsText(v, r.sent);
      await setState({ status: 'sent', to: dest.village.id, sent: r.sent, fallback: dest.fallback, overNotified: false });
      await log('success', t('log.escaped', { what, to: dest.village.name, lands }), vid);
      await bump('escapes');
      await sendAlert({
        kind: 'attacks', villageId: vid, title: t('alert.escaped.title', { v: v.name }),
        body: t(dest.fallback ? 'alert.escaped.bodyFallback' : 'alert.escaped.body', { what, to: dest.village.name, lands }),
      });
      return;
    }
    const tries = ((v.escape && sameAttack(v.escape.forAttack, tm.first) && v.escape.tries) || 0) + 1;
    await setState({ status: 'failed', tries, reason: r.reason, to: dest.village.id });
    await log('error', t('log.escapeFailed', { reason: r.reason }), vid);
    await sendAlert({ kind: 'attacks', sticky: true, villageId: vid, title: t('alert.escapeFailed.title', { v: v.name }), body: t('alert.escapeFailed.body', { reason: r.reason, clock: lands }) });
  },

  // Alliance donation before an attack (or a small test one). Verified by
  // the village's stock actually dropping afterwards.
  async donate(tabId, job, s) {
    const { escapes = [] } = await read(['escapes']);
    const plan = job.test ? null : escapes.find((p) => p.id === job.planId);
    const vid = job.test ? job.villageId : plan && plan.villageId;
    if (!vid) return;
    if (job.test) await patchSchedule({ donateTest: null });
    await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`); // fresh stock and arrival time
    let { villages = {} } = await read(['villages']);
    const v = villages[vid];
    if (!v) return;
    const tm = job.test ? null : donateDue(v, plan, Date.now());
    if (!job.test && !tm) return; // attack recalled, or already done
    const setState = (patch) => update(['villages'], (d) => {
      const x = d.villages && d.villages[vid];
      if (x && !job.test) x.donation = { ...(x.donation && sameAttack(x.donation.forAttack, tm.first) ? x.donation : {}), forAttack: tm.first, at: Date.now(), ...patch };
    });
    const amounts = job.test ? { wood: 10, clay: 10, iron: 10, crop: 10 } : donationAmounts(v, plan, Date.now(), tribeBase(villages));
    if (!amounts) {
      await setState({ status: 'nothing' });
      await log('info', t('log.donateNothing'), vid);
      return;
    }
    const before = Object.values(v.resources.stock || {}).reduce((n, x) => n + (x || 0), 0);
    const fail = async (reason) => {
      if (job.test) { await log('error', t('log.donateTestFailed', { reason }), vid); return; }
      const tries = ((v.donation && sameAttack(v.donation.forAttack, tm.first) && v.donation.tries) || 0) + 1;
      await setState({ status: 'failed', tries, reason });
      await log('error', t('log.donateFailed', { reason }), vid);
      if (tries >= 2) await sendAlert({ kind: 'attacks', sticky: true, villageId: vid, title: t('alert.donateFailed.title', { v: v.name }), body: t('alert.donateFailed.body', { reason }) });
    };
    // The alliance bonus page; if it isn't where expected, try the alliance
    // page and follow the game's own link to the bonuses.
    // The plan's bonus (the test uses the village's plan too, if it has one).
    const own = plan || escapes.find((p) => p.villageId === vid);
    const bonus = own && own.donate ? own.donate.bonus : -1;
    const tried = new Set();
    let next = `${s.server}/alliance/bonuses`;
    let at = next;
    let res = { ok: false, code: 'noDonateForm' };
    while (next && !res.ok && tried.size < 3) {
      tried.add(next);
      at = next;
      try {
        await navigate(tabId, next, 15000); // an attack is close: don't wait long on a wrong address
        ({ res } = await act(tabId, { kind: 'donate', amounts, bonus }, false));
      } catch (e) {
        if (e.loggedOut) throw e;
        res = { ok: false, code: 'noDonateForm' };
      }
      const link = !res.ok && res.link ? new URL(res.link, s.server).href : null;
      next = link && !tried.has(link) ? link : !res.ok && res.code === 'noDonateForm' && !tried.has(`${s.server}/alliance`) ? `${s.server}/alliance` : null;
    }
    if (!res.ok) { await fail(reasonText(res)); return; }
    // What actually went in (the daily limit or a box's maximum can cut it).
    const given = res.sent || amounts;
    const sum = Object.values(given).reduce((n, x) => n + x, 0);
    // Proof it went in: the bonus page's own "given today" count went up, or
    // the stock dropped — measured against what the fields would have made
    // meanwhile (on fast servers that hides a small donation).
    let counted = res.donatedBefore != null && res.donatedAfter != null && res.donatedAfter - res.donatedBefore >= sum * 0.5;
    if (!counted && res.donatedBefore != null) {
      await sleep(rand(800, 1500));
      try {
        await navigate(tabId, at, 15000);
        const { res: info } = await act(tabId, { kind: 'donateInfo' }, false);
        counted = info && info.donatedToday != null && info.donatedToday - res.donatedBefore >= sum * 0.5;
      } catch (e) {
        if (e.loggedOut) throw e;
      }
    }
    await sleep(rand(800, 1500));
    await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
    ({ villages = {} } = await read(['villages']));
    const now2 = villages[vid].resourcesAt || Date.now();
    const sumOf = (x) => Object.values(x || {}).reduce((n, y) => n + (y || 0), 0);
    const expected = sumOf(estimateStock(v, now2)) || before;
    const dropped = expected - sumOf((villages[vid].resources || {}).stock) >= sum * 0.5;
    if (!counted && !dropped) { await fail(t('reason.donateNotConfirmed')); return; }
    if (job.test) { await log('success', t('log.donateTestOk', { what: amountsText(given) }), vid); return; }
    await setState({ status: 'sent', amounts: given });
    await log('success', t('log.donated', { what: amountsText(given), lands: fmtClock(tm.first) }), vid);
    await bump('donations');
    await sendAlert({ kind: 'attacks', villageId: vid, title: t('alert.donated.title', { v: v.name }), body: t('alert.donated.body', { what: amountsText(given), lands: fmtClock(tm.first) }) });
  },

  async refresh(tabId, job, s) {
    let { villages = {} } = await read(['villages']);
    let ids = job.villageIds || sortedVillages(villages).map((v) => v.id);
    if (!ids.length) {
      const first = await navigate(tabId, `${s.server}/dorf1.php`);
      ids = (first.villages || []).map((v) => v.id).filter((id) => id !== first.villageId);
    }
    for (const id of ids) {
      if (urgent && !job.quick) break; // an escape is due: let it run first
      await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(id)}`);
      if (job.quick) continue;
      ({ villages = {} } = await read(['villages']));
      const v = villages[id];
      if (v && (!v.buildingsAt || Date.now() - v.buildingsAt > BUILDINGS_RESCAN_MS)) {
        await sleep(rand(1200, 3000));
        await navigate(tabId, `${s.server}/dorf2.php?newdid=${encodeURIComponent(id)}`);
      }
      // What's in training: look once, and again after a queue runs out.
      ({ villages = {} } = await read(['villages']));
      const fresh = villages[id];
      for (const gid of TROOP_BUILDINGS) {
        if (!fresh || !(fresh.buildings || []).some((b) => b.gid === gid && b.level > 0)) continue;
        const q = (fresh.trainingQueue || {})[gid];
        const done = q && q.items.length && q.items.every((i) => i.finishAt && i.finishAt < Date.now());
        if (q && !done) continue;
        await sleep(rand(1200, 3000));
        const page = await navigate(tabId, `${s.server}/build.php?newdid=${encodeURIComponent(id)}&gid=${gid}`);
        if (!(page.buildPage && page.buildPage.trainingQueue)) {
          // Couldn't read a queue here; don't look again every refresh.
          await update(['villages'], (d) => {
            const vv = d.villages && d.villages[id];
            if (vv) vv.trainingQueue = { ...(vv.trainingQueue || {}), [gid]: { at: Date.now(), items: [], unknown: true } };
          });
        }
      }
      await sleep(rand(1500, 4000));
    }
    if (!job.villageIds && !urgent) await patchSchedule({ refreshAt: Date.now() + jittered(s.refreshMinutes * 60000, s.jitterPercent) });
  },

  async build(tabId, job, s) {
    const vid = job.villageId;
    let { villages = {}, tasks = {} } = await read(['villages', 'tasks']);
    let v = villages[vid];
    if (!v) return;
    let task = job.auto ? null : (tasks[vid] || [])[0];
    let why = null;
    if (job.auto) {
      // Autopilot: nothing queued by the player, so pick an upgrade now.
      if (!v.fields || !v.fieldsAt) await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
      if (!v.buildings || !v.buildingsAt) await navigate(tabId, `${s.server}/dorf2.php?newdid=${encodeURIComponent(vid)}`);
      const fresh = await read(['villages', 'account', 'expansion']);
      villages = fresh.villages || {};
      v = villages[vid];
      const plan = s.expansion.enabled ? expansionPlan({ ...fresh, settings: s }, Date.now()) : null;
      const pick = pickAutoUpgrade(v, s, Date.now(), tribeBase(villages), plan);
      if (!pick) {
        await patchVillage(vid, { autoIdleUntil: Date.now() + AUTO_IDLE_MS });
        await log('info', t('log.autoNothing', { n: s.autopilot.fieldsMax }), vid);
        return;
      }
      if (pick.saving) {
        // Resources wait for a celebration; look again in a while.
        const quiet = (v.savingLoggedAt || 0) > Date.now() - 3 * 3600000;
        await patchVillage(vid, { autoIdleUntil: Date.now() + 20 * 60000, ...(quiet ? {} : { savingLoggedAt: Date.now() }) });
        if (!quiet) await log('info', t('log.savingCelebration', { kind: t(`culture.kind.${pick.kind}`) }), vid);
        return;
      }
      why = pick.why;
      task = { kind: 'upgrade', slot: pick.slot, targetLevel: pick.level + 1, auto: true, gid: pick.construct ? pick.gid : undefined };
    }
    if (!task) return;
    // Player tasks leave the queue when done; autopilot picks were never in it.
    const finish = async () => { if (!task.auto) await removeTask(vid, task.id); };
    // A new building that can't go up is skipped by kind, not only by
    // site, so the next pick doesn't try it on the next free site.
    const skipSlot = async (ms) => {
      const now = Date.now();
      const live = v.autoSkip && v.autoSkip.until > now ? v.autoSkip : {};
      const gids = [...(live.gids || []), ...(task.gid ? [Number(task.gid)] : [])];
      await patchVillage(vid, { autoSkip: { slots: task.gid ? live.slots || [] : [...(live.slots || []), task.slot], gids, until: now + ms } });
    };

    let slot = task.slot;
    if (task.kind === 'fields') {
      if (!v.fields || !v.fieldsAt) {
        await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
        ({ villages = {} } = await read(['villages']));
        v = villages[vid];
      }
      const field = pickField(v, task);
      if (!field) {
        await removeTask(vid, task.id);
        await log('success', t('log.done', { task: taskLabel(task, v) }), vid);
        return;
      }
      slot = field.slot;
    }

    // A new building on an empty site: open the site on the right tab.
    const site = (v.buildings || []).find((b) => b.slot === slot);
    const empty = task.gid && (!site || !site.gid);
    const page = await navigate(tabId, `${s.server}/build.php?newdid=${encodeURIComponent(vid)}&id=${slot}${empty ? `&category=${buildCategory(task.gid)}` : ''}`);
    const bp = page.buildPage;
    if (!bp) throw new Error(t('err.noBuildPage'));
    let title = bp.title || t('task.slot', { n: slot });
    const now = Date.now();
    let contract = null;
    if (bp.newBuildings) {
      // Still empty: construct. Waiting and blocked cases go through the
      // same paths as an upgrade below.
      title = buildingName(task.gid) || title;
      contract = task.gid ? bp.newBuildings.find((b) => b.gid === Number(task.gid)) : null;
      if (!contract) {
        if (task.auto) await skipSlot(AUTO_SKIP_MS);
        await finish();
        await log('error', t('log.cannotConstructHere', { name: task.gid ? buildingName(task.gid) : title, slot }), vid);
        return;
      }
      bp.canUpgrade = contract.canBuild;
      bp.secondsUntilResources = contract.secondsUntilResources;
      bp.cost = contract.cost;
      bp.maxLevel = false;
      bp.nextLevel = 1;
      if (contract.missing.length) bp.blockedReason = t('reason.needs', { list: contract.missing.join(t('list.sep')) });
    }

    // Autopilot picks just want one more level, whatever the page says now.
    if (!task.auto && task.kind === 'upgrade' && ((bp.level != null && bp.level >= task.targetLevel) || (bp.nextLevel != null && bp.nextLevel > task.targetLevel))) {
      await finish();
      await log('success', t('log.done', { task: taskLabel(task, v) }), vid);
      return;
    }
    if (bp.maxLevel) {
      if (task.auto) await skipSlot(24 * 3600000);
      await finish();
      await log('info', t('log.maxLevel', { name: title }), vid);
      return;
    }
    if (!bp.canUpgrade) {
      if (bp.secondsUntilResources) {
        // Not enough resources: the game says when there will be. Retry
        // then, or sooner if a later snapshot shows the cost is covered.
        const waitMs = bp.secondsUntilResources * 1000 + 20000;
        await patchVillage(vid, { buildWait: { reason: 'resources', at: now, until: now + waitMs, cost: bp.cost, text: bp.blockedReason } });
        await log('info', t('log.waiting', { name: title, reason: bp.blockedReason || t('reason.cannotYet'), t: fmtDuration(waitMs) }), vid);
        return;
      }
      // No timer usually means the builders are busy and our queue info was
      // stale. Re-read the village's build queue before deciding.
      await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
      ({ villages = {} } = await read(['villages']));
      const fresh = villages[vid];
      const busy = fresh && buildBlock({ ...fresh, buildWait: null }, s, Date.now());
      if (busy && busy.reason === 'queue') {
        await patchVillage(vid, { buildWait: null });
        await log('info', busy.until ? t('log.busy', { t: fmtDuration(busy.until - Date.now()) }) : t('log.busyUnknown'), vid);
        return;
      }
      // Something else blocks it (storage too small, missing requirement…).
      if (task.auto) {
        await skipSlot(AUTO_SKIP_MS);
        await patchVillage(vid, { buildWait: null });
        await log('info', t('log.autoBlocked', { name: title, reason: bp.blockedReason || t('reason.cannotYet') }), vid);
        return;
      }
      const attempts = (task.attempts || 0) + 1;
      if (attempts >= MAX_BUILD_ATTEMPTS) {
        await removeTask(vid, task.id);
        await patchVillage(vid, { buildWait: null });
        await log('error', t('log.gaveUp', { task: taskLabel(task, v), reason: bp.blockedReason || t('reason.noUpgradeSlot') }), vid);
        return;
      }
      await update(['tasks'], (d) => {
        const saved = ((d.tasks || {})[vid] || []).find((x) => x.id === task.id);
        if (saved) saved.attempts = attempts;
      });
      const waitMs = 10 * 60000;
      await patchVillage(vid, { buildWait: { reason: 'blocked', at: Date.now(), until: Date.now() + waitMs, text: bp.blockedReason } });
      await log('info', t('log.waiting', { name: title, reason: bp.blockedReason || t('reason.cannotYet'), t: fmtDuration(waitMs) }), vid);
      return;
    }

    const { res, page: after } = await act(tabId, contract ? { kind: 'construct', gid: contract.gid } : { kind: 'upgrade' }, true);
    if (!res.ok || !after || after.type === 'build') {
      await patchVillage(vid, { buildWait: { reason: 'blocked', at: Date.now(), until: Date.now() + 5 * 60000, text: t('reason.stillOnBuild') } });
      await log('error', t('log.clickFailed', { name: title, reason: res.ok ? t('reason.stillOnBuild') : reasonText(res) }), vid);
      return;
    }
    // Title reads "<name> Level N" in the server's language; drop the level part.
    const name = (bp.title || '').replace(/\s*\S*\s*\d+\s*$/, '') || title;
    if (contract) await log('success', t(task.auto ? 'log.autoConstructing' : 'log.constructing', { name: buildingName(contract.gid), slot }), vid);
    else if (task.auto) await log('success', t('log.autoUpgrading', { name, n: bp.nextLevel ?? '?', why: t(`auto.why.${why}`) }), vid);
    else await log('success', t('log.upgrading', { name, n: bp.nextLevel ?? '?' }), vid);
    await bump('upgrades');
    await patchVillage(vid, { buildWait: null });
    if (task.auto) return;
    await update(['tasks'], (d) => {
      const saved = ((d.tasks || {})[vid] || []).find((x) => x.id === task.id);
      if (saved) saved.attempts = 0;
    });
    if (task.kind === 'upgrade' && bp.nextLevel != null && bp.nextLevel >= task.targetLevel) {
      await removeTask(vid, task.id);
      await log('success', t('log.finalQueued', { task: taskLabel(task, v) }), vid);
    }
  },

  async train(tabId, job, s) {
    const rule = job.rule;
    const { villages = {} } = await read(['villages']);
    const vname = villages[rule.villageId] ? villages[rule.villageId].name : rule.villageId;
    const bname = buildingName(rule.gid);
    const page = await navigate(tabId, `${s.server}/build.php?newdid=${encodeURIComponent(rule.villageId)}&gid=${rule.gid}`);
    const unit = page.buildPage && page.buildPage.trainable.find((u) => u.field === rule.troop);
    let next = jittered(rule.everyMinutes * 60000, s.jitterPercent);
    if (!unit) {
      await log('error', t('log.trainNotThere', { b: bname, v: vname, u: rule.troop }), rule.villageId);
    } else {
      const amount = Math.min(rule.amount, unit.max);
      if (amount < 1) {
        next = Math.min(next, 15 * 60000);
        await log('info', t('log.trainNoRes', { b: bname, v: vname, u: unit.name || rule.troop, t: fmtDuration(next) }), rule.villageId);
      } else {
        const { res } = await act(tabId, { kind: 'train', field: rule.troop, amount }, true);
        if (res.ok) { await log('success', t('log.training', { n: amount, u: unit.name || rule.troop, v: vname }), rule.villageId); await bump('trained', amount); }
        else await log('error', t('log.trainFailed', { v: vname, reason: reasonText(res) }), rule.villageId);
      }
    }
    await update(['training'], (d) => {
      const r = (d.training || []).find((x) => x.id === rule.id);
      if (r) r.nextAt = Date.now() + next;
    });
  },

  // New-village plan: settlers in the village's Residence (or Palace). The
  // game offers them only while the building has a free slot.
  async settlers(tabId, job, s) {
    const { villages = {} } = await read(['villages']);
    const v = villages[job.villageId];
    if (!v) return;
    const mark = (patch) => update(['expansion'], (d) => {
      d.expansion = d.expansion || {};
      d.expansion[v.id] = { ...(d.expansion[v.id] || {}), ...patch };
    });
    await mark({ trainAt: Date.now() });
    const home = settlerHome(v);
    if (!home) return;
    const page = await navigate(tabId, `${s.server}/build.php?newdid=${encodeURIComponent(v.id)}&gid=${home.gid}`);
    const unit = page.buildPage && page.buildPage.trainable.find((u) => u.field === 't10');
    if (!unit) {
      await mark({ noSlotAt: Date.now() });
      await log('info', t('log.settlersNoSlot', { b: buildingName(home.gid) }), v.id);
      return;
    }
    const amount = Math.min(job.need, unit.max);
    if (amount < 1) { await log('info', t('log.settlersNoRes'), v.id); return; }
    const { res } = await act(tabId, { kind: 'train', field: 't10', amount }, true);
    if (!res.ok) throw new Error(reasonText(res));
    await log('success', t('log.settlersTraining', { n: amount, b: buildingName(home.gid) }), v.id);
    await bump('trained', amount);
  },

  // Oases around a village, from the game's map. Results go into `oases`.
  async scan(tabId, job, s) {
    const vid = job.villageId;
    const { villages = {} } = await read(['villages']);
    const v = villages[vid];
    await update(['schedule'], (d) => {
      if (!d.schedule) return;
      if (d.schedule.scanVillage === vid) d.schedule.scanVillage = null;
      // Even when this look fails, the next finder scan waits its turn.
      if (d.schedule.finderVillage === vid) d.schedule.finderScanAt = Date.now() + jittered(12 * 3600000, 15);
    });
    if (!v || v.x == null) return;
    await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
    let { res } = await act(tabId, { kind: 'scanMap', x: v.x, y: v.y }, false);
    // Refused or empty: open the map page itself and read what the game
    // loads there (zoomed out, centred on the village).
    if (!res.ok || !res.tiles) {
      const first = res;
      try {
        await navigate(tabId, `${s.server}/karte.php?zoom=3&x=${v.x}&y=${v.y}`);
        ({ res } = await act(tabId, { kind: 'mapTiles' }, false));
      } catch (e) {
        if (e.loggedOut) throw e;
        res = { ok: false, code: 'mapApi' };
      }
      if (!res.ok) res = first.ok ? res : first;
    }
    await update(['raids'], (d) => {
      for (const r of d.raids || []) if (r.villageId === vid) r.scannedAt = Date.now();
    });
    if (!res.ok) {
      await log('error', t('log.scanFailed', { reason: res.status ? `HTTP ${res.status}` : reasonText(res) }), vid);
      return;
    }
    const now = Date.now();
    await update(['oases'], (d) => {
      d.oases = d.oases || {};
      for (const o of res.oases) {
        const key = oasisKey(o.x, o.y);
        const prev = d.oases[key] || {};
        // A recent look at the tile itself beats the map's summary.
        const fresh = prev.checkedAt && now - prev.checkedAt < 3600000;
        d.oases[key] = { ...prev, x: o.x, y: o.y, fromScan: true, scannedAt: now, ...(fresh ? {} : { owned: o.owned, animals: o.animals }) };
      }
    });
    await log('info', t('log.scanned', { n: res.oases.length }), vid);
    // Free valleys, for the new-village plan.
    if (res.valleys) {
      await update(['valleys'], (d) => {
        const out = {};
        // Keep what's still recent elsewhere on the map; this area is redrawn.
        for (const [k, x] of Object.entries(d.valleys || {})) if (now - (x.scannedAt || 0) < 3 * 86400000 && distance(x, v) > 15) out[k] = x;
        for (const x of res.valleys) out[oasisKey(x.x, x.y)] = { ...x, scannedAt: now };
        d.valleys = out;
      });
    }
    // Player villages and their population, for the inactive finder.
    if (res.villages && res.villages.length) {
      await update(['mapVillages', 'villages'], (d) => {
        d.mapVillages = recordMapVillages(d.mapVillages, res.villages, now, Object.values(d.villages || {}));
      });
      await log('info', t('log.scannedVillages', { n: res.villages.length }), vid);
    }
  },

  // Raid empty oases near a village. Every target is checked right before
  // sending: unoccupied, no animals, and the confirmation names it.
  async raid(tabId, job, s) {
    const rule = job.rule;
    const vid = rule.villageId;
    let next = jittered(rule.everyMinutes * 60000, s.jitterPercent);
    try {
      await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
      let { villages = {}, oases = {}, raids = [] } = await read(['villages', 'oases', 'raids']);
      const v = villages[vid];
      if (!v) return;
      const unit = rule.unitName || t('troops.unitN', { n: rule.field.slice(1) });
      if (v.underAttack) {
        next = Math.min(next, 15 * 60000);
        await log('info', t('log.raidSkipAttack'), vid);
        return;
      }
      let home = troopsHome(v)[rule.field] || 0;
      if (home < rule.amount) {
        next = Math.min(next, 15 * 60000);
        await log('info', t('log.raidNoTroops', { u: unit, have: home, need: rule.amount }), vid);
        return;
      }
      const current = raids.find((r) => r.id === rule.id) || rule;
      if (!current.scannedAt || Date.now() - current.scannedAt > SCAN_EVERY_MS) {
        await JOBS.scan(tabId, { villageId: vid }, s);
        ({ oases = {} } = await read(['oases']));
      }
      const targets = raidTargets(v, current, oases, Date.now());
      if (!targets.length) {
        await log('info', t('log.raidNoTargets', { r: rule.radius }), vid);
        return;
      }
      let sent = 0;
      for (const o of targets) {
        if (urgent || sent >= rule.maxPerRun || home < rule.amount) break;
        const xy = coords(o.x, o.y);
        await sleep(rand(1200, 2800));
        const chk = await checkOasis(tabId, s, o.x, o.y, !!o.fromScan);
        if (!chk.ok) { await log(chk.level, chk.msg, vid); continue; }
        await sleep(rand(1000, 2500));
        const r = await sendTroops(tabId, s, vid, { x: o.x, y: o.y, troops: { [rule.field]: rule.amount }, mission: 'raid' });
        if (r.available && r.available[rule.field] != null) home = r.available[rule.field];
        if (r.short) { await log('info', t('log.raidNoTroops', { u: unit, have: home, need: rule.amount }), vid); break; }
        if (!r.ok) { await log('error', t('log.raidFailed', { xy, reason: r.reason }), vid); if (r.fatal) break; continue; }
        sent += 1;
        home -= rule.amount;
        await update(['oases'], (d) => {
          d.oases = d.oases || {};
          d.oases[o.key] = { ...(d.oases[o.key] || { x: o.x, y: o.y }), raidedAt: Date.now() };
        });
        await log('success', t('log.raidSent', { n: rule.amount, u: unit, xy, d: o.distance.toFixed(1) }), vid);
        await bump('raids');
      }
      if (sent) {
        // Pick up the troops that left and their movements.
        await sleep(rand(1500, 3000));
        await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
      }
    } finally {
      await update(['raids'], (d) => {
        const r = (d.raids || []).find((x) => x.id === rule.id);
        if (r) r.nextAt = Date.now() + next;
      });
    }
  },

  // A farm list kept in the extension: send each target its troops, the
  // targets waiting longest first, as long as troops last.
  async farmList(tabId, job, s) {
    const listId = job.listId;
    let next = null;
    const patchTarget = (targetId, patch) => update(['farms'], (d) => {
      const l = (d.farms || []).find((x) => x.id === listId);
      const tg = l && (l.targets || []).find((x) => x.id === targetId);
      if (tg) Object.assign(tg, patch);
    });
    // A "Send now" for this list is used up by this round; pressing it again
    // while the round runs queues another one.
    await update(['schedule'], (d) => {
      if (d.schedule && Array.isArray(d.schedule.farmNow)) d.schedule.farmNow = d.schedule.farmNow.filter((id) => id !== listId);
    });
    try {
      const { farms = [] } = await read(['farms']);
      const list = farms.find((l) => l.id === listId);
      if (!list) return;
      next = jittered(list.everyMinutes * 60000, s.jitterPercent);
      const vid = list.villageId;
      await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
      const { villages = {} } = await read(['villages']);
      const v = villages[vid];
      if (!v) return;
      if (v.underAttack && list.skipWhenAttacked !== false) {
        next = Math.min(next, 15 * 60000);
        await log('info', t('log.farmSkipAttack', { list: list.name }), vid);
        return;
      }
      const mission = list.eventType === 3 ? 'attack' : 'raid';
      let home = troopsHome(v);
      const due = farmTargets(list);
      let sent = 0, short = 0, failed = 0;
      for (const tg of due) {
        if (urgent || sent >= (list.maxPerRound || 50)) break;
        const troops = cleanTroops(tg.troops);
        if (!coversTroops(home, troops)) { short += 1; continue; }
        const xy = coords(tg.x, tg.y);
        await sleep(rand(800, 2000));
        if (tg.type === 'oasis') {
          const chk = await checkOasis(tabId, s, tg.x, tg.y, true);
          if (!chk.ok) {
            await log(chk.level, chk.msg, vid);
            await patchTarget(tg.id, { lastResult: chk.msg, lastTriedAt: Date.now() });
            continue;
          }
          await sleep(rand(800, 1800));
        }
        const r = await sendTroops(tabId, s, vid, { x: tg.x, y: tg.y, troops, mission });
        if (r.available) home = { ...home, ...Object.fromEntries(Object.entries(r.available).filter(([, n]) => n != null)) };
        if (r.ok) {
          for (const [f, n] of Object.entries(troops)) home[f] = (home[f] || 0) - n;
          sent += 1;
          await patchTarget(tg.id, { lastSentAt: Date.now(), lastTriedAt: Date.now(), lastResult: 'ok', fails: 0, sent: (tg.sent || 0) + 1 });
          continue;
        }
        if (r.short) { short += 1; continue; }
        failed += 1;
        // Three failures in a row (protection, village gone…): switch it off.
        const fails = (tg.fails || 0) + 1;
        const off = fails >= 3;
        await patchTarget(tg.id, { lastResult: r.reason, lastTriedAt: Date.now(), fails, ...(off ? { enabled: false } : {}) });
        await log('error', t(off ? 'log.farmTargetOff' : 'log.farmTargetFailed', { xy, reason: r.reason, list: list.name }), vid);
        if (r.fatal) break;
      }
      await log(sent ? 'success' : 'info', t('log.farmRound', { list: list.name, sent, total: due.length, short, failed }), vid);
      await bump('farm', sent);
      // Reports exist once the raids land: read them a little later.
      if (sent && s.reports.enabled) {
        await update(['schedule'], (d) => { const sc = d.schedule = d.schedule || {}; if (!sc.reportsDue) sc.reportsDue = Date.now() + 15 * 60000; });
      }
      if (sent) {
        await sleep(rand(1500, 3000));
        await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
      }
    } finally {
      await update(['farms'], (d) => {
        const l = (d.farms || []).find((x) => x.id === listId);
        if (l && next != null) l.nextAt = Date.now() + next;
      });
    }
  },

  async farm(tabId, job, s) {
    const prefix = s.farm.villageId ? `newdid=${encodeURIComponent(s.farm.villageId)}&` : '';
    await navigate(tabId, `${s.server}/build.php?${prefix}gid=16&tt=99`);
    const { res } = await act(tabId, { kind: 'farm', ids: s.farm.listIds || [] }, false);
    if (res.ok) await log('success', t('log.farmSent', { what: res.started === 'all' ? t('log.farmAll') : t('log.farmCount', { n: res.started }) }));
    else await log('info', t('log.farmInfo', { reason: reasonText(res) }));
    await patchSchedule({ farmAt: Date.now() + jittered(s.farm.intervalMinutes * 60000, s.jitterPercent) });
  },

  // Celebration in the Town Hall (experimental: the page hasn't been
  // checked against a saved copy). Verified by the stock dropping or the
  // page showing a running celebration.
  async celebrate(tabId, job, s) {
    const vid = job.villageId;
    const th = `${s.server}/build.php?newdid=${encodeURIComponent(vid)}&gid=24`;
    let page = await navigate(tabId, th);
    let { villages = {} } = await read(['villages']);
    let v = villages[vid];
    if (!v) return;
    await patchVillage(vid, { celebrationCheckAt: Date.now() + 10 * 60000 });
    const cel = page.buildPage && page.buildPage.celebration;
    if (cel && cel.running) return; // stored by processPage
    const c = CELEBRATIONS[job.kind];
    if (!canAfford(v, c.cost, Date.now())) return;
    const before = Object.values((v.resources || {}).stock || {}).reduce((n, x) => n + (x || 0), 0);
    const { res } = await act(tabId, { kind: 'celebrate', great: job.kind === 'great' }, false);
    const fail = async (reason) => {
      await patchVillage(vid, { celebrationFailAt: Date.now() });
      await log('error', t('log.celebrateFailed', { reason }), vid);
    };
    if (!res.ok) { await fail(reasonText(res)); return; }
    await sleep(rand(1500, 2500));
    page = await navigate(tabId, th);
    ({ villages = {} } = await read(['villages']));
    v = villages[vid];
    const after = Object.values((v.resources || {}).stock || {}).reduce((n, x) => n + (x || 0), 0);
    const cost = Object.values(c.cost).reduce((n, x) => n + x, 0);
    const running = page.buildPage && page.buildPage.celebration && page.buildPage.celebration.running;
    if (!running && before - after < cost * 0.7) { await fail(t('reason.celebrateNotConfirmed')); return; }
    if (!running) await patchVillage(vid, { celebrationUntil: Date.now() + 12 * 3600000 }); // length unknown: look again later
    await patchVillage(vid, { autoIdleUntil: 0 }); // the savings are spent: building can go on
    await log('success', t('log.celebrating', { kind: t(`culture.kind.${job.kind}`), cp: c.cp }), vid);
    await bump('celebrations');
  },

  // Raid reports (experimental): how each farm went; farms where the raid
  // was lost, or troops died twice running, are paused.
  async reports(tabId, job, s) {
    await patchSchedule({ reportsDue: null });
    let page = await navigate(tabId, `${s.server}/report/offensive`);
    if (!page || page.type !== 'reports' || !(page.reports || []).length) page = await navigate(tabId, `${s.server}/report?t=1`);
    const list = (page && page.reports) || [];
    if (!list.length || !list.some((r) => r.result)) {
      const { alertMemo = {} } = await read(['alertMemo']);
      if (Date.now() - (alertMemo.reportsUnknown || 0) > 24 * 3600000) {
        await update(['alertMemo'], (d) => { d.alertMemo = { ...(d.alertMemo || {}), reportsUnknown: Date.now() }; });
        await log('error', t('log.reportsUnknown'));
      }
      return;
    }
    let changes = [];
    await update(['farms', 'villages', 'reportsSeen'], (d) => {
      const r = applyReports(d.farms, d.villages || {}, list, d.reportsSeen || []);
      d.farms = r.farms; d.reportsSeen = r.seen; changes = r.changes;
    });
    for (const c of changes.filter((x) => x.paused)) {
      await log('alert', t('log.farmPausedReport', { name: c.target, xy: coords(c.x, c.y), list: c.list, why: t(`report.${c.result}`) }));
    }
    if (changes.length) await log('info', t('log.reportsRead', { n: changes.length, full: changes.filter((c) => c.carry === 'full').length }));
  },

  // Task rewards: collected in the village with the most free storage (the
  // resources land in the active village).
  async quest(tabId, job, s) {
    const { villages = {} } = await read(['villages']);
    const now = Date.now();
    const fill = (v) => {
      const est = estimateStock(v, now);
      return est ? Math.max(...RESOURCES.map((k) => est[k] / (capacityFor(v.resources, k) || 1))) : 1;
    };
    const target = sortedVillages(villages).sort((a, b) => fill(a) - fill(b))[0];
    if (!target || fill(target) > 0.85) {
      await patchSchedule({ questAt: now + 3600000 });
      await log('info', t('log.questsNoRoom'));
      return;
    }
    await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(target.id)}`);
    const page = await navigate(tabId, `${s.server}/tasks`);
    if (!page || page.type !== 'tasks') throw new Error(t('err.noTasksPage'));
    const { res } = await act(tabId, { kind: 'collectQuests' }, false);
    await patchSchedule({ questAt: Date.now() + 2 * 3600000 });
    if (!res.ok) throw new Error(reasonText(res));
    await update(['account'], (d) => { d.account = { ...(d.account || {}), questClaimable: false }; });
    if (res.collected) {
      await log('success', t('log.questsCollected', { n: res.collected, v: target.name }), target.id);
      await bump('quests', res.collected);
    }
  },

  // An upgrade waits for resources the hero carries: move just the missing
  // amount from the hero's bag into that village.
  async heroBag(tabId, job, s) {
    const vid = job.villageId;
    let { villages = {} } = await read(['villages']);
    const wait = villages[vid] && villages[vid].buildWait;
    if (!wait || !wait.cost) return;
    // Opening the village makes it the active one (the bag empties into it)
    // and refreshes its stock.
    await navigate(tabId, `${s.server}/dorf1.php?newdid=${encodeURIComponent(vid)}`);
    ({ villages = {} } = await read(['villages']));
    const v = villages[vid];
    const need = bagShortfall(v, wait.cost, Date.now());
    if (!need) { await patchVillage(vid, { buildWait: null }); return; }
    const page = await navigate(tabId, `${s.server}/hero/inventory`);
    if (!page || page.type !== 'inventory' || !page.inventory || !page.inventory.loaded) throw new Error(t('err.noInventory'));
    const items = page.inventory.items || {};
    const have = { wood: items['145'] || 0, clay: items['146'] || 0, iron: items['147'] || 0, crop: items['148'] || 0 };
    if (RESOURCES.some((k) => need[k] > have[k])) {
      await patchVillage(vid, { heroBagAt: Date.now() + 3 * 3600000 });
      await log('info', t('log.heroBagShort'), vid);
      return;
    }
    const { res } = await act(tabId, { kind: 'heroTransfer', amounts: need }, false);
    if (!res.ok) {
      await patchVillage(vid, { heroBagAt: Date.now() + 6 * 3600000 });
      throw new Error(reasonText(res));
    }
    await patchVillage(vid, { buildWait: null, heroBagAt: Date.now() + 30 * 60000 });
    const list = RESOURCES.filter((k) => need[k]).map((k) => `${fmtNum(need[k])} ${resLabel(k)}`).join(t('list.sep'));
    await log('success', t('log.heroBagUsed', { list }), vid);
    await bump('heroBag');
  },

  async adventure(tabId, job, s) {
    await navigate(tabId, `${s.server}/hero/adventures`);
    const { res } = await act(tabId, { kind: 'adventure' }, false);
    if (res.ok) await log('success', t('log.heroSent', { to: res.detail ? t('log.heroTo', { where: ltr(res.detail) }) : '' }));
    else await log('info', t('log.adventureInfo', { reason: reasonText(res) }));
    await patchSchedule({ adventureAt: Date.now() + jittered(15 * 60000, s.jitterPercent) });
    // Pick up the hero's new status for the dashboard.
    await sleep(rand(1500, 3000));
    await navigate(tabId, `${s.server}/dorf1.php`);
  },
};

const automationOn = (s) => s.botEnabled || s.autopilot.enabled;

// New-village plan bookkeeping, every tick: an alert when a village's
// settlers are ready (with where to found), and noticing the founding.
async function expansionWatch(s, data, now) {
  if (!s.expansion.enabled) return;
  const plan = expansionPlan({ ...data, settings: s }, now);
  const count = Object.keys(data.villages || {}).length;
  const changes = {};
  const news = [];
  for (const r of plan.rows) {
    if (foundedNow(r.st, r.v, count, now)) {
      changes[r.id] = { founded: true, foundedAt: now };
      news.push(['founded', r]);
    } else if (r.step === 'ready' && !r.st.readyCount) {
      changes[r.id] = { readyCount: count, readyAt: now };
      news.push(['ready', r]);
    } else if (r.st.readyCount && r.step !== 'ready' && r.step !== 'sent') {
      changes[r.id] = { readyCount: null, readyAt: null }; // settlers lost or never sent: start over
    }
  }
  if (!Object.keys(changes).length) return;
  await update(['expansion'], (d) => {
    d.expansion = d.expansion || {};
    for (const [id, patch] of Object.entries(changes)) d.expansion[id] = { ...(d.expansion[id] || {}), ...patch };
  });
  for (const [kind, r] of news) {
    if (kind === 'founded') {
      await log('success', t('log.expansionFounded', { v: r.v.name }), r.id);
      continue;
    }
    const where = r.target ? `${coords(r.target.x, r.target.y)}` : t('exp.noTarget');
    await log('success', t('log.settlersReady', { n: SETTLERS, v: r.v.name, where }), r.id);
    await sendAlert({ villageId: r.id, title: t('alert.settlersReady.title', { v: r.v.name }), body: t('alert.settlersReady.body', { n: SETTLERS, where }) });
  }
}

function planRefresh(s, data, now, force) {
  const { villages = {}, schedule = {} } = data;
  if (!(s.watchEnabled || automationOn(s) || force)) return [];
  if (force || now >= (schedule.refreshAt || 0)) return [{ type: 'refresh', label: t('job.refresh') }];
  const ids = Object.values(villages).filter((v) => v.needsRefresh).map((v) => v.id);
  return ids.length ? [{ type: 'refresh', villageIds: ids, label: t('job.refreshAttacked') }] : [];
}

// Planned after any refresh, so decisions use what the game shows right now.
function planActions(s, data, now) {
  const { villages = {}, tasks = {}, training = [], raids = [], farms = [], schedule = {}, account = {} } = data;
  const jobs = [];
  // Asked for from the dashboard: runs even with automation off.
  if (schedule.scanVillage && villages[schedule.scanVillage]) {
    jobs.push({ type: 'scan', villageId: schedule.scanVillage, label: t('job.scan', { v: villages[schedule.scanVillage].name }) });
  }
  const farmNow = new Set(schedule.farmNow || []);
  for (const list of farms) {
    if (farmNow.has(list.id) && villages[list.villageId]) jobs.push({ type: 'farmList', listId: list.id, label: t('job.farmList', { list: list.name }) });
  }
  if (!automationOn(s) || !withinActiveHours(s.activeHours, new Date(now))) return jobs;
  const ap = s.autopilot;
  const auto = ap.enabled;
  if (schedule.finderVillage && villages[schedule.finderVillage] && schedule.scanVillage !== schedule.finderVillage && now >= (schedule.finderScanAt || 0)) {
    jobs.push({ type: 'scan', villageId: schedule.finderVillage, label: t('job.scan', { v: villages[schedule.finderVillage].name }) });
  }

  for (const v of sortedVillages(villages)) {
    if (buildBlock(v, s, now)) continue;
    if ((tasks[v.id] || []).length) jobs.push({ type: 'build', villageId: v.id, label: t('job.build', { v: v.name }) });
    else if (auto && ap.build && !((v.autoIdleUntil || 0) > now)) jobs.push({ type: 'build', villageId: v.id, auto: true, label: t('job.autoBuild', { v: v.name }) });
  }
  for (const rule of training) {
    if (rule.enabled !== false && villages[rule.villageId] && now >= (rule.nextAt || 0)) {
      jobs.push({ type: 'train', rule, label: t('job.train', { v: villages[rule.villageId].name }) });
    }
  }
  for (const rule of raids) {
    if (rule.enabled !== false && villages[rule.villageId] && now >= (rule.nextAt || 0)) {
      jobs.push({ type: 'raid', rule, label: t('job.raid', { v: villages[rule.villageId].name }) });
    }
  }
  for (const list of farms) {
    if (farmNow.has(list.id) || list.enabled === false || !villages[list.villageId] || now < (list.nextAt || 0)) continue;
    if (!farmTargets(list).length) continue;
    jobs.push({ type: 'farmList', listId: list.id, label: t('job.farmList', { list: list.name }) });
  }
  if ((s.farm.enabled || (auto && ap.farmLists)) && now >= (schedule.farmAt || 0)) jobs.push({ type: 'farm', label: t('job.farm') });
  if (s.reports.enabled && schedule.reportsDue && now >= schedule.reportsDue) jobs.push({ type: 'reports', label: t('job.reports') });
  // Celebrations in every village with a Town Hall, once affordable.
  for (const v of sortedVillages(villages)) {
    if ((v.celebrationFailAt || 0) > now - 12 * 3600000 || (v.celebrationCheckAt || 0) > now) continue;
    const c = savingFor(v, s.culture.celebrate, now);
    if (c && !c.tooSmall && canAfford(v, c.cost, now)) jobs.push({ type: 'celebrate', villageId: v.id, kind: c.kind, label: t('job.celebrate', { v: v.name }) });
  }
  // New-village plan: settlers where a Residence 10 and a slot are ready.
  if (s.expansion.enabled) {
    for (const r of expansionPlan({ ...data, settings: s }, now).rows) {
      if (r.step === 'train' && r.need > 0 && !((r.st.trainAt || 0) > now - 30 * 60000)) jobs.push({ type: 'settlers', villageId: r.id, need: r.need, label: t('job.settlers', { v: r.v.name }) });
    }
  }
  if (auto && ap.quests && account.questClaimable && now >= (schedule.questAt || 0)) jobs.push({ type: 'quest', label: t('job.quest') });
  // A build waiting for resources the hero carries in the bag.
  if (auto && ap.heroBag) {
    const bag = account.heroBag;
    for (const v of Object.values(villages)) {
      const w = v.buildWait;
      if (!w || w.reason !== 'resources' || !w.cost || !(w.until > now) || (v.heroBagAt || 0) > now) continue;
      const need = bagShortfall(v, w.cost, now);
      if (!need || (bag && now - bag.at < 6 * 3600000 && RESOURCES.some((k) => need[k] > (bag[k] || 0)))) continue;
      jobs.push({ type: 'heroBag', villageId: v.id, label: t('job.heroBag', { v: v.name }) });
    }
  }
  const hero = account.hero || {};
  if ((s.adventure.enabled || (auto && ap.adventures)) && hero.adventures > 0 && hero.home && now >= (schedule.adventureAt || 0)) {
    jobs.push({ type: 'adventure', label: t('job.adventure') });
  }
  return jobs;
}

// Resource protection: train as many of the plan's unit as storage pays
// for, once per attack, when the stock is worth protecting.
async function spendBeforeAttack(tabId, s, plan, vid, attackAt) {
  const { villages = {} } = await read(['villages']);
  const v = villages[vid];
  if (!v || (v.escape && sameAttack(v.escape.spentFor, attackAt))) return;
  const est = estimateStock(v, Date.now());
  const cap = v.resources ? RESOURCES.reduce((n, k) => n + (capacityFor(v.resources, k) || 0), 0) : 0;
  if (!est || !cap || RESOURCES.reduce((n, k) => n + est[k], 0) < cap * 0.2) return;
  const page = await navigate(tabId, `${s.server}/build.php?newdid=${encodeURIComponent(vid)}&gid=${plan.spend.gid}`);
  const unit = page.buildPage && page.buildPage.trainable.find((u) => u.field === plan.spend.field);
  await update(['villages'], (d) => { const x = d.villages && d.villages[vid]; if (x) x.escape = { ...(x.escape || {}), spentFor: attackAt }; });
  if (!unit || !(unit.max > 0)) { await log('info', t('log.spendNothing'), vid); return; }
  const { res, page: after } = await act(tabId, { kind: 'train', field: unit.field, amount: unit.max }, true);
  if (!res.ok || !after) throw new Error(res.ok ? t('reason.stillOnBuild') : reasonText(res));
  await log('success', t('log.spent', { n: unit.max, unit: unit.name || unit.field }), vid);
  await bump('trained', unit.max);
}

// Runs jobs in order; returns false when the run should stop (logged out,
// or the player started clicking around in the game).
async function runJobs(tabId, jobs, s, force) {
  for (const job of jobs) {
    if (urgent && job.type !== 'escape' && !job.quick) await runEscapeStage(tabId, s);
    await setStatus({ state: 'working', note: job.label });
    try {
      await JOBS[job.type](tabId, job, s);
      await noteJob(job.type, true);
    } catch (e) {
      if (e.loggedOut) return false; // processPage already alerted
      await noteJob(job.type, false, e.message);
      await log('error', `${job.label}: ${e.message}`);
      if (s.alerts.botErrors) {
        const { alertMemo = {} } = await read(['alertMemo']);
        const key = `err:${job.type}`;
        if (Date.now() - (alertMemo[key] || 0) > 3600000) {
          await update(['alertMemo'], (d) => { d.alertMemo = { ...(d.alertMemo || {}), [key]: Date.now() }; });
          await sendAlert({ kind: 'botErrors', title: t('alert.botError.title'), body: `${job.label}: ${e.message}` });
        }
      }
    }
    const { status: st = {} } = await read(['status']);
    if (st.loggedOut) return false;
    if (!force && s.pauseWhenPlaying && (st.userActiveUntil || 0) > Date.now()) return false;
    await sleep(rand(1200, 3500));
  }
  return true;
}

const DATA_KEYS = ['settings', 'villages', 'tasks', 'training', 'raids', 'farms', 'escapes', 'schedule', 'account', 'status', 'expansion', 'valleys', 'mapVillages'];
let running = false;
let rerunForced = false; // "Check now" pressed while a run was in progress
let rerunSoon = false;   // a dashboard request (e.g. map scan) arrived during a run
async function tick(force = false, soon = false) {
  if (running) {
    if (force) rerunForced = true;
    else if (soon) rerunSoon = true;
    return { busy: true };
  }
  running = true;
  try {
    const data = await read(DATA_KEYS);
    const s = mergeSettings(data.settings);
    setLanguage(s.language);
    const status = data.status || {};
    const now = Date.now();
    if (!s.server) {
      await setStatus({ state: 'idle', note: '' });
      return {};
    }
    if (status.loggedOut && !force) {
      await setStatus({ state: 'blocked', note: '' });
      return {};
    }
    const escapeWork = escapeRefreshIds(data, now).length > 0 || planEscapes(data, now).length > 0;
    // Only one browser drives the game. "Check now" here takes over.
    if (s.watchEnabled || automationOn(s) || force || escapeWork) {
      const lease = await mayRun(now);
      if (!lease.ok && !force) {
        await setStatus({ state: 'otherDevice', note: lease.lease.deviceName });
        return {};
      }
      await renewLease();
    }
    if (escapeWork || urgent) await runEscapeStage(await ensureWorkerTab(s.server), s);
    if (!force && s.pauseWhenPlaying && (status.userActiveUntil || 0) > now) {
      await setStatus({ state: 'paused', note: '' });
      return {};
    }
    await expansionWatch(s, data, now);
    const refreshJobs = planRefresh(s, data, now, force);
    if (!refreshJobs.length && !planActions(s, data, now).length) {
      await setStatus({ state: 'idle', note: '' });
      return {};
    }

    const tabId = await ensureWorkerTab(s.server);
    if (await runJobs(tabId, refreshJobs, s, force)) {
      const fresh = await read(DATA_KEYS);
      await runJobs(tabId, planActions(s, fresh, Date.now()), s, force);
    }
    await setStatus({ state: 'idle', note: '', lastRunAt: Date.now() });
    return {};
  } finally {
    running = false;
    await refreshBadge();
    await armEscapes();
    if (rerunForced) {
      rerunForced = false;
      rerunSoon = false;
      tick(true);
    } else if (rerunSoon) {
      rerunSoon = false;
      tick();
    }
  }
}

// ------------------------------------------------------ dashboard commands --
const COMMANDS = {
  async saveSettings({ settings }) {
    await update(['settings'], (d) => { d.settings = mergeSettings({ ...mergeSettings(d.settings), ...settings }); });
    await refreshBadge();
  },
  async addTask({ villageId, task }) {
    await update(['tasks'], (d) => {
      d.tasks = d.tasks || {};
      (d.tasks[villageId] = d.tasks[villageId] || []).push({ ...task, id: uid(), attempts: 0 });
    });
    await patchVillage(villageId, { buildWait: null });
  },
  async removeTask({ villageId, taskId }) { await removeTask(villageId, taskId); },
  async moveTask({ villageId, taskId, delta }) {
    await update(['tasks'], (d) => {
      const list = (d.tasks || {})[villageId] || [];
      const i = list.findIndex((x) => x.id === taskId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    });
    await patchVillage(villageId, { buildWait: null });
  },
  async addTraining({ rule }) {
    await update(['training'], (d) => { (d.training = d.training || []).push({ ...rule, id: uid(), nextAt: 0, enabled: true }); });
  },
  async updateTraining({ id, patch }) {
    await update(['training'], (d) => {
      const r = (d.training || []).find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
  },
  async removeTraining({ id }) {
    await update(['training'], (d) => { d.training = (d.training || []).filter((x) => x.id !== id); });
  },
  async addRaid({ rule }) {
    await update(['raids'], (d) => { (d.raids = d.raids || []).push({ targets: [], ...rule, id: uid(), nextAt: 0, enabled: true }); });
  },
  async updateRaid({ id, patch }) {
    await update(['raids'], (d) => {
      const r = (d.raids || []).find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
  },
  async removeRaid({ id }) {
    await update(['raids'], (d) => { d.raids = (d.raids || []).filter((x) => x.id !== id); });
  },
  // Oases typed in by the player; raided even outside the rule's radius.
  async addRaidTarget({ id, x, y }) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 400 || Math.abs(y) > 400) throw new Error(t('raid.badCoords'));
    await update(['raids'], (d) => {
      const r = (d.raids || []).find((z) => z.id === id);
      if (r && !(r.targets || []).some((p) => p.x === x && p.y === y)) r.targets = [...(r.targets || []), { x, y }];
    });
  },
  async removeRaidTarget({ id, x, y }) {
    await update(['raids'], (d) => {
      const r = (d.raids || []).find((z) => z.id === id);
      if (r) r.targets = (r.targets || []).filter((p) => !(p.x === x && p.y === y));
    });
  },
  // Farm lists kept in the extension.
  async addFarmList({ list }) {
    const name = String(list.name || '').trim().slice(0, 40) || t('farm.defaultName');
    const id = uid();
    await update(['farms'], (d) => {
      (d.farms = d.farms || []).push({
        id, name, villageId: String(list.villageId), everyMinutes: Math.max(5, Number(list.everyMinutes) || 30),
        eventType: list.eventType === 3 ? 3 : 4, maxPerRound: Math.max(1, Number(list.maxPerRound) || 50),
        skipWhenAttacked: list.skipWhenAttacked !== false, enabled: true, targets: [], nextAt: 0,
      });
    });
    return { id };
  },
  async updateFarmList({ id, patch }) {
    await update(['farms'], (d) => {
      const l = (d.farms || []).find((x) => x.id === id);
      if (l) Object.assign(l, patch);
    });
  },
  async removeFarmList({ id }) {
    await update(['farms'], (d) => { d.farms = (d.farms || []).filter((x) => x.id !== id); });
  },
  async addFarmTargets({ listId, targets }) {
    let added = 0, skipped = 0;
    await update(['farms'], (d) => {
      const l = (d.farms || []).find((x) => x.id === listId);
      if (!l) return;
      l.targets = l.targets || [];
      for (const tg of targets || []) {
        const x = Number(tg.x), y = Number(tg.y);
        const troops = cleanTroops(tg.troops);
        if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 400 || Math.abs(y) > 400 || !Object.keys(troops).length ||
          l.targets.some((o) => o.x === x && o.y === y)) { skipped += 1; continue; }
        l.targets.push({ id: uid(), x, y, name: String(tg.name || '').slice(0, 40), type: tg.type === 'oasis' ? 'oasis' : 'village', troops, enabled: true });
        added += 1;
      }
    });
    return { added, skipped };
  },
  async updateFarmTarget({ listId, targetId, patch }) {
    const clean = { ...patch };
    if (clean.troops) {
      clean.troops = cleanTroops(clean.troops);
      if (!Object.keys(clean.troops).length) throw new Error(t('farm.needTroops'));
    }
    if ('x' in clean || 'y' in clean) {
      clean.x = Number(clean.x); clean.y = Number(clean.y);
      if (!Number.isInteger(clean.x) || !Number.isInteger(clean.y) || Math.abs(clean.x) > 400 || Math.abs(clean.y) > 400) throw new Error(t('raid.badCoords'));
    }
    if ('name' in clean) clean.name = String(clean.name || '').slice(0, 40);
    if ('type' in clean) clean.type = clean.type === 'oasis' ? 'oasis' : 'village';
    if (clean.enabled) clean.fails = 0;
    await update(['farms'], (d) => {
      const l = (d.farms || []).find((x) => x.id === listId);
      const tg = l && (l.targets || []).find((x) => x.id === targetId);
      if (tg) Object.assign(tg, clean);
    });
  },
  async removeFarmTarget({ listId, targetId }) {
    await update(['farms'], (d) => {
      const l = (d.farms || []).find((x) => x.id === listId);
      if (l) l.targets = (l.targets || []).filter((x) => x.id !== targetId);
    });
  },
  // Same troops for every target in the list.
  async setFarmTroops({ listId, troops }) {
    const clean = cleanTroops(troops);
    if (!Object.keys(clean).length) throw new Error(t('farm.needTroops'));
    await update(['farms'], (d) => {
      const l = (d.farms || []).find((x) => x.id === listId);
      for (const tg of (l && l.targets) || []) tg.troops = { ...clean };
    });
  },
  async sendFarmNow({ id }) {
    await update(['schedule'], (d) => {
      d.schedule = d.schedule || {};
      d.schedule.farmNow = [...new Set([...(d.schedule.farmNow || []), id])];
    });
    tick(false, true);
  },
  // Escape plans: one per protected village.
  async saveEscape({ plan }) {
    const villageId = String(plan.villageId || '');
    if (!villageId) throw new Error(t('escape.needVillage'));
    const clean = {
      villageId,
      targetVillageId: plan.targetVillageId && plan.targetVillageId !== villageId ? String(plan.targetVillageId) : '',
      units: Array.isArray(plan.units) ? plan.units.filter((f) => /^t([1-9]|10)$/.test(f)) : 'all',
      troops: plan.troops !== false,
      donate: plan.donate ? {
        seconds: Math.min(600, Math.max(20, Math.round(Number(plan.donate.seconds) || 60))),
        keepCranny: plan.donate.keepCranny !== false,
        bonus: [0, 1, 2, 3].includes(Number(plan.donate.bonus)) ? Number(plan.donate.bonus) : -1,
      } : null,
      hero: !!plan.hero,
      leadSeconds: Math.min(3600, Math.max(30, Math.round(Number(plan.leadSeconds) || 120))),
      enabled: plan.enabled !== false,
      // Train this unit with what's in storage once the troops are out.
      spend: plan.spend && TROOP_BUILDINGS.includes(Number(plan.spend.gid)) && /^t([1-9]|10)$/.test(plan.spend.field)
        ? { gid: Number(plan.spend.gid), field: plan.spend.field } : null,
    };
    if (!clean.troops && !clean.donate) throw new Error(t('escape.needSomething'));
    if (clean.troops && Array.isArray(clean.units) && !clean.units.length) throw new Error(t('escape.needUnits'));
    await update(['escapes'], (d) => {
      d.escapes = d.escapes || [];
      const i = d.escapes.findIndex((p) => p.villageId === villageId);
      if (i >= 0) d.escapes[i] = { ...d.escapes[i], ...clean };
      else d.escapes.push({ id: uid(), ...clean });
    });
    await armEscapes();
  },
  async updateEscape({ id, patch }) {
    await update(['escapes'], (d) => {
      const p = (d.escapes || []).find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    });
    await armEscapes();
  },
  async testDonate({ villageId }) {
    await patchSchedule({ donateTest: { villageId, at: Date.now() } });
    urgent = true;
    tick(false, true);
  },
  async removeEscape({ id }) {
    await update(['escapes'], (d) => { d.escapes = (d.escapes || []).filter((x) => x.id !== id); });
    await armEscapes();
  },
  async scanOases({ villageId }) {
    await patchSchedule({ scanVillage: villageId });
    tick(false, true);
  },
  // Inactive finder: scan around a village now, and again every ~12 h
  // while automation runs, so population changes show.
  async finderScan({ villageId }) {
    await patchSchedule({ scanVillage: villageId, finderVillage: villageId, finderScanAt: Date.now() + 12 * 3600000 });
    tick(false, true);
  },
  // New-village plan: the player marks a village as done (founded) or left
  // out, or clears what was noted about it.
  async expansionMark({ villageId, patch }) {
    const clean = {};
    if (patch && 'skip' in patch) clean.skip = !!patch.skip;
    if (patch && 'founded' in patch) clean.founded = !!patch.founded;
    if (patch && patch.reset) Object.assign(clean, { noSlotAt: null, readyCount: null, readyAt: null, trainAt: null });
    await update(['expansion'], (d) => {
      d.expansion = d.expansion || {};
      d.expansion[villageId] = { ...(d.expansion[villageId] || {}), ...clean };
    });
  },
  // Settings → Web app: check in right away (after saving the address/key).
  async webSyncNow() {
    await webSync(true);
    const { health = {} } = await read(['health']);
    return health.web || null;
  },
  async finderStop() {
    await patchSchedule({ finderVillage: null, finderScanAt: null });
  },
  async finderClear() {
    await update(['mapVillages'], (d) => { d.mapVillages = {}; });
  },
  // Quick actions (popup, Telegram): stop or restart everything that acts
  // in the game. Watching, alerts and escape plans keep running.
  async pauseAll({ from } = {}) {
    await update(['settings', 'status'], (d) => {
      const st = mergeSettings(d.settings);
      d.status = { ...(d.status || {}), pausedAll: { botEnabled: st.botEnabled, autopilot: st.autopilot.enabled, at: Date.now() } };
      delete d.status.tgPaused;
      d.settings = mergeSettings({ ...st, botEnabled: false, autopilot: { ...st.autopilot, enabled: false } });
    });
    await refreshBadge();
    await log('info', t(from === 'telegram' ? 'log.tgPaused' : 'log.paused'));
  },
  async resumeAll({ from } = {}) {
    await update(['settings', 'status'], (d) => {
      const st = mergeSettings(d.settings);
      const status = d.status || {};
      const was = status.pausedAll || status.tgPaused || { botEnabled: true, autopilot: st.autopilot.enabled };
      d.settings = mergeSettings({ ...st, botEnabled: was.botEnabled || !was.autopilot, autopilot: { ...st.autopilot, enabled: !!was.autopilot } });
      delete status.pausedAll; delete status.tgPaused;
      d.status = status;
    });
    await refreshBadge();
    await log('info', t(from === 'telegram' ? 'log.tgResumed' : 'log.resumed'));
    tick(false, true);
  },
  // Every farm list with targets goes out now, whatever its timer says.
  async sendAllFarms() {
    const { farms = [] } = await read(['farms']);
    const ids = farms.filter((l) => l.enabled !== false && (l.targets || []).some((x) => x.enabled !== false)).map((l) => l.id);
    if (!ids.length) return 0;
    await update(['schedule'], (d) => { d.schedule = { ...(d.schedule || {}), farmNow: [...new Set([...((d.schedule || {}).farmNow || []), ...ids])] }; });
    tick(false, true);
    return ids.length;
  },
  // Escape plans of attacked villages run now instead of at their lead time.
  async escapeNow() {
    const { escapes = [], villages = {} } = await read(['escapes', 'villages']);
    const now = Date.now();
    const ids = escapes.filter((p) => p.enabled !== false && villages[p.villageId] && firstAttack(villages[p.villageId], now)).map((p) => p.villageId);
    if (!ids.length) return [];
    await update(['schedule'], (d) => { d.schedule = { ...(d.schedule || {}), escapeNow: [...new Set([...((d.schedule || {}).escapeNow || []), ...ids])] }; });
    urgent = true;
    tick(false, true);
    return ids.map((id) => villages[id].name);
  },
  async runNow() {
    await patchSchedule({ refreshAt: 0 });
    // "Check now" should retry builds immediately, not after a scheduled wait.
    await update(['villages'], (d) => {
      for (const v of Object.values(d.villages || {})) { delete v.buildWait; delete v.buildRetryAt; delete v.autoIdleUntil; }
    });
    tick(true);
  },
  async sendSummary() {
    const s = await getSettings();
    if (!s.telegram.token || !s.telegram.chatId) throw new Error(t('tg.notSetUp'));
    await sendTelegram(s, await runTelegramCommand('summary'));
    return true;
  },
  async testAlert() {
    const s = await getSettings();
    if (s.alerts.desktop) {
      chrome.notifications.create(`tvh-test-${uid()}`, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t('test.title'), message: t('test.desktop'),
      });
    }
    return sendRemote(s, t('test.remote'));
  },
  async clearLog() { await update(['log'], (d) => { d.log = []; }); },
  async exportData() {
    const local = await read([...COMMAND_KEYS, 'villages']);
    return {
      format: 'travian-helper-backup',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      ...commandsOf(local),
      villages: local.villages || {},
    };
  },
  // Accepts our backup file, or a raw storage dump from an older version.
  async importData({ data }) {
    if (!data || typeof data !== 'object' || !(data.settings || data.tasks || data.training || data.raids || data.farms || data.escapes)) {
      throw new Error(t('backup.invalid'));
    }
    const uidIfMissing = (x) => ({ ...x, id: x.id || uid() });
    const tasks = {};
    for (const [vid, list] of Object.entries(data.tasks || {})) {
      if (Array.isArray(list) && list.length) tasks[vid] = list.map((x) => ({ ...uidIfMissing(x), attempts: 0 }));
    }
    const training = (Array.isArray(data.training) ? data.training : []).map((r) => ({ ...uidIfMissing(r), nextAt: 0 }));
    const raids = (Array.isArray(data.raids) ? data.raids : []).map((r) => ({ ...uidIfMissing(r), nextAt: 0 }));
    const farms = (Array.isArray(data.farms) ? data.farms : []).map((l) => ({ ...uidIfMissing(l), nextAt: 0, targets: (l.targets || []).map(uidIfMissing) }));
    const escapes = (Array.isArray(data.escapes) ? data.escapes : []).map(uidIfMissing);
    await update(['settings', 'tasks', 'training', 'raids', 'farms', 'escapes', 'villages'], (d) => {
      d.settings = mergeSettings({ ...mergeSettings(d.settings), ...(data.settings || {}) });
      d.tasks = tasks;
      d.training = training;
      d.raids = raids;
      d.farms = farms;
      d.escapes = escapes;
      if (data.villages && !Object.keys(d.villages || {}).length) d.villages = data.villages;
    });
    await pushCommands();
    await refreshBadge();
    return { tasks: Object.values(tasks).reduce((n, l) => n + l.length, 0), training: training.length + raids.length };
  },
  async takeOver() {
    await renewLease();
    await setStatus({ state: 'idle', note: '' });
  },
  async syncNow() {
    const pulled = await pullCommands();
    const pushed = await pushCommands();
    return { pulled, pushed };
  },
  async resetData() {
    await update(['villages', 'account', 'schedule', 'alertMemo', 'status', 'history', 'oases', 'mapVillages', 'valleys', 'expansion'], (d) => {
      d.villages = {}; d.account = {}; d.schedule = {}; d.alertMemo = {}; d.status = {}; d.history = {}; d.oases = {}; d.mapVillages = {}; d.valleys = {}; d.expansion = {};
    });
    await refreshBadge();
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return undefined;
  if (msg.type === 'USER_ACTIVE') {
    getSettings().then((st) => setStatus({ userActiveUntil: Date.now() + st.pauseMinutes * 60000 }));
    return undefined;
  }
  if (msg.type === 'PAGE') {
    const tabId = sender.tab ? sender.tab.id : null;
    processPage(msg.state, tabId)
      .then((r) => { resolvePage(tabId, msg.state); sendResponse(r); })
      .catch((e) => { resolvePage(tabId, msg.state); sendResponse({ error: e.message }); });
    return true;
  }
  const fromExtensionPage = (sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (msg.type === 'COMMAND' && COMMANDS[msg.name] && fromExtensionPage) {
    Promise.resolve(COMMANDS[msg.name](msg.args || {}))
      .then((r) => sendResponse({ ok: true, result: r }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return undefined;
});

// --------------------------------------------------------------- telegram --
const sendTelegram = (s, text) => fetch(`https://api.telegram.org/bot${encodeURIComponent(s.telegram.token)}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: s.telegram.chatId, text }),
}).catch(() => null);

const COMMAND_MAX_AGE_MS = 5 * 60 * 1000; // older commands (computer was off…) are not run

async function runTelegramCommand(cmd) {
  const data = await read([...DATA_KEYS, 'escapes', 'stats']);
  const s = mergeSettings(data.settings);
  setLanguage(s.language);
  data.settings = s; data.tasks = data.tasks || {}; data.villages = data.villages || {};
  const now = Date.now();
  if (cmd === 'status') return statusText(data, now);
  if (cmd === 'help') return helpText();
  if (cmd === 'summary') return summaryText(data, data.stats || {}, now);
  if (cmd === 'pause') { await COMMANDS.pauseAll({ from: 'telegram' }); return t('tg.paused'); }
  if (cmd === 'resume') { await COMMANDS.resumeAll({ from: 'telegram' }); return t('tg.resumed'); }
  if (cmd === 'check') { await COMMANDS.runNow(); return t('tg.checking'); }
  if (cmd === 'farms') {
    const n = await COMMANDS.sendAllFarms();
    return n ? t('tg.farmsQueued', { n }) : t('tg.noFarms');
  }
  if (cmd === 'escape') {
    const names = await COMMANDS.escapeNow();
    return names.length ? t('tg.escaping', { list: names.join(t('list.sep')) }) : t('tg.noEscape');
  }
  return null;
}

let polling = false;
async function pollTelegram() {
  if (polling) return;
  polling = true;
  try {
    const s = await getSettings();
    if (!s.telegram.token || !s.telegram.chatId) return;
    const now = Date.now();
    // Only the browser that drives the game answers, so replies aren't doubled.
    if (!(await mayRun(now)).ok) return;
    const { tgState = {} } = await read(['tgState']);

    // Daily summary at the chosen hour (or within 3 hours of it, if the
    // computer was off or asleep right then).
    const day = new Date(now).toDateString();
    const late = new Date(now).getHours() - Number(s.telegram.summaryHour);
    if (s.telegram.summaryHour >= 0 && late >= 0 && late < 3 && tgState.summaryDay !== day) {
      tgState.summaryDay = day;
      await chrome.storage.local.set({ tgState });
      const reply = await runTelegramCommand('summary');
      await sendTelegram(s, reply);
      await update(['stats'], (d) => { d.stats = { since: Date.now() }; });
    }

    if (s.telegram.control === false) return;
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(s.telegram.token)}/getUpdates?timeout=0&offset=${tgState.offset || 0}`).catch(() => null);
    const json = res && res.ok ? await res.json().catch(() => null) : null;
    if (!json || !json.ok) { await noteService('telegram', false, res ? `HTTP ${res.status}` : 'network'); return; }
    await noteService('telegram', true);
    const fresh = tgState.offset != null; // first poll: skip whatever was waiting
    let offset = tgState.offset || 0;
    for (const u of json.result || []) {
      offset = Math.max(offset, u.update_id + 1);
      const m = u.message;
      if (!fresh || !m || !m.text || String(m.chat && m.chat.id) !== String(s.telegram.chatId)) continue;
      const cmd = parseCommand(m.text);
      if (!cmd) { await sendTelegram(s, helpText()); continue; }
      if (now - m.date * 1000 > COMMAND_MAX_AGE_MS) { await sendTelegram(s, t('tg.tooOld')); continue; }
      const reply = await runTelegramCommand(cmd);
      if (reply) await sendTelegram(s, reply);
    }
    await chrome.storage.local.set({ tgState: { ...tgState, offset } });
  } catch (e) {
    /* network hiccup: next minute */
  } finally {
    polling = false;
  }
}

// ------------------------------------------------------------ web app --
// The web app (Vercel) shows this browser's data and sends commands. Every
// minute — every few seconds while someone has it open — the browser that
// drives the game checks in, runs the commands waiting there and sends back
// their results. New data goes up at once while someone watches, otherwise
// at most every 5 minutes (the free database plan counts traffic).
let webBusy = false;
let webFastUntil = 0;
let webLooping = false;

async function webSync(force = false) {
  if (webBusy) return;
  webBusy = true;
  try {
    const s = await getSettings();
    const base = webBase(s.web.url);
    if (!base || !s.web.key) return;
    if (!(await mayRun(Date.now())).ok) return;
    const device = await getDevice();
    const version = chrome.runtime.getManifest().version;
    let { webState = {} } = await chrome.storage.session.get('webState');
    let results = webState.results || [];
    // Twice at most: once to pick up commands, once to report on them.
    for (let round = 0; round < 2; round++) {
      const data = await chrome.storage.local.get(SNAPSHOT_KEYS);
      data.settings = await getSettings();
      try { data.lease = (await chrome.storage.sync.get('lease')).lease || null; } catch (e) { data.lease = null; }
      const snap = snapshotOf(data, version);
      const hash = hashOf(snap.text);
      // New data goes up at once while someone watches, else every 5 minutes at most.
      const due = Date.now() - (webState.sentAt || 0) >= (webState.viewer ? 0 : 5 * 60000);
      const upload = !snap.tooLarge && (force || round > 0 || (hash !== webState.hash && due));
      let res;
      try {
        res = await fetch(`${base}/api/agent`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s.web.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ version, device: device.name, results, snapshotAt: webState.snapshotAt || 0, ...(upload ? { snapshot: snap.snapshot } : {}) }),
        });
      } catch (e) {
        await noteService('web', false, t('web.unreachable'));
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await noteService('web', false, res.status === 401 ? t('web.badKey') : json.error || `HTTP ${res.status}`);
        return;
      }
      await noteService('web', true, snap.tooLarge ? t('web.tooLarge') : '');
      webState = { hash: upload ? hash : webState.hash, sentAt: upload ? Date.now() : webState.sentAt, snapshotAt: json.snapshotAt || webState.snapshotAt, viewer: !!json.viewer, results: [] };
      await chrome.storage.session.set({ webState });
      if (json.viewer) webFastUntil = Date.now() + 2 * 60000;
      results = [];
      for (const c of json.commands || []) {
        const args = cleanRemote(c.name, c.args, await getSettings());
        if (!args || !COMMANDS[c.name]) { results.push({ id: c.id, ok: false, error: t('web.notAllowed') }); continue; }
        try {
          const r = await COMMANDS[c.name](args);
          results.push({ id: c.id, ok: true, result: r === undefined ? null : r });
          await log('info', t('log.webCommand', { name: c.name }));
        } catch (e) {
          results.push({ id: c.id, ok: false, error: e.message });
        }
      }
      if (!results.length) break;
      await chrome.storage.session.set({ webState: { ...webState, results } });
    }
  } finally {
    webBusy = false;
  }
  // Someone has the web app open: answer within seconds, not a minute.
  if (webFastUntil > Date.now()) {
    chrome.alarms.create('webPoll', { periodInMinutes: 0.5 });
    if (!webLooping) {
      webLooping = true;
      (async () => {
        while (webFastUntil > Date.now()) {
          await sleep(5000);
          await webSync();
        }
        webLooping = false;
        chrome.alarms.clear('webPoll');
      })();
    }
  }
}

// ------------------------------------------------------------- lifecycle --
async function setup() {
  await chrome.alarms.create('tick', { periodInMinutes: 1 });
  await getDevice();
  // Restore commands saved from another browser (or before a reinstall),
  // then save this browser's commands.
  const pulled = await pullCommands();
  if (pulled.pulled) await log('info', t('log.syncRestored', { from: pulled.from }));
  await pushCommands();
  await refreshBadge();
  await armEscapes();
}

// Save commands to the Chrome account whenever they change here, and pick
// up changes another browser saved.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && COMMAND_KEYS.some((k) => k in changes)) schedulePush();
  if (area === 'sync' && changes.cmdMeta) {
    pullCommands().then(async (r) => {
      if (r.pulled) {
        await getSettings();
        await log('info', t('log.syncUpdated', { from: r.from }));
        await refreshBadge();
      }
    });
  }
});
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick' || a.name === 'webPoll') webSync();
  if (a.name === 'tick') { pollTelegram(); tick(); }
  else if (a.name.startsWith('escape:') || a.name.startsWith('donate:')) { urgent = true; tick(false, true); }
});
chrome.notifications.onClicked.addListener(async () => {
  const s = await getSettings();
  if (s.server) chrome.tabs.create({ url: `${s.server}/dorf1.php` });
});
