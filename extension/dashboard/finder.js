// Farm lists page: inactive finder — players whose villages stopped growing,
// found by looking at the map twice, a day apart.
import { command, esc, fillSelect, editingIn } from '../src/ui.js';
import { sortedVillages, fmtAgo, fmtDuration, fmtNum } from '../src/shared.js';
import { t, coords, dateLocale } from '../src/i18n.js';
import { inactiveCandidates, trackingInfo } from '../src/inactive.js';
import { currentFarmList, readFarmTroops } from './farms.js';

const $ = (id) => document.getElementById(id);
let data = null;
let lastRows = '';

const when = (ts) => new Date(ts).toLocaleString(dateLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });

let chosen = null;

export function renderFinder(d, now) {
  data = d;
  const villages = sortedVillages(data.villages);
  const sc = data.schedule || {};
  // The player's own choice wins over the village being tracked.
  fillSelect($('finderVillage'), villages.map((v) => [v.id, `${v.name} ${coords(v.x, v.y)}`]), chosen || sc.finderVillage || undefined);
  const from = data.villages[$('finderVillage').value];
  const info = trackingInfo(data.mapVillages, now);
  const auto = data.settings.botEnabled || data.settings.autopilot.enabled || data.settings.brain.enabled;

  // Where tracking stands.
  const parts = [];
  if (!info.tracked) parts.push(t('finder.none'));
  else {
    parts.push(t('finder.tracked', { n: info.tracked, ago: fmtAgo(info.firstAt, now) }));
    if (!info.ready) parts.push(t('finder.readyAt', { when: when(info.readyAt) }));
  }
  if (sc.finderVillage && data.villages[sc.finderVillage]) {
    parts.push(auto ? t('finder.nextScan', { t: sc.finderScanAt > now ? fmtDuration(sc.finderScanAt - now) : t('ov.now') }) : t('finder.needsAuto'));
  }
  $('finderStatus').textContent = parts.join(' · ');
  $('finderStop').hidden = !sc.finderVillage;

  // Candidates.
  const radius = Number($('finderRadius').value) || 25;
  const list = from ? inactiveCandidates(data.mapVillages, from, { maxDistance: radius, now }) : [];
  const farm = currentFarmList();
  const inList = new Set(((farm && farm.targets) || []).map((x) => `${x.x}|${x.y}`));
  $('finderMeta').textContent = info.ready ? t('finder.found', { n: list.length }) : '';
  const head = ['finder.player', 'th.village', 'finder.coords', 'finder.pop', 'finder.dist', ''].map((k) => `<th>${k ? esc(t(k)) : ''}</th>`).join('');
  const rows = list.slice(0, 60).map((c) => `<tr>
      <td>${esc(c.player)}${c.alliance ? ` <small class="muted">[${esc(c.alliance)}]</small>` : ''}</td>
      <td>${esc(c.name)}</td>
      <td class="mono">${coords(c.x, c.y)}</td>
      <td class="mono">${fmtNum(c.pop)} <small class="muted">${esc(t('finder.change', { n: c.change > 0 ? `+${c.change}` : String(c.change), ago: fmtAgo(c.since, now) }))}</small></td>
      <td class="mono">${c.distance.toFixed(1)}</td>
      <td class="actions">${inList.has(`${c.x}|${c.y}`) ? `<span class="tag">${esc(t('finder.inList'))}</span>`
        : `<button class="btn small" data-finder-add="${c.x}|${c.y}" ${farm ? '' : 'disabled'}>${esc(t('finder.add'))}</button>`}</td>
    </tr>`).join('');
  const html = rows ? `<tr>${head}</tr>${rows}` : `<tr><td class="muted">${esc(t(info.ready ? 'finder.noneFound' : 'finder.waiting'))}</td></tr>`;
  if (html !== lastRows && !editingIn($('finderTable'))) { lastRows = html; $('finderTable').innerHTML = html; }
}

$('finderVillage').addEventListener('change', (e) => { chosen = e.target.value; rerender(); });
const say = (text, tone = 'muted') => { $('finderMsg').textContent = text; $('finderMsg').className = `small ${tone === 'bad' ? 'bad' : tone === 'good' ? 'good-text' : 'muted'}`; };
const rerender = () => window.dispatchEvent(new CustomEvent('tvh:rerender-all'));

$('finderScan').addEventListener('click', async () => {
  const id = $('finderVillage').value;
  if (!id) return;
  try { await command('finderScan', { villageId: id, radius: Number($('finderRadius').value) || 25 }); say(t('finder.scanning'), 'good'); } catch (err) { say(err.message, 'bad'); }
});
$('finderStop').addEventListener('click', () => command('finderStop'));
$('finderRadius').addEventListener('input', rerender);
$('finderVillage').addEventListener('change', rerender);
$('finderTable').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-finder-add]');
  if (!b) return;
  const farm = currentFarmList();
  if (!farm) { say(t('finder.needList'), 'bad'); return; }
  const troops = readFarmTroops();
  if (!Object.keys(troops).length) { say(t('finder.needTroops'), 'bad'); return; }
  const v = (data.mapVillages || {})[b.dataset.finderAdd];
  if (!v) return;
  b.disabled = true;
  try {
    const r = await command('addFarmTargets', { listId: farm.id, targets: [{ x: v.x, y: v.y, name: v.name, type: 'village', troops }] });
    say(r.added ? t('finder.added', { v: v.name, list: farm.name }) : t('finder.already'), r.added ? 'good' : 'muted');
  } catch (err) { say(err.message, 'bad'); b.disabled = false; }
});
