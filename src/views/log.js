// The in-gym screen: start a session, log sets, rest, finish, share.

import {
  activeWorkout, startWorkout, startFromRoutine, updateWorkout, finishWorkout,
  deleteWorkout, workoutById, newSet, newEntry, exerciseById, exerciseName,
  workoutVolume, workingSets, workoutDuration, lastPerformance, allRoutines,
  completedWorkouts, getSettings, isSetFilled,
} from '../store.js';
import { openExercisePicker } from './picker.js';
import {
  node, esc, icon, toast, confirmDialog, promptDialog, emptyState, on,
} from '../ui.js';
import {
  fmtWeight, fmtNum, fmtDuration, fmtClock, parseDuration, relativeDay,
  toDisplayWeight, toStoredWeight, toDisplayDistance, toStoredDistance,
  distanceLabel, plural, SET_TYPES, debounce,
} from '../util.js';
import { startRest, primeAudio } from '../timer.js';
import { openShareSheet, formatWorkout } from '../share.js';

const RPE_VALUES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const TYPE_CYCLE = ['w', 'wu', 'd', 'f'];

export function logView() {
  const el = node('<div class="view view-log"></div>');
  let elapsedTimer = null;

  function render() {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
    el.innerHTML = '';
    const w = activeWorkout();
    el.appendChild(w ? activeScreen(w, render) : startScreen(render));
    if (w) {
      const clock = el.querySelector('[data-elapsed]');
      elapsedTimer = setInterval(() => {
        if (!document.body.contains(clock)) return clearInterval(elapsedTimer);
        clock.textContent = fmtDuration(workoutDuration(activeWorkout() || w) || 0);
      }, 1000);
    }
  }

  render();
  return { el, destroy: () => clearInterval(elapsedTimer) };
}

// ---------------------------------------------------------------- start screen

function startScreen(rerender) {
  const routines = allRoutines();
  const recent = completedWorkouts().slice(0, 5);
  const last = recent[0];

  const wrap = node(`
    <div class="stack">
      <section class="card hero">
        <h2>Ready to train?</h2>
        <p class="muted">Nothing is running. Start a session and log as you go.</p>
        <button class="btn btn-primary btn-lg" data-a="start-empty" type="button">${icon('plus')} Start empty workout</button>
        ${last ? `<button class="btn btn-ghost" data-a="repeat" type="button">${icon('repeat')} Repeat “${esc(last.name)}”</button>` : ''}
      </section>

      <section class="card">
        <header class="card-head">
          <h3>Start from a routine</h3>
          <a class="link" href="#/routines">Manage</a>
        </header>
        ${
          routines.length
            ? `<div class="routine-grid">${routines
                .map(
                  (r) => `
              <button class="routine-chip" data-a="start-routine" data-id="${esc(r.id)}" type="button">
                <span class="routine-name">${esc(r.name)}</span>
                <span class="routine-meta">${plural(r.items.length, 'exercise')}</span>
              </button>`
                )
                .join('')}</div>`
            : `<p class="muted">No routines yet. Build one from a finished workout, or on the <a class="link" href="#/routines">Routines</a> screen.</p>`
        }
      </section>

      ${
        recent.length
          ? `<section class="card">
               <header class="card-head"><h3>Recent sessions</h3><a class="link" href="#/history">All history</a></header>
               <ul class="mini-list">
                 ${recent
                   .map(
                     (w) => `<li><a href="#/history/${esc(w.id)}">
                       <span class="mini-name">${esc(w.name)}</span>
                       <span class="mini-meta">${esc(relativeDay(w.day))} · ${plural(workingSets(w), 'set')}</span>
                     </a></li>`
                   )
                   .join('')}
               </ul>
             </section>`
          : emptyState({
              iconName: 'dumbbell',
              title: 'No workouts logged yet',
              message: 'Your first session starts the charts, the history and the personal records.',
            })
      }
    </div>`);

  wrap.querySelector('[data-a="start-empty"]').addEventListener('click', async () => {
    primeAudio();
    await startWorkout();
    rerender();
  });

  wrap.querySelector('[data-a="repeat"]')?.addEventListener('click', async () => {
    primeAudio();
    const entries = last.entries.map((e) =>
      newEntry(
        e.exerciseId,
        e.sets
          .filter((s) => s.done)
          .map((s) => newSet({ w: s.w, r: s.r, sec: s.sec, dist: s.dist, type: s.type }))
      )
    );
    await startWorkout({ name: last.name, entries: entries.length ? entries : null });
    rerender();
  });

  on(wrap, 'click', '[data-a="start-routine"]', async (ev, btn) => {
    primeAudio();
    await startFromRoutine(btn.dataset.id);
    rerender();
  });

  return wrap;
}

// ---------------------------------------------------------------- active screen

function activeScreen(workout, rerender) {
  const id = workout.id;
  const mutate = (fn) => updateWorkout(id, fn);
  const current = () => workoutById(id);

  const wrap = node(`
    <div class="stack">
      <section class="card workout-head">
        <input class="title-input" value="${esc(workout.name)}" aria-label="Workout name" placeholder="Workout name">
        <div class="stat-row">
          <div class="stat"><span class="stat-value" data-elapsed>${esc(fmtDuration(workoutDuration(workout) || 0))}</span><span class="stat-label">elapsed</span></div>
          <div class="stat"><span class="stat-value" data-sets>${workingSets(workout)}</span><span class="stat-label">sets</span></div>
          <div class="stat"><span class="stat-value" data-volume>${esc(volumeText(workout))}</span><span class="stat-label">volume</span></div>
        </div>
        <button class="btn btn-ghost btn-sm" data-a="session-note" type="button">${icon('note')} ${
          workout.notes?.trim() ? 'Edit session note' : 'Add session note'
        }</button>
      </section>

      <div class="entries"></div>

      <button class="btn btn-primary btn-block" data-a="add-exercise" type="button">${icon('plus')} Add exercise</button>

      <div class="row-actions">
        <button class="btn btn-ghost btn-danger-text" data-a="discard" type="button">${icon('trash')} Discard</button>
        <button class="btn btn-success" data-a="finish" type="button">${icon('check')} Finish workout</button>
      </div>
    </div>`);

  const entriesEl = wrap.querySelector('.entries');

  const refreshStats = () => {
    const w = current();
    if (!w) return;
    wrap.querySelector('[data-sets]').textContent = workingSets(w);
    wrap.querySelector('[data-volume]').textContent = volumeText(w);
  };

  const drawEntries = () => {
    const w = current();
    entriesEl.innerHTML = '';
    if (!w.entries.length) {
      entriesEl.appendChild(
        node(`<p class="muted pad center">No exercises yet — add your first one below.</p>`)
      );
      return;
    }
    w.entries.forEach((entry, i) => {
      entriesEl.appendChild(entryCard(entry, i, { id, mutate, current, drawEntries, refreshStats }));
    });
  };

  drawEntries();

  wrap.querySelector('.title-input').addEventListener(
    'input',
    debounce((ev) => mutate((w) => (w.name = ev.target.value)), 400)
  );

  wrap.querySelector('[data-a="session-note"]').addEventListener('click', async () => {
    const w = current();
    const val = await promptDialog({
      title: 'Session note',
      label: 'Anything your trainer should know — sleep, soreness, how it felt.',
      value: w.notes || '',
      multiline: true,
    });
    if (val != null) {
      await mutate((x) => (x.notes = val));
      rerender();
    }
  });

  wrap.querySelector('[data-a="add-exercise"]').addEventListener('click', () => {
    openExercisePicker({
      onPick: async (ids) => {
        if (!ids.length) return;
        await mutate((w) => ids.forEach((exId) => w.entries.push(newEntry(exId))));
        drawEntries();
      },
    });
  });

  wrap.querySelector('[data-a="discard"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Discard this workout?',
      message: 'Everything logged in this session will be deleted. This cannot be undone.',
      confirmText: 'Discard',
      danger: true,
    });
    if (ok) {
      await deleteWorkout(id);
      toast('Workout discarded');
      rerender();
    }
  });

  wrap.querySelector('[data-a="finish"]').addEventListener('click', async () => {
    const w = current();
    const logged = w.entries.some((e) => e.sets.some((s) => s.done || isSetFilled(s)));
    if (!logged) {
      const ok = await confirmDialog({
        title: 'Nothing logged yet',
        message: 'Finishing now saves an empty session. Discard it instead?',
        confirmText: 'Finish anyway',
      });
      if (!ok) return;
    }
    const done = await finishWorkout(id);
    toast('Workout saved', {
      action: { label: 'Share', onClick: () => shareWorkout(done) },
      duration: 5000,
    });
    location.hash = `#/history/${done.id}`;
  });

  return wrap;
}

function volumeText(w) {
  const unit = getSettings().unit;
  const kg = workoutVolume(w);
  if (!kg) return '—';
  return `${fmtNum(Math.round(unit === 'lb' ? kg / 0.45359237 : kg))} ${unit}`;
}

function shareWorkout(w) {
  openShareSheet({
    title: 'Share workout',
    text: formatWorkout(w),
    filename: `${w.day}-${(w.name || 'workout').toLowerCase().replace(/\s+/g, '-')}.txt`,
  });
}

// ---------------------------------------------------------------- entry card

function entryCard(entry, index, ctx) {
  const ex = exerciseById(entry.exerciseId);
  const track = ex?.track || 'wr';
  const unit = getSettings().unit;
  const last = lastPerformance(entry.exerciseId, ctx.id);

  const card = node(`
    <section class="card entry" data-entry="${esc(entry.id)}">
      <header class="entry-head">
        <div class="entry-title">
          <a class="entry-name" href="#/exercise/${esc(entry.exerciseId)}">${esc(exerciseName(entry.exerciseId))}</a>
          <span class="entry-sub">${esc(lastSummary(last, unit, track))}</span>
        </div>
        <div class="entry-tools">
          <button class="icon-btn" data-a="entry-note" title="Exercise note" aria-label="Exercise note">${icon('note')}</button>
          <button class="icon-btn" data-a="move-up" title="Move up" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>${icon('chevronDown', 'flip')}</button>
          <button class="icon-btn" data-a="remove-entry" title="Remove exercise" aria-label="Remove exercise">${icon('trash')}</button>
        </div>
      </header>
      ${entry.notes?.trim() ? `<p class="entry-note">${esc(entry.notes.trim())}</p>` : ''}
      <div class="set-table" data-track="${track}">
        ${setHeader(track, unit)}
        <div class="set-rows"></div>
      </div>
      <button class="btn btn-ghost btn-sm add-set" data-a="add-set" type="button">${icon('plus')} Add set</button>
    </section>`);

  const rowsEl = card.querySelector('.set-rows');

  const drawRows = () => {
    const e = findEntry(ctx.current(), entry.id);
    if (!e) return;
    rowsEl.innerHTML = '';
    e.sets.forEach((s, i) => rowsEl.appendChild(setRow(s, i, e, ctx, track, last)));
  };
  drawRows();

  card.querySelector('[data-a="add-set"]').addEventListener('click', async () => {
    const e = findEntry(ctx.current(), entry.id);
    const prev = [...e.sets].reverse().find((s) => isSetFilled(s));
    await ctx.mutate((w) => {
      const target = findEntry(w, entry.id);
      target.sets.push(
        newSet(prev ? { w: prev.w, r: prev.r, sec: prev.sec, dist: prev.dist, type: prev.type === 'wu' ? 'w' : prev.type } : {})
      );
    });
    drawRows();
    ctx.refreshStats();
  });

  card.querySelector('[data-a="entry-note"]').addEventListener('click', async () => {
    const e = findEntry(ctx.current(), entry.id);
    const val = await promptDialog({
      title: `Note — ${exerciseName(entry.exerciseId)}`,
      label: 'Cues, machine settings, seat height, how it felt.',
      value: e.notes || '',
      multiline: true,
    });
    if (val != null) {
      await ctx.mutate((w) => (findEntry(w, entry.id).notes = val));
      ctx.drawEntries();
    }
  });

  card.querySelector('[data-a="move-up"]').addEventListener('click', async () => {
    await ctx.mutate((w) => {
      const i = w.entries.findIndex((x) => x.id === entry.id);
      if (i > 0) [w.entries[i - 1], w.entries[i]] = [w.entries[i], w.entries[i - 1]];
    });
    ctx.drawEntries();
  });

  card.querySelector('[data-a="remove-entry"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Remove ${exerciseName(entry.exerciseId)}?`,
      message: 'Its sets in this session will be deleted.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await ctx.mutate((w) => (w.entries = w.entries.filter((x) => x.id !== entry.id)));
    ctx.drawEntries();
    ctx.refreshStats();
  });

  return card;
}

const findEntry = (w, entryId) => w?.entries.find((e) => e.id === entryId) || null;

function lastSummary(last, unit, track) {
  if (!last) return 'First time logging this';
  const done = last.entry.sets.filter((s) => s.done && s.type !== 'wu');
  if (!done.length) return `Last done ${relativeDay(last.day)}`;
  const parts = done.slice(0, 4).map((s) => {
    if (track === 'cardio') return [s.dist != null ? `${(s.dist / 1000).toFixed(1)}km` : null, s.sec ? fmtDuration(s.sec) : null].filter(Boolean).join(' ');
    if (track === 'dur') return fmtDuration(s.sec || 0);
    if (s.w != null && s.r != null) return `${fmtWeight(s.w, unit, false)}×${s.r}`;
    if (s.r != null) return plural(s.r, 'rep');
    return '—';
  });
  const more = done.length > parts.length ? ` +${done.length - parts.length}` : '';
  return `Last (${relativeDay(last.day)}): ${parts.join(', ')}${more}`;
}

function setHeader(track, unit) {
  const cols =
    track === 'cardio'
      ? ['Set', 'Prev', distanceLabel(unit), 'Time', '', '']
      : track === 'dur'
        ? ['Set', 'Prev', 'Time', 'RPE', '', '']
        : ['Set', 'Prev', unit, 'Reps', 'RPE', ''];
  return `<div class="set-head">${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
}

function setRow(s, i, entry, ctx, track, last) {
  const unit = getSettings().unit;
  const prevSet = last?.entry.sets.filter((x) => x.done)[i] || null;
  const prevText = prevSet
    ? track === 'cardio'
      ? [prevSet.dist != null ? `${(prevSet.dist / 1000).toFixed(1)}` : null, prevSet.sec ? fmtClock(prevSet.sec) : null].filter(Boolean).join('/')
      : track === 'dur'
        ? fmtClock(prevSet.sec || 0)
        : prevSet.w != null && prevSet.r != null
          ? `${fmtWeight(prevSet.w, unit, false)}×${prevSet.r}`
          : prevSet.r != null
            ? `${prevSet.r}`
            : '—'
    : '—';

  const t = SET_TYPES[s.type] || SET_TYPES.w;
  const badge = s.type === 'w' ? String(i + 1) : t.short;

  const numInput = (field, value, placeholder, mode = 'decimal') =>
    `<input class="input num" data-f="${field}" inputmode="${mode}" enterkeyhint="next" value="${value == null ? '' : esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(field)}">`;

  let fields = '';
  if (track === 'cardio') {
    fields =
      numInput('dist', fmtOptional(toDisplayDistance(s.dist, unit), 2), distanceLabel(unit)) +
      numInput('sec', s.sec == null ? '' : fmtClock(s.sec), 'mm:ss', 'text') +
      '<span class="spacer"></span>';
  } else if (track === 'dur') {
    fields =
      numInput('sec', s.sec == null ? '' : fmtClock(s.sec), 'mm:ss', 'text') +
      rpeSelect(s.rpe) +
      '<span class="spacer"></span>';
  } else {
    fields =
      numInput('w', fmtOptional(toDisplayWeight(s.w, unit), 2), track === 'br' ? '+0' : unit) +
      numInput('r', s.r, 'reps', 'numeric') +
      rpeSelect(s.rpe);
  }

  const row = node(`
    <div class="set-row ${s.done ? 'is-done' : ''}" data-set="${esc(s.id)}">
      <button class="set-type ${t.cls}" data-a="cycle-type" type="button" title="${esc(t.label)} — tap to change">${esc(badge)}</button>
      <span class="prev" title="Last session">${esc(prevText)}</span>
      ${fields}
      <div class="set-end">
        <button class="icon-btn tiny ${s.note?.trim() ? 'has-note' : ''}" data-a="set-note" type="button" aria-label="Set note" title="${esc(s.note?.trim() || 'Add a note to this set')}">${icon('note')}</button>
        <button class="set-done" data-a="toggle-done" type="button" aria-pressed="${s.done}" aria-label="Mark set complete">${icon('check')}</button>
        <button class="icon-btn tiny" data-a="remove-set" type="button" aria-label="Delete set">${icon('x')}</button>
      </div>
    </div>`);

  const persist = (field, raw) =>
    ctx.mutate((w) => {
      const target = findEntry(w, entry.id)?.sets.find((x) => x.id === s.id);
      if (!target) return;
      if (field === 'w') target.w = raw === '' ? null : toStoredWeight(parseFloat(raw), unit);
      else if (field === 'r') target.r = raw === '' ? null : Math.max(0, Math.round(parseFloat(raw) || 0));
      else if (field === 'sec') target.sec = raw === '' ? null : parseDuration(raw);
      else if (field === 'dist') target.dist = raw === '' ? null : toStoredDistance(parseFloat(raw), unit);
      else if (field === 'rpe') target.rpe = raw === '' ? null : parseFloat(raw);
    }).then(ctx.refreshStats);

  row.querySelectorAll('[data-f]').forEach((input) => {
    const field = input.dataset.f;
    const commit = () => persist(field, input.value.trim());
    input.addEventListener('change', commit);
    input.addEventListener('input', debounce(commit, 500));
    input.addEventListener('focus', () => input.select?.());
  });

  row.querySelector('[data-a="cycle-type"]').addEventListener('click', async () => {
    const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(s.type) + 1) % TYPE_CYCLE.length];
    await ctx.mutate((w) => {
      const target = findEntry(w, entry.id)?.sets.find((x) => x.id === s.id);
      if (target) target.type = next;
    });
    redrawSiblings(ctx, entry.id);
    ctx.refreshStats(); // warm-ups drop out of the working-set and volume totals
  });

  row.querySelector('[data-a="set-note"]').addEventListener('click', async () => {
    const val = await promptDialog({
      title: `Note — set ${i + 1}`,
      label: 'e.g. “left side lagging”, “belt on”, “last rep grinder”.',
      value: s.note || '',
      multiline: true,
    });
    if (val == null) return;
    await ctx.mutate((w) => {
      const target = findEntry(w, entry.id)?.sets.find((x) => x.id === s.id);
      if (target) target.note = val;
    });
    redrawSiblings(ctx, entry.id);
  });

  row.querySelector('[data-a="toggle-done"]').addEventListener('click', async () => {
    primeAudio();
    const nowDone = !s.done;
    await ctx.mutate((w) => {
      const target = findEntry(w, entry.id)?.sets.find((x) => x.id === s.id);
      if (target) target.done = nowDone;
    });
    row.classList.toggle('is-done', nowDone);
    row.querySelector('[data-a="toggle-done"]').setAttribute('aria-pressed', String(nowDone));
    ctx.refreshStats();
    const settings = getSettings();
    if (nowDone && settings.restAuto && settings.restDefault > 0) {
      startRest(settings.restDefault, exerciseName(entry.exerciseId));
    }
  });

  row.querySelector('[data-a="remove-set"]').addEventListener('click', async () => {
    await ctx.mutate((w) => {
      const target = findEntry(w, entry.id);
      if (target) target.sets = target.sets.filter((x) => x.id !== s.id);
    });
    redrawSiblings(ctx, entry.id);
    ctx.refreshStats();
  });

  return row;
}

function redrawSiblings(ctx, entryId) {
  // Cheap and correct: rebuild just this exercise's rows.
  const card = document.querySelector(`.entry[data-entry="${CSS.escape(entryId)}"]`);
  if (!card) return ctx.drawEntries();
  const e = findEntry(ctx.current(), entryId);
  if (!e) return ctx.drawEntries();
  const track = exerciseById(e.exerciseId)?.track || 'wr';
  const last = lastPerformance(e.exerciseId, ctx.id);
  const rowsEl = card.querySelector('.set-rows');
  rowsEl.innerHTML = '';
  e.sets.forEach((s, i) => rowsEl.appendChild(setRow(s, i, e, ctx, track, last)));
}

function rpeSelect(value) {
  const opts = ['<option value="">RPE</option>']
    .concat(RPE_VALUES.map((v) => `<option value="${v}" ${value === v ? 'selected' : ''}>${v}</option>`))
    .join('');
  return `<select class="input rpe" data-f="rpe" aria-label="RPE">${opts}</select>`;
}

function fmtOptional(v, digits) {
  if (v == null) return '';
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(r);
}
