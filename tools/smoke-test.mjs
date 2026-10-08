// End-to-end smoke test: launches the real app in headless Chrome, walks a full
// session (start → add exercise → log sets → finish → history → charts) and
// fails on any console error, page exception or missing element.
//
//   node tools/smoke-test.mjs [--headed] [--shots <dir>] [--url <base>] [--dark]
//                             [--tz <zone>]
//
// --url points the run at an already-served copy (a subdirectory host, or the
// live site) instead of starting the bundled server.
//
// --tz overrides the browser's timezone, e.g. --tz Pacific/Auckland. The app
// names sessions by the hour, so this is how you reproduce a time-of-day bug
// without waiting for the clock. (Chrome ignores the TZ env var on Windows.)
//
// Uses the DevTools protocol directly, so there is nothing to install.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const urlIdx = process.argv.indexOf('--url');
const EXTERNAL = urlIdx > -1 ? process.argv[urlIdx + 1].replace(/\/?$/, '/') : null;
const BASE = EXTERNAL || `http://127.0.0.1:${PORT}/`;
const HEADED = process.argv.includes('--headed');
const DARK = process.argv.includes('--dark'); // capture every screenshot in dark mode
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > -1 ? process.argv[shotsIdx + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const tzIdx = process.argv.indexOf('--tz');
const TZ = tzIdx > -1 ? process.argv[tzIdx + 1] : null;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome/Edge found. Set CHROME_PATH.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP client

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params, msg.sessionId));
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
}

async function fetchJson(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`Gave up waiting for ${url}`);
}

// ---------------------------------------------------------------- harness

const problems = [];
const steps = [];
let stepNo = 0;

function ok(label, detail = '') {
  steps.push(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail) {
  problems.push(`${label}: ${detail}`);
  steps.push(`  ✗ ${label} — ${detail}`);
}

async function main() {
  const server = EXTERNAL
    ? null
    : spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  server?.stderr.on('data', (d) => console.error('[server]', String(d).trim()));
  if (EXTERNAL) console.log(`Testing against ${BASE}`);
  await sleep(400);

  const userDataDir = mkdtempSync(join(tmpdir(), 'gt-chrome-'));
  const chrome = spawn(
    chromePath,
    [
      HEADED ? '--headless=false' : '--headless=new',
      '--remote-debugging-port=9333',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=430,900',
      'about:blank',
    ].filter((a) => a !== '--headless=false'),
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const cleanup = () => {
    try { chrome.kill(); } catch { /* already gone */ }
    try { server?.kill(); } catch { /* already gone */ }
  };
  process.on('exit', cleanup);

  const version = await fetchJson('http://127.0.0.1:9333/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new Cdp(ws);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') {
      const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (/favicon|Download the React/i.test(text)) return;
      problems.push(`console.${p.type}: ${text}`);
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    problems.push(`uncaught: ${d.exception?.description || d.text}`);
  });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 900, deviceScaleFactor: 2, mobile: true,
  }, sessionId);
  if (TZ) await cdp.send('Emulation.setTimezoneOverride', { timezoneId: TZ }, sessionId);

  const evaluate = async (expression, label = 'evaluate') => {
    const res = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (res.exceptionDetails) {
      throw new Error(`${label} threw: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result.value;
  };

  const waitFor = async (selector, timeout = 8000, label = selector) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // eslint-disable-next-line no-await-in-loop
      const found = await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (found) return true;
      await sleep(100);
    }
    fail('waitFor', `${label} never appeared`);
    return false;
  };

  const shot = async (name) => {
    if (!SHOTS) return;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(SHOTS, `${String(++stepNo).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
  };

  // ------------------------------------------------------------- 1. load
  await cdp.send('Page.navigate', { url: BASE }, sessionId);
  await waitFor('#content .view', 10000, 'app shell');
  ok('App boots', await evaluate('document.querySelectorAll(".tab").length + " tabs"'));
  await shot('start');

  if (DARK) {
    await evaluate(`
      (async () => {
        const s = await import(new URL('src/store.js', location.href));
        const t = await import(new URL('src/theme.js', location.href));
        await s.saveSettings({ theme: 'dark' });
        t.applyTheme('dark');
      })()`, 'force dark');
    await sleep(250);
    ok('Dark mode forced for this run');
  }

  const exCount = await evaluate('window.__t = null, document.querySelectorAll(".tab").length');
  if (exCount !== 5) fail('Tab bar', `expected 5 tabs, got ${exCount}`);

  // ------------------------------------------------------------- 2. start workout
  await evaluate('document.querySelector(\'[data-a="start-empty"]\').click()');
  if (!(await waitFor('.workout-head', 5000, 'active workout header'))) return finish(cleanup);
  ok('Workout started');

  // ------------------------------------------------------------- 3. add exercises
  await evaluate('document.querySelector(\'[data-a="add-exercise"]\').click()');
  await waitFor('.picker-list .picker-row', 5000, 'exercise picker');
  const libCount = await evaluate('document.querySelectorAll(".picker-list .picker-row").length');
  ok('Exercise picker opens', `${libCount} exercises listed`);
  await shot('picker');

  await evaluate(`
    (() => {
      const i = document.querySelector('.picker .search-input');
      i.value = 'barbell bench';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  await sleep(350);
  const searchCount = await evaluate('document.querySelectorAll(".picker-list .picker-row").length');
  if (!searchCount) fail('Search', 'no results for "barbell bench"');
  else ok('Search filters library', `${searchCount} matches for "barbell bench"`);

  await evaluate('document.querySelector(".picker-list .picker-row").click()');
  await evaluate(`
    (() => {
      const i = document.querySelector('.picker .search-input');
      i.value = 'lat pulldown';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  await sleep(350);
  await evaluate('document.querySelector(".picker-list .picker-row").click()');
  await evaluate('document.querySelector(\'.picker-foot [data-a="add"]\').click()');
  await waitFor('.entry', 5000, 'exercise cards');
  const entries = await evaluate('document.querySelectorAll(".entry").length');
  if (entries !== 2) fail('Add exercises', `expected 2 entry cards, got ${entries}`);
  else ok('Two exercises added');

  // ------------------------------------------------------------- 4. log sets
  const logSet = async (entryIdx, rowIdx, weight, reps) =>
    evaluate(`
      (() => {
        const card = document.querySelectorAll('.entry')[${entryIdx}];
        const row = card.querySelectorAll('.set-row')[${rowIdx}];
        if (!row) return 'no row';
        const w = row.querySelector('[data-f="w"]');
        const r = row.querySelector('[data-f="r"]');
        w.value = '${weight}'; w.dispatchEvent(new Event('change', { bubbles: true }));
        r.value = '${reps}';  r.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`);

  // RPE is opt-in now. Check it is absent by default, then turn it on, because
  // the share text and the timed-exercise row below both exercise it.
  const rpeDefault = await evaluate(`
    (() => {
      const t = document.querySelector('.set-table');
      return {
        flag: t?.dataset.rpe,
        select: !!t?.querySelector('.rpe'),
        head: [...t.querySelectorAll('.set-head span')].map(x => x.textContent).filter(Boolean).join('|'),
      };
    })()`, 'rpe default');
  if (rpeDefault.flag !== 'off' || rpeDefault.select) {
    fail('RPE hidden by default', JSON.stringify(rpeDefault));
  } else {
    ok('RPE column hidden by default', rpeDefault.head);
  }

  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      await s.saveSettings({ trackRpe: true });
      location.hash = '#/history';
    })()`, 'enable rpe');
  await sleep(300);
  await evaluate("location.hash = '#/log'");
  await sleep(500);
  if (!(await evaluate("!!document.querySelector('.set-table .rpe')", 'rpe on'))) {
    fail('RPE column enabled', 'the select is still absent after turning the setting on');
  } else {
    ok('RPE column appears when the setting is on');
  }

  await logSet(0, 0, 60, 10);
  await sleep(120);
  await evaluate('document.querySelectorAll(".entry")[0].querySelector(\'[data-a="toggle-done"]\').click()');
  await sleep(200);

  await evaluate('document.querySelectorAll(".entry")[0].querySelector(\'[data-a="add-set"]\').click()');
  await sleep(200);
  await logSet(0, 1, 80, 8);
  await sleep(120);
  await evaluate(`
    (() => {
      const row = document.querySelectorAll('.entry')[0].querySelectorAll('.set-row')[1];
      row.querySelector('.rpe').value = '8.5';
      row.querySelector('.rpe').dispatchEvent(new Event('change', { bubbles: true }));
      row.querySelector('[data-a="toggle-done"]').click();
    })()`);
  await sleep(250);

  await logSet(1, 0, 55, 12);
  await sleep(120);
  await evaluate('document.querySelectorAll(".entry")[1].querySelector(\'[data-a="toggle-done"]\').click()');
  await sleep(250);

  const setsShown = await evaluate('document.querySelector("[data-sets]").textContent');
  if (String(setsShown) !== '3') fail('Set counter', `header shows "${setsShown}", expected 3`);
  else ok('Sets logged and counted', `${setsShown} working sets`);

  const volShown = await evaluate('document.querySelector("[data-volume]").textContent');
  // 60*10 + 80*8 + 55*12 = 1900
  if (!/1,?900/.test(volShown)) fail('Volume', `header shows "${volShown}", expected 1,900 kg`);
  else ok('Volume computed', volShown);

  const restVisible = await evaluate('!document.querySelector("#rest-bar").hidden');
  if (!restVisible) fail('Rest timer', 'did not start when a set was ticked');
  else ok('Rest timer auto-started', await evaluate('document.querySelector("[data-rest-clock]").textContent'));
  await shot('logging');

  // ------------------------------------------------------------- 5. warm-up flag
  await evaluate('document.querySelectorAll(".entry")[0].querySelector(\'[data-a="cycle-type"]\').click()');
  await sleep(250);
  const badge = await evaluate('document.querySelectorAll(".entry")[0].querySelector(".set-type").textContent');
  if (badge !== 'WU') fail('Set type cycle', `badge is "${badge}", expected WU`);
  else ok('Set type cycles to warm-up');
  const setsAfterWu = await evaluate('document.querySelector("[data-sets]").textContent');
  if (String(setsAfterWu) !== '2') fail('Warm-up exclusion', `working sets should drop to 2, got ${setsAfterWu}`);
  else ok('Warm-ups excluded from working sets');

  // ------------------------------------------------------------- 5b. delete safety
  const snapshotSets = `
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      return s.activeWorkout().entries[0].sets.map(x => [x.w, x.r, x.rpe, x.type, x.done]);
    })()`;
  const beforeDelete = await evaluate(snapshotSets, 'sets before delete');

  await evaluate(`
    document.querySelectorAll('.entry')[0]
      .querySelectorAll('.set-row')[1]
      .querySelector('[data-a="remove-set"]').click()`, 'delete logged set');
  await sleep(350);
  if (!(await evaluate("!!document.querySelector('.toast-action')", 'undo offered'))) {
    fail('Undo offered', 'deleting a logged set gave no undo');
  } else {
    ok('Deleting a logged set offers Undo');
  }

  await evaluate("document.querySelector('.toast-action').click()", 'undo');
  await sleep(450);
  const afterUndo = await evaluate(snapshotSets, 'sets after undo');
  if (JSON.stringify(afterUndo) !== JSON.stringify(beforeDelete)) {
    fail('Undo restores the set', `got ${JSON.stringify(afterUndo)}, expected ${JSON.stringify(beforeDelete)}`);
  } else {
    ok('Undo restores the set in its original position', `${afterUndo.length} sets intact`);
  }

  // An unticked set is a draft — Add set prefills it back — so no offer.
  await evaluate("document.querySelector('#toast-host').innerHTML = ''");
  await evaluate(`document.querySelectorAll('.entry')[0].querySelector('[data-a="add-set"]').click()`);
  await sleep(250);
  await evaluate(`
    (() => {
      const rows = document.querySelectorAll('.entry')[0].querySelectorAll('.set-row');
      rows[rows.length - 1].querySelector('[data-a="remove-set"]').click();
    })()`, 'delete unticked set');
  await sleep(350);
  if (await evaluate("!!document.querySelector('.toast-action')", 'no undo for draft')) {
    fail('Unticked set deletion', 'offered an undo for a set that was never ticked');
  } else {
    ok('Deleting an unticked set passes without an undo prompt');
  }

  // ------------------------------------------------------------- 5c. resume bar
  // The rest bar owns this slot while it is up, so clear it first.
  await evaluate(`
    (async () => {
      const t = await import(new URL('src/timer.js', location.href));
      t.stopRest();
    })()`, 'stop rest');
  await sleep(250);

  await evaluate("location.hash = '#/history'");
  await sleep(600);
  const resume = await evaluate(`
    (() => {
      const b = document.getElementById('resume-bar');
      if (!b) return { missing: true };
      return { hidden: b.hidden, name: b.querySelector('[data-resume-name]').textContent };
    })()`, 'resume bar');
  if (resume.missing || resume.hidden !== false) {
    fail('Resume bar', `not shown off the Log screen with a workout running: ${JSON.stringify(resume)}`);
  } else {
    ok('Resume bar shows off the Log screen', resume.name);
  }
  await shot('resume-bar');

  await evaluate("document.getElementById('resume-bar').click()");
  await sleep(600);
  const landed = await evaluate('location.hash');
  if (landed !== '#/log') {
    fail('Resume bar tap', `landed on ${landed}, expected #/log`);
  } else if (!(await evaluate("document.getElementById('resume-bar').hidden"))) {
    fail('Resume bar on Log', 'still showing once back on the Log screen');
  } else {
    ok('Tapping it returns to the workout, and it stands down there');
  }

  // ------------------------------------------------------------- 6. finish
  await evaluate('document.querySelector(\'[data-a="finish"]\').click()');
  await sleep(600);
  const hash = await evaluate('location.hash');
  if (!/^#\/history\//.test(hash)) fail('Finish', `expected to land on a workout page, hash is ${hash}`);
  else ok('Workout finished', `routed to ${hash}`);
  // Hold on to the id. Later steps need *this* workout, and the app names
  // sessions by time of day, so matching on the name only worked between
  // 11am and 5pm.
  const strengthWorkoutId = hash.replace('#/history/', '');
  // Reported so a time-dependent failure is visible in the log rather than
  // showing up as a mystery ten steps later.
  const strengthWorkoutName = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      return s.workoutById(${JSON.stringify(strengthWorkoutId)})?.name ?? '(missing)';
    })()`, 'workout name');
  ok('Session named by time of day', strengthWorkoutName);
  await waitFor('.done-sets', 5000, 'workout detail sets');
  await shot('detail');

  // ------------------------------------------------------------- 7. share text
  const shareText = await evaluate(`
    (async () => {
      const m = await import(new URL('src/share.js', location.href));
      const s = await import(new URL('src/store.js', location.href));
      return m.formatWorkout(s.completedWorkouts()[0]);
    })()`, 'share');
  if (!/Barbell Bench Press/.test(shareText) || !/RPE 8.5/.test(shareText) || !/warm-up/.test(shareText)) {
    fail('Share text', `missing expected content:\n${shareText}`);
  } else {
    ok('WhatsApp text renders', `${shareText.split('\n').length} lines`);
  }

  // ------------------------------------------------------------- 8. history
  await evaluate('location.hash = "#/history"');
  await waitFor('.history-row', 5000, 'history list');
  ok('History lists the session');

  // ------------------------------------------------------------- 9. charts
  await evaluate('location.hash = "#/progress"');
  await waitFor('svg.chart', 8000, 'progress charts');
  await sleep(500);
  const charts = await evaluate(`
    [...document.querySelectorAll('.chart-card')].map(c => ({
      title: c.querySelector('.chart-title').textContent,
      marks: c.querySelectorAll('.bar, .line, .pt, .cell').length,
      w: c.querySelector('svg.chart')?.getAttribute('width') | 0,
    }))`);
  const empty = charts.filter((c) => !c.marks);
  if (!charts.length) fail('Progress charts', 'none rendered');
  else if (empty.length) fail('Progress charts', `no marks in: ${empty.map((c) => c.title).join(', ')}`);
  else ok('Progress charts render', charts.map((c) => `${c.title} (${c.marks} marks @ ${c.w}px)`).join('; '));
  await shot('progress');

  // table view twin
  await evaluate('document.querySelector(".chart-card .chart-toggle").click()');
  await sleep(200);
  const rows = await evaluate('document.querySelectorAll(".chart-table .data-table tbody tr").length');
  if (!rows) fail('Table view', 'toggle produced no rows');
  else ok('Chart table view works', `${rows} rows`);

  // ------------------------------------------------------------- 10. exercise page
  await evaluate('location.hash = "#/exercise/barbell-bench-press"');
  await waitFor('.detail-title', 5000, 'exercise detail');
  await sleep(600);
  const exCharts = await evaluate('document.querySelectorAll(".chart-card").length');
  const heaviest = await evaluate('document.querySelectorAll(".stat-value")[1].textContent');
  if (heaviest !== '80') fail('Exercise stats', `heaviest reads "${heaviest}", expected 80`);
  else ok('Exercise page stats', `heaviest 80 kg, ${exCharts} chart(s)`);

  // Best working set was 80 × 8, which Epley puts at 101.3 kg.
  const est = await evaluate(`({
    tile: [...document.querySelectorAll('.stat')].find(t => t.textContent.includes('est. 1RM'))?.querySelector('.stat-value').textContent,
    chart: [...document.querySelectorAll('.chart-card h3, .chart-card .chart-title')].some(h => h.textContent.includes('Estimated 1-rep max')),
  })`);
  if (est.tile !== '101.3' || !est.chart) fail('Estimated 1RM', JSON.stringify(est));
  else ok('Estimated 1RM tile and chart', `${est.tile} kg from 80 × 8`);
  await shot('exercise');

  // ------------------------------------------------------------- 11. library + routines + settings
  await evaluate('location.hash = "#/library"');
  await waitFor('.lib-row', 5000, 'library list');
  const libTotal = await evaluate('document.querySelector("[data-count]").textContent');
  ok('Library browses', libTotal);

  await evaluate('location.hash = "#/routines"');
  await waitFor('.view', 3000, 'routines');
  ok('Routines screen renders');

  await evaluate('location.hash = "#/settings"');
  await waitFor('#set-unit', 5000, 'settings');
  ok('Settings screen renders');

  // unit switch must not change stored data
  await evaluate(`
    (() => {
      const s = document.querySelector('#set-unit');
      s.value = 'lb';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  await sleep(400);
  await evaluate('location.hash = "#/exercise/barbell-bench-press"');
  await waitFor('.detail-title', 5000, 'exercise detail in lb');
  await sleep(400);
  const heaviestLb = await evaluate('document.querySelectorAll(".stat-value")[1].textContent');
  if (Math.abs(Number(heaviestLb) - 176.4) > 0.6) fail('Unit conversion', `80 kg shown as "${heaviestLb}" lb, expected ~176.4`);
  else ok('Unit conversion', `80 kg → ${heaviestLb} lb`);
  await shot('lb-units');

  // ------------------------------------------------------------- 11b. dark mode
  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const t = await import(new URL('src/theme.js', location.href));
      await s.saveSettings({ unit: 'kg', theme: 'dark' });
      t.applyTheme('dark');
    })()`, 'dark mode');
  await evaluate('location.hash = "#/progress"');
  await waitFor('svg.chart', 8000, 'charts in dark mode');
  await sleep(600);
  const darkSurface = await evaluate(
    'getComputedStyle(document.documentElement).getPropertyValue("--surface-1").trim()'
  );
  if (darkSurface !== '#1a1a19') fail('Dark mode', `--surface-1 is "${darkSurface}", expected #1a1a19`);
  else ok('Dark mode tokens applied', darkSurface);
  await shot('dark-progress');
  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const t = await import(new URL('src/theme.js', location.href));
      await s.saveSettings({ theme: 'system' });
      t.applyTheme('system');
    })()`, 'reset theme');

  // ------------------------------------------------------------- 11c. timed & cardio rows
  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      await s.startWorkout({ name: 'Conditioning' });
      const w = s.activeWorkout();
      await s.updateWorkout(w.id, (x) => {
        x.entries.push(s.newEntry('plank'));
        x.entries.push(s.newEntry('treadmill-run'));
      });
    })()`, 'timed workout');
  await evaluate('location.hash = "#/history"');
  await evaluate('location.hash = "#/log"');
  await waitFor('.set-table[data-track="cardio"]', 5000, 'cardio set row');
  const fieldSets = await evaluate(`
    [...document.querySelectorAll('.set-table')].map(t => ({
      track: t.dataset.track,
      fields: [...t.querySelectorAll('.set-row [data-f]')].map(i => i.dataset.f).join(','),
      head: [...t.querySelectorAll('.set-head span')].map(s => s.textContent).filter(Boolean).join('|'),
    }))`);
  const plank = fieldSets.find((f) => f.track === 'dur');
  const cardio = fieldSets.find((f) => f.track === 'cardio');
  if (!plank || plank.fields !== 'sec,rpe') fail('Timed exercise', `fields are "${plank?.fields}", expected sec,rpe`);
  else ok('Timed exercise row', `${plank.head} → ${plank.fields}`);
  if (!cardio || cardio.fields !== 'dist,sec') fail('Cardio exercise', `fields are "${cardio?.fields}", expected dist,sec`);
  else ok('Cardio exercise row', `${cardio.head} → ${cardio.fields}`);

  const timedRoundTrip = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const w = s.activeWorkout();
      await s.updateWorkout(w.id, (x) => {
        const plank = x.entries[0].sets[0];
        plank.sec = 75; plank.done = true;
        const run = x.entries[1].sets[0];
        run.dist = 5000; run.sec = 1620; run.done = true;
      });
      const done = await s.finishWorkout(w.id);
      const m = await import(new URL('src/share.js', location.href));
      return m.formatWorkout(done);
    })()`, 'timed share');
  if (!/1m 15s/.test(timedRoundTrip) || !/5 km/.test(timedRoundTrip) || !/27m 00s/.test(timedRoundTrip)) {
    fail('Timed/cardio share text', `unexpected:
${timedRoundTrip}`);
  } else {
    ok('Timed & cardio share text', '75s plank and 5 km / 27m run rendered');
  }
  await shot('conditioning');

  // ------------------------------------------------------------- 11d. routines
  // Tapping a routine on the start screen previews it; only the sheet's own
  // button starts it.
  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const done = s.workoutById(${JSON.stringify(strengthWorkoutId)});
      if (!done) throw new Error('strength workout ${strengthWorkoutId} is missing');
      await s.saveRoutine(s.routineFromWorkout(done, 'Push Day A'));
      location.hash = '#/history';
    })()`, 'save routine');
  await sleep(300);
  await evaluate('location.hash = "#/log"');
  await waitFor('[data-a="preview-routine"]', 5000, 'routine chip');
  await evaluate(`[...document.querySelectorAll('[data-a="preview-routine"]')]
    .find(b => b.textContent.includes('Push Day A')).click()`);
  await waitFor('.sheet .preview-list', 5000, 'routine preview');
  const previewed = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      return { active: !!s.activeWorkout(), rows: document.querySelectorAll('.sheet .preview-list li').length };
    })()`, 'preview');
  if (previewed.active || previewed.rows !== 2) {
    fail('Routine preview', `tapping the chip ${previewed.active ? 'started a workout' : `listed ${previewed.rows} exercises`}`);
  } else {
    ok('Tapping a routine previews it without starting it', `${previewed.rows} exercises listed`);
  }
  await sleep(350); // let the sheet finish sliding up before capturing
  await shot('routine-preview');

  await evaluate('document.querySelector(\'.sheet [data-a="start"]\').click()');
  await waitFor('.workout-head', 5000, 'routine workout');
  const routine = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const w = s.activeWorkout();
      return {
        name: w.name,
        entries: w.entries.length,
        prefilled: w.entries[0].sets.map(x => [x.w, x.r]),
        hint: w.entries[0].hint || null,
        hintShown: !!document.querySelector('.entry .entry-hint'),
      };
    })()`, 'routine');
  if (routine.name !== 'Push Day A' || routine.entries !== 2) {
    fail('Routine', `started as ${JSON.stringify(routine)}`);
  } else if (routine.prefilled[0][0] !== 82.5 || routine.hint?.from !== 80 || !routine.hintShown) {
    // Last time was 80 × 8 against a target of 8, so the suggestion steps up.
    fail('Routine prefill', `first set ${JSON.stringify(routine.prefilled[0])}, hint ${JSON.stringify(routine.hint)}, shown ${routine.hintShown}`);
  } else {
    ok('Routine started with a suggested step up', `"${routine.name}", 80 → 82.5 kg after hitting every rep last time`);
  }

  // Beat the bench's best through the real inputs: the set should be marked,
  // and announced, the moment it is ticked.
  await evaluate(`
    (() => {
      const row = document.querySelector('.entry .set-row');
      const input = row.querySelector('[data-f="w"]');
      input.value = String(parseFloat(input.value) + 10);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, 'raise weight');
  await sleep(300);
  await evaluate("document.querySelector('.entry .set-row [data-a=\"toggle-done\"]').click()");
  await sleep(400);
  const pr = await evaluate(`({
    marked: !!document.querySelector('.entry .set-row.is-pr'),
    toast: document.querySelector('.toast-pr')?.textContent.trim() || null,
  })`, 'pr');
  if (!pr.marked || !pr.toast) {
    fail('Personal record', JSON.stringify(pr));
  } else {
    ok('A heavier set is marked and announced as a PR', pr.toast);
  }
  await shot('personal-record');

  // Superset the two exercises: ticking A1 should hold the rest timer and
  // move you on, and ticking A2 should start it.
  const stopRest = `(async () => (await import(new URL('src/timer.js', location.href))).stopRest())()`;
  await evaluate("document.querySelector('.ss-link').click()");
  await sleep(400);
  const linked = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const g = s.activeWorkout().entries.map(e => e.group);
      return { same: !!g[0] && g[0] === g[1], tags: [...document.querySelectorAll('.entry .ss-tag')].map(t => t.textContent) };
    })()`, 'link superset');
  await evaluate(stopRest, 'stop rest');
  await evaluate("document.querySelectorAll('.entry')[0].querySelector('[data-a=\"add-set\"]').click()");
  await sleep(400);
  await evaluate("[...document.querySelectorAll('.entry')[0].querySelectorAll('[data-a=\"toggle-done\"]')].pop().click()");
  await sleep(500);
  const restAfterA1 = await evaluate("!document.getElementById('rest-bar').hidden");
  await evaluate("document.querySelectorAll('.entry')[1].querySelector('[data-a=\"toggle-done\"]').click()");
  await sleep(500);
  const restAfterA2 = await evaluate("!document.getElementById('rest-bar').hidden");
  if (!linked.same || linked.tags.join() !== 'A1,A2') {
    fail('Superset link', JSON.stringify(linked));
  } else if (restAfterA1 || !restAfterA2) {
    fail('Superset rest', `rest after A1: ${restAfterA1}, after A2: ${restAfterA2}`);
  } else {
    ok('Supersets link, and rest waits for the end of the round', linked.tags.join(' + '));
  }
  await shot('superset');
  await evaluate(stopRest, 'stop rest');

  await evaluate("location.hash = '#/exercise/barbell-bench-press'");
  await waitFor('.view', 3000, 'exercise detail');
  await sleep(300);
  const recordRows = await evaluate("document.querySelectorAll('.record-list li').length");
  if (!recordRows) fail('Records card', 'no rows on the bench press page');
  else ok('Exercise page lists personal records', `${recordRows} rep-max row(s)`);
  await shot('exercise-records');

  // With a session running, routines can be browsed but nothing offers to start.
  await evaluate('location.hash = "#/routines"');
  await waitFor('.running-notice', 5000, 'running notice on routines');
  const browsing = await evaluate(`
    (async () => {
      const r = await import(new URL('src/views/routines.js', location.href));
      const listStarts = document.querySelectorAll('#content [data-a="start"]').length;
      const id = document.querySelector('.routine-row .history-row').getAttribute('href').split('/').pop();
      r.openRoutinePreview(id);
      await new Promise(res => setTimeout(res, 300));
      const sheetStarts = document.querySelectorAll('.sheet [data-a="start"]').length;
      const sheetNotice = !!document.querySelector('.sheet .running-notice');
      document.querySelector('.sheet [data-a="close"]').click();
      location.hash = '#/routines/' + id;
      await new Promise(res => setTimeout(res, 300));
      return {
        listStarts, sheetStarts, sheetNotice,
        editorStarts: document.querySelectorAll('#content [data-a="start"]').length,
        editorNotice: !!document.querySelector('#content .running-notice'),
      };
    })()`, 'browse while running');
  if (browsing.listStarts || browsing.sheetStarts || browsing.editorStarts || !browsing.sheetNotice || !browsing.editorNotice) {
    fail('Browsing routines mid-workout', JSON.stringify(browsing));
  } else {
    ok('Mid-workout, routines browse without a Start button anywhere');
  }
  await shot('routines-while-running');

  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      await s.deleteWorkout(s.activeWorkout().id);
    })()`, 'discard routine workout');

  // ------------------------------------------------------------- 11d-2. routine templates
  await evaluate('location.hash = "#/routines"');
  await waitFor('[data-a="template"]', 5000, 'template button');
  await evaluate('document.querySelector(\'[data-a="template"]\').click()');
  await waitFor('[data-a="add-group"]', 5000, 'template sheet');
  await evaluate('document.querySelector(\'[data-a="add-group"][data-group="gym"]\').click()');
  await sleep(400);
  await evaluate('document.querySelector(\'[data-a="template"]\').click()');
  await waitFor('[data-a="add-group"]', 5000, 'template sheet');
  await sleep(350); // let the sheet finish sliding up before capturing
  await shot('routine-templates');
  await evaluate('document.querySelector(\'[data-a="add-group"][data-group="home"]\').click()');
  await sleep(400);

  const templates = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const t = await import(new URL('src/routine-templates.js', location.href));
      const added = s.allRoutines().filter(r => t.ROUTINE_TEMPLATES.some(x => x.name === r.name));
      const unresolved = t.ROUTINE_TEMPLATES.flatMap(
        tpl => tpl.items.filter(i => !s.exerciseById(i.exerciseId)).map(i => tpl.id + ':' + i.exerciseId)
      );
      const chest = added.find(r => r.name === 'Workout 1 – Chest');
      await s.startFromRoutine(chest.id);
      const w = s.activeWorkout();
      return {
        added: added.length,
        catalogue: t.ROUTINE_TEMPLATES.length,
        unresolved,
        rows: document.querySelectorAll('.routine-row').length,
        started: w.name,
        entries: w.entries.length,
        firstSets: w.entries[0].sets.length,
        firstPrefill: [w.entries[0].sets[0].w, w.entries[0].sets[0].r],
      };
    })()`, 'routine templates');

  if (templates.unresolved.length) {
    fail('Template exercises', `unknown ids: ${templates.unresolved.join(', ')}`);
  } else if (templates.added !== templates.catalogue) {
    fail('Routine templates', `added ${templates.added} of ${templates.catalogue}`);
  } else if (templates.started !== 'Workout 1 – Chest' || templates.entries !== 7) {
    fail('Template start', JSON.stringify(templates));
  } else if (templates.firstSets !== 4 || templates.firstPrefill[0] !== 80 || templates.firstPrefill[1] !== 10) {
    // The template starts bench at 40 kg, but you last benched 80 × 8 — short
    // of its 10 reps — so it loads 80 rather than stepping up or going back.
    fail('Template prefill', `first entry ${templates.firstSets} sets, prefill ${JSON.stringify(templates.firstPrefill)}`);
  } else {
    ok(
      'Routine templates added and started',
      `${templates.added} routines, "${templates.started}" prefilled 4 × 10 @ 80 kg from last time`
    );
  }
  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      await s.deleteWorkout(s.activeWorkout().id);
    })()`, 'discard template workout');

  // ------------------------------------------------------------- 11e. custom exercise
  const custom = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const lib = await import(new URL('src/exercises.js', location.href));
      const ex = await s.createCustomExercise({
        name: 'Hammer Strength Iso Row', equipment: 'machine', primary: 'lats', track: 'wr',
      });
      return {
        id: ex.id,
        found: !!s.exerciseById(ex.id),
        total: s.activeExercises().length,
        expected: lib.EXERCISE_LIBRARY.length + 1,
      };
    })()`, 'custom exercise');
  if (!custom.found || custom.total !== custom.expected) fail('Custom exercise', JSON.stringify(custom));
  else ok('Custom exercise created', `library now ${custom.total}`);

  // ------------------------------------------------------------- 12. backup round-trip
  const roundTrip = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const lib = await import(new URL('src/exercises.js', location.href));
      const backup = s.exportData();
      const json = JSON.stringify(backup);
      await s.resetEverything();
      const after = s.completedWorkouts().length;
      await s.importData(JSON.parse(json), { replace: true });
      return {
        wiped: after,
        restored: s.completedWorkouts().length,
        exercises: s.activeExercises().length,
        expected: lib.EXERCISE_LIBRARY.length + 1,
      };
    })()`, 'backup');
  if (roundTrip.wiped !== 0 || roundTrip.restored !== 2 || roundTrip.exercises !== roundTrip.expected) {
    fail('Backup round-trip', JSON.stringify(roundTrip));
  } else {
    ok('Backup export → wipe → restore', `${roundTrip.restored} workouts and the custom exercise recovered`);
  }

  // ------------------------------------------------------------- 13. offline
  const swReady = await evaluate(`
    (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && (reg.active || reg.installing || reg.waiting));
    })()`, 'sw');
  if (!swReady) fail('Service worker', 'not registered');
  else ok('Service worker registered (offline shell cached)');

  finish(cleanup);
}

function finish(cleanup) {
  console.log('\nGymTracker smoke test\n');
  console.log(steps.join('\n'));
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    problems.forEach((p) => console.log(`  ! ${p}`));
  } else {
    console.log('\nNo console errors, no exceptions. All checks passed.');
  }
  cleanup();
  process.exit(problems.length ? 1 : 0);
}

// A crash still reports like a failure: the steps that did run are worth
// seeing, and an aborted run is a failed run, not a separate category.
main().catch((err) => {
  fail('Run aborted', err?.message || String(err));
  finish(() => {});
});
