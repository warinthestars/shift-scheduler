/**
 * Phase 31: weekly availability helpers. Weekday 0 = Monday ... 6 = Sunday (matches the API).
 * Times are 'HH:MM' (or '24:00' for end of day); an end earlier than the start runs past midnight.
 */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** '18:30' -> '6:30 PM', '24:00' / '00:00' -> '12:00 AM' */
export function fmtHm(value) {
  if (!value) return '';
  const [h, m] = value.split(':').map(Number);
  const hh = h % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function windowText(w) {
  if (w.start_local === '00:00' && w.end_local === '24:00') return 'All day';
  return `${fmtHm(w.start_local)} – ${fmtHm(w.end_local)}`;
}

/** [{weekday, start_local, end_local}] -> ["Mon 4:00 PM – 12:00 AM", ...] grouped by day */
export function availabilitySummary(windows = []) {
  const byDay = WEEKDAYS.map(() => []);
  windows.forEach((w) => byDay[w.weekday]?.push(windowText(w)));
  return byDay.map((ranges, i) => ({ day: WEEKDAYS[i], ranges })).filter((d) => d.ranges.length);
}

/** Quick presets for the editor */
export const PRESETS = [
  { id: 'evenings', label: 'Evenings (4 PM – midnight)', start: '16:00', end: '24:00', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'weeknights', label: 'Weeknights only', start: '17:00', end: '24:00', days: [0, 1, 2, 3, 4] },
  { id: 'weekends', label: 'Weekends, any time', start: '00:00', end: '24:00', days: [5, 6] },
  { id: 'anytime', label: 'Any time', start: '00:00', end: '24:00', days: [0, 1, 2, 3, 4, 5, 6] },
];

/** 'YYYY-MM-DD' -> 'Mon, Oct 5' without timezone drift */
export function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDayRange(a, b) {
  return a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
}

/** today's date as 'YYYY-MM-DD' in the viewer's time zone */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
