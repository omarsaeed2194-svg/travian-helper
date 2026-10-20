import { loadAll, command, villageCard, villageRow, statusLine, esc, initTheme, nextTheme, themeIcon } from '../src/ui.js';
import { sortedVillages, fmtNum } from '../src/shared.js';
import { t, applyI18n } from '../src/i18n.js';
import { firstAttack } from '../src/escape.js';

initTheme();
const $ = (id) => document.getElementById(id);
let data = null;
let lang = null;
// Many villages → one line each (tap to open); the choice is remembered.
let view = (() => { try { return localStorage.getItem('tvh.popupView') || 'auto'; } catch (e) { return 'auto'; } })();
const expanded = new Set();
const busy = new Set(); // quick-action buttons waiting out their pause
let lastList = '';

const compact = (n) => (view === 'auto' ? n > 3 : view === 'compact');

function render() {
  if (!data) return;
  const now = Date.now();
  const s = data.settings;
  if (lang !== s.language) {
    lang = s.language;
    applyI18n();
    document.title = t('app.name');
  }
  $('server').textContent = s.server ? new URL(s.server).host : t('server.none');
  $('gold').textContent = data.account.gold != null ? t('gold', { n: fmtNum(data.account.gold) }) : '';
  const theme = s.theme || 'system';
  $('themeBtn').textContent = themeIcon(theme);
  $('themeBtn').title = t('theme.button', { name: t(`theme.${theme}`) });
  $('themeBtn').setAttribute('aria-label', $('themeBtn').title);
  $('watch').checked = s.watchEnabled;
  $('bot').checked = s.botEnabled;
  $('autopilot').checked = s.autopilot.enabled;
  const st = statusLine(data, now);
  $('status').className = `status ${st.tone}`;
  $('status').textContent = st.text;

  // Quick actions.
  const running = s.botEnabled || s.autopilot.enabled;
  $('qaPause').innerHTML = running ? `<span aria-hidden="true">⏸</span> ${esc(t('qa.pause'))}` : `<span aria-hidden="true">▶</span> ${esc(t('qa.resume'))}`;
  $('qaPause').dataset.action = running ? 'pause' : 'resume';
  const lists = data.farms.filter((l) => l.enabled !== false && (l.targets || []).some((x) => x.enabled !== false));
  $('qaFarms').disabled = busy.has('qaFarms') || !lists.length || !s.server;
  $('qaFarms').title = lists.length ? t('qa.farmsTitle', { n: lists.length }) : t('tg.noFarms');
  $('qaEscape').hidden = !data.escapes.some((p) => p.enabled !== false && data.villages[p.villageId] && firstAttack(data.villages[p.villageId], now));
  $('qaCheck').disabled = busy.has('qaCheck') || !s.server;

  const villages = sortedVillages(data.villages);
  // Attacked villages first.
  villages.sort((a, b) => Number(!!b.underAttack) - Number(!!a.underAttack));
  const small = compact(villages.length);
  $('villageCount').textContent = villages.length ? t('ov.villageCount', { n: villages.length }) : '';
  $('viewBtn').hidden = villages.length < 2;
  $('viewBtn').textContent = small ? t('popup.detailed') : t('popup.compact');
  const html = villages.length
    ? villages.map((v) => (small
      ? villageRow(v, data, now, expanded.has(v.id)) + (expanded.has(v.id) ? villageCard(v, data, now) : '')
      : villageCard(v, data, now))).join('')
    : `<div class="empty muted">${esc(t(s.server ? 'popup.emptyNoVillages' : 'popup.emptyNoServer'))}</div>`;
  if (html !== lastList) { lastList = html; $('villages').innerHTML = html; }
  $('villages').classList.toggle('compact', small);
}

async function reload() {
  data = await loadAll();
  render();
}

function say(text, tone = '') {
  $('qaMsg').textContent = text;
  $('qaMsg').className = `small qa-msg ${tone || 'muted'}`;
}

// Runs a quick action with its button disabled for a moment (the
// once-a-second redraw keeps it so, against double clicks).
async function quick(btn, fn) {
  busy.add(btn.id);
  btn.disabled = true;
  try { say(await fn(), 'good-text'); } catch (err) { say(err.message, 'bad'); }
  setTimeout(() => { busy.delete(btn.id); btn.disabled = false; render(); }, 2000);
}

$('watch').addEventListener('change', (e) => command('saveSettings', { settings: { watchEnabled: e.target.checked } }));
$('bot').addEventListener('change', (e) => command('saveSettings', { settings: { botEnabled: e.target.checked } }));
$('autopilot').addEventListener('change', (e) => command('saveSettings', { settings: { autopilot: { ...data.settings.autopilot, enabled: e.target.checked } } }));
$('qaCheck').addEventListener('click', (e) => quick(e.currentTarget, async () => { await command('runNow'); return t('tg.checking'); }));
$('qaFarms').addEventListener('click', (e) => quick(e.currentTarget, async () => {
  const n = await command('sendAllFarms');
  return n ? t('tg.farmsQueued', { n }) : t('tg.noFarms');
}));
$('qaPause').addEventListener('click', (e) => quick(e.currentTarget, async () => {
  if ($('qaPause').dataset.action === 'pause') { await command('pauseAll'); return t('qa.paused'); }
  await command('resumeAll');
  return t('qa.resumed');
}));
$('qaEscape').addEventListener('click', (e) => quick(e.currentTarget, async () => {
  const names = await command('escapeNow');
  return names.length ? t('tg.escaping', { list: names.join(t('list.sep')) }) : t('tg.noEscape');
}));
$('themeBtn').addEventListener('click', () => command('saveSettings', { settings: { theme: nextTheme(data.settings.theme || 'system') } }));
$('viewBtn').addEventListener('click', () => {
  view = compact(Object.keys(data.villages).length) ? 'full' : 'compact';
  try { localStorage.setItem('tvh.popupView', view); } catch (e) { /* storage blocked */ }
  render();
});
// Rows redraw every second (timers), so a mouse press toggles at once
// rather than waiting for a click that may land on a replaced row;
// keyboard presses come as clicks with no pointer (detail 0).
function toggleRow(e) {
  const row = e.target.closest('[data-expand]');
  if (!row) return;
  const id = row.dataset.expand;
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  render();
}
$('villages').addEventListener('pointerdown', (e) => { if (e.button === 0) toggleRow(e); });
$('villages').addEventListener('click', (e) => { if (e.detail === 0) toggleRow(e); });
$('openDashboard').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('openGame').addEventListener('click', () => {
  const url = data && data.settings.server ? `${data.settings.server}/dorf1.php` : 'https://www.travian.com/';
  chrome.tabs.create({ url });
});

chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') reload(); });
setInterval(render, 1000);
reload();
