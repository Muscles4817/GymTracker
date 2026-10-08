// Settings, backup and restore. Your data lives on this device, so backups matter.

import {
  getSettings, saveSettings, exportData, importData, resetEverything,
  completedWorkouts, allExercises, allRoutines, incrementStep,
} from '../store.js';
import { workoutsToCsv, downloadBlob } from '../share.js';
import { node, esc, icon, toast, confirmDialog, promptDialog } from '../ui.js';
import { dayKey, fmtDateFull, plural, toDisplayWeight, toStoredWeight } from '../util.js';
import { applyTheme, applyTextScale, TEXT_SCALES } from '../theme.js';

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
        <div class="setting">
          <label for="set-textsize">Text size</label>
          <select class="input" id="set-textsize">
            ${TEXT_SCALES.map(
              (t) => `<option value="${t.value}" ${Number(s.textScale ?? 1) === t.value ? 'selected' : ''}>${esc(t.label)}</option>`
            ).join('')}
          </select>
        </div>
        <p class="muted small">Scales the whole app, bars included. Your browser's own font-size setting still applies on top.</p>
        <label class="check-row"><input type="checkbox" id="set-rpe" ${s.trackRpe ? 'checked' : ''}> Show an RPE column when logging</label>
        <p class="muted small">RPE records how hard a set felt, 6 to 10, where 8 means you had about two reps left. Off by default to keep the row wide — sets that already have one still show it.</p>
      </section>

      <section class="card">
        <header class="card-head"><h3>Progression</h3></header>
        <label class="check-row"><input type="checkbox" id="set-suggest" ${s.suggestIncrease ? 'checked' : ''}> Suggest a heavier weight when I've earned it</label>
        <div class="setting">
          <label for="set-step">Step up by (${esc(s.unit)})</label>
          <input class="input num" id="set-step" inputmode="decimal" value="${esc(String(Math.round(toDisplayWeight(incrementStep(s), s.unit) * 100) / 100))}">
        </div>
        <p class="muted small">Starting a routine loads what you lifted last time. Once every target set reached its target reps at that weight, the next session adds one step.</p>
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
    const step = el.querySelector('#set-step');
    step.value = String(Math.round(toDisplayWeight(incrementStep(), ev.target.value) * 100) / 100);
    el.querySelector('label[for="set-step"]').textContent = `Step up by (${ev.target.value})`;
    toast(`Showing weights in ${ev.target.value}`);
  });
  el.querySelector('#set-theme').addEventListener('change', async (ev) => {
    await saveSettings({ theme: ev.target.value });
    applyTheme(ev.target.value);
  });
  el.querySelector('#set-rpe').addEventListener('change', (ev) => saveSettings({ trackRpe: ev.target.checked }));
  el.querySelector('#set-textsize').addEventListener('change', async (ev) => {
    const scale = Number(ev.target.value);
    applyTextScale(scale); // apply first so the change is visible while saving
    await saveSettings({ textScale: scale });
  });

  // ---- progression
  el.querySelector('#set-suggest').addEventListener('change', (ev) => saveSettings({ suggestIncrease: ev.target.checked }));
  el.querySelector('#set-step').addEventListener('change', (ev) => {
    const v = parseFloat(ev.target.value);
    // Blank or nonsense goes back to the default for the unit.
    saveSettings({ increment: v > 0 ? toStoredWeight(v, getSettings().unit) : null });
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
    if (payload?.format !== 'gymtracker-backup') {
      return toast('That file is not a GymTracker backup', { kind: 'warn' });
    }

    // Two steps on purpose. As one dialog, both buttons imported and there was
    // no way out — dismissing it merged, which is not what dismissing means.
    const here = completedWorkouts().length;
    const incoming = payload.workouts?.length || 0;
    const go = await confirmDialog({
      title: 'Restore this backup?',
      message: `The file holds ${plural(incoming, 'workout')} and ${plural(payload.routines?.length || 0, 'routine')}. This device has ${plural(here, 'workout')} right now.`,
      confirmText: 'Continue',
      cancelText: 'Cancel',
    });
    if (!go) return toast('Cancelled — nothing was imported');

    const replace = await confirmDialog({
      title: 'Replace or merge?',
      message: `Replace deletes the ${plural(here, 'workout')} already on this device, then restores the backup. Merge keeps them and adds the backup alongside.`,
      confirmText: 'Replace everything',
      cancelText: 'Merge',
      danger: true,
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
