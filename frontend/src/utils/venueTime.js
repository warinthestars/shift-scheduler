/**
 * Phase 25: Venue-local time helpers (built-in Intl only, no extra packages).
 * All values from the API are UTC ISO strings; `tz` is the venue's IANA zone, e.g. 'America/New_York'.
 * If tz is missing, the viewer's device timezone is used.
 */

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'America/Vancouver', label: 'Pacific (Vancouver)' },
  { value: 'Europe/London', label: 'UK (London)' },
  { value: 'UTC', label: 'UTC' },
];

function fmt(value, tz, options) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat([], { ...options, timeZone: tz || undefined }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat([], options).format(d);
  }
}

/** "Fri, Oct 3" */
export const fmtDate = (value, tz) => fmt(value, tz, { weekday: 'short', month: 'short', day: 'numeric' });

/** "Oct 3" */
export const fmtShortDate = (value, tz) => fmt(value, tz, { month: 'short', day: 'numeric' });

/** "Friday, October 3, 2026" */
export const fmtLongDate = (value, tz) =>
  fmt(value, tz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

/** "7:00 PM" */
export const fmtTime = (value, tz) => fmt(value, tz, { hour: 'numeric', minute: '2-digit' });

/** "Oct 3, 2026, 7:00 PM EDT" */
export const fmtDateTime = (value, tz) =>
  fmt(value, tz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

/** "EDT" */
export function tzAbbrev(value, tz) {
  if (!value) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, timeZoneName: 'short' })
      .formatToParts(new Date(value));
    return (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
  } catch (e) {
    return '';
  }
}

/** "7:00 PM – 1:00 AM EDT" */
export function fmtTimeRange(start, end, tz) {
  if (!start) return '';
  const abbr = tzAbbrev(start, tz);
  return `${fmtTime(start, tz)} – ${fmtTime(end, tz)}${abbr ? ` ${abbr}` : ''}`;
}

function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const m = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, (+m.hour) % 24, +m.minute, +m.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Converts a <input type="datetime-local"> value ("2026-10-03T19:00"), interpreted as wall-clock
 * time AT THE VENUE, into a UTC ISO string for the API.
 */
export function zonedLocalToUtcIso(localValue, tz) {
  if (!localValue) return null;
  if (!tz) return new Date(localValue).toISOString();
  const [datePart, timePart = '00:00'] = localValue.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc).toISOString();
}

/** Calendar-day key in the venue timezone, used for grouping lists by day. */
export const dayKey = (value, tz) => fmtLongDate(value, tz);
