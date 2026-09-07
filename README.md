# GymTracker

A personal gym log that lives on your phone. Log sets in the gym, watch the
numbers move over months, and send a session to your trainer in two taps.

No account, no server, no subscription, no tracking. It installs to your home
screen and works with the phone in airplane mode.

---

## What it does

**Log**
- 250 built-in exercises and machines, searchable and filterable by muscle or equipment
- Weight × reps, plus timed holds (planks, hangs) and cardio (distance + time)
- Per-set **RPE**, per-set **notes**, and **warm-up / drop-set / to-failure** flags
- **Rest timer** that starts on its own when you tick a set — ±15s, pause, skip,
  chime and vibrate; it counts against a timestamp, so locking the phone mid-rest
  doesn't stall it
- **Last-time reference** on every exercise and every set row, so you know what to beat
- Add your own exercises; hide the machines your gym doesn't have

**Routines**
- Save any finished workout as a template, or build one from scratch
- Starting a routine pre-fills the sets, reps and weights — you only correct what changed

**Progress**
- Training volume per week, working sets per week, a training-days calendar, and
  sets by muscle group
- Per exercise: heaviest set over time and volume per session
- One time-range control (4 weeks → 1 year) scopes every chart at once
- Every chart has a data-table view and a "share as image" button

**Share with your trainer**
- A clean, WhatsApp-formatted message you can edit before it goes
- Per workout, per exercise, or a whole-period summary
- Opens WhatsApp directly (straight to your trainer's chat if you save their
  number), or goes through the phone's native share sheet, clipboard, or a `.txt` file

**Your data**
- Stored on-device in IndexedDB. Weights are kept in kilograms and converted for
  display, so switching kg ↔ lb never changes what you actually lifted
- Full JSON backup and restore, plus a CSV export with one row per set
- A nudge to back up if it's been a month

---

## Running it

### From VS Code

Press **F5**. That's the whole thing.

The run configurations are in `.vscode/launch.json`:

| Configuration | What it does |
| --- | --- |
| **Run GymTracker (Chrome)** | Starts the server and opens Chrome with the debugger attached — breakpoints in `src/`, `console.log` in the Debug Console. The default. |
| **Run GymTracker (Edge)** | The same, in Edge. |
| **Run GymTracker (default browser, no debugger)** | Starts the server and just opens your normal browser. |
| **Serve on the local network** | Prints your LAN address so you can open the app on your phone. |
| **Smoke test** | Runs the 27 end-to-end checks. |
| **Smoke test (watch it run…)** | The same, in a visible browser window, so you can see it drive the app. |

Stopping the debug session shuts the server down with it, so nothing is left
holding port 5173.

The debug browser uses a profile under `.vscode/.browser-profile-*` rather than
a throwaway one, so the workouts you log while testing are still there next
time you hit F5.

There are also tasks under **Terminal → Run Task…** for the smoke test,
screenshots, regenerating the icons, and validating the exercise data. `Ctrl+Shift+P`
→ *Tasks: Run Test Task* runs the smoke test directly.

### From a terminal

```bash
npm start                    # → http://localhost:5173
npm run serve:lan            # also binds your LAN address, for your phone
npm test                     # the end-to-end smoke test
npm run test:shots           # ...and save a screenshot of every screen
npm run check                # validate the exercise library data
npm run icons                # regenerate the app icons
```

No install step, no build, no dependencies — `npm install` has nothing to do.
The server exists only because service workers and "Add to Home Screen" don't
work from a `file://` URL.

## Installing it on your phone

Browsers only offer installation over **https** or **localhost**, so for daily
use put the folder on any static host — GitHub Pages, Netlify, Cloudflare Pages,
or a folder on your own domain. Everything is relative-path, so it works from a
subdirectory.

With GitHub Pages, for example: push this folder to a repo, enable Pages on the
branch, open the URL on your phone, then

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

It then opens full-screen, with no browser chrome, and works offline.

> Your data lives in the browser storage of whichever device you installed it
> on. It does not sync. Export a backup from **Settings** before you switch
> phones or clear browser data.

---

## Layout

```
index.html              app shell
styles.css              design tokens + every component
manifest.webmanifest    PWA metadata
sw.js                   offline cache (bump CACHE to force an instant update)
src/
  app.js                hash router, tab bar, rest-timer bar, boot
  store.js              all state; loads into memory, writes through to IndexedDB
  db.js                 IndexedDB wrapper
  exercises.js          the 250-exercise seed library
  charts.js             hand-rolled SVG charts
  share.js              WhatsApp text, CSV, chart-to-PNG, delivery
  timer.js              rest timer
  ui.js                 DOM helpers, icons, toasts, dialogs, sheets
  util.js               dates, units, formatting
  theme.js              light/dark stamping
  views/                log, history, library, progress, routines, settings, picker
.vscode/
  launch.json           F5 run configurations
  tasks.json            server, tests, icon and data tasks
tools/
  serve.mjs             local static server
  make-icons.mjs        regenerates the app icons
  smoke-test.mjs        end-to-end test in headless Chrome
  check-library.mjs     validates the exercise data
```

## Testing

The smoke test drives real Chrome over the DevTools protocol (nothing to
install) and walks a full session: start a workout → search the library → add
exercises → log sets with RPE → flag a warm-up → finish → read the share text →
check every chart renders marks → switch units → switch to dark mode → save and
start a routine → export, wipe and restore a backup. It fails on any console
error or uncaught exception.

---

## Notes on how it's built

**No build step, on purpose.** Plain ES modules, no framework, no bundler, no
dependencies. A personal log you want to still be using in five years shouldn't
need a toolchain resurrected to change a colour.

**Everything in memory.** A training log is small — a few thousand workouts at
most — so `store.js` loads it all on boot. Every query, charts included, is a
plain array scan. No indexing strategy to maintain.

**Charts are hand-rolled SVG** and follow a specific discipline:

- one measure per plot — **never** a second y-axis; two measures get two charts
- single-series plots use one colour and no legend box; the title names the series
- solid hairline gridlines, thin marks, rounded data-ends anchored to the baseline,
  a 2px surface gap between bars and a 2px surface ring on markers
- direct labels only where they earn it (the endpoint, the maximum), never one per point
- a hover tooltip on everything, plus a **table view** on every chart, so no
  value is reachable only by hovering
- they re-render at true pixel width via `ResizeObserver`, so axis labels never
  shrink on a phone

**Updates land one launch later.** The service worker serves cached assets
immediately and refetches them in the background, so a redeploy shows up the
next time you open the app. Bump `CACHE` in `sw.js` if you want it to apply on
the very next launch instead.

**Colour** is a colourblind-safe palette validated against the light and dark
surfaces rather than eyeballed; dark mode is a separately chosen set of steps,
not an inverted light mode. Weekly buckets start on Monday, and weeks with no
training render as zero rather than vanishing from the axis.

**Icons** are generated by `tools/make-icons.mjs`, which writes PNGs directly
with a ~40-line encoder over Node's own zlib — no image library to install now
or re-install later.
