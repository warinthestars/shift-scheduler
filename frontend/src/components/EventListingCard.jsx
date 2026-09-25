import React from 'react';
import { Clock, MapPin, Zap, ShieldCheck, Users, ChevronRight, AlertTriangle, Star } from 'lucide-react';
import PayLabel from './PayLabel';
import { fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, listingPayText, estPayText, STATUS_LABELS, PENDING_STATUSES, BOOKED_STATUSES,
} from '../utils/listingFormat';

const MAX_ROWS = 4;

function dateParts(value, tz) {
  const d = new Date(value);
  const make = (opts) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined }).format(d);
    } catch (e) {
      return new Intl.DateTimeFormat('en-US', opts).format(d);
    }
  };
  return { month: make({ month: 'short' }).toUpperCase(), day: make({ day: 'numeric' }), weekday: make({ weekday: 'short' }) };
}

export function MyRequestPill({ status, role }) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  const booked = BOOKED_STATUSES.includes(s) || s === 'completed';
  const waiting = PENDING_STATUSES.includes(s);
  const cls = booked
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    : waiting
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    : 'bg-slate-800 text-slate-400 border-slate-700';
  const text = booked ? `Booked · ${role}` : waiting ? `Requested · ${role}` : STATUS_LABELS[s] || s;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${cls}`}>
      {text}
    </span>
  );
}

/**
 * Phase 26.1: One card per event on the worker's Find Shifts tab.
 * The whole card opens the details modal (onOpen).
 */
export default function EventListingCard({ listing, onOpen }) {
  const tz = listing.venue?.timezone;
  const { month, day, weekday } = dateParts(listing.start_time, tz);
  const pay = listingPayText(listing);
  const rows = listing.positions.slice(0, MAX_ROWS);
  const extra = listing.positions.length - rows.length;
  const mine = listing.my_request;

  const open = () => onOpen && onOpen(listing);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className="group bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl cursor-pointer transition hover:border-emerald-600/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 flex flex-col"
    >
      {/* Header: date tile + title + my status */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-14 rounded-xl bg-slate-950 border border-slate-800 text-center py-1.5">
          <div className="text-[10px] font-bold text-emerald-400 tracking-wider">{month}</div>
          <div className="text-xl font-black text-white leading-none">{day}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{weekday}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-white leading-snug line-clamp-2">{listing.title}</h3>
            {mine && <MyRequestPill status={mine.status} role={mine.role_type} />}
          </div>
          <p className="text-xs font-semibold text-slate-300 mt-0.5 flex items-center gap-1.5">
            <span className="truncate">{listing.venue?.name}</span>
            {listing.on_team && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold whitespace-nowrap">
                <Star className="w-2.5 h-2.5" /> Your venue
              </span>
            )}
          </p>
          {listing.venue?.address && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{listing.venue.address}</span>
            </p>
          )}
        </div>
      </div>

      {/* Time + pay */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          {fmtTimeRange(listing.start_time, listing.end_time, tz)}
          <span className="text-slate-500">· {hoursText(listing.hours)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {pay ? (
            <span className="text-base font-black text-emerald-400">{pay}</span>
          ) : (
            <span className="text-xs italic text-slate-400">Pay shared when booked</span>
          )}
          {listing.any_tips && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              + Tips
            </span>
          )}
        </span>
      </div>

      {/* Positions */}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/70">
        {rows.map((p) => {
          const full = p.status !== 'OPEN';
          const est = estPayText(p);
          return (
            <div key={p.shift_id} className={`px-3 py-2 flex items-center justify-between gap-2 ${full ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex items-center gap-1.5">
                {p.booking === 'instant' && !full ? (
                  <Zap className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" title="Instant book" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" title="Needs approval" />
                )}
                <span className="text-xs font-bold text-slate-100 truncate">{p.role_type}</span>
                {p.my_status && <span className="text-[10px] text-amber-300">• you</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-[11px]">
                <PayLabel rate={p.hourly_rate} rateMax={p.hourly_rate_max} className="text-slate-200 font-semibold" hiddenText="—" />
                {est && <span className="hidden sm:inline text-slate-500">{est}</span>}
                <span className={`font-semibold ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                  {full ? 'Full' : `${p.spots_left} open`}
                </span>
              </div>
            </div>
          );
        })}
        {extra > 0 && (
          <div className="px-3 py-1.5 text-[11px] text-slate-400">+{extra} more position{extra === 1 ? '' : 's'}</div>
        )}
      </div>

      {listing.conflict && (
        <p className="mt-2 text-[11px] text-amber-300 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">Overlaps your shift: {listing.conflict}</span>
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
          <Users className="w-3.5 h-3.5" />
          {listing.total_spots_left > 0
            ? `${listing.total_spots_left} spot${listing.total_spots_left === 1 ? '' : 's'} open`
            : 'Fully staffed'}
          {listing.any_instant && <span className="text-emerald-400 font-semibold"> · Instant book</span>}
        </span>
        <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
          {mine ? 'View details' : 'View & request'}
          <ChevronRight className="w-4 h-4" />
        </span>
      </div>
    </div>
  );
}
