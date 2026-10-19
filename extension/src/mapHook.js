// Runs in the map page's own world (karte.php). Passes on, untouched, the
// map tiles the game itself loads, so the extension can read the map even
// when its own request to the map service is refused. Never changes a
// request or an answer.
(() => {
  if (window.__tvhMapHook) return;
  window.__tvhMapHook = true;
  const seen = [];   // every answer so far, for a reader that comes late
  const isMap = (url) => /\/api\/v\d+\/map\//.test(String(url || ''));
  const post = (tiles) => window.postMessage({ source: 'tvh-map', tiles }, location.origin);
  const pass = (json) => {
    const tiles = json && (json.tiles || (json.response && json.response.tiles));
    if (!Array.isArray(tiles) || !tiles.length) return;
    if (seen.length < 50) seen.push(tiles);
    post(tiles);
  };
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'tvh-map-get') for (const tiles of seen) post(tiles);
  });

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : input && input.url;
      if (isMap(url)) p.then((r) => r.clone().json()).then(pass).catch(() => {});
      return p;
    };
  }

  const XHR = window.XMLHttpRequest;
  const open = XHR.prototype.open;
  XHR.prototype.open = function (method, url) {
    if (isMap(url)) {
      this.addEventListener('load', () => {
        try { pass(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch (e) { /* not JSON */ }
      });
    }
    return open.apply(this, arguments);
  };
})();
