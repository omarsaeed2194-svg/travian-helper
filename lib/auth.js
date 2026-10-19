// Who may do what: the owner logs in with APP_PASSWORD (a Vercel
// environment variable) and gets a signed session cookie; the extension
// proves itself with a key the owner creates on the Connect page (only its
// hash is stored).
import crypto from 'node:crypto';
import { redis, key } from './store.js';
import { cookies, clientIp } from './http.js';

const COOKIE = 'th_session';
const SESSION_DAYS = 30;
const LOGIN_TRIES = 10;          // per address …
const LOGIN_WINDOW_S = 15 * 60;  // … per 15 minutes

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const equal = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

export const passwordSet = () => !!process.env.APP_PASSWORD;

// A random secret kept in the database (or SESSION_SECRET if given), so
// sessions survive deploys and can all be ended by deleting it.
async function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const k = key('sessionSecret');
  let s = await redis('GET', k);
  if (!s) {
    await redis('SET', k, crypto.randomBytes(32).toString('base64url'), 'NX');
    s = await redis('GET', k);
  }
  return s;
}

const sign = async (payload) => crypto.createHmac('sha256', await secret()).update(payload).digest('base64url');

export async function login(req, password) {
  if (!passwordSet()) throw Object.assign(new Error('APP_PASSWORD is not set in Vercel'), { status: 503, code: 'noPassword' });
  const tries = key(`login:${clientIp(req)}`);
  const n = await redis('INCR', tries);
  if (n === 1) await redis('EXPIRE', tries, LOGIN_WINDOW_S);
  if (n > LOGIN_TRIES) throw Object.assign(new Error('too many tries, wait 15 minutes'), { status: 429, code: 'tooMany' });
  if (!equal(password || '', process.env.APP_PASSWORD)) throw Object.assign(new Error('wrong password'), { status: 401, code: 'wrongPassword' });
  await redis('DEL', tries);
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const value = `${expires}.${await sign(`session:${expires}`)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function loggedIn(req) {
  const raw = cookies(req)[COOKIE];
  if (!raw || !passwordSet()) return false;
  const [expires, mac] = raw.split('.');
  if (!(Number(expires) > Date.now()) || !mac) return false;
  const want = await sign(`session:${expires}`);
  return want.length === mac.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac));
}

export async function requireLogin(req) {
  if (!(await loggedIn(req))) throw Object.assign(new Error('log in first'), { status: 401, code: 'login' });
}

// ---- the extension's key ----
export async function newAgentKey() {
  const k = `th_${crypto.randomBytes(24).toString('base64url')}`;
  await redis('SET', key('agentKey'), JSON.stringify({ hash: sha256(k).toString('hex'), createdAt: Date.now() }));
  return k;
}

export async function agentKeyInfo() {
  const raw = await redis('GET', key('agentKey'));
  return raw ? JSON.parse(raw) : null;
}

export async function requireAgent(req) {
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ''));
  const info = m && (await agentKeyInfo());
  const ok = !!info && crypto.timingSafeEqual(Buffer.from(sha256(m[1]).toString('hex')), Buffer.from(info.hash));
  if (!ok) throw Object.assign(new Error('wrong or old key: create a new one on the Connect page'), { status: 401, code: 'badKey' });
}
