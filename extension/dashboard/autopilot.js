// The Autopilot page (what the autopilot will do next) and the Oasis raids
// page (raid rules and the oases known around each village).
import { command, esc, fillSelect } from '../src/ui.js';
import { sortedVillages, buildingName, taskLabel, fmtDuration, fmtAgo, buildStatus } from '../src/shared.js';
import { pickAutoUpgrade, unitField, distance, oasisKey } from '../src/autopilot.js';
import { expansionPlan } from '../src/expansion.js';
import { tribeBase } from '../src/units.js';
import { t, coords } from '../src/i18n.js';

const $ = (id) => document.getElementById(id);
let data = null;

const villageOptions = () => sortedVillages(data.villages).map((v) => [v.id, `${v.name} ${coords(v.x, v.y)}`]);

// Units this village can send: troops at home first (with counts), then
// units seen in its barracks/stable, then plain t1..t10.
function unitOptions(v) {
  const out = new Map();
  for (const x of (v && v.troops) || []) {
    const field = unitField(x.unit);
    if (field && field !== 't11') out.set(field, `${x.name || field} — ${t('raid.atHome', { n: x.count })}`);
  }
  for (const list of Object.values((v && v.units) || {})) {
    for (const u of list) if (!out.has(u.field)) out.set(u.field, u.name || u.field);
  }
  if (!out.size) for (let i = 1; i <= 10; i++) out.set(`t${i}`, t('troops.unitN', { n: i }));
  return [...out.entries()].sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
}

function unitNameFor(v, field) {
  const home = ((v && v.troops) || []).find((x) => unitField(x.unit) === field);
  if (home && home.name) return home.name;
  for (const list of Object.values((v && v.units) || {})) {
    const u = list.find((x) => x.field === field);
    if (u && u.name) return u.name;
  }
  return t('troops.unitN', { n: field.slice(1) });
}

// ------------------------------------------------------------------ plan ---
function renderPlan(now) {
  const s = data.settings;
  const ap = s.autopilot;
  const rows = [];
  const plan = s.expansion.enabled ? expansionPlan(data, now) : null;
  for (const v of sortedVillages(data.villages)) {
    const queued = (data.tasks[v.id] || [])[0];
    const why = buildStatus(v, data, now);
    let what;
    if (queued) what = t('ap.planQueued', { task: taskLabel(queued, v) });
    else if (ap.build) {
      const pick = pickAutoUpgrade(v, s, now, tribeBase(data.villages), plan);
      what = pick && pick.saving ? t('ap.planSaving', { kind: t(`culture.kind.${pick.kind}`) })
        : pick && pick.construct ? t('ap.planConstruct', { name: buildingName(pick.gid), slot: pick.slot })
        : pick ? t('ap.planPick', { name: buildingName(pick.gid), n: pick.level + 1, why: t(`auto.why.${pick.why}`) })
        : v.fields ? t('ap.planNothing', { n: ap.fieldsMax }) : t('build.notScannedFields');
    } else what = t('ap.planBuildOff');
    rows.push(`<li><span><b>${esc(v.name)}</b><br>🏗 ${esc(what)}${why && ap.enabled ? `<br><small class="muted">${esc(why.text)}</small>` : ''}</span></li>`);
  }
  for (const r of data.raids) {
    const v = data.villages[r.villageId];
    if (!v || r.enabled === false) continue;
    const next = r.nextAt && r.nextAt > now ? fmtDuration(r.nextAt - now) : t('troops.due');
    rows.push(`<li><span>⚔ ${esc(t('ap.planRaid', { v: v.name, n: r.amount, u: r.unitName || unitNameFor(v, r.field) }))}</span><span class="feed-time"><b class="mono">${esc(next)}</b></span></li>`);
  }
  for (const l of data.farms || []) {
    const v = data.villages[l.villageId];
    const on = (l.targets || []).filter((x) => x.enabled !== false).length;
    if (!v || l.enabled === false || !on) continue;
    const next = l.nextAt && l.nextAt > now ? fmtDuration(l.nextAt - now) : t('troops.due');
    rows.push(`<li><span>🐎 ${esc(t('ap.planFarmList', { list: l.name, n: on, m: l.everyMinutes }))}</span><span class="feed-time"><b class="mono">${esc(next)}</b></span></li>`);
  }
  const hero = data.account.hero || {};
  if (ap.adventures) rows.push(`<li><span>🧭 ${esc(t('ap.planAdventures', { n: hero.adventures ?? 0 }))}</span></li>`);
  if (ap.farmLists) rows.push(`<li><span>🐎 ${esc(t('ap.planFarm', { n: s.farm.intervalMinutes }))}</span></li>`);
  $('apPlan').innerHTML = (ap.enabled ? '' : `<li class="muted">${esc(t('ap.planOff'))}</li>`) +
    (rows.join('') || `<li class="muted">${esc(t('build.noVillages'))}</li>`);
}

// ----------------------------------------------------------------- raids ---
function renderRaidTable(now) {
  const head = ['th.village', 'th.unit', 'th.amount', 'raid.radius', 'th.every', 'raid.maxPerRun', 'th.next', 'th.on'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  $('raidTable').innerHTML = data.raids.length
    ? `<tr>${head}<th></th></tr>` + data.raids.map((r) => {
      const v = data.villages[r.villageId];
      const next = r.nextAt && r.nextAt > now ? fmtDuration(r.nextAt - now) : t('troops.due');
      return `<tr>
        <td>${esc(v ? v.name : t('troops.gone'))}</td>
        <td>${esc(r.unitName || unitNameFor(v, r.field))}</td>
        <td class="mono">${r.amount}</td>
        <td class="mono">${r.radius}</td>
        <td class="mono">${esc(t('troops.everyMin', { n: r.everyMinutes }))}</td>
        <td class="mono">${r.maxPerRun}</td>
        <td class="mono">${r.enabled === false ? '—' : esc(next)}</td>
        <td><label class="switch"><input type="checkbox" data-toggle-raid="${r.id}" ${r.enabled === false ? '' : 'checked'}></label></td>
        <td class="actions"><button class="btn small danger" data-remove-raid="${r.id}" title="${esc(t('build.remove'))}">✕</button></td>
      </tr>`;
    }).join('')
    : `<tr><td class="muted">${esc(t('raid.none'))}</td></tr>`;
}

function oasisStatus(o) {
  if (o.notOasis) return { tone: 'muted', text: t('raid.st.notOasis') };
  if (o.owned) return { tone: 'muted', text: t('raid.st.owned') };
  if (o.animals == null) return { tone: 'muted', text: t('raid.st.unknown') };
  if (o.animals > 0) return { tone: 'bad', text: t('raid.st.animals', { n: o.animals }) };
  return { tone: 'good', text: t('raid.st.empty') };
}

function renderOases(now) {
  const v = data.villages[$('raidVillage').value];
  $('oasisTitle').textContent = v ? t('raid.oasesNear', { v: v.name }) : t('raid.oases');
  if (!v) { $('oasisTable').innerHTML = ''; $('oasisMeta').textContent = ''; return; }
  const rules = data.raids.filter((r) => r.villageId === v.id);
  const radius = Math.max(7, ...rules.map((r) => r.radius || 0));
  const manual = new Set(rules.flatMap((r) => (r.targets || []).map((p) => oasisKey(p.x, p.y))));
  const list = [];
  for (const key of manual) {
    const [x, y] = key.split('|').map(Number);
    list.push({ ...(data.oases[key] || {}), x, y, manual: true });
  }
  for (const [key, o] of Object.entries(data.oases)) if (!manual.has(key) && distance(v, o) <= radius) list.push(o);
  list.forEach((o) => { o.dist = distance(v, o); });
  list.sort((a, b) => a.dist - b.dist);
  const scanned = Math.max(0, ...rules.map((r) => r.scannedAt || 0));
  $('oasisMeta').textContent = t('raid.oasesMeta', { n: list.length, r: radius, ago: scanned ? fmtAgo(scanned, now) : t('ago.never') });
  const head = ['raid.th.oasis', 'raid.th.distance', 'th.status', 'raid.th.checked', 'raid.th.raided'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  $('oasisTable').innerHTML = list.length
    ? `<tr>${head}<th></th></tr>` + list.map((o) => {
      const st = oasisStatus(o);
      return `<tr>
        <td class="mono">${coords(o.x, o.y)}${o.manual ? ` <span class="tag">${esc(t('raid.manualTag'))}</span>` : ''}</td>
        <td class="mono">${o.dist.toFixed(1)}</td>
        <td class="${st.tone === 'bad' ? 'bad' : st.tone === 'good' ? 'good-text' : 'muted'}">${esc(st.text)}</td>
        <td class="muted small">${esc(o.checkedAt ? fmtAgo(o.checkedAt, now) : o.scannedAt ? t('raid.fromMap') : '—')}</td>
        <td class="muted small">${esc(o.raidedAt ? fmtAgo(o.raidedAt, now) : '—')}</td>
        <td class="actions">${o.manual ? `<button class="btn small danger" data-remove-target="${o.x}|${o.y}" title="${esc(t('build.remove'))}">✕</button>` : ''}</td>
      </tr>`;
    }).join('')
    : `<tr><td class="muted">${esc(t('raid.noOases'))}</td></tr>`;
}

export function renderAutopilot(d, now) {
  data = d;
  fillSelect($('raidVillage'), villageOptions());
  const v = data.villages[$('raidVillage').value];
  fillSelect($('raidUnit'), unitOptions(v));
  renderPlan(now);
  renderRaidTable(now);
  renderOases(now);
}

const rerender = () => window.dispatchEvent(new CustomEvent('tvh:rerender-all'));
$('raidVillage').addEventListener('change', rerender);

$('addRaid').addEventListener('click', () => {
  const v = data.villages[$('raidVillage').value];
  const rule = {
    villageId: $('raidVillage').value,
    field: $('raidUnit').value,
    unitName: unitNameFor(v, $('raidUnit').value),
    amount: Number($('raidAmount').value),
    radius: Number($('raidRadius').value),
    everyMinutes: Number($('raidEvery').value),
    maxPerRun: Number($('raidMax').value),
  };
  if (!rule.villageId || !/^t\d+$/.test(rule.field) || !(rule.amount >= 1) || !(rule.radius >= 1) || !(rule.everyMinutes >= 10) || !(rule.maxPerRun >= 1)) return;
  command('addRaid', { rule });
});

$('raidTable').addEventListener('change', (e) => {
  const id = e.target.dataset.toggleRaid;
  if (id) command('updateRaid', { id, patch: { enabled: e.target.checked, nextAt: 0 } });
});
$('raidTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove-raid]');
  if (b) command('removeRaid', { id: b.dataset.removeRaid });
});

function ruleForVillage() {
  return data.raids.find((r) => r.villageId === $('raidVillage').value);
}

$('scanOases').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('targetMsg').textContent = t('raid.scanQueued');
  try { await command('scanOases', { villageId: $('raidVillage').value }); } finally { setTimeout(() => { e.target.disabled = false; }, 4000); }
});

$('addTarget').addEventListener('click', async () => {
  const m = $('targetXY').value.replace(/[−–]/g, '-').match(/^\s*\(?\s*(-?\d+)\s*[|,;\s]\s*(-?\d+)\s*\)?\s*$/);
  if (!m) { $('targetMsg').textContent = t('raid.badCoords'); return; }
  const rule = ruleForVillage();
  if (!rule) { $('targetMsg').textContent = t('raid.needRule'); return; }
  try {
    await command('addRaidTarget', { id: rule.id, x: Number(m[1]), y: Number(m[2]) });
    $('targetXY').value = '';
    $('targetMsg').textContent = '';
  } catch (err) {
    $('targetMsg').textContent = err.message;
  }
});

$('oasisTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove-target]');
  if (!b) return;
  const [x, y] = b.dataset.removeTarget.split('|').map(Number);
  for (const r of data.raids.filter((z) => z.villageId === $('raidVillage').value)) {
    if ((r.targets || []).some((p) => p.x === x && p.y === y)) command('removeRaidTarget', { id: r.id, x, y });
  }
});

