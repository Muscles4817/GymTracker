// End-to-end smoke test: launches the real app in headless Chrome, walks a full
// session (start → add exercise → log sets → finish → history → charts) and
// fails on any console error, page exception or missing element.
//
//   node tools/smoke-test.mjs [--headed] [--shots <dir>] [--url <base>] [--dark]
//
// --url points the run at an already-served copy (a subdirectory host, or the
// live site) instead of starting the bundled server.
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

  // ------------------------------------------------------------- 6. finish
  await evaluate('document.querySelector(\'[data-a="finish"]\').click()');
  await sleep(600);
  const hash = await evaluate('location.hash');
  if (!/^#\/history\//.test(hash)) fail('Finish', `expected to land on a workout page, hash is ${hash}`);
  else ok('Workout finished', `routed to ${hash}`);
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
  const routine = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const done = s.completedWorkouts().find(w => w.name === 'Afternoon Workout');
      const r = await s.saveRoutine(s.routineFromWorkout(done, 'Push Day A'));
      await s.startFromRoutine(r.id);
      const w = s.activeWorkout();
      return {
        name: w.name,
        entries: w.entries.length,
        prefilled: w.entries[0].sets.map(x => [x.w, x.r]),
      };
    })()`, 'routine');
  if (routine.name !== 'Push Day A' || routine.entries !== 2) {
    fail('Routine', `started as ${JSON.stringify(routine)}`);
  } else if (routine.prefilled[0][0] !== 80) {
    fail('Routine prefill', `first set is ${JSON.stringify(routine.prefilled[0])}, expected 80 kg`);
  } else {
    ok('Routine saved and started', `"${routine.name}", ${routine.entries} exercises, sets prefilled at 80 kg`);
  }
  await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      await s.deleteWorkout(s.activeWorkout().id);
    })()`, 'discard routine workout');

  // ------------------------------------------------------------- 11e. custom exercise
  const custom = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const ex = await s.createCustomExercise({
        name: 'Hammer Strength Iso Row', equipment: 'machine', primary: 'lats', track: 'wr',
      });
      return { id: ex.id, found: !!s.exerciseById(ex.id), total: s.activeExercises().length };
    })()`, 'custom exercise');
  if (!custom.found || custom.total !== 251) fail('Custom exercise', JSON.stringify(custom));
  else ok('Custom exercise created', `library now ${custom.total}`);

  // ------------------------------------------------------------- 12. backup round-trip
  const roundTrip = await evaluate(`
    (async () => {
      const s = await import(new URL('src/store.js', location.href));
      const backup = s.exportData();
      const json = JSON.stringify(backup);
      await s.resetEverything();
      const after = s.completedWorkouts().length;
      await s.importData(JSON.parse(json), { replace: true });
      return { wiped: after, restored: s.completedWorkouts().length, exercises: s.activeExercises().length };
    })()`, 'backup');
  if (roundTrip.wiped !== 0 || roundTrip.restored !== 2 || roundTrip.exercises !== 251) {
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

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  console.log(steps.join('\n'));
  process.exit(2);
});
