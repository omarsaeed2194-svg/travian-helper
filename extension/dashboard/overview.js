// The Overview dashboard: a village filter, headline numbers, tips worked
// out from the village's state, resources, a 24-hour chart, field levels,
// and side panels for what's coming up, construction, movements and activity.
import { command, esc, troopInfo } from '../src/ui.js';
import {
  RESOURCES, FIELD_RESOURCE, resLabel, sortedVillages, estimateStock, hoursUntilLimit, capacityFor, buildStatus,
  buildingName, taskLabel, fmtDuration, fmtAgo, fmtNum, fmtClock, earliestQueueFinish,
} from '../src/shared.js';
import { t, coords, ltr, dateLocale } from '../src/i18n.js';
import { leaseIsFresh } from '../src/sync.js';
import { adviseAll } from '../src/advisor.js';
import { renderStockChart } from './chart.js';
import { villageArt, heroArt } from './art.js';
import { wallOf } from '../src/advisor.js';
import { pickAutoUpgrade } from '../src/autopilot.js';
import { expansionPlan } from '../src/expansion.js';
import { unitIcon, tribeBase } from '../src/units.js';
import { timelineEvents, laneOf, moveLabel } from '../src/timeline.js';
import { minimapSvg } from './minimap.js';
import { balancePlan } from '../src/merchants.js';

const $ = (id) => document.getElementById(id);
const ALL = 'all';
const TIP_LIMIT = 8;
const KEY_BUILDINGS = [15, 10, 11, 23, 16, 17, 19, 20, 25, 26];
const WALLS = [31, 32, 33, 42, 43, 47];
const ICONS = { attack: '⚔', shield: '🛡', crop: '🌾', storage: '📦', build: '🏗', balance: '⚖', bonus: '⭐', clock: '🕒', alert: '🔔', hero: '🧭', farm: '🐎' };

let filter = (() => { try { return localStorage.getItem('tvh.ovFilter') || ALL; } catch (e) { return ALL; } })();
let showAllTips = false;
let chartKey = '';
let lastTips = [];
let forceTips = false;
let pressing = null; // #ovRes / #ovTroops while a button in it is held down

function setFilter(value) {
  filter = value;
  try { localStorage.setItem('tvh.ovFilter', value); } catch (e) { /* private mode */ }
}

// ---------------------------------------------------------------- filter ---
function renderFilter(villages, data) {
  const bar = $('ovFilterBar');
  bar.hidden = villages.length < 2;
  const options = [[ALL, t('ov.allVillages'), false], ...villages.map((v) => [v.id, v.name, v.underAttack])];
  const sig = JSON.stringify([options, filter]);
  if ($('ovFilter').dataset.sig !== sig) {
    $('ovFilter').innerHTML = options.map(([id, name, attacked]) => `<button type="button" class="chip-btn${id === filter ? ' on' : ''}" data-filter="${esc(id)}" aria-pressed="${id === filter}">${attacked ? '<span class="dot-bad" aria-hidden="true"></span>' : ''}${esc(name)}</button>`).join('');
    $('ovFilter').dataset.sig = sig;
  }
  const hero = data.account.hero || {};
  const lease = data.lease;
  const other = leaseIsFresh(lease) && data.device && lease.deviceId !== data.device.id;
  const st = data.settings;
  const auto = !st.botEnabled && !st.autopilot.enabled && !st.watchEnabled ? t('ov.autoOff')
    : other ? t('ov.autoOther', { name: lease.deviceName })
      : st.autopilot.enabled ? t('ov.autopilotHere') : st.botEnabled ? t('ov.autoHere') : t('ov.watchHere');
  $('ovAccount').innerHTML = [
    [t('ov.gold'), fmtNum(data.account.gold)],
    [t('ov.silver'), fmtNum(data.account.silver)],
    [t('ov.adventuresShort'), hero.adventures ?? '—'],
    [t('ov.automation'), auto],
  ].map(([k, v]) => `<span><small>${esc(k)}</small> <b>${esc(v)}</b></span>`).join('');
}

// ------------------------------------------------------------------ KPIs ---
function renderKpis(scope, data, now) {
  let stock = 0, cap = 0, prod = 0, crop = 0, attacks = 0, busy = 0, hasRes = false;
  let first = null, firstAttack = null, nextFree = null;
  const idleNames = [], attackedNames = [];
  const multi = scope.length > 1;
  for (const v of scope) {
    const est = estimateStock(v, now);
    const p = v.resources && v.resources.production;
    if (est) {
      hasRes = true;
      stock += RESOURCES.reduce((n, k) => n + est[k], 0);
      cap += RESOURCES.reduce((n, k) => n + (capacityFor(v.resources, k) || 0), 0);
    }
    if (p) {
      prod += (p.wood || 0) + (p.clay || 0) + (p.iron || 0) + Math.max(0, p.crop || 0);
      crop += p.crop || 0;
      for (const k of RESOURCES) {
        if (!(p[k] > 0)) continue;
        const h = hoursUntilLimit(v, k, now);
        if (h != null && (!first || h < first.h)) first = { h, k, v };
      }
    }
    if (v.underAttack) {
      attacks += Math.max(1, v.incomingAttacks || 0);
      attackedNames.push(v.name);
      for (const m of v.movements || []) {
        if (m.kind === 'att1' && m.arriveAt > now && (!firstAttack || m.arriveAt < firstAttack)) firstAttack = m.arriveAt;
      }
    }
    const active = (v.buildQueue || []).filter((b) => !b.finishAt || b.finishAt > now).length;
    busy += active;
    if (v.buildQueue && !active) idleNames.push(v.name);
    const free = earliestQueueFinish(v, now);
    if (free && (!nextFree || free < nextFree)) nextFree = free;
  }
  const idle = idleNames.length;
  // Every tile gets a sub line so the cards in a row line up.
  const tiles = [
    { label: t('ov.stockTotal'), value: hasRes ? fmtNum(stock) : '—', sub: cap ? t('ov.ofCapacity', { pct: Math.round((stock / cap) * 100) }) : '' },
    { label: t('ov.prodHour'), value: hasRes ? ltr(`+${fmtNum(prod)}`) : '—', sub: hasRes ? t('ov.perDay', { n: fmtNum(prod * 24) }) : '' },
    { label: t('ov.netCrop'), value: hasRes ? ltr(`${crop >= 0 ? '+' : ''}${fmtNum(crop)}`) : '—', sub: hasRes ? t('ov.afterUpkeep') : '', sev: crop < 0 ? 'critical' : '' },
    {
      label: t('ov.fillsFirst'),
      value: first ? (first.h <= 0 ? t('card.full') : fmtDuration(first.h * 3600000)) : '—',
      text: !!first && first.h <= 0,
      sub: first ? (multi ? `${resLabel(first.k)} · ${first.v.name}` : resLabel(first.k)) : '',
      sev: first && first.h <= 0.5 ? 'critical' : first && first.h <= 2 ? 'warning' : '',
    },
    {
      label: t('ov.incoming'),
      value: String(attacks),
      sub: !attacks ? t('ov.noAttacks') : firstAttack ? t('ov.firstIn', { t: fmtDuration(firstAttack - now) }) : multi ? attackedNames.join(' · ') : '',
      sev: attacks ? 'critical' : '',
      icon: attacks ? '⚔' : '',
    },
    {
      label: t('ov.builders'),
      value: idle ? t('ov.buildersIdle') : busy ? t('ov.buildersBusy', { n: busy }) : '—',
      sub: idle ? (multi ? idleNames.join(' · ') : t('ov.nothingBuilding')) : nextFree ? t('ov.freeAt', { clock: fmtClock(nextFree) }) : '',
      sev: idle ? 'warning' : '',
      text: true,
    },
  ];
  $('summary').innerHTML = tiles.map((x) => `<div class="kpi ${x.sev || ''}">
      <span class="kpi-label">${x.icon ? `<span aria-hidden="true">${x.icon}</span> ` : ''}${esc(x.label)}</span>
      <span class="kpi-body">
        <b class="kpi-value${x.text ? ' text' : ''}">${esc(x.value)}</b>
        <span class="kpi-sub" title="${esc(x.sub)}">${esc(x.sub)}</span>
      </span>
    </div>`).join('');
}

// ------------------------------------------------------------------ tips ---
const SEV_LABEL = { critical: 'sev.critical', warning: 'sev.warning', info: 'sev.info', good: 'sev.good' };

function renderTips(scope, data, now) {
  if (!forceTips && $('ovTips').matches(':hover')) return; // don't move buttons under the pointer
  forceTips = false;
  const tips = adviseAll(data, scope.map((v) => v.id), now);
  lastTips = tips;
  const multi = scope.length > 1;
  const counts = tips.reduce((c, x) => ({ ...c, [x.sev]: (c[x.sev] || 0) + 1 }), {});
  $('ovTipsMeta').textContent = ['critical', 'warning', 'info'].filter((k) => counts[k]).map((k) => `${counts[k]} ${t(SEV_LABEL[k])}`).join(' · ');
  if (!tips.length) {
    $('ovTips').innerHTML = `<li class="tip good"><span class="sev-badge good"><span aria-hidden="true">✓</span> ${esc(t('sev.good'))}</span><span class="tip-text">${esc(t('tip.allGood'))}</span></li>`;
    $('ovTipsMore').hidden = true;
    return;
  }
  const shown = showAllTips ? tips : tips.slice(0, TIP_LIMIT);
  $('ovTips').innerHTML = shown.map((tip, i) => {
    const village = multi && tip.villageId ? `<b>${esc(data.villages[tip.villageId].name)}:</b> ` : '';
    return `<li class="tip ${tip.sev}">
      <span class="sev-badge ${tip.sev}"><span aria-hidden="true">${ICONS[tip.icon] || '•'}</span> ${esc(t(SEV_LABEL[tip.sev]))}</span>
      <span class="tip-text">${village}${esc(tip.text)}</span>
      ${tip.action ? `<button type="button" class="btn small" data-tip="${i}">${esc(tip.action.label)}</button>` : ''}
    </li>`;
  }).join('');
  $('ovTipsMore').hidden = tips.length <= TIP_LIMIT;
  $('ovTipsMore').textContent = showAllTips ? t('ov.tipsLess') : t('ov.tipsMore', { n: tips.length - TIP_LIMIT });
}

async function runTipAction(tip) {
  const a = tip.action;
  if (a.type === 'addTask') await command('addTask', { villageId: a.villageId, task: a.task });
  else if (a.type === 'addFields') await command('addTask', { villageId: a.villageId, task: { kind: 'fields', resource: a.resource, targetLevel: a.targetLevel } });
  else if (a.type === 'setting') await command('saveSettings', { settings: a.patch });
  else if (a.type === 'open') { chrome.tabs.create({ url: a.url }); return; }
  else if (a.type === 'tab') {
    if (a.villageId) window.dispatchEvent(new CustomEvent('tvh:select-village', { detail: a.villageId }));
    location.hash = `#${a.tab}`;
    return;
  }
  forceTips = true;
  toast(t('ov.done'));
}

function toast(text) {
  const el = $('ovToast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2500);
}

// ------------------------------------------------------------- resources ---
function renderResources(scope, data, now) {
  if (scope.length !== 1) {
    $('ovResTitle').textContent = t('ov.villagesTitle');
    renderTable(scope, data, now);
    return;
  }
  const v = scope[0];
  $('ovResTitle').textContent = t('ov.resourcesTitle');
  const est = estimateStock(v, now);
  if (!est) { $('ovRes').innerHTML = `<p class="muted">${esc(t('card.noData'))}</p>`; return; }
  const prod = v.resources.production || {};
  $('ovRes').innerHTML = `<div class="meters">${RESOURCES.map((k) => {
    const cap = capacityFor(v.resources, k) || 1;
    const pct = Math.min(100, (est[k] / cap) * 100);
    const sev = pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : '';
    const hrs = hoursUntilLimit(v, k, now);
    const p = prod[k];
    const when = p > 0 && hrs != null ? (hrs <= 0 ? t('card.full') : t('card.fullIn', { t: fmtDuration(hrs * 3600000) }))
      : p < 0 && hrs != null ? t('card.emptyIn', { t: fmtDuration(hrs * 3600000) }) : '';
    return `<div class="meter-row ${sev}">
      <span class="meter-name">${esc(resLabel(k))}</span>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${Math.round(est[k])}" aria-label="${esc(resLabel(k))}"><i style="inline-size:${pct.toFixed(1)}%"></i></div>
      <span class="meter-val" dir="ltr">${fmtNum(est[k])} <small>/ ${fmtNum(cap)}</small></span>
      <span class="meter-rate" dir="ltr">${p != null ? `${p >= 0 ? '+' : ''}${fmtNum(p)}` : ''}</span>
      <span class="meter-when ${sev || (p < 0 ? 'critical' : '')}">${esc(when)}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderTable(villages, data, now) {
  const head = [t('th.village'), ...RESOURCES.map(resLabel), t('th.netCrop'), t('th.firstFull'), t('th.buildingNow'), t('th.status')];
  const rows = villages.map((v) => {
    const est = estimateStock(v, now);
    const prod = v.resources && v.resources.production;
    const cells = RESOURCES.map((k) => {
      if (!est) return '<td class="muted">—</td>';
      const pct = est[k] / (capacityFor(v.resources, k) || 1);
      const sev = pct >= 0.95 ? 'critical' : pct >= 0.8 ? 'warning' : '';
      return `<td class="num"><span dir="ltr">${fmtNum(est[k])}</span><span class="cell-bar ${sev}"><i style="inline-size:${Math.min(100, pct * 100).toFixed(0)}%"></i></span></td>`;
    });
    const crop = prod ? prod.crop : null;
    let first = null;
    for (const k of RESOURCES) {
      const h = prod && prod[k] > 0 ? hoursUntilLimit(v, k, now) : null;
      if (h != null && (!first || h < first.h)) first = { k, h };
    }
    const active = (v.buildQueue || []).filter((b) => !b.finishAt || b.finishAt > now);
    const why = buildStatus(v, data, now);
    return `<tr class="${v.underAttack ? 'attacked' : ''}" data-village="${esc(v.id)}">
      <td><button type="button" class="link" data-filter="${esc(v.id)}">${v.underAttack ? '⚔ ' : ''}${esc(v.name)}</button><br><small class="muted">${coords(v.x, v.y)}</small></td>
      ${cells.join('')}
      <td class="num ${crop < 0 ? 'neg' : ''}"><span dir="ltr">${crop == null ? '—' : `${crop >= 0 ? '+' : ''}${fmtNum(crop)}`}</span></td>
      <td>${first ? `${esc(resLabel(first.k))} <small class="mono">${first.h <= 0 ? esc(t('card.full')) : fmtDuration(first.h * 3600000)}</small>` : '<span class="muted">—</span>'}</td>
      <td>${active.length ? active.map((b) => `${esc(b.name)} <small class="mono muted">${b.finishAt ? fmtDuration(b.finishAt - now) : ''}</small>`).join('<br>') : `<span class="muted">${esc(v.buildQueue ? t('card.idle') : '—')}</span>`}</td>
      <td>${why ? `<small>${esc(why.text)}</small>` : '<span class="muted">—</span>'}</td>
    </tr>`;
  });
  if (pressing !== 'ovRes') $('ovRes').innerHTML = `<div class="table-wrap"><table class="list ov-table"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table></div>`;
}

// ------------------------------------------------------------------ chart ---
function renderChart(scope, data) {
  const single = scope.length === 1;
  $('ovChartPanel').hidden = !single;
  if (!single) { chartKey = ''; return; }
  const points = (data.history || {})[scope[0].id] || [];
  const key = `${scope[0].id}|${points.length}|${points.length ? points[points.length - 1].t : 0}|${$('ovChart').clientWidth}|${data.settings.language}`;
  if (key === chartKey) return;
  chartKey = key;
  renderStockChart($('ovChart'), points);
}

// ----------------------------------------------------------- field levels ---
function renderFields(scope) {
  const single = scope.length === 1;
  $('ovFieldsPanel').hidden = !single;
  if (!single) return;
  const v = scope[0];
  if (!v.fields) { $('ovFields').innerHTML = `<p class="muted">${esc(t('build.notScannedFields'))}</p>`; return; }
  const rows = RESOURCES.map((k) => {
    const fields = v.fields.filter((f) => FIELD_RESOURCE[f.gid] === k).sort((a, b) => b.level - a.level);
    const avg = fields.length ? fields.reduce((n, f) => n + f.level, 0) / fields.length : 0;
    return `<div class="lv-row">
      <span class="lv-name">${esc(resLabel(k))}</span>
      <span class="lv-cells">${fields.map((f) => `<span class="lv lv${Math.min(10, f.level)}${f.underConstruction ? ' busy' : ''}" title="${esc(buildingName(f.gid))} · ${esc(t('card.level', { n: f.level }))}">${f.level}</span>`).join('')}</span>
      <span class="lv-avg">${esc(t('ov.avgLevel', { n: avg.toFixed(1) }))}</span>
    </div>`;
  }).join('');
  // The wall is whatever stands in slot 40 (its name and type differ by tribe).
  const order = (b) => (b.slot === 40 ? 0.5 : KEY_BUILDINGS.indexOf(b.gid));
  const key = (v.buildings || []).filter((b) => b.gid && (KEY_BUILDINGS.includes(b.gid) || b.slot === 40 || WALLS.includes(b.gid)))
    .sort((a, b) => order(a) - order(b));
  const buildings = v.buildings
    ? `<ul class="key-buildings">${key.map((b) => `<li><span>${esc(buildingName(b.gid, b.name))}</span><b class="mono">${b.level}</b></li>`).join('') || `<li class="muted">—</li>`}</ul>`
    : `<p class="muted small">${esc(t('build.notScannedBuildings'))}</p>`;
  $('ovFields').innerHTML = `<div class="fields-grid"><div>${rows}<p class="muted small lv-legend">${esc(t('ov.levelLegend'))}</p></div><div><h3>${esc(t('ov.keyBuildings'))}</h3>${buildings}</div></div>`;
}

// ------------------------------------------------------------- side panels ---
function renderNext(scope, data, now) {
  const s = data.settings;
  const sched = data.schedule;
  const ids = new Set(scope.map((v) => v.id));
  const rows = [];
  const left = (at) => (at && at > now ? fmtDuration(at - now) : t('ov.now'));
  const ap = s.autopilot;
  const on = s.botEnabled || ap.enabled;
  if (s.watchEnabled || on) rows.push([t('ov.nextCheck'), left(sched.refreshAt)]);
  const plan = s.expansion.enabled ? expansionPlan(data, now) : null;
  for (const v of scope) {
    const list = data.tasks[v.id] || [];
    const pick = !list.length && ap.enabled && ap.build ? pickAutoUpgrade(v, s, now, tribeBase(data.villages), plan) : null;
    if (!list.length && !pick) continue;
    const why = buildStatus(v, data, now);
    const what = list.length ? taskLabel(list[0], v) : pick.saving ? t('ap.planSaving', { kind: t(`culture.kind.${pick.kind}`) }) : pick.construct ? t('ov.autoConstruct', { name: buildingName(pick.gid) }) : t('ov.autoPick', { name: buildingName(pick.gid), n: pick.level + 1 });
    rows.push([scope.length > 1 ? t('ov.nextBuild', { v: v.name }) : t('ov.nextBuildOne'), `${what}${why ? ` — ${why.text}` : ''}`]);
  }
  const raids = data.raids.filter((r) => r.enabled !== false && ids.has(r.villageId));
  if (raids.length && on) {
    const r = raids.slice().sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0))[0];
    rows.push([t('ov.nextRaid'), t('ov.raidIn', { v: data.villages[r.villageId].name, t: left(r.nextAt) })]);
  }
  const rules = data.training.filter((r) => r.enabled !== false && ids.has(r.villageId));
  if (rules.length && on) {
    const r = rules.slice().sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0))[0];
    const v = data.villages[r.villageId];
    const unit = (v.units && v.units[r.gid] && (v.units[r.gid].find((u) => u.field === r.troop) || {}).name) || t('troops.unitN', { n: String(r.troop || '').slice(1) });
    rows.push([t('ov.nextTrain'), t('ov.trainIn', { u: `${r.amount} × ${unit}`, v: v.name, t: left(r.nextAt) })]);
  }
  const lists = (data.farms || []).filter((l) => l.enabled !== false && ids.has(l.villageId) && (l.targets || []).some((x) => x.enabled !== false));
  if (lists.length && on) {
    const l = lists.slice().sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0))[0];
    rows.push([t('ov.nextFarmList'), t('ov.farmListIn', { list: l.name, t: left(l.nextAt) })]);
  }
  if (on && (s.farm.enabled || (ap.enabled && ap.farmLists))) rows.push([t('ov.nextFarm'), left(sched.farmAt)]);
  if (on && (s.adventure.enabled || (ap.enabled && ap.adventures))) rows.push([t('ov.nextAdventure'), left(sched.adventureAt)]);
  $('ovNext').innerHTML = rows.length
    ? rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
    : `<dd class="muted">${esc(t('ov.nothingPlanned'))}</dd>`;
}

function renderQueues(scope, now) {
  const rows = [];
  for (const v of scope) for (const b of v.buildQueue || []) if (!b.finishAt || b.finishAt > now) rows.push({ v, b });
  rows.sort((a, b) => (a.b.finishAt || Infinity) - (b.b.finishAt || Infinity));
  $('ovQueues').innerHTML = rows.length
    ? rows.map(({ v, b }) => `<li><span>${scope.length > 1 ? `<small class="muted">${esc(v.name)}</small><br>` : ''}${esc(b.name)} <small class="muted">${b.level != null ? esc(t('card.level', { n: b.level })) : ''}</small></span>
        <span class="feed-time"><b class="mono">${b.finishAt ? fmtDuration(b.finishAt - now) : '—'}</b><small class="muted">${b.finishAt ? fmtClock(b.finishAt) : ''}</small></span></li>`).join('')
    : `<li class="muted">${esc(t('ov.noQueues'))}</li>`;
}

// Troops at home and in training. One village: the unit lists; several:
// a line per village.
function renderTroops(scope, now) {
  const infos = scope.map((v) => ({ v, info: troopInfo(v, now) }));
  const total = infos.reduce((n, x) => n + x.info.total, 0);
  const training = infos.reduce((n, x) => n + x.info.trainingTotal, 0);
  $('ovTroopsMeta').textContent = infos.some((x) => x.info.seen) ? t('ov.troopsSummary', { n: fmtNum(total), m: fmtNum(training) }) : '';
  if (scope.length > 1) {
    if (pressing === 'ovTroops') return;
    $('ovTroops').innerHTML = `<ul class="feed">${infos.map(({ v, info }) => `<li>
        <span><button type="button" class="link" data-filter="${esc(v.id)}">${esc(v.name)}</button><br><small class="muted">${esc(info.seen
          ? info.home.filter((x) => x.unit !== 'hero').slice().sort((a, b) => b.count - a.count).slice(0, 3).map((x) => `${x.count} ${x.name}`).join(' · ') || t('ov.noTroops')
          : t('ov.troopsNotSeen'))}</small></span>
        <span class="feed-time"><b class="mono">${info.seen ? fmtNum(info.total) : '—'}</b>${info.trainingTotal ? `<small class="muted">${esc(t('card.inTraining', { n: fmtNum(info.trainingTotal) }))}</small>` : ''}</span>
      </li>`).join('')}</ul>`;
    return;
  }
  const { info } = infos[0];
  const home = !info.seen ? `<p class="muted small">${esc(t('ov.troopsNotSeen'))}</p>`
    : info.home.length ? `<ul class="unit-list">${info.home.map((x) => `<li><span>${unitIcon(x.unit)} ${esc(x.name || x.unit)}</span><b class="mono">${fmtNum(x.count)}</b></li>`).join('')}</ul>`
      : `<p class="muted small">${esc(t('ov.noTroops'))}</p>`;
  const queue = info.training.length
    ? `<ul class="feed">${info.training.map((x) => `<li><span>${unitIcon(x.unit)} ${x.count} × ${esc(x.name || x.unit)} <small class="muted">· ${esc(buildingName(x.gid))}</small></span>
        <span class="feed-time"><b class="mono">${x.finishAt ? fmtDuration(x.finishAt - now) : '—'}</b><small class="muted">${x.finishAt ? esc(t('ov.doneAt', { clock: fmtClock(x.finishAt) })) : ''}</small></span></li>`).join('')}</ul>`
    : `<p class="muted small">${esc(t(info.trainingSeen ? 'ov.noTraining' : 'ov.trainingNotSeen'))}</p>`;
  $('ovTroops').innerHTML = `<h3>${esc(t('ov.troopsHome'))}</h3>${home}<h3>${esc(t('ov.troopsTraining'))}</h3>${queue}`;
}

function renderMoves(scope, now) {
  const rows = [];
  for (const v of scope) for (const m of v.movements || []) if (m.arriveAt && m.arriveAt > now) rows.push({ v, m });
  rows.sort((a, b) => a.m.arriveAt - b.m.arriveAt);
  $('ovMoves').innerHTML = rows.length
    ? rows.map(({ v, m }) => `<li class="${m.kind === 'att1' ? 'bad' : ''}"><span>${m.kind === 'att1' ? '⚔ ' : ''}${esc(moveLabel(m.kind))} <small class="muted">× ${m.count || 1}${scope.length > 1 ? ` · ${esc(v.name)}` : ''}</small></span>
        <span class="feed-time"><b class="mono">${fmtDuration(m.arriveAt - now)}</b><small class="muted">${fmtClock(m.arriveAt)}</small></span></li>`).join('')
    : `<li class="muted">${esc(t('ov.noMoves'))}</li>`;
}

function renderActivity(scope, data, now) {
  const ids = new Set(scope.map((v) => v.id));
  const single = scope.length === 1;
  const names = Object.fromEntries(Object.values(data.villages).map((v) => [v.id, v.name]));
  const entries = data.log.filter((e) => (single ? ids.has(e.villageId) : true)).slice(0, 8);
  $('ovActivity').innerHTML = entries.length
    ? entries.map((e) => `<li class="lvl-${esc(e.level)}">
        <span>${!single && e.villageId && names[e.villageId] ? `<b>${esc(names[e.villageId])}:</b> ` : ''}${esc(e.msg)}</span>
        <span class="feed-time"><small class="muted">${esc(fmtAgo(e.t, now))}</small></span>
      </li>`).join('')
    : `<li class="muted">${esc(t('log.empty'))}</li>`;
}

// -------------------------------------------------------------- timeline ---
const TL_HOURS = 6;
const hourLabel = (ts) => new Date(ts).toLocaleTimeString(dateLocale(), { hour: 'numeric' });

// The next six hours on one line, then the first few events as a list.
function renderTimeline(scope, data, now) {
  const span = TL_HOURS * 3600000;
  const events = timelineEvents(scope, data, now, TL_HOURS);
  const multi = scope.length > 1;
  $('ovTimelineMeta').textContent = events.length ? t('tl.count', { n: events.length }) : '';
  // Markers move slowly: redraw them every 20 s or when the events change.
  const sig = JSON.stringify([events.map((e) => [e.at, e.kind, e.text, e.v]), Math.floor(now / 20000), langNow, multi]);
  if (artCache.timeline !== sig) {
    artCache.timeline = sig;
    const placed = laneOf(events, now, span);
    const lanes = Math.max(1, ...placed.map((e) => e.lane + 1));
    // "Now", then every whole hour.
    const hours = [];
    for (let at = Math.ceil(now / 3600000) * 3600000; at <= now + span; at += 3600000) hours.push(at);
    const tick = (x, label, cls = '') => `<span class="tl-tick${cls}" style="inset-inline-start:${(x * 100).toFixed(2)}%"><small>${esc(label)}</small></span>`;
    const ticks = tick(0, t('tl.now'), ' now') + hours.map((at) => tick((at - now) / span, (at - now) / span < 0.06 ? '' : hourLabel(at))).join('');
    const marks = placed.map((e) => `<span class="tl-mark k-${e.kind}" style="inset-inline-start:${(e.x * 100).toFixed(2)}%;top:${e.lane * 26}px" title="${esc(`${fmtClock(e.at)} · ${e.text}${multi ? ` · ${e.vName}` : ''}`)}">${e.icon}</span>`).join('');
    $('ovTimeline').innerHTML = `<div class="tl-track" style="height:${lanes * 26 + 4}px">${marks}</div><div class="tl-axis">${ticks}</div>`;
  }
  const list = events.slice(0, 6);
  $('ovTimelineList').innerHTML = list.length
    ? list.map((e) => `<li class="k-${e.kind}"><span>${e.icon} ${esc(e.text)}${multi && e.vName ? ` <small class="muted">· ${esc(e.vName)}</small>` : ''}</span>
        <span class="feed-time"><b class="mono">${fmtDuration(e.at - now)}</b><small class="muted">${fmtClock(e.at)}</small></span></li>`).join('')
    : `<li class="muted">${esc(t('tl.empty', { n: TL_HOURS }))}</li>`;
}

// ---------------------------------------------------------------- balance ---
// Villages with a resource piling up that another village lacks.
function renderBalance(scope, data, now) {
  const all = Object.keys(data.villages).length;
  $('ovBalancePanel').hidden = all < 2;
  if (all < 2) return;
  const ids = new Set(scope.map((v) => v.id));
  const plan = balancePlan(data.villages, now).filter((p) => ids.has(p.from) || ids.has(p.to));
  $('ovBalanceMeta').textContent = plan.length ? '' : t('bal.ok');
  const name = (id) => (data.villages[id] || {}).name || '—';
  const server = data.settings.server;
  const html = plan.length ? plan.map((p) => `<li><span><b>${esc(name(p.from))}</b> → <b>${esc(name(p.to))}</b>
      <br>${RESOURCES.filter((k) => p.amounts[k]).map((k) => `<span class="unit-chip">${esc(resLabel(k))} <b class="mono">${fmtNum(p.amounts[k])}</b></span>`).join('')}</span>
      <span class="feed-time">${p.market && server
        ? `<button type="button" class="btn small" data-open="${esc(`${server}/build.php?newdid=${encodeURIComponent(p.from)}&gid=17&t=5`)}">${esc(t('bal.open'))}</button>`
        : `<small class="muted">${esc(t('bal.noMarket'))}</small>`}</span></li>`).join('')
    : `<li class="muted">${esc(t('bal.none'))}</li>`;
  if ($('ovBalance').dataset.html !== html) { $('ovBalance').dataset.html = html; $('ovBalance').innerHTML = html; }
}

// --------------------------------------------------------------- mini map ---
function renderMinimap(scope, data) {
  const ids = new Set(scope.map((v) => v.id));
  const sig = JSON.stringify([Object.values(data.villages).map((v) => [v.id, v.name, v.x, v.y, v.underAttack]), [...ids], data.farms, data.raids.map((r) => r.targets), data.escapes,
    Object.keys(data.oases || {}).length, langNow]);
  if (artCache.map === sig) return;
  artCache.map = sig;
  $('ovMap').innerHTML = minimapSvg(data, ids) || `<p class="muted small">${esc(t('mm.empty'))}</p>`;
}

// ----------------------------------------------------------- illustrations ---
// Pictures only redraw when what they show changes.
const artCache = {};
function artSig(v, now) {
  const active = (v.buildQueue || []).some((b) => !b.finishAt || b.finishAt > now);
  const w = wallOf(v);
  return JSON.stringify([v.name, v.underAttack, active, w && w.level, (v.buildings || []).map((b) => [b.gid, b.level]), (v.fields || []).map((f) => f.level), langNow]);
}
let langNow = '';

function bannerChips(v) {
  const chip = (label, value) => `<span class="art-chip"><small>${esc(label)}</small> <b>${esc(value)}</b></span>`;
  const lvl = (gid) => { const b = (v.buildings || []).filter((x) => x.gid === gid).sort((a, b) => b.level - a.level)[0]; return b && b.level ? b.level : '—'; };
  const wall = wallOf(v);
  return [
    chip(buildingName(15), lvl(15)),
    chip(wall ? buildingName(wall.gid, wall.name) : t('ov.wall'), wall ? wall.level : '—'),
    chip(buildingName(23), lvl(23)),
    chip(buildingName(10), lvl(10)),
    chip(buildingName(11), lvl(11)),
  ].join('');
}

function renderBanner(scope, now) {
  const single = scope.length === 1;
  $('ovBanner').hidden = !single;
  if (!single) return;
  const v = scope[0];
  const sig = `banner|${v.id}|${artSig(v, now)}|${v.buildings ? 1 : 0}`;
  if (artCache.banner === sig) return;
  artCache.banner = sig;
  $('ovBanner').innerHTML = `${villageArt(v, { label: esc(v.name), now, wide: true })}
    <div class="banner-caption">${v.buildings ? bannerChips(v) : `<span class="art-chip"><small>${esc(t('build.notScannedBuildings'))}</small></span>`}</div>`;
}

function postcardStatus(v, now) {
  if (v.underAttack) return `<span class="pc-status bad">⚔ ${esc(t('ov.pcAttack'))}</span>`;
  const active = (v.buildQueue || []).filter((b) => !b.finishAt || b.finishAt > now);
  if (active.length) return `<span class="pc-status">🏗 ${esc(active[0].name)} · <span class="mono">${fmtDuration(active[0].finishAt ? active[0].finishAt - now : 0)}</span></span>`;
  if (v.buildQueue) return `<span class="pc-status warn">${esc(t('card.idle'))}</span>`;
  return `<span class="pc-status muted">${esc(fmtAgo(v.updatedAt, now))}</span>`;
}

function renderPostcards(scope, now) {
  const show = scope.length > 1;
  $('ovPostcards').hidden = !show;
  if (!show) return;
  const sig = scope.map((v) => `${v.id}:${artSig(v, now)}`).join('|');
  if (artCache.cards !== sig) {
    artCache.cards = sig;
    $('ovPostcards').innerHTML = scope.map((v) => `<button type="button" class="postcard${v.underAttack ? ' attacked' : ''}" data-filter="${esc(v.id)}">
        ${villageArt(v, { label: esc(v.name), now, wide: true })}
        <span class="pc-name">${esc(v.name)} <small class="muted">${coords(v.x, v.y)}</small></span>
        <span class="pc-line" data-pc="${esc(v.id)}"></span>
      </button>`).join('');
  }
  // Status lines tick every second without redrawing the pictures.
  for (const v of scope) {
    const el = $('ovPostcards').querySelector(`[data-pc="${CSS.escape(v.id)}"]`);
    if (el) el.innerHTML = postcardStatus(v, now);
  }
}

function renderHero(data) {
  const hero = data.account.hero || {};
  const s = data.settings;
  const auto = s.adventure.enabled || (s.autopilot.enabled && s.autopilot.adventures);
  const sig = JSON.stringify([hero, auto, langNow]);
  if (artCache.hero === sig) return;
  artCache.hero = sig;
  const status = hero.home == null ? '—' : hero.home ? t('hero.home') : t('hero.away'); // not read yet: —
  $('ovHero').innerHTML = `<div class="hero-avatar">${heroArt({ home: hero.home !== false })}${hero.image ? `<img class="hero-photo" alt="" src="${esc(hero.image)}">` : ''}</div>
    <div class="hero-info">
      <h2>${esc(t('hero.title'))}</h2>
      <span class="status-pill ${hero.home == null ? '' : hero.home ? 'home' : 'away'}">${esc(status)}</span>
      <span class="hero-line"><b>${esc(String(hero.adventures ?? '—'))}</b> ${esc(t('hero.adventures'))}</span>
      <span class="hero-line small muted">${esc(t('hero.auto'))}: ${esc(auto ? t('ov.on') : t('ov.off'))}</span>
    </div>`;
  const photo = $('ovHero').querySelector('.hero-photo');
  if (photo) photo.addEventListener('error', () => photo.remove(), { once: true });
}

// ---------------------------------------------------------------- render ---
export function renderOverview(data, now) {
  langNow = data.settings.language;
  const villages = sortedVillages(data.villages);
  if (filter !== ALL && !data.villages[filter]) setFilter(ALL);
  const scope = villages.length === 1 ? villages : filter === ALL ? villages : [data.villages[filter]];
  $('ovEmpty').hidden = villages.length > 0;
  $('ovBody').hidden = villages.length === 0;
  renderFilter(villages, data);
  if (!villages.length) return;
  $('ovScopeTitle').textContent = scope.length === 1 ? `${scope[0].name} ${coords(scope[0].x, scope[0].y)}` : t('ov.allVillages');
  $('ovScopeSub').textContent = scope.length === 1 ? t('ov.updated', { ago: fmtAgo(scope[0].updatedAt, now) }) : t('ov.villageCount', { n: scope.length });
  renderKpis(scope, data, now);
  renderBanner(scope, now);
  renderPostcards(scope, now);
  renderHero(data);
  renderTimeline(scope, data, now);
  renderMinimap(scope, data);
  renderTroops(scope, now);
  renderTips(scope, data, now);
  renderResources(scope, data, now);
  renderBalance(scope, data, now);
  renderChart(scope, data);
  renderFields(scope);
  renderNext(scope, data, now);
  renderQueues(scope, now);
  renderMoves(scope, now);
  renderActivity(scope, data, now);
}

// These two are redrawn every second: not while a button in them is held
// down, or the click would be lost with the button it started on.
document.addEventListener('pointerdown', (e) => {
  const box = e.target.closest && e.target.closest('#ovRes, #ovTroops');
  pressing = box ? box.id : null;
});
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { setTimeout(() => { pressing = null; }, 0); });

// Clicks: filter chips, village names in the table, tip actions, "show more".
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-filter]');
  if (f && f.closest('#tab-overview')) {
    setFilter(f.dataset.filter);
    window.dispatchEvent(new CustomEvent('tvh:rerender'));
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open && open.closest('#tab-overview')) { chrome.tabs.create({ url: open.dataset.open }); return; }
  const b = e.target.closest('[data-tip]');
  if (b) {
    const tip = lastTips[Number(b.dataset.tip)];
    if (tip && tip.action) {
      b.disabled = true;
      runTipAction(tip).catch((err) => toast(err.message)).finally(() => { b.disabled = false; });
    }
    return;
  }
  if (e.target.closest('#ovTipsMore')) {
    showAllTips = !showAllTips;
    window.dispatchEvent(new CustomEvent('tvh:rerender'));
  }
});
window.addEventListener('resize', () => { chartKey = ''; });
// Map markers are focusable: Enter / Space picks the village too.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#ovMap [data-filter]')) {
    e.preventDefault();
    e.target.closest('[data-filter]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});
