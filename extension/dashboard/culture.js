// Culture tab: progress towards the next village, culture points per
// village, celebrations, and what the autopilot would build for culture.
import { esc, command, editingIn } from '../src/ui.js';
import { sortedVillages, buildingName, fmtNum, fmtDuration, fmtClock, estimateStock, RESOURCES } from '../src/shared.js';
import { t, dateLocale, coords } from '../src/i18n.js';
import { villageCp, bestCpUpgrade, savingFor, expansionEta, CELEBRATIONS } from '../src/culture.js';
import { expansionPlan, VALLEY_FIELDS, SLOT_LEVEL } from '../src/expansion.js';
import { parseCoordList, distance } from '../src/autopilot.js';

const $ = (id) => document.getElementById(id);
let last = '';
let lastExp = '';
let data = null;

const when = (ts) => new Date(ts).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const thLevel = (v) => Math.max(0, ...(v.buildings || []).filter((b) => b.gid === 24).map((b) => b.level || 0));

function celebrationText(v, data, now) {
  const kind = data.settings.culture.celebrate;
  const th = thLevel(v);
  if (!v.buildings) return { tone: 'muted', text: t('build.notScannedBuildings') };
  if (!th) return { tone: 'muted', text: t('culture.noTownHall') };
  if ((v.celebrationUntil || 0) > now) return { tone: 'good', text: t('culture.running', { clock: fmtClock(v.celebrationUntil) }) };
  if (!kind || kind === 'off') return { tone: 'muted', text: t('culture.celebrateOff') };
  if ((v.celebrationFailAt || 0) > now - 12 * 3600000) return { tone: 'bad', text: t('culture.failed') };
  const save = savingFor(v, kind, now);
  if (!save) return { tone: 'muted', text: '—' };
  if (save.tooSmall) return { tone: 'warn', text: t('culture.tooSmall', { kind: t(`culture.kind.${save.kind}`) }) };
  const est = estimateStock(v, now);
  const pct = est ? Math.min(100, Math.round(Math.min(...RESOURCES.map((k) => est[k] / save.cost[k])) * 100)) : 0;
  if (pct >= 100) return { tone: 'good', text: t('culture.ready', { kind: t(`culture.kind.${save.kind}`) }) };
  return { tone: 'warn', text: t('culture.saving', { kind: t(`culture.kind.${save.kind}`), pct }) };
}

// New villages: every village's step, its settlers and where to found.
const STEP_TONE = { ready: 'good-text', training: 'good-text', founded: 'muted', skipped: 'muted', later: 'muted', noSlot: 'warn', waitSlot: 'warn' };
function renderExpansion(now) {
  const s = data.settings;
  const plan = expansionPlan(data, now);
  const ex = data.account.expansion;
  $('expMeta').textContent = plan.enabled && ex && ex.total != null ? t('exp.slotsFree', { n: plan.slotsFree }) : '';
  const auto = s.brain.enabled || (s.autopilot.enabled && s.autopilot.build);
  $('expWarn').hidden = !plan.enabled || auto;
  $('expWarn').textContent = t('exp.needAuto');
  const head = ['th.village', 'exp.th.home', 'exp.th.settlers', 'exp.th.step', 'exp.th.target'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  const rows = plan.rows.map((r) => {
    const home = r.home ? `${r.home.level}/${SLOT_LEVEL}` : '—';
    const done = r.step === 'founded' || r.step === 'skipped';
    const set = done ? '—' : [r.settlers.home ? t('exp.home', { n: r.settlers.home }) : '', r.settlers.training ? t('exp.inTraining', { n: r.settlers.training }) : ''].filter(Boolean).join(' · ') || '—';
    const tg = r.target;
    const where = tg ? `<span class="mono">${esc(coords(tg.x, tg.y))}</span> <small class="muted">${esc(tg.own ? t('exp.yours') : `${VALLEY_FIELDS[tg.type] || '?'} · ${t('exp.dist', { d: distance(tg, r.v).toFixed(1) })}`)}</small>
      ${s.server ? ` <a href="${esc(`${s.server}/position_details.php?x=${tg.x}&y=${tg.y}`)}" target="_blank" rel="noopener">${esc(t('exp.openValley'))}</a>` : ''}` : '—';
    const btn = (label, patch) => `<button class="btn small" data-exp="${esc(r.id)}" data-patch='${esc(JSON.stringify(patch))}'>${esc(t(label))}</button>`;
    const actions = r.step === 'founded' ? btn('exp.undo', { founded: false, reset: true })
      : r.step === 'skipped' ? btn('exp.include', { skip: false, reset: true })
        : `${btn('exp.markFounded', { founded: true })} ${btn('exp.skip', { skip: true })}`;
    return `<tr${plan.active.has(r.id) ? ' class="selected"' : ''}>
      <td>${esc(r.v.name)}</td><td class="mono">${esc(home)}</td><td>${esc(set)}</td>
      <td class="${STEP_TONE[r.step] || ''}">${esc(t(`exp.step.${r.step}`))}</td><td>${where}</td>
      <td class="actions">${actions}</td></tr>`;
  }).join('');
  const html = plan.rows.length ? `<tr>${head}<th></th></tr>${rows}` : `<tr><td class="muted">${esc(t('build.noVillages'))}</td></tr>`;
  if (html !== lastExp && !editingIn($('expTable'))) { lastExp = html; $('expTable').innerHTML = html; }
  $('expTable').closest('.table-wrap').hidden = !plan.enabled;
  if (document.activeElement !== $('expTargets') && $('expTargets').dataset.sig !== JSON.stringify(s.expansion.targets)) {
    $('expTargets').dataset.sig = JSON.stringify(s.expansion.targets);
    $('expTargets').value = (s.expansion.targets || []).join('\n');
  }
  $('expValleys').textContent = t('exp.valleys', { n: Object.keys(data.valleys || {}).length });
  const first = plan.rows.find((r) => plan.active.has(r.id)) || plan.rows[0];
  $('expScan').hidden = !first;
  if (first) { $('expScan').textContent = t('exp.scan', { v: first.v.name }); $('expScan').dataset.village = first.id; }
}

$('expTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp]');
  if (b) command('expansionMark', { villageId: b.dataset.exp, patch: JSON.parse(b.dataset.patch) });
});
$('expSaveTargets').addEventListener('click', async () => {
  const list = parseCoordList($('expTargets').value);
  const bad = list.filter((x) => x.error).map((x) => x.error);
  const targets = [...new Set(list.filter((x) => !x.error).map((x) => `${x.x}|${x.y}`))];
  await command('saveSettings', { settings: { expansion: { ...data.settings.expansion, targets } } });
  $('expMsg').textContent = bad.length ? t('exp.badLines', { list: bad.join(t('list.sep')) }) : t('exp.saved', { n: targets.length });
  $('expMsg').className = `small ${bad.length ? 'bad' : 'good-text'}`;
});
$('expScan').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { await command('scanOases', { villageId: e.target.dataset.village }); $('expMsg').textContent = t('exp.scanning'); $('expMsg').className = 'small good-text'; } finally { setTimeout(() => { e.target.disabled = false; }, 4000); }
});

export function renderCulture(d, now) {
  data = d;
  renderExpansion(now);
  const villages = sortedVillages(data.villages);
  const ex = data.account.expansion;
  const eta = expansionEta(data.account.cpHistory, now);
  const totalCp = villages.reduce((n, v) => n + villageCp(v), 0);
  const cu = data.settings.culture;

  // Next village.
  let head;
  if (!ex || ex.total == null) head = `<p class="muted">${esc(t('culture.noSlots'))}</p>`;
  else {
    const free = ex.used < ex.total;
    head = `<div class="cu-slots${free ? ' free' : ''}">
        <div><small class="muted">${esc(t('culture.villages'))}</small><b class="mono">${ex.used}/${ex.total}</b></div>
        <div class="cu-bar" role="progressbar" aria-valuenow="${ex.pct ?? 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, ex.pct ?? 0)}%"></i></div>
        <div><small class="muted">${esc(t('culture.toNext'))}</small><b class="mono">${ex.pct != null ? `${Math.round(ex.pct)}%` : '—'}</b></div>
      </div>
      <p class="${free ? 'good-text' : 'muted'} small">${esc(free ? t('culture.freeSlot') : eta
        ? t('culture.eta', { when: when(eta.at), t: fmtDuration(eta.at - now), pace: (eta.perHour * 24).toFixed(1) })
        : t('culture.etaUnknown'))}</p>`;
  }
  $('cuHead').innerHTML = `${head}<p class="small">${esc(t('culture.totalCp', { n: fmtNum(totalCp) }))}</p>`;

  // Per village.
  const rows = villages.map((v) => {
    const cel = celebrationText(v, data, now);
    const pick = v.buildings ? bestCpUpgrade(v) : null;
    const next = pick ? `${buildingName(pick.gid)} → ${pick.level + 1} <small class="muted">(+${pick.gain} · ${fmtNum(RESOURCES.reduce((n, k) => n + pick.cost[k], 0))})</small>` : '—';
    return `<tr>
      <td>${esc(v.name)}</td>
      <td class="mono">${v.buildings ? fmtNum(villageCp(v)) : '—'}</td>
      <td class="mono">${thLevel(v) || '—'}</td>
      <td class="${cel.tone === 'bad' ? 'bad' : cel.tone === 'good' ? 'good-text' : cel.tone === 'warn' ? 'warn' : 'muted'}">${esc(cel.text)}</td>
      <td>${next}</td>
    </tr>`;
  }).join('');
  const html = `<tr>${['th.village', 'culture.cpDay', 'culture.townHall', 'culture.celebration', 'culture.nextBuild'].map((k) => `<th>${esc(t(k))}</th>`).join('')}</tr>${rows}`;
  if (html !== last) { last = html; $('cuTable').innerHTML = html; }

  const c = CELEBRATIONS[cu.celebrate] || null;
  $('cuCelebrateInfo').textContent = c ? t('culture.celebrateInfo', {
    cost: RESOURCES.map((k) => fmtNum(c.cost[k])).join(' / '), cp: c.cp, th: c.townHall,
  }) : '';
}
