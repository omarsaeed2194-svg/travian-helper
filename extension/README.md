# Travian Helper — Chrome extension

**[الدليل بالعربية](README.ar.md)** · The extension's interface is in Arabic
by default; switch to English under **Settings → Language**.

Keeps track of your **Travian: Legends** villages and runs your routine while
you're away:

- **Watch & alert** — re-checks every village on a timer and alerts you
  (desktop, Telegram and/or Discord) about **incoming attacks** (with arrival
  time), **warehouse/granary filling up**, **crop running out**, and **being
  logged out**.
- **Build queue** — queue upgrades per village ("Main Building → level 10"),
  or "upgrade all resource fields to level N" (lowest field first). The bot
  starts the next upgrade as soon as a builder is free and you can afford it,
  using the game's own "enough resources at…" timer to know when to retry.
- **Troop training** — rules like "train 20 Legionnaires in Barracks every
  60 minutes" (trains as many as you can afford, up to that number).
- **Farm lists kept in the extension** — your farms are saved in the extension,
  not in the game's farm list. Make lists (village, every N minutes, raid or
  normal attack), paste targets one per line (`12|-34 Name`), and set the
  troops per target (any mix of units). Each round sends to the targets
  waiting longest first while troops last; oases are checked for animals
  first; a target that fails three times in a row (beginner's protection,
  village gone…) is switched off. "Send now" works any time, and the lists
  sync to your other browsers with the rest of your commands.
- **Inactive finder** — scans the map around a village and remembers each
  player village's population; it looks again every ~12 hours (while
  automation runs) and lists players whose villages didn't grow over 20+
  hours, nearest first, with one click to add them to a farm list. Natars are
  left out.
- **Raid reports** *(experimental, off by default)* — about 15 minutes after
  a farm round it opens the report list, matches raids to your farms by
  village name, shows each farm's last result, bounty (full/half/empty) and a
  score, and pauses a farm when the raid was lost or troops died twice
  running. The report page hasn't been checked against a saved copy yet; if
  it isn't recognised the Activity log says so.
- **Game farm lists** — can also press "Start all" (or the lists you pick) on
  the game's own farm lists every N minutes.
- **Hero adventures** — sends the hero out whenever they're home and an
  adventure is available.
- **Troop escape (no Gold Club)** — per village, a plan: when an attack is on
  its way, the village's troops (all units or the ones you pick, optionally
  the hero) leave as reinforcement to another of your villages a set number
  of seconds before it lands. If that village is under attack too, they go to
  your nearest safe village. It runs on a precise timer, interrupts anything
  else the bot is doing, and works with automation off and while you play — it
  only needs "Watch & alert". You get an alert when the troops leave, if it
  fails, and when the attack is over (send them back from the rally point; they
  eat the other village's crop meanwhile). Attacks are noticed at each check,
  so keep "Check every" shorter than your attackers' travel time.
  Optionally, right after the troops leave, it **spends the stock** on a unit
  you choose (as many as the storage pays for) so the attacker finds less.
  After the attack a **Bring back** button opens the rally point to call the
  troops home (that step stays manual).
- **Donate to the alliance before an attack** — on the same
  plan, the village's resources go to an alliance bonus a set number of
  seconds before the first attack lands (60 by default), so the attacker
  finds nothing to steal; it can keep what the crannies hide, and works with
  or without moving the troops. It has its own precise timer, runs with
  automation off, and checks afterwards that it really went in (the alliance
  page's own count of today's donations, or the stock allowing for what the
  fields made meanwhile). Press
  **Test now** (donates 10 of each) once while you watch. It picks the bonus you
  chose (Philosophy also raises culture points), presses the green
  Contribute — never the gold ×3 — and keeps within the daily limit.
- **Troops** — the troops in each village and what the barracks, stable and
  workshop are training (with finish times), in the Overview, the Troops &
  training page and the popup.
- **Wounded troops** *(experimental)* — in villages with a Hospital (or the
  Spartans' Asclepeion), the
  wounded are healed as far as the resources go (each kind up to the game's
  own "max"), every hour (you choose) and a few minutes after an attack
  ends. The Troops & training page shows the wounded, those being healed and
  the next look. Not yet checked against a saved Hospital page.
- **Simple mode** — a switch in the menu: only Overview, Brain, Defense,
  Alerts, Settings and Health, with the brain's main switches (checks,
  pause while you play, rest hours, healing) on its page.
- **Brain** (page *Brain*) — runs every village by itself, free and inside
  the extension (nothing is sent anywhere). It gives each village a role
  (economy, or the army village: with three villages or more, the one making
  the most crop) and follows a clear build order for that role (fields and
  buildings in turn: Main Building, storage, barracks, academy, smithy,
  stable, wall…). A building it can't put up yet is no dead end: whatever
  it needs is built first (and what that needs, in turn), with the
  requirements read from the game's own empty-site pages, else from the
  game's rules; a step the game refuses is passed over for the next one, and
  an upgrade that costs more than the stores hold brings a bigger warehouse
  or granary first. It researches the units the village's role needs in the
  Academy and improves them in the Smithy *(experimental: not yet checked
  against a saved Academy/Smithy page)*, trains troops in every training
  building once the stores fill up (defence in economy villages; attack
  units in the army village, which trains earlier and spends twice the
  share), never more than the crop can feed, and when an attack comes it
  makes an escape plan that moves only the attack units and the hero, while
  the defence stays. Under attack it reads the rally point: where the attack
  comes from and, with when it was first seen, how fast it can be — so
  whether rams, catapults or a chief can be in it, or only fast riders. When
  the attack is small (the rally point shows its kinds of units), half the
  defence of nearby villages comes over instead — only if the trip time on
  the confirmation page shows it lands in time — and the attack units stay
  home to fight; bigger or unknown attacks keep the escape plan. Those trip
  times also measure the server's troop speed. It also sends resources
  between villages with the marketplace *(experimental: the "send
  resources" page hasn't been checked against a saved page)*: a village
  waiting to build gets what it lacks from the nearest one with plenty
  (each sender keeps 40 %), and the fields it raises first among equals are
  those of the resource the next buildings need most. Its limits: no gold,
  no attacks on players (farm lists stay your own switch), at most a few
  trainings, researches and transfers a round.
  Every decision, the next building step and the goal it serves are on its
  page; you can set a village's role by hand.
- **Autopilot** — one switch for when you're away. When a village's build
  queue is empty it picks the next upgrade itself (warehouse/granary when
  90% full → crop when the village is short of crop → Main Building up to the
  fields' level → the lowest resource field, up to a level you choose). It
  also **puts up missing buildings** on free sites (warehouse and granary once
  storage fills or fields reach 2, rally point, cranny, marketplace, barracks,
  your tribe's wall) as soon as the game allows them, **collects task
  rewards** into the village with the most free storage, and — if you tick it
  — tops up an upgrade that waits for resources with **just the missing amount
  from the hero's bag**. It sends the hero on adventures and starts farm lists
  if you tick them. The Autopilot page shows what it will do next in every
  village. You can also queue a **new building on a free site** yourself in
  the Build queue page.
- **Culture points** — a page that shows your village slots and the progress
  to the next one (read from the game's own sidebar on every page), the pace
  and an estimated date, and how many culture points each village makes a day.
  With **Autopilot builds for culture points** on, every village picks the
  upgrade or new building with the most culture points per resource (Main
  Building, Embassy, Marketplace, Academy, Town Hall…), using the game's
  building costs — checked against the real pages — after keeping storage
  and crop safe. **Celebrations** *(experimental)*: a small (or great, at
  Town Hall 10+) celebration in every village with a Town Hall as soon as
  the last one ends; the village saves for it, and the extension checks that
  the resources really went. You get an alert (and Telegram) when a new
  village slot opens.
- **New villages** *(experimental)* — instead of taking one Residence to 20,
  every village takes its Residence (or Palace) to 10 and trains three
  settlers once; the village they found does the same. One village works on
  it per free culture points slot (one always gets ready ahead). The
  autopilot builds the Residence (Main Building to 5 first), automation
  trains the settlers when a slot is free or 85 % there, and you get an alert
  when they are home, with where to found: your own list of places, or the
  best free valley the map showed — crop fields count most (15 and 9
  croppers), then free oases within 3 fields, then nearness; big player
  villages next door count against it (its layout and why are shown). Sending them
  stays with you: open the valley in the game and press "Found new village".
  The extension notices the founding, and the new village is next. On the
  Culture page; the Residence's settler form and the valley layouts haven't
  been checked against a saved page yet.
- **Telegram control** — besides alerts, the bot answers commands sent to it
  in Arabic or English: `status`/`الحالة`, `pause`/`وقف`, `resume`/`شغل`,
  `check`/`افحص`, `farms`/`مزارع`, `escape`/`اهرب`, `summary`/`ملخص`. Commands
  older than 5 minutes are ignored. A **daily summary** arrives at the hour you
  pick (what was built, trained, farmed, attacks, escapes, errors, and what
  needs you now).
- **Oasis raids** — raids empty oases near a village with the unit and number
  you choose, every N minutes. It finds oases on the game map (or uses
  coordinates you add), opens each oasis right before sending and only raids
  when it has **no animals and no owner**, and only confirms when the
  confirmation page names that same oasis. If a step fails, the Activity log
  says which one (for example "could not find the Raid option"). If the map
  service refuses the extension's own request, it opens the map page and
  reads what the game itself loads there (checked against a saved map page,
  with a stand-in for the game's map script). The same look also notes free
  valleys for the new-village plan.
- **Overview dashboard** — filter by village; headline numbers (stock,
  production, net crop, time until storage is full, incoming attacks, builders);
  **alerts & tips** worked out from each village's state (attacks, starvation,
  full storage, idle builders, unbalanced fields, missing cranny/wall, bonus
  buildings you can now build, hero adventures, farm lists…) with one-click
  actions; resource meters, a 24-hour stock chart, field levels and key
  buildings, plus construction, troop movements and activity. It updates live
  as things happen (finished upgrades, attacks starting and ending). Each
  village is drawn from its real state (keep height, wall, fields, scaffolding
  while building, red flag under attack), with a hero card beside it.
  The Overview also has a **next-6-hours timeline** (builds and training
  finishing, troops arriving, storage full, crop running out, escapes, farm
  rounds, raids), a **mini map** (your villages, farms, oases, raid targets,
  escape routes, attacks — click a village to filter), **unit icons**, and
  **resource balance** suggestions between villages with a button to open the
  marketplace (sending stays manual).
- **Popup** — live resources, time until storage is full, build queue
  countdowns and attack warnings at a glance, plus **quick actions** (check
  now, send all farm lists, pause/resume everything, escape now) and one line
  per village when you have many (tap to open its card).
- **Health page** — whether the bot is running and where, what's switched off
  and why, each job's last success and failure, the last day's errors, and
  how fresh each village's data is.
- **Dashboard menu in groups** — Overview, then **Economy** (Build queue,
  Culture points), **Army** (Troops & training, Defense & escape, Farm lists,
  Oasis raids), **Automation** (Autopilot, Hero & adventures) and **System**
  (Alerts & Telegram, Settings, Health, Activity log). Every page has a title
  and links to the pages that work with it (Defense → Troops, Alerts; Farm
  lists → Oasis raids, Autopilot…). The Overview's troops, queues and
  movements panels, each Health row and the tips open the page where that
  thing is set up, and old links (`#raids`, `#escape`) still land on the
  right page. On a phone the menu is one row that scrolls sideways.
- **Web app** — the same dashboard on your own web app (Vercel), from any
  phone or computer: the browser that runs the bot uploads its data every
  minute (every few seconds while the web app is open) and runs what you do
  there — settings, build queue, training, farm lists, escapes, pause/resume,
  check now. Set it up in Settings → Web app with the address and the key
  from the web app's Connect page. Your Travian password, Telegram token and
  Discord address never leave the browser; backups, wiping data and the web
  link itself can only be changed here. Actions still need Chrome running
  with the extension. The web app's code and how to deploy it are in the
  travian-helper repository.
- **Light/dark** — follows your computer, or pick one (popup, dashboard or
  Settings). The dashboard works on a phone-sized window too.

Works on Travian: Legends servers (`*.travian.com`, e.g.
`ts3.x1.arabics.travian.com`). It does **not** support Travian: Kingdoms.

> **Heads-up:** Travian's game rules prohibit bots and scripts that play for
> you, and accounts caught using them can be banned. The "Automate actions"
> and Autopilot features are exactly that kind of tool (regular raids around
> the clock are especially easy to spot), and even "Watch & alert" reloads
> game pages on a timer. Use it on your own account at your own risk — and
> consider leaving automation off on an account you care about.

## Install

1. Download this folder (`travian-extension/`).
2. Open `chrome://extensions` in Chrome (or Edge/Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `travian-extension` folder.
5. Pin the extension (puzzle-piece icon → pin) so the castle icon is visible.

## Updating without losing your commands

From version 1.3 the extension has a fixed ID (`joghiimcpihpcnaanfcefiligknbbbgc`),
so updates keep your build queue, training rules and settings:

1. Unzip the new version **over the old folder** (replace the files).
2. Open `chrome://extensions` and press the **reload ⟳** button on Travian Helper.

Don't press **Remove** — that deletes the extension's data in this browser
(it can still be restored from Chrome sync or a backup file, see below).

### One-time move from version 1.2 or older

Older versions had no fixed ID, so their commands can't carry over by
themselves. Save them first:

1. Open the **old** version's dashboard, press **F12**, open the **Console** tab.
2. If Chrome asks, type `allow pasting` and press Enter. Then paste this line
   and press Enter — it downloads `travian-helper-backup.json`:
   ```
   chrome.storage.local.get(null).then(d=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d)]));a.download='travian-helper-backup.json';a.click()})
   ```
3. Remove the old version in `chrome://extensions`, then **Load unpacked** the new one.
4. In the new dashboard: **Settings → Save & sync → Restore from backup**, and
   pick the downloaded file.

## Your commands in another browser

- **Chrome sync:** commands are saved to your Chrome account automatically.
  Install the extension in Chrome on another computer, signed in to the same
  Google account with sync on (Settings → You and Google → Sync → make sure
  **Extensions** is on), and your commands appear there.
- **One browser runs the automation at a time.** The others show "running on
  another browser". If that browser is closed, another one takes over within
  3 minutes — or press **Run automation here** in Settings.
- **Backup file:** Settings → Save & sync → **Download backup** /
  **Restore from backup**. Use it for browsers without Chrome sync (e.g. Edge)
  or just to keep a copy.

## First run

1. Log in to your Travian server in the same browser and open your village.
   The extension detects the server and your villages from that page.
2. Click the castle icon. Your villages show up with live resources.
3. Open the **Dashboard** to:
   - **Build queue** — pick a village, then "Queue" fields or buildings to a
     target level, or add an auto-upgrade for resource fields.
   - **Troops & training** — add training rules. (Open each barracks/stable
     once in Travian so real unit names appear.)
   - **Defense & escape** — an escape plan and/or an alliance donation for
     villages that may be attacked.
   - **Farm lists** — your own lists, the inactive finder, and the game's farm
     lists. (Open Rally Point → Farm List once so the game's lists appear.)
   - **Hero & adventures** — send the hero on adventures.
   - **Alerts & Telegram** — set up phone alerts and press **Send test alert**.
4. Flip **Automate actions** on (popup or dashboard sidebar).

### Phone alerts

- **Telegram:** message `@BotFather`, send `/newbot`, copy the token. Send any
  message to your new bot, open
  `https://api.telegram.org/bot<token>/getUpdates`, and copy `chat.id`. With
  **Control from Telegram** on, send `help` (or `الأوامر`) to the bot for the
  command list. Only that chat is obeyed, and only the browser that drives the
  game answers.
- **Discord:** Server Settings → Integrations → Webhooks → New Webhook → Copy
  Webhook URL.

## How it works

- The extension reads the game pages: resources, production, build queue,
  troop movements, the village list (which flags attacked villages on every
  page), and so on. Anything you open yourself updates the dashboard too.
- To act, it opens one pinned **bot tab** and works in it: it navigates to the
  right page and presses the same buttons you would. It waits a random 1–4
  seconds between steps, and spreads its timers by ± the "randomize" percentage
  in Settings.
- **Pause while I'm playing** (on by default): when you click or type in a
  Travian tab, the bot stays idle for a few minutes so it doesn't switch your
  active village under you. Just having the game open doesn't count — the game
  reloads itself when timers finish, and that no longer pauses the bot.
- **Why isn't it building?** Each village in the popup and the Build queue page
  shows the reason the next upgrade hasn't started (automation off, paused
  while you play, builders busy until…, waiting for resources…). "Check now"
  retries queued upgrades immediately.
- **Active hours** (optional): limit automation to a time window. Watching and
  alerts keep running outside it. 00:00–00:00 means the whole day.
- **When something fails:** a job that hits an error waits 10 minutes before
  it is tried again (5 for the village check), instead of every minute. "Pause
  all" or switching automation off stops a run that is already going. An
  attack that appears in the middle of a long run starts the escape plan at
  once. A page that isn't the game's (a captcha, maintenance) is reported
  straight away with its title.
- **The bot tab in the background:** Chrome slows chained timers in a hidden
  tab to one a minute after five minutes. The extension's waits are built so
  they don't chain, so multi-step actions (sending troops, donating, the hero
  bag, quests) run at normal speed in the pinned tab.
- Everything is stored locally in Chrome (`chrome.storage.local`). Nothing is
  sent anywhere except the alerts you configure (to Telegram/Discord).

### Limits

- **Your computer must stay on with Chrome open** (and not asleep) for the bot
  and alerts to run. If you need alerts with the computer off, you'd need a
  server-side setup instead.
- It can't log in for you. If your session expires you get an alert and the
  bot pauses until you log in again.
- **Checked against saved game pages:** building sites, task rewards, the
  hero's bag, rally point send form, training, farm lists, map tiles, the
  alliance bonus page. **Not
  yet checked:** the Town Hall page (celebrations are experimental), the report list (raid reports are experimental), the
  marketplace send page and calling troops back (both stay manual for now),
  hero attribute points, academy research and smithy upgrades (not
  automated).
- If Travian changes its page layout, parts of it may stop working until the
  selectors in `src/parser.js` and `src/content.js` are updated. Watch the
  **Activity log** for errors, and use **Bot health → Copy report** to send
  what happened (no passwords, tokens or keys are in it).
- **Map scans** open the game's own map page in the bot tab and read what
  the game loads there, then send the game's own request again (same
  address and headers, only the coordinates changed) for every other area:
  around every village with **Scan the map around all villages**, up to 77
  tiles around each (one answer covers ±15). The extension never calls the
  game's own scripts (guessed calls made the game show "an unexpected
  error"). If the game's request can't be reused, each area gets its own
  map page; if the map page shows nothing, the extension sends its own
  request. Numbers in the map's tooltips are written with direction marks
  on right-to-left servers; they are removed before reading animals and
  population.

## Files

```
manifest.json          Chrome extension manifest (MV3)
src/parser.js          Reads game state out of Travian pages (pure DOM parsing)
src/content.js         Runs on Travian pages: reports state, performs clicks
src/background.js      Service worker: storage, alerts, scheduler, bot jobs
src/shared.js          Constants and helpers (building names, projections, defaults)
src/i18n.js            Arabic and English UI strings (Arabic is the default)
src/sync.js            Saves commands to Chrome sync; one-browser-at-a-time lease
src/advisor.js         Game tips worked out from each village's state
src/autopilot.js       Autopilot choices: next upgrade, which oases to raid, farm targets
src/escape.js          Troop escape: when to leave, where to, which troops
src/telegram.js        Telegram commands, status and daily summary texts
src/timeline.js        Events of the next hours for the Overview timeline
src/units.js           Unit kinds and their icons
src/health.js          The Health page's report
src/inactive.js        Inactive finder: population snapshots and verdicts
src/reports.js         Raid reports matched to farms; pausing rules
src/merchants.js       Resource balance between villages: suggestions, and the brain's transfers
src/attacks.js         Incoming attacks: speed range, likely units, help or escape
src/buildplan.js       The brain's build orders and prerequisites
src/culture.js         Culture points: per-building values and costs, best picks, celebrations, pace
src/expansion.js       New villages: who builds a Residence, trains settlers, where to found
src/mapHook.js         On the map page only: passes on the map tiles the game loads
src/web.js             Web app link: what is uploaded (secrets masked), which commands it may send
src/ui.js / ui.css     Village cards and styles shared by popup and dashboard
popup/                 Toolbar popup
dashboard/             Full dashboard (also the extension's options page); dashboard.js builds the
                       grouped menu and each page's related links, overview.js renders the
                       Overview, autopilot.js the Autopilot and Oasis raids pages, farms.js the
                       farm lists, escape.js the Defense page, finder.js the inactive finder,
                       culture.js the Culture page, health.js the Health page, minimap.js the map,
                       chart.js the 24-hour stock chart, art.js the village/hero drawings
icons/                 Extension icons
```
