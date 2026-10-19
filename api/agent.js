// The extension checks in here (with its key): it sends the dashboard data
// when it changed and the results of the commands it ran, and takes the
// commands waiting for it. A check-in with nothing new costs 3 database
// commands.
import { handler, readJson, send, cors } from '../lib/http.js';
import { requireAgent } from '../lib/auth.js';
import { batch, key } from '../lib/store.js';

const MAX_SNAPSHOT = 950 * 1024;

export default handler(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  await requireAgent(req);
  const body = await readJson(req);
  const now = Date.now();
  const cmds = [];
  let snapshotAt = Number(body.snapshotAt) || 0;
  if (body.snapshot) {
    const text = JSON.stringify(body.snapshot);
    if (text.length > MAX_SNAPSHOT) return send(res, 413, { error: 'data too large', code: 'tooLarge' });
    cmds.push(['SET', key('snapshot'), text]);
    snapshotAt = now;
  }
  const results = Array.isArray(body.results) ? body.results.slice(0, 50) : [];
  if (results.length) {
    cmds.push(['LPUSH', key('results'), ...results.map((r) => JSON.stringify({ ...r, at: now }).slice(0, 20000))], ['LTRIM', key('results'), 0, 29]);
  }
  cmds.push(
    ['SET', key('agentSeen'), JSON.stringify({ at: now, snapshotAt, version: String(body.version || ''), device: String(body.device || '').slice(0, 80) })],
    ['LPOP', key('commands'), 50],
    ['GET', key('viewerAt')],
  );
  const out = await batch(cmds);
  const [popped, viewerAt] = out.slice(-2);
  send(res, 200, {
    commands: (popped || []).map((c) => JSON.parse(c)),
    viewer: !!viewerAt && now - Number(viewerAt) < 120000,
    snapshotAt,
  });
});
