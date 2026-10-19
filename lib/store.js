// Storage: Upstash Redis over its REST API (what Vercel's "Upstash for
// Redis" integration sets up), so no client library is needed. For local
// testing only, TH_MEMORY_STORE=1 keeps everything in memory instead.

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const MEMORY = process.env.TH_MEMORY_STORE === '1';

export const storeReady = () => MEMORY || !!(URL_ && TOKEN);

const PREFIX = 'th:';
export const key = (name) => PREFIX + name;

async function rest(path, body) {
  if (!storeReady()) throw Object.assign(new Error('no database: connect Upstash Redis to this Vercel project'), { status: 503, code: 'noStore' });
  const res = await fetch(URL_.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw Object.assign(new Error(`database error ${res.status}`), { status: 502 });
  return json;
}

// ---- in-memory stand-in (tests and local runs) ----
const mem = new Map();
const expiries = new Map();
function memRun([cmd, ...a]) {
  const now = Date.now();
  for (const [k, at] of expiries) if (at <= now) { mem.delete(k); expiries.delete(k); }
  const list = (k) => { if (!mem.has(k)) mem.set(k, []); return mem.get(k); };
  switch (String(cmd).toUpperCase()) {
    case 'GET': return mem.has(a[0]) ? mem.get(a[0]) : null;
    case 'SET': {
      const opts = a.slice(2).map(String);
      if (opts.includes('NX') && mem.has(a[0])) return null;
      mem.set(a[0], String(a[1]));
      const ex = opts.indexOf('EX');
      if (ex >= 0) expiries.set(a[0], now + Number(opts[ex + 1]) * 1000); else expiries.delete(a[0]);
      return 'OK';
    }
    case 'DEL': { let n = 0; for (const k of a) if (mem.delete(k)) n++; return n; }
    case 'INCR': { const v = Number(mem.get(a[0]) || 0) + 1; mem.set(a[0], String(v)); return v; }
    case 'EXPIRE': expiries.set(a[0], now + Number(a[1]) * 1000); return 1;
    case 'RPUSH': { const l = list(a[0]); l.push(...a.slice(1).map(String)); return l.length; }
    case 'LPUSH': { const l = list(a[0]); l.unshift(...a.slice(1).map(String).reverse()); return l.length; }
    case 'LLEN': return (mem.get(a[0]) || []).length;
    case 'LPOP': {
      const l = mem.get(a[0]) || [];
      if (!l.length) return null;
      if (a[1] === undefined) return l.shift();
      return l.splice(0, Number(a[1]));
    }
    case 'LRANGE': {
      const l = mem.get(a[0]) || [];
      const end = Number(a[2]) < 0 ? l.length + Number(a[2]) : Number(a[2]);
      return l.slice(Number(a[1]), end + 1);
    }
    case 'LTRIM': {
      const l = mem.get(a[0]) || [];
      const end = Number(a[2]) < 0 ? l.length + Number(a[2]) : Number(a[2]);
      mem.set(a[0], l.slice(Number(a[1]), end + 1));
      return 'OK';
    }
    default: throw new Error(`memory store: ${cmd} not supported`);
  }
}

// One command.
export async function redis(...args) {
  if (MEMORY) return memRun(args);
  const json = await rest('', args);
  if (json.error) throw Object.assign(new Error(json.error), { status: 502 });
  return json.result;
}

// Several commands in one round trip; `atomic` runs them as a transaction.
export async function batch(commands, atomic = false) {
  if (MEMORY) return commands.map(memRun);
  const json = await rest(atomic ? '/multi-exec' : '/pipeline', commands);
  return json.map((r) => {
    if (r.error) throw Object.assign(new Error(r.error), { status: 502 });
    return r.result;
  });
}
