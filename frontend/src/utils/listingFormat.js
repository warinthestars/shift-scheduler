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
