// The extension's key: whether one exists (GET), or a new one (POST; the
// old one stops working). Shown once, never stored in the clear.
import { handler, send, sameOrigin } from '../lib/http.js';
import { requireLogin, newAgentKey, agentKeyInfo } from '../lib/auth.js';

export default handler(async (req, res) => {
  await requireLogin(req);
  if (req.method === 'GET') {
    const info = await agentKeyInfo();
    return send(res, 200, { exists: !!info, createdAt: info ? info.createdAt : null });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'wrong origin' });
  send(res, 200, { key: await newAgentKey() });
});
