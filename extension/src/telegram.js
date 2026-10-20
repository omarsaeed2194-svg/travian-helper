// Telegram control: which command a message is, and the texts sent back
// (status, morning summary, help). No network here; the background worker
// polls Telegram and acts on the command.
import { RESOURCES, resLabel, capacityFor, estimateStock, hoursUntilLimit, fmtDuration, fmtClock, fmtNum, sortedVillages } from './shared.js';
import { t } from './i18n.js';
import { firstAttack, escapeStatus, donateStatus } from './escape.js';
import { expansionEta } from './culture.js';

// Commands answer to English or Arabic words, with or without "/".
const WORDS = {
  status: ['status', 'state', 'الحالة', 'حالة', 'الوضع'],
  pause: ['pause', 'stop', 'وقف', 'وقّف', 'ايقاف', 'إيقاف', 'اوقف', 'أوقف'],
  resume: ['resume', 'go', 'شغل', 'شغّل', 'تشغيل', 'كمل', 'كمّل'],
  check: ['check', 'refresh', 'افحص', 'فحص'],
  farms: ['farms', 'farm', 'raid', 'مزارع', 'المزارع', 'ارسل', 'أرسل', 'غارات'],
  escape: ['escape', 'dodge', 'اهرب', 'هروب', 'اهربوا'],
  summary: ['summary', 'report', 'ملخص', 'تقرير'],
  help: ['help', 'commands', 'start', 'start_help', 'مساعدة', 'اوامر', 'أوامر', 'الاوامر', 'الأوامر'],
};
// Spelling that varies when typed: diacritics and tatweel, direction marks,
// alef forms, ة/ه and ى/ي, and punctuation at the end ("الحالة؟").
const strip = (s) => s.replace(/[\u064b-\u0652\u0640\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[؟?!.,،:;]+$/, '').toLowerCase();

export function parseCommand(text) {
  const word = strip(String(text || '').trim().replace(/^\//, '').split(/[\s@]/)[0]);
  for (const [cmd, list] of Object.entries(WORDS)) if (list.some((w) => strip(w) === word)) return cmd;
  return null;
}

const pct = (v, k, now) => {
  const est = estimateStock(v, now);
  const cap = v.resources && capacityFor(v.resources, k);
  return est && cap ? Math.round((est[k] / cap) * 100) : null;
};

// "Villages 2/3 · 45 % to the next · about 1d 4h".
function slotsLine(data, now) {
  const ex = data.account && data.account.expansion;
  if (!ex || ex.total == null) return null;
  const eta = expansionEta(data.account.cpHistory, now);
  return `🏛 ${t('tg.slots', { used: ex.used, total: ex.total, pct: Math.round(ex.pct || 0) })}${eta ? ` · ${fmtDuration(eta.at - now)}` : ''}`;
}

// One block per village: attacks, storage, building, escape plan.
export function statusText(data, now = Date.now()) {
  const s = data.settings;
  const lines = [t('tg.statusHead'), ''];
  const auto = s.autopilot.enabled ? t('tg.autopilotOn') : s.botEnabled ? t('tg.botOn') : t('tg.botOff');
  lines.push(`${t('tg.automation')}: ${auto}`);
  if (data.status && data.status.loggedOut) lines.push(`⚠️ ${t('status.loggedOut')}`);
  const slots = slotsLine(data, now);
  if (slots) lines.push(slots);
  for (const v of sortedVillages(data.villages)) {
    lines.push('', `🏰 ${v.name}`);
    const first = firstAttack(v, now);
    if (v.underAttack) lines.push(`⚔️ ${first ? t('tg.attackIn', { t: fmtDuration(first - now), clock: fmtClock(first) }) : t('tg.attackUnknown')}`);
    const plan = (data.escapes || []).find((p) => p.villageId === v.id);
    const esc = escapeStatus(v, plan, data.villages, now);
    if (esc && esc.tone !== 'muted') lines.push(`${plan.troops === false ? '💰' : '🏃'} ${esc.text}`);
    const dn = plan && plan.troops !== false ? donateStatus(v, plan, now) : null;
    if (dn && dn.tone !== 'muted') lines.push(`💰 ${dn.text}`);
    const res = RESOURCES.map((k) => { const p = pct(v, k, now); return p == null ? null : `${resLabel(k)} ${p}%`; }).filter(Boolean);
    if (res.length) lines.push(`📦 ${res.join(' · ')}`);
    const crop = v.resources && v.resources.production ? v.resources.production.crop : null;
    if (crop != null && crop < 0) lines.push(`🌾 ${t('tg.starving', { p: crop })}`);
    const active = (v.buildQueue || []).filter((b) => b.finishAt && b.finishAt > now);
    lines.push(active.length ? `🏗 ${active.map((b) => `${b.name} ${b.level ?? ''} (${fmtDuration(b.finishAt - now)})`).join(' · ')}` : `🏗 ${t('card.idle')}`);
  }
  return lines.join('\n');
}

// The morning summary: what happened since the last one, then right now.
export function summaryText(data, stats, now = Date.now()) {
  const hours = Math.max(1, Math.round((now - (stats.since || now - 86400000)) / 3600000));
  const lines = [t('tg.summaryHead', { h: hours }), ''];
  const row = (icon, key, n) => { if (n) lines.push(`${icon} ${t(key, { n: fmtNum(n) })}`); };
  row('✅', 'tg.sumCompleted', stats.completed);
  row('🏗', 'tg.sumUpgrades', stats.upgrades);
  row('🛡', 'tg.sumTrained', stats.trained);
  row('🩹', 'tg.sumHealed', stats.healed);
  row('🐎', 'tg.sumFarm', stats.farm);
  row('🌿', 'tg.sumRaids', stats.raids);
  row('⚔️', 'tg.sumAttacks', stats.attacks);
  row('🏃', 'tg.sumEscapes', stats.escapes);
  row('💰', 'tg.sumDonations', stats.donations);
  row('🎉', 'tg.sumCelebrations', stats.celebrations);
  row('🎁', 'tg.sumQuests', stats.quests);
  row('🎒', 'tg.sumHeroBag', stats.heroBag);
  row('⚠️', 'tg.sumErrors', stats.errors);
  if (lines.length === 2) lines.push(t('tg.sumQuiet'));
  const slots = slotsLine(data, now);
  if (slots) lines.push('', slots);
  // Right now: anything that needs the player.
  const now_ = [];
  for (const v of sortedVillages(data.villages)) {
    if (v.underAttack) now_.push(`⚔️ ${v.name}: ${t('card.attack')}`);
    for (const k of RESOURCES) {
      const h = v.resources && v.resources.production && v.resources.production[k] > 0 ? hoursUntilLimit(v, k, now) : null;
      if (h != null && h <= 1) { now_.push(`📦 ${v.name}: ${h <= 0 ? `${resLabel(k)} — ${t('card.full')}` : t('tg.fullSoon', { res: resLabel(k), t: fmtDuration(h * 3600000) })}`); break; }
    }
    if (v.buildQueue && !(v.buildQueue || []).some((b) => b.finishAt && b.finishAt > now) && !(data.tasks[v.id] || []).length && !(data.settings.autopilot.enabled && data.settings.autopilot.build)) {
      now_.push(`🏗 ${v.name}: ${t('card.idle')}`);
    }
  }
  if (now_.length) lines.push('', t('tg.needsYou'), ...now_);
  return lines.join('\n');
}

export function helpText() {
  return [t('tg.helpHead'), '', ...['status', 'pause', 'resume', 'check', 'farms', 'escape', 'summary'].map((c) => `• ${t(`tg.help.${c}`)}`)].join('\n');
}
