/**
 * Phase 26.1: Small helpers for worker event listings (Find Shifts cards + details modal).
 */
import { dayKey, fmtDate } from './venueTime';

export const PENDING_STATUSES = ['pending', 'pending_manager_approval'];
export const BOOKED_STATUSES = ['approved', 'confirmed', 'checked_in'];
export const ACTIVE_STATUSES = [...PENDING_STATUSES, ...BOOKED_STATUSES, 'completed'];

/** Friendly words for every request status a worker can see. */
export const STATUS_LABELS = {
  pending: 'Waiting for approval',
  pending_manager_approval: 'Waiting for approval',
  approved: 'Confirmed',
  confirmed: 'Confirmed',
  checked_in: 'Clocked in',
  completed: 'Completed',
  rejected: 'Not selected',
  dropped: 'Released',
  transferred: 'Handed off',
  cancelled: 'Cancelled by venue',
  removed: 'Removed by manager',
  no_show: 'Marked no-show',
  withdrawn: 'Withdrawn',
};

const money = (n) => {
  const v = Number(n);
  if (Number.isNaN(v)) return '';
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};
const wholeMoney = (n) => `$${Math.round(Number(n)).toLocaleString()}`;

/** "5 hrs", "5.5 hrs", "1 hr" */
export function hoursText(hours) {
  const h = Math.round(Number(hours || 0) * 10) / 10;
  return `${h} ${h === 1 ? 'hr' : 'hrs'}`;
}

/** Headline pay for a card: "$28–$35/hr", "$30/hr" or null when every rate is hidden. */
export function listingPayText(listing) {
  if (listing?.pay_min === null || listing?.pay_min === undefined) return null;
  const lo = Number(listing.pay_min);
  const hi = listing.pay_max === null || listing.pay_max === undefined ? lo : Number(listing.pay_max);
  return hi > lo ? `${money(lo)}–${money(hi)}/hr` : `${money(lo)}/hr`;
}

/** "≈ $140" or "≈ $140–$175" for one position, or null when pay is hidden. */
export function estPayText(position) {
  if (position?.est_pay_min === null || position?.est_pay_min === undefined) return null;
  const lo = Number(position.est_pay_min);
  const hi = position.est_pay_max === null || position.est_pay_max === undefined ? lo : Number(position.est_pay_max);
  return hi > lo ? `≈ ${wholeMoney(lo)}–${wholeMoney(hi)}` : `≈ ${wholeMoney(lo)}`;
}

/** Day group heading in the venue's timezone: "Today", "Tomorrow" or "Fri, Oct 3". */
export function dayGroupLabel(value, tz) {
  const k = dayKey(value, tz);
  if (k === dayKey(new Date(), tz)) return 'Today';
  if (k === dayKey(new Date(Date.now() + 86400000), tz)) return 'Tomorrow';
  return fmtDate(value, tz);
}

/** True when the event starts on the venue-local "today" / "tomorrow". */
export function isOnDay(value, tz, offsetDays) {
  return dayKey(value, tz) === dayKey(new Date(Date.now() + offsetDays * 86400000), tz);
}

export function mapsUrl(venue) {
  if (!venue) return '#';
  const q = venue.address || (venue.lat && venue.lng ? `${venue.lat},${venue.lng}` : venue.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || '')}`;
}

function icsStamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Download a one-event .ics file (works with Google, Apple and Outlook calendars). */
export function downloadIcs({ uid, title, start, end, location, description }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftBoard//Shift//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid || `${icsStamp(start)}@shiftboard`}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    location ? `LOCATION:${icsEscape(location)}` : null,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'shift').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Phase 26.2: calendar helpers -------------------------------------------------------

/** "2026-10-03" for the calendar day the moment falls on in timezone `tz` (device zone if missing). */
export function localDateKey(value, tz) {
  const d = value instanceof Date ? value : new Date(value);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
}

/** "2026-10-03" for a plain calendar Date built on the device (month grid cells). */
export function gridDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Starts in 2 days 4 hrs" / "Starts in 45 min" / "Happening now" / "Ended" */
export function countdownText(start, end) {
  const now = Date.now();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (now >= e) return 'Ended';
  if (now >= s) return 'Happening now';
  const mins = Math.round((s - now) / 60000);
  if (mins < 60) return `Starts in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const rem = mins % 60;
    return `Starts in ${hrs} hr${hrs === 1 ? '' : 's'}${rem ? ` ${rem} min` : ''}`;
  }
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return `Starts in ${days} day${days === 1 ? '' : 's'}${remH ? ` ${remH} hr${remH === 1 ? '' : 's'}` : ''}`;
}

/** Visual style per calendar item, by the worker's status. */
export function calendarTone(item) {
  const s = String(item?.status || '').toLowerCase();
  if (item?.cancelled || ['cancelled', 'removed', 'no_show'].includes(s)) {
    return { key: 'off', chip: 'bg-slate-800/80 text-slate-400 border-slate-700 line-through', dot: 'bg-slate-500', label: STATUS_LABELS[s] || 'Cancelled' };
  }
  if (s === 'completed') {
    return { key: 'done', chip: 'bg-slate-700/60 text-slate-200 border-slate-600', dot: 'bg-slate-400', label: 'Completed' };
  }
  if (PENDING_STATUSES.includes(s)) {
    return { key: 'waiting', chip: 'bg-amber-500/15 text-amber-200 border-amber-500/50 border-dashed', dot: 'bg-amber-400', label: 'Waiting for approval' };
  }
  if (s === 'checked_in') {
    return { key: 'now', chip: 'bg-sky-500/20 text-sky-100 border-sky-400/60', dot: 'bg-sky-400', label: 'Clocked in' };
  }
  return { key: 'booked', chip: 'bg-emerald-500/20 text-emerald-100 border-emerald-500/60', dot: 'bg-emerald-400', label: 'Confirmed' };
}

