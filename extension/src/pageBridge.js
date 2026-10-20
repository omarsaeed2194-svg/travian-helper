// Runs in the game page's own world (every game page). Tells the extension
// the game's version (set by the game's own scripts, not readable from the
// page source), for the map request's X-Version header. Never calls the
// game's own code: guessed calls made the game show "an unexpected error".
// Answers only "tvh-bridge" messages from this same page.
(() => {
  if (window.__tvhBridge) return;
  window.__tvhBridge = true;

  function gameInfo() {
    const game = (window.Travian && window.Travian.Game) || {};
    return { ok: true, version: game.version != null ? String(game.version) : null };
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== 'tvh-bridge' || !m.id) return;
    let result;
    try {
      result = m.kind === 'gameInfo' ? gameInfo() : { ok: false, error: 'unknown request' };
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }
    window.postMessage({ source: 'tvh-bridge-reply', id: m.id, result }, location.origin);
  });
})();
