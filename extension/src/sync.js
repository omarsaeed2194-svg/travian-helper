// Keeps the player's commands (settings, build queue, training rules) in
// chrome.storage.sync so they follow the Chrome account to other browsers,
// and makes sure only one browser runs the automation at a time.
//
// Village data, logs and schedules stay in chrome.storage.local: they're
// large, change constantly, and each browser rebuilds them from the game.

const CHUNK_CHARS = 2000;           // well under the 8 KB per-item sync limit
const LEASE_TTL_MS = 3 * 60 * 1000; // a browser that stops renewing loses the lease
const PUSH_DELAY_MS = 4000;

export const COMMAND_KEYS = ['settings', 'tasks', 'training', 'raids', 'farms', 'escapes'];

// JSON with sorted keys, so equal data always gives the same string.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// The parts of the commands worth syncing: per-browser bookkeeping
// (retry counters, next-run times) is left out.
export function commandsOf(data) {
  const tasks = {};
  for (const [vid, list] of Object.entries(data.tasks || {})) {
    if (list && list.length) tasks[vid] = list.map(({ attempts, ...rest }) => rest);
  }
  return {
    settings: data.settings || {},
    tasks,
    training: (data.training || []).map(({ nextAt, ...rest }) => rest),
    raids: (data.raids || []).map(({ nextAt, scannedAt, ...rest }) => rest),
    farms: (data.farms || []).map(({ nextAt, targets, ...rest }) => ({
      ...rest,
      targets: (targets || []).map(({ lastSentAt, lastTriedAt, lastResult, fails, sent, stats, ...tg }) => tg),
    })),
    escapes: data.escapes || [],
  };
}

function describeDevice() {
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Brave/.test(ua) ? 'Brave' : 'Chrome';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}

export async function getDevice() {
  const { device } = await chrome.storage.local.get('device');
  if (device && device.id) return device;
  const id = Math.random().toString(36).slice(2, 8);
  const created = { id, name: `${describeDevice()} #${id.slice(0, 4)}` };
  await chrome.storage.local.set({ device: created });
  return created;
}

async function readRemote() {
  const all = await chrome.storage.sync.get(null);
  const meta = all.cmdMeta;
  if (!meta || !meta.chunks) return null;
  let json = '';
  for (let i = 0; i < meta.chunks; i++) {
    if (typeof all[`cmd${i}`] !== 'string') return null; // still arriving
    json += all[`cmd${i}`];
  }
  try {
    return { meta, json, data: JSON.parse(json) };
  } catch (e) {
    return null;
  }
}

// Push local commands to sync if they changed since the last push or pull.
export async function pushCommands() {
  const local = await chrome.storage.local.get([...COMMAND_KEYS, 'syncState']);
  const json = stableStringify(commandsOf(local));
  const state = local.syncState || {};
  if (json === state.json) return { pushed: false };
  const device = await getDevice();
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_CHARS) chunks.push(json.slice(i, i + CHUNK_CHARS));
  const items = { cmdMeta: { chunks: chunks.length, updatedAt: Date.now(), deviceId: device.id, deviceName: device.name } };
  chunks.forEach((c, i) => { items[`cmd${i}`] = c; });
  try {
    await chrome.storage.sync.set(items);
    const stale = [];
    for (let i = chunks.length; i < (state.chunks || 0) + 4; i++) stale.push(`cmd${i}`);
    if (stale.length) await chrome.storage.sync.remove(stale);
  } catch (e) {
    await chrome.storage.local.set({ syncState: { ...state, error: e.message, errorAt: Date.now() } });
    return { pushed: false, error: e.message };
  }
  await chrome.storage.local.set({ syncState: { json, chunks: chunks.length, savedAt: Date.now(), error: null } });
  return { pushed: true };
}

let pushTimer = null;
export function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushCommands(); }, PUSH_DELAY_MS);
}

// Merge commands from another browser into local storage. Keeps this
// browser's retry counters and next-run times for tasks/rules that still exist.
export function mergeCommands(local, remote) {
  const attempts = {};
  for (const list of Object.values(local.tasks || {})) for (const t of list || []) attempts[t.id] = t.attempts;
  const tasks = {};
  for (const [vid, list] of Object.entries(remote.tasks || {})) {
    tasks[vid] = list.map((t) => ({ ...t, attempts: attempts[t.id] || 0 }));
  }
  const nextAt = Object.fromEntries((local.training || []).map((r) => [r.id, r.nextAt]));
  const training = (remote.training || []).map((r) => ({ ...r, nextAt: nextAt[r.id] || 0 }));
  const raidState = Object.fromEntries((local.raids || []).map((r) => [r.id, r]));
  const raids = (remote.raids || []).map((r) => ({ ...r, nextAt: (raidState[r.id] || {}).nextAt || 0, scannedAt: (raidState[r.id] || {}).scannedAt || 0 }));
  // Farm lists: keep this browser's run times and per-target results.
  const localLists = Object.fromEntries((local.farms || []).map((l) => [l.id, l]));
  const farms = (remote.farms || []).map((l) => {
    const mine = localLists[l.id] || {};
    const mineTargets = Object.fromEntries((mine.targets || []).map((tg) => [tg.id, tg]));
    return {
      ...l,
      nextAt: mine.nextAt || 0,
      targets: (l.targets || []).map((tg) => {
        const { lastSentAt, lastTriedAt, lastResult, fails, sent, stats } = mineTargets[tg.id] || {};
        return { ...tg, lastSentAt, lastTriedAt, lastResult, fails, sent, stats };
      }),
    };
  });
  return { settings: { ...(local.settings || {}), ...(remote.settings || {}) }, tasks, training, raids, farms, escapes: remote.escapes || [] };
}

// Pull commands another browser saved. `force` applies them even when this
// browser has local commands (used on a fresh install, and by "restore").
export async function pullCommands({ force = false } = {}) {
  const remote = await readRemote();
  if (!remote) return { pulled: false };
  const device = await getDevice();
  const local = await chrome.storage.local.get([...COMMAND_KEYS, 'syncState']);
  const state = local.syncState || {};
  if (remote.json === state.json) return { pulled: false };
  const fromElsewhere = remote.meta.deviceId !== device.id;
  const newer = remote.meta.updatedAt > (state.savedAt || 0);
  const empty = !local.settings && !Object.keys(local.tasks || {}).length && !(local.training || []).length &&
    !(local.raids || []).length && !(local.farms || []).length && !(local.escapes || []).length;
  if (!force && !empty && !(fromElsewhere && newer)) return { pulled: false };
  const merged = mergeCommands(local, remote.data);
  await chrome.storage.local.set({
    ...merged,
    syncState: { json: remote.json, chunks: remote.meta.chunks, savedAt: remote.meta.updatedAt, pulledFrom: remote.meta.deviceName, error: null },
  });
  return { pulled: true, from: remote.meta.deviceName };
}

// ----------------------------------------------------------------- lease ---
export async function getLease() {
  const { lease } = await chrome.storage.sync.get('lease');
  return lease || null;
}

// True when this browser may run the automation: it holds the lease, or
// nobody has renewed it recently (that browser was closed).
export async function mayRun(now = Date.now()) {
  const [device, lease] = await Promise.all([getDevice(), getLease()]);
  if (!lease || lease.deviceId === device.id || now - lease.at > LEASE_TTL_MS) return { ok: true, device, lease };
  return { ok: false, device, lease };
}

export async function renewLease() {
  const device = await getDevice();
  try {
    await chrome.storage.sync.set({ lease: { deviceId: device.id, deviceName: device.name, at: Date.now() } });
  } catch (e) { /* write quota; next tick retries */ }
}

export const leaseIsFresh = (lease, now = Date.now()) => !!lease && now - lease.at <= LEASE_TTL_MS;
