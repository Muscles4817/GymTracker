// Routines: reusable workout templates so logging is tapping, not typing.

import {
  allRoutines, routineById, saveRoutine, deleteRoutine, startFromRoutine,
  activeWorkout, exerciseName, exerciseById, getSettings,
} from '../store.js';
import { openExercisePicker } from './picker.js';
import { ROUTINE_TEMPLATES, TEMPLATE_GROUPS, templateById, routineFromTemplate } from '../routine-templates.js';
import { node, esc, icon, emptyState, confirmDialog, promptDialog, sheet, toast, on } from '../ui.js';
import { uid, toDisplayWeight, toStoredWeight, plural, debounce } from '../util.js';

export function routinesView() {
  const el = node('<div class="view stack"></div>');
  const routines = allRoutines();

  el.appendChild(
    node(`
    <section class="card hero">
      <h2>Routines</h2>
      <p class="muted">Templates that pre-fill your sets. Start one and you only fill in what actually happened.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" data-a="new" type="button">${icon('plus')} New routine</button>
        <button class="btn btn-ghost" data-a="template" type="button">${icon('list')} Add from template</button>
      </div>
    </section>`)
  );

  if (!routines.length) {
    el.appendChild(
      node(
        `<section class="card">${emptyState({
          iconName: 'repeat',
          title: 'No routines yet',
          message: 'Add one from a template, create your own, or finish a workout and save it as a routine in one tap.',
        })}</section>`
      )
    );
  } else {
    el.appendChild(
      node(`
      <section class="card">
        <ul class="history-list">
          ${routines
            .map(
              (r) => `
            <li class="routine-row">
              <a class="history-row" href="#/routines/${esc(r.id)}">
                <span class="history-main">
                  <span class="history-name">${esc(r.name)}</span>
                  <span class="history-meta">${plural(r.items.length, 'exercise')}${
                    r.items.length ? ` · ${esc(r.items.slice(0, 3).map((i) => exerciseName(i.exerciseId)).join(', '))}${r.items.length > 3 ? '…' : ''}` : ''
                  }</span>
                </span>
                ${icon('chevron', 'muted-icon')}
              </a>
              <button class="btn btn-primary btn-sm" data-a="start" data-id="${esc(r.id)}" type="button">${icon('play')} Start</button>
            </li>`
            )
            .join('')}
        </ul>
      </section>`)
    );
  }

  el.querySelector('[data-a="template"]').addEventListener('click', () => openTemplatePicker());

  el.querySelector('[data-a="new"]').addEventListener('click', async () => {
    const name = await promptDialog({ title: 'New routine', label: 'Name', placeholder: 'e.g. Push Day A', confirmText: 'Create' });
    if (!name?.trim()) return;
    const r = await saveRoutine({ name: name.trim(), notes: '', items: [] });
    location.hash = `#/routines/${r.id}`;
  });

  on(el, 'click', '[data-a="start"]', async (ev, btn) => {
    ev.preventDefault();
    if (activeWorkout()) return toast('Finish or discard the workout in progress first', { kind: 'warn' });
    await startFromRoutine(btn.dataset.id);
    location.hash = '#/log';
  });

  return { el };
}

// ---------------------------------------------------------------- templates

/** Ensure a copied template does not collide with a routine the user already has. */
function uniqueName(name) {
  const taken = new Set(allRoutines().map((r) => r.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

async function addTemplate(tpl) {
  const draft = routineFromTemplate(tpl);
  return saveRoutine({ ...draft, name: uniqueName(draft.name) });
}

function openTemplatePicker() {
  const groups = Object.entries(TEMPLATE_GROUPS).map(([key, g]) => {
    const list = ROUTINE_TEMPLATES.filter((t) => t.group === key);
    return `
      <section class="template-group">
        <header class="template-group-head">
          <div>
            <h3>${esc(g.name)}</h3>
            <p class="muted">${esc(g.note)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" data-a="add-group" data-group="${esc(key)}" type="button">
            Add all ${list.length}
          </button>
        </header>
        <ul class="history-list">
          ${list
            .map(
              (t) => `
            <li class="routine-row template-row">
              <span class="history-main">
                <span class="history-name">${esc(t.name)}</span>
                <span class="history-meta">${plural(t.items.length, 'exercise')} · ${esc(
                  t.items.slice(0, 3).map((i) => exerciseName(i.exerciseId)).join(', ')
                )}${t.items.length > 3 ? '…' : ''}</span>
              </span>
              <button class="btn btn-primary btn-sm" data-a="add-one" data-id="${esc(t.id)}" type="button">
                ${icon('plus')} Add
              </button>
            </li>`
            )
            .join('')}
        </ul>
      </section>`;
  });

  sheet({
    title: 'Routine templates',
    wide: true,
    bodyHtml: `<div class="stack">${groups.join('')}</div>`,
    onMount(body, close) {
      on(body, 'click', '[data-a="add-one"]', async (ev, btn) => {
        const tpl = templateById(btn.dataset.id);
        if (!tpl) return;
        const r = await addTemplate(tpl);
        close();
        toast(`Added “${r.name}”`);
        location.hash = `#/routines/${r.id}`;
      });

      on(body, 'click', '[data-a="add-group"]', async (ev, btn) => {
        const key = btn.dataset.group;
        const list = ROUTINE_TEMPLATES.filter((t) => t.group === key);
        for (const tpl of list) await addTemplate(tpl);
        close();
        toast(`Added ${plural(list.length, 'routine')}`);
        // Already on #/routines, so the hash never changes — re-render by hand.
        window.dispatchEvent(new Event('hashchange'));
      });
    },
  });
}

// ---------------------------------------------------------------- editor

export function routineEditorView(id) {
  const el = node('<div class="view stack"></div>');
  const routine = routineById(id);
  if (!routine) {
    el.innerHTML = emptyState({ title: 'Routine not found' });
    return { el };
  }
  const unit = getSettings().unit;

  el.appendChild(
    node(`
    <section class="card">
      <input class="title-input" value="${esc(routine.name)}" aria-label="Routine name">
      <textarea class="input" data-f="notes" rows="2" placeholder="Notes for this routine (optional)">${esc(routine.notes || '')}</textarea>
      <button class="btn btn-primary btn-block" data-a="start" type="button">${icon('play')} Start this routine</button>
    </section>`)
  );

  const listCard = node(`
    <section class="card">
      <header class="card-head"><h3>Exercises</h3></header>
      <div class="routine-items"></div>
      <button class="btn btn-ghost btn-block" data-a="add" type="button">${icon('plus')} Add exercise</button>
    </section>`);
  el.appendChild(listCard);

  el.appendChild(
    node(`
    <section class="card">
      <button class="btn btn-ghost btn-block btn-danger-text" data-a="delete" type="button">${icon('trash')} Delete routine</button>
    </section>`)
  );

  const itemsEl = listCard.querySelector('.routine-items');
  const current = () => routineById(id);

  const persist = (fn) => {
    const r = { ...current(), items: current().items.map((i) => ({ ...i })) };
    fn(r);
    return saveRoutine(r);
  };

  function drawItems() {
    const r = current();
    itemsEl.innerHTML = '';
    if (!r.items.length) {
      itemsEl.appendChild(node('<p class="muted pad center">No exercises yet.</p>'));
      return;
    }
    r.items.forEach((item, idx) => {
      const ex = exerciseById(item.exerciseId);
      const timed = ex?.track === 'dur' || ex?.track === 'cardio';
      const row = node(`
        <div class="routine-item" data-item="${esc(item.id)}">
          <div class="routine-item-head">
            <span class="routine-item-name">${esc(exerciseName(item.exerciseId))}</span>
            <div class="entry-tools">
              <button class="icon-btn" data-a="up" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">${icon('chevronDown', 'flip')}</button>
              <button class="icon-btn" data-a="remove" aria-label="Remove">${icon('trash')}</button>
            </div>
          </div>
          <div class="routine-targets">
            <label><span>Sets</span><input class="input num" data-f="targetSets" inputmode="numeric" value="${item.targetSets ?? ''}" placeholder="3"></label>
            ${
              timed
                ? '<label><span>Target</span><input class="input num" data-f="targetReps" inputmode="numeric" value="' +
                  esc(item.targetReps ?? '') +
                  '" placeholder="—"></label>'
                : `<label><span>Reps</span><input class="input num" data-f="targetReps" inputmode="numeric" value="${esc(
                    item.targetReps ?? ''
                  )}" placeholder="8"></label>`
            }
            <label><span>${esc(unit)}</span><input class="input num" data-f="targetWeight" inputmode="decimal" value="${
              item.targetWeight == null ? '' : esc(round2(toDisplayWeight(item.targetWeight, unit)))
            }" placeholder="—"></label>
          </div>
        </div>`);

      row.querySelectorAll('[data-f]').forEach((input) => {
        const field = input.dataset.f;
        const commit = () =>
          persist((r2) => {
            const it = r2.items.find((x) => x.id === item.id);
            if (!it) return;
            const raw = input.value.trim();
            if (field === 'targetWeight') it.targetWeight = raw === '' ? null : toStoredWeight(parseFloat(raw), unit);
            else it[field] = raw === '' ? null : Math.max(0, Math.round(parseFloat(raw) || 0));
          });
        input.addEventListener('change', commit);
        input.addEventListener('input', debounce(commit, 500));
      });

      row.querySelector('[data-a="up"]').addEventListener('click', async () => {
        await persist((r2) => {
          const i = r2.items.findIndex((x) => x.id === item.id);
          if (i > 0) [r2.items[i - 1], r2.items[i]] = [r2.items[i], r2.items[i - 1]];
        });
        drawItems();
      });

      row.querySelector('[data-a="remove"]').addEventListener('click', async () => {
        await persist((r2) => (r2.items = r2.items.filter((x) => x.id !== item.id)));
        drawItems();
      });

      itemsEl.appendChild(row);
    });
  }

  el.querySelector('.title-input').addEventListener(
    'input',
    debounce((ev) => persist((r) => (r.name = ev.target.value)), 400)
  );
  el.querySelector('[data-f="notes"]').addEventListener(
    'input',
    debounce((ev) => persist((r) => (r.notes = ev.target.value)), 400)
  );

  listCard.querySelector('[data-a="add"]').addEventListener('click', () => {
    openExercisePicker({
      title: 'Add to routine',
      onPick: async (ids) => {
        await persist((r) =>
          ids.forEach((exId) =>
            r.items.push({ id: uid(), exerciseId: exId, targetSets: 3, targetReps: null, targetWeight: null, notes: '' })
          )
        );
        drawItems();
      },
    });
  });

  el.querySelector('[data-a="start"]').addEventListener('click', async () => {
    if (activeWorkout()) return toast('Finish or discard the workout in progress first', { kind: 'warn' });
    await startFromRoutine(id);
    location.hash = '#/log';
  });

  el.querySelector('[data-a="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Delete “${current().name}”?`,
      message: 'Workouts already logged from it are untouched.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteRoutine(id);
    toast('Routine deleted');
    location.hash = '#/routines';
  });

  drawItems();
  return { el };
}

const round2 = (v) => (v == null ? '' : String(Math.round(v * 100) / 100));
