import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus, Lock,
  AlertTriangle, CheckCircle2, MessageSquare, ExternalLink, DollarSign, Briefcase,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange, fmtTime } from '../utils/venueTime';
import {
  hoursText, mapsUrl, downloadIcs, countdownText, calendarTone, whereOf,
} from '../utils/listingFormat';

function NoteCard({ icon: Icon, label, text, tone = 'default', badge = null }) {
  if (!text || !String(text).trim()) return null;
  const toneCls =
    tone === 'staff'
      ? 'border-indigo-500/40 bg-indigo-500/5'
      : 'border-slate-800 bg-slate-950/60';
  return (
    <div className={`p-3 rounded-xl border ${toneCls}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-4 h-4 ${tone === 'staff' ? 'text-indigo-300' : 'text-emerald-400'}`} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{label}</span>
        {badge}
      </div>
      <p className="text-sm text-slate-100 whitespace-pre-line break-words leading-relaxed">{text}</p>
    </div>
  );
}

/**
 * Phase 26.2: Everything a worker needs for one of THEIR shifts, in one place.
 * Big date and time, countdown, where to go, pay, and every note (venue, event, position,
 * and staff-only notes once they're confirmed). Booked workers confirm "Got it" so
 * the manager knows they've read the latest info.
 *
 * Props:
 *   item               WorkerCalendarItem
 *   onClose()
 *   onAcknowledged(requestId, seenAtIso)   parent updates its copy / refetches
 *   onOpenBoard(shiftLike)                 optional: opens ShiftBoardModal
 */
export default function ShiftDetailsModal({ item, onClose, onAcknowledged, onOpenBoard }) {
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState('');
  const [ackedNow, setAckedNow] = useState(false);

  if (!item) return null;
  const tz = item.venue?.timezone;
  const tone = calendarTone(item);
  const off = tone.key === 'off';
  const mustRead = item.needs_ack && !ackedNow && !off;

  const acknowledge = async () => {
    setAcking(true);
    setAckError('');
    try {
      const res = await api.post(`/me/requests/${item.request_id}/ack`);
      setAckedNow(true);
      if (onAcknowledged) onAcknowledged(item.request_id, res.data?.info_seen_at);
    } catch (err) {
      setAckError(err.response?.data?.detail || 'Could not save. Try again.');
    } finally {
      setAcking(false);
    }
  };

  const addToCalendar = () =>
    downloadIcs({
      uid: `${item.request_id}@shiftboard`,
      title: `${item.role_type} — ${item.title} (${item.venue?.name || ''})`,
      start: item.start_time,
      end: item.end_time,
      location: whereOf(item).address,
      description: [
        item.location?.notes && `About this location: ${item.location.notes}`,
        item.location_staff_notes && `At this location (staff): ${item.location_staff_notes}`,
        item.venue?.arrival_instructions && `When you arrive: ${item.venue.arrival_instructions}`,
        item.venue?.dress_code && `Dress code: ${item.venue.dress_code}`,
        item.event_notes,
        item.role_notes,
        item.event_staff_notes,
        item.position_staff_notes,
      ].filter(Boolean).join('\n\n'),
    });

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 mr-auto">
        Close
      </button>
      {item.booked && !off && (
        <button type="button" onClick={addToCalendar} className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
          <CalendarPlus className="w-4 h-4 text-emerald-400" /> Add to calendar
        </button>
      )}
      {item.booked && onOpenBoard && (
        <button
          type="button"
          onClick={() => onOpenBoard({ id: item.shift_id, title: item.title, venue: { name: item.venue?.name } })}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
        >
          <MessageSquare className="w-4 h-4 text-indigo-400" /> Board
        </button>
      )}
      {mustRead && (
        <button
          type="button"
          onClick={acknowledge}
          disabled={acking}
          className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-md shadow-amber-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-4 h-4" /> {acking ? 'Saving…' : "Got it — I've read this"}
        </button>
      )}
    </>
  );

  return (
    <ModalShell
      title={`${item.role_type} · ${item.title}`}
      subtitle={item.venue?.name}
      icon={<Briefcase className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      {/* Big date & time */}
      <div className={`rounded-2xl p-4 sm:p-5 border mb-4 ${off ? 'border-slate-700 bg-slate-950/60' : 'border-emerald-600/40 bg-gradient-to-br from-emerald-600/10 to-slate-950'}`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className={`text-2xl sm:text-3xl font-black ${off ? 'text-slate-500 line-through' : 'text-white'}`}>
              {fmtLongDate(item.start_time, tz)}
            </div>
            <div className={`text-xl sm:text-2xl font-bold mt-1 flex items-center gap-2 ${off ? 'text-slate-500' : 'text-emerald-300'}`}>
              <Clock className="w-6 h-6" /> {fmtTimeRange(item.start_time, item.end_time, tz)}
            </div>
            <div className="text-sm text-slate-400 mt-1">{hoursText(item.hours)}</div>
          </div>
          <div className="flex sm:flex-col items-start sm:items-end gap-2">
            <span className={`px-3 py-1 rounded-full border text-xs font-bold ${tone.chip.replace('line-through', '')}`}>{tone.label}</span>
            {!off && (
              <span className="px-3 py-1 rounded-full bg-slate-950/70 border border-slate-700 text-xs font-bold text-white">
                {countdownText(item.start_time, item.end_time)}
              </span>
            )}
          </div>
        </div>
      </div>

      {off && (
        <div className="mb-4 p-3 rounded-xl border border-rose-700/60 bg-rose-950/40 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            {tone.label}
            {item.cancel_reason || item.status_reason ? ` — ${item.cancel_reason || item.status_reason}` : ''}. You don't need to go to this shift.
          </span>
        </div>
      )}

      {mustRead && (
        <div className="mb-4 p-3 rounded-xl border-2 border-amber-500 bg-amber-500/10 text-amber-100 text-sm flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-400" />
          <div>
            <div className="font-black">{item.info_change ? 'This shift was updated' : 'Please read before your shift'}</div>
            {item.info_change && <div className="text-xs mt-0.5 text-amber-200">{item.info_change}</div>}
            <div className="text-xs mt-1 text-amber-200/80">Tap “Got it” at the bottom so your manager knows you've seen it.</div>
          </div>
        </div>
      )}
      {ackedNow && (
        <div className="mb-4 p-3 rounded-xl border border-emerald-700 bg-emerald-950/60 text-emerald-200 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Thanks — your manager can see you've read this.
        </div>
      )}
      {ackError && <div className="mb-4 p-3 rounded-xl border border-rose-700 bg-rose-950/60 text-rose-200 text-sm">{ackError}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* LEFT: where + pay */}
        <div className="md:col-span-2 space-y-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex gap-2.5">
              <MapPin className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Where</div>
                {/* Phase 27: event location (caterer / off-site) if set, otherwise the venue */}
                <div className="text-sm font-semibold text-white">{whereOf(item).name}</div>
                {whereOf(item).address && <div className="text-xs text-slate-300">{whereOf(item).address}</div>}
                {whereOf(item).isOffsite && <div className="text-[11px] text-slate-500">Staffed by {item.venue?.name}</div>}
              </div>
            </div>
            {item.booked && !off && (
              <div className="pl-6 text-[11px] text-slate-400 space-y-0.5">
                {item.clock_in_opens_at && <div>Clock-in opens at {fmtTime(item.clock_in_opens_at, tz)}.</div>}
                {item.geofence_on && <div>You'll need to be at this location with phone location on to clock in.</div>}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pl-6">
              <a href={mapsUrl(whereOf(item))} target="_blank" rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                <Navigation className="w-3 h-3 text-emerald-400" /> Directions
              </a>
              <Link to={`/venues/${item.venue?.id}`}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3 text-emerald-400" /> Venue profile
              </Link>
            </div>
            {item.venue?.phone && (
              <div className="flex gap-2.5">
                <Phone className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Venue phone</div>
                  <a href={`tel:${item.venue.phone}`} className="text-sm text-slate-100 underline decoration-slate-600">{item.venue.phone}</a>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Pay
            </div>
            {item.pay_rate !== null && item.pay_rate !== undefined ? (
              <div className="text-lg font-black text-emerald-400">${Number(item.pay_rate).toFixed(2)}/hr <span className="text-xs font-semibold text-slate-400">your rate</span></div>
            ) : (
              <PayLabel rate={item.hourly_rate} rateMax={item.hourly_rate_max} className="text-lg font-black text-emerald-400" hiddenText="Pay shared when you're confirmed" />
            )}
            <TipBadge shift={item} />
          </div>
        </div>

        {/* RIGHT: every note, nothing hidden behind a click */}
        <div className="md:col-span-3 space-y-3">
          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
            <StickyNote className="w-4 h-4 text-emerald-400" /> Shift notes
          </h4>
          <NoteCard icon={MapPin} label="When you arrive" text={item.venue?.arrival_instructions} />
          <NoteCard icon={MapPin} label="About this location" text={item.location?.notes} />
          <NoteCard
            icon={Lock}
            label="At this location, for confirmed staff"
            text={item.location_staff_notes}
            tone="staff"
            badge={<span className="ml-auto text-[10px] text-indigo-300">Only booked staff see this</span>}
          />
          <NoteCard icon={Shirt} label="Dress code" text={item.venue?.dress_code} />
          <NoteCard icon={Calendar} label="About this event" text={item.event_notes} />
          <NoteCard icon={Briefcase} label={`${item.role_type} notes`} text={item.role_notes} />
          <NoteCard
            icon={Lock}
            label="For confirmed staff"
            text={item.event_staff_notes}
            tone="staff"
            badge={<span className="ml-auto text-[10px] text-indigo-300">Only booked staff see this</span>}
          />
          <NoteCard
            icon={Lock}
            label={`For confirmed ${item.role_type} staff`}
            text={item.position_staff_notes}
            tone="staff"
            badge={<span className="ml-auto text-[10px] text-indigo-300">Only booked staff see this</span>}
          />
          <NoteCard icon={Info} label="Venue notes" text={item.venue?.default_shift_notes} />

          {item.staff_notes_locked && (
            <div className="p-3 rounded-xl border border-dashed border-indigo-500/40 text-xs text-indigo-200 flex items-start gap-2">
              <Lock className="w-4 h-4 flex-shrink-0" />
              More details for this shift will show here once the manager confirms you.
            </div>
          )}

          {![
            item.venue?.arrival_instructions, item.venue?.dress_code, item.event_notes, item.role_notes,
            item.event_staff_notes, item.position_staff_notes, item.venue?.default_shift_notes,
            item.location?.notes, item.location_staff_notes,
          ].some((t) => t && String(t).trim()) && !item.staff_notes_locked && (
            <p className="text-xs text-slate-500 italic">No notes for this shift.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
