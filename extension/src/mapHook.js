// Runs in the map page's own world (karte.php). Passes on, untouched, the
// map tiles the game itself loads, so the extension can read the map
// without guessing how the game asks for it. Looks at every answer from the
// game's API (whatever its shape) and keeps a short note of each for the
// diagnostics report. Never changes a request or an answer.
//
// For more of the map than the game loads by itself, the extension can ask
// for the game's own request again with other coordinates ("tvh-map-replay"):
// same address, same headers, same body with only x and y changed. The
// request stays in this page; nothing of it (headers included) is passed on.
(() => {
  if (window.__tvhMapHook) return;
  window.__tvhMapHook = true;
  const seen = [];   // every list of tiles so far, for a reader that comes late
  const notes = [];  // what the game asked its API, for diagnostics
  let template = null; // the game's last request that brought tiles
  const isApi = (url) => /\/api\//.test(String(url || ''));
  const isTile = (t) => t && typeof t === 'object' && ((t.position && t.position.x != null && t.position.y != null) ||
    (t.x != null && t.y != null && ('did' in t || 'uid' in t || 'title' in t || 'text' in t)));
  function findTiles(json, depth = 0) {
    if (!json || typeof json !== 'object' || depth > 6) return null;
    if (Array.isArray(json)) {
      if (json.length && json.every(isTile)) return json;
      for (const it of json) { const f = findTiles(it, depth + 1); if (f) return f; }
      return null;
    }
    if (Array.isArray(json.tiles) && json.tiles.length) return json.tiles;
    for (const k of Object.keys(json)) { const f = findTiles(json[k], depth + 1); if (f) return f; }
    return null;
  }
  const shape = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? `array(${v.length})` : `{${Object.keys(v).slice(0, 12).join(',')}}`) : typeof v);
  const post = (msg) => window.postMessage(msg, location.origin);

  // The same request for another point, or null when it can't be made
  // (no x and y in it to change).
  function setXY(o, x, y, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 4) return false;
    if (typeof o.x === 'number' && typeof o.y === 'number') {
      o.x = x; o.y = y;
      if (Array.isArray(o.ignorePositions)) o.ignorePositions = [];
      if (typeof o.zoomLevel === 'number') o.zoomLevel = 3; // the widest area (±15) per answer
      return true;
    }
    return Object.values(o).some((v) => setXY(v, x, y, depth + 1));
  }
  function withPoint(req, x, y) {
    if (req.body != null) {
      let json = null;
      try { json = JSON.parse(req.body); } catch (e) { /* not JSON */ }
      if (json) return setXY(json, x, y) ? { ...req, body: JSON.stringify(json) } : null;
      const q = new URLSearchParams(req.body);
      if (!q.has('x') || !q.has('y')) return null;
      q.set('x', x); q.set('y', y);
      return { ...req, body: q.toString() };
    }
    const u = new URL(req.url, location.href);
    if (!u.searchParams.has('x') || !u.searchParams.has('y')) return null;
    u.searchParams.set('x', x); u.searchParams.set('y', y);
    return { ...req, url: u.href };
  }

  function pass(url, status, json, req) {
    const tiles = findTiles(json);
    const reusable = !!(tiles && req && withPoint(req, 0, 0));
    if (reusable) template = req;
    const note = { path: String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 120), status, shape: shape(json), tiles: tiles ? tiles.length : 0, ...(tiles ? { reusable } : {}) };
    if (notes.length < 30) notes.push(note);
    post({ source: 'tvh-map-note', note });
    if (!tiles) return;
    if (seen.length < 50) seen.push(tiles);
    post({ source: 'tvh-map', tiles });
  }

  const origFetch = window.fetch;
  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.source === 'tvh-map-get') {
      for (const tiles of seen) post({ source: 'tvh-map', tiles });
      for (const note of notes) post({ source: 'tvh-map-note', note });
      return;
    }
    if (e.data.source !== 'tvh-map-replay' || !e.data.id) return;
    const results = [];
    for (const [i, c] of (e.data.centers || []).entries()) {
      const req = template && withPoint(template, c.x, c.y);
      if (!req) { results.push({ x: c.x, y: c.y, ok: false, error: template ? 'the game\'s map request has no x and y to change' : 'no map request of the game seen yet' }); continue; }
      if (i) await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
      try {
        const r = await origFetch.call(window, req.url, { method: req.method, headers: req.headers, credentials: 'same-origin', ...(/^(GET|HEAD)$/i.test(req.method) ? {} : { body: req.body }) });
        const json = await r.json().catch(() => null);
        const tiles = findTiles(json);
        results.push({ x: c.x, y: c.y, ok: !!tiles, status: r.status, tiles: tiles || [], ...(tiles ? {} : { shape: shape(json) }) });
      } catch (err) {
        results.push({ x: c.x, y: c.y, ok: false, error: String((err && err.message) || err).slice(0, 160) });
      }
    }
    post({ source: 'tvh-map-replay-reply', id: e.data.id, results });
  });

  const plainHeaders = (h) => {
    const out = {};
    if (!h) return out;
    if (Array.isArray(h)) for (const [k, v] of h) out[k] = v;
    else if (typeof h.forEach === 'function') h.forEach((v, k) => { out[k] = v; });
    else Object.assign(out, h);
    return out;
  };
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = isReq ? input.url : String(input);
      if (isApi(url)) {
        const req = {
          url: new URL(url, location.href).href, method: (init && init.method) || (isReq ? input.method : 'GET'),
          headers: plainHeaders((init && init.headers) || (isReq ? input.headers : null)),
          body: init && typeof init.body === 'string' ? init.body : null,
        };
        p.then((r) => r.clone().json().then((j) => pass(url, r.status, j, req), () => pass(url, r.status, null, null))).catch(() => {});
      }
      return p;
    };
  }

  // In a hidden tab (the bot's own) the browser stops animation frames, and
  // a map that waits for one would never load: while hidden, run them on a
  // timer instead (ids negative, so they can still be cancelled). Each one
  // starts from a message, not from the frame before, so the timers don't
  // chain (Chrome slows chained timers in hidden tabs to one a minute).
  const raf = window.requestAnimationFrame && window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame && window.cancelAnimationFrame.bind(window);
  if (raf && caf) {
    let seq = 0;
    const pending = new Map(); // id -> timer (0 until it is set)
    window.requestAnimationFrame = function (cb) {
      if (!document.hidden) return raf(cb);
      const id = -(++seq);
      pending.set(id, 0);
      const c = new MessageChannel();
      c.port1.onmessage = () => {
        c.port1.close();
        if (pending.has(id)) pending.set(id, setTimeout(() => { if (pending.delete(id)) cb(performance.now()); }, 50));
      };
      c.port2.postMessage(0);
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      if (id < 0) { clearTimeout(pending.get(id)); pending.delete(id); } else caf(id);
    };
  }

  const XHR = window.XMLHttpRequest;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;
  const setHeader = XHR.prototype.setRequestHeader;
  XHR.prototype.open = function (method, url) {
    this.__tvh = isApi(url) ? { url: new URL(String(url), location.href).href, method, headers: {}, body: null } : null;
    if (this.__tvh) {
      this.addEventListener('load', () => {
        let json = null;
        try { json = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); } catch (e) { /* not JSON */ }
        pass(url, this.status, json, this.__tvh);
      });
    }
    return open.apply(this, arguments);
  };
  XHR.prototype.setRequestHeader = function (k, v) {
    if (this.__tvh) this.__tvh.headers[k] = v;
    return setHeader.apply(this, arguments);
  };
  XHR.prototype.send = function (body) {
    if (this.__tvh && typeof body === 'string') this.__tvh.body = body;
    return send.apply(this, arguments);
  };
})();
