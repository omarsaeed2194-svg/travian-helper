// Log in (POST), log out (DELETE), or ask whether logged in and whether the
// deployment is set up (GET).
import { handler, readJson, send, sameOrigin } from '../lib/http.js';
import { login, loggedIn, logoutCookie, passwordSet } from '../lib/auth.js';
import { storeReady } from '../lib/store.js';

export default handler(async (req, res) => {
  const setup = { password: passwordSet(), store: storeReady() };
  if (req.method === 'GET') return send(res, 200, { loggedIn: setup.password && setup.store ? await loggedIn(req) : false, setup });
  if (!sameOrigin(req)) return send(res, 403, { error: 'wrong origin' });
  if (req.method === 'POST') {
    const { password } = await readJson(req, 10000);
    const cookie = await login(req, password);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (req.method === 'DELETE') return send(res, 200, { ok: true }, { 'Set-Cookie': logoutCookie() });
  return send(res, 405, { error: 'method' });
});
