// The exercise & machine library, plus the per-exercise progress screen.

import { MUSCLES, EQUIPMENT } from '../exercises.js';
import {
  activeExercises, exerciseById, exerciseSeries, lastPerformance, getSettings,
  deleteExercise,
} from '../store.js';
import { node, esc, icon, emptyState, toast, confirmDialog, on } from '../ui.js';
import {
  matchesQuery, debounce, fmtWeight, fmtNum, fmtDuration, fmtDistance,
  relativeDay, fmtDate, fmtDateFull, plural,
} from '../util.js';
import { chartCard, lineSeries, verticalBars } from '../charts.js';
import { openCustomExerciseForm } from './picker.js';
import { openShareSheet, formatExerciseProgress, shareChart } from '../share.js';

export function libraryView() {
  const el = node(`
    <div class="view stack">
      <section class="card">
        <div class="search-row">
          ${icon('search', 'search-icon')}
          <input class="input search-input" type="search" placeholder="Search exercises & machines" autocomplete="off">
        </div>
        <details class="filters">
          <summary>Filter</summary>
          <div class="chip-group"><span class="chip-label">Muscle</span>${Object.entries(MUSCLES)
            .map(([k, v]) => `<button class="chip" data-f="muscle" data-v="${k}" type="button">${esc(v)}</button>`)
            .join('')}</div>
          <div class="chip-group"><span class="chip-label">Equipment</span>${Object.entries(EQUIPMENT)
            .map(([k, v]) => `<button class="chip" data-f="equipment" data-v="${k}" type="button">${esc(v)}</button>`)
            .join('')}</div>
          <label class="check-row"><input type="checkbox" data-f="logged"> Only exercises I've logged</label>
        </details>
        <p class="muted small" data-count></p>
      </section>
      <section class="card"><div class="lib-list"></div></section>
      <button class="btn btn-ghost btn-block" data-a="custom" type="button">${icon('plus')} Create custom exercise</button>
    </div>`);

  let query = '';
  let muscle = '';
  let equipment = '';
  let onlyLogged = false;

  const list = el.querySelector('.lib-list');
  const count = el.querySelector('[data-count]');

  const render = () => {
    const items = activeExercises().filter((ex) => {
      if (muscle && ex.primary !== muscle && !ex.secondary.includes(muscle)) return false;
      if (equipment && ex.equipment !== equipment) return false;
      if (onlyLogged && !lastPerformance(ex.id)) return false;
      return matchesQuery(`${ex.name} ${EQUIPMENT[ex.equipment]} ${MUSCLES[ex.primary]}`, query);
    });
    count.textContent = `${items.length} of ${activeExercises().length} exercises`;
    if (!items.length) {
      list.innerHTML = `<p class="muted pad">Nothing matches. Try a different word or clear the filters.</p>`;
      return;
    }
    list.innerHTML = items
      .map((ex) => {
        const last = lastPerformance(ex.id);
        return `
        <a class="lib-row" href="#/exercise/${esc(ex.id)}">
          <span class="picker-main">
            <span class="picker-name">${esc(ex.name)}${ex.custom ? ' <span class="tag">custom</span>' : ''}</span>
            <span class="picker-sub">${esc(EQUIPMENT[ex.equipment])} · ${esc(MUSCLES[ex.primary])}${
              last ? ` · last ${esc(relativeDay(last.day))}` : ''
            }</span>
          </span>
          ${icon('chevron', 'muted-icon')}
        </a>`;
      })
      .join('');
  };

  el.querySelector('.search-input').addEventListener(
    'input',
    debounce((ev) => {
      query = ev.target.value;
      render();
    }, 120)
  );

  on(el, 'click', '.chip', (ev, chip) => {
    const kind = chip.dataset.f;
    const cur = kind === 'muscle' ? muscle : equipment;
    const next = cur === chip.dataset.v ? '' : chip.dataset.v;
    if (kind === 'muscle') muscle = next;
    else equipment = next;
    el.querySelectorAll(`.chip[data-f="${kind}"]`).forEach((c) =>
      c.classList.toggle('is-on', c.dataset.v === next)
    );
    render();
  });

  el.querySelector('[data-f="logged"]').addEventListener('change', (ev) => {
    onlyLogged = ev.target.checked;
    render();
  });

  el.querySelector('[data-a="custom"]').addEventListener('click', () => {
    openCustomExerciseForm(() => render());
  });

  render();
  return { el };
}

// ---------------------------------------------------------------- exercise detail

export function exerciseDetailView(id) {
  const ex = exerciseById(id);
  const el = node('<div class="view stack"></div>');
  if (!ex) {
    el.innerHTML = emptyState({ title: 'Exercise not found' });
    return { el };
  }

  const unit = getSettings().unit;
  const series = exerciseSeries(id);
  const withWeight = series.filter((s) => s.topWeight != null);
  const best = withWeight.length
    ? withWeight.reduce((a, s) => (s.topWeight > a.topWeight ? s : a))
    : null;
  const last = series[series.length - 1] || null;

  el.appendChild(
    node(`
    <section class="card">
      <header class="card-head">
        <div>
          <h2 class="detail-title">${esc(ex.name)}</h2>
          <p class="muted small">${esc(EQUIPMENT[ex.equipment])} · ${esc(MUSCLES[ex.primary])}${
            ex.secondary.length ? ` · also ${esc(ex.secondary.map((m) => MUSCLES[m]).join(', '))}` : ''
          }</p>
        </div>
        ${ex.custom ? `<button class="icon-btn" data-a="edit-ex" aria-label="Edit exercise">${icon('edit')}</button>` : ''}
      </header>
      <div class="stat-row">
        <div class="stat"><span class="stat-value">${series.length}</span><span class="stat-label">sessions</span></div>
        <div class="stat"><span class="stat-value">${
          best ? esc(fmtWeight(best.topWeight, unit, false)) : '—'
        }</span><span class="stat-label">heaviest ${esc(unit)}</span></div>
        <div class="stat"><span class="stat-value">${
          last ? esc(relativeDay(last.day)) : '—'
        }</span><span class="stat-label">last done</span></div>
      </div>
      ${
        best
          ? `<p class="muted small">Heaviest set: ${esc(fmtWeight(best.topWeight, unit))} × ${
              best.topReps ?? '?'
            } on ${esc(fmtDateFull(best.day))}</p>`
          : ''
      }
      <button class="btn btn-whatsapp btn-block" data-a="share" type="button">${icon('whatsapp')} Share progress</button>
    </section>`)
  );

  if (!series.length) {
    el.appendChild(
      node(
        `<section class="card">${emptyState({
          iconName: 'chart',
          title: 'No data for this exercise yet',
          message: 'Log it in a workout and the progress charts appear here.',
          actionLabel: 'Go to logging',
          actionHref: '#/log',
        })}</section>`
      )
    );
    wireCommon(el, ex, id);
    return { el };
  }

  const labelOf = (s) => fmtDate(s.day, { day: 'numeric', month: 'short' });

  // Two measures, two charts — never a second y-axis on one plot.
  if (ex.track === 'wr' || ex.track === 'br') {
    if (withWeight.length) {
      el.appendChild(
        chartCard({
          title: 'Heaviest set per session',
          subtitle: `Top working-set weight, in ${unit}`,
          height: 210,
          render: lineSeries({
            data: withWeight.map((s) => ({
              label: labelOf(s),
              value: Number(fmtWeight(s.topWeight, unit, false)),
              tip: `<strong>${esc(fmtDate(s.day))}</strong><br>${esc(
                fmtWeight(s.topWeight, unit)
              )} × ${s.topReps ?? '?'} · ${plural(s.sets, 'set')}`,
            })),
            fmtValue: (v) => `${v} ${unit}`,
            fmtY: (v) => String(v),
          }),
          table: () => ({
            head: ['Date', `Top weight (${unit})`, 'Reps', 'Sets'],
            rows: withWeight.map((s) => [
              fmtDateFull(s.day),
              fmtWeight(s.topWeight, unit, false),
              s.topReps ?? '',
              s.sets,
            ]),
          }),
          note: 'Warm-up sets are excluded.',
        })
      );
    }

    const volSeries = series.filter((s) => s.volume > 0);
    if (volSeries.length > 1) {
      el.appendChild(
        chartCard({
          title: 'Volume per session',
          subtitle: `Weight × reps across working sets, in ${unit}`,
          height: 200,
          render: verticalBars({
            data: volSeries.map((s) => ({
              label: labelOf(s),
              value: Math.round(unit === 'lb' ? s.volume / 0.45359237 : s.volume),
              tip: `<strong>${esc(fmtDate(s.day))}</strong><br>${fmtNum(
                Math.round(unit === 'lb' ? s.volume / 0.45359237 : s.volume)
              )} ${unit} · ${plural(s.sets, 'set')} · ${plural(s.reps, 'rep')}`,
            })),
            fmtValue: (v) => `${fmtNum(v)} ${unit}`,
            fmtY: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
            everyNthLabel: Math.max(1, Math.ceil(volSeries.length / 7)),
          }),
          table: () => ({
            head: ['Date', `Volume (${unit})`, 'Sets', 'Reps'],
            rows: volSeries.map((s) => [
              fmtDateFull(s.day),
              fmtNum(Math.round(unit === 'lb' ? s.volume / 0.45359237 : s.volume)),
              s.sets,
              s.reps,
            ]),
          }),
        })
      );
    }
  } else if (ex.track === 'cardio') {
    const distSeries = series.filter((s) => s.distance);
    if (distSeries.length) {
      el.appendChild(
        chartCard({
          title: 'Distance per session',
          subtitle: `In ${unit === 'lb' ? 'miles' : 'kilometres'}`,
          height: 200,
          render: lineSeries({
            data: distSeries.map((s) => ({
              label: labelOf(s),
              value: Number((unit === 'lb' ? s.distance / 1609.344 : s.distance / 1000).toFixed(2)),
              tip: `<strong>${esc(fmtDate(s.day))}</strong><br>${esc(fmtDistance(s.distance, unit))}${
                s.seconds ? ` in ${esc(fmtDuration(s.seconds))}` : ''
              }`,
            })),
            fmtValue: (v) => `${v} ${unit === 'lb' ? 'mi' : 'km'}`,
            fmtY: (v) => String(v),
            zeroBased: true,
          }),
          table: () => ({
            head: ['Date', 'Distance', 'Time'],
            rows: distSeries.map((s) => [fmtDateFull(s.day), fmtDistance(s.distance, unit), fmtDuration(s.seconds || 0)]),
          }),
        })
      );
    }
  } else if (ex.track === 'dur') {
    const durSeries = series.filter((s) => s.seconds);
    if (durSeries.length) {
      el.appendChild(
        chartCard({
          title: 'Total time held per session',
          height: 200,
          render: lineSeries({
            data: durSeries.map((s) => ({
              label: labelOf(s),
              value: Math.round(s.seconds),
              tip: `<strong>${esc(fmtDate(s.day))}</strong><br>${esc(fmtDuration(s.seconds))} across ${plural(s.sets, 'set')}`,
            })),
            fmtValue: (v) => fmtDuration(v),
            fmtY: (v) => fmtDuration(v),
            zeroBased: true,
          }),
          table: () => ({
            head: ['Date', 'Total time', 'Sets'],
            rows: durSeries.map((s) => [fmtDateFull(s.day), fmtDuration(s.seconds), s.sets]),
          }),
        })
      );
    }
  }

  el.appendChild(
    node(`
    <section class="card">
      <header class="card-head"><h3>Session log</h3></header>
      <ul class="mini-list">
        ${[...series]
          .reverse()
          .slice(0, 40)
          .map(
            (s) => `<li><a href="#/history/${esc(s.workoutId)}">
              <span class="mini-name">${esc(fmtDateFull(s.day))}</span>
              <span class="mini-meta">${
                s.topWeight != null ? `top ${esc(fmtWeight(s.topWeight, unit))} × ${s.topReps ?? '?'} · ` : ''
              }${plural(s.sets, 'set')}${s.reps ? ` · ${plural(s.reps, 'rep')}` : ''}</span>
            </a></li>`
          )
          .join('')}
      </ul>
    </section>`)
  );

  wireCommon(el, ex, id);
  return { el };
}

function wireCommon(el, ex, id) {
  // Appended here so it shows whether or not the exercise has any data yet.
  el.appendChild(
    node(`
    <section class="card">
      <button class="btn btn-ghost btn-block btn-danger-text" data-a="remove-ex" type="button">${icon('trash')} ${
        ex.custom ? 'Delete this exercise' : 'Hide from my library'
      }</button>
    </section>`)
  );

  el.querySelector('[data-a="remove-ex"]').addEventListener('click', async () => {
    const logged = !!lastPerformance(id);
    const ok = await confirmDialog({
      title: ex.custom && !logged ? `Delete ${ex.name}?` : `Hide ${ex.name}?`,
      message: logged
        ? 'It disappears from search and from the exercise picker. Workouts that already use it keep it, so your history and charts are untouched.'
        : 'It disappears from search and from the exercise picker.',
      confirmText: ex.custom && !logged ? 'Delete' : 'Hide',
      danger: true,
    });
    if (!ok) return;
    const result = await deleteExercise(id);
    toast(result === 'deleted' ? 'Deleted' : 'Hidden from your library');
    location.hash = '#/library';
  });

  el.querySelector('[data-a="share"]')?.addEventListener('click', () => {
    const chart = el.querySelector('.chart-card .chart');
    openShareSheet({
      title: `Share ${ex.name} progress`,
      text: formatExerciseProgress(id),
      filename: `${id}-progress.txt`,
    });
    if (chart) {
      toast('Tip: use “Share chart image” below the chart to send the graph too', { duration: 4000 });
    }
  });

  el.querySelector('[data-a="edit-ex"]')?.addEventListener('click', () => {
    openCustomExerciseForm(() => location.reload(), ex);
  });

  // A per-chart image share, since a trainer reads a curve faster than a table.
  el.querySelectorAll('.chart-card').forEach((card) => {
    const btn = node(
      `<button class="btn btn-ghost btn-sm chart-share" type="button">${icon('share')} Share chart image</button>`
    );
    btn.addEventListener('click', () => {
      const svg = card.querySelector('svg.chart');
      if (svg) shareChart(svg, { title: ex.name, filename: `${id}-chart.png`, text: `${ex.name} progress` });
    });
    card.appendChild(btn);
  });
}
