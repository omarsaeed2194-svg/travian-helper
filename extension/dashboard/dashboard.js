import { loadAll, command, statusLine, esc, fillSelect, troopInfo, initTheme, nextTheme, themeIcon, THEMES, editingIn, automationOn } from '../src/ui.js';
import { renderHealth } from './health.js';
import { renderOverview } from './overview.js';
import { renderAutopilot } from './autopilot.js';
import { renderFarms } from './farms.js';
import { renderFinder } from './finder.js';
import { renderCulture } from './culture.js';
import { renderEscapes } from './escape.js';
import { renderBrain } from './brain.js';
import { leaseIsFresh } from '../src/sync.js';
import { webBase } from '../src/web.js';
import { unitIcon, tribeBase } from '../src/units.js';
import {
  sortedVillages, taskLabel, buildingName, fmtDuration, fmtAgo, TRAINING_BUILDINGS, buildStatus, hospitalOf,
} from '../src/shared.js';
import { t, applyI18n, coords, dateLocale, LANGUAGES } from '../src/i18n.js';

const $ = (id) => document.getElementById(id);
let data = null;
let buildVillageId = null;
let lang = null;

// ------------------------------------------------------------------ tabs ---
initTheme();

// The menu, in groups. Every page has an icon and a few related pages, shown
// as links under its title so features that work together stay one click apart.
const NAV = [
  { tabs: ['overview'] },
  { group: 'nav.gEconomy', tabs: ['build', 'culture'] },
  { group: 'nav.gArmy', tabs: ['troops', 'defense', 'farms', 'oasis'] },
  { group: 'nav.gAuto', tabs: ['brain', 'autopilot', 'hero'] },
  { group: 'nav.gSystem', tabs: ['alerts', 'settings', 'health', 'log'] },
];
const ICONS = {
  overview: '🏠', build: '🏗', culture: '🏛', troops: '⚔', defense: '🛡', farms: '🐎', oasis: '🌿',
  brain: '🧠', autopilot: '🤖', hero: '🦸', alerts: '🔔', settings: '⚙', health: '🩺', log: '📜',
};
const RELATED = {
  build: ['culture', 'autopilot'],
  culture: ['build', 'autopilot'],
  troops: ['defense', 'farms', 'oasis'],
  defense: ['troops', 'alerts'],
  farms: ['oasis', 'troops', 'autopilot'],
  oasis: ['farms', 'autopilot'],
  brain: ['autopilot', 'troops', 'defense', 'build'],
  autopilot: ['brain', 'build', 'culture', 'hero', 'farms', 'oasis'],
  hero: ['autopilot', 'overview'],
  alerts: ['defense', 'health'],
  settings: ['alerts', 'health'],
  health: ['log', 'settings'],
  log: ['health'],
};
// Simple mode: only the pages someone who lets the brain play needs.
const SIMPLE = new Set(['overview', 'brain', 'defense', 'alerts', 'settings', 'health']);
// Pages that moved: old links still land in the right place.
const ALIASES = { raids: 'farms', escape: 'defense' };
const label = (tab) => `<span class="nav-ic" aria-hidden="true">${ICONS[tab]}</span><span data-i18n="nav.${tab}"></span>`;
const simpleAttr = (tab) => (SIMPLE.has(tab) ? ' data-simple' : '');

function buildNav() {
  $('tabs').innerHTML = NAV.map((g) => `<div class="nav-group" role="group"${g.group ? ` aria-labelledby="ng-${g.tabs[0]}"` : ''}>
      ${g.group ? `<span class="nav-label" id="ng-${g.tabs[0]}" data-i18n="${g.group}"></span>` : ''}
      ${g.tabs.map((tab) => `<a href="#${tab}" data-tab="${tab}"${simpleAttr(tab)}>${label(tab)}</a>`).join('')}
    </div>`).join('');
  for (const [tab, list] of Object.entries(RELATED)) {
    const head = document.createElement('header');
    head.className = 'page-head';
    head.innerHTML = `<h1>${label(tab)}</h1>
      <div class="related"><span class="muted small" data-i18n="nav.related"></span>
        ${list.map((x) => `<a href="#${x}" class="chip-link"${simpleAttr(x)}>${label(x)}</a>`).join('')}</div>`;
    $(`tab-${tab}`).prepend(head);
  }
  for (const a of document.querySelectorAll('[data-goto]')) a.innerHTML = `<span data-i18n="nav.${a.dataset.goto}"></span><span class="goto-arrow" aria-hidden="true"></span>`;
}
buildNav();

function showTab() {
  let name = (location.hash || '#overview').slice(1);
  name = ALIASES[name] || name;
  if (!$(`tab-${name}`)) name = 'overview';
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('active', a.dataset.tab === name);
  revealActive();
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === `tab-${name}`);
  // A new page starts at its top (the phone's tab bar stays put).
  if (showTab.last && showTab.last !== name) window.scrollTo({ top: 0 });
  showTab.last = name;
}
window.addEventListener('hashchange', showTab);
// Phone layout: the menu is one row that scrolls sideways; keep the open
// page in view, also after the language (and so the widths) changed.
function revealActive() {
  const a = document.querySelector('.tabs a.active');
  if (a && $('tabs').scrollWidth > $('tabs').clientWidth) a.scrollIntoView({ block: 'nearest', inline: 'center' });
}
window.matchMedia('(max-width: 760px)').addEventListener('change', revealActive);

// -------------------------------------------------------------- helpers ---
const villageOptions = () => sortedVillages(data.villages).map((v) => [v.id, `${v.name} ${coords(v.x, v.y)}`]);
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// ------------------------------------------------------------- settings ---
function fillSettings() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    if (el === document.activeElement && el.type !== 'checkbox') continue;
    const v = getPath(data.settings, el.dataset.setting);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
}

async function saveSetting(el) {
  const path = el.dataset.setting.split('.');
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number' || el.dataset.setting === 'maxQueue') {
    // An emptied box keeps the saved value; others stay within the box's limits.
    if (String(el.value).trim() === '') { el.value = getPath(data.settings, el.dataset.setting) ?? ''; return; }
    value = Number(value);
    if (!Number.isFinite(value)) return;
    if (el.min !== '' && el.min != null && value < Number(el.min)) value = Number(el.min);
    if (el.max !== '' && el.max != null && value > Number(el.max)) value = Number(el.max);
    el.value = value;
  }
  if (el.dataset.setting === 'telegram.summaryHour') value = Number(value);
  const top = path[0];
  const patch = path.length === 1 ? { [top]: value } : { [top]: { ...data.settings[top], [path[1]]: value } };
  data.settings = { ...data.settings, ...patch };
  await command('saveSettings', { settings: patch });
}

for (const el of document.querySelectorAll('[data-setting]')) {
  el.addEventListener('change', () => saveSetting(el));
}

// ---------------------------------------------------------------- build ---
// Why the selected village's next upgrade hasn't started (ticks every second).
function renderBuildWhy(now) {
  const v = data.villages[buildVillageId];
  const why = v && buildStatus(v, data, now);
  $('buildWhy').hidden = !why;
  if (why) {
    $('buildWhy').className = `status ${why.tone}`;
    $('buildWhy').textContent = why.text;
  }
}

function upgradeTable(items, kind) {
  if (!items || !items.length) {
    return `<tr><td class="muted">${esc(t(kind === 'fields' ? 'build.notScannedFields' : 'build.notScannedBuildings'))}</td></tr>`;
  }
  const rows = items.slice().sort((a, b) => a.slot - b.slot).map((b) => {
    const name = buildingName(b.gid, b.name);
    const tag = b.underConstruction ? `<span class="tag busy">${esc(t('build.upgrading'))}</span>`
      : b.maxLevel ? `<span class="tag">${esc(t('build.max'))}</span>` : '';
    return `<tr>
      <td class="muted">${b.slot}</td>
      <td>${esc(name)} ${tag}</td>
      <td class="mono">${b.level}</td>
      <td class="actions">${b.maxLevel ? '' : `${esc(t('build.to'))} <input type="number" class="num" min="${b.level + 1}" max="21" value="${b.level + 1}" data-target="${b.slot}">
        <button class="btn small" data-add-slot="${b.slot}" data-name="${esc(name)}">${esc(t('build.queueBtn'))}</button>`}</td>
    </tr>`;
  }).join('');
  return `<tr><th>${esc(t('th.slot'))}</th><th>${esc(t(kind === 'fields' ? 'th.field' : 'th.building'))}</th><th>${esc(t('th.level'))}</th><th></th></tr>${rows}`;
}

function renderBuild(now, force) {
  fillSelect($('buildVillage'), villageOptions(), buildVillageId);
  buildVillageId = $('buildVillage').value || null;
  const v = data.villages[buildVillageId];
  if (!v) {
    $('taskList').innerHTML = `<li class="empty muted">${esc(t('build.noVillages'))}</li>`;
    $('fieldTable').innerHTML = '';
    $('buildingTable').innerHTML = '';
    return;
  }
  const tasks = data.tasks[v.id] || [];
  $('buildScan').textContent = t('build.scan', { a: fmtAgo(v.fieldsAt, now), b: fmtAgo(v.buildingsAt, now) });
  renderBuildWhy(now);
  $('taskList').innerHTML = tasks.length
    ? tasks.map((task) => `<li>
        <span class="label">${esc(taskLabel(task, v))}</span>
        ${task.attempts ? `<span class="tag busy">${esc(t('build.waiting'))}</span>` : ''}
        <button class="btn small" data-move="-1" data-task="${task.id}" title="${esc(t('build.moveUp'))}">↑</button>
        <button class="btn small" data-move="1" data-task="${task.id}" title="${esc(t('build.moveDown'))}">↓</button>
        <button class="btn small danger" data-remove-task="${task.id}" title="${esc(t('build.remove'))}">✕</button>
      </li>`).join('')
    : `<li class="empty muted">${esc(t('build.emptyQueue'))}</li>`;

  renderNewBuilding(v);
  if (force || !editingIn($('fieldTable'))) $('fieldTable').innerHTML = upgradeTable(v.fields, 'fields');
  const buildings = (v.buildings || []).filter((b) => b.gid > 0);
  if (force || !editingIn($('buildingTable'))) $('buildingTable').innerHTML = upgradeTable(v.buildings ? buildings : null, 'buildings');
}

// New building on a free site: rally point only on 39, the wall only on 40,
// anything else on the free sites of the village centre.
const SITE_ONLY = { 16: 39 };
const WALL_GIDS = [31, 32, 33, 42, 43];
const NEW_GIDS = [10, 11, 23, 17, 19, 20, 21, 22, 13, 18, 24, 25, 26, 27, 37, 5, 6, 7, 8, 9, 14, 34, 36, 41];
function renderNewBuilding(v) {
  const sites = (v.buildings || []).filter((b) => !b.gid).map((b) => b.slot).sort((a, b) => a - b);
  const has = new Set((v.buildings || []).filter((b) => b.gid).map((b) => b.gid));
  fillSelect($('newSite'), sites.map((slot) => [slot, slot === 39 ? t('build.siteRally', { n: slot }) : slot === 40 ? t('build.siteWall', { n: slot }) : t('build.siteN', { n: slot })]));
  const site = Number($('newSite').value);
  const base = tribeBase(data.villages);
  const wall = { 0: 31, 10: 32, 20: 33, 50: 42, 60: 43 }[base];
  const gids = site === 39 ? [16] : site === 40 ? (wall ? [wall] : WALL_GIDS) : NEW_GIDS.filter((g) => !SITE_ONLY[g] && !(has.has(g) && [10, 11, 23, 36].indexOf(g) < 0));
  fillSelect($('newGid'), gids.map((g) => [g, buildingName(g)]));
  $('addNewBuilding').disabled = !sites.length;
  if (!v.buildings) $('newSite').title = t('build.notScannedBuildings');
}
$('newSite').addEventListener('change', () => render());
$('addNewBuilding').addEventListener('click', () => {
  const slot = Number($('newSite').value), gid = Number($('newGid').value), targetLevel = Number($('newLevel').value);
  if (!buildVillageId || !slot || !gid || !(targetLevel >= 1)) return;
  command('addTask', { villageId: buildVillageId, task: { kind: 'upgrade', slot, gid, targetLevel, name: buildingName(gid) } });
});

$('buildVillage').addEventListener('change', (e) => { buildVillageId = e.target.value; render(); });
// Tips can open the Build tab on a specific village.
window.addEventListener('tvh:select-village', (e) => {
  buildVillageId = e.detail;
  // The Troops tab's village too (the "train troops" tip opens it).
  if ([...$('trainVillage').options].some((o) => o.value === e.detail)) $('trainVillage').value = e.detail;
  render();
});
window.addEventListener('tvh:rerender', () => { if (data) renderTicking(Date.now()); });
window.addEventListener('tvh:rerender-all', () => render());
$('addFieldsTask').addEventListener('click', () => {
  if (!buildVillageId) return;
  const targetLevel = Number($('fieldsLevel').value);
  if (!(targetLevel >= 1)) return;
  command('addTask', { villageId: buildVillageId, task: { kind: 'fields', resource: $('fieldsResource').value, targetLevel } });
});
document.getElementById('tab-build').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !buildVillageId) return;
  if (b.dataset.addSlot) {
    const slot = Number(b.dataset.addSlot);
    const input = b.parentElement.querySelector(`[data-target="${slot}"]`);
    const targetLevel = Number(input && input.value);
    if (!(targetLevel >= 1)) return;
    command('addTask', { villageId: buildVillageId, task: { kind: 'upgrade', slot, targetLevel, name: b.dataset.name } });
  } else if (b.dataset.move) {
    command('moveTask', { villageId: buildVillageId, taskId: b.dataset.task, delta: Number(b.dataset.move) });
  } else if (b.dataset.removeTask) {
    command('removeTask', { villageId: buildVillageId, taskId: b.dataset.removeTask });
  }
});

// --------------------------------------------------------------- troops ---
function unitOptions(v, gid) {
  const known = v && v.units && v.units[gid];
  if (known && known.length) return known.map((u) => [u.field, `${u.name || u.field} (${u.field})`]);
  return Array.from({ length: 10 }, (_, i) => [`t${i + 1}`, `${t('troops.unitN', { n: i + 1 })} (t${i + 1})`]);
}

function unitName(rule) {
  const v = data.villages[rule.villageId];
  const u = v && v.units && v.units[rule.gid] && v.units[rule.gid].find((x) => x.field === rule.troop);
  return u && u.name ? u.name : t('troops.unitN', { n: String(rule.troop || '').slice(1) });
}

// Troops at home and in training, per village.
function renderTroopTable(now) {
  const villages = sortedVillages(data.villages);
  const head = ['th.village', 'th.home', 'th.training', 'th.updated'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  const rows = villages.map((v) => {
    const info = troopInfo(v, now);
    const home = !info.seen ? `<span class="muted">${esc(t('ov.troopsNotSeen'))}</span>`
      : info.home.length ? info.home.map((x) => `<span class="unit-chip">${unitIcon(x.unit)} ${esc(x.name || x.unit)} <b class="mono">${x.count}</b></span>`).join('')
        : `<span class="muted">${esc(t('ov.noTroops'))}</span>`;
    const training = info.training.length
      ? info.training.map((x) => `<span class="unit-chip">${unitIcon(x.unit)} ${x.count} × ${esc(x.name || x.unit)} <small class="mono muted">${x.finishAt ? fmtDuration(x.finishAt - now) : ''}</small></span>`).join('')
      : `<span class="muted">${esc(t(info.trainingSeen ? 'ov.noTraining' : 'ov.trainingNotSeen'))}</span>`;
    return `<tr><td>${esc(v.name)}<br><small class="muted">${coords(v.x, v.y)}</small></td><td>${home}</td><td>${training}</td><td class="muted small">${esc(fmtAgo(v.troopsAt, now))}</td></tr>`;
  });
  $('troopTable').innerHTML = villages.length ? `<tr>${head}</tr>${rows.join('')}` : `<tr><td class="muted">${esc(t('build.noVillages'))}</td></tr>`;
}

function renderTroops(now) {
  fillSelect($('trainVillage'), villageOptions());
  fillSelect($('trainBuilding'), TRAINING_BUILDINGS.map((gid) => [gid, buildingName(gid)]));
  const v = data.villages[$('trainVillage').value];
  fillSelect($('trainUnit'), unitOptions(v, $('trainBuilding').value));

  const rules = data.training;
  const head = ['th.village', 'th.building', 'th.unit', 'th.amount', 'th.every', 'th.next', 'th.on'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  $('trainTable').innerHTML = rules.length
    ? `<tr>${head}<th></th></tr>` +
      rules.map((r) => {
        const village = data.villages[r.villageId];
        const next = r.nextAt && r.nextAt > now ? fmtDuration(r.nextAt - now) : automationOn(data.settings) ? t('troops.due') : t('troops.needsAuto');
        return `<tr>
          <td>${esc(village ? village.name : t('troops.gone'))}</td>
          <td>${esc(buildingName(r.gid))}</td>
          <td>${esc(unitName(r))}</td>
          <td class="mono">${r.amount}</td>
          <td class="mono">${esc(t('troops.everyMin', { n: r.everyMinutes }))}</td>
          <td class="mono">${r.enabled === false ? '—' : esc(next)}</td>
          <td><label class="switch"><input type="checkbox" data-toggle-rule="${r.id}" ${r.enabled === false ? '' : 'checked'}></label></td>
          <td class="actions"><button class="btn small danger" data-remove-rule="${r.id}" title="${esc(t('build.remove'))}">✕</button></td>
        </tr>`;
      }).join('')
    : `<tr><td class="muted">${esc(t('troops.none'))}</td></tr>`;
}

// Hospitals: wounded seen at the last look, healing in progress, next look.
function renderHeal(now) {
  const villages = sortedVillages(data.villages).filter((v) => hospitalOf(v));
  if (!villages.length) { $('healTable').innerHTML = `<tr><td class="muted">${esc(t('heal.none'))}</td></tr>`; return; }
  const head = ['th.village', 'heal.th.wounded', 'heal.th.healing', 'heal.th.checked', 'heal.th.next'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  const rows = villages.map((v) => {
    const wounded = !v.woundedAt ? `<span class="muted">${esc(t('heal.notSeen'))}</span>`
      : (v.wounded || []).length ? v.wounded.map((x) => `<span class="unit-chip">${unitIcon(x.unit)} ${esc(x.name || x.unit)} <b class="mono">${x.count ?? '?'}</b></span>`).join('')
        : `<span class="muted">${esc(t('heal.noneWounded'))}</span>`;
    const q = ((v.trainingQueue || {})[hospitalOf(v).gid] || {}).items || [];
    const healing = q.filter((x) => !x.finishAt || x.finishAt > now);
    const inCare = healing.length ? healing.map((x) => `<span class="unit-chip">${unitIcon(x.unit)} ${x.count} × ${esc(x.name || x.unit)} <small class="mono muted">${x.finishAt ? fmtDuration(x.finishAt - now) : ''}</small></span>`).join('') : '—';
    const next = !data.settings.heal.enabled ? '—' : v.healAt && v.healAt > now ? fmtDuration(v.healAt - now) : automationOn(data.settings) ? t('troops.due') : t('troops.needsAuto');
    return `<tr><td>${esc(v.name)}</td><td>${wounded}</td><td>${inCare}</td><td class="muted small">${esc(v.woundedAt ? fmtAgo(v.woundedAt, now) : '—')}</td><td class="mono">${esc(next)}</td></tr>`;
  }).join('');
  $('healTable').innerHTML = `<tr>${head}</tr>${rows}`;
}

$('trainVillage').addEventListener('change', render);
$('trainBuilding').addEventListener('change', render);
$('addTrain').addEventListener('click', () => {
  const rule = {
    villageId: $('trainVillage').value,
    gid: Number($('trainBuilding').value),
    troop: $('trainUnit').value,
    amount: Number($('trainAmount').value),
    everyMinutes: Number($('trainEvery').value),
  };
  if (!rule.villageId || !(rule.amount >= 1) || !(rule.everyMinutes >= 5)) return;
  command('addTraining', { rule });
});
$('trainTable').addEventListener('change', (e) => {
  const id = e.target.dataset.toggleRule;
  if (id) command('updateTraining', { id, patch: { enabled: e.target.checked, nextAt: 0 } });
});
$('trainTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove-rule]');
  if (b) command('removeTraining', { id: b.dataset.removeRule });
});

// ------------------------------------------ game farm lists and hero ---
function renderRaids(now) {
  fillSelect($('farmVillage'), [['', t('raids.anyVillage')], ...villageOptions()], data.settings.farm.villageId);
  const lists = data.account.farmLists || [];
  const chosen = new Set((data.settings.farm.listIds || []).map(String));
  $('farmLists').innerHTML = lists.length
    ? lists.map((l) => `<label class="switch"><input type="checkbox" data-farm-list="${esc(l.id)}" ${chosen.has(String(l.id)) ? 'checked' : ''}> <span>${esc(l.name || t('raids.listN', { id: l.id }))}</span></label>`).join('')
    : `<p class="muted small">${esc(t('raids.none'))}</p>`;

  const hero = data.account.hero || {};
  const items = [
    [t('hero.status'), hero.home == null ? '—' : t(hero.home ? 'hero.home' : 'hero.away')],
    [t('hero.adventures'), hero.adventures ?? '—'],
    [t('hero.lastSeen'), fmtAgo(data.account.updatedAt, now)],
  ];
  if (data.settings.adventure.enabled) items.push([t('hero.nextCheck'), fmtDuration(Math.max(0, (data.schedule.adventureAt || now) - now))]);
  $('heroInfo').innerHTML = items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

$('farmLists').addEventListener('change', () => {
  const ids = Array.from(document.querySelectorAll('[data-farm-list]:checked')).map((el) => el.dataset.farmList);
  const farm = { ...data.settings.farm, listIds: ids };
  data.settings = { ...data.settings, farm };
  command('saveSettings', { settings: { farm } });
});

// -------------------------------------------------------------- alerts ---
$('testAlert').addEventListener('click', async () => {
  $('testResult').textContent = t('alerts.sending');
  try {
    const r = await command('testAlert');
    if (!r.sent) $('testResult').textContent = r.desktop === false ? t('alerts.testNothing') : t('alerts.testDesktopOnly');
    else if (r.failed.length) $('testResult').textContent = t('alerts.testFailed', { list: r.failed.join(t('list.sep')) });
    else $('testResult').textContent = t('alerts.testSent', { n: r.sent });
  } catch (e) {
    $('testResult').textContent = e.message;
  }
});

$('tgSummaryNow').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    await command('sendSummary');
    $('tgSummaryMsg').textContent = t('tg.summarySent');
  } catch (err) {
    $('tgSummaryMsg').textContent = err.message;
  } finally {
    setTimeout(() => { e.target.disabled = false; }, 3000);
  }
});

// ------------------------------------------------------------ settings ---
$('resetData').addEventListener('click', () => {
  if (confirm(t('settings.resetConfirm'))) command('resetData');
});

// --------------------------------------------------------- save & sync ---
function renderSync(now) {
  const state = data.syncState || {};
  const lease = data.lease;
  const mine = data.device && lease && lease.deviceId === data.device.id;
  $('syncDevice').textContent = data.device ? data.device.name : '—';
  $('syncSaved').textContent = state.error ? t('sync.error', { e: state.error })
    : state.savedAt ? fmtAgo(state.savedAt, now) : t('sync.never');
  $('syncSaved').className = state.error ? 'bad' : '';
  const otherActive = leaseIsFresh(lease, now) && !mine;
  $('syncRunsOn').textContent = otherActive ? t('sync.other', { name: lease.deviceName, ago: fmtAgo(lease.at, now) })
    : mine && leaseIsFresh(lease, now) ? t('sync.here') : t('sync.nobody');
  $('takeOver').hidden = !otherActive;
}

// Web app link: its state, and a check-in right after the address or key changes.
function renderWeb(now) {
  const w = data.health.web;
  const set = data.settings.web || {};
  const el = $('webStatus');
  if (!set.url && !set.key) { el.textContent = t('web.notSet'); el.className = 'small muted'; return; }
  if (!webBase(set.url)) { el.textContent = t('web.badUrl'); el.className = 'small bad'; return; }
  if (el.dataset.busy) return;
  el.textContent = !w ? t('web.never') : w.ok ? t('web.ok', { ago: fmtAgo(w.okAt, now) }) : t('web.failing', { e: w.err || '?', ago: fmtAgo(w.at, now) });
  el.className = `small ${w && w.ok ? 'good-text' : w ? 'bad' : 'muted'}`;
}
async function webNow() {
  const el = $('webStatus');
  if (!webBase(data.settings.web.url) || !data.settings.web.key) return renderWeb(Date.now());
  el.dataset.busy = '1';
  el.textContent = t('web.checking');
  try { await command('webSyncNow'); } catch (e) { /* shown by renderWeb */ }
  delete el.dataset.busy;
  renderWeb(Date.now());
}
$('webSyncNow').addEventListener('click', webNow);
for (const el of document.querySelectorAll('[data-setting^="web."]')) el.addEventListener('change', () => setTimeout(webNow, 300));

$('takeOver').addEventListener('click', () => command('takeOver'));
$('syncNow').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { await command('syncNow'); } finally { setTimeout(() => { e.target.disabled = false; }, 1500); }
});

$('exportData').addEventListener('click', async () => {
  const backup = await command('exportData');
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `travian-helper-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('importData').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!confirm(t('sync.importConfirm'))) return;
    const r = await command('importData', { data: parsed });
    $('backupResult').textContent = t('sync.imported', { tasks: r.tasks, training: r.training });
    $('backupResult').className = 'small good-text';
  } catch (err) {
    $('backupResult').textContent = t('sync.importFailed', { e: err.message });
    $('backupResult').className = 'small bad';
  }
});

// ------------------------------------------------------------------ log ---
function renderLog() {
  const names = Object.fromEntries(Object.values(data.villages).map((v) => [v.id, v.name]));
  $('logList').innerHTML = data.log.length
    ? data.log.map((e) => `<li>
        <span class="muted mono">${new Date(e.t).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <span class="lvl ${esc(e.level)}">${esc(t(`level.${e.level}`))}</span>
        <span>${e.villageId && names[e.villageId] ? `<b>${esc(names[e.villageId])}:</b> ` : ''}${esc(e.msg)}</span>
      </li>`).join('')
    : `<li class="muted">${esc(t('log.empty'))}</li>`;
}
$('clearLog').addEventListener('click', () => command('clearLog'));
$('themeBtn').addEventListener('click', () => command('saveSettings', { settings: { theme: nextTheme(data.settings.theme || 'system') } }));

// --------------------------------------------------------------- render ---
$('checkNow').addEventListener('click', async (e) => {
  e.target.disabled = true;
  await command('runNow');
  setTimeout(() => { e.target.disabled = false; }, 3000);
});

// One panel that fails (odd data from the game, a rule from an old
// version) mustn't stop the others, the settings and the log from showing.
function safely(name, fn) {
  try { fn(); } catch (e) { console.error(`render ${name}:`, e); }
}

function renderTicking(now) {
  const st = statusLine(data, now);
  $('status').className = `status ${st.tone}`;
  $('status').textContent = st.text;
  safely('overview', () => renderOverview(data, now));
  safely('buildWhy', () => renderBuildWhy(now));
  safely('sync', () => renderSync(now));
  safely('web', () => renderWeb(now));
  safely('troopTable', () => renderTroopTable(now));
  safely('heal', () => renderHeal(now));
  safely('health', () => renderHealth(data, now));
  safely('culture', () => renderCulture(data, now));
}

function render() {
  if (!data) return;
  const now = Date.now();
  const langChanged = lang !== data.settings.language;
  if (langChanged) {
    lang = data.settings.language;
    applyI18n();
    document.title = t('app.name');
    fillSelect($('language'), LANGUAGES);
    fillSelect($('themeSelect'), THEMES.map((x) => [x, t(`theme.${x}`)]));
    fillSelect($('tgSummaryHour'), [[-1, t('tg.summaryOff')], ...Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`])]);
    revealActive();
  }
  document.body.classList.toggle('simple', !!data.settings.simpleMode);
  $('server').textContent = data.settings.server ? new URL(data.settings.server).host : t('server.none');
  $('version').textContent = t('app.version', { v: chrome.runtime.getManifest().version });
  const theme = data.settings.theme || 'system';
  $('themeBtn').textContent = themeIcon(theme);
  $('themeBtn').title = t('theme.button', { name: t(`theme.${theme}`) });
  $('themeBtn').setAttribute('aria-label', $('themeBtn').title);
  $('serverFull').textContent = data.settings.server || t('settings.notDetected');
  renderTicking(now);
  safely('build', () => renderBuild(now, langChanged));
  safely('troops', () => renderTroops(now));
  safely('autopilot', () => renderAutopilot(data, now));
  safely('farms', () => renderFarms(data, now));
  safely('finder', () => renderFinder(data, now));
  safely('escapes', () => renderEscapes(data, now));
  safely('brain', () => renderBrain(data, now));
  safely('raids', () => renderRaids(now));
  safely('log', () => renderLog());
  fillSettings();
}

async function reload() {
  data = await loadAll();
  render();
}

chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' || area === 'sync') reload(); });
setInterval(() => { if (data) renderTicking(Date.now()); }, 1000);
showTab();
reload();
