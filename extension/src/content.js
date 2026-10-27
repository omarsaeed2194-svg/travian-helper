// Runs on every Travian page. Reports what the page shows to the background
// worker, and performs clicks the background asks for on the bot tab.
(() => {
  'use strict';
  const P = globalThis.TravianParser;
  // Every wait ends with a hop through a message, so timers never chain: in
  // a hidden tab (the bot's own) Chrome holds a chain of five or more timers
  // to one wake-up a minute once the tab has been hidden for five minutes,
  // which would stall every action with several steps.
  const hop = () => new Promise((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => { c.port1.close(); r(); };
    c.port2.postMessage(0);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)).then(hop);
  const rand = (a, b) => a + Math.random() * (b - a);

  async function waitFor(fn, timeout = 8000, step = 250) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v || Date.now() > end) return v;
      await sleep(step);
    }
  }

  async function report() {
    const url = new URL(location.href);
    // These two pages are rendered client-side after load.
    if (url.pathname.startsWith('/hero/adventures')) {
      await waitFor(() => document.querySelector('#heroAdventure tbody tr'));
    }
    if (url.searchParams.get('tt') === '99') {
      await waitFor(() => document.querySelector('#rallyPointFarmList .farmListHeader'));
    }
    if (url.pathname === '/tasks') await waitFor(() => document.querySelector('.taskOverview'));
    if (url.pathname.startsWith('/hero/inventory')) {
      await waitFor(() => document.querySelector('.heroItems') && !document.querySelector('.inventoryPageWrapper.loading'));
    }
    const state = P.parsePage(document, location.href);
    // When this page started loading: lets the background tell a late
    // report of the page before from the one a job is waiting for.
    state.loadedAt = Math.round(performance.timeOrigin || Date.now());
    // Not a game page (captcha, maintenance, error): say so, so a job
    // waiting for a page learns at once instead of after its timeout.
    if (state.type === 'unknown') state.title = document.title.slice(0, 80);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'PAGE', state });
      if (res && res.worker) showWorkerBadge(res.badge);
    } catch (e) {
      // Extension reloaded or worker unavailable; nothing to do.
    }
  }

  // Only real clicks and key presses mean the player is here. Page loads
  // don't: the game reloads itself whenever a build or troop timer ends.
  let lastActivePing = 0;
  function onUserInput(e) {
    if (!e.isTrusted || Date.now() - lastActivePing < 20000) return;
    lastActivePing = Date.now();
    chrome.runtime.sendMessage({ type: 'USER_ACTIVE' }).catch(() => {});
  }
  window.addEventListener('pointerdown', onUserInput, { capture: true, passive: true });
  window.addEventListener('keydown', onUserInput, { capture: true, passive: true });

  function showWorkerBadge(label) {
    if (document.getElementById('tvh-worker-badge')) return;
    const el = document.createElement('div');
    el.id = 'tvh-worker-badge';
    el.textContent = label || 'Travian Helper';
    el.style.cssText = 'position:fixed;inset-inline-start:12px;bottom:12px;z-index:99999;padding:6px 10px;border-radius:6px;' +
      'background:#1f2937;color:#fff;font:12px/1.3 system-ui,sans-serif;opacity:.85;pointer-events:none';
    document.body.appendChild(el);
  }

  const usable = (b) => b && !b.disabled && !b.classList.contains('disabled');

  function setValue(input, value) {
    input.focus();
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // The game version the map API expects in its X-Version header: inline
  // on older pages; on newer ones only in the asset paths (gpack/655.4/).
  function gameVersion() {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const m = s.textContent.match(/Travian\.Game\.version\s*=\s*['"]([^'"]+)['"]/) ||
        s.textContent.match(/["']?gameVersion["']?\s*[:=]\s*['"]([^'"]+)['"]/);
      if (m) return m[1];
    }
    for (const el of document.querySelectorAll('link[href*="gpack/"], script[src*="gpack/"], img[src*="gpack/"]')) {
      const m = (el.getAttribute('href') || el.getAttribute('src') || '').match(/gpack\/(\d+(?:\.\d+)*)\//);
      if (m) return m[1];
    }
    return null;
  }

  // The send form's mission radios: name="eventType" on current servers
  // (5 reinforcement, 3 attack, 4 raid), name="c" on older ones (2, 3, 4).
  const MISSIONS = {
    reinforce: { radios: [['eventType', 5], ['eventType', 2], ['c', 2]], values: [5, 2] },
    attack: { radios: [['eventType', 3], ['c', 3]], values: [3] },
    raid: { radios: [['eventType', 4], ['c', 4]], values: [4] },
  };
  const missionRadio = (form, mission) => MISSIONS[mission].radios
    .map(([name, value]) => form.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`)).find(Boolean) || null;

  const troopInput = (root, field) =>
    Array.from(root.querySelectorAll('input[name^="troop["], input[name^="troops["]'))
      .find((i) => i.type !== 'hidden' && i.getAttribute('name').endsWith(`[${field}]`));

  // The alliance bonus form as the game draws it.
  const BONUSES = ['TroopProductionSpeed', 'CPProduction', 'SmithyPower', 'MerchantCapacity'];
  async function donateForm(form, amounts, bonus) {
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    if (val('limitReached') === '1') return { ok: false, code: 'donateLimit' };
    const radios = Array.from(form.querySelectorAll('input[type="radio"][name="bonus"]'));
    const radio = radios.find((r) => r.value === BONUSES[bonus]) || radios.find((r) => r.checked) || radios[0];
    if (!radio) return { ok: false, code: 'noDonateForm' };
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(rand(300, 700));
    // What's left of today's limit, and each input's own maximum.
    const left = Math.max(0, Number(val('dailyLimit') || Infinity) - Number(val('donatedToday') || 0));
    const keys = ['wood', 'clay', 'iron', 'crop'];
    const want = keys.map((k) => Math.max(0, Math.floor((amounts && amounts[k]) || 0)));
    const total = want.reduce((n, x) => n + x, 0);
    const scale = total > left ? left / total : 1;
    const sent = {};
    for (let i = 0; i < 4; i++) {
      const input = document.getElementById(`donate${i + 1}`);
      if (!input) return { ok: false, code: 'noDonateForm' };
      const max = Number(((input.getAttribute('onkeyup') || '').match(/,\s*(\d+)\s*,/) || [])[1]);
      let n = Math.floor(want[i] * scale);
      if (Number.isFinite(max)) n = Math.min(n, max);
      sent[keys[i]] = n;
      setValue(input, n);
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
      await sleep(rand(150, 400));
    }
    if (!Object.values(sent).some((n) => n > 0)) return { ok: false, code: 'donateLimit' };
    const btn = await waitFor(() => { const b = document.getElementById('donate_green'); return b && usable(b) ? b : null; }, 3000);
    if (!btn) return { ok: false, code: 'noDonateButton' };
    const box = document.querySelector('.bonus-donation-response');
    const before = box ? box.textContent : '';
    // The page's own count of what was given today: the surest check.
    const donatedBefore = donatedToday();
    btn.click();
    await waitFor(() => (box && box.textContent.trim() && box.textContent !== before) || document.querySelector('.toast.toastSuccess')
      || (donatedBefore != null && donatedToday() > donatedBefore), 8000);
    return { ok: true, sent, message: box ? box.textContent.trim().slice(0, 200) : '', donatedBefore, donatedAfter: donatedToday() };
  }
  // Given today: the shown count and the hidden field; whichever the game
  // updated after a donation is the higher one.
  function donatedToday() {
    const shown = document.querySelector('#dailyContributionTitleText .donationValueNumber, .donationValueNumber');
    const el = document.getElementById('donatedToday');
    const vals = [shown ? P.num(shown.textContent) : null, el && el.value !== '' ? Number(el.value) : null].filter((n) => Number.isFinite(n));
    return vals.length ? Math.max(...vals) : null;
  }

  // Map tiles the game loaded on the map page, passed on by mapHook.js.
  const mapTiles = new Map();
  const mapNotes = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.source === 'tvh-map-note' && e.data.note && mapNotes.length < 30) mapNotes.push(e.data.note);
    if (e.data.source !== 'tvh-map' || !Array.isArray(e.data.tiles)) return;
    addTiles(e.data.tiles);
  });
  // What was read, with a summary of the kinds of tiles and one raw example
  // of each (shortened) for the diagnostics report: if the game's format
  // differs from what the readers expect, this shows how.
  const readTiles = (tiles) => {
    const sum = P.tileSummary(tiles);
    return { tiles: tiles.length, oases: P.oasesFromTiles(tiles), villages: P.villagesFromTiles(tiles), valleys: P.valleysFromTiles(tiles), sample: sum.samples, summary: sum.line };
  };

  // The page's own world (pageBridge.js, mapHook.js on the map page):
  // a request there and its answer.
  function pageAsk(source, payload, replySource, timeout) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const done = (result) => { window.removeEventListener('message', on); clearTimeout(timer); resolve(result); };
      const on = (e) => { if (e.source === window && e.data && e.data.source === replySource && e.data.id === id) done(e.data); };
      const timer = setTimeout(() => done(null), timeout);
      window.addEventListener('message', on);
      window.postMessage({ source, id, ...payload }, location.origin);
    });
  }
  async function gameVersionLive() {
    const r = await pageAsk('tvh-bridge', { kind: 'gameInfo' }, 'tvh-bridge-reply', 3000);
    return (r && r.result && r.result.version) || gameVersion();
  }

  // The extension's own map request around (x, y), as a fallback when the
  // map page can't be read.
  async function mapAt(x, y, version) {
    const headers = { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' };
    if (version) headers['X-Version'] = version;
    const how = `request${version ? ` v${version}` : ' (no version)'}`;
    let res;
    try {
      res = await fetch('/api/v1/map/position', {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ data: { x, y, zoomLevel: 3, ignorePositions: [] } }),
      });
    } catch (e) {
      return { diag: [{ how, ok: false, error: e.message }] };
    }
    const json = await res.json().catch(() => null);
    const tiles = P.findTiles(json) || [];
    const diag = [{ how, ok: res.ok && tiles.length > 0, status: res.status, shape: P.shapeOf(json), tiles: tiles.length, ...(res.ok ? {} : { body: JSON.stringify(json).slice(0, 300) }) }];
    return res.ok && tiles.length ? { tiles, diag } : { diag, status: res.status };
  }

  const addTiles = (list) => {
    for (const tile of list || []) {
      const pos = tile && (tile.position || tile);
      if (pos && pos.x != null && pos.y != null && mapTiles.size < 80000) mapTiles.set(`${pos.x}|${pos.y}`, tile);
    }
  };

  const actions = {
    async upgrade() {
      // Not the "faster with a video" button next to it (opens a video, no new page).
      const btn = document.querySelector('.upgradeButtonsContainer .section1 button.build:not(.videoFeatureButton)') ||
        document.querySelector('.upgradeButtonsContainer button.green.build:not(.videoFeatureButton)');
      if (!usable(btn)) return { ok: false, code: 'noUpgradeButton' };
      setTimeout(() => btn.click(), 50);
      return { ok: true, navigating: true };
    },

    // Hospital: every wounded unit, as many as the resources allow (each
    // box's own maximum), then the green button.
    async heal() {
      let total = 0;
      const sent = {};
      for (const input of document.querySelectorAll('.troop:not(.empty) .cta input.text[name^="t"]')) {
        const link = input.closest('.cta').querySelector('a');
        const max = link ? Number(String(link.textContent).replace(/[^\d]/g, '')) || 0 : 0;
        if (max < 1 || input.disabled) continue;
        setValue(input, max);
        sent[input.getAttribute('name')] = max;
        total += max;
        await sleep(rand(150, 400));
      }
      if (!total) return { ok: false, code: 'nothingToHeal' };
      const submit = document.getElementById('s1') || document.querySelector('#content form button.green[type="submit"]');
      if (!usable(submit)) return { ok: false, code: 'noHealButton' };
      await sleep(rand(300, 800));
      setTimeout(() => submit.click(), 50);
      return { ok: true, navigating: true, sent, total };
    },

    // Marketplace, "send resources": the four amounts and the target, then
    // the game's check (it shows the trip, no new page), then send.
    async sendResources({ x, y, amounts }) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, code: 'badField' };
      const inputs = ['r1', 'r2', 'r3', 'r4'].map((n) => document.getElementById(n) || document.querySelector(`input[name="${n}"]`));
      if (inputs.some((i) => !i || i.disabled)) return { ok: false, code: 'noMarketForm' };
      const xIn = document.querySelector('#xCoordInput, input[name="x"]');
      const yIn = document.querySelector('#yCoordInput, input[name="y"]');
      if (!xIn || !yIn) return { ok: false, code: 'noCoordInput' };
      const order = ['wood', 'clay', 'iron', 'crop'];
      for (const [i, input] of inputs.entries()) {
        const n = Math.max(0, Math.floor(Number((amounts || {})[order[i]]) || 0));
        setValue(input, n ? n : '');
        await sleep(rand(150, 400));
      }
      setValue(xIn, x);
      setValue(yIn, y);
      await sleep(rand(300, 700));
      const prepare = document.getElementById('enabledButton') || document.querySelector('#build form button.green.prepare, #build form button.green[type="submit"], #build button.green.send');
      if (!usable(prepare)) return { ok: false, code: 'noPrepareButton' };
      prepare.click();
      const end = Date.now() + 8000;
      for (;;) {
        await sleep(300);
        if (document.getElementById('target_validate')) break;
        const err = document.querySelector('#prepareError, .prepareError');
        if (err && err.textContent.trim()) return { ok: false, code: 'marketRefused', reason: err.textContent.trim().slice(0, 160) };
        if (Date.now() > end) return { ok: false, code: 'noTripShown' };
      }
      await sleep(rand(500, 1100));
      const send = document.getElementById('enabledButton') || document.querySelector('#build button.green.send, #build form button.green[type="submit"]');
      if (!usable(send)) return { ok: false, code: 'noSendButton' };
      setTimeout(() => send.click(), 50);
      return { ok: true };
    },

    // Academy / Smithy: the green button in the box of this unit.
    async research({ unit }) {
      if (!/^u\d+$/.test(String(unit || ''))) return { ok: false, code: 'badUnit' };
      const box = Array.from(document.querySelectorAll('#build .research, .build_details .research'))
        .find((b) => b.querySelector(`img.unit.${unit}`));
      if (!box) return { ok: false, code: 'noResearch' };
      const btn = box.querySelector('.cta button.green, button.green.build, button.green');
      if (!usable(btn)) return { ok: false, code: 'noResearchButton' };
      await sleep(rand(300, 800));
      setTimeout(() => btn.click(), 50);
      return { ok: true, navigating: true };
    },

    async train({ field, amount }) {
      if (!/^t\d+$/.test(field)) return { ok: false, code: 'badField' };
      const input = document.querySelector(`.troop:not(.empty) .cta input.text[name="${field}"]`);
      const submit = document.getElementById('s1');
      if (!input || !usable(submit)) return { ok: false, code: 'noTrainForm' };
      setValue(input, amount);
      await sleep(rand(300, 800));
      setTimeout(() => submit.click(), 50);
      return { ok: true, navigating: true };
    },

    async farm({ ids, villageName }) {
      const root = await waitFor(() => document.getElementById('rallyPointFarmList'));
      if (!root) return { ok: false, code: 'noFarmPage' };
      let buttons;
      let startedAll = false;
      const wrappers = Array.from(root.querySelectorAll('.villageWrapper'));
      if (ids && ids.length) {
        buttons = ids.map((id) => {
          const marker = root.querySelector(`[data-list="${CSS.escape(String(id))}"]`);
          const header = marker && marker.closest('.farmListHeader');
          return header && header.querySelector('button.startFarmList');
        });
      } else if (villageName && wrappers.length) {
        // One village chosen: only its lists ("Start all" starts every village's).
        const clean = (x) => String(x || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
        const mine = wrappers.find((w) => clean(w.querySelector('.villageName') && w.querySelector('.villageName').textContent) === clean(villageName));
        if (!mine) return { ok: false, code: 'noFarmVillage' };
        buttons = Array.from(mine.querySelectorAll('button.startFarmList'));
      } else {
        const all = root.querySelector('button.startAllFarmLists');
        startedAll = usable(all);
        buttons = startedAll ? [all] : Array.from(root.querySelectorAll('button.startFarmList'));
      }
      buttons = buttons.filter(usable);
      if (!buttons.length) return { ok: false, code: 'noFarmStart' };
      for (const b of buttons) {
        b.click();
        await sleep(rand(900, 1800));
      }
      await sleep(1500);
      return { ok: true, started: startedAll ? 'all' : buttons.length };
    },

    // Rally point: fill the "send troops" form (a raid, or a normal attack)
    // with exactly these troops and press Send.
    async sendForm({ x, y, troops, mission = 'raid' }) {
      const fields = Object.entries(troops || {}).filter(([, n]) => n > 0);
      if (!fields.length || !fields.every(([f, n]) => /^t\d+$/.test(f) && Number.isInteger(n)) ||
        !Number.isInteger(x) || !Number.isInteger(y) || !MISSIONS[mission]) return { ok: false, code: 'badField' };
      const inputs = fields.map(([f, n]) => [troopInput(document, f), n]);
      if (inputs.some(([input]) => !input || input.disabled)) return { ok: false, code: 'noUnitInput' };
      const form = inputs[0][0].closest('form');
      if (!form) return { ok: false, code: 'noUnitInput' };
      const xIn = form.querySelector('input[name="x"], #xCoordInput');
      const yIn = form.querySelector('input[name="y"], #yCoordInput');
      if (!xIn || !yIn) return { ok: false, code: 'noCoordInput' };
      const radio = missionRadio(form, mission);
      if (!radio) return { ok: false, code: mission === 'reinforce' ? 'noReinforceOption' : 'noRaidOption' };
      // Only the chosen units go; clear anything else that was pre-filled.
      const chosen = new Set(inputs.map(([input]) => input));
      for (const other of form.querySelectorAll('input[name^="troop["], input[name^="troops["]')) {
        if (!chosen.has(other) && other.type !== 'hidden' && other.value) setValue(other, '');
      }
      for (const [input, n] of inputs) {
        setValue(input, n);
        await sleep(rand(150, 400));
      }
      setValue(xIn, x);
      setValue(yIn, y);
      radio.click();
      if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
      const btn = form.querySelector('button#ok, button#btn_ok, button[type="submit"][name="ok"], button[type="submit"][name="s1"]') ||
        form.querySelector('button[type="submit"]');
      if (!usable(btn)) return { ok: false, code: 'noSendButton' };
      await sleep(rand(400, 900));
      setTimeout(() => btn.click(), 50);
      return { ok: true, navigating: true };
    },

    // Confirmation page: only confirm when it names our target and the
    // mission we asked for.
    async sendConfirm({ x, y, mission = 'raid' }) {
      const info = P.parseSendPage(document);
      if (info.stage !== 'confirm') return { ok: false, code: 'noConfirmPage' };
      if (!info.targets.some((p) => p.x === x && p.y === y)) return { ok: false, code: 'targetMismatch' };
      if (!MISSIONS[mission] || (info.eventType != null && !MISSIONS[mission].values.includes(info.eventType))) return { ok: false, code: 'notRaid' };
      const details = document.querySelector('table.troop_details');
      const form = details && details.closest('form');
      const btn = document.querySelector('#confirmSendTroops, button#btn_ok, button.rallyPointConfirm, .rallyPointConfirm button[type="submit"]') ||
        (form && form.querySelector('button[type="submit"]'));
      if (!usable(btn)) return { ok: false, code: 'noConfirmButton' };
      await sleep(rand(500, 1200));
      setTimeout(() => btn.click(), 50);
      return { ok: true, navigating: true };
    },

    // Fallback: the extension's own map request for each area (`centers`),
    // with the game's version. Stops at the first refusal.
    async scanMap({ centers }) {
      const version = await gameVersionLive();
      const diag = [];
      const tiles = new Map();
      let status = null;
      let done = 0;
      const end = Date.now() + 100000; // well inside the background's wait for an answer
      for (const [i, c] of (centers || []).entries()) {
        if (i && Date.now() > end) break;
        if (i) await sleep(rand(700, 1500));
        const r = await mapAt(c.x, c.y, version);
        if (!i || !r.tiles) diag.push(...r.diag);
        if (!r.tiles) { status = r.status; break; }
        done += 1;
        for (const tile of r.tiles) { const p = tile.position || tile; tiles.set(`${p.x}|${p.y}`, tile); }
      }
      const missing = (centers || []).slice(done);
      if (!tiles.size) return { ok: false, code: 'mapApi', status, diag, missing };
      return { ok: true, method: 'request', diag, missing, ...readTiles([...tiles.values()]) };
    },

    // On the map page (karte.php): the tiles the game itself loaded, then
    // the game's own request again for each of `centers` (other areas and
    // villages). Answers what all of it showed, and which areas are still
    // missing (the game's request couldn't be reused for them).
    async mapTiles({ centers = [] } = {}) {
      window.postMessage({ source: 'tvh-map-get' }, location.origin);
      await waitFor(() => mapTiles.size > 0, 15000);
      if (mapTiles.size) await sleep(rand(1500, 2500)); // the rest of the view arrives in parts
      const diag = mapNotes.splice(0).map((n) => ({ how: `page ${n.path}`, ok: n.tiles > 0, status: n.status, shape: n.shape, tiles: n.tiles, ...(n.reusable === false ? { error: 'the game\'s request can\'t be reused for other areas' } : {}) }));
      if (!diag.length && !mapTiles.size) diag.push({ how: 'page', ok: false, error: 'no answer from the game\'s map API seen on the map page' });
      let missing = centers;
      if (centers.length && mapTiles.size) {
        const reply = await pageAsk('tvh-map-replay', { centers }, 'tvh-map-replay-reply', 150000);
        const results = (reply && reply.results) || [];
        for (const r of results) if (r.ok) addTiles(r.tiles);
        const failed = results.filter((r) => !r.ok);
        missing = reply ? failed.map(({ x, y }) => ({ x, y })) : centers;
        diag.push({ how: `page: ${centers.length} more areas`, ok: !failed.length && !!reply, tiles: results.reduce((n, r) => n + (r.ok ? r.tiles.length : 0), 0),
          ...(reply ? {} : { error: 'no answer from the map page' }),
          ...(failed.length ? { error: `${failed.length} failed: ${[...new Set(failed.map((r) => r.error || `HTTP ${r.status}`))].join(', ').slice(0, 160)}` } : {}) });
      }
      if (!mapTiles.size) return { ok: false, code: 'mapApi', diag, missing };
      return { ok: true, method: 'page', diag, missing, ...readTiles([...mapTiles.values()]) };
    },

    // Empty building site: the chosen building's "Construct" button.
    async construct({ gid }) {
      const contract = document.getElementById(`contract_building${Number(gid)}`);
      if (!contract) return { ok: false, code: 'noContract' };
      const btn = contract.querySelector('button.new');
      if (!usable(btn) || !btn.classList.contains('green')) return { ok: false, code: 'cannotConstruct' };
      setTimeout(() => btn.click(), 50);
      return { ok: true, navigating: true };
    },

    // Task page: press every "Collect", on the village tab and then on the
    // general tab.
    async collectQuests() {
      if (!(await waitFor(() => document.querySelector('.taskOverview')))) return { ok: false, code: 'noTasks' };
      const pressed = new Set();
      let collected = 0;
      for (const tab of ['1', '2']) {
        if (tab === '2') {
          const a = document.querySelector('a.tabItem[data-tab="2"]');
          if (!a) break;
          if (!a.classList.contains('active')) {
            a.click();
            await sleep(rand(1500, 2500));
            await waitFor(() => document.querySelector('.taskOverview'));
          }
        }
        for (let i = 0; i < 15; i++) {
          const b = Array.from(document.querySelectorAll('.taskOverview button.collect')).find((x) => usable(x) && !pressed.has(x));
          if (!b) break;
          pressed.add(b);
          b.click();
          collected++;
          await sleep(rand(1200, 2200));
        }
      }
      return { ok: true, collected };
    },

    // Hero inventory: move resources from the hero's bag into the active
    // village (the dialog shows all four; the game caps at free storage).
    async heroTransfer({ amounts }) {
      const IDS = { wood: 145, clay: 146, iron: 147, crop: 148 };
      const NAMES = { wood: 'lumber', clay: 'clay', iron: 'iron', crop: 'crop' };
      const want = Object.entries(amounts || {}).filter(([k, n]) => IDS[k] && n > 0);
      if (!want.length) return { ok: false, code: 'nothingToTransfer' };
      await waitFor(() => document.querySelector('.heroItems .heroItem'));
      const item = want.map(([k]) => document.querySelector(`.heroItems .heroItem .item.item${IDS[k]}`)).find(Boolean);
      if (!item) return { ok: false, code: 'noHeroItem' };
      item.closest('.heroItem').click();
      const dialog = await waitFor(() => document.querySelector('.resourceTransferDialog'), 5000);
      if (!dialog) return { ok: false, code: 'noTransferDialog' };
      await sleep(rand(400, 800));
      for (const [k, n] of want) {
        const input = dialog.querySelector(`input[name="${NAMES[k]}"]`);
        if (input && !input.disabled) { setValue(input, n); await sleep(rand(200, 500)); }
      }
      const btn = await waitFor(() => {
        const buttons = dialog.querySelectorAll('.actionButton button');
        return buttons.length === 2 && usable(buttons[1]) ? buttons[1] : null;
      }, 3000);
      if (!btn) {
        const cancel = dialog.querySelector('.dialogCancelButton');
        if (cancel) cancel.click();
        return { ok: false, code: 'transferBlocked' };
      }
      btn.click();
      const done = await waitFor(() => document.querySelector('.toast.toastSuccess'), 6000);
      return done ? { ok: true } : { ok: false, code: 'noTransferConfirm' };
    },

    // Alliance bonus donation (alliance/bonuses): pick the bonus, type the
    // amounts (the game listens for keyup), then the green "Contribute" —
    // never the gold ×3 one. Other layouts fall back to the usual names.
    // What the alliance bonus page says was given today (to check a donation).
    async donateInfo() {
      await waitFor(() => document.getElementById('content'), 5000);
      await waitFor(() => document.getElementById('donatedToday'), 3000);
      return { ok: true, donatedToday: donatedToday() };
    },

    async donate({ amounts, bonus = -1 }) {
      await waitFor(() => document.getElementById('content'), 5000);
      const form = document.getElementById('contributionForm');
      if (form) return donateForm(form, amounts, bonus);
      const NAMES = {
        wood: ['lumber', 'wood', 'r1', 'resource1', 'res1'], clay: ['clay', 'r2', 'resource2', 'res2'],
        iron: ['iron', 'r3', 'resource3', 'res3'], crop: ['crop', 'r4', 'resource4', 'res4'],
      };
      const shown = (el) => !!el && el.getClientRects().length > 0;
      const findInputs = () => {
        const out = {};
        for (const [k, names] of Object.entries(NAMES)) {
          out[k] = names.map((n) => Array.from(document.querySelectorAll(`input[name="${n}"], input#${n}`)).find(shown)).find(Boolean);
          if (!out[k]) return null;
        }
        return out;
      };
      await waitFor(() => document.getElementById('content'), 5000);
      await sleep(rand(600, 1200));
      let inputs = findInputs();
      if (!inputs) {
        const openers = Array.from(document.querySelectorAll('[class*="bonus" i] button, [class*="contribut" i] button, [class*="donat" i] button'))
          .filter((b) => usable(b) && shown(b) && !/gold|cancel|close/i.test(b.className));
        const btn = openers[bonus >= 0 && openers[bonus] ? bonus : 0];
        if (btn) { btn.click(); inputs = await waitFor(findInputs, 4000); }
      }
      if (!inputs) {
        const a = Array.from(document.querySelectorAll('a[href*="bonus" i]')).find((x) => !(x.getAttribute('href') || '#').startsWith('#'));
        return { ok: false, code: 'noDonateForm', link: a ? a.getAttribute('href') : null };
      }
      // A disabled input is a resource the game won't take now (e.g. none left).
      for (const [k, input] of Object.entries(inputs)) if (!input.disabled) { setValue(input, (amounts && amounts[k]) || 0); await sleep(rand(150, 400)); }
      const root = inputs.wood.closest('form, .dialog, [class*="dialog" i], [class*="contribut" i], [class*="donat" i]') || document;
      const label = (b) => `${b.className} ${b.name || ''} ${b.id || ''} ${b.value || ''}`;
      const buttons = await waitFor(() => {
        const list = Array.from(root.querySelectorAll('button, input[type="submit"]'))
          .filter((b) => usable(b) && shown(b) && !/gold|cancel|close|fillup/i.test(label(b)));
        return list.length ? list : null;
      }, 3000);
      if (!buttons) return { ok: false, code: 'noDonateButton' };
      const send = buttons.find((b) => /contribut|donat|send|submit|\bok\b/i.test(label(b))) || buttons[buttons.length - 1];
      send.click();
      await waitFor(() => document.querySelector('.toast.toastSuccess, .toastSuccess'), 5000);
      return { ok: true };
    },

    // Town Hall: the celebration's "hold" button — small first, great
    // second. Never the building's own upgrade button or a gold/NPC one.
    async celebrate({ great }) {
      const root = document.getElementById('build') || document;
      await sleep(rand(500, 1000));
      const shown = (el) => !!el && el.getClientRects().length > 0;
      const ok = (b) => usable(b) && shown(b) && !b.closest('.upgradeButtonsContainer') && !/gold|exchange|npc|\bbuild\b/i.test(b.className);
      const inside = (el) => Array.from(el.querySelectorAll('button, input[type="submit"]')).filter(ok);
      // One block per celebration: the first is the small one, the second the great.
      const blocks = Array.from(root.querySelectorAll('.research'));
      let btn;
      if (blocks.length) btn = inside(blocks[great ? 1 : 0] || document.createElement('div'))[0];
      else btn = Array.from(root.querySelectorAll('.cta button, .celebration button')).filter(ok)[great ? 1 : 0];
      if (!btn) return { ok: false, code: 'noCelebrateButton' };
      setTimeout(() => btn.click(), 50);
      return { ok: true, navigating: true };
    },

    async adventure() {
      // React marks a button it can't use with a class, not the attribute.
      const btn = await waitFor(() => Array.from(document.querySelectorAll('#heroAdventure tbody tr button')).find(usable));
      if (!btn) return { ok: false, code: 'noAdventure' };
      const cells = btn.closest('tr') ? btn.closest('tr').querySelectorAll('td') : [];
      const where = cells[1] ? cells[1].textContent.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim() : '';
      btn.click();
      // Then a "continue" to press, or (other versions) the button just goes.
      const cont = () => { const b = document.querySelector('button.continue'); return usable(b) ? b : null; };
      await waitFor(() => cont() || !document.contains(btn) || !usable(btn), 4000);
      const next = cont();
      if (!next && document.contains(btn) && usable(btn)) return { ok: false, code: 'noAdventureStart' };
      // Answer first: the last click may open another page.
      if (next) setTimeout(() => next.click(), 50);
      return { ok: true, detail: where };
    },
  };

  // What the page looked like when an action failed, for the diagnostics
  // report: which page, its forms, buttons and fields (no values).
  function probe() {
    const build = document.getElementById('build');
    const content = document.getElementById('content') || document.body;
    const shown = (el) => el.getClientRects().length > 0;
    const title = document.querySelector('.titleInHeader, h1');
    return {
      path: (location.pathname + location.search).replace(/([?&])newdid=\d+&?/, '$1').slice(0, 100),
      title: title ? title.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
      build: build ? build.className : null,
      forms: Array.from(content.querySelectorAll('form')).map((f) => f.getAttribute('name') || f.id || (f.getAttribute('action') || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 60)).slice(0, 6),
      buttons: Array.from(content.querySelectorAll('button')).filter(shown).map((b) => `${b.id ? `#${b.id}` : ''}.${Array.from(b.classList).slice(0, 4).join('.')}${b.disabled ? '[disabled]' : ''}`).slice(0, 12),
      inputs: Array.from(content.querySelectorAll('input[name]')).map((i) => i.getAttribute('name')).slice(0, 20),
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'ACTION') return undefined;
    const fn = actions[msg.action && msg.action.kind];
    if (!fn) {
      sendResponse({ ok: false, code: 'unknownAction', probe: probe() });
      return undefined;
    }
    sleep(rand(400, 1200))
      .then(() => fn(msg.action))
      .then((r) => sendResponse(r && r.ok === false ? { ...r, probe: probe() } : r), (e) => sendResponse({ ok: false, reason: e.message, probe: probe() }));
    return true;
  });

  report();
})();
