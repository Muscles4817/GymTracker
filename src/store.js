// Application state: loads everything into memory once, writes through to IndexedDB.
// A personal training log is small (thousands of workouts at most), so keeping it
// all in memory makes every query — charts included — a plain array scan.

import { STORES, dbAll, dbGet, dbPut, dbPutMany, dbDelete, wipeAll, openDb } from './db.js';
import { EXERCISE_LIBRARY, LIBRARY_VERSION } from './exercises.js';
import { uid, dayKey, weekKey } from './util.js';

export const DEFAULT_SETTINGS = {
  unit: 'kg',
  restDefault: 90,
  restAuto: true,
  theme: 'system',
  sound: true,
  vibrate: true,
  trainerName: '',
  trainerPhone: '',
  lastBackup: null,
  backupReminderDays: 30,
};

const state = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  exercises: new Map(),
  workouts: [], // newest first
  routines: [],
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('listener failed', err);
    }
  });
}

// ---------------------------------------------------------------- init

export async function init() {
  await openDb();

  const [exs, wos, rts, settingsRow, libRow] = await Promise.all([
    dbAll(STORES.exercises),
    dbAll(STORES.workouts),
    dbAll(STORES.routines),
    dbGet(STORES.meta, 'settings'),
    dbGet(STORES.meta, 'libraryVersion'),
  ]);

  state.settings = { ...DEFAULT_SETTINGS, ...(settingsRow?.value || {}) };

  // Seed / top up the built-in library without touching user edits or customs.
  const existing = new Map(exs.map((e) => [e.id, e]));
  const installedVersion = libRow?.value ?? 0;
  if (exs.length === 0 || installedVersion < LIBRARY_VERSION) {
    const missing = EXERCISE_LIBRARY.filter((e) => !existing.has(e.id));
    if (missing.length) {
      await dbPutMany(STORES.exercises, missing);
      missing.forEach((e) => existing.set(e.id, e));
    }
    await dbPut(STORES.meta, { key: 'libraryVersion', value: LIBRARY_VERSION });
  }

  state.exercises = existing;
  state.workouts = wos.sort(sortWorkoutsDesc);
  state.routines = rts.sort((a, b) => a.name.localeCompare(b.name));
  state.ready = true;
  return state;
}

const sortWorkoutsDesc = (a, b) =>
  b.day.localeCompare(a.day) || (b.startedAt || 0) - (a.startedAt || 0);

export const getSettings = () => state.settings;

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await dbPut(STORES.meta, { key: 'settings', value: state.settings });
  emit();
  return state.settings;
}

// ---------------------------------------------------------------- exercises

export const allExercises = () =>
  [...state.exercises.values()].sort((a, b) => a.name.localeCompare(b.name));

export const activeExercises = () => allExercises().filter((e) => !e.archived);

export const exerciseById = (id) => state.exercises.get(id) || null;

export const exerciseName = (id) => exerciseById(id)?.name || 'Unknown exercise';

export async function saveExercise(ex) {
  const rec = { ...ex };
  if (!rec.id) rec.id = 'custom-' + uid();
  state.exercises.set(rec.id, rec);
  await dbPut(STORES.exercises, rec);
  emit();
  return rec;
}

export async function createCustomExercise({ name, equipment, primary, secondary = [], mech = 'iso', track = 'wr' }) {
  return saveExercise({
    id: 'custom-' + uid(),
    name: name.trim(),
    equipment,
    primary,
    secondary,
    mech,
    track,
    custom: true,
    archived: false,
  });
}

export async function deleteExercise(id) {
  const ex = exerciseById(id);
  if (!ex) return;
  const used = state.workouts.some((w) => w.entries.some((e) => e.exerciseId === id));
  if (used || !ex.custom) {
    // Never orphan history — archive instead so old workouts still render.
    await saveExercise({ ...ex, archived: true });
    return 'archived';
  }
  state.exercises.delete(id);
  await dbDelete(STORES.exercises, id);
  emit();
  return 'deleted';
}

// ---------------------------------------------------------------- workouts

export const completedWorkouts = () => state.workouts.filter((w) => w.status === 'done');
export const workoutById = (id) => state.workouts.find((w) => w.id === id) || null;
export const activeWorkout = () => state.workouts.find((w) => w.status === 'active') || null;

export function newSet(overrides = {}) {
  return { id: uid(), w: null, r: null, sec: null, dist: null, rpe: null, type: 'w', note: '', done: false, ...overrides };
}

export function newEntry(exerciseId, sets = null) {
  return { id: uid(), exerciseId, notes: '', sets: sets || [newSet()] };
}

export async function startWorkout({ name = '', routineId = null, entries = null } = {}) {
  const existing = activeWorkout();
  if (existing) return existing;
  const w = {
    id: uid(),
    day: dayKey(),
    name: name || defaultWorkoutName(),
    notes: '',
    status: 'active',
    startedAt: Date.now(),
    endedAt: null,
    routineId,
    entries: entries || [],
  };
  state.workouts.unshift(w);
  state.workouts.sort(sortWorkoutsDesc);
  await dbPut(STORES.workouts, w);
  emit();
  return w;
}

function defaultWorkoutName() {
  const h = new Date().getHours();
  if (h < 11) return 'Morning Workout';
  if (h < 17) return 'Afternoon Workout';
  return 'Evening Workout';
}

export async function startFromRoutine(routineId) {
  const r = routineById(routineId);
  if (!r) return startWorkout();
  const entries = r.items.map((it) => {
    const n = Math.max(1, Number(it.targetSets) || 1);
    const sets = Array.from({ length: n }, () =>
      newSet({ w: it.targetWeight ?? null, r: it.targetReps ?? null })
    );
    return { ...newEntry(it.exerciseId, sets), notes: it.notes || '' };
  });
  return startWorkout({ name: r.name, routineId, entries });
}

export async function saveWorkout(w) {
  const i = state.workouts.findIndex((x) => x.id === w.id);
  if (i >= 0) state.workouts[i] = w;
  else state.workouts.push(w);
  state.workouts.sort(sortWorkoutsDesc);
  await dbPut(STORES.workouts, w);
  emit();
  return w;
}

/** Mutate the active (or given) workout via a callback, then persist. */
export async function updateWorkout(id, mutator) {
  const w = workoutById(id);
  if (!w) return null;
  const next = { ...w, entries: w.entries.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) })) };
  mutator(next);
  return saveWorkout(next);
}

export async function finishWorkout(id) {
  return updateWorkout(id, (w) => {
    // Drop sets that were never filled in, then empty exercises.
    w.entries.forEach((e) => {
      e.sets = e.sets.filter((s) => s.done || isSetFilled(s));
    });
    w.entries = w.entries.filter((e) => e.sets.length > 0);
    w.entries.forEach((e) => e.sets.forEach((s) => { if (isSetFilled(s)) s.done = true; }));
    w.status = 'done';
    w.endedAt = Date.now();
  });
}

export async function deleteWorkout(id) {
  state.workouts = state.workouts.filter((w) => w.id !== id);
  await dbDelete(STORES.workouts, id);
  emit();
}

export const isSetFilled = (s) =>
  s.w != null || s.r != null || s.sec != null || s.dist != null;

// ---------------------------------------------------------------- routines

export const allRoutines = () => state.routines;
export const routineById = (id) => state.routines.find((r) => r.id === id) || null;

export async function saveRoutine(r) {
  const rec = { ...r, updatedAt: Date.now() };
  if (!rec.id) {
    rec.id = uid();
    rec.createdAt = Date.now();
  }
  const i = state.routines.findIndex((x) => x.id === rec.id);
  if (i >= 0) state.routines[i] = rec;
  else state.routines.push(rec);
  state.routines.sort((a, b) => a.name.localeCompare(b.name));
  await dbPut(STORES.routines, rec);
  emit();
  return rec;
}

export async function deleteRoutine(id) {
  state.routines = state.routines.filter((r) => r.id !== id);
  await dbDelete(STORES.routines, id);
  emit();
}

export function routineFromWorkout(workout, name) {
  return {
    name: name || workout.name || 'New Routine',
    notes: '',
    items: workout.entries.map((e) => {
      const working = e.sets.filter((s) => s.type !== 'wu');
      const top = working.reduce((a, s) => ((s.w ?? -1) > (a?.w ?? -1) ? s : a), null);
      return {
        id: uid(),
        exerciseId: e.exerciseId,
        targetSets: working.length || e.sets.length,
        targetReps: top?.r ?? null,
        targetWeight: top?.w ?? null,
        notes: '',
      };
    }),
  };
}

// ---------------------------------------------------------------- stats

/** Volume in kg. Warm-ups excluded — they distort the trend line. */
export function setVolume(s) {
  if (s.type === 'wu') return 0;
  if (s.w == null || s.r == null) return 0;
  return s.w * s.r;
}

export const entryVolume = (e) => e.sets.reduce((n, s) => n + (s.done ? setVolume(s) : 0), 0);
export const workoutVolume = (w) => w.entries.reduce((n, e) => n + entryVolume(e), 0);

export const workingSets = (w) =>
  w.entries.reduce((n, e) => n + e.sets.filter((s) => s.done && s.type !== 'wu').length, 0);

export const workoutReps = (w) =>
  w.entries.reduce(
    (n, e) => n + e.sets.reduce((m, s) => m + (s.done && s.type !== 'wu' ? s.r || 0 : 0), 0),
    0
  );

export function workoutDuration(w) {
  if (!w.startedAt) return null;
  const end = w.endedAt || (w.status === 'active' ? Date.now() : null);
  return end ? Math.round((end - w.startedAt) / 1000) : null;
}

/** The last time this exercise was performed in a completed workout. */
export function lastPerformance(exerciseId, excludeWorkoutId = null) {
  for (const w of state.workouts) {
    if (w.status !== 'done' || w.id === excludeWorkoutId) continue;
    const entry = w.entries.find((e) => e.exerciseId === exerciseId && e.sets.some((s) => s.done));
    if (entry) return { workout: w, entry, day: w.day };
  }
  return null;
}

/** Per-session series for one exercise, oldest first. */
export function exerciseSeries(exerciseId) {
  const out = [];
  for (const w of state.workouts) {
    if (w.status !== 'done') continue;
    for (const e of w.entries) {
      if (e.exerciseId !== exerciseId) continue;
      const done = e.sets.filter((s) => s.done && s.type !== 'wu');
      if (!done.length) continue;
      const withWeight = done.filter((s) => s.w != null);
      const top = withWeight.reduce((a, s) => (a == null || s.w > a.w ? s : a), null);
      out.push({
        day: w.day,
        workoutId: w.id,
        sets: done.length,
        reps: done.reduce((n, s) => n + (s.r || 0), 0),
        volume: done.reduce((n, s) => n + setVolume(s), 0),
        topWeight: top ? top.w : null,
        topReps: top ? top.r : null,
        seconds: done.reduce((n, s) => n + (s.sec || 0), 0) || null,
        distance: done.reduce((n, s) => n + (s.dist || 0), 0) || null,
      });
    }
  }
  return out.reverse(); // oldest first
}

/** Volume + set count bucketed by ISO-ish (Monday) week. */
export function weeklyTotals(weeks = 12) {
  const map = new Map();
  for (const w of completedWorkouts()) {
    const k = weekKey(w.day);
    const cur = map.get(k) || { week: k, volume: 0, sets: 0, workouts: 0, reps: 0 };
    cur.volume += workoutVolume(w);
    cur.sets += workingSets(w);
    cur.reps += workoutReps(w);
    cur.workouts += 1;
    map.set(k, cur);
  }
  // Fill gaps so a missed week reads as zero rather than vanishing.
  const today = new Date();
  const keys = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    keys.push(weekKey(d));
  }
  return [...new Set(keys)].map((k) => map.get(k) || { week: k, volume: 0, sets: 0, workouts: 0, reps: 0 });
}

/** Working sets per muscle group over the last N days. Secondary muscles count half. */
export function muscleBreakdown(days = 30) {
  const cutoff = dayKey(new Date(Date.now() - days * 86400000));
  const totals = new Map();
  for (const w of completedWorkouts()) {
    if (w.day < cutoff) continue;
    for (const e of w.entries) {
      const ex = exerciseById(e.exerciseId);
      if (!ex) continue;
      const n = e.sets.filter((s) => s.done && s.type !== 'wu').length;
      if (!n) continue;
      totals.set(ex.primary, (totals.get(ex.primary) || 0) + n);
      for (const m of ex.secondary) totals.set(m, (totals.get(m) || 0) + n * 0.5);
    }
  }
  return [...totals.entries()]
    .map(([muscle, sets]) => ({ muscle, sets: Math.round(sets * 10) / 10 }))
    .sort((a, b) => b.sets - a.sets);
}

/** Map of dayKey -> working-set count, for the activity calendar. */
export function activityByDay(days = 182) {
  const cutoff = dayKey(new Date(Date.now() - days * 86400000));
  const map = new Map();
  for (const w of completedWorkouts()) {
    if (w.day < cutoff) continue;
    map.set(w.day, (map.get(w.day) || 0) + workingSets(w));
  }
  return map;
}

export function overallStats() {
  const done = completedWorkouts();
  const totalVolume = done.reduce((n, w) => n + workoutVolume(w), 0);
  const totalSets = done.reduce((n, w) => n + workingSets(w), 0);
  const last30 = done.filter((w) => w.day >= dayKey(new Date(Date.now() - 30 * 86400000)));
  return {
    workouts: done.length,
    totalVolume,
    totalSets,
    last30Count: last30.length,
    streakWeeks: currentStreakWeeks(done),
  };
}

function currentStreakWeeks(done) {
  if (!done.length) return 0;
  const weeks = new Set(done.map((w) => weekKey(w.day)));
  let streak = 0;
  const d = new Date();
  // Allow the current week to be empty without breaking the streak.
  if (!weeks.has(weekKey(d))) d.setDate(d.getDate() - 7);
  while (weeks.has(weekKey(d))) {
    streak++;
    d.setDate(d.getDate() - 7);
  }
  return streak;
}

// ---------------------------------------------------------------- backup

export function exportData() {
  return {
    format: 'gymtracker-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    exercises: [...state.exercises.values()],
    workouts: state.workouts,
    routines: state.routines,
  };
}

export async function importData(payload, { replace = false } = {}) {
  if (!payload || payload.format !== 'gymtracker-backup') {
    throw new Error('Not a GymTracker backup file.');
  }
  if (replace) await wipeAll();

  const exs = payload.exercises || [];
  const wos = payload.workouts || [];
  const rts = payload.routines || [];

  await dbPutMany(STORES.exercises, exs);
  if (wos.length) await dbPutMany(STORES.workouts, wos);
  if (rts.length) await dbPutMany(STORES.routines, rts);
  if (payload.settings) {
    await dbPut(STORES.meta, { key: 'settings', value: { ...DEFAULT_SETTINGS, ...payload.settings } });
  }
  await dbPut(STORES.meta, { key: 'libraryVersion', value: LIBRARY_VERSION });

  _resetCache();
  await init();
  emit();
  return { exercises: exs.length, workouts: wos.length, routines: rts.length };
}

function _resetCache() {
  state.ready = false;
  state.exercises = new Map();
  state.workouts = [];
  state.routines = [];
}

export async function resetEverything() {
  await wipeAll();
  _resetCache();
  state.settings = { ...DEFAULT_SETTINGS };
  await init();
  emit();
}
