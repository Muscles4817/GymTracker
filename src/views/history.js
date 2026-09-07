// Past sessions: browse, read, share, reuse.

import {
  completedWorkouts, workoutById, workingSets, workoutVolume, workoutDuration,
  workoutReps, deleteWorkout, saveWorkout, activeWorkout, exerciseById,
  exerciseName, getSettings, saveRoutine, routineFromWorkout,
} from '../store.js';
import { node, esc, icon, emptyState, confirmDialog, promptDialog, toast, on } from '../ui.js';
import {
  fmtDateFull, fmtDuration, fmtNum, fmtWeight, fmtDistance, relativeDay,
  parseDayKey, plural, SET_TYPES,
} from '../util.js';
import { openShareSheet, formatWorkout, formatWorkoutRange } from '../share.js';

export function historyView() {
  const workouts = completedWorkouts();
  const el = node('<div class="view stack"></div>');

  if (!workouts.length) {
    el.innerHTML = emptyState({
      iconName: 'clock',
      title: 'No history yet',
      message: 'Finished workouts land here — searchable, shareable, and feeding the charts.',
      actionLabel: 'Start a workout',
      actionHref: '#/log',
    });
    return { el };
  }

  const groups = new Map();
  for (const w of workouts) {
    const key = parseDayKey(w.day).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }

  el.appendChild(
    node(`
    <section class="card">
      <header class="card-head"><h3>Share a summary</h3></header>
      <div class="chip-row">
        <button class="btn btn-ghost btn-sm" data-a="share-range" data-days="7" type="button">${icon('whatsapp')} Last 7 days</button>
        <button class="btn btn-ghost btn-sm" data-a="share-range" data-days="30" type="button">${icon('whatsapp')} Last 30 days</button>
      </div>
    </section>`)
  );

  for (const [month, list] of groups) {
    const vol = list.reduce((n, w) => n + workoutVolume(w), 0);
    el.appendChild(
      node(`
      <section class="card">
        <header class="card-head">
          <h3>${esc(month)}</h3>
          <span class="muted small">${plural(list.length, 'session')} · ${esc(volumeLabel(vol))}</span>
        </header>
        <ul class="history-list">
          ${list
            .map(
              (w) => `
            <li><a class="history-row" href="#/history/${esc(w.id)}">
              <span class="history-main">
                <span class="history-name">${esc(w.name)}</span>
                <span class="history-meta">${esc(relativeDay(w.day))} · ${plural(workingSets(w), 'set')} · ${esc(
                  volumeLabel(workoutVolume(w))
                )}${workoutDuration(w) ? ` · ${esc(fmtDuration(workoutDuration(w)))}` : ''}</span>
              </span>
              ${icon('chevron', 'muted-icon')}
            </a></li>`
            )
            .join('')}
        </ul>
      </section>`)
    );
  }

  on(el, 'click', '[data-a="share-range"]', (ev, btn) => {
    const days = Number(btn.dataset.days);
    const cutoff = new Date(Date.now() - days * 86400000);
    const inRange = workouts.filter((w) => parseDayKey(w.day) >= cutoff);
    if (!inRange.length) return toast('No sessions in that window');
    openShareSheet({
      title: `Share last ${days} days`,
      text: formatWorkoutRange(inRange, `last ${days} days`),
      filename: `training-summary-${days}d.txt`,
    });
  });

  return { el };
}

function volumeLabel(kg) {
  const unit = getSettings().unit;
  if (!kg) return 'no load';
  return `${fmtNum(Math.round(unit === 'lb' ? kg / 0.45359237 : kg))} ${unit}`;
}

// ---------------------------------------------------------------- detail

export function workoutDetailView(id) {
  const w = workoutById(id);
  const el = node('<div class="view stack"></div>');
  if (!w) {
    el.innerHTML = emptyState({ title: 'Workout not found', message: 'It may have been deleted.' });
    return { el };
  }
  const unit = getSettings().unit;

  el.appendChild(
    node(`
    <section class="card">
      <header class="card-head">
        <div>
          <h2 class="detail-title">${esc(w.name)}</h2>
          <p class="muted small">${esc(fmtDateFull(w.day))}</p>
        </div>
        <button class="icon-btn" data-a="rename" aria-label="Rename workout">${icon('edit')}</button>
      </header>
      <div class="stat-row">
        <div class="stat"><span class="stat-value">${workingSets(w)}</span><span class="stat-label">sets</span></div>
        <div class="stat"><span class="stat-value">${fmtNum(workoutReps(w))}</span><span class="stat-label">reps</span></div>
        <div class="stat"><span class="stat-value">${esc(volumeLabel(workoutVolume(w)))}</span><span class="stat-label">volume</span></div>
        ${
          workoutDuration(w)
            ? `<div class="stat"><span class="stat-value">${esc(fmtDuration(workoutDuration(w)))}</span><span class="stat-label">time</span></div>`
            : ''
        }
      </div>
      ${w.notes?.trim() ? `<p class="entry-note">📝 ${esc(w.notes.trim())}</p>` : ''}
      <div class="row-actions">
        <button class="btn btn-whatsapp btn-block" data-a="share" type="button">${icon('whatsapp')} Send to trainer</button>
      </div>
    </section>`)
  );

  for (const e of w.entries) {
    const ex = exerciseById(e.exerciseId);
    const track = ex?.track || 'wr';
    const done = e.sets.filter((s) => s.done);
    if (!done.length) continue;
    el.appendChild(
      node(`
      <section class="card entry">
        <header class="entry-head">
          <div class="entry-title">
            <a class="entry-name" href="#/exercise/${esc(e.exerciseId)}">${esc(exerciseName(e.exerciseId))}</a>
            <span class="entry-sub">${plural(done.length, 'set')}${
              ex ? ` · ${esc(ex.equipment)}` : ''
            }</span>
          </div>
        </header>
        ${e.notes?.trim() ? `<p class="entry-note">${esc(e.notes.trim())}</p>` : ''}
        <ol class="done-sets">
          ${done.map((s) => `<li>${describeSet(s, track, unit)}</li>`).join('')}
        </ol>
      </section>`)
    );
  }

  el.appendChild(
    node(`
    <section class="card">
      <div class="stack-sm">
        <button class="btn btn-ghost btn-block" data-a="routine" type="button">${icon('repeat')} Save as routine</button>
        <button class="btn btn-ghost btn-block" data-a="edit" type="button">${icon('edit')} Reopen for editing</button>
        <button class="btn btn-ghost btn-block btn-danger-text" data-a="delete" type="button">${icon('trash')} Delete workout</button>
      </div>
    </section>`)
  );

  el.querySelector('[data-a="share"]').addEventListener('click', () =>
    openShareSheet({
      title: 'Share workout',
      text: formatWorkout(w),
      filename: `${w.day}-${(w.name || 'workout').toLowerCase().replace(/\s+/g, '-')}.txt`,
    })
  );

  el.querySelector('[data-a="rename"]').addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Rename workout', value: w.name });
    if (name == null) return;
    await saveWorkout({ ...w, name: name.trim() || w.name });
    location.reload();
  });

  el.querySelector('[data-a="routine"]').addEventListener('click', async () => {
    const name = await promptDialog({
      title: 'Save as routine',
      label: 'Reuse this session as a one-tap template.',
      value: w.name,
      confirmText: 'Save routine',
    });
    if (name == null) return;
    await saveRoutine(routineFromWorkout(w, name.trim() || w.name));
    toast('Routine saved');
  });

  el.querySelector('[data-a="edit"]').addEventListener('click', async () => {
    if (activeWorkout()) {
      return toast('Finish or discard the workout in progress first', { kind: 'warn' });
    }
    const ok = await confirmDialog({
      title: 'Reopen this workout?',
      message: 'It becomes the session in progress again so you can fix or add sets.',
      confirmText: 'Reopen',
    });
    if (!ok) return;
    await saveWorkout({ ...w, status: 'active', endedAt: null });
    location.hash = '#/log';
  });

  el.querySelector('[data-a="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this workout?',
      message: 'It is removed from your history and your charts. This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteWorkout(id);
    toast('Workout deleted');
    location.hash = '#/history';
  });

  return { el };
}

function describeSet(s, track, unit) {
  const bits = [];
  if (track === 'cardio') {
    if (s.dist != null) bits.push(fmtDistance(s.dist, unit));
    if (s.sec != null) bits.push(fmtDuration(s.sec));
  } else if (track === 'dur') {
    if (s.sec != null) bits.push(fmtDuration(s.sec));
    if (s.w != null) bits.push(`+${fmtWeight(s.w, unit)}`);
  } else {
    const wt = s.w != null ? fmtWeight(s.w, unit) : track === 'br' ? 'bodyweight' : null;
    if (wt) bits.push(wt);
    if (s.r != null) bits.push(`× ${s.r}`);
  }
  let out = `<span class="set-main">${esc(bits.join(' ') || '—')}</span>`;
  if (s.rpe != null) out += `<span class="tag">RPE ${s.rpe}</span>`;
  if (s.type && s.type !== 'w') {
    out += `<span class="tag ${SET_TYPES[s.type].cls}">${esc(SET_TYPES[s.type].label)}</span>`;
  }
  if (s.note?.trim()) out += `<span class="set-note">${esc(s.note.trim())}</span>`;
  return out;
}
