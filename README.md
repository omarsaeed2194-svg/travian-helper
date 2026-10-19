# Travian Helper

A helper for Travian: Legends: a Chrome extension that watches and plays
your villages, and a web app on Vercel that shows the extension's
dashboard from any phone or computer and lets you control it from there.

| Folder | What it is |
| --- | --- |
| [`extension/`](extension/) | The Chrome extension (Manifest V3): watching, alerts, build queue, autopilot, farm lists, escapes, alliance donations, culture points, new villages, Telegram control. See [extension/README.md](extension/README.md) (Arabic: [extension/README.ar.md](extension/README.ar.md)). |
| [`api/`](api/), [`lib/`](lib/) | The web app's server side: Vercel Functions (Node, no dependencies) and a small Upstash Redis client. |
| [`web/`](web/) | The web app's own pages (login, connect), the stand-in that lets the extension's dashboard run on the web, the build, and a local dev server. |

## How it works

```
Phone / any browser ──(web app password)──► Vercel: dashboard + API + Upstash Redis
                                                     ▲  data up · commands down
                                                     │  (key from the Connect page)
                         Your Chrome + the extension ┘ ──► Travian (you stay logged in as usual)
```

- The extension keeps doing the work in your browser, where you're logged in
  to Travian. Every minute (every few seconds while the web app is open), the
  browser that runs the bot uploads the dashboard's data and runs the
  commands you gave in the web app, then reports the results back.
- The web app is the extension's own dashboard: the same pages, menu and
  buttons, plus a bar on top showing how fresh the data is.
- **Your Travian password is never asked for and never leaves your browser.**
  Neither do your Telegram token, Telegram chat, Discord address or the web
  key: they're masked before upload, and the web app can't change them.
  Backups, wiping data and taking over from another browser only work in the
  extension itself.
- Viewing works any time (the last data). **Actions need a computer with
  Chrome open and the extension connected.** A Vercel function can't run a
  browser all day (and the free plan runs scheduled jobs at most once a day),
  so a bot running without your computer would need an always-on server.
  That can be added later behind the same dashboard and API.

## Deploy on Vercel (about 10 minutes, free plan)

1. **Import the project.** In [Vercel](https://vercel.com/new): *Add New →
   Project → Import* `omarsaeed2194-svg/travian-helper`. Leave *Framework
   Preset* on **Other** and *Root Directory* as is: `vercel.json` sets the
   build (`npm run build`) and the output folder (`public`). Deploy. The
   first deploy shows a login page saying what's still missing.
2. **Add the database.** Project → **Storage** → *Upstash for Redis* (free)
   → *Create* → connect it to this project. Vercel adds its connection
   settings (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) for you.
3. **Set the password.** Project → **Settings → Environment Variables** →
   add `APP_PASSWORD` with a long password of your own (this is the web
   app's password, **not** your Travian password).
4. **Redeploy.** *Deployments* → the latest → *Redeploy*, so the new settings apply.
5. **Log in and create a key.** Open `https://<your-project>.vercel.app`,
   log in, then **Connect extension** → *Create key* → copy it (it's shown once).
6. **Connect the extension** (version 2.5.0 or newer, the `extension/`
   folder of this repo). In the extension's dashboard: **Settings → Web app**
   → paste the address (`https://<your-project>.vercel.app`) and the key.
   Within a minute it says *Connected*, the Connect page says *Extension
   connected*, and your villages show in the web app.

To stop: delete the key's text in the extension, or create a new key on the
Connect page (the old one stops working). *Log out* ends the session on that
device. Logins are limited to 10 tries per 15 minutes per address.

### Updating

Push to `main` and Vercel redeploys. The web app shows the dashboard of the
`extension/` folder it was built from; update the extension in Chrome to
the same version (`chrome://extensions` → reload after replacing the files).

### Costs and limits

- Vercel *Hobby* (free): enough for one player.
- Upstash Redis free plan: the extension checks in about 1,500 times a day
  (a few database commands each), more while the web app is open: well
  within the free plan. Each upload must stay under 1 MB; the extension
  leaves out the biggest parts (the map's player list first) if needed.

### Try it on your computer

```bash
npm run dev          # builds public/ and serves http://localhost:3000
```

Without Upstash settings the data stays in memory; without `APP_PASSWORD`
the password is `dev`. In the extension use `http://localhost:3000` as the
address (plain http is accepted only for this computer).

## Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick the `extension/` folder.
3. Open your Travian server in the same browser and log in.

> Travian's rules prohibit bots and scripts that play for you; accounts
> caught using them can be banned. The automation features are off until
> you switch them on, and you use them at your own risk.
