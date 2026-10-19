// Small helpers for the API functions: JSON in and out, cookies, CORS for
// the extension. Plain Node (req, res), so they run on Vercel and in the
// local dev server alike.

export const MAX_BODY = 3 * 1024 * 1024;

export async function readJson(req, limit = MAX_BODY) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';

// The extension calls from its own origin with a key, never with cookies.
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Pages of this site only: a browser sends Origin on POST/DELETE, and it
// must be this host (stops other sites from using a logged-in session).
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs, curl
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Wraps a handler: errors become JSON, never a stack trace.
export const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const status = e.status || 500;
    send(res, status, { error: status === 500 ? 'server error' : e.message, code: e.code || null });
    if (status === 500) console.error(e);
  }
};
