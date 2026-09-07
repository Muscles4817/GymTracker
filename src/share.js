// Turning a workout into something a trainer can actually read in WhatsApp.

import {
  fmtDateFull, fmtWeight, fmtDuration, fmtDistance, fmtNum, distanceLabel, plural, SET_TYPES,
} from './util.js';
import {
  exerciseById, exerciseName, workoutVolume, workingSets, workoutDuration,
  workoutReps, exerciseSeries, getSettings,
} from './store.js';
import { sheet, toast, esc, icon } from './ui.js';

// WhatsApp renders *bold* and _italic_ from plain text, so the message stays
// readable even where that markup isn't interpreted.

function setLine(s, ex, unit, i) {
  const bits = [];
  if (ex?.track === 'cardio') {
    if (s.dist != null) bits.push(fmtDistance(s.dist, unit));
    if (s.sec != null) bits.push(fmtDuration(s.sec));
    if (s.w != null) bits.push(fmtWeight(s.w, unit));
  } else if (ex?.track === 'dur') {
    if (s.sec != null) bits.push(fmtDuration(s.sec));
    if (s.w != null) bits.push(`+${fmtWeight(s.w, unit)}`);
  } else {
    const wt = s.w != null ? fmtWeight(s.w, unit) : ex?.track === 'br' ? 'bodyweight' : null;
    if (wt && s.r != null) bits.push(`${wt} × ${s.r}`);
    else if (wt) bits.push(wt);
    else if (s.r != null) bits.push(plural(s.r, 'rep'));
  }
  let line = `  ${i}. ${bits.join(' · ') || '—'}`;
  if (s.rpe != null) line += `  RPE ${s.rpe}`;
  if (s.type && s.type !== 'w') line += `  (${SET_TYPES[s.type].label.toLowerCase()})`;
  if (s.note?.trim()) line += ` — ${s.note.trim()}`;
  return line;
}

export function formatWorkout(w, { includeFooter = true } = {}) {
  const unit = getSettings().unit;
  const lines = [];
  lines.push(`*${w.name || 'Workout'}* — ${fmtDateFull(w.day)}`);

  const meta = [];
  const dur = workoutDuration(w);
  if (dur) meta.push(fmtDuration(dur));
  meta.push(plural(workingSets(w), 'set'));
  const reps = workoutReps(w);
  if (reps) meta.push(plural(reps, 'rep'));
  const vol = workoutVolume(w);
  if (vol > 0) meta.push(`${fmtNum(Math.round(unit === 'lb' ? vol / 0.45359237 : vol))} ${unit} volume`);
  lines.push(meta.join(' · '));

  for (const e of w.entries) {
    const done = e.sets.filter((s) => s.done);
    if (!done.length) continue;
    const ex = exerciseById(e.exerciseId);
    lines.push('');
    lines.push(`*${exerciseName(e.exerciseId)}*`);
    done.forEach((s, i) => lines.push(setLine(s, ex, unit, i + 1)));
    if (e.notes?.trim()) lines.push(`  📝 ${e.notes.trim()}`);
  }

  if (w.notes?.trim()) {
    lines.push('');
    lines.push(`📝 *Session note:* ${w.notes.trim()}`);
  }
  if (includeFooter) {
    lines.push('');
    lines.push('— logged with GymTracker');
  }
  return lines.join('\n');
}

export function formatWorkoutRange(workouts, label) {
  const unit = getSettings().unit;
  const vol = workouts.reduce((n, w) => n + workoutVolume(w), 0);
  const sets = workouts.reduce((n, w) => n + workingSets(w), 0);
  const lines = [
    `*Training summary — ${label}*`,
    `${plural(workouts.length, 'session')} · ${plural(sets, 'set')} · ${fmtNum(
      Math.round(unit === 'lb' ? vol / 0.45359237 : vol)
    )} ${unit} total volume`,
    '',
  ];
  for (const w of [...workouts].reverse()) {
    lines.push(`• ${fmtDateFull(w.day)} — *${w.name}* (${plural(workingSets(w), 'set')})`);
    const top = w.entries
      .map((e) => {
        const best = e.sets
          .filter((s) => s.done && s.type !== 'wu' && s.w != null)
          .reduce((a, s) => (a == null || s.w > a.w ? s : a), null);
        return best ? `${exerciseName(e.exerciseId)} ${fmtWeight(best.w, unit)}×${best.r ?? '?'}` : null;
      })
      .filter(Boolean);
    if (top.length) lines.push(`   ${top.join(', ')}`);
  }
  lines.push('');
  lines.push('— logged with GymTracker');
  return lines.join('\n');
}

export function formatExerciseProgress(exerciseId) {
  const unit = getSettings().unit;
  const series = exerciseSeries(exerciseId);
  const lines = [`*${exerciseName(exerciseId)} — progress*`];
  if (!series.length) {
    lines.push('No sessions logged yet.');
    return lines.join('\n');
  }
  const withWeight = series.filter((s) => s.topWeight != null);
  if (withWeight.length) {
    const best = withWeight.reduce((a, s) => (s.topWeight > a.topWeight ? s : a));
    lines.push(`Best set: ${fmtWeight(best.topWeight, unit)} × ${best.topReps ?? '?'} on ${fmtDateFull(best.day)}`);
  }
  lines.push(`${plural(series.length, 'session')} logged`);
  lines.push('');
  for (const s of series.slice(-12)) {
    const bits = [];
    if (s.topWeight != null) bits.push(`top ${fmtWeight(s.topWeight, unit)} × ${s.topReps ?? '?'}`);
    if (s.distance) bits.push(fmtDistance(s.distance, unit));
    if (s.seconds) bits.push(fmtDuration(s.seconds));
    bits.push(plural(s.sets, 'set'));
    lines.push(`• ${fmtDateFull(s.day)} — ${bits.join(' · ')}`);
  }
  lines.push('');
  lines.push('— logged with GymTracker');
  return lines.join('\n');
}

// ---------------------------------------------------------------- CSV

export function workoutsToCsv(workouts) {
  const unit = getSettings().unit;
  const head = [
    'date', 'workout', 'exercise', 'equipment', 'primary_muscle',
    'set_number', 'set_type', `weight_${unit}`, 'reps', 'rpe',
    'duration_s', `distance_${distanceLabel(unit)}`, 'set_notes', 'workout_notes',
  ];
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [head.join(',')];
  for (const w of [...workouts].reverse()) {
    for (const e of w.entries) {
      const ex = exerciseById(e.exerciseId);
      e.sets.forEach((s, i) => {
        if (!s.done) return;
        rows.push(
          [
            w.day, w.name, exerciseName(e.exerciseId), ex?.equipment ?? '', ex?.primary ?? '',
            i + 1, SET_TYPES[s.type]?.label ?? s.type,
            s.w == null ? '' : (unit === 'lb' ? s.w / 0.45359237 : s.w).toFixed(2),
            s.r ?? '', s.rpe ?? '', s.sec ?? '',
            s.dist == null ? '' : (unit === 'lb' ? s.dist / 1609.344 : s.dist / 1000).toFixed(3),
            [s.note, e.notes].filter((x) => x && x.trim()).join(' | '), w.notes ?? '',
          ].map(q).join(',')
        );
      });
    }
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------- delivery

export const canWebShare = () => typeof navigator !== 'undefined' && !!navigator.share;

export function whatsappUrl(text, phone = '') {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The share sheet: preview the exact text, then pick a delivery route. */
export function openShareSheet({ title = 'Share', text, filename = 'workout.txt' }) {
  const settings = getSettings();
  const trainer = settings.trainerName?.trim();
  return sheet({
    title,
    bodyHtml: `
      <p class="muted small">This is exactly what gets sent. Edit it here if you want.</p>
      <textarea class="input share-preview" rows="12" spellcheck="false">${esc(text)}</textarea>
      <div class="share-actions">
        <button class="btn btn-whatsapp" data-a="whatsapp" type="button">${icon('whatsapp')} WhatsApp${
          trainer ? ` — ${esc(trainer)}` : ''
        }</button>
        ${canWebShare() ? `<button class="btn btn-primary" data-a="share" type="button">${icon('share')} Share via…</button>` : ''}
        <button class="btn btn-ghost" data-a="copy" type="button">${icon('copy')} Copy text</button>
        <button class="btn btn-ghost" data-a="file" type="button">${icon('download')} Save as .txt</button>
      </div>`,
    onMount(body, close) {
      const ta = body.querySelector('.share-preview');
      const current = () => ta.value;

      body.querySelector('[data-a="whatsapp"]').addEventListener('click', () => {
        window.open(whatsappUrl(current(), settings.trainerPhone), '_blank', 'noopener');
        close();
      });

      body.querySelector('[data-a="share"]')?.addEventListener('click', async () => {
        try {
          await navigator.share({ title, text: current() });
          close();
        } catch (err) {
          if (err?.name !== 'AbortError') toast('Sharing was not available', { kind: 'warn' });
        }
      });

      body.querySelector('[data-a="copy"]').addEventListener('click', async () => {
        toast((await copyText(current())) ? 'Copied to clipboard' : 'Could not copy — select and copy manually');
      });

      body.querySelector('[data-a="file"]').addEventListener('click', () => {
        downloadBlob(new Blob([current()], { type: 'text/plain;charset=utf-8' }), filename);
        close();
      });
    },
  });
}

// ---------------------------------------------------------------- chart image

const EXPORT_VARS = [
  '--surface-1', '--text-primary', '--text-secondary', '--muted',
  '--grid', '--axis', '--series-1',
  '--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4', '--heat-5',
];

/**
 * Rasterise a chart for sending as a picture. The SVG's styles live in the
 * stylesheet, so they are inlined against the current theme before export.
 */
export async function chartToPngBlob(svgEl, { scale = 2, padding = 16 } = {}) {
  const cs = getComputedStyle(document.documentElement);
  const vars = EXPORT_VARS.map((v) => `${v}:${cs.getPropertyValue(v).trim()}`).join(';');

  const clone = svgEl.cloneNode(true);
  clone.querySelectorAll('.hit').forEach((n) => n.remove());
  const w = svgEl.viewBox.baseVal.width || svgEl.clientWidth;
  const h = svgEl.viewBox.baseVal.height || svgEl.clientHeight;

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    svg{${vars};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    .grid{stroke:var(--grid);stroke-width:1}
    .axis{stroke:var(--axis);stroke-width:1}
    .ax{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
    .direct{fill:var(--text-primary);font-size:12px;font-weight:600}
    .bar{fill:var(--series-1)}
    .line{fill:none;stroke:var(--series-1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    .pt{fill:var(--series-1);stroke:var(--surface-1);stroke-width:2}
    .cell{stroke:none}
    .heat-0{fill:var(--heat-0)}.heat-1{fill:var(--heat-1)}.heat-2{fill:var(--heat-2)}
    .heat-3{fill:var(--heat-3)}.heat-4{fill:var(--heat-4)}.heat-5{fill:var(--heat-5)}`;
  clone.insertBefore(style, clone.firstChild);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const svgText = new XMLSerializer().serializeToString(clone);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Could not render the chart image'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = (w + padding * 2) * scale;
  canvas.height = (h + padding * 2) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = cs.getPropertyValue('--surface-1').trim() || '#ffffff';
  ctx.fillRect(0, 0, w + padding * 2, h + padding * 2);
  ctx.drawImage(img, padding, padding, w, h);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function shareChart(svgEl, { title = 'Progress', filename = 'progress.png', text = '' } = {}) {
  let blob;
  try {
    blob = await chartToPngBlob(svgEl);
  } catch {
    toast('Could not render the chart image', { kind: 'warn' });
    return;
  }
  if (!blob) return;
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  downloadBlob(blob, filename);
  toast('Chart saved — attach it in WhatsApp');
}
