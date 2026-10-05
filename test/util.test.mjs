// Pure helpers: dates, durations, units, formatting, search.
//
// Anything that goes through toLocaleString is asserted on structure rather
// than exact output — the runner's locale is not ours to pin down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  uid,
  dayKey,
  parseDayKey,
  addDays,
  weekKey,
  relativeDay,
  fmtDuration,
  fmtClock,
  parseDuration,
  KG_PER_LB,
  toDisplayWeight,
  toStoredWeight,
  fmtWeight,
  toDisplayDistance,
  toStoredDistance,
  distanceLabel,
  fmtDistance,
  fmtNum,
  plural,
  matchesQuery,
  SET_TYPES,
} from '../src/util.js';

// ---------------------------------------------------------------- ids

test('uid is unique across a tight loop', () => {
  const seen = new Set();
  for (let i = 0; i < 10_000; i++) seen.add(uid());
  assert.equal(seen.size, 10_000);
});

// ---------------------------------------------------------------- dates

test('dayKey formats local time, zero-padded', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('dayKey uses the local day, not UTC', () => {
  // 11pm on the 5th stays on the 5th — the whole point of a local day key.
  assert.equal(dayKey(new Date(2026, 5, 5, 23, 30)), '2026-06-05');
  assert.equal(dayKey(new Date(2026, 5, 5, 0, 1)), '2026-06-05');
});

test('parseDayKey round-trips dayKey', () => {
  for (const d of [new Date(2026, 0, 1), new Date(2026, 6, 15), new Date(2026, 11, 31)]) {
    assert.equal(dayKey(parseDayKey(dayKey(d))), dayKey(d));
  }
});

test('parseDayKey builds a local midnight', () => {
  const d = parseDayKey('2026-03-09');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 9);
  assert.equal(d.getHours(), 0);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(dayKey(addDays(new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(dayKey(addDays(new Date(2026, 11, 31), 1)), '2027-01-01');
  assert.equal(dayKey(addDays(new Date(2026, 0, 1), -1)), '2025-12-31');
});

test('addDays does not mutate its argument', () => {
  const original = new Date(2026, 4, 10);
  addDays(original, 5);
  assert.equal(dayKey(original), '2026-05-10');
});

test('weekKey snaps to the Monday of that week', () => {
  // 2026-06-03 is a Wednesday; its week starts Monday 2026-06-01.
  assert.equal(weekKey('2026-06-03'), '2026-06-01');
  assert.equal(weekKey('2026-06-01'), '2026-06-01'); // Monday itself
  assert.equal(weekKey('2026-06-07'), '2026-06-01'); // Sunday belongs to it
  assert.equal(weekKey('2026-06-08'), '2026-06-08'); // next Monday
});

test('weekKey accepts a Date as well as a key', () => {
  assert.equal(weekKey(new Date(2026, 5, 3)), '2026-06-01');
});

test('relativeDay names today and yesterday', () => {
  assert.equal(relativeDay(dayKey()), 'Today');
  assert.equal(relativeDay(dayKey(addDays(new Date(), -1))), 'Yesterday');
});

test('relativeDay counts days inside the last week', () => {
  assert.equal(relativeDay(dayKey(addDays(new Date(), -3))), '3 days ago');
  assert.equal(relativeDay(dayKey(addDays(new Date(), -6))), '6 days ago');
});

test('relativeDay falls back to a date beyond a week', () => {
  const old = relativeDay(dayKey(addDays(new Date(), -30)));
  assert.doesNotMatch(old, /ago|Today|Yesterday/);
  assert.ok(old.length > 0);
});

// ---------------------------------------------------------------- durations

test('fmtDuration picks a unit by magnitude', () => {
  assert.equal(fmtDuration(45), '45s');
  assert.equal(fmtDuration(90), '1m 30s');
  assert.equal(fmtDuration(3600), '1h 00m');
  assert.equal(fmtDuration(3725), '1h 02m');
});

test('fmtDuration clamps negatives and handles no input', () => {
  assert.equal(fmtDuration(-5), '0s');
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(null), '');
  assert.equal(fmtDuration(undefined), '');
  assert.equal(fmtDuration(NaN), '');
});

test('fmtClock is mm:ss and pads seconds', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(9), '0:09');
  assert.equal(fmtClock(90), '1:30');
  assert.equal(fmtClock(600), '10:00');
});

test('fmtClock keeps counting past an hour rather than wrapping', () => {
  assert.equal(fmtClock(3661), '61:01');
});

test('parseDuration reads bare seconds, clock and compound forms', () => {
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('2m'), 120);
  assert.equal(parseDuration('1m30s'), 90);
  assert.equal(parseDuration('1h 30m'), 5400);
});

test('parseDuration is empty-safe', () => {
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('   '), null);
  assert.equal(parseDuration('banana'), null);
});

test('parseDuration round-trips fmtClock', () => {
  for (const sec of [0, 45, 90, 600, 3599]) {
    assert.equal(parseDuration(fmtClock(sec)), sec);
  }
});

// ---------------------------------------------------------------- units

test('weight conversion round-trips through lb without drift', () => {
  for (const kg of [0.5, 20, 60, 102.5, 227.5]) {
    assert.ok(Math.abs(toStoredWeight(toDisplayWeight(kg, 'lb'), 'lb') - kg) < 1e-9);
  }
});

test('kg passes through untouched', () => {
  assert.equal(toDisplayWeight(80, 'kg'), 80);
  assert.equal(toStoredWeight(80, 'kg'), 80);
});

test('weight conversion uses the international pound', () => {
  assert.equal(KG_PER_LB, 0.45359237);
  assert.ok(Math.abs(toDisplayWeight(100, 'lb') - 220.46226) < 0.001);
});

test('weight helpers are null-safe', () => {
  assert.equal(toDisplayWeight(null, 'kg'), null);
  assert.equal(toStoredWeight(null, 'kg'), null);
  assert.equal(toStoredWeight('', 'kg'), null);
  assert.equal(fmtWeight(null, 'kg'), '');
});

test('fmtWeight drops a trailing .0 but keeps a real decimal', () => {
  assert.equal(fmtWeight(80, 'kg'), '80 kg');
  assert.equal(fmtWeight(102.5, 'kg'), '102.5 kg');
  assert.equal(fmtWeight(80, 'kg', false), '80');
});

test('distance converts by the same unit switch as weight', () => {
  assert.equal(toDisplayDistance(5000, 'kg'), 5);
  assert.ok(Math.abs(toDisplayDistance(1609.344, 'lb') - 1) < 1e-9);
  assert.equal(toStoredDistance(5, 'kg'), 5000);
  assert.equal(toDisplayDistance(null, 'kg'), null);
  assert.equal(toStoredDistance('', 'kg'), null);
});

test('distance labels follow the weight unit', () => {
  assert.equal(distanceLabel('kg'), 'km');
  assert.equal(distanceLabel('lb'), 'mi');
  assert.equal(fmtDistance(5000, 'kg'), '5 km');
  assert.equal(fmtDistance(null, 'kg'), '');
});

// ---------------------------------------------------------------- numbers

test('fmtNum marks missing values with a dash', () => {
  assert.equal(fmtNum(null), '–');
  assert.equal(fmtNum(undefined), '–');
  assert.equal(fmtNum(NaN), '–');
});

test('fmtNum renders zero as a number, not as missing', () => {
  assert.equal(fmtNum(0), '0');
});

test('plural only adds a suffix away from one', () => {
  assert.equal(plural(1, 'set'), '1 set');
  assert.equal(plural(0, 'set'), '0 sets');
  assert.equal(plural(3, 'set'), '3 sets');
  assert.equal(plural(2, 'box', 'es'), '2 boxes');
});

// ---------------------------------------------------------------- search

test('matchesQuery requires every token, in any order', () => {
  assert.ok(matchesQuery('Barbell Bench Press', 'bench'));
  assert.ok(matchesQuery('Barbell Bench Press', 'bench barbell'));
  assert.ok(matchesQuery('Barbell Bench Press', 'BENCH'));
  assert.ok(!matchesQuery('Barbell Bench Press', 'bench squat'));
});

test('matchesQuery treats an empty query as "everything"', () => {
  assert.ok(matchesQuery('anything', ''));
  assert.ok(matchesQuery('anything', '   '));
});

// ---------------------------------------------------------------- set types

test('every set type carries a label, badge and class', () => {
  for (const [key, t] of Object.entries(SET_TYPES)) {
    assert.ok(t.label, `${key} needs a label`);
    assert.ok(t.short, `${key} needs a badge`);
    assert.ok(t.cls, `${key} needs a class`);
  }
});

test('set type keys match the ones the store and styles use', () => {
  assert.deepEqual(Object.keys(SET_TYPES).sort(), ['d', 'f', 'w', 'wu']);
});
