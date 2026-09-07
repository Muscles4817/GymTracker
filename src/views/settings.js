// Settings, backup and restore. Your data lives on this device, so backups matter.

import {
  getSettings, saveSettings, exportData, importData, resetEverything,
  completedWorkouts, allExercises, allRoutines,
} from '../store.js';
import { workoutsToCsv, downloadBlob } from '../share.js';
import { node, esc, icon, toast, confirmDialog, promptDialog } from '../ui.js';
import { dayKey, fmtDateFull } from '../util.js';
import { applyTheme } from '../theme.js';

export function settingsView() {
  const s = getSettings();
  const el = node(`
    <div class="view stack">
      <section class="card">
        <header class="card-head"><h3>Units & display</h3></header>
        <div class="setting">
          <label for="set-unit">Weight unit</label>
          <select class="input" id="set-unit">
            <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>Kilograms (kg)</option>
            <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>Pounds (lb)</option>
          </select>
        </div>
        <p class="muted small">Weights are stored in kilograms and converted for display, so switching units never changes what you lifted.</p>
        <div class="setting">
          <label for="set-theme">Theme</label>
          <select class="input" id="set-theme">
            <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Match device</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </div>
      </section>

      <section class="card">
        <header class="card-head"><h3>Rest timer</h3></header>
        <div class="setting">
          <label for="set-rest">Default rest</label>
          <select class="input" id="set-rest">
            ${[30, 45, 60, 75, 90, 120, 150, 180, 240, 300]
              .map((v) => `<option value="${v}" ${s.restDefault === v ? 'selected' : ''}>${v < 60 ? `${v}s` : `${Math.floor(v / 60)}m${v % 60 ? ` ${v % 60}s` : ''}`}</option>`)
              .join('')}
          </select>
        </div>
        <label class="check-row"><input type="checkbox" id="set-restauto" ${s.restAuto ? 'checked' : ''}> Start the timer automatically when I tick a set</label>
        <label class="check-row"><input type="checkbox" id="set-sound" ${s.sound ? 'checked' : ''}> Chime when rest is over</label>
        <label class="check-row"><input type="checkbox" id="set-vibrate" ${s.vibrate ? 'checked' : ''}> Vibrate when rest is over</label>
      </section>

      <section class="card">
        <header class="card-head"><h3>Trainer</h3></header>
        <div class="setting">
          <label for="set-tname">Name</label>
          <input class="input" id="set-tname" value="${esc(s.trainerName || '')}" placeholder="e.g. Sam">
        </div>
        <div class="setting">
          <label for="set-tphone">WhatsApp number</label>
          <input class="input" id="set-tphone" inputmode="tel" value="${esc(s.trainerPhone || '')}" placeholder="e.g. +44 7700 900123">
        </div>
        <p class="muted small">Saved on this device only. With a number set, sharing opens a chat with your trainer directly instead of the contact picker. Include the country code.</p>
      </section>

      <section class="card">
        <header class="card-head"><h3>Backup & export</h3></header>
        <p class="muted small">Your log lives in this browser's storage. Clearing site data — or losing the device — loses it. Export a backup regularly.</p>
        <div class="stack-sm">
          <button class="btn btn-primary btn-block" data-a="export-json" type="button">${icon('download')} Export full backup (.json)</button>
          <button class="btn btn-ghost btn-block" data-a="export-csv" type="button">${icon('download')} Export sets as spreadsheet (.csv)</button>
          <button class="btn btn-ghost btn-block" data-a="import" type="button">${icon('upload')} Restore from backup</button>
        </div>
        <p class="muted small" data-backup-state></p>
        <input type="file" accept="application/json,.json" hidden data-file>
      </section>

      <section class="card">
        <header class="card-head"><h3>Install</h3></header>
        <p class="muted small" data-install-state>Add GymTracker to your home screen and it opens full-screen and works with no signal.</p>
        <button class="btn btn-ghost btn-block" data-a="install" type="button" hidden>${icon('plus')} Install app</button>
      </section>

      <section class="card">
        <header class="card-head"><h3>Your data</h3></header>
        <p class="muted small" data-counts></p>
        <button class="btn btn-ghost btn-block btn-danger-text" data-a="reset" type="button">${icon('trash')} Erase everything</button>
      </section>

      <p class="muted small center">GymTracker · offline-first · no account, no server, no tracking</p>
    </div>`);

  // ---- units, theme
  el.querySelector('#set-unit').addEventListener('change', async (ev) => {
    await saveSettings({ unit: ev.target.value });
    toast(`Showing weights in ${ev.target.value}`);
  });
  el.querySelector('#set-theme').addEventListener('change', async (ev) => {
    await saveSettings({ theme: ev.target.value });
    applyTheme(ev.target.value);
  });

  // ---- rest timer
  el.querySelector('#set-rest').addEventListener('change', (ev) => saveSettings({ restDefault: Number(ev.target.value) }));
  el.querySelector('#set-restauto').addEventListener('change', (ev) => saveSettings({ restAuto: ev.target.checked }));
  el.querySelector('#set-sound').addEventListener('change', (ev) => saveSettings({ sound: ev.target.checked }));
  el.querySelector('#set-vibrate').addEventListener('change', (ev) => saveSettings({ vibrate: ev.target.checked }));

  // ---- trainer
  el.querySelector('#set-tname').addEventListener('change', (ev) => saveSettings({ trainerName: ev.target.value.trim() }));
  el.querySelector('#set-tphone').addEventListener('change', (ev) => saveSettings({ trainerPhone: ev.target.value.trim() }));

  // ---- backup
  const backupState = el.querySelector('[data-backup-state]');
  const refreshBackupState = () => {
    const last = getSettings().lastBackup;
    backupState.textContent = last
      ? `Last backup: ${fmtDateFull(last)}`
      : 'No backup taken yet on this device.';
  };
  refreshBackupState();

  el.querySelector('[data-a="export-json"]').addEventListener('click', async () => {
    const data = exportData();
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `gymtracker-backup-${dayKey()}.json`
    );
    await saveSettings({ lastBackup: new Date().toISOString() });
    refreshBackupState();
    toast('Backup downloaded — keep it somewhere safe');
  });

  el.querySelector('[data-a="export-csv"]').addEventListener('click', () => {
    const workouts = completedWorkouts();
    if (!workouts.length) return toast('Nothing to export yet');
    downloadBlob(
      new Blob([workoutsToCsv(workouts)], { type: 'text/csv;charset=utf-8' }),
      `gymtracker-sets-${dayKey()}.csv`
    );
    toast('CSV downloaded — one row per set');
  });

  const fileInput = el.querySelector('[data-file]');
  el.querySelector('[data-a="import"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      return toast('That file is not valid JSON', { kind: 'warn' });
    }
    const replace = await confirmDialog({
      title: 'Restore this backup?',
      message:
        'Choose Replace to wipe what is here first, or Merge to add the backup on top of your current data.',
      confirmText: 'Replace everything',
      cancelText: 'Merge',
    });
    try {
      const res = await importData(payload, { replace });
      toast(`Restored ${res.workouts} workouts and ${res.routines} routines`);
      location.reload();
    } catch (err) {
      toast(err.message || 'Could not read that backup', { kind: 'warn' });
    }
  });

  // ---- install
  const installBtn = el.querySelector('[data-a="install"]');
  const installState = el.querySelector('[data-install-state]');
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    installState.textContent = 'Installed — you are running the app version.';
  } else if (window.__installPrompt) {
    installBtn.hidden = false;
    installBtn.addEventListener('click', async () => {
      window.__installPrompt.prompt();
      const { outcome } = await window.__installPrompt.userChoice;
      if (outcome === 'accepted') {
        window.__installPrompt = null;
        installBtn.hidden = true;
        installState.textContent = 'Installed. Launch it from your home screen.';
      }
    });
  } else {
    installState.textContent =
      'To install: in Safari tap Share → Add to Home Screen; in Chrome open the ⋮ menu → Install app.';
  }

  // ---- counts / reset
  el.querySelector('[data-counts]').textContent =
    `${completedWorkouts().length} workouts · ${allExercises().length} exercises · ${allRoutines().length} routines`;

  el.querySelector('[data-a="reset"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Erase all data?',
      message: 'Every workout, routine and custom exercise on this device is deleted. Export a backup first if you want one.',
      confirmText: 'Continue',
      danger: true,
    });
    if (!ok) return;
    const typed = await promptDialog({
      title: 'Type ERASE to confirm',
      label: 'This cannot be undone.',
      placeholder: 'ERASE',
      confirmText: 'Erase everything',
    });
    if (typed?.trim().toUpperCase() !== 'ERASE') return toast('Cancelled — nothing was deleted');
    await resetEverything();
    toast('All data erased');
    location.hash = '#/log';
    location.reload();
  });

  return { el };
}
