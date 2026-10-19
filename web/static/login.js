// Login page: one password (APP_PASSWORD in Vercel). Also says what is
// still missing when the deployment isn't set up yet.
(function () {
  'use strict';
  const T = {
    ar: {
      title: 'مساعد ترافيان', intro: 'لوحة التحكم من أي مكان، ببيانات الإضافة التي تعمل في متصفحك.', password: 'كلمة مرور تطبيق الويب', login: 'دخول',
      travianNote: 'هذه ليست كلمة مرور ترافيان. كلمة مرور ترافيان لا تُطلب هنا ولا تُخزَّن على الخادم.',
      wrongPassword: 'كلمة المرور غير صحيحة', tooMany: 'محاولات كثيرة — انتظر 15 دقيقة', error: 'خطأ: {e}',
      noPassword: 'لم تُضبط كلمة المرور بعد', noPasswordHelp: 'في Vercel: Settings ← Environment Variables ← أضف APP_PASSWORD بكلمة مرور قوية، ثم أعد النشر (Redeploy).',
      noStore: 'لا توجد قاعدة بيانات بعد', noStoreHelp: 'في Vercel: Storage ← Upstash for Redis (مجاني) ← اربطه بهذا المشروع، ثم أعد النشر (Redeploy).',
    },
    en: {
      title: 'Travian Helper', intro: 'Your dashboard from anywhere, with the data of the extension running in your browser.', password: 'Web app password', login: 'Log in',
      travianNote: 'This is not your Travian password. Your Travian password is never asked for here or stored on the server.',
      wrongPassword: 'Wrong password', tooMany: 'Too many tries — wait 15 minutes', error: 'Error: {e}',
      noPassword: 'No password set yet', noPasswordHelp: 'In Vercel: Settings → Environment Variables → add APP_PASSWORD with a strong password, then Redeploy.',
      noStore: 'No database yet', noStoreHelp: 'In Vercel: Storage → Upstash for Redis (free) → connect it to this project, then Redeploy.',
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
  const next = () => {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/') && !n.startsWith('//') ? n : '/app/dashboard/dashboard.html';
  };
  const say = (text, tone) => { $('msg').textContent = text; $('msg').className = `msg ${tone || ''}`; };

  fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.json()).then((s) => {
    if (s.loggedIn) { location.replace(next()); return; }
    const missing = [];
    if (!s.setup.password) missing.push(`<b>${tr('noPassword')}</b>${tr('noPasswordHelp')}`);
    if (!s.setup.store) missing.push(`<b>${tr('noStore')}</b>${tr('noStoreHelp')}`);
    $('setup').hidden = !missing.length;
    $('setup').innerHTML = missing.join('<br>');
  }).catch((e) => say(tr('error', { e: e.message }), 'bad'));

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    say('');
    const r = await fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('password').value }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { location.replace(next()); return; }
    say(T[lang][j.code] ? tr(j.code) : tr('error', { e: j.error || r.status }), 'bad');
  });
})();
