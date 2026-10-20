// Brain page: what the brain decides for every village and why, its
// limits, and its recent actions. The plan is worked out here from the same
// data the background uses (src/brain.js), so it always shows the current
// thinking.
import { command, esc, editingIn } from '../src/ui.js';
import { brainPlan, BARRACKS, STABLE } from '../src/brain.js';
import { buildingName, fmtDuration, fmtAgo, buildStatus } from '../src/shared.js';
import { tribeBase } from '../src/units.js';
import { t, coords } from '../src/i18n.js';

const $ = (id) => document.getElementById(id);
const ROLES = ['auto', 'economy', 'military', 'off'];
let data = null;

function decision(p, now) {
  const tr = p.train;
  if (p.role === 'off') return t('brain.dec.off');
  if (!tr || tr.skip) {
    const pct = tr && tr.fill != null ? Math.round(tr.fill * 100) : null;
    return t(`brain.skip.${(tr && tr.skip) || 'noStock'}`, { pct });
  }
  const when = (p.v.brainTrainAt || 0) > now ? t('brain.dec.next', { t: fmtDuration(p.v.brainTrainAt - now) }) : t('brain.dec.now');
  return t('brain.dec.train', { kind: t(`brain.kind.${tr.kind}`), b: buildingName(tr.gid === STABLE ? STABLE : BARRACKS), pct: Math.round(tr.share * 100), why: t(`brain.why.${tr.why}`), when });
}

function renderTable(now) {
  const plan = brainPlan(data, data.settings, now, tribeBase(data.villages));
  const head = ['th.village', 'brain.th.role', 'brain.th.stage', 'brain.th.fields', 'brain.th.build', 'brain.th.troops', 'brain.th.defense', 'brain.th.last']
    .map((k) => `<th>${esc(t(k))}</th>`).join('');
  const roles = data.settings.brain.roles || {};
  const rows = plan.map((p) => {
    const v = p.v;
    const st = buildStatus(v, { ...data, tasks: data.tasks || {} }, now);
    const last = v.brainLast ? `${esc(t('brain.lastTrained', { n: v.brainLast.n, u: v.brainLast.unit }))} <small class="muted">${esc(fmtAgo(v.brainLast.at, now))}</small>` : '<span class="muted">—</span>';
    const def = !data.settings.brain.defense ? t('brain.def.off')
      : (data.escapes || []).some((x) => x.villageId === v.id) ? t('brain.def.plan')
        : v.underAttack ? t('brain.def.nothing') : t('brain.def.ready');
    return `<tr>
      <td>${v.underAttack ? '⚔ ' : ''}${esc(v.name)}<br><small class="muted">${coords(v.x, v.y)}</small></td>
      <td><select data-brain-role="${esc(v.id)}">${ROLES.map((r) => `<option value="${r}" ${(roles[v.id] || 'auto') === r ? 'selected' : ''}>${esc(r === 'auto' ? t('brain.role.autoIs', { role: t(`brain.role.${p.role}`) }) : t(`brain.role.${r}`))}</option>`).join('')}</select></td>
      <td>${esc(t(`brain.stage.${p.stage}`))}</td>
      <td class="mono">${p.role === 'off' ? '—' : p.fieldsMax}</td>
      <td class="small">${esc(p.role === 'off' ? t('brain.dec.off') : st ? st.text : '—')}</td>
      <td class="small">${esc(decision(p, now))}</td>
      <td class="small">${esc(def)}</td>
      <td class="small">${last}</td>
    </tr>`;
  }).join('');
  if (!editingIn($('brainTable'))) {
    $('brainTable').innerHTML = rows ? `<tr>${head}</tr>${rows}` : `<tr><td class="muted">${esc(t('build.noVillages'))}</td></tr>`;
  }
}

function renderJournal() {
  const names = Object.fromEntries(Object.values(data.villages).map((v) => [v.id, v.name]));
  const items = (data.log || []).filter((e) => /^(العقل|Brain):/.test(e.msg)).slice(0, 25);
  $('brainLog').innerHTML = items.length
    ? items.map((e) => `<li><span>${e.villageId && names[e.villageId] ? `<b>${esc(names[e.villageId])}:</b> ` : ''}${esc(e.msg.replace(/^(العقل|Brain):\s*/, ''))}</span><span class="feed-time muted small">${esc(fmtAgo(e.t, Date.now()))}</span></li>`).join('')
    : `<li class="muted">${esc(t('brain.journalEmpty'))}</li>`;
}

export function renderBrain(d, now) {
  data = d;
  const s = data.settings;
  const warns = [];
  if (s.brain.enabled && !s.watchEnabled) warns.push(t('brain.warnWatch'));
  if (s.brain.enabled && s.autopilot.farmLists) warns.push(t('brain.noteFarms'));
  $('brainWarn').hidden = !warns.length;
  $('brainWarn').textContent = warns.join(' ');
  renderTable(now);
  renderJournal();
}

$('brainTable').addEventListener('change', (e) => {
  const id = e.target.dataset.brainRole;
  if (!id) return;
  const roles = { ...(data.settings.brain.roles || {}), [id]: e.target.value };
  if (e.target.value === 'auto') delete roles[id];
  data.settings = { ...data.settings, brain: { ...data.settings.brain, roles } };
  command('saveSettings', { settings: { brain: { roles } } });
});
