import React, { useState } from 'react';
import {
  Phone, MessageSquare, LogIn, UserX, UserPlus, ClipboardList, Users, MapPin, MapPinOff, EyeOff, ChevronDown, ChevronUp, Radio,
} from 'lucide-react';
import ReliabilityBadge from '../ReliabilityBadge';
import { fmtTime, fmtTimeRange } from '../../utils/venueTime';

const STATE = {
  upcoming: { label: 'Not open yet', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  due: { label: 'Not in yet', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  late: { label: 'Late', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40 animate-pulse' },
  in: { label: 'In', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  done: { label: 'Done', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
  missed: { label: 'Never clocked in', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30 line-through' },
};

function minutesText(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function startsText(event, nowMs) {
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();
  if (event.state === 'ended') return 'Ended';
  if (event.state === 'live') {
    const left = Math.max(0, Math.round((end - nowMs) / 60000));
    return `Live now · ends in ${minutesText(left)}`;
  }
  const until = Math.max(0, Math.round((start - nowMs) / 60000));
  return until <= 0 ? 'Starting now' : `Starts in ${minutesText(until)}`;
}

/**
 * Phase 30: One event on the manager's Today board: each position, who is booked and whether
 * they're in, plus one-tap actions (call, message the shift board, clock them in, no-show, find cover).
 * Props: event (TonightEvent), timeZone, nowMs, reliabilityMap, highlightRequestId,
 *        onBoard(position), onClockIn(person, position), onNoShow(person, position), onFindCover(position),
 *        onOpenEvent(eventId), onTimesheet(eventId), onOpenWorker(workerId)
 */
export default function TodayEventCard({
  event, timeZone, nowMs, reliabilityMap = {}, highlightRequestId,
  onBoard, onClockIn, onNoShow, onFindCover, onOpenEvent, onTimesheet, onOpenWorker,
}) {
  const ended = event.state === 'ended';
  const [open, setOpen] = useState(!ended || event.missed > 0);
  const tone = event.late > 0
    ? 'border-rose-500/50'
    : event.state === 'live' ? 'border-emerald-500/40' : ended ? 'border-slate-800' : 'border-slate-700';
  const iconBtn = 'p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition';
  const actBtn = 'px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition disabled:opacity-50';

  return (
    <article className={`bg-slate-900 border rounded-2xl ${tone} ${ended ? 'opacity-80' : ''}`}>
      <header className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {event.state === 'live' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                <Radio className="w-3 h-3" /> LIVE
              </span>
            )}
            <h3 className="text-base font-bold text-white truncate">{event.title}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-slate-200">{fmtTimeRange(event.start_time, event.end_time, timeZone)}</span>
            <span>·</span>
            <span>{startsText(event, nowMs)}</span>
            {event.location_name && (
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {event.location_name}</span>
            )}
          </p>
          <p className="text-[11px] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400">
            <span><strong className="text-white">{event.booked}</strong> booked</span>
            {(event.state !== 'upcoming' || event.clocked_in > 0) && (
              <span><strong className="text-emerald-300">{event.clocked_in + event.done}</strong> clocked in</span>
            )}
            {event.late > 0 && <span className="text-rose-300 font-bold">{event.late} late</span>}
            {event.missed > 0 && <span className="text-rose-300">{event.missed} never clocked in</span>}
            {event.no_show > 0 && <span className="text-rose-400">{event.no_show} no-show</span>}
            {event.open_spots > 0 && <span className="text-amber-300 font-bold">{event.open_spots} open</span>}
            {event.unread > 0 && <span className="text-amber-200">{event.unread} haven't read the update</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.event_id && !ended && (
            <button type="button" onClick={() => onOpenEvent?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Roster
            </button>
          )}
          {event.event_id && event.state !== 'upcoming' && (
            <button type="button" onClick={() => onTimesheet?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
              <ClipboardList className="w-3.5 h-3.5" /> Time sheet
            </button>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Hide people' : 'Show people'} className={iconBtn}>
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/70">
          {event.positions.map((pos) => (
            <section key={pos.shift_id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-300">{pos.role_type}</h4>
                <span className="text-[11px] text-slate-500">
                  {pos.people.filter((p) => p.clock_state !== 'no_show').length}/{pos.capacity} booked
                </span>
                <button type="button" onClick={() => onBoard?.(pos)} className="ml-auto text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" /> Message this shift
                </button>
              </div>

              {pos.people.length === 0 && pos.open_spots === 0 && (
                <p className="text-xs text-slate-500">Nobody booked.</p>
              )}

              <ul className="space-y-1.5">
                {pos.people.map((p) => {
                  const st = STATE[p.clock_state] || STATE.upcoming;
                  let sub = '';
                  if (p.clock_state === 'upcoming') sub = `Clock-in opens ${fmtTime(event.clock_in_opens_at, timeZone)}`;
                  if (p.clock_state === 'due') sub = 'Clock-in is open';
                  if (p.clock_state === 'late') sub = `${minutesText(p.late_minutes)} past the start`;
                  if (p.clock_state === 'in') sub = `Since ${fmtTime(p.clock_in_time, timeZone)}${p.late_minutes ? ` · ${p.late_minutes} min late` : ''}`;
                  if (p.clock_state === 'done') sub = `${fmtTime(p.clock_in_time, timeZone)} – ${fmtTime(p.clock_out_time, timeZone)}`;
                  if (p.clock_state === 'missed') sub = 'Shift ended with no clock-in';
                  const canClockIn = ['due', 'late'].includes(p.clock_state);
                  const canNoShow = ['late', 'missed'].includes(p.clock_state);
                  return (
                    <li key={p.request_id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-xl ${
                        String(highlightRequestId) === String(p.request_id) ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : 'bg-slate-950/40'
                      }`}>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${st.cls}`}>{st.label}</span>
                        <div className="min-w-0">
                          <button type="button" onClick={() => onOpenWorker?.(p.worker_id)} className="text-sm font-semibold text-white hover:underline truncate text-left">
                            {p.first_name} {p.last_name}
                          </button>
                          <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                            {sub && <span className={p.clock_state === 'late' ? 'text-rose-300 font-semibold' : ''}>{sub}</span>}
                            {p.manager_clock && <span className="text-indigo-300">clocked in by a manager</span>}
                            {p.geo_flag && <span className="text-amber-300 inline-flex items-center gap-0.5"><MapPinOff className="w-3 h-3" /> away from site</span>}
                            {p.info_seen === false && ['upcoming', 'due', 'late'].includes(p.clock_state) && (
                              <span className="text-amber-200 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" /> hasn't read the update</span>
                            )}
                            <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        {p.phone ? (
                          <a href={`tel:${p.phone}`} className={iconBtn} aria-label={`Call ${p.first_name}`} title={`Call ${p.phone}`}>
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className={`${iconBtn} opacity-30 cursor-not-allowed`} title="No phone number on file"><Phone className="w-3.5 h-3.5" /></span>
                        )}
                        {canClockIn && (
                          <button type="button" onClick={() => onClockIn?.(p, pos)}
                            className={`${actBtn} bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-600/30`}>
                            <LogIn className="w-3.5 h-3.5" /> Clock in
                          </button>
                        )}
                        {canNoShow && (
                          <button type="button" onClick={() => onNoShow?.(p, pos)}
                            className={`${actBtn} bg-rose-600/15 border border-rose-500/40 text-rose-200 hover:bg-rose-600/25`}>
                            <UserX className="w-3.5 h-3.5" /> No-show
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {pos.open_spots > 0 && (
                <div className="mt-2 p-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-amber-200">
                    {pos.open_spots} open spot{pos.open_spots === 1 ? '' : 's'}
                  </span>
                  {(pos.pending_requests > 0 || pos.pending_offers > 0) && (
                    <span className="text-[11px] text-amber-100/70">
                      {[pos.pending_requests && `${pos.pending_requests} asked`, pos.pending_offers && `${pos.pending_offers} offered`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <button type="button" onClick={() => onFindCover?.(pos)}
                    className={`${actBtn} ml-auto bg-amber-500 hover:bg-amber-400 text-slate-950`}>
                    <UserPlus className="w-3.5 h-3.5" /> Find cover
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
