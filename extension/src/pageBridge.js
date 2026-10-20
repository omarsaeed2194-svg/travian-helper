// Runs in the game page's own world (every game page). Lets the extension
// ask the game's own API client for map tiles, so the request carries
// whatever the game adds to its requests (version, signature…). Answers
// only "tvh-bridge" messages from this same page; changes nothing else.
(() => {
  if (window.__tvhBridge) return;
  window.__tvhBridge = true;

  // A list of map tiles anywhere in an answer: objects with a position.
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

  async function settle(r) {
    if (r && typeof r.json === 'function') return r.json();       // a fetch Response
    if (r && typeof r.then === 'function') return settle(await r); // a jQuery-style promise
    return r;
  }

  // Tries the call shapes the game's client has had; `prefer` (the one that
  // worked last) goes first. The game's version goes back too, for the
  // extension's own request when none of these work.
  async function mapPosition({ x, y, zoomLevel, prefer }) {
    const attempts = [];
    const body = { x, y, zoomLevel, ignorePositions: [] };
    const game = (window.Travian && window.Travian.Game) || {};
    const version = game.version != null ? String(game.version) : null;
    const api = window.Travian && window.Travian.api;
    let tries = [];
    if (api && typeof api.post === 'function') {
      tries.push(['api.post data', () => api.post('map/position', { data: body })]);
      tries.push(['api.post', () => api.post('map/position', body)]);
    }
    if (typeof api === 'function') tries.push(['api', () => api('map/position', { method: 'POST', data: { data: body } })]);
    if (prefer) tries = [...tries.filter(([how]) => how === prefer), ...tries.filter(([how]) => how !== prefer)];
    for (const [how, run] of tries) {
      try {
        const json = await Promise.race([settle(run()), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))]);
        const tiles = findTiles(json);
        attempts.push({ how, ok: !!tiles, shape: shape(json), tiles: tiles ? tiles.length : 0 });
        if (tiles) return { ok: true, how, tiles, attempts, version };
      } catch (e) {
        const status = e && (e.status || (e.response && e.response.status));
        attempts.push({ how, ok: false, ...(status ? { status } : {}), error: String((e && (e.message || e.statusText)) || e).slice(0, 200) });
      }
    }
    if (!tries.length) attempts.push({ how: 'api', ok: false, error: `Travian.api is ${typeof api}` });
    return { ok: false, attempts, version };
  }

  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== 'tvh-bridge' || !m.id) return;
    let result;
    try {
      result = m.kind === 'mapPosition' ? await mapPosition(m.args || {}) : { ok: false, attempts: [{ how: m.kind, ok: false, error: 'unknown request' }] };
    } catch (err) {
      result = { ok: false, attempts: [{ how: m.kind, ok: false, error: String(err && err.message || err) }] };
    }
    window.postMessage({ source: 'tvh-bridge-reply', id: m.id, result }, location.origin);
  });
})();
