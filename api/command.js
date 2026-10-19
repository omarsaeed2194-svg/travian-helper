// Queue a command for the extension (it picks it up on its next check and
// sends back the result).
import crypto from 'node:crypto';
import { handler, readJson, send, sameOrigin } from '../lib/http.js';
import { requireLogin } from '../lib/auth.js';
import { batch, key } from '../lib/store.js';
import { REMOTE_COMMANDS, MAX_PENDING } from '../lib/commands.js';

export default handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'wrong origin' });
  await requireLogin(req);
  const { name, args } = await readJson(req, 300000);
  if (!REMOTE_COMMANDS.has(name)) return send(res, 400, { error: 'not available from the web app', code: 'notRemote' });
  const id = crypto.randomBytes(8).toString('hex');
  await batch([
    ['RPUSH', key('commands'), JSON.stringify({ id, name, args: args || {}, at: Date.now() })],
    ['LTRIM', key('commands'), -MAX_PENDING, -1],
  ]);
  send(res, 200, { id });
});
