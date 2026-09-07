// Theme stamping. "system" leaves the root unstamped so prefers-color-scheme wins.

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
