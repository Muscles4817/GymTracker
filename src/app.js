// App shell: hash router, tab bar, rest-timer bar, install & backup nudges.

import { init, getSettings, activeWorkout, subscribe, completedWorkouts } from './store.js';
import { applyTheme } from './theme.js';
import { node, icon, esc, toast, $ } from './ui.js';
import { fmtClock } from './util.js';
import {
  subscribeTimer, getTimer, adjustRest, pauseRest, resumeRest, stopRest, primeAudio,
} from './timer.js';

import { logView } from './views/log.js';
import { historyView, workoutDetailView } from './views/history.js';
import { libraryView, exerciseDetailView } from './views/library.js';
import { progressView } from './views/progress.js';
import { routinesView, routineEditorView } from './views/routines.js';
import { settingsView } from './views/settings.js';

const TABS = [
  { hash: '#/log', label: 'Log', iconName: 'dumbbell' },
  { hash: '#/history', label: 'History', iconName: 'clock' },
  { hash: '#/library', label: 'Library', iconName: 'list' },
  { hash: '#/progress', label: 'Progress', iconName: 'chart' },
  { hash: '#/more', label: 'More', iconName: 'more' },
];

const ROUTES = [
  { re: /^#\/log$/, title: 'Log', view: () => logView(), tab: '#/log' },
  { re: /^#\/history$/, title: 'History', view: () => historyView(), tab: '#/history' },
  { re: /^#\/history\/(.+)$/, title: 'Workout', view: (m) => workoutDetailView(m[1]), tab: '#/history', back: '#/history' },
  { re: /^#\/library$/, title: 'Exercise library', view: () => libraryView(), tab: '#/library' },
  { re: /^#\/exercise\/(.+)$/, title: 'Exercise', view: (m) => exerciseDetailView(m[1]), tab: '#/library', back: '#/library' },
  { re: /^#\/progress$/, title: 'Progress', view: () => progressView(), tab: '#/progress' },
  { re: /^#\/routines$/, title: 'Routines', view: () => routinesView(), tab: '#/more', back: '#/more' },
  { re: /^#\/routines\/(.+)$/, title: 'Edit routine', view: (m) => routineEditorView(m[1]), tab: '#/more', back: '#/routines' },
  { re: /^#\/settings$/, title: 'Settings', view: () => settingsView(), tab: '#/more', back: '#/more' },
  { re: /^#\/more$/, title: 'More', view: () => moreView(), tab: '#/more' },
];

let currentView = null;

function moreView() {
  const el = node(`
    <div class="view stack">
      <section class="card">
        <ul class="history-list">
          <li><a class="history-row" href="#/routines">
            <span class="history-main"><span class="history-name">Routines</span>
            <span class="history-meta">Reusable workout templates</span></span>${icon('chevron', 'muted-icon')}</a></li>
          <li><a class="history-row" href="#/settings">
            <span class="history-main"><span class="history-name">Settings</span>
            <span class="history-meta">Units, rest timer, trainer, backups</span></span>${icon('chevron', 'muted-icon')}</a></li>
        </ul>
      </section>
      <section class="card">
        <header class="card-head"><h3>About</h3></header>
        <p class="muted small">Everything you log stays in this browser on this device — there is no account and no server. Export a backup from Settings now and then, especially before clearing browser data or switching phones.</p>
      </section>
    </div>`);
  return { el };
}

function resolve(hash) {
  for (const r of ROUTES) {
    const m = hash.match(r.re);
    if (m) return { route: r, match: m };
  }
  return { route: ROUTES[0], match: null };
}

function renderRoute() {
  const hash = location.hash || '#/log';
  const { route, match } = resolve(hash);

  currentView?.destroy?.();
  const content = $('#content');
  content.innerHTML = '';
  const built = route.view(match);
  currentView = built;
  content.appendChild(built.el);
  content.scrollTop = 0;
  window.scrollTo(0, 0);

  $('#page-title').textContent = route.title;
  const backBtn = $('#back-btn');
  if (route.back) {
    backBtn.hidden = false;
    backBtn.dataset.href = route.back;
  } else {
    backBtn.hidden = true;
  }

  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.hash === route.tab;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
}

// ---------------------------------------------------------------- rest bar

function mountRestBar() {
  const bar = node(`
    <div id="rest-bar" class="rest-bar" hidden>
      <div class="rest-progress"></div>
      <div class="rest-inner">
        <span class="rest-label">${icon('timer')}<span data-rest-label>Rest</span></span>
        <span class="rest-clock" data-rest-clock>0:00</span>
        <div class="rest-buttons">
          <button class="rest-btn" data-a="minus" type="button" aria-label="Subtract 15 seconds">−15</button>
          <button class="rest-btn" data-a="toggle" type="button" aria-label="Pause or resume">${icon('pause')}</button>
          <button class="rest-btn" data-a="plus" type="button" aria-label="Add 15 seconds">+15</button>
          <button class="rest-btn" data-a="stop" type="button" aria-label="Skip rest">${icon('x')}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(bar);

  const clock = bar.querySelector('[data-rest-clock]');
  const label = bar.querySelector('[data-rest-label]');
  const progress = bar.querySelector('.rest-progress');
  const toggleBtn = bar.querySelector('[data-a="toggle"]');

  bar.querySelector('[data-a="minus"]').addEventListener('click', () => adjustRest(-15));
  bar.querySelector('[data-a="plus"]').addEventListener('click', () => adjustRest(15));
  bar.querySelector('[data-a="stop"]').addEventListener('click', () => stopRest());
  toggleBtn.addEventListener('click', () => (getTimer().paused ? resumeRest() : pauseRest()));

  subscribeTimer((t) => {
    // The bar floats above the tab bar, so the page needs extra room under it.
    document.body.classList.toggle('rest-active', t.active);
    if (!t.active) {
      bar.hidden = true;
      bar.classList.remove('is-done');
      return;
    }
    bar.hidden = false;
    clock.textContent = fmtClock(t.remaining);
    label.textContent = t.label || 'Rest';
    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, t.progress))})`;
    toggleBtn.innerHTML = t.paused ? icon('play') : icon('pause');
    bar.classList.toggle('is-paused', t.paused);
    bar.classList.toggle('is-done', t.remaining <= 0);
  });
}

// ---------------------------------------------------------------- shell

function mountShell() {
  document.body.innerHTML = `
    <header class="app-bar">
      <button id="back-btn" class="icon-btn" type="button" aria-label="Back" hidden>${icon('back')}</button>
      <h1 id="page-title">Log</h1>
      <a class="icon-btn" href="#/settings" aria-label="Settings">${icon('settings')}</a>
    </header>
    <main id="content" class="content"></main>
    <nav class="tab-bar" aria-label="Main">
      ${TABS.map(
        (t) => `
        <a class="tab" href="${t.hash}" data-hash="${t.hash}">
          ${icon(t.iconName)}<span>${esc(t.label)}</span>
          ${t.hash === '#/log' ? '<span class="tab-dot" hidden></span>' : ''}
        </a>`
      ).join('')}
    </nav>`;

  $('#back-btn').addEventListener('click', () => {
    const href = $('#back-btn').dataset.href;
    if (href) location.hash = href;
    else history.back();
  });

  // Prime the audio context on the first real interaction (iOS requires it).
  document.body.addEventListener('pointerdown', () => primeAudio(), { once: true });
}

function refreshActiveDot() {
  const dot = document.querySelector('.tab-dot');
  if (dot) dot.hidden = !activeWorkout();
}

// ---------------------------------------------------------------- nudges

function maybeNudgeBackup() {
  const s = getSettings();
  const workouts = completedWorkouts().length;
  if (workouts < 5) return;
  const days = s.backupReminderDays || 30;
  const last = s.lastBackup ? new Date(s.lastBackup).getTime() : 0;
  if (Date.now() - last < days * 86400000) return;
  toast('Time for a backup — your log only exists on this device', {
    duration: 8000,
    action: { label: 'Back up', onClick: () => (location.hash = '#/settings') },
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // needs http(s)
  const register = () =>
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  // boot() is async, so "load" has usually fired by the time we get here.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  window.__installPrompt = ev;
});

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    await init();
  } catch (err) {
    document.body.innerHTML = `<div class="fatal"><h1>Storage unavailable</h1><p>GymTracker needs IndexedDB to keep your log. Private-browsing mode blocks it in some browsers.</p><pre>${esc(
      err?.message || err
    )}</pre></div>`;
    return;
  }

  applyTheme(getSettings().theme);
  mountShell();
  mountRestBar();

  if (!location.hash) location.hash = '#/log';
  renderRoute();
  refreshActiveDot();

  window.addEventListener('hashchange', () => {
    renderRoute();
    refreshActiveDot();
  });
  subscribe(refreshActiveDot);

  registerServiceWorker();
  setTimeout(maybeNudgeBackup, 1500);
}

boot();
