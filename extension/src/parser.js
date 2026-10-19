// Reads game state out of a Travian Legends page. Pure DOM parsing: no
// side effects, so it can run in the content script and in Node tests.
(function (root) {
  'use strict';

  const RESOURCE_KEYS = ['wood', 'clay', 'iron', 'crop'];

  // Travian wraps numbers in bidi marks (U+202D/U+202C), uses U+2212 for
  // minus and localised thousands separators. Keep digits and the sign.
  function num(text) {
    if (text == null) return null;
    const s = String(text).replace(/−/g, '-').replace(/[^\d-]/g, '');
    const m = s.match(/-?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  const qs = (el, sel) => (el ? el.querySelector(sel) : null);
  const qsa = (el, sel) => (el ? Array.from(el.querySelectorAll(sel)) : []);
  const text = (el) => (el ? el.textContent.replace(/[‪-‮]/g, '').replace(/\s+/g, ' ').trim() : '');

  function classNumber(el, prefix) {
    for (const c of el.classList) {
      const m = c.match(new RegExp('^' + prefix + '(\\d+)$'));
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function pageType(doc, url) {
    if (doc.getElementById('loginScene')) return 'login';
    if (!doc.getElementById('stockBar') && !doc.getElementById('servertime')) return 'unknown';
    const p = url.pathname;
    if (p.endsWith('/dorf1.php')) return 'dorf1';
    if (p.endsWith('/dorf2.php')) return 'dorf2';
    if (p.endsWith('/build.php')) {
      const gid = url.searchParams.get('gid');
      const tt = url.searchParams.get('tt');
      if (gid === '16' && tt === '99') return 'farmlist';
      if (tt === '2' && (gid === '16' || url.searchParams.get('id') === '39')) return 'send';
      return 'build';
    }
    if (p.endsWith('/position_details.php')) return 'tile';
    if (p.startsWith('/hero/adventures')) return 'adventures';
    if (p.startsWith('/hero/inventory')) return 'inventory';
    if ((p.startsWith('/report') || p.endsWith('/berichte.php')) && !url.searchParams.get('id')) return 'reports';
    if (p === '/tasks' || p.startsWith('/tasks/')) return 'tasks';
    return 'other';
  }

  // Every in-game page carries an inline `var resources = {production: ...,
  // storage: ..., maxStorage: ...}` block. It has hourly production, which
  // the DOM only shows on dorf1.
  function parseResourcesScript(doc) {
    for (const s of qsa(doc, 'script:not([src])')) {
      const t = s.textContent;
      if (!t.includes('var resources')) continue;
      const block = (key) => {
        const m = t.match(new RegExp('(?:^|[^A-Za-z])' + key + '\\s*:\\s*(\\{[^}]*\\})'));
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch (e) { return null; }
      };
      return { production: block('production'), storage: block('storage'), maxStorage: block('maxStorage') };
    }
    return null;
  }

  function parseResources(doc) {
    const script = parseResourcesScript(doc) || {};
    const stock = {};
    RESOURCE_KEYS.forEach((k, i) => {
      const el = doc.getElementById('l' + (i + 1));
      let v = el ? num(el.textContent) : null;
      if (v == null && script.storage) v = Math.floor(script.storage['l' + (i + 1)]);
      stock[k] = v;
    });

    const bar = doc.getElementById('stockBar');
    let warehouse = num(text(qs(bar, '.warehouse .capacity .value')));
    let granary = num(text(qs(bar, '.granary .capacity .value')));
    if (warehouse == null && script.maxStorage) warehouse = script.maxStorage.l1;
    if (granary == null && script.maxStorage) granary = script.maxStorage.l4;

    let production = null;
    if (script.production) {
      const p = script.production;
      // l5 is the crop balance after upkeep; l4 is gross crop production.
      production = { wood: p.l1, clay: p.l2, iron: p.l3, crop: p.l5 != null ? p.l5 : p.l4, cropGross: p.l4 };
    } else {
      const rows = qsa(doc, '#production tbody tr');
      if (rows.length >= 4) {
        production = {};
        RESOURCE_KEYS.forEach((k, i) => { production[k] = num(text(qs(rows[i], '.num'))); });
      }
    }
    const freeCropEl = doc.getElementById('stockBarFreeCrop');
    if (production && freeCropEl) production.crop = num(freeCropEl.textContent);

    if (stock.wood == null && warehouse == null) return null;
    return { stock, capacity: { warehouse, granary }, production };
  }

  function parseVillages(doc) {
    const box = doc.getElementById('sidebarBoxVillagelist') || doc.getElementById('sidebarBoxVillageList');
    return qsa(box, '.listEntry[data-did]').map((el) => {
      const coord = qs(el, '.coordinatesGrid');
      let x = coord ? num(coord.getAttribute('data-x')) : null;
      let y = coord ? num(coord.getAttribute('data-y')) : null;
      if (x == null) x = num(text(qs(el, '.coordinateX')));
      if (y == null) y = num(text(qs(el, '.coordinateY')));
      return {
        id: el.getAttribute('data-did'),
        name: text(qs(el, '.name')) || (coord && coord.getAttribute('data-villagename')) || '',
        x, y,
        active: el.classList.contains('active'),
        underAttack: el.classList.contains('attack'),
      };
    });
  }

  function activeVillageId(doc, url) {
    const active = qs(doc, '#sidebarBoxVillagelist .listEntry.active[data-did], #sidebarBoxVillageList .listEntry.active[data-did]');
    if (active) return active.getAttribute('data-did');
    return url.searchParams.get('newdid');
  }

  function parseBuildQueue(doc) {
    const list = qs(doc, '.buildingList');
    return qsa(list, 'ul li').map((li) => {
      const nameEl = qs(li, '.name');
      const lvl = qs(nameEl, '.lvl');
      let name = '';
      if (nameEl) {
        const first = nameEl.childNodes[0];
        name = first ? first.textContent.replace(/[‪-‮]/g, '').trim() : '';
      }
      const timer = qs(li, '.timer');
      const secs = timer ? num(timer.getAttribute('value')) : null;
      return { name, level: lvl ? num(text(lvl)) : null, secondsLeft: secs };
    });
  }

  function parseFields(doc) {
    const container = doc.getElementById('resourceFieldContainer');
    return qsa(container, 'a[href*="build.php"]').map((a) => {
      const slot = num(a.getAttribute('data-aid')) || classNumber(a, 'buildingSlot');
      const gid = num(a.getAttribute('data-gid')) || classNumber(a, 'gid');
      let level = classNumber(a, 'level');
      if (level == null) level = num(text(qs(a, '.labelLayer')));
      return {
        slot, gid, level: level || 0,
        upgradable: a.classList.contains('good'),
        underConstruction: a.classList.contains('underConstruction'),
        maxLevel: a.classList.contains('maxLevel'),
      };
    }).filter((f) => f.slot && f.gid);
  }

  function parseBuildings(doc) {
    const content = doc.getElementById('villageContent');
    const seen = new Set();
    const out = [];
    for (const div of qsa(content, '.buildingSlot[data-aid]')) {
      const slot = num(div.getAttribute('data-aid'));
      if (!slot || seen.has(slot)) continue; // the wall is drawn as two slots
      seen.add(slot);
      const a = qs(div, 'a[data-level]') || qs(div, 'a');
      let gid = num(div.getAttribute('data-gid')) || 0;
      if (!gid && a) {
        const m = (a.getAttribute('href') || '').match(/gid=(\d+)/);
        if (m) gid = parseInt(m[1], 10);
      }
      out.push({
        slot, gid,
        name: div.getAttribute('data-name') || '',
        level: a ? num(a.getAttribute('data-level')) || 0 : 0,
        upgradable: !!(a && a.classList.contains('good')),
        underConstruction: !!(a && a.classList.contains('underConstruction')),
        maxLevel: !!(a && a.classList.contains('maxLevel')),
      });
    }
    return out;
  }

  // Troop movements box on dorf1. Icon classes: att1 incoming attack,
  // att2 own attack, att3 attack on oasis, def1 incoming reinforcement,
  // def2 own reinforcement, adventure / hero_on_adventure, settlers.
  function parseMovements(doc) {
    return qsa(doc, '#movements tr').map((tr) => {
      const img = qs(tr, '.typ img, td img');
      if (!img) return null;
      const kind = Array.from(img.classList).find((c) => c !== 'x' && c !== 'unit') || 'unknown';
      const timer = qs(tr, '.timer');
      return {
        kind,
        count: num(text(qs(tr, '.mov'))) || 1,
        secondsLeft: timer ? num(timer.getAttribute('value')) : null,
        label: text(qs(tr, '.mov')),
      };
    }).filter(Boolean);
  }

  function parseHero(doc) {
    const adv = qs(doc, 'a.adventure.round');
    const status = qs(doc, '.heroStatus');
    const img = qs(doc, '#topBarHero img.heroImage, img.heroImage');
    return {
      image: img && /^https?:/.test(img.src || '') ? img.src : null,
      adventures: adv ? num(text(qs(adv, '.content'))) || 0 : 0,
      home: !!qs(status, 'i.heroHome'),
      statusText: status ? (qs(status, 'a') ? qs(status, 'a').getAttribute('title') || '' : '') : '',
      // Unspent attribute points after a level-up.
      levelUp: !!qs(doc, 'i.levelUp.show'),
    };
  }

  // Unit icons carry the unit number as a class: u1..u10 Romans, u11..u20
  // Teutons, u21..u30 Gauls, u31..u40 animals, and so on; uhero is the hero.
  function unitOf(img) {
    if (!img) return null;
    for (const c of img.classList) {
      if (c === 'uhero') return 'hero';
      const m = c.match(/^u(\d+)$/);
      if (m) return 'u' + m[1];
    }
    return null;
  }

  // "Troops" box on dorf1: everything currently in the village.
  function parseTroops(doc) {
    const table = doc.getElementById('troops');
    if (!table) return null;
    return qsa(table, 'tbody tr').map((tr) => {
      const img = qs(tr, 'img.unit, i.unit');
      const unit = unitOf(img);
      if (!unit) return null;
      return {
        unit,
        name: text(qs(tr, '.un')) || (img.getAttribute('alt') || ''),
        count: num(text(qs(tr, '.num'))) || 0,
      };
    }).filter(Boolean);
  }

  // Units being trained, shown on barracks / stable / workshop pages. Each
  // row is a batch; its timer counts down to the last unit of the batch.
  function parseTrainingQueue(doc) {
    const out = [];
    for (const table of qsa(doc, 'table.under_progress')) {
      for (const tr of qsa(table, 'tbody tr')) {
        if (tr.classList.contains('next')) continue;
        const img = qs(tr, 'img.unit, i.unit');
        const unit = unitOf(img);
        if (!unit) continue;
        const desc = qs(tr, '.desc') || tr;
        const timer = qs(tr, '.dur .timer') || qs(tr, '.timer');
        out.push({
          unit,
          name: img.getAttribute('alt') || img.getAttribute('title') || '',
          count: num(text(desc)) || 1,
          secondsLeft: timer ? num(timer.getAttribute('value')) : null,
        });
      }
    }
    return out;
  }

  // position_details.php: a single map tile. For an oasis, the animals
  // guarding it are listed in #troop_info (the reports table reuses that id
  // with class "rep").
  function parseTile(doc, url) {
    const root = doc.getElementById('tileDetails') || doc.getElementById('content') || doc.body;
    const troopTable = qsa(doc, 'table#troop_info').find((tb) => !tb.classList.contains('rep')) || null;
    const animals = troopTable ? qsa(troopTable, 'tr').map((tr) => {
      const unit = unitOf(qs(tr, 'img.unit, i.unit'));
      if (!unit) return null;
      return { unit, count: num(text(qs(tr, '.val'))) ?? num(text(tr)) ?? 0 };
    }).filter(Boolean) : null;
    const cls = (root && root.className) || '';
    const animalUnits = (animals || []).some((a) => /^u(3[1-9]|40)$/.test(a.unit));
    return {
      x: num(url.searchParams.get('x')),
      y: num(url.searchParams.get('y')),
      // Villages have no animal table; an empty oasis lists "none".
      isOasis: /oasis/i.test(cls) || animalUnits || !!troopTable,
      // An owned oasis links to its owner's profile.
      owned: !!qs(root, 'a[href*="/profile"], a[href*="spieler.php"]'),
      animals: animals ? animals.reduce((n, a) => n + a.count, 0) : null,
    };
  }

  // Rally point "send troops": first a form, then a confirmation page.
  function parseSendPage(doc) {
    const inputs = qsa(doc, 'input[name^="troop["], input[name^="troops["]')
      .filter((i) => i.type !== 'hidden' && /\[t\d+\]$/.test(i.getAttribute('name')));
    const error = text(qs(doc, '#content .error, #content p.error, #content .alert, #content .errorMessage'));
    if (inputs.length) {
      const available = {};
      for (const input of inputs) {
        const field = input.getAttribute('name').match(/\[(t\d+)\]$/)[1];
        const cell = input.closest('td') || input.parentElement;
        const link = qs(cell, 'a');
        available[field] = link ? num(text(link)) ?? 0 : qs(cell, '.none') ? 0 : null;
      }
      return { stage: 'form', available, error };
    }
    const details = qs(doc, 'table.troop_details');
    if (details) {
      // Every place the page names, except the sending village (".role").
      const root = doc.getElementById('content') || doc.body;
      const targets = [];
      for (const a of qsa(root, 'a[href*="karte.php"], a[href*="position_details.php"]')) {
        if (a.closest('.role')) continue;
        const u = new URL(a.getAttribute('href') || '', 'https://x.invalid/');
        const d = num(u.searchParams.get('d'));
        if (u.searchParams.has('x')) targets.push({ x: num(u.searchParams.get('x')), y: num(u.searchParams.get('y')) });
        else if (d) targets.push({ x: ((d - 1) % 401) - 200, y: 200 - Math.floor((d - 1) / 401) }); // 401×401 map
      }
      for (const cx of qsa(root, '.coordinateX')) {
        if (cx.closest('.role')) continue;
        const cy = cx.parentElement && qs(cx.parentElement, '.coordinateY');
        if (cy) targets.push({ x: num(text(cx)), y: num(text(cy)) });
      }
      const ev = qs(doc, 'input[type="hidden"][name="eventType"], input[type="hidden"][name="c"]');
      return { stage: 'confirm', targets, eventType: ev ? num(ev.value) : null, error };
    }
    return { stage: 'other', error };
  }

  // Map tiles from the game's map API. Oasis titles are "{k.fo}" (free) or
  // "{k.bt}" (occupied); the text lists the animals.
  function oasesFromTiles(tiles) {
    const out = [];
    for (const tile of tiles || []) {
      const pos = tile.position || tile;
      const title = String(tile.title || '');
      const body = String(tile.text || '');
      const oasis = /\{k\.(fo|bt)\}/.test(title) || (tile.did === -1 && /unit u(3[1-9]|40)\b/.test(body));
      if (!oasis || pos.x == null || pos.y == null) continue;
      let animals = 0;
      for (const m of body.matchAll(/unit u(\d+)\b[\s\S]*?class="value[^"]*"[^>]*>\s*([\d,.]+)/g)) animals += num(m[2]) || 0;
      out.push({
        x: Number(pos.x), y: Number(pos.y),
        owned: /\{k\.bt\}/.test(title) || !!(tile.uid && tile.uid > 0),
        animals,
      });
    }
    return out;
  }

  // An empty building site lists what can go there, one contract per
  // building: a green "Construct" button, or a wait for resources, or
  // prerequisites still missing.
  function parseNewBuildings(doc) {
    return qsa(doc, '[id^="contract_building"]').map((c) => {
      const gid = num(c.id.replace('contract_building', ''));
      const button = qs(c, 'button.new');
      const timer = qs(qs(c, '.errorMessage'), '.timer');
      const cost = qsa(qs(c, '.resourceWrapper'), '.resource .value');
      return {
        gid,
        canBuild: !!(button && !button.disabled && !button.classList.contains('disabled') && button.classList.contains('green')),
        secondsUntilResources: timer ? num(timer.getAttribute('value')) : null,
        missing: qsa(c, '.buildingCondition.error').map((x) => text(x)),
        cost: cost.length >= 4 ? { wood: num(text(cost[0])), clay: num(text(cost[1])), iron: num(text(cost[2])), crop: num(text(cost[3])) } : null,
      };
    }).filter((b) => b.gid);
  }

  // Report list: one row per report with the result icon (iReport1 won
  // without losses, 2 won with losses, 3 lost) and, for raids, how full
  // the troops came back (carry full / half / empty).
  function parseReports(doc) {
    const out = [];
    const seen = new Set();
    for (const a of qsa(doc, 'a[href*="report?"], a[href*="report/"], a[href*="berichte.php?"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]id=([^&#]+)/);
      const row = a.closest('tr');
      if (!m || !row || seen.has(m[1])) continue;
      seen.add(m[1]);
      let result = null;
      let carry = null;
      for (const el of qsa(row, 'img, i, span, div')) {
        const r = (el.getAttribute('class') || '').match(/\biReport(\d+)\b/);
        if (r && result == null) result = Number(r[1]);
        const c = el.classList;
        if (c && c.contains('carry')) carry = c.contains('full') ? 'full' : c.contains('half') ? 'half' : c.contains('empty') ? 'empty' : carry;
      }
      out.push({ id: decodeURIComponent(m[1]), subject: text(a), result, carry, unread: row.classList.contains('newMessage') || !!qs(row, '.newMessage') });
    }
    return out;
  }

  // Task page (/tasks): rewards waiting to be collected.
  function parseQuests(doc) {
    const box = qs(doc, '.taskOverview');
    return {
      loaded: !!box,
      claimable: qsa(box, 'button.collect').filter((b) => !b.classList.contains('disabled') && !b.disabled).length,
    };
  }

  // Hero inventory: how much of each item is in the bag (item145 wood,
  // 146 clay, 147 iron, 148 crop, 106 ointment …).
  function parseInventory(doc) {
    const box = qs(doc, '.heroItems');
    const items = {};
    for (const slot of qsa(box, '.heroItem:not(.empty)')) {
      const item = qs(slot, '.item');
      const m = item && item.className.match(/\bitem(\d+)\b/);
      if (m) items[m[1]] = (items[m[1]] || 0) + (num(text(qs(slot, '.count'))) || 1);
    }
    return { loaded: !!box && !qs(doc, '.inventoryPageWrapper.loading'), items };
  }

  // Free valleys (somewhere to found a village) from the same map answer:
  // "{k.vt}" in the title, nobody's tile, and "{k.fN}" its field layout.
  function valleysFromTiles(tiles) {
    const out = [];
    for (const tile of tiles || []) {
      const pos = tile.position || tile;
      const all = `${tile.title || ''} ${tile.text || ''}`;
      if (pos.x == null || pos.y == null || !/\{k\.vt\}/.test(all) || tile.uid > 0 || tile.did > 0) continue;
      const f = all.match(/\{k\.f(\d+)\}/);
      out.push({ x: Number(pos.x), y: Number(pos.y), type: f ? Number(f[1]) : null });
    }
    return out;
  }

  // Player villages from the same map answer: the tooltip text carries
  // "{k.spieler} name", "{k.einwohner} population", "{k.allianz} tag".
  function villagesFromTiles(tiles) {
    const out = [];
    const strip = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const tile of tiles || []) {
      const pos = tile.position || tile;
      if (pos.x == null || pos.y == null || !(tile.uid > 0) || !(tile.did > 0)) continue;
      const body = String(tile.text || '');
      const field = (key) => {
        const m = body.match(new RegExp('\\{k\\.' + key + '\\}([^<{]*)'));
        return m ? strip(m[1]) : null;
      };
      const pop = num(field('einwohner'));
      if (pop == null) continue;
      out.push({
        x: Number(pos.x), y: Number(pos.y), did: tile.did, uid: tile.uid, aid: tile.aid || 0,
        name: strip(String(tile.title || '').replace(/\{k\.\w+\}/g, '')),
        player: field('spieler') || '',
        alliance: field('allianz') || '',
        pop,
      });
    }
    return out;
  }

  // build.php for an existing building / field / empty site.
  function parseBuildPage(doc, url) {
    const slot = num(url.searchParams.get('id'));
    const upgrade = qs(doc, '.upgradeButtonsContainer .section1 button.build') ||
      qs(doc, '.upgradeButtonsContainer button.green.build');
    const contract = doc.getElementById('contract') || qs(doc, '[id^="contract_building"]');
    const error = qs(contract || doc, '.errorMessage');
    const waitTimer = qs(error, '.timer');
    const costEls = qsa(qs(contract, '.resourceWrapper'), '.resource .value');
    const title = qs(doc, '.titleInHeader') || qs(doc, 'h1');
    const lvl = qs(title, '.level');
    return {
      slot,
      newBuildings: qs(doc, '[id^="contract_building"]') ? parseNewBuildings(doc) : null,
      // Town Hall: a celebration in progress shows a countdown.
      celebration: qs(doc, '#build.gid24') ? (() => {
        const timer = qs(doc, '#content table.under_progress .timer, #content .under_progress .timer, #build table .dur .timer');
        return { running: !!timer, secondsLeft: timer ? num(timer.getAttribute('value')) : null };
      })() : null,
      title: text(title),
      level: lvl ? num(text(lvl)) : null,
      canUpgrade: !!(upgrade && !upgrade.disabled && !upgrade.classList.contains('disabled')),
      // "Upgrade to level N" — already accounts for levels queued.
      nextLevel: upgrade ? num(upgrade.getAttribute('value') || text(upgrade)) : null,
      blockedReason: error ? text(error).replace(/\d+:\d+:\d+.*$/, '').trim() : null,
      secondsUntilResources: waitTimer ? num(waitTimer.getAttribute('value')) : null,
      cost: costEls.length >= 4
        ? { wood: num(text(costEls[0])), clay: num(text(costEls[1])), iron: num(text(costEls[2])), crop: num(text(costEls[3])) }
        : null,
      maxLevel: !upgrade && !error && !!qs(doc, '.upgradeBuilding .maxLevel, .maxLevelReached'),
      // Training buildings: what's being trained now (null on other buildings).
      trainingQueue: qs(doc, 'table.under_progress, .startTraining, #nonFavouriteTroops') ? parseTrainingQueue(doc) : null,
      trainable: qsa(doc, '.troop:not(.empty) .cta input.text[name^="t"]').map((input) => {
        const box = input.closest('.troop');
        const img = qs(box, 'img.unit');
        const maxLink = qs(qs(box, '.cta'), 'a');
        return {
          field: input.getAttribute('name'),
          unit: unitOf(img),
          name: img ? img.getAttribute('alt') || '' : '',
          max: maxLink ? num(text(maxLink)) || 0 : 0,
        };
      }),
    };
  }

  function parseFarmLists(doc) {
    const root = doc.getElementById('rallyPointFarmList');
    return qsa(root, '.farmListHeader').map((h) => ({
      id: (qs(h, '[data-list]') || h).getAttribute('data-list'),
      name: text(qs(h, '.name')),
      canStart: !!qs(h, 'button.startFarmList:not([disabled])'),
    }));
  }

  // Sidebar "Villages 1/2" box: villages used / slots, and the bar towards
  // the next slot (culture points).
  function parseExpansion(doc) {
    const box = qs(doc, '.expansionSlotInfo');
    if (!box) return null;
    const m = text(qs(box, '.slots')).replace(/[^\d/]/g, '').match(/(\d+)\/(\d+)/);
    const bar = qs(box, '.bar');
    const w = bar && (bar.getAttribute('style') || '').match(/width:\s*([\d.]+)%/);
    return { used: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null, pct: w ? Number(w[1]) : null };
  }

  function parseAccount(doc) {
    return {
      expansion: parseExpansion(doc),
      // The quest master's speech bubble: a task reward is waiting.
      questClaimable: !!qs(doc, '#questmasterButton.claimable, #questmasterButton .newQuestSpeechBubble'),
      gold: num(text(qs(doc, '.ajaxReplaceableGoldAmount'))),
      silver: num(text(qs(doc, '.ajaxReplaceableSilverAmount'))),
      hero: parseHero(doc),
    };
  }

  function parsePage(doc, href) {
    const url = new URL(href);
    const type = pageType(doc, url);
    const out = { type, url: href, server: url.origin, at: Date.now() };
    if (type === 'login' || type === 'unknown') return out;

    out.villages = parseVillages(doc);
    out.villageId = activeVillageId(doc, url);
    out.account = parseAccount(doc);
    out.resources = parseResources(doc);
    out.buildQueue = parseBuildQueue(doc);
    if (type === 'dorf1') {
      out.fields = parseFields(doc);
      out.movements = parseMovements(doc);
      out.troops = parseTroops(doc);
    }
    if (type === 'dorf2') out.buildings = parseBuildings(doc);
    if (type === 'build') out.buildPage = parseBuildPage(doc, url);
    if (type === 'farmlist') out.farmLists = parseFarmLists(doc);
    if (type === 'tile') out.tile = parseTile(doc, url);
    if (type === 'send') out.sendPage = parseSendPage(doc);
    if (type === 'tasks') out.quests = parseQuests(doc);
    if (type === 'inventory') out.inventory = parseInventory(doc);
    if (type === 'reports') out.reports = parseReports(doc);
    return out;
  }

  const api = {
    num, parsePage, parseResources, parseVillages, parseBuildQueue, parseFields, parseBuildings, parseMovements,
    parseBuildPage, parseFarmLists, parseHero, pageType, parseTroops, parseTrainingQueue, parseTile, parseSendPage,
    oasesFromTiles, villagesFromTiles, valleysFromTiles, unitOf, parseNewBuildings, parseQuests, parseInventory, parseReports, parseExpansion,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TravianParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
