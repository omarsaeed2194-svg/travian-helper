// What the extension last sent (the dashboard's data, only when it changed
// since `since`), whether it still checks in, how many commands wait, and
// (when asked) its last answers. `beat` marks someone as watching, so the
// extension checks in every few seconds meanwhile.
import { handler, send } from '../lib/http.js';
import { requireLogin } from '../lib/auth.js';
import { batch, key } from '../lib/store.js';

export default handler(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  await requireLogin(req);
  const q = new URL(req.url, 'http://x').searchParams;
  const since = Number(q.get('since') || 0);
  const cmds = [['GET', key('agentSeen')], ['LLEN', key('commands')]];
  if (q.get('results')) cmds.push(['LRANGE', key('results'), 0, 29]);
  if (q.get('beat')) cmds.push(['SET', key('viewerAt'), String(Date.now()), 'EX', 600]);
  const [seen, pending, results] = await batch(cmds);
  const agent = seen ? JSON.parse(seen) : null;
  const snapshotAt = (agent && agent.snapshotAt) || 0;
  const [snapshot] = snapshotAt && snapshotAt !== since ? await batch([['GET', key('snapshot')]]) : [null];
  send(res, 200, {
    snapshotAt: snapshot ? snapshotAt : since && snapshotAt === since ? since : 0,
    snapshot: snapshot ? JSON.parse(snapshot) : null,
    agent,
    results: q.get('results') ? (results || []).map((r) => JSON.parse(r)) : [],
    pending: Number(pending) || 0,
    now: Date.now(),
  });
});
