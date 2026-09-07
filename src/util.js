// Small shared helpers: ids, dates, units, formatting.

export const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);

// ---------- dates ----------
// A "day key" is YYYY-MM-DD in *local* time, so a 11pm workout stays on its day.
export function dayKey(d = new Date()) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function parseDayKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Monday-start week key.
export function weekKey(d) {
  const dt = typeof d === 'string' ? parseDayKey(d) : new Date(d);
  const day = (dt.getDay() + 6) % 7; // Mon = 0
  return dayKey(addDays(dt, -day));
}

export function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const dt = typeof d === 'string' ? (d.length === 10 ? parseDayKey(d) : new Date(d)) : d;
  return dt.toLocaleDateString(undefined, opts);
}

export function fmtDateFull(d) {
  return fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDay(key) {
  const today = dayKey();
  if (key === today) return 'Today';
  if (key === dayKey(addDays(new Date(), -1))) return 'Yesterday';
  const days = Math.round((parseDayKey(today) - parseDayKey(key)) / 86400000);
  if (days > 0 && days < 7) return `${days} days ago`;
  return fmtDate(key);
}

// ---------- durations ----------
export function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Accepts "90", "1:30", "1m30s" -> seconds
export function parseDuration(str) {
  if (str == null) return null;
  const t = String(str).trim().toLowerCase();
  if (!t) return null;
  if (t.includes(':')) {
    const parts = t.split(':').map((p) => parseFloat(p) || 0);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  }
  const m = t.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/);
  if (m && (m[1] || m[2] || m[3])) {
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

// ---------- units ----------
// Weights are stored canonically in kg. Distances stored in metres.
export const KG_PER_LB = 0.45359237;

export const toDisplayWeight = (kg, unit) =>
  kg == null ? null : unit === 'lb' ? kg / KG_PER_LB : kg;

export const toStoredWeight = (val, unit) =>
  val == null || val === '' ? null : unit === 'lb' ? val * KG_PER_LB : Number(val);

export function fmtWeight(kg, unit, withUnit = true) {
  if (kg == null) return '';
  const v = toDisplayWeight(kg, unit);
  const s = Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(1);
  return withUnit ? `${s} ${unit}` : s;
}

export const toDisplayDistance = (m, unit) => (m == null ? null : unit === 'lb' ? m / 1609.344 : m / 1000);
export const toStoredDistance = (v, unit) =>
  v == null || v === '' ? null : unit === 'lb' ? v * 1609.344 : v * 1000;
export const distanceLabel = (unit) => (unit === 'lb' ? 'mi' : 'km');

export function fmtDistance(m, unit) {
  if (m == null) return '';
  const v = toDisplayDistance(m, unit);
  return `${v.toFixed(2).replace(/\.?0+$/, '')} ${distanceLabel(unit)}`;
}

// ---------- numbers ----------
export function fmtNum(n, digits = 0) {
  if (n == null || isNaN(n)) return '–';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** "1 set" / "3 sets" — counts read wrong without it. */
export const plural = (n, word, suffix = 's') => `${fmtNum(n, 1)} ${word}${n === 1 ? '' : suffix}`;

// Fuzzy-ish search: every token must appear somewhere in the haystack.
export function matchesQuery(haystack, query) {
  if (!query) return true;
  const h = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => h.includes(tok));
}

export const SET_TYPES = {
  w: { label: 'Working set', short: 'W', cls: 'st-w' },
  wu: { label: 'Warm-up', short: 'WU', cls: 'st-wu' },
  d: { label: 'Drop set', short: 'D', cls: 'st-d' },
  f: { label: 'To failure', short: 'F', cls: 'st-f' },
};
