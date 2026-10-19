// Connect page: a key for the extension (shown once), the web app's
// address, and whether the extension has checked in.
(function () {
  'use strict';
  const T = {
    ar: {
      title: 'ربط الإضافة', intro: 'الإضافة في متصفحك ترسل بيانات حسابك إلى هنا وتنفّذ الأوامر التي ترسلها من هنا. كلمة مرور ترافيان تبقى في متصفحك.',
      step1: 'اضغط «إنشاء مفتاح» وانسخه.', step2: 'في لوحة تحكم الإضافة: الإعدادات ← «تطبيق الويب» ← الصق العنوان والمفتاح ← حفظ.', step3: 'خلال دقيقة تظهر هنا «الإضافة متصلة»، وتظهر بياناتك في لوحة التحكم.',
      address: 'عنوان تطبيق الويب', makeKey: 'إنشاء مفتاح', newKeyBtn: 'مفتاح جديد', copy: 'نسخ', copied: 'تم النسخ', toDashboard: 'لوحة التحكم',
      keyNone: 'لا يوجد مفتاح بعد.', keyExists: 'يوجد مفتاح أُنشئ {when}. المفتاح الجديد يُبطل القديم.', keyOnce: 'انسخه الآن: لن يظهر مرة أخرى.',
      confirmNew: 'المفتاح الحالي سيتوقف عن العمل. متابعة؟', agentNever: 'الإضافة لم تتصل بعد.', agentSeen: 'الإضافة متصلة — آخر اتصال {ago} (الإصدار {v}، {d}).', agentLate: 'آخر اتصال من الإضافة {ago} — هل كروم مفتوح؟',
      now: 'الآن', ago: 'قبل {n} د', error: 'خطأ: {e}',
    },
    en: {
      title: 'Connect the extension', intro: 'The extension in your browser sends your account data here and runs the commands you send from here. Your Travian password stays in your browser.',
      step1: 'Press “Create key” and copy it.', step2: 'In the extension’s dashboard: Settings → “Web app” → paste the address and the key → Save.', step3: 'Within a minute this page says “Extension connected”, and your data shows in the dashboard.',
      address: 'Web app address', makeKey: 'Create key', newKeyBtn: 'New key', copy: 'Copy', copied: 'Copied', toDashboard: 'Dashboard',
      keyNone: 'No key yet.', keyExists: 'A key exists, created {when}. A new key stops the old one.', keyOnce: 'Copy it now: it won’t be shown again.',
      confirmNew: 'The current key will stop working. Continue?', agentNever: 'The extension hasn’t checked in yet.', agentSeen: 'Extension connected — last check-in {ago} (version {v}, {d}).', agentLate: 'The extension last checked in {ago} — is Chrome open?',
      now: 'now', ago: '{n} min ago', error: 'Error: {e}',
    },
  };
  let lang = 'ar';
  try { lang = localStorage.getItem('th.lang') || ((navigator.language || '').startsWith('ar') ? 'ar' : 'en'); } catch (e) { /* blocked */ }
  try { const th = localStorage.getItem('tvh.theme'); if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; } catch (e) { /* blocked */ }
  const tr = (k, p = {}) => (T[lang][k] || k).replace(/\{(\w+)\}/g, (_, x) => p[x]);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = tr(el.dataset.t);
  const $ = (id) => document.getElementById(id);
  const say = (text, tone) => { $('msg').textContent = text; $('msg').className = `msg ${tone || ''}`; };
  const ago = (at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? tr('now') : tr('ago', { n: m }); };
  $('address').textContent = location.origin;
  let exists = false;

  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts });
    if (r.status === 401) { location.href = `/?next=${encodeURIComponent('/connect.html')}`; throw new Error('login'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  }
  async function keyState() {
    const k = await api('/api/key');
    exists = k.exists;
    $('keyState').textContent = k.exists ? tr('keyExists', { when: new Date(k.createdAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB') }) : tr('keyNone');
    $('makeKey').textContent = tr(k.exists ? 'newKeyBtn' : 'makeKey');
  }
  async function agent() {
    try {
      const s = await api('/api/state?beat=1');
      const a = s.agent;
      $('agent').textContent = !a ? tr('agentNever') : Date.now() - a.at > 5 * 60000 ? tr('agentLate', { ago: ago(a.at) }) : tr('agentSeen', { ago: ago(a.at), v: a.version || '?', d: a.device || '?' });
      $('agent').className = `note ${a && Date.now() - a.at <= 5 * 60000 ? 'msg good' : ''}`;
    } catch (e) { /* shown elsewhere */ }
  }
  $('makeKey').addEventListener('click', async () => {
    if (exists && !confirm(tr('confirmNew'))) return;
    try {
      const { key } = await api('/api/key', { method: 'POST' });
      $('newKey').textContent = key;
      $('newKey').hidden = false;
      $('keyOnce').hidden = false;
      $('copyKey').hidden = false;
      say('');
      await keyState();
    } catch (e) { say(tr('error', { e: e.message }), 'bad'); }
  });
  $('copyKey').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('newKey').textContent); say(tr('copied'), 'good'); } catch (e) { say(tr('error', { e: e.message }), 'bad'); }
  });
  keyState().catch((e) => say(tr('error', { e: e.message }), 'bad'));
  agent();
  setInterval(agent, 5000);
})();
