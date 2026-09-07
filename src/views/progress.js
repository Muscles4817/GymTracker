// The overview dashboard. One filter row scopes every chart below it.

import {
  overallStats, weeklyTotals, muscleBreakdown, activityByDay, completedWorkouts,
  getSettings, exerciseSeries, activeExercises,
} from '../store.js';
import { MUSCLES } from '../exercises.js';
import { node, esc, icon, emptyState, on } from '../ui.js';
import { fmtNum, fmtDate, fmtDateFull, parseDayKey, addDays, plural } from '../util.js';
import {
  chartCard, verticalBars, horizontalBars, horizontalBarsHeight,
  calendarHeatmap, calendarHeatmapHeight,
} from '../charts.js';
import { openShareSheet, formatWorkoutRange, shareChart } from '../share.js';

const RANGES = [
  { key: 4, label: '4 weeks' },
  { key: 12, label: '12 weeks' },
  { key: 26, label: '6 months' },
  { key: 52, label: '1 year' },
];

let activeRange = 12;

export function progressView() {
  const el = node('<div class="view stack"></div>');

  if (!completedWorkouts().length) {
    el.innerHTML = emptyState({
      iconName: 'chart',
      title: 'Charts appear after your first session',
      message: 'Volume, training days and muscle balance all build from your logged sets.',
      actionLabel: 'Start a workout',
      actionHref: '#/log',
    });
    return { el };
  }

  const stats = overallStats();
  const unit = getSettings().unit;
  const toUnit = (kg) => Math.round(unit === 'lb' ? kg / 0.45359237 : kg);

  el.appendChild(
    node(`
    <section class="card">
      <div class="stat-row">
        <div class="stat"><span class="stat-value">${stats.workouts}</span><span class="stat-label">workouts</span></div>
        <div class="stat"><span class="stat-value">${stats.last30Count}</span><span class="stat-label">last 30 days</span></div>
        <div class="stat"><span class="stat-value">${esc(compact(toUnit(stats.totalVolume)))}</span><span class="stat-label">total ${esc(unit)} lifted</span></div>
        <div class="stat"><span class="stat-value">${stats.streakWeeks}</span><span class="stat-label">week streak</span></div>
      </div>
    </section>`)
  );

  // One filter row above everything it scopes.
  const filterRow = node(`
    <div class="filter-row" role="group" aria-label="Time range">
      ${RANGES.map(
        (r) =>
          `<button class="chip ${r.key === activeRange ? 'is-on' : ''}" data-range="${r.key}" type="button">${esc(
            r.label
          )}</button>`
      ).join('')}
      <button class="btn btn-ghost btn-sm push-right" data-a="share-summary" type="button">${icon('whatsapp')} Share summary</button>
    </div>`);
  el.appendChild(filterRow);

  const charts = node('<div class="stack"></div>');
  el.appendChild(charts);

  function drawCharts() {
    charts.innerHTML = '';
    const weeks = activeRange;
    const days = weeks * 7;

    // ---- volume per week
    const totals = weeklyTotals(weeks);
    charts.appendChild(
      withChartShare(
        chartCard({
          title: 'Training volume per week',
          subtitle: `Weight × reps across all working sets, in ${unit}`,
          height: 210,
          render: verticalBars({
            data: totals.map((t) => ({
              label: fmtDate(t.week, { day: 'numeric', month: 'short' }),
              value: toUnit(t.volume),
              tip: `<strong>Week of ${esc(fmtDateFull(t.week))}</strong><br>${fmtNum(
                toUnit(t.volume)
              )} ${unit} · ${plural(t.sets, 'set')} · ${plural(t.workouts, 'session')}`,
            })),
            fmtValue: (v) => `${compact(v)} ${unit}`,
            fmtY: (v) => compact(v),
            everyNthLabel: Math.max(1, Math.ceil(totals.length / 6)),
          }),
          table: () => ({
            head: ['Week of', `Volume (${unit})`, 'Sets', 'Reps', 'Sessions'],
            rows: totals.map((t) => [fmtDateFull(t.week), fmtNum(toUnit(t.volume)), t.sets, t.reps, t.workouts]),
          }),
          note: 'Weeks with no training show as zero rather than disappearing.',
        }),
        'weekly-volume.png',
        'Weekly training volume'
      )
    );

    // ---- working sets per week (separate plot, never a second axis)
    charts.appendChild(
      chartCard({
        title: 'Working sets per week',
        subtitle: 'Warm-ups excluded',
        height: 190,
        render: verticalBars({
          data: totals.map((t) => ({
            label: fmtDate(t.week, { day: 'numeric', month: 'short' }),
            value: t.sets,
            tip: `<strong>Week of ${esc(fmtDateFull(t.week))}</strong><br>${plural(t.sets, 'set')} · ${plural(t.reps, 'rep')}`,
          })),
          fmtValue: (v) => plural(v, 'set'),
          fmtY: (v) => String(v),
          integerY: true,
          everyNthLabel: Math.max(1, Math.ceil(totals.length / 6)),
        }),
        table: () => ({
          head: ['Week of', 'Sets', 'Reps'],
          rows: totals.map((t) => [fmtDateFull(t.week), t.sets, t.reps]),
        }),
      })
    );

    // ---- training days heatmap
    const activity = activityByDay(days);
    charts.appendChild(
      chartCard({
        title: 'Training days',
        subtitle: 'Darker means more working sets that day',
        height: calendarHeatmapHeight(),
        render: calendarHeatmap({
          valueByDay: activity,
          weeks,
          fmtValue: (v) => plural(v, 'set'),
        }),
        table: () => ({
          head: ['Date', 'Working sets'],
          rows: [...activity.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([d, v]) => [fmtDateFull(d), v]),
        }),
      })
    );

    // ---- muscle balance
    const muscles = muscleBreakdown(days).slice(0, 12);
    charts.appendChild(
      chartCard({
        title: 'Sets by muscle group',
        subtitle: `Last ${days} days. Secondary movers count half a set.`,
        height: horizontalBarsHeight(muscles.length),
        render: horizontalBars({
          data: muscles.map((m) => ({ label: MUSCLES[m.muscle] || m.muscle, value: m.sets })),
          fmtValue: (v) => fmtNum(v, 1),
        }),
        table: () => ({
          head: ['Muscle group', 'Sets'],
          rows: muscles.map((m) => [MUSCLES[m.muscle] || m.muscle, fmtNum(m.sets, 1)]),
        }),
      })
    );

    // ---- top movers: the exercises with the most sessions in range
    const tracked = trackedExercises(days).slice(0, 6);
    if (tracked.length) {
      charts.appendChild(
        node(`
        <section class="card">
          <header class="card-head"><h3>Most-trained exercises</h3><a class="link" href="#/library">Library</a></header>
          <ul class="mini-list">
            ${tracked
              .map(
                (t) => `<li><a href="#/exercise/${esc(t.id)}">
                  <span class="mini-name">${esc(t.name)}</span>
                  <span class="mini-meta">${plural(t.sessions, 'session')} · ${plural(t.sets, 'set')}</span>
                </a></li>`
              )
              .join('')}
          </ul>
        </section>`)
      );
    }
  }

  on(filterRow, 'click', '[data-range]', (ev, btn) => {
    activeRange = Number(btn.dataset.range);
    filterRow.querySelectorAll('[data-range]').forEach((b) =>
      b.classList.toggle('is-on', Number(b.dataset.range) === activeRange)
    );
    drawCharts();
  });

  filterRow.querySelector('[data-a="share-summary"]').addEventListener('click', () => {
    const cutoff = addDays(new Date(), -activeRange * 7);
    const inRange = completedWorkouts().filter((w) => parseDayKey(w.day) >= cutoff);
    openShareSheet({
      title: 'Share training summary',
      text: formatWorkoutRange(inRange, RANGES.find((r) => r.key === activeRange).label),
      filename: `training-summary-${activeRange}w.txt`,
    });
  });

  drawCharts();
  return { el };
}

function withChartShare(card, filename, title) {
  const btn = node(
    `<button class="btn btn-ghost btn-sm chart-share" type="button">${icon('share')} Share chart image</button>`
  );
  btn.addEventListener('click', () => {
    const svg = card.querySelector('svg.chart');
    if (svg) shareChart(svg, { filename, title });
  });
  card.appendChild(btn);
  return card;
}

function trackedExercises(days) {
  const cutoff = addDays(new Date(), -days);
  const out = [];
  for (const ex of activeExercises()) {
    const inRange = exerciseSeries(ex.id).filter((s) => parseDayKey(s.day) >= cutoff);
    if (!inRange.length) continue;
    out.push({
      id: ex.id,
      name: ex.name,
      sessions: inRange.length,
      sets: inRange.reduce((n, s) => n + s.sets, 0),
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions || b.sets - a.sets);
}

function compact(n) {
  if (n == null || isNaN(n)) return '–';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return fmtNum(n);
}
