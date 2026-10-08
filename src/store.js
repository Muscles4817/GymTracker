// Application state: loads everything into memory once, writes through to IndexedDB.
// A personal training log is small (thousands of workouts at most), so keeping it
// all in memory makes every query — charts included — a plain array scan.

import { STORES, dbAll, dbGet, dbPut, dbPutMany, dbDelete, wipeAll, openDb } from './db.js';
import { EXERCISE_LIBRARY, LIBRARY_VERSION } from './exercises.js';
import { uid, dayKey, weekKey, KG_PER_LB } from './util.js';

export const DEFAULT_SETTINGS = {
  unit: 'kg',
  restDefault: 90,
  restAuto: true,
  theme: 'system',
  textScale: 1,
  trackRpe: false,
  suggestIncrease: true,
  increment: null, // kg; null means 2.5 kg, or 5 lb when showing pounds
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
    const next = routineTarget(it);
    const sets = Array.from({ length: n }, () => newSet({ w: next.w, r: next.r }));
    const entry = { ...newEntry(it.exerciseId, sets), notes: it.notes || '', group: it.group || null };
    if (next.up) entry.hint = { from: next.from, to: next.w };
    return entry;
  });
  return startWorkout({ name: r.name, routineId, entries });
}

/** The weight step for a suggested increase, in kg. */
export function incrementStep(settings = state.settings) {
  if (settings.increment > 0) return settings.increment;
  return settings.unit === 'lb' ? 5 * KG_PER_LB : 2.5;
}

/** What a routine item should load today, given how its exercise went last
    time. Double progression: repeat your last top weight until every target
    set reaches the target reps at it, then add one step. A routine target
    set higher than that still wins — you raised it on purpose.

    Pure: `lastSets` are the sets from the last session of the exercise. */
export function suggestTarget(item, lastSets, step) {
  const plain = { w: item.targetWeight ?? null, r: item.targetReps ?? null, up: false, from: null };
  const working = (lastSets || []).filter((s) => s.done && s.type !== 'wu' && s.w != null);
  if (!working.length) return plain;
  const base = Math.max(...working.map((s) => s.w));
  const goal = item.targetReps;
  const needed = Math.max(1, Number(item.targetSets) || 1);
  const earned = goal != null && working.filter((s) => s.w >= base && s.r >= goal).length >= needed;
  const w = earned ? base + step : base;
  if (item.targetWeight != null && item.targetWeight > w) return plain;
  return { w, r: plain.r, up: earned, from: earned ? base : null };
}

export function routineTarget(item) {
  if (!state.settings.suggestIncrease) return suggestTarget(item, null, 0);
  return suggestTarget(item, lastPerformance(item.exerciseId)?.entry.sets, incrementStep());
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
    normalizeGroups(w.entries);
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

/** RPE is opt-in — it costs a column in the busiest row in the app, and most
    sessions never use it. An entry that already carries one keeps showing it
    regardless, so turning the setting off never hides data you logged. */
export const showsRpe = (entry, trackRpe) =>
  !!trackRpe || (entry?.sets || []).some((s) => s.rpe != null);

// ---------------------------------------------------------------- supersets

/* A superset is a run of consecutive entries sharing a `group` id. The same
   functions serve workout entries and routine items. */

/** Tidy groups after any reorder or removal: a run of one is no superset,
    and an id that turns up again after a gap starts a new group. Mutates. */
export function normalizeGroups(list) {
  const seen = new Set();
  let i = 0;
  while (i < list.length) {
    const g = list[i].group;
    if (!g) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < list.length && list[j + 1].group === g) j++;
    const id = seen.has(g) ? uid() : g;
    seen.add(g);
    for (let k = i; k <= j; k++) list[k].group = j > i ? id : null;
    i = j + 1;
  }
  return list;
}

/** Join item i and everything grouped with item i + 1 into one superset. */
export function linkWithNext(list, i) {
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b) return list;
  const id = a.group || b.group || uid();
  const joining = b.group;
  a.group = id;
  b.group = id;
  for (let k = i + 2; joining && k < list.length && list[k].group === joining; k++) list[k].group = id;
  return normalizeGroups(list);
}

/** Split the superset between item i and item i + 1. */
export function unlinkFromNext(list, i) {
  const g = list[i]?.group;
  if (!g || list[i + 1]?.group !== g) return list;
  const id = uid();
  for (let k = i + 1; k < list.length && list[k].group === g; k++) list[k].group = id;
  return normalizeGroups(list);
}

/** "A1", "A2", "B1"… by index, for items that are in a superset. */
export function supersetLabels(list) {
  const out = new Map();
  let letter = -1;
  let pos = 0;
  list.forEach((x, i) => {
    if (!x.group) return;
    if (x.group !== list[i - 1]?.group) {
      letter++;
      pos = 0;
    }
    out.set(i, `${String.fromCharCode(65 + (letter % 26))}${++pos}`);
  });
  return out;
}

/** Where to go after ticking a set of entry i. Inside a superset you move on
    to the next exercise in it that still has sets to do, without resting;
    from the last one you rest, then go round to the first again.
    Returns { rest, next } where next is an entry index or null. */
export function supersetNext(entries, i) {
  const g = entries[i]?.group;
  if (!g) return { rest: true, next: null };
  let start = i;
  while (entries[start - 1]?.group === g) start--;
  let end = i;
  while (entries[end + 1]?.group === g) end++;
  const pending = (k) => entries[k].sets.some((s) => !s.done);
  for (let k = i + 1; k <= end; k++) if (pending(k)) return { rest: false, next: k };
  for (let k = start; k <= i; k++) if (pending(k)) return { rest: true, next: k === i ? null : k };
  return { rest: true, next: null };
}

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
        group: e.group || null,
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

// ---------------------------------------------------------------- records

export const RECORD_LABELS = {
  weight: 'Heaviest',
  reps: 'Rep record',
  hold: 'Longest hold',
  distance: 'Longest distance',
};

const countsForRecords = (s) => s.done && s.type !== 'wu';

/** Which of `sets` set a record, judged against `prior` and against the
    session's own earlier sets. Returns Map<setId, kinds[]>.

    Weighted work has two records: the heaviest load, and a rep record — more
    reps than ever at that load or heavier, which is how strength shows up
    between new maxes. Drop sets are light by design, so they never claim a
    rep record. With no prior sets at all nothing counts: a first session is
    a baseline, not a row of trophies. */
export function findRecords(prior, sets, track) {
  const out = new Map();
  const pool = prior.filter(countsForRecords);
  if (!pool.length) return out;
  const max = (f) => pool.reduce((m, p) => Math.max(m, f(p) ?? -Infinity), -Infinity);

  for (const s of sets) {
    if (!countsForRecords(s)) continue;
    const kinds = [];
    if (track === 'wr' || track === 'br') {
      // Bodyweight work logs added load only, so no weight means bodyweight.
      const w = s.w ?? (track === 'br' ? 0 : null);
      if (w != null && s.r >= 1) {
        if (w > 0 && w > max((p) => p.w)) kinds.push('weight');
        else if (
          s.type !== 'd' &&
          !pool.some((p) => (p.w ?? (track === 'br' ? 0 : -Infinity)) >= w && (p.r ?? 0) >= s.r)
        ) {
          kinds.push('reps');
        }
      }
    } else if (track === 'dur') {
      if (s.sec > 0 && s.sec > max((p) => p.sec)) kinds.push('hold');
    } else if (track === 'cardio') {
      if (s.dist > 0 && s.dist > max((p) => p.dist)) kinds.push('distance');
    }
    if (kinds.length) out.set(s.id, kinds);
    pool.push(s);
  }
  return out;
}

/** For each rep count you have done, the heaviest weight lifted for at least
    that many reps — the classic rep-max table. A row is dropped when a
    higher-rep row matches its weight, since that set already proves it.
    Takes sets carrying their `day`. */
export function repMaxTable(sets) {
  const valid = sets.filter((s) => countsForRecords(s) && s.w != null && s.w > 0 && s.r >= 1);
  const counts = [...new Set(valid.map((s) => s.r))].filter((r) => r <= 20).sort((a, b) => a - b);
  const rows = counts.map((r) => {
    let best = null;
    for (const s of valid) {
      if (s.r < r) continue;
      if (!best || s.w > best.w || (s.w === best.w && s.day < best.day)) best = s;
    }
    return { reps: r, w: best.w, day: best.day };
  });
  return rows.filter((row, i) => !(rows[i + 1] && rows[i + 1].w === row.w));
}

const isOlder = (a, b) => sortWorkoutsDesc(a, b) > 0;

/** Every record set in workout `w`, judged against the workouts before it. */
export function workoutRecords(w) {
  const out = new Map();
  if (!w) return out;
  const prior = state.workouts.filter((x) => x.status === 'done' && x.id !== w.id && isOlder(x, w));
  const earlier = new Map(); // exerciseId -> this session's sets so far
  for (const e of w.entries) {
    const track = exerciseById(e.exerciseId)?.track || 'wr';
    const history = prior.flatMap((x) =>
      x.entries.filter((pe) => pe.exerciseId === e.exerciseId).flatMap((pe) => pe.sets)
    );
    const before = earlier.get(e.exerciseId) || [];
    findRecords([...history, ...before], e.sets, track).forEach((kinds, id) => out.set(id, kinds));
    earlier.set(e.exerciseId, [...before, ...e.sets]);
  }
  return out;
}

/** All-time bests for one exercise, for its detail page. */
export function exerciseRecords(exerciseId) {
  const sets = [];
  for (const w of completedWorkouts()) {
    for (const e of w.entries) {
      if (e.exerciseId !== exerciseId) continue;
      for (const s of e.sets) if (countsForRecords(s)) sets.push({ ...s, day: w.day });
    }
  }
  const top = (f) =>
    sets.reduce((a, s) => (f(s) > 0 && (!a || f(s) > f(a) || (f(s) === f(a) && s.day < a.day)) ? s : a), null);
  return {
    repMaxes: repMaxTable(sets),
    maxReps: top((s) => s.r),
    hold: top((s) => s.sec),
    distance: top((s) => s.dist),
  };
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
