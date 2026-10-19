// Local stand-in for Vercel: serves public/ and runs api/*.js the same way
// (Node req/res). Without Upstash settings it keeps data in memory; without
// APP_PASSWORD the password is "dev". For trying things out, not for use.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) process.env.TH_MEMORY_STORE = '1';
if (!process.env.APP_PASSWORD) { process.env.APP_PASSWORD = 'dev'; console.log('APP_PASSWORD not set: using "dev"'); }
const port = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const api = /^\/api\/([a-z]+)$/.exec(url.pathname);
  if (api) {
    const file = path.join(root, 'api', `${api[1]}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{}'); }
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let file = path.join(root, 'public', decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}`));
