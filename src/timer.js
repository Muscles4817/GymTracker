// Rest timer. Counts against a target timestamp rather than decrementing a
// counter, so locking the phone mid-rest doesn't drift or stall it.

import { getSettings } from './store.js';

const listeners = new Set();

const state = {
  running: false,
  endsAt: 0,
  total: 0,
  pausedRemaining: null,
  label: '',
  finished: false,
};

let tick = null;

export const subscribeTimer = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const emit = () => listeners.forEach((fn) => fn(getTimer()));

export function getTimer() {
  const remaining = state.pausedRemaining != null
    ? state.pausedRemaining
    : state.running
      ? Math.max(0, (state.endsAt - Date.now()) / 1000)
      : 0;
  return {
    active: state.running || state.pausedRemaining != null,
    paused: state.pausedRemaining != null,
    remaining,
    total: state.total,
    label: state.label,
    progress: state.total ? 1 - remaining / state.total : 0,
  };
}

function loop() {
  if (state.pausedRemaining != null) return;
  const left = (state.endsAt - Date.now()) / 1000;
  if (left <= 0) {
    complete();
    return;
  }
  emit();
}

export function startRest(seconds, label = 'Rest') {
  const secs = Math.max(1, Math.round(seconds));
  state.running = true;
  state.finished = false;
  state.total = secs;
  state.endsAt = Date.now() + secs * 1000;
  state.pausedRemaining = null;
  state.label = label;
  clearInterval(tick);
  tick = setInterval(loop, 250);
  emit();
}

export function adjustRest(deltaSeconds) {
  if (!state.running && state.pausedRemaining == null) return;
  if (state.pausedRemaining != null) {
    state.pausedRemaining = Math.max(1, state.pausedRemaining + deltaSeconds);
  } else {
    state.endsAt = Math.max(Date.now() + 1000, state.endsAt + deltaSeconds * 1000);
  }
  state.total = Math.max(state.total + deltaSeconds, 1);
  emit();
}

export function pauseRest() {
  if (!state.running || state.pausedRemaining != null) return;
  state.pausedRemaining = Math.max(0, (state.endsAt - Date.now()) / 1000);
  emit();
}

export function resumeRest() {
  if (state.pausedRemaining == null) return;
  state.endsAt = Date.now() + state.pausedRemaining * 1000;
  state.pausedRemaining = null;
  emit();
}

export function stopRest() {
  clearInterval(tick);
  tick = null;
  state.running = false;
  state.pausedRemaining = null;
  state.finished = false;
  state.total = 0;
  emit();
}

function complete() {
  clearInterval(tick);
  tick = null;
  state.running = false;
  state.finished = true;
  state.pausedRemaining = null;
  alertDone();
  emit();
  setTimeout(() => {
    if (state.finished) {
      state.finished = false;
      state.total = 0;
      emit();
    }
  }, 5000);
}

function alertDone() {
  const s = getSettings();
  if (s.vibrate && navigator.vibrate) {
    try {
      navigator.vibrate([180, 90, 180]);
    } catch { /* not supported */ }
  }
  if (s.sound) beep();
}

let audioCtx = null;

/** A short synthesised chime — no audio file to ship or fail to cache. */
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1174.7].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  } catch {
    /* audio is a nicety, never a failure */
  }
}

/** iOS only allows audio after a user gesture — prime it on first tap. */
export function primeAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* ignore */
  }
}

// Re-sync immediately when the app comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.running) loop();
});
