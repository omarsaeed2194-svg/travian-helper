// Runs before the extension's dashboard in the web app. Stands in for the
// few chrome.* calls the dashboard makes: reads come from what the
// extension last uploaded (/api/state), commands are queued for the
// extension (/api/command) and resolve with the result it sends back.
(function () {
  'use strict';
  document.documentElement.classList.add('web');

  const T = {
    ar: {
      dataFrom: 'آخر بيانات من متصفحك: {ago}', noData: 'لم تصل بيانات من الإضافة بعد', offline: 'متصفحك لم يتصل منذ {ago} — هل كروم مفتوح؟',
      waiting: 'أوامر في الانتظار: {n}', connect: 'ربط الإضافة', logout: 'خروج', sent: 'أُرسل إلى متصفحك…', done: 'تم في متصفحك',
      noAnswer: 'متصفحك لم يرد — هل كروم مفتوح والإضافة مربوطة؟', secret: 'يُغيَّر من لوحة الإضافة نفسها فقط',
      now: 'الآن', s: 'قبل {n} ث', m: 'قبل {n} د', h: 'قبل {n} س', d: 'قبل {n} يوم', error: 'خطأ: {e}',
    },
    en: {
      dataFrom: 'Last data from your browser: {ago}', noData: 'No data from the extension yet', offline: 'Your browser last checked in {ago} — is Chrome open?',
      waiting: '{n} commands waiting', connect: 'Connect extension', logout: 'Log out', sent: 'Sent to your browser…', done: 'Done in your browser',
      noAnswer: 'Your browser didn’t answer — is Chrome open with the extension connected?', secret: 'Changed in the extension’s own dashboard only',
      now: 'now', s: '{n} s ago', m: '{n} min ago', h: '{n} h ago', d: '{n} d ago', error: 'Error: {e}',
    },
  };
  let cache = null;
  let snapshotAt = 0;
  let info = { agent: null, results: [], pending: 0, now: Date.now() };
  let fastUntil = 0;
  let loaded = false;
  const listeners = [];
  const waiters = new Map();

  const lang = () => ((cache && cache.settings && cache.settings.language) || (navigator.language || '').slice(0, 2)) === 'en' ? 'en' : 'ar';
  const tr = (k, p = {}) => (T[lang()][k] || k).replace(/\{(\w+)\}/g, (_, x) => p[x]);
  const ago = (at) => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    return s < 10 ? tr('now') : s < 60 ? tr('s', { n: s }) : s < 3600 ? tr('m', { n: Math.round(s / 60) }) : s < 86400 ? tr('h', { n: Math.round(s / 3600) }) : tr('d', { n: Math.round(s / 86400) });
  };

  // ---- reading ----
  let beatAt = 0;
  async function fetchState() {
    const beat = Date.now() - beatAt > 30000;
    if (beat) beatAt = Date.now();
    const r = await fetch(`/api/state?since=${snapshotAt}${beat ? '&beat=1' : ''}${waiters.size ? '&results=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { location.href = `/?next=${encodeURIComponent(location.pathname + location.hash)}`; return; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    info = j;
    if (j.snapshot) {
      cache = j.snapshot;
      try { localStorage.setItem('th.lang', lang()); } catch (e) { /* blocked */ }
      const changed = j.snapshotAt !== snapshotAt;
      snapshotAt = j.snapshotAt;
      if (changed && loaded) for (const fn of listeners) { try { fn({ villages: {} }, 'local'); } catch (e) { console.error(e); } }
    }
    for (const r2 of j.results || []) {
      const w = waiters.get(r2.id);
      if (w) { waiters.delete(r2.id); w(r2); }
    }
  }
  const first = fetchState().catch((e) => { info.error = e.message; });
  (async function loop() {
    await first;
    for (;;) {
      await new Promise((r) => setTimeout(r, Date.now() < fastUntil || waiters.size ? 2000 : 8000));
      try { await fetchState(); info.error = null; } catch (e) { info.error = e.message; }
      bar();
    }
  })();

  const pick = (keys) => {
    const data = cache || {};
    if (keys == null) return { ...data };
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    const out = {};
    for (const k of list) if (data[k] !== undefined) out[k] = data[k];
    return out;
  };

  // ---- commands ----
  async function send(name, args) {
    const r = await fetch('/api/command', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = '/'; return { ok: false, error: j.error }; }
    if (!r.ok) return { ok: false, error: j.error || String(r.status) };
    toast(tr('sent'));
    fastUntil = Date.now() + 120000;
    const res = await new Promise((resolve) => {
      waiters.set(j.id, resolve);
      setTimeout(() => { if (waiters.delete(j.id)) resolve(null); }, 90000);
    });
    if (!res) return { ok: false, error: tr('noAnswer') };
    if (res.ok) toast(tr('done'));
    return res.ok ? { ok: true, result: res.result } : { ok: false, error: res.error };
  }

  const shim = {
    storage: {
      local: {
        get: async (keys) => { await first; return pick(keys); },
        set: async () => {},
        remove: async () => {},
        getBytesInUse: async () => (cache ? JSON.stringify(cache).length : 0),
      },
      sync: {
        get: async () => { await first; return { lease: (cache && cache.lease) || null }; },
        set: async () => {},
        remove: async () => {},
      },
      onChanged: { addListener: (fn) => { listeners.push(fn); loaded = true; } },
    },
    runtime: {
      getManifest: () => ({ version: (cache && cache.version) || '' }),
      getURL: (p) => `/app/${p}`,
      sendMessage: async (msg) => (msg && msg.type === 'COMMAND' ? send(msg.name, msg.args || {}) : undefined),
      openOptionsPage: () => { location.href = '/app/dashboard/dashboard.html'; },
    },
    tabs: { create: ({ url }) => { window.open(url, '_blank', 'noopener'); } },
  };
  try { window.chrome = shim; } catch (e) { /* read-only */ }
  if (window.chrome !== shim) Object.defineProperty(window, 'chrome', { value: shim, configurable: true });

  // ---- the bar on top, and a toast ----
  function bar() {
    let el = document.getElementById('webBar');
    if (!el) {
      if (!document.body) return;
      el = document.createElement('div');
      el.id = 'webBar';
      el.className = 'web-bar';
      el.innerHTML = '<span class="web-bar-info"></span><span class="web-bar-end"><a href="/connect.html" class="web-connect"></a><button type="button" class="web-logout"></button></span>';
      el.querySelector('.web-logout').addEventListener('click', async () => {
        await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
        location.href = '/';
      });
      document.body.prepend(el);
    }
    const agentAt = info.agent && info.agent.at;
    const late = agentAt && Date.now() - agentAt > 5 * 60000;
    const parts = [info.error ? tr('error', { e: info.error }) : !snapshotAt ? tr('noData') : late ? tr('offline', { ago: ago(agentAt) }) : tr('dataFrom', { ago: ago(snapshotAt) })];
    if (info.pending) parts.push(tr('waiting', { n: info.pending }));
    el.classList.toggle('warn', !!(info.error || !snapshotAt || late));
    el.querySelector('.web-bar-info').textContent = `🌐 ${parts.join(' · ')}`;
    el.querySelector('.web-connect').textContent = tr('connect');
    el.querySelector('.web-logout').textContent = tr('logout');
  }
  let toastTimer = null;
  function toast(text) {
    let el = document.getElementById('webToast');
    if (!el) { el = document.createElement('div'); el.id = 'webToast'; el.className = 'web-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  // Secrets (Telegram token, Discord address) never leave the extension.
  document.addEventListener('DOMContentLoaded', () => {
    bar();
    setInterval(bar, 1000);
    for (const sel of ['[data-setting="telegram.token"]', '[data-setting="telegram.chatId"]', '[data-setting="discord.webhookUrl"]']) {
      const input = document.querySelector(sel);
      if (input) { input.disabled = true; input.title = tr('secret'); }
    }
  });
})();
