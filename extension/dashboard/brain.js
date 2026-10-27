// Brain page: what the brain decides for every village and why, its
// limits, and its recent actions. The plan is worked out here from the same
// data the background uses (src/brain.js), so it always shows the current
// thinking.
import { command, esc, editingIn } from '../src/ui.js';
import { brainPlan } from '../src/brain.js';
import { buildingName, fmtDuration, fmtAgo, buildStatus, goalText } from '../src/shared.js';
import { tribeBase } from '../src/units.js';
import { attackVerdict, speedFactor } from '../src/attacks.js';
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
  const list = (tr.builds || [{ gid: tr.gid }]).map((b) => buildingName(b.gid)).join(t('list.sep'));
  return t('brain.dec.trainIn', { kind: t(`brain.kind.${tr.kind}`), list, pct: Math.round(tr.share * 100), why: t(`brain.why.${tr.why}`), when });
}

// The next building step and the goal it serves, and the goals passed over.
function nextStep(p) {
  const b = p.build;
  if (!b) return t('brain.dec.off');
  const passed = (b.passed || []).filter((x) => x.reason !== 'building').slice(0, 3)
    .map((x) => `${goalText(x.goal)} (${t(`brain.wait.${x.reason}`)})`).join(t('list.sep'));
  let text = t('brain.next.none');
  if (b.step) {
    const step = t('brain.next.step', { b: buildingName(b.step.gid), n: b.step.level + 1 });
    text = b.step.forGid ? t('brain.next.needed', { step, b: buildingName(b.step.forGid), n: b.step.forLevel }) : t('brain.next.goal', { step, g: goalText(b.goal) });
  }
  return passed ? `${text}\n${t('brain.next.passed', { list: passed })}` : text;
}

// Academy and Smithy: what the brain will research or improve.
function army(p) {
  if (p.role === 'off') return '—';
  const out = [];
  for (const r of p.research || []) {
    const b = buildingName(r.gid);
    if (r.skip === 'noBuilding' || r.skip === 'roleOff') continue;
    if (((p.v.research || {})[r.gid] || {}).unreadable) out.push(t('brain.res.unreadable', { b }));
    else if (r.look) out.push(t('brain.res.look', { b }));
    else if (r.field) out.push(t('brain.res.do', { b, u: r.name || r.field }));
    else if (['busy', 'saving', 'nothing', 'economyFirst'].includes(r.skip)) out.push(t(`brain.res.skip.${r.skip}`, { b }));
  }
  return out.join('\n') || '—';
}

function renderTable(now) {
  const plan = brainPlan(data, data.settings, now, tribeBase(data.villages));
  const { factor } = speedFactor(data.account || {}, data.settings.server);
  const head = ['th.village', 'brain.th.role', 'brain.th.stage', 'brain.th.next', 'brain.th.build', 'brain.th.troops', 'brain.th.army', 'brain.th.defense', 'brain.th.last']
    .map((k) => `<th>${esc(t(k))}</th>`).join('');
  const roles = data.settings.brain.roles || {};
  const rows = plan.map((p) => {
    const v = p.v;
    const st = buildStatus(v, { ...data, tasks: data.tasks || {} }, now);
    const last = v.brainLast ? `${esc(v.brainLast.list ? v.brainLast.unit : t('brain.lastTrained', { n: v.brainLast.n, u: v.brainLast.unit }))} <small class="muted">${esc(fmtAgo(v.brainLast.at, now))}</small>` : '<span class="muted">—</span>';
    const verdict = v.underAttack ? attackVerdict(v, factor, now) : null;
    const escapePlan = (data.escapes || []).find((x) => x.villageId === v.id);
    const def = !data.settings.brain.defense ? t('brain.def.off')
      : verdict ? t(`brain.verdict.${verdict.small ? 'small' : verdict.worst}`)
        : v.underAttack && !(v.incomingAt > now - 10 * 60000) ? t('brain.verdict.reading')
          : escapePlan && escapePlan.enabled !== false ? t('brain.def.plan')
            : v.underAttack ? t('brain.def.nothing') : t('brain.def.ready');
    const coming = v.transferPending && v.transferPending.until > now ? t('brain.transferPending', { v: (data.villages[v.transferPending.from] || {}).name || '?' }) : '';
    return `<tr>
      <td>${v.underAttack ? '⚔ ' : ''}${esc(v.name)}<br><small class="muted">${coords(v.x, v.y)}</small></td>
      <td><select data-brain-role="${esc(v.id)}">${ROLES.map((r) => `<option value="${r}" ${(roles[v.id] || 'auto') === r ? 'selected' : ''}>${esc(r === 'auto' ? t('brain.role.autoIs', { role: t(`brain.role.${p.role}`) }) : t(`brain.role.${r}`))}</option>`).join('')}</select></td>
      <td>${esc(t(`brain.stage.${p.stage}`))}</td>
      <td class="small pre">${esc(nextStep(p))}</td>
      <td class="small">${esc(p.role === 'off' ? t('brain.dec.off') : st ? st.text : '—')}</td>
      <td class="small">${esc(decision(p, now))}</td>
      <td class="small pre">${esc(army(p))}</td>
      <td class="small">${esc(def)}</td>
      <td class="small">${last}${coming ? `<br><small class="muted">${esc(coming)}</small>` : ''}</td>
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
