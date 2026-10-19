// Builds public/ for Vercel: the web app's own pages (login, connect) and
// the extension's dashboard, unchanged, with web-shim.js in front of it so
// it reads the data the extension uploads instead of chrome.storage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
const ext = path.join(root, 'extension');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'web', 'static'), out, { recursive: true });
for (const dir of ['dashboard', 'src', 'icons']) fs.cpSync(path.join(ext, dir), path.join(out, 'app', dir), { recursive: true });

const page = path.join(out, 'app', 'dashboard', 'dashboard.html');
const html = fs.readFileSync(page, 'utf8');
if (!html.includes('<head>')) throw new Error('dashboard.html: no <head>');
fs.writeFileSync(page, html.replace('<head>', '<head>\n  <script src="/web-shim.js"></script>\n  <link rel="stylesheet" href="/web.css">'));
fs.cpSync(path.join(ext, 'icons', 'icon128.png'), path.join(out, 'favicon.png'));

const version = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ extension: version, builtAt: new Date().toISOString() }));
console.log(`built public/ (dashboard of extension ${version})`);
