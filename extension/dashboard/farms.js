// Farm lists kept in the extension: lists, their targets and troops, and
// the editor for adding or changing targets.
import { command, esc, fillSelect, editingIn, automationOn } from '../src/ui.js';
import { sortedVillages, fmtDuration, fmtAgo } from '../src/shared.js';
import { unitField, distance, parseCoordList, cleanTroops } from '../src/autopilot.js';
import { t, coords } from '../src/i18n.js';
import { fieldKind, kindIcon, tribeBase } from '../src/units.js';
import { farmScore } from '../src/reports.js';

const $ = (id) => document.getElementById(id);
const FIELDS = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
let data = null;
let selected = (() => { try { return localStorage.getItem('tvh.farmList') || ''; } catch (e) { return ''; } })();
let editing = null; // target id being edited
let justAdded = null; // a list just created, until it shows up in storage

const lists = () => data.farms || [];
const current = () => lists().find((l) => l.id === selected) || null;
const villageOptions = () => sortedVillages(data.villages).map((v) => [v.id, `${v.name} ${coords(v.x, v.y)}`]);

function select(id) {
  selected = id;
  editing = null;
  try { localStorage.setItem('tvh.farmList', id); } catch (e) { /* private mode */ }
}

// Unit names for a village: troops at home first, then units seen in its
// barracks/stable; "Unit N" when the game hasn't shown them yet.
function unitNames(v) {
  const names = {}, home = {};
  for (const x of (v && v.troops) || []) {
    const f = unitField(x.unit);
    if (f && f !== 't11') { names[f] = x.name; home[f] = (home[f] || 0) + x.count; }
  }
  for (const list of Object.values((v && v.units) || {})) for (const u of list) if (!names[u.field] && u.name) names[u.field] = u.name;
  return { names, home };
}

// One chip per unit, so mixed Arabic/Latin unit names keep their order.
function troopsHtml(troops, names) {
  const parts = Object.entries(cleanTroops(troops)).map(([f, n]) => `<span class="unit-chip">${kindIcon(fieldKind(f, tribeBase(data.villages)))} <b class="mono">${n}</b> ${esc(names[f] || t('troops.unitN', { n: f.slice(1) }))}</span>`);
  return parts.join('') || '—';
}

// What the raid reports said about a farm: the last raid and a score.
const REPORT_ICON = { won: '✓', losses: '⚠', lost: '✕' };
const CARRY_ICON = { full: '●', half: '◐', empty: '○' };
function reportCell(tg, now) {
  const st = tg.stats;
  if (!st || !st.last) return '<span class="muted">—</span>';
  const tone = st.last.result === 'won' ? 'good-text' : 'bad';
  const title = t('farm.reportTitle', { raids: st.raids, full: st.full, empty: st.empty, losses: st.losses });
  return `<span class="${tone}" title="${esc(title)}">${REPORT_ICON[st.last.result] || ''} ${esc(t(`report.${st.last.result}`))}</span>
    ${st.last.carry ? ` <span title="${esc(t(`report.carry.${st.last.carry}`))}">${CARRY_ICON[st.last.carry]}</span>` : ''}
    <small class="muted">· ${esc(t('farm.score', { n: farmScore(tg) }))} · ${esc(fmtAgo(st.last.at, now))}</small>
    ${tg.pausedBy === 'report' && tg.enabled === false ? `<br><span class="tag busy">${esc(t('farm.pausedReport'))}</span>` : ''}`;
}

// ------------------------------------------------------------------ lists ---
function renderLists(now) {
  fillSelect($('flVillage'), villageOptions());
  const head = ['farm.name', 'th.village', 'farm.targets', 'th.every', 'farm.mission', 'th.next', 'th.on'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  $('farmListTable').innerHTML = lists().length
    ? `<tr>${head}<th></th></tr>` + lists().map((l) => {
      const v = data.villages[l.villageId];
      const on = (l.targets || []).filter((x) => x.enabled !== false).length;
      const next = l.enabled === false ? '—' : l.nextAt && l.nextAt > now ? fmtDuration(l.nextAt - now) : automationOn(data.settings) ? t('troops.due') : t('troops.needsAuto');
      return `<tr class="${l.id === selected ? 'selected' : ''}">
        <td><button type="button" class="link" data-fl-select="${esc(l.id)}">${esc(l.name)}</button></td>
        <td>${esc(v ? v.name : t('troops.gone'))}</td>
        <td class="mono">${on} / ${(l.targets || []).length}</td>
        <td class="mono">${esc(t('troops.everyMin', { n: l.everyMinutes }))}</td>
        <td>${esc(t(l.eventType === 3 ? 'farm.attack' : 'farm.raid'))}</td>
        <td class="mono">${esc(next)}</td>
        <td><label class="switch"><input type="checkbox" data-fl-toggle="${esc(l.id)}" ${l.enabled === false ? '' : 'checked'}></label></td>
        <td class="actions">
          <button class="btn small" data-fl-now="${esc(l.id)}">${esc(t('farm.sendNow'))}</button>
          <button class="btn small danger" data-fl-remove="${esc(l.id)}" title="${esc(t('build.remove'))}">✕</button>
        </td>
      </tr>`;
    }).join('')
    : `<tr><td class="muted">${esc(t('farm.noLists'))}</td></tr>`;
}

// --------------------------------------------------------------- targets ---
function lastResult(tg, now) {
  if (!tg.lastResult) return '<span class="muted">—</span>';
  if (tg.lastResult === 'ok') return `<span class="good-text">✓ ${esc(fmtAgo(tg.lastSentAt, now))}</span>`;
  return `<span class="bad" title="${esc(tg.lastResult)}">⚠ ${esc(tg.lastResult)}</span> <small class="muted">${esc(fmtAgo(tg.lastTriedAt, now))}</small>`;
}

function renderTargets(now) {
  const l = current();
  $('ftPanel').hidden = !l;
  if (!l) return;
  const v = data.villages[l.villageId];
  const { names, home } = unitNames(v);
  $('ftTitle').textContent = t('farm.targetsOf', { list: l.name });
  const sentTotal = (l.targets || []).reduce((n, x) => n + (x.sent || 0), 0);
  $('ftMeta').textContent = t('farm.meta', { v: v ? v.name : '—', n: (l.targets || []).length, s: sentTotal });

  // List settings, unless the player is typing in one of them.
  for (const el of document.querySelectorAll('[data-fl]')) {
    if (el === document.activeElement && el.type !== 'checkbox') continue;
    const val = l[el.dataset.fl];
    if (el.type === 'checkbox') el.checked = val !== false;
    else el.value = val ?? '';
  }

  const reports = data.settings.reports.enabled;
  const head = ['#', t('farm.target'), t('raid.th.distance'), t('farm.type'), t('farm.troops'), t('farm.last'), ...(reports ? [t('farm.reportCol')] : []), t('th.on')]
    .map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = (l.targets || []).map((tg, i) => `<tr class="${tg.enabled === false ? 'off' : ''}${tg.id === editing ? ' selected' : ''}">
      <td class="muted">${i + 1}</td>
      <td><span class="mono">${coords(tg.x, tg.y)}</span>${tg.name ? ` <span>${esc(tg.name)}</span>` : ''}</td>
      <td class="mono">${v && v.x != null ? distance(v, tg).toFixed(1) : '—'}</td>
      <td>${esc(t(tg.type === 'oasis' ? 'farm.typeOasis' : 'farm.typeVillage'))}</td>
      <td>${troopsHtml(tg.troops, names)}</td>
      <td>${lastResult(tg, now)}${tg.sent ? ` <small class="muted">· ${esc(t('farm.sentCount', { n: tg.sent }))}</small>` : ''}</td>
      ${reports ? `<td>${reportCell(tg, now)}</td>` : ''}
      <td><label class="switch"><input type="checkbox" data-ft-toggle="${esc(tg.id)}" ${tg.enabled === false ? '' : 'checked'}></label></td>
      <td class="actions">
        <button class="btn small" data-ft-edit="${esc(tg.id)}" title="${esc(t('farm.edit'))}">✎</button>
        <button class="btn small danger" data-ft-remove="${esc(tg.id)}" title="${esc(t('build.remove'))}">✕</button>
      </td>
    </tr>`).join('');
  if (!editingIn($('ftTable'))) {
    $('ftTable').innerHTML = rows ? `<tr>${head}<th></th></tr>${rows}` : `<tr><td class="muted">${esc(t('farm.noTargets'))}</td></tr>`;
  }

  // Troop editor: one box per unit of this village's tribe.
  const sig = JSON.stringify([l.id, names, home, data.settings.language]);
  if ($('ftTroops').dataset.sig !== sig && !editingIn($('ftTroops'))) {
    const keep = readTroops();
    $('ftTroops').dataset.sig = sig;
    $('ftTroops').innerHTML = FIELDS.map((f) => `<label class="troop-box">
        <span>${kindIcon(fieldKind(f, tribeBase(data.villages)))} ${esc(names[f] || t('troops.unitN', { n: f.slice(1) }))}${home[f] ? ` <small class="muted">(${home[f]})</small>` : ''}</span>
        <input type="number" min="0" class="num" data-troop="${f}" value="${keep[f] || ''}">
      </label>`).join('');
  }
  $('ftFormTitle').textContent = editing ? t('farm.editTitle') : t('farm.addTitle');
  $('ftSave').textContent = editing ? t('farm.save') : t('farm.add');
  $('ftCancel').hidden = !editing;
}

// For the inactive finder: the open list and the troops in the editor.
export const currentFarmList = () => (data ? current() : null);
export const readFarmTroops = () => readTroops();

function readTroops() {
  const out = {};
  for (const el of document.querySelectorAll('#ftTroops [data-troop]')) if (Number(el.value) > 0) out[el.dataset.troop] = Number(el.value);
  return out;
}

function fillForm(tg) {
  $('ftCoords').value = `${tg.x}|${tg.y}${tg.name ? ` ${tg.name}` : ''}`;
  $('ftType').value = tg.type === 'oasis' ? 'oasis' : 'village';
  for (const el of document.querySelectorAll('#ftTroops [data-troop]')) el.value = (tg.troops || {})[el.dataset.troop] || '';
}

function clearForm() {
  editing = null;
  $('ftCoords').value = '';
  for (const el of document.querySelectorAll('#ftTroops [data-troop]')) el.value = '';
}

const msg = (text, tone = 'muted') => { $('ftMsg').textContent = text; $('ftMsg').className = `small ${tone === 'bad' ? 'bad' : tone === 'good' ? 'good-text' : 'muted'}`; };

export function renderFarms(d, now) {
  data = d;
  if (justAdded && lists().some((l) => l.id === justAdded)) { select(justAdded); justAdded = null; }
  if (selected && !current() && selected !== justAdded) selected = '';
  if (!selected && lists().length) selected = lists()[0].id;
  renderLists(now);
  renderTargets(now);
}

const rerender = () => window.dispatchEvent(new CustomEvent('tvh:rerender-all'));

// ---------------------------------------------------------------- events ---
$('flAdd').addEventListener('click', async () => {
  const list = {
    name: $('flName').value.trim(),
    villageId: $('flVillage').value,
    everyMinutes: Number($('flEvery').value),
    eventType: Number($('flType').value),
  };
  if (!list.villageId || !(list.everyMinutes >= 5)) return;
  const r = await command('addFarmList', { list });
  $('flName').value = '';
  justAdded = r.id;
  select(r.id);
  rerender();
});

$('farmListTable').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.flSelect) { select(b.dataset.flSelect); clearForm(); rerender(); }
  else if (b.dataset.flNow) {
    b.disabled = true;
    command('sendFarmNow', { id: b.dataset.flNow }).finally(() => setTimeout(() => { b.disabled = false; }, 3000));
  } else if (b.dataset.flRemove) {
    const l = lists().find((x) => x.id === b.dataset.flRemove);
    if (l && confirm(t('farm.removeConfirm', { list: l.name, n: (l.targets || []).length }))) command('removeFarmList', { id: l.id });
  }
});
$('farmListTable').addEventListener('change', (e) => {
  const id = e.target.dataset.flToggle;
  if (id) command('updateFarmList', { id, patch: { enabled: e.target.checked, nextAt: 0 } });
});

// List settings edited in place.
for (const el of document.querySelectorAll('[data-fl]')) {
  el.addEventListener('change', () => {
    const l = current();
    if (!l) return;
    const key = el.dataset.fl;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'everyMinutes' || key === 'maxPerRound' || key === 'eventType') {
      value = Number(value);
      if (!(value >= 1) || (key === 'everyMinutes' && value < 5)) return;
    }
    if (key === 'name') value = String(value).trim().slice(0, 40) || l.name;
    command('updateFarmList', { id: l.id, patch: { [key]: value } });
  });
}

$('ftTable').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  const l = current();
  if (!b || !l) return;
  if (b.dataset.ftEdit) {
    const tg = (l.targets || []).find((x) => x.id === b.dataset.ftEdit);
    if (!tg) return;
    editing = tg.id;
    fillForm(tg);
    msg('');
    rerender();
    $('ftCoords').focus();
  } else if (b.dataset.ftRemove) {
    if (editing === b.dataset.ftRemove) clearForm();
    command('removeFarmTarget', { listId: l.id, targetId: b.dataset.ftRemove });
  }
});
$('ftTable').addEventListener('change', (e) => {
  const id = e.target.dataset.ftToggle;
  const l = current();
  if (id && l) command('updateFarmTarget', { listId: l.id, targetId: id, patch: { enabled: e.target.checked } });
});

$('ftSave').addEventListener('click', async () => {
  const l = current();
  if (!l) return;
  const troops = readTroops();
  if (!Object.keys(troops).length) { msg(t('farm.needTroops'), 'bad'); return; }
  const parsed = parseCoordList($('ftCoords').value);
  const good = parsed.filter((p) => !p.error);
  const bad = parsed.filter((p) => p.error);
  if (!good.length) { msg(t('farm.needCoords'), 'bad'); return; }
  const type = $('ftType').value;
  try {
    if (editing) {
      const p = good[0];
      if (lists().some((ls) => ls.id === l.id && (ls.targets || []).some((x) => x.id !== editing && x.x === p.x && x.y === p.y))) { msg(t('farm.duplicate'), 'bad'); return; }
      await command('updateFarmTarget', { listId: l.id, targetId: editing, patch: { x: p.x, y: p.y, name: p.name, type, troops } });
      clearForm();
      msg(t('ov.done'), 'good');
    } else {
      const r = await command('addFarmTargets', { listId: l.id, targets: good.map((p) => ({ ...p, type, troops })) });
      $('ftCoords').value = bad.map((p) => p.error).join('\n');
      msg(t('farm.added', { n: r.added, s: r.skipped + bad.length }), r.added ? 'good' : 'bad');
    }
  } catch (err) {
    msg(err.message, 'bad');
  }
  rerender();
});

$('ftApplyAll').addEventListener('click', async () => {
  const l = current();
  const troops = readTroops();
  if (!l) return;
  if (!Object.keys(troops).length) { msg(t('farm.needTroops'), 'bad'); return; }
  if (!confirm(t('farm.applyConfirm', { n: (l.targets || []).length }))) return;
  await command('setFarmTroops', { listId: l.id, troops });
  msg(t('ov.done'), 'good');
});

$('ftCancel').addEventListener('click', () => { clearForm(); msg(''); rerender(); });
