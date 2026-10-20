// Rendering helpers shared by the popup and the dashboard.
import {
  RESOURCES, resLabel, mergeSettings, estimateStock, hoursUntilLimit, capacityFor,
  fmtDuration, fmtAgo, fmtNum, fmtClock, buildStatus,
} from './shared.js';
import { t, setLanguage, coords, ltr } from './i18n.js';
import { escapeStatus, donateStatus } from './escape.js';

export { escapeStatus };

export const STORAGE_KEYS = ['settings', 'villages', 'account', 'tasks', 'training', 'raids', 'farms', 'escapes', 'oases', 'schedule', 'status', 'log', 'device', 'syncState', 'history', 'health', 'stats', 'mapVillages', 'valleys', 'expansion', 'diag'];

export async function loadAll() {
  const data = await chrome.storage.local.get(STORAGE_KEYS);
  data.settings = mergeSettings(data.settings);
  setLanguage(data.settings.language);
  data.villages = data.villages || {};
  data.account = data.account || {};
  data.tasks = data.tasks || {};
  data.training = data.training || [];
  data.raids = data.raids || [];
  data.farms = data.farms || [];
  data.escapes = data.escapes || [];
  data.oases = data.oases || {};
  data.schedule = data.schedule || {};
  data.status = data.status || {};
  data.log = data.log || [];
  data.health = data.health || {};
  data.stats = data.stats || {};
  data.mapVillages = data.mapVillages || {};
  data.valleys = data.valleys || {};
  data.expansion = data.expansion || {};
  data.diag = data.diag || {};
  applyTheme(data.settings.theme);
  try {
    data.lease = (await chrome.storage.sync.get('lease')).lease || null;
  } catch (e) {
    data.lease = null;
  }
  return data;
}

export async function command(name, args) {
  const res = await chrome.runtime.sendMessage({ type: 'COMMAND', name, args });
  if (!res || !res.ok) throw new Error((res && res.error) || 'No response from background');
  return res.result;
}

// Is the player typing or choosing inside this element? (A focused button
// or checkbox doesn't count: tables redraw after those are clicked.)
// The switches that let the bot act in the game (scheduled rules need one).
export const automationOn = (s) => !!(s && (s.botEnabled || (s.autopilot && s.autopilot.enabled)));

export function editingIn(el) {
  const a = document.activeElement;
  return !!a && !!el && el.contains(a) && a.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), select, textarea');
}

// Replace a <select>'s options only when they changed, keeping the choice.
export function fillSelect(sel, options, selected) {
  const sig = JSON.stringify(options);
  if (sel.dataset.sig !== sig) {
    const keep = selected ?? sel.value;
    sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    sel.dataset.sig = sig;
    if (options.some(([v]) => String(v) === String(keep))) sel.value = keep;
  } else if (selected != null && options.some(([v]) => String(v) === String(selected))) {
    sel.value = selected;
  }
}

// Troops in a village and what its barracks/stable/workshop are training.
export function troopInfo(v, now = Date.now()) {
  const home = (v.troops || []).filter((x) => x.count > 0);
  const training = [];
  for (const [gid, q] of Object.entries(v.trainingQueue || {})) {
    for (const it of q.items || []) if (!it.finishAt || it.finishAt > now) training.push({ ...it, gid: Number(gid) });
  }
  training.sort((a, b) => (a.finishAt || Infinity) - (b.finishAt || Infinity));
  return {
    seen: !!v.troops,
    home,
    total: home.filter((x) => x.unit !== 'hero').reduce((n, x) => n + x.count, 0),
    training,
    trainingTotal: training.reduce((n, x) => n + x.count, 0),
    trainingSeen: Object.values(v.trainingQueue || {}).some((q) => !q.unknown),
  };
}

// Light / dark: "system" follows the computer. The last choice is kept in
// localStorage too, so pages open in the right colours before data loads.
export const THEMES = ['system', 'light', 'dark'];
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try { localStorage.setItem('tvh.theme', theme || 'system'); } catch (e) { /* storage blocked */ }
}
export function initTheme() {
  try { applyTheme(localStorage.getItem('tvh.theme') || 'system'); } catch (e) { /* storage blocked */ }
}
export const nextTheme = (theme) => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
export const themeIcon = (theme) => (theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function statusLine(data, now = Date.now()) {
  const { settings: s, status, schedule } = data;
  if (!s.server) return { tone: 'muted', text: t('status.noServer') };
  if (status.loggedOut) return { tone: 'bad', text: t('status.loggedOut') };
  if (status.state === 'otherDevice') return { tone: 'warn', text: t('status.otherDevice', { name: status.note }) };
  if (status.state === 'working') return { tone: 'good', text: t('status.working', { note: status.note }) };
  if (status.state === 'paused') return { tone: 'warn', text: t('status.paused') };
  if (!s.watchEnabled && !s.botEnabled && !s.autopilot.enabled) return { tone: 'muted', text: t('status.off') };
  const next = schedule.refreshAt ? Math.max(0, schedule.refreshAt - now) : 0;
  const last = status.lastRunAt ? t('status.last', { ago: fmtAgo(status.lastRunAt, now) }) : '';
  const auto = s.autopilot.enabled ? `${t('status.autopilot')} · ` : '';
  return { tone: 'good', text: auto + t('status.next', { t: fmtDuration(next) }) + last };
}

// One line per village for the popup when there are many: name, four
// small storage bars and what matters most right now.
export function villageRow(v, data, now = Date.now(), open = false) {
  const est = estimateStock(v, now);
  const bars = est ? RESOURCES.map((k) => {
    const pct = Math.min(100, Math.round((est[k] / (capacityFor(v.resources, k) || 1)) * 100));
    const p = v.resources.production ? v.resources.production[k] : 0;
    const tone = (k === 'crop' && p < 0) || pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : '';
    return `<span class="vr-bar res-${k}" title="${esc(`${resLabel(k)} ${pct}%`)}"><i class="${tone}" style="height:${Math.max(6, pct)}%"></i></span>`;
  }).join('') : '';
  let state;
  const first = (v.movements || []).filter((m) => m.kind === 'att1' && m.arriveAt > now).map((m) => m.arriveAt).sort((a, b) => a - b)[0];
  const active = (v.buildQueue || []).filter((b) => b.finishAt && b.finishAt > now).sort((a, b) => a.finishAt - b.finishAt);
  if (v.underAttack) state = `<span class="bad">⚔ ${first ? `<b class="mono">${fmtDuration(first - now)}</b>` : esc(t('card.attack'))}</span>`;
  else if (active.length) state = `<span>🏗 <span class="mono">${fmtDuration(active[0].finishAt - now)}</span></span>`;
  else if (v.buildQueue) state = `<span class="warn-text">${esc(t('card.idle'))}</span>`;
  else state = `<span class="muted">${esc(fmtAgo(v.updatedAt, now))}</span>`;
  return `<button type="button" class="vrow${v.underAttack ? ' attacked' : ''}${open ? ' open' : ''}" data-expand="${esc(v.id)}" aria-expanded="${open}">
    <span class="vr-name">${esc(v.name)} <small class="muted">${coords(v.x, v.y)}</small></span>
    <span class="vr-bars" aria-hidden="true">${bars}</span>
    <span class="vr-state small">${state}</span>
  </button>`;
}

export function villageCard(v, data, now = Date.now()) {
  const est = estimateStock(v, now);
  const tasks = (data.tasks[v.id] || []).length;
  const trains = data.training.filter((r) => r.villageId === v.id && r.enabled !== false).length;
  const prod = v.resources && v.resources.production;

  const resRows = est ? RESOURCES.map((k) => {
    const cap = capacityFor(v.resources, k) || 1;
    const pct = Math.min(100, Math.round((est[k] / cap) * 100));
    const hrs = hoursUntilLimit(v, k, now);
    const p = prod ? prod[k] : null;
    const parts = [];
    if (p != null) parts.push(ltr(t('card.perHour', { n: `${p > 0 ? '+' : ''}${fmtNum(p)}` })));
    let tone = pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : '';
    if (p > 0 && hrs != null) parts.push(hrs <= 0 ? t('card.full') : t('card.fullIn', { t: fmtDuration(hrs * 3600000) }));
    if (p < 0 && hrs != null) { parts.push(t('card.emptyIn', { t: fmtDuration(hrs * 3600000) })); tone = 'bad'; }
    return `<div class="res res-${k}">
      <span class="res-name">${resLabel(k)}</span>
      <span class="res-val"><span dir="ltr">${fmtNum(est[k])}<small> / ${fmtNum(cap)}</small></span></span>
      <div class="bar"><i class="${tone}" style="width:${pct}%"></i></div>
      <span class="res-sub ${tone}">${esc(parts.join(' · '))}</span>
    </div>`;
  }).join('') : `<p class="muted small">${esc(t('card.noData'))}</p>`;

  const active = (v.buildQueue || []).filter((b) => !b.finishAt || b.finishAt > now);
  const queue = active.length
    ? `<ul class="queue">${active.map((b) => `<li><span>${esc(b.name)} <b>${b.level != null ? esc(t('card.level', { n: b.level })) : ''}</b></span><span class="mono">${b.finishAt ? fmtDuration(b.finishAt - now) : ''}</span></li>`).join('')}</ul>`
    : v.buildQueue ? `<p class="small warn-text">${esc(t('card.idle'))}</p>` : '';

  let attack = '';
  if (v.underAttack) {
    const firsts = (v.movements || []).filter((m) => m.kind === 'att1' && m.arriveAt && m.arriveAt > now).map((m) => m.arriveAt).sort((a, b) => a - b);
    const n = v.incomingAttacks || 0;
    const first = firsts[0] ? esc(t('card.firstIn', { t: '\u0000', clock: fmtClock(firsts[0]) })).replace('\u0000', `<b class="mono">${fmtDuration(firsts[0] - now)}</b>`) : '';
    attack = `<div class="attack">⚔ ${esc(n ? t('card.attacks', { n }) : t('card.attack'))}${first}</div>`;
  }
  const plan = (data.escapes || []).find((p) => p.villageId === v.id);
  const esc_ = escapeStatus(v, plan, data.villages, now);
  if (esc_ && (v.underAttack || esc_.tone !== 'muted')) attack += `<p class="small escape-line ${esc_.tone}">${plan.troops === false ? '💰' : '🏃'} ${esc(esc_.text)}</p>`;
  const dn = plan && plan.troops !== false ? donateStatus(v, plan, now) : null;
  if (dn && (v.underAttack || dn.tone !== 'muted')) attack += `<p class="small escape-line ${dn.tone}">💰 ${esc(dn.text)}</p>`;

  const troops = troopInfo(v, now);
  const troopLine = troops.seen
    ? `<p class="small muted troop-line">🛡 ${esc(t('card.troops', { n: fmtNum(troops.total) }))}${troops.trainingTotal ? ` · ${esc(t('card.inTraining', { n: fmtNum(troops.trainingTotal) }))}` : ''}</p>`
    : '';

  const why = buildStatus(v, data, now);
  const chips = [];
  if (tasks) chips.push(t('card.buildTasks', { n: tasks }));
  if (trains) chips.push(t('card.trainRules', { n: trains }));

  return `<article class="village${v.underAttack ? ' attacked' : ''}">
    <header>
      <h3>${esc(v.name)} <span class="muted">${coords(v.x, v.y)}</span></h3>
      <span class="muted small">${esc(fmtAgo(v.updatedAt, now))}</span>
    </header>
    ${attack}
    <div class="res-grid">${resRows}</div>
    ${queue}
    ${troopLine}
    ${chips.length ? `<p class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</p>` : ''}
    ${why ? `<p class="build-why ${why.tone}">${esc(why.text)}</p>` : ''}
  </article>`;
}
