// Runs in the map page's own world (karte.php). Passes on, untouched, the
// map tiles the game itself loads, so the extension can read the map even
// when its own request is refused. Looks at every answer from the game's
// API (whatever its shape) and keeps a short note of each for the
// diagnostics report. Never changes a request or an answer.
(() => {
  if (window.__tvhMapHook) return;
  window.__tvhMapHook = true;
  const seen = [];   // every list of tiles so far, for a reader that comes late
  const notes = [];  // what the game asked its API, for diagnostics
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
  function pass(url, status, json) {
    const tiles = findTiles(json);
    const note = { path: String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 120), status, shape: shape(json), tiles: tiles ? tiles.length : 0 };
    if (notes.length < 30) notes.push(note);
    post({ source: 'tvh-map-note', note });
    if (!tiles) return;
    if (seen.length < 50) seen.push(tiles);
    post({ source: 'tvh-map', tiles });
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'tvh-map-get') return;
    for (const tiles of seen) post({ source: 'tvh-map', tiles });
    for (const note of notes) post({ source: 'tvh-map-note', note });
  });

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      const url = input instanceof Request ? input.url : String(input);
      if (isApi(url)) p.then((r) => r.clone().json().then((j) => pass(url, r.status, j), () => pass(url, r.status, null))).catch(() => {});
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
  XHR.prototype.open = function (method, url) {
    if (isApi(url)) {
      this.addEventListener('load', () => {
        let json = null;
        try { json = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); } catch (e) { /* not JSON */ }
        pass(url, this.status, json);
      });
    }
    return open.apply(this, arguments);
  };
})();
