// The web app link: what the extension uploads (the dashboard's data, with
// secrets masked and within the database's size limit), which commands it
// accepts from the web app, and how those are made safe. Pure; the
// background does the uploading.

// The same keys the dashboard reads (ui.js STORAGE_KEYS).
export const SNAPSHOT_KEYS = ['settings', 'villages', 'account', 'tasks', 'training', 'raids', 'farms', 'escapes', 'oases', 'schedule', 'status', 'log', 'device', 'syncState', 'history', 'health', 'stats', 'mapVillages', 'valleys', 'expansion'];

// Commands the web app may send. Backups, wiping, taking over and the web
// link itself stay in the extension's own dashboard.
export const REMOTE_COMMANDS = new Set([
  'saveSettings', 'addTask', 'removeTask', 'moveTask',
  'addTraining', 'updateTraining', 'removeTraining',
  'addRaid', 'updateRaid', 'removeRaid', 'addRaidTarget', 'removeRaidTarget',
  'addFarmList', 'updateFarmList', 'removeFarmList', 'addFarmTargets', 'updateFarmTarget', 'removeFarmTarget', 'setFarmTroops', 'sendFarmNow',
  'saveEscape', 'updateEscape', 'removeEscape', 'testDonate',
  'scanOases', 'finderScan', 'finderStop', 'finderClear', 'expansionMark',
  'pauseAll', 'resumeAll', 'sendAllFarms', 'escapeNow', 'runNow', 'sendSummary', 'clearLog',
]);

export const MASK = '••••••';
const MAX_CHARS = 900 * 1024;   // the web app's database takes up to ~1 MB a request
const DROP_ORDER = ['mapVillages', 'history', 'oases', 'valleys'];

// The web app's address: https only (http for this computer, to try it out).
export function webBase(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return null;
    return u.origin;
  } catch (e) {
    return null;
  }
}

// Settings as the web app may see them: no Telegram token or chat, no
// Discord address, no web key.
export function maskedSettings(s) {
  if (!s) return s;
  const mask = (v) => (v ? MASK : '');
  return {
    ...s,
    telegram: s.telegram ? { ...s.telegram, token: mask(s.telegram.token), chatId: mask(s.telegram.chatId) } : s.telegram,
    discord: s.discord ? { ...s.discord, webhookUrl: mask(s.discord.webhookUrl) } : s.discord,
    web: s.web ? { ...s.web, key: mask(s.web.key) } : s.web,
  };
}

// What goes up: the dashboard's data, secrets masked, the log shortened,
// and the bulkiest parts left out if it would be too large.
export function snapshotOf(data, version) {
  const out = { version };
  for (const k of [...SNAPSHOT_KEYS, 'lease']) if (data[k] !== undefined) out[k] = data[k];
  out.settings = maskedSettings(out.settings);
  // Sync keeps a full copy of the commands (settings included): only its date and errors go up.
  if (out.syncState) { const st = { ...out.syncState }; delete st.json; out.syncState = st; }
  if (Array.isArray(out.log)) out.log = out.log.slice(0, 150);
  // Safety net: a part that still holds a real secret anywhere stays home.
  const s = data.settings || {};
  const secrets = [s.telegram && s.telegram.token, s.discord && s.discord.webhookUrl, s.web && s.web.key].filter((x) => x && String(x).length >= 8);
  for (const k of Object.keys(out)) {
    const part = JSON.stringify(out[k]) || '';
    if (secrets.some((x) => part.includes(x) || part.includes(JSON.stringify(x).slice(1, -1)))) delete out[k];
  }
  let text = JSON.stringify(out);
  for (const k of DROP_ORDER) {
    if (text.length <= MAX_CHARS) break;
    delete out[k];
    text = JSON.stringify(out);
  }
  if (text.length > MAX_CHARS && Array.isArray(out.log)) { out.log = out.log.slice(0, 30); text = JSON.stringify(out); }
  return { snapshot: out, text, tooLarge: text.length > MAX_CHARS };
}

// A short fingerprint, to upload only when something changed.
export function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + text.length.toString(36);
}

// A command from the web app, made safe: settings can't change the game
// server, the web link, or where alerts go (masked values are dropped, and
// the rest of Telegram/Discord merged into what is there).
export function cleanRemote(name, args, current) {
  if (!REMOTE_COMMANDS.has(name)) return null;
  if (name !== 'saveSettings') return args || {};
  const patch = { ...((args && args.settings) || {}) };
  delete patch.web;
  delete patch.server;
  if (patch.telegram) {
    const rest = { ...patch.telegram };
    delete rest.token;
    delete rest.chatId;
    patch.telegram = { ...(current.telegram || {}), ...rest };
  }
  if (patch.discord) {
    const rest = { ...patch.discord };
    delete rest.webhookUrl;
    patch.discord = { ...(current.discord || {}), ...rest };
  }
  return { settings: patch };
}
