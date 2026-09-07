// The exercise picker — shared by the workout logger and the routine editor.

import { MUSCLES, EQUIPMENT } from '../exercises.js';
import { activeExercises, createCustomExercise, lastPerformance, getSettings } from '../store.js';
import { sheet, esc, icon, toast } from '../ui.js';
import { matchesQuery, fmtWeight, relativeDay, debounce } from '../util.js';

function summaryOf(ex) {
  const bits = [EQUIPMENT[ex.equipment] || ex.equipment, MUSCLES[ex.primary] || ex.primary];
  return bits.join(' · ');
}

function lastLine(exId) {
  const last = lastPerformance(exId);
  if (!last) return '';
  const unit = getSettings().unit;
  const best = last.entry.sets
    .filter((s) => s.done && s.type !== 'wu' && s.w != null)
    .reduce((a, s) => (a == null || s.w > a.w ? s : a), null);
  if (best) return `Last: ${fmtWeight(best.w, unit)} × ${best.r ?? '?'} · ${relativeDay(last.day)}`;
  const done = last.entry.sets.filter((s) => s.done).length;
  return `Last: ${done} set${done === 1 ? '' : 's'} · ${relativeDay(last.day)}`;
}

/**
 * @param {(ids: string[]) => void} onPick  receives one or many ids
 */
export function openExercisePicker({ onPick, multi = true, title = 'Add exercise', excludeIds = [] }) {
  const selected = new Set();
  let query = '';
  let muscle = '';
  let equipment = '';

  const muscleChips = Object.entries(MUSCLES)
    .map(([k, v]) => `<button class="chip" data-f="muscle" data-v="${k}" type="button">${esc(v)}</button>`)
    .join('');
  const equipChips = Object.entries(EQUIPMENT)
    .map(([k, v]) => `<button class="chip" data-f="equipment" data-v="${k}" type="button">${esc(v)}</button>`)
    .join('');

  const handle = sheet({
    title,
    wide: true,
    bodyHtml: `
      <div class="picker">
        <div class="search-row">
          ${icon('search', 'search-icon')}
          <input class="input search-input" type="search" placeholder="Search 250+ exercises & machines" autocomplete="off">
        </div>
        <details class="filters">
          <summary>Filter by muscle or equipment</summary>
          <div class="chip-group"><span class="chip-label">Muscle</span>${muscleChips}</div>
          <div class="chip-group"><span class="chip-label">Equipment</span>${equipChips}</div>
        </details>
        <div class="picker-list" role="listbox"></div>
        <div class="picker-foot">
          <button class="btn btn-ghost" data-a="custom" type="button">${icon('plus')} Create custom exercise</button>
          ${multi ? '<button class="btn btn-primary" data-a="add" type="button" disabled>Add</button>' : ''}
        </div>
      </div>`,
    onMount(body, close) {
      const list = body.querySelector('.picker-list');
      const addBtn = body.querySelector('[data-a="add"]');
      const search = body.querySelector('.search-input');

      const render = () => {
        const items = activeExercises().filter((ex) => {
          if (excludeIds.includes(ex.id)) return false;
          if (muscle && ex.primary !== muscle && !ex.secondary.includes(muscle)) return false;
          if (equipment && ex.equipment !== equipment) return false;
          return matchesQuery(`${ex.name} ${EQUIPMENT[ex.equipment]} ${MUSCLES[ex.primary]}`, query);
        });

        if (!items.length) {
          list.innerHTML = `<p class="muted pad">No match. Try a different word, or create a custom exercise.</p>`;
          return;
        }
        list.innerHTML = items
          .slice(0, 400)
          .map((ex) => {
            const last = lastLine(ex.id);
            return `
            <button class="picker-row ${selected.has(ex.id) ? 'is-selected' : ''}" data-id="${esc(ex.id)}" type="button" role="option" aria-selected="${selected.has(ex.id)}">
              <span class="picker-main">
                <span class="picker-name">${esc(ex.name)}${ex.custom ? ' <span class="tag">custom</span>' : ''}</span>
                <span class="picker-sub">${esc(summaryOf(ex))}${last ? ` · ${esc(last)}` : ''}</span>
              </span>
              <span class="picker-check">${icon('check')}</span>
            </button>`;
          })
          .join('');
      };

      const refreshAdd = () => {
        if (!addBtn) return;
        addBtn.disabled = selected.size === 0;
        addBtn.textContent = selected.size ? `Add ${selected.size}` : 'Add';
      };

      search.addEventListener(
        'input',
        debounce((ev) => {
          query = ev.target.value;
          render();
        }, 120)
      );

      body.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const kind = chip.dataset.f;
          const val = chip.dataset.v;
          const cur = kind === 'muscle' ? muscle : equipment;
          const next = cur === val ? '' : val;
          if (kind === 'muscle') muscle = next;
          else equipment = next;
          body
            .querySelectorAll(`.chip[data-f="${kind}"]`)
            .forEach((c) => c.classList.toggle('is-on', c.dataset.v === next));
          render();
        });
      });

      list.addEventListener('click', (ev) => {
        const row = ev.target.closest('.picker-row');
        if (!row) return;
        const id = row.dataset.id;
        if (!multi) {
          close();
          onPick([id]);
          return;
        }
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        row.classList.toggle('is-selected', selected.has(id));
        row.setAttribute('aria-selected', String(selected.has(id)));
        refreshAdd();
      });

      addBtn?.addEventListener('click', () => {
        close();
        onPick([...selected]);
      });

      body.querySelector('[data-a="custom"]').addEventListener('click', () => {
        openCustomExerciseForm((ex) => {
          if (multi) {
            selected.add(ex.id);
            render();
            refreshAdd();
          } else {
            close();
            onPick([ex.id]);
          }
        });
      });

      render();
      setTimeout(() => search.focus(), 60);
    },
  });

  return handle;
}

export function openCustomExerciseForm(onCreated, existing = null) {
  const muscleOpts = Object.entries(MUSCLES)
    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`)
    .join('');
  const equipOpts = Object.entries(EQUIPMENT)
    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`)
    .join('');

  sheet({
    title: existing ? 'Edit exercise' : 'Create custom exercise',
    bodyHtml: `
      <form class="form" id="custom-ex-form">
        <label class="field">
          <span class="field-label">Name</span>
          <input class="input" name="name" required placeholder="e.g. Hammer Strength Iso Row" value="${esc(existing?.name || '')}">
        </label>
        <label class="field">
          <span class="field-label">Equipment</span>
          <select class="input" name="equipment">${equipOpts}</select>
        </label>
        <label class="field">
          <span class="field-label">Primary muscle</span>
          <select class="input" name="primary">${muscleOpts}</select>
        </label>
        <label class="field">
          <span class="field-label">How is it measured?</span>
          <select class="input" name="track">
            <option value="wr">Weight × reps</option>
            <option value="br">Bodyweight reps (weight optional)</option>
            <option value="dur">Timed hold</option>
            <option value="cardio">Distance + time</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn btn-primary" type="submit">${existing ? 'Save' : 'Create'}</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form');
      if (existing) {
        form.equipment.value = existing.equipment;
        form.primary.value = existing.primary;
        form.track.value = existing.track;
      }
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const name = form.name.value.trim();
        if (!name) return;
        const ex = await createCustomExercise({
          name,
          equipment: form.equipment.value,
          primary: form.primary.value,
          secondary: [],
          mech: 'iso',
          track: form.track.value,
        });
        close();
        toast(`“${ex.name}” added to your library`);
        onCreated?.(ex);
      });
      setTimeout(() => form.name.focus(), 60);
    },
  });
}
