// Ready-made routine templates. These are blueprints only — adding one copies it
// into the user's own routines, after which it is theirs to edit or delete.
// Weights are the starting (lower) end of each prescribed range, in kg;
// the full range travels in the item note so it shows up while logging.

import { uid } from './util.js';

const I = (exerciseId, targetSets, targetReps, targetWeight = null, notes = '') => ({
  exerciseId, targetSets, targetReps, targetWeight, notes,
});

export const TEMPLATE_GROUPS = {
  gym: { name: 'Gym Programme', note: 'Personal training programme — 16 weeks, strength & mass. Coach: Ryan Sanderson.' },
  home: { name: 'Home Workout', note: 'Full-body template for a rack, barbell, pulley, pull-up/dip station and adjustable dumbbells.' },
};

export const ROUTINE_TEMPLATES = [
  // ------------------------------------------------ gym programme
  {
    id: 'gym-1-chest',
    group: 'gym',
    name: 'Workout 1 – Chest',
    notes: 'Chest + arms finisher. 4 sets of 10–15 throughout.',
    items: [
      I('barbell-bench-press', 4, 10, 40, '10–15 reps · work up 40–80kg'),
      I('chest-press-machine', 4, 10, 30, '10–15 reps · plate-loaded · 30–80kg'),
      I('pec-deck-machine', 4, 10, 15, '10–15 reps · 15–35kg'),
      I('decline-chest-fly-machine', 4, 15, 20, '15 reps · multi-flight machine · 20–45kg'),
      I('incline-chest-fly-machine', 4, 10, 5, '10–15 reps · incline pec fly machine · 5–10kg'),
      I('machine-preacher-curl', 4, 10, 15, '10–15 reps · 15–25kg'),
      I('cable-triceps-pushdown', 4, 10, 30, '10–15 reps · pushdown machine · 30–50kg'),
    ],
  },
  {
    id: 'gym-2-shoulders',
    group: 'gym',
    name: 'Workout 2 – Shoulders',
    notes: 'Shoulders + arms finisher. 4 sets of 10–15 throughout.',
    items: [
      I('dumbbell-shoulder-press', 4, 10, 8, '10–15 reps · seated on bench · 8–16kg'),
      I('machine-shoulder-press', 4, 10, 20, '10–15 reps · plate-loaded · 20–40kg'),
      I('barbell-upright-row', 4, 10, 15, '10–15 reps · barbell or EZ bar · 15–25kg'),
      I('dumbbell-shrug', 4, 15, 20, '15 reps · 20–30kg'),
      I('machine-lateral-raise', 4, 10, 10, '10–15 reps · multi-flight machine · 10–20kg'),
      I('cable-curl', 4, 10, 10, '10–15 reps · cable + straight bar · 10–20kg'),
      I('cable-triceps-pushdown', 4, 10, 10, '10–15 reps · cable + straight bar · 10–25kg'),
    ],
  },
  {
    id: 'gym-3-legs',
    group: 'gym',
    name: 'Workout 3 – Leg Day',
    notes: 'Legs. 4 sets of 10–15 throughout.',
    items: [
      I('belt-squat', 4, 10, 20, '10–15 reps · plate-loaded belt squat · 20–50kg'),
      I('leg-press', 4, 10, 100, '10–15 reps · 100–200kg'),
      I('single-leg-extension', 4, 10, 5, '10–15 reps · single plate · 5–12.5kg'),
      I('single-leg-curl', 4, 10, 5, '10–15 reps · single plate · 5–10kg'),
      I('standing-calf-raise', 4, 10, 27.5, '10–15 reps · 27.5–60kg'),
      I('hip-abduction-machine', 4, 10, 20, '10–15 reps · 20–55kg'),
    ],
  },
  {
    id: 'gym-4-pull',
    group: 'gym',
    name: 'Workout 4 – Pull',
    notes: 'Back + biceps finisher. 4 sets of 10–15 throughout.',
    items: [
      I('seated-cable-row', 4, 10, 20, '10–15 reps · multifunctional station · 20–45kg'),
      I('close-grip-lat-pulldown', 4, 10, 25, '10–15 reps · close grip · 25–45kg'),
      I('machine-pulldown', 4, 10, 30, '10–15 reps · plate-loaded front pulldown · 30–50kg'),
      I('iso-lateral-pulldown', 4, 10, 20, '10–15 reps · plate-loaded · 20–50kg'),
      I('iso-lateral-row', 4, 10, 30, '10–15 reps · plate-loaded · 30–50kg'),
      I('straight-arm-pulldown', 4, 10, 10, '10–15 reps · cable + rope · 10–20kg'),
      I('ez-bar-curl', 4, 15, 10, '15 reps · barbell or EZ bar · 10–15kg'),
    ],
  },
  {
    id: 'gym-5-brick',
    group: 'gym',
    name: 'Workout 5 – 1 Hour Brick',
    notes:
      'Two-machine system: pick any two and alternate continuously in timed intervals, minimal rest. ' +
      'Other pairings: treadmill + cross trainer, stepper + cross trainer, spin bike + stepper. ' +
      'Quick transitions, pace early, effort 7–9/10. Progress by beating last week’s distance or calories.',
    items: [
      I('stationary-bike', 4, null, null, 'Spin bike · ~7.5 min block, alternate with the treadmill'),
      I('treadmill-run', 4, null, null, '~7.5 min block, alternate with the spin bike'),
    ],
  },

  // ------------------------------------------------ home workout
  {
    id: 'home-a',
    group: 'home',
    name: 'Home A – Full Body / Strength',
    notes: 'Leave 1–3 reps in reserve on working sets. Rest 2–3 min on the heavy compounds, 60–90 sec on the rest.',
    items: [
      I('barbell-back-squat', 3, 6, null, '6–10 reps · rest 2–3 min'),
      I('barbell-bench-press', 3, 6, null, '6–10 reps · rest 2–3 min · no bench? use weighted dips or a floor press'),
      I('seated-cable-row', 3, 8, null, '8–12 reps · pulley system · rest 90 sec'),
      I('romanian-deadlift', 3, 8, null, '8–12 reps · rest 2 min'),
      I('dumbbell-shoulder-press', 3, 8, null, '8–12 reps · rest 90 sec'),
      I('cable-triceps-pushdown', 3, 10, null, '2–3 sets · 10–15 reps · rest 60–90 sec'),
      I('ab-wheel-rollout', 3, 6, null, '2–3 sets · 6–12 reps · rest 60–90 sec'),
    ],
  },
  {
    id: 'home-b',
    group: 'home',
    name: 'Home B – Full Body / Hypertrophy',
    notes: 'Leave 1–3 reps in reserve on working sets. Rest 2 min on the compounds, 60–90 sec on the rest.',
    items: [
      I('romanian-deadlift', 3, 8, null, '8–12 reps · rest 2 min'),
      I('bulgarian-split-squat', 3, 8, null, '8–12 reps per leg · rest 90 sec'),
      I('pull-up', 3, 5, null, '5–10 reps · assisted if needed · rest 2 min'),
      I('cable-chest-press', 3, 8, null, '8–15 reps · or floor press · rest 90 sec'),
      I('cable-lateral-raise', 3, 12, null, '12–20 reps · rest 60 sec'),
      I('cable-curl', 3, 10, null, '10–15 reps · rest 60 sec'),
      I('ab-wheel-rollout', 3, 6, null, '6–15 reps · rest 60 sec'),
    ],
  },
  {
    id: 'home-c',
    group: 'home',
    name: 'Home C – Strength & Conditioning',
    notes: 'Leave 1–3 reps in reserve on working sets. Rest 2–3 min on the heavy compounds, 60–90 sec on the rest.',
    items: [
      I('barbell-front-squat', 3, 6, null, '6–10 reps · rest 2–3 min'),
      I('pull-up', 3, 5, null, '5–10 reps · rest 2 min'),
      I('romanian-deadlift', 3, 8, null, '8–12 reps · barbell · rest 2 min'),
      I('chest-dip', 3, 6, null, '6–12 reps · dip handles · rest 90 sec'),
      I('single-arm-cable-row', 3, 10, null, '10–12 reps per side · rest 90 sec'),
      I('dumbbell-curl', 3, 10, null, '2–3 sets · 10–15 reps · rest 60 sec'),
      I('overhead-cable-triceps-extension', 3, 10, null, '2–3 sets · 10–15 reps · rest 60 sec'),
      I('ab-wheel-rollout', 3, 8, null, '2–3 sets · 8–15 reps · rest 60 sec'),
    ],
  },
];

export const templateById = (id) => ROUTINE_TEMPLATES.find((t) => t.id === id) || null;

/** Blueprint -> a routine record ready for saveRoutine(). */
export function routineFromTemplate(tpl) {
  return {
    name: tpl.name,
    notes: tpl.notes || '',
    items: tpl.items.map((it) => ({ ...it, id: uid() })),
  };
}
