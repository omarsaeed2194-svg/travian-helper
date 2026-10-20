// The diagnostics report: one plain-text page the player can copy and send
// when something doesn't work. What runs, how each job did, the last map
// read in detail, the last failed actions with what their page looked like,
// and recent errors. No passwords, tokens or keys. Pure.
import { sortedVillages } from './shared.js';

const ago = (at, now) => {
  if (!at) return '—';
  const s = Math.round((now - at) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const clock = (at) => new Date(at).toISOString().replace('T', ' ').slice(0, 19);
const onOff = (v) => (v ? 'on' : 'off');

export function diagnosticsReport(data, env, now = Date.now()) {
  const s = data.settings || {};
  const ap = s.autopilot || {};
  const st = data.status || {};
  const h = data.health || {};
  const acc = data.account || {};
  const lines = [];
  const add = (x = '') => lines.push(x);

  add(`Travian Helper diagnostics — ${clock(now)} UTC`);
  add(`Extension ${env.version} · ${env.browser} · UI ${s.language || '?'}`);
  add(`Server: ${s.server ? new URL(s.server).host : 'not detected'}`);
  add(`Switches: watch ${onOff(s.watchEnabled)} · automate ${onOff(s.botEnabled)} · autopilot ${onOff(ap.enabled)}`
    + ` (${['build', 'construct', 'adventures', 'farmLists', 'quests', 'heroBag'].filter((k) => ap[k]).join(', ') || '—'})`
    + ` · culture focus ${onOff(s.culture && s.culture.focus)} · celebrate ${(s.culture && s.culture.celebrate) || 'off'}`
    + ` · new villages ${onOff(s.expansion && s.expansion.enabled)} · heal ${onOff(s.heal && s.heal.enabled)}`
    + ` · reports ${onOff(s.reports && s.reports.enabled)} · game farm lists ${onOff(s.farm && s.farm.enabled)}`
    + ` · pause when playing ${onOff(s.pauseWhenPlaying)} · active hours ${s.activeHours && s.activeHours.enabled ? `${s.activeHours.from}-${s.activeHours.to}` : 'off'}`
    + ` · telegram ${s.telegram && s.telegram.token ? 'set' : 'off'} · web link ${s.web && s.web.url ? 'set' : 'off'}`);
  const farms = data.farms || [];
  add(`Rules: farm lists ${farms.length} (targets ${farms.reduce((n, l) => n + (l.targets || []).length, 0)}) · oasis raids ${(data.raids || []).length}`
    + ` · training ${(data.training || []).length} · escapes ${(data.escapes || []).length}`
    + ` · build tasks ${Object.values(data.tasks || {}).reduce((n, l) => n + l.length, 0)} · every ${s.refreshMinutes} min ±${s.jitterPercent}%`);
  add(`Status: ${st.state || '?'}${st.note ? ` (${st.note})` : ''} · last run ${ago(st.lastRunAt, now)} · last page ${ago(st.lastPageAt, now)}`
    + ` · playing until ${st.userActiveUntil > now ? ago(st.userActiveUntil, now).replace('ago', 'from now') : '—'} · logged out ${st.loggedOut ? 'YES' : 'no'}`
    + ` · lease ${data.lease ? `${data.lease.deviceName} ${ago(data.lease.at, now)}` : '—'}`);
  const ex = acc.expansion;
  add(`Account: villages ${ex ? `${ex.used}/${ex.total} (${ex.pct ?? '?'}%)` : '?'} · hero ${acc.hero ? `${acc.hero.home ? 'home' : 'away'}, adventures ${acc.hero.adventures ?? '?'}` : '?'}`
    + ` · game farm lists ${(acc.farmLists || []).length} · map method ${acc.mapMethod || '—'}`);

  add();
  const villages = sortedVillages(data.villages || {});
  add(`Villages (${villages.length}):`);
  for (const v of villages) {
    const q = Object.values(v.trainingQueue || {}).reduce((n, x) => n + (x.items || []).length, 0);
    add(`- ${v.name} (${v.x}|${v.y}) #${v.id}: fields ${ago(v.fieldsAt, now)}, buildings ${ago(v.buildingsAt, now)}, troops ${ago(v.troopsAt, now)},`
      + ` stock ${ago(v.resourcesAt, now)} · builds ${(v.buildQueue || []).length} · training ${q}`
      + `${v.underAttack ? ' · UNDER ATTACK' : ''}${v.buildWait ? ` · build waits: ${v.buildWait.reason}` : ''}${v.autoSkip && v.autoSkip.until > now ? ` · skipping ${JSON.stringify(v.autoSkip.slots || [])}/${JSON.stringify(v.autoSkip.gids || [])}` : ''}`);
  }

  add();
  add('Jobs (last ok · last error · failures in 24h):');
  const jobs = Object.entries(h.jobs || {});
  if (!jobs.length) add('- none yet');
  for (const [type, j] of jobs) {
    const fails = (j.fails || []).filter((x) => now - x < 86400000).length;
    add(`- ${type}: ok ${ago(j.okAt, now)} · ${j.errAt ? `error ${ago(j.errAt, now)}: ${j.err}` : 'no error'} · ${fails}`);
  }
  for (const k of ['telegram', 'web', 'remote']) if (h[k]) add(`- service ${k}: ${h[k].ok ? 'ok' : 'FAILING'} ${ago(h[k].at, now)}${h[k].err ? ` (${h[k].err})` : ''}`);

  add();
  const m = acc.mapDiag;
  if (!m) add('Map: not read yet');
  else {
    add(`Map: last read ${ago(m.at, now)} around ${m.village}: ${m.ok ? 'OK' : 'FAILED'} · method ${m.method || '—'} · tiles ${m.tiles} · oases ${m.oases} · players ${m.players} · valleys ${m.valleys}`);
    for (const a of m.attempts || []) {
      add(`  - ${a.how}: ${a.ok ? 'ok' : 'failed'}${a.status ? ` · HTTP ${a.status}` : ''}${a.shape ? ` · ${a.shape}` : ''}${a.tiles != null ? ` · tiles ${a.tiles}` : ''}${a.error ? ` · ${a.error}` : ''}${a.body ? ` · ${a.body}` : ''}`);
    }
    for (const x of m.sample || []) add(`  sample: ${x}`);
  }

  add();
  const failed = (data.diag && data.diag.actions) || [];
  add(`Failed actions (${failed.length}):`);
  for (const f of failed) {
    const p = f.probe || {};
    add(`- ${clock(f.at)} ${f.kind}: ${f.code || f.reason || '?'}${f.status ? ` (HTTP ${f.status})` : ''}`);
    if (f.probe) {
      add(`    page ${p.path} · "${p.title}" · build ${p.build || '—'}`);
      add(`    forms [${(p.forms || []).join(', ')}] · buttons [${(p.buttons || []).join(' ')}]`);
      add(`    inputs [${(p.inputs || []).join(', ')}]`);
    }
  }

  add();
  const errors = (data.log || []).filter((e) => e.level === 'error' || e.level === 'alert').slice(0, 40);
  add(`Recent errors and alerts (${errors.length}):`);
  const names = Object.fromEntries(villages.map((v) => [v.id, v.name]));
  for (const e of errors) add(`- ${clock(e.t)} ${e.level}${e.villageId && names[e.villageId] ? ` [${names[e.villageId]}]` : ''}: ${e.msg}`);
  return lines.join('\n');
}
