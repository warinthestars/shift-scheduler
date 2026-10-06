import React, { useEffect, useRef, useState } from 'react';
import {
  Timer, Info, Navigation, CalendarPlus, MessageSquare, ArrowRightLeft, LogOut, MoreHorizontal, AlertTriangle,
  Clock, Undo2, Check, RotateCcw, LifeBuoy, X,
} from 'lucide-react';
import PayLabel from '../PayLabel';
import TipBadge from '../TipBadge';
import { fmtTime, fmtTimeRange, fmtShortDate } from '../../utils/venueTime';
import { statusLabel, PENDING_STATUSES } from '../../utils/listingFormat';

const SOURCE_LABELS = {
  manager_assign: 'Assigned by your manager',
  manager_manual: 'Approved by your manager',
  offer: 'You accepted an offer',
  transfer: 'Handed to you by a teammate',
  venue_whitelist: "Booked right away (you're on their team)",
  venue_everyone_auto: 'Booked right away',
  shift_auto_confirm: 'Booked right away',
  rating_threshold: 'Booked right away (thanks to your rating)',
  cover: 'You took this to cover for a teammate',      // Phase 34
};

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

function Menu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-expanded={open}
        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1">
          {shown.map((it) => (
            <button key={it.label} type="button" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full text-left px-3 py-2 text-xs inline-flex items-start gap-2 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent ${it.danger ? 'text-rose-300' : 'text-slate-200'}`}>
              <it.icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                {it.label}
                {it.hint && <span className="block text-[10px] text-slate-500">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const btn = 'px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';

/**
 * Phase 29.4: One of my shifts (My shifts tab). The one thing to do now is the big button;
 * everything else lives in the ⋯ menu.
 * Props: req, calItem (calendar item for booked shifts), clockedIn, busy ('clock' | 'withdraw' | null),
 *        onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw, onAddCalendar, onDirections, onAskBack
 * Phase 34: cover (my live cover request for this booking, from GET /api/cover/mine, or null), onAskCover, onCancelCover
 * Phase 35: calItem.time_tracking === 'payroll' means the venue's own payroll tracks this shift: no clock-in button here.
 */
export default function MyShiftCard({
  req, calItem, clockedIn = false, busy = null, onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw,
  onAddCalendar, onDirections, onAskBack, cover = null, onAskCover, onCancelCover,
}) {
  const shift = req.shift || {};
  const tz = shift.venue?.timezone;
  const st = String(req.status || '').toLowerCase();
  const isBooked = ['approved', 'confirmed'].includes(st);
  const isCheckedIn = st === 'checked_in' || clockedIn;
  const isPending = PENDING_STATUSES.includes(st);
  const isCompleted = st === 'completed';
  const isDropped = st === 'dropped';
  const now = Date.now();
  const startMs = new Date(shift.start_time).getTime();
  const endMs = new Date(shift.end_time).getTime();
  const ended = now >= endMs;
  const hoursLeft = (startMs - now) / 3600000;
  const canDrop = isBooked && !isCheckedIn && hoursLeft >= 24;
  const opensAt = calItem?.clock_in_opens_at ? new Date(calItem.clock_in_opens_at) : null;
  const tooEarly = !!opensAt && now < opensAt.getTime();
  const needsAck = !!calItem?.needs_ack;
  const shiftCancelled = String(shift.status || '').toUpperCase() === 'CANCELLED';
  const canAskBack = isDropped && startMs > now && !shiftCancelled && onAskBack;
  const canCover = isBooked && !isCheckedIn && startMs > now;                         // Phase 34
  const payroll = calItem?.time_tracking === 'payroll' && !isCheckedIn;             // Phase 35: the venue's own payroll tracks this shift
  const { month, day, weekday } = dateParts(shift.start_time, tz);

  const chip = isCheckedIn
    ? ['Clocked in', 'bg-sky-500/15 text-sky-300 border-sky-500/40']
    : isBooked
      ? ['Booked', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30']
      : isPending
        ? ['Waiting for approval', 'bg-amber-500/15 text-amber-300 border-amber-500/30']
        : isCompleted
          ? ['Worked', 'bg-slate-800 text-slate-300 border-slate-700']
          : isDropped
            ? ['You dropped this', 'bg-rose-500/10 text-rose-300 border-rose-500/30']
            : [statusLabel(st), 'bg-slate-800 text-slate-400 border-slate-700'];

  // The one main action
  let primary = null;
  if (isCheckedIn) {
    primary = (
      <button type="button" onClick={onClockOut} disabled={busy === 'clock'} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}>
        <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : 'Clock out'}
      </button>
    );
  } else if (isBooked && payroll && needsAck && !ended) {
    // Phase 35: no clock-in here, so reading the notes is the only action
    primary = (
      <button type="button" onClick={onDetails} className={`${btn} bg-amber-500 hover:bg-amber-400 text-slate-950`}>
        <AlertTriangle className="w-4 h-4" /> {calItem?.info_change ? 'Read the update' : 'Read the shift notes'}
      </button>
    );
  } else if (isBooked && payroll && !ended) {
    primary = (
      <span className={`${btn} bg-violet-500/10 text-violet-200 border border-violet-500/30 font-semibold`}
        title="This venue tracks your hours with its own time clock or payroll system. Clock in there, not in ShiftUp.">
        <Timer className="w-4 h-4" /> Clock in with the venue's system
      </span>
    );
  } else if (isBooked && payroll && ended) {
    primary = (
      <span className="text-xs text-emerald-400 font-semibold inline-flex items-center gap-1">
        <Check className="w-4 h-4" /> Worked · tracked by venue payroll
      </span>
    );
  } else if (isBooked && needsAck && (ended || tooEarly)) {
    primary = (
      <button type="button" onClick={onDetails} className={`${btn} bg-amber-500 hover:bg-amber-400 text-slate-950`}>
        <AlertTriangle className="w-4 h-4" /> {calItem?.info_change ? 'Read the update' : 'Read the shift notes'}
      </button>
    );
  } else if (isBooked && needsAck) {
    // Clock-in is open: never hide it behind "read the notes"
    primary = (
      <>
        <button type="button" onClick={onDetails} className={`${btn} bg-amber-500/15 hover:bg-amber-500 text-amber-200 hover:text-slate-950 border border-amber-500/40`}>
          <AlertTriangle className="w-4 h-4" /> {calItem?.info_change ? 'Read the update' : 'Read the notes'}
        </button>
        <button type="button" onClick={onClockIn} disabled={busy === 'clock'} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
          <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : calItem?.geofence_on ? 'Clock in (uses location)' : 'Clock in'}
        </button>
      </>
    );
  } else if (isBooked && !ended && !tooEarly) {
    primary = (
      <button type="button" onClick={onClockIn} disabled={busy === 'clock'} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
        <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : calItem?.geofence_on ? 'Clock in (uses location)' : 'Clock in'}
      </button>
    );
  } else if (isBooked && tooEarly) {
    primary = (
      <span className={`${btn} bg-slate-800 text-slate-400 border border-slate-700 font-semibold`} title="Clock-in opens shortly before your shift starts">
        <Clock className="w-4 h-4" /> Clock-in opens {fmtShortDate(opensAt, tz) !== fmtShortDate(new Date(), tz) ? `${fmtShortDate(opensAt, tz)}, ` : ''}{fmtTime(opensAt, tz)}
      </span>
    );
  } else if (isBooked && ended) {
    primary = <span className="text-[11px] text-slate-500 italic">Shift over. Ask your manager to add your hours.</span>;
  } else if (isPending) {
    primary = (
      <button type="button" onClick={onWithdraw} disabled={busy === 'withdraw'}
        className={`${btn} border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 font-semibold`}>
        <Undo2 className="w-4 h-4" /> {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw request'}
      </button>
    );
  } else if (canAskBack) {
    primary = (
      <button type="button" onClick={onAskBack} className={`${btn} bg-slate-800 hover:bg-slate-700 text-brand-300 border border-brand-500/40`}>
        <RotateCcw className="w-4 h-4" /> Ask to come back
      </button>
    );
  } else if (isCompleted) {
    primary = <span className="text-xs text-emerald-400 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> Worked</span>;
  }

  const menu = [
    onDetails && { label: 'Details & notes', icon: Info, onClick: onDetails },
    (isBooked || isCheckedIn) && onDirections && { label: 'Directions', icon: Navigation, onClick: onDirections },
    isBooked && !ended && { label: 'Add to my calendar', icon: CalendarPlus, onClick: onAddCalendar },
    (isBooked || isCheckedIn || isCompleted) && { label: 'Shift chat', icon: MessageSquare, onClick: onBoard },
    // Phase 34: ask the team (and maybe the public board) to take it; you stay booked until someone does
    canCover && !cover && onAskCover && {
      label: 'Ask for cover', icon: LifeBuoy, onClick: onAskCover,
      hint: 'Your team can take it. You stay booked until someone does.',
    },
    canCover && cover?.status === 'open' && onCancelCover && { label: 'Cancel cover request', icon: X, onClick: onCancelCover },
    isBooked && !isCheckedIn && !ended && {
      label: 'Hand off to a teammate', icon: ArrowRightLeft, onClick: onHandOff, disabled: !!cover,
      hint: cover ? 'You asked for cover. Cancel that first.' : null,
    },
    isBooked && !isCheckedIn && !ended && {
      label: 'Drop shift', icon: LogOut, onClick: onDrop, danger: true, disabled: !canDrop,
      hint: canDrop ? null : 'Not within 24 hours of the start. Ask for cover, hand it off, or message your manager.',
    },
  ];

  const reasonLine = req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn', 'dropped', 'rejected'].includes(st);
  const coveredLine = req.status_reason && (st === 'transferred' || req.approval_source === 'cover');   // Phase 34: "Covered by Ben" / "Covering for Ava"

  return (
    <div className={`bg-slate-900 border rounded-2xl p-4 shadow-lg flex gap-4 ${
      isCheckedIn ? 'border-sky-500/50' : needsAck && isBooked ? 'border-amber-500/50' : 'border-slate-800'}`}>
      <div className="flex-shrink-0 w-14 h-fit rounded-xl bg-slate-950 border border-slate-800 text-center py-1.5">
        <div className="text-[10px] font-bold text-brand-400 tracking-wider">{month}</div>
        <div className="text-xl font-black text-white leading-none">{day}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">{weekday}</div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${chip[1]}`}>{chip[0]}</span>
            {req.previous_drop_at && (isBooked || isPending) && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-300 border-slate-600">After a drop</span>
            )}
            {cover && isBooked && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${cover.status === 'pending_approval'
                ? 'bg-indigo-500/15 text-indigo-200 border-indigo-500/40' : 'bg-amber-500/10 text-amber-200 border-amber-500/40'}`}>
                <LifeBuoy className="w-3 h-3" />
                {cover.status === 'pending_approval'
                  ? `${cover.taker_first_name || 'Someone'} wants to cover · waiting for the manager`
                  : `Asking for cover · ${cover.audience === 'public' ? 'team + public board' : 'team only'}`}
              </span>
            )}
            {payroll && (isBooked || isCompleted) && (
              <span title="Your hours here are tracked by the venue's own payroll, not ShiftUp"
                className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-violet-500/10 text-violet-200 border-violet-500/30">
                Venue payroll
              </span>
            )}
            {(isBooked || isCheckedIn) && SOURCE_LABELS[req.approval_source] && (
              <span className="text-[10px] text-slate-500">{SOURCE_LABELS[req.approval_source]}</span>
            )}
          </div>
          <h3 className="text-base font-bold text-white leading-snug">{shift.title}</h3>
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-slate-200">{shift.role_type}</span>
            <span>·</span>
            <span>{shift.venue?.name}</span>
            <span>·</span>
            <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} className="text-brand-400 font-semibold" />
            <TipBadge shift={shift} />
          </p>
          <p className="text-xs text-slate-300 inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-brand-400" /> {fmtTimeRange(shift.start_time, shift.end_time, tz)}
          </p>
          {isPending && req.notes && <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>}
          {reasonLine && <p className="text-[11px] text-rose-300">Reason: {req.status_reason}</p>}
          {coveredLine && <p className="text-[11px] text-slate-400">{req.status_reason}</p>}
          {cover?.note && isBooked && <p className="text-[11px] text-slate-400">Your cover note: <span className="text-slate-300">{cover.note}</span></p>}
        </div>
        <div className="flex items-center gap-2 md:justify-end flex-wrap">
          {primary}
          <Menu items={menu} />
        </div>
      </div>
    </div>
  );
}
