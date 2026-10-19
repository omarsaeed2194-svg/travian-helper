// Health tab: whether the extension is running, what's switched off and
// why, how each job did, recent errors and how fresh the data is.
import { esc } from '../src/ui.js';
import { fmtAgo } from '../src/shared.js';
import { t } from '../src/i18n.js';
import { healthReport } from '../src/health.js';

const $ = (id) => document.getElementById(id);
const MARK = { good: '✓', warn: '!', bad: '✕', muted: '–' };
let bytes = null;
let bytesAt = 0;
let last = '';

async function storageUse() {
  if (Date.now() - bytesAt < 30000) return;
  bytesAt = Date.now();
  try { bytes = await chrome.storage.local.getBytesInUse(null); } catch (e) { bytes = null; }
}

const rowHtml = (r) => `<li class="hl-row t-${r.tone}">
    <span class="hl-mark" aria-hidden="true">${MARK[r.tone] || ''}</span>
    <span class="hl-label">${r.tab ? `<a href="#${r.tab}">${esc(r.label)}</a>` : esc(r.label)}</span>
    <span class="hl-value">${esc(r.value)}</span>
    ${r.detail ? `<span class="hl-detail">${esc(r.detail)}</span>` : ''}
  </li>`;

export function renderHealth(data, now) {
  storageUse();
  const rep = healthReport(data, now);
  const rows = rep.sections.filter((s) => s.key !== 'errors').flatMap((s) => s.rows);
  const count = (tone) => rows.filter((r) => r.tone === tone).length;
  const nav = document.querySelector('.tabs a[data-tab="health"]');
  if (nav) nav.dataset.tone = rep.tone;
  const title = rep.tone === 'good' ? t('health.allGood') : rep.tone === 'bad' ? t('health.problems', { n: count('bad') }) : t('health.attention', { n: count('warn') });
  const sub = [
    data.status.lastRunAt ? t('health.lastRunAgo', { ago: fmtAgo(data.status.lastRunAt, now) }) : '',
    rep.errors ? t('health.errorsToday', { n: rep.errors }) : t('health.noErrors'),
    bytes != null ? t('health.storage', { kb: Math.round(bytes / 1024) }) : '',
    t('app.version', { v: chrome.runtime.getManifest().version }),
  ].filter(Boolean).join(' · ');
  const head = `<span class="hh-mark" aria-hidden="true">${MARK[rep.tone]}</span><div><h2>${esc(title)}</h2><p class="muted small">${esc(sub)}</p></div>`;
  const body = rep.sections.map((s) => `<section class="panel hl-section" data-section="${s.key}">
      <header class="panel-head"><h2>${esc(s.title)}</h2>${s.count ? `<span class="muted small">${esc(t('health.inDay', { n: s.count }))}</span>` : ''}</header>
      ${s.rows.length ? `<ul class="hl-list">${s.rows.map(rowHtml).join('')}</ul>` : `<p class="muted small">${esc(s.empty || '')}</p>`}
      ${s.key === 'errors' && s.count ? `<a href="#log" class="small">${esc(t('ov.allActivity'))}</a>` : ''}
    </section>`).join('');
  // Only touch the page when something changed (keeps text selectable).
  $('healthHead').className = `panel health-head t-${rep.tone}`;
  if ($('healthHead').innerHTML !== head) $('healthHead').innerHTML = head;
  if (last !== body) { last = body; $('healthSections').innerHTML = body; }
}
