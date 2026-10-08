// The store's pure core: volume, set counting, duration and routine derivation.
//
// Anything that reads module state (weeklyTotals, overallStats, exerciseSeries,
// lastPerformance) needs a seeded IndexedDB and stays covered by the smoke
// test — importing this module is side-effect free, but init() is not.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newSet,
  newEntry,
  isSetFilled,
  setVolume,
  entryVolume,
  workoutVolume,
  workingSets,
  workoutReps,
  workoutDuration,
  routineFromWorkout,
  showsRpe,
  findRecords,
  repMaxTable,
  suggestTarget,
  incrementStep,
} from '../src/store.js';

/** A done working set, unless overridden. */
const s = (over = {}) => newSet({ done: true, ...over });

const entry = (exerciseId, sets) => ({ ...newEntry(exerciseId, sets) });

const workout = (entries, over = {}) => ({
  id: 'w1',
  day: '2026-06-03',
  name: 'Test Workout',
  notes: '',
  status: 'done',
  startedAt: null,
  endedAt: null,
  routineId: null,
  entries,
  ...over,
});

// ---------------------------------------------------------------- factories

test('newSet produces an empty working set', () => {
  const set = newSet();
  assert.equal(set.type, 'w');
  assert.equal(set.done, false);
  assert.equal(set.w, null);
  assert.equal(set.r, null);
  assert.ok(set.id);
});

test('newSet overrides win over the defaults', () => {
  const set = newSet({ w: 60, r: 8, type: 'wu', done: true });
  assert.equal(set.w, 60);
  assert.equal(set.type, 'wu');
  assert.equal(set.done, true);
});

test('newSet gives every set its own id', () => {
  assert.notEqual(newSet().id, newSet().id);
});

test('newEntry starts with one empty set', () => {
  const e = newEntry('ex-1');
  assert.equal(e.exerciseId, 'ex-1');
  assert.equal(e.sets.length, 1);
  assert.equal(e.sets[0].done, false);
});

// ---------------------------------------------------------------- isSetFilled

test('isSetFilled accepts any one logged field', () => {
  assert.ok(isSetFilled(newSet({ w: 60 })));
  assert.ok(isSetFilled(newSet({ r: 10 })));
  assert.ok(isSetFilled(newSet({ sec: 60 })));
  assert.ok(isSetFilled(newSet({ dist: 5000 })));
});

test('isSetFilled rejects an untouched set', () => {
  assert.ok(!isSetFilled(newSet()));
});

test('isSetFilled counts a zero as logged', () => {
  assert.ok(isSetFilled(newSet({ r: 0 })));
});

// ---------------------------------------------------------------- setVolume

test('setVolume multiplies weight by reps', () => {
  assert.equal(setVolume(s({ w: 60, r: 10 })), 600);
  assert.equal(setVolume(s({ w: 102.5, r: 8 })), 820);
});

test('setVolume excludes warm-ups', () => {
  assert.equal(setVolume(s({ w: 60, r: 10, type: 'wu' })), 0);
});

test('setVolume counts drop sets and sets to failure', () => {
  assert.equal(setVolume(s({ w: 60, r: 10, type: 'd' })), 600);
  assert.equal(setVolume(s({ w: 60, r: 10, type: 'f' })), 600);
});

test('setVolume is zero when either half is missing', () => {
  assert.equal(setVolume(s({ w: 60 })), 0);
  assert.equal(setVolume(s({ r: 10 })), 0);
  assert.equal(setVolume(s()), 0);
});

test('setVolume handles bodyweight sets logged at zero', () => {
  assert.equal(setVolume(s({ w: 0, r: 20 })), 0);
});

// ---------------------------------------------------------------- aggregates

test('entryVolume counts only completed sets', () => {
  const e = entry('ex-1', [
    s({ w: 60, r: 10 }),
    s({ w: 60, r: 10, done: false }),
  ]);
  assert.equal(entryVolume(e), 600);
});

test('entryVolume drops warm-ups even when completed', () => {
  const e = entry('ex-1', [
    s({ w: 40, r: 10, type: 'wu' }),
    s({ w: 60, r: 10 }),
  ]);
  assert.equal(entryVolume(e), 600);
});

test('workoutVolume sums across exercises', () => {
  const w = workout([
    entry('ex-1', [s({ w: 60, r: 10 })]),
    entry('ex-2', [s({ w: 50, r: 12 })]),
  ]);
  assert.equal(workoutVolume(w), 600 + 600);
});

test('workoutVolume of an empty workout is zero', () => {
  assert.equal(workoutVolume(workout([])), 0);
  assert.equal(workoutVolume(workout([entry('ex-1', [])])), 0);
});

test('workingSets counts completed non-warm-up sets', () => {
  const w = workout([
    entry('ex-1', [
      s({ w: 40, r: 10, type: 'wu' }),
      s({ w: 60, r: 10 }),
      s({ w: 60, r: 8 }),
      s({ w: 60, r: 6, done: false }),
    ]),
  ]);
  assert.equal(workingSets(w), 2);
});

test('workingSets counts a set with no weight logged', () => {
  // A completed bodyweight or timed set is still a working set.
  const w = workout([entry('ex-1', [s({ sec: 60 })])]);
  assert.equal(workingSets(w), 1);
});

test('workoutReps sums reps from working sets only', () => {
  const w = workout([
    entry('ex-1', [
      s({ w: 40, r: 15, type: 'wu' }),
      s({ w: 60, r: 10 }),
      s({ w: 60, r: 8 }),
      s({ w: 60, r: 6, done: false }),
    ]),
  ]);
  assert.equal(workoutReps(w), 18);
});

test('workoutReps treats a missing rep count as zero', () => {
  const w = workout([entry('ex-1', [s({ sec: 60 }), s({ w: 60, r: 10 })])]);
  assert.equal(workoutReps(w), 10);
});

// ---------------------------------------------------------------- duration

test('workoutDuration is null before a workout starts', () => {
  assert.equal(workoutDuration(workout([], { startedAt: null })), null);
});

test('workoutDuration measures start to end in seconds', () => {
  // Both timestamps are epoch milliseconds.
  const w = workout([], { startedAt: 1_000_000, endedAt: 1_000_000 + 3_600_000 });
  assert.equal(workoutDuration(w), 3600);
});

test('workoutDuration rounds to the nearest second', () => {
  assert.equal(workoutDuration(workout([], { startedAt: 1_000_000, endedAt: 1_001_499 })), 1);
  assert.equal(workoutDuration(workout([], { startedAt: 1_000_000, endedAt: 1_001_500 })), 2);
});

test('workoutDuration runs to now while a workout is active', () => {
  const w = workout([], { status: 'active', startedAt: Date.now() - 5000, endedAt: null });
  const d = workoutDuration(w);
  assert.ok(d >= 4 && d <= 7, `expected about 5s, got ${d}`);
});

test('workoutDuration is null for an unfinished, inactive workout', () => {
  const w = workout([], { status: 'done', startedAt: 1_000_000, endedAt: null });
  assert.equal(workoutDuration(w), null);
});

// ---------------------------------------------------------------- routines

test('routineFromWorkout takes the given name first', () => {
  const r = routineFromWorkout(workout([]), 'Push Day A');
  assert.equal(r.name, 'Push Day A');
});

test('routineFromWorkout falls back to the workout name, then a default', () => {
  assert.equal(routineFromWorkout(workout([]), '').name, 'Test Workout');
  assert.equal(routineFromWorkout(workout([], { name: '' }), '').name, 'New Routine');
});

test('routineFromWorkout carries one item per exercise', () => {
  const r = routineFromWorkout(
    workout([entry('ex-1', [s({ w: 60, r: 10 })]), entry('ex-2', [s({ w: 50, r: 12 })])]),
    'R'
  );
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => i.exerciseId), ['ex-1', 'ex-2']);
});

test('routineFromWorkout targets the heaviest set', () => {
  const r = routineFromWorkout(
    workout([entry('ex-1', [s({ w: 60, r: 10 }), s({ w: 80, r: 5 }), s({ w: 70, r: 8 })])]),
    'R'
  );
  assert.equal(r.items[0].targetWeight, 80);
  assert.equal(r.items[0].targetReps, 5);
});

test('routineFromWorkout excludes warm-ups from the target set count', () => {
  const r = routineFromWorkout(
    workout([entry('ex-1', [s({ w: 40, r: 10, type: 'wu' }), s({ w: 60, r: 10 }), s({ w: 60, r: 8 })])]),
    'R'
  );
  assert.equal(r.items[0].targetSets, 2);
});

test('routineFromWorkout ignores a warm-up even if it was the heaviest', () => {
  const r = routineFromWorkout(
    workout([entry('ex-1', [s({ w: 100, r: 1, type: 'wu' }), s({ w: 60, r: 10 })])]),
    'R'
  );
  assert.equal(r.items[0].targetWeight, 60);
});

test('routineFromWorkout keeps the set count when every set was a warm-up', () => {
  const r = routineFromWorkout(
    workout([entry('ex-1', [s({ w: 40, r: 10, type: 'wu' }), s({ w: 40, r: 10, type: 'wu' })])]),
    'R'
  );
  assert.equal(r.items[0].targetSets, 2);
  assert.equal(r.items[0].targetWeight, null);
});

test('routineFromWorkout leaves targets null for unweighted work', () => {
  const r = routineFromWorkout(workout([entry('ex-1', [s({ sec: 60 })])]), 'R');
  assert.equal(r.items[0].targetWeight, null);
  assert.equal(r.items[0].targetReps, null);
  assert.equal(r.items[0].targetSets, 1);
});

test('routineFromWorkout gives each item its own id', () => {
  const r = routineFromWorkout(
    workout([entry('ex-1', [s({ w: 60, r: 10 })]), entry('ex-2', [s({ w: 60, r: 10 })])]),
    'R'
  );
  assert.notEqual(r.items[0].id, r.items[1].id);
});

// ---------------------------------------------------------------- RPE column

test('showsRpe follows the setting when nothing is logged', () => {
  const e = entry('ex-1', [s(), s()]);
  assert.equal(showsRpe(e, true), true);
  assert.equal(showsRpe(e, false), false);
});

test('showsRpe keeps the column for an entry that already has one', () => {
  const e = entry('ex-1', [s({ w: 60, r: 10 }), s({ w: 60, r: 8, rpe: 8.5 })]);
  assert.equal(showsRpe(e, false), true);
});

test('showsRpe treats an RPE of zero as logged', () => {
  assert.equal(showsRpe(entry('ex-1', [s({ rpe: 0 })]), false), true);
});

test('showsRpe is safe on a missing or empty entry', () => {
  assert.equal(showsRpe(undefined, false), false);
  assert.equal(showsRpe({ sets: [] }, false), false);
  assert.equal(showsRpe(undefined, true), true);
});

// ---------------------------------------------------------------- records

const kindsOf = (prior, sets, track = 'wr') => [...findRecords(prior, sets, track).values()];

test('findRecords: a first session sets no records', () => {
  assert.equal(findRecords([], [s({ w: 100, r: 5 })], 'wr').size, 0);
});

test('findRecords: a heavier set than ever is a weight record', () => {
  const rec = findRecords([s({ w: 80, r: 5 })], [s({ id: 'a', w: 82.5, r: 3 })], 'wr');
  assert.deepEqual(rec.get('a'), ['weight']);
});

test('findRecords: more reps at the same or lighter weight is a rep record', () => {
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 })], [s({ w: 80, r: 6 })]), [['reps']]);
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 })], [s({ w: 70, r: 9 })]), [['reps']]);
});

test('findRecords: a set beaten by an earlier heavier-and-longer set is not a record', () => {
  assert.deepEqual(kindsOf([s({ w: 80, r: 8 })], [s({ w: 70, r: 8 }), s({ w: 80, r: 8 })]), []);
});

test('findRecords: warm-ups neither claim nor set the bar', () => {
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 })], [s({ w: 100, r: 5, type: 'wu' })]), []);
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 }), s({ w: 200, r: 5, type: 'wu' })], [s({ w: 90, r: 5 })]), [['weight']]);
});

test('findRecords: unticked sets are ignored', () => {
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 })], [s({ w: 100, r: 5, done: false })]), []);
});

test('findRecords: drop sets do not claim rep records', () => {
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 })], [s({ w: 40, r: 15, type: 'd' })]), []);
});

test('findRecords: the session raises its own bar as it goes', () => {
  assert.deepEqual(kindsOf([s({ w: 80, r: 5 })], [s({ w: 85, r: 5 }), s({ w: 85, r: 5 })]), [['weight']]);
});

test('findRecords: bodyweight reps count with no weight logged', () => {
  assert.deepEqual(kindsOf([s({ r: 10 })], [s({ r: 12 })], 'br'), [['reps']]);
  assert.deepEqual(kindsOf([s({ r: 10 })], [s({ w: 5, r: 6 })], 'br'), [['weight']]);
});

test('findRecords: holds and distances', () => {
  assert.deepEqual(kindsOf([s({ sec: 60 })], [s({ sec: 75 })], 'dur'), [['hold']]);
  assert.deepEqual(kindsOf([s({ dist: 5000 })], [s({ dist: 5200 })], 'cardio'), [['distance']]);
  assert.deepEqual(kindsOf([s({ dist: 5000 })], [s({ dist: 5000 })], 'cardio'), []);
});

test('repMaxTable lists the heaviest weight for at least each rep count', () => {
  const rows = repMaxTable([
    s({ w: 100, r: 1, day: '2026-01-01' }),
    s({ w: 90, r: 3, day: '2026-01-02' }),
    s({ w: 80, r: 8, day: '2026-01-03' }),
  ]);
  assert.deepEqual(rows.map((r) => [r.reps, r.w]), [[1, 100], [3, 90], [8, 80]]);
});

test('repMaxTable drops a row a higher-rep set already proves', () => {
  const rows = repMaxTable([s({ w: 90, r: 3, day: 'a' }), s({ w: 90, r: 5, day: 'b' })]);
  assert.deepEqual(rows.map((r) => [r.reps, r.w]), [[5, 90]]);
});

test('repMaxTable keeps the first day a weight was reached', () => {
  const rows = repMaxTable([s({ w: 90, r: 5, day: '2026-02-01' }), s({ w: 90, r: 5, day: '2026-01-01' })]);
  assert.equal(rows[0].day, '2026-01-01');
});

test('repMaxTable ignores warm-ups and weightless sets', () => {
  assert.deepEqual(repMaxTable([s({ w: 200, r: 1, type: 'wu', day: 'a' }), s({ r: 10, day: 'b' })]), []);
});

// ---------------------------------------------------------------- suggested increases

const item = (over = {}) => ({ exerciseId: 'x', targetSets: 3, targetReps: 10, targetWeight: 40, ...over });

test('suggestTarget uses the routine targets with no history', () => {
  assert.deepEqual(suggestTarget(item(), null, 2.5), { w: 40, r: 10, up: false, from: null });
});

test('suggestTarget adds a step once every target set hit the target reps', () => {
  const last = [s({ w: 60, r: 10 }), s({ w: 60, r: 11 }), s({ w: 60, r: 10 })];
  assert.deepEqual(suggestTarget(item(), last, 2.5), { w: 62.5, r: 10, up: true, from: 60 });
});

test('suggestTarget repeats the weight when a set fell short', () => {
  const last = [s({ w: 60, r: 10 }), s({ w: 60, r: 9 }), s({ w: 60, r: 8 })];
  assert.deepEqual(suggestTarget(item(), last, 2.5), { w: 60, r: 10, up: false, from: null });
});

test('suggestTarget needs the target number of sets at the top weight', () => {
  const last = [s({ w: 60, r: 10 }), s({ w: 60, r: 10 })];
  assert.equal(suggestTarget(item(), last, 2.5).up, false);
});

test('suggestTarget ignores warm-ups and unticked sets', () => {
  const last = [s({ w: 100, r: 10, type: 'wu' }), s({ w: 60, r: 10 }), s({ w: 60, r: 10 }), s({ w: 60, r: 10 }), s({ w: 90, r: 1, done: false })];
  assert.deepEqual(suggestTarget(item(), last, 2.5), { w: 62.5, r: 10, up: true, from: 60 });
});

test('suggestTarget lets a higher routine target win', () => {
  const last = [s({ w: 30, r: 10 }), s({ w: 30, r: 10 }), s({ w: 30, r: 10 })];
  assert.deepEqual(suggestTarget(item(), last, 2.5), { w: 40, r: 10, up: false, from: null });
});

test('suggestTarget never steps up without a rep target to judge by', () => {
  const last = [s({ w: 60, r: 12 })];
  assert.deepEqual(suggestTarget(item({ targetReps: null, targetSets: 1 }), last, 2.5), { w: 60, r: null, up: false, from: null });
});

test('suggestTarget leaves unweighted work alone', () => {
  assert.deepEqual(suggestTarget(item({ targetWeight: null }), [s({ r: 15 })], 2.5), { w: null, r: 10, up: false, from: null });
});

test('incrementStep defaults to 2.5 kg, or 5 lb when showing pounds', () => {
  assert.equal(incrementStep({ unit: 'kg', increment: null }), 2.5);
  assert.ok(Math.abs(incrementStep({ unit: 'lb', increment: null }) - 2.26796185) < 1e-6);
  assert.equal(incrementStep({ unit: 'lb', increment: 2 }), 2);
});
