// Theme stamping. "system" leaves the root unstamped so prefers-color-scheme wins.

/** Text size. Drives --ui-scale, which the root font-size multiplies, so every
    rem in the stylesheet moves together. Never below 1: the app is already at
    the browser default and shrinking it would drop inputs under the 16px that
    keeps iOS from zooming on focus. */
export const TEXT_SCALES = [
  { value: 1, label: 'Default' },
  { value: 1.12, label: 'Large' },
  { value: 1.25, label: 'Larger' },
  { value: 1.4, label: 'Largest' },
];

export function applyTextScale(scale) {
  const n = Number(scale);
  const safe = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1.4) : 1;
  document.documentElement.style.setProperty('--ui-scale', String(safe));
}

export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
  syncMetaThemeColor();
}

function syncMetaThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--plane').trim();
  if (surface) meta.setAttribute('content', surface);
}

// Keep the browser chrome in step when the OS flips and we're on "system".
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.hasAttribute('data-theme')) syncMetaThemeColor();
});
