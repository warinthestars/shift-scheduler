import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus,
  Zap, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Briefcase, Lock, Repeat,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { DeptChip } from '../utils/departments';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange, fmtDate } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, statusLabel, PENDING_STATUSES, whereOf,
} from '../utils/listingFormat';

// Statuses on a position that the server will refuse to re-open.
const LOCKED_POSITION_STATUSES = ['rejected', 'removed', 'no_show', 'transferred', 'cancelled'];   // Phase 29.4: 'dropped' can ask back
const ASK_BACK_MIN = 5;

function pickDefault(listing, prev) {
  if (!listing) return null;
  if (prev && listing.positions.some((p) => p.shift_id === prev)) return prev;
  if (listing.my_request) return listing.my_request.shift_id;
  const open = listing.positions.filter((p) => p.status === 'OPEN' && !(p.missing_certs || []).length);   // Phase 32
  return open.length === 1 ? open[0].shift_id : null;
}

/**
 * Phase 32.3: one other date in this event's series, for the position the worker picked (matched by name).
 * reason = why it can't be picked; warn = pickable but not ticked by default.
 */
function seriesRow(ev, roleType) {
  const role = (roleType || '').trim().toLowerCase();
  const pos = (ev.positions || []).find((p) => (p.role_type || '').trim().toLowerCase() === role) || null;
  let reason = null;
  if (ev.my_request) {
    reason = PENDING_STATUSES.includes(String(ev.my_request.status).toLowerCase())
      ? `You already asked for ${ev.my_request.role_type}`
      : `You're booked as ${ev.my_request.role_type}`;
  } else if (!pos) reason = `No ${roleType} spot on this date`;
  else if (pos.status !== 'OPEN') reason = 'Full';
  else if ((pos.missing_certs || []).length) reason = `You need: ${pos.missing_certs.join(', ')}`;
  else if (ev.conflict) reason = `Overlaps your shift (${ev.conflict})`;
  else if (ev.dropped_here) reason = 'You dropped a shift here. Open that date to ask back.';
  else if (!ev.can_request) reason = "Can't be requested";
  const pickable = !reason;
  const warn = !pickable ? null : ev.time_off ? 'During your time off' : ev.availability === 'outside' ? 'Outside your weekly availability' : null;
  return { pos, reason, pickable, warn, defaultOn: pickable && !warn };
}

function InfoBlock({ icon: Icon, label, children }) {
  if (!children) return null;
  return (
    <div className="flex gap-2.5">
      <Icon className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-xs text-slate-200 whitespace-pre-line break-words">{children}</div>
      </div>
    </div>
  );
}

/**
 * Phase 26.1: Event details + request flow for workers.
 * Props:
 *   eventId         (required) event to show; always re-fetched from GET /api/listings/{eventId}
 *   initial         optional listing object from the card list (shown instantly while loading)
 *   onClose()       close the modal
 *   onChanged(res)  called after a successful request / switch / withdraw (parent refreshes lists)
 *   onGoToSchedule() optional; shows a "Go to My shifts" button when the worker is booked
 */
export default function EventListingModal({ eventId, initial = null, onClose, onChanged, onGoToSchedule }) {
  const [listing, setListing] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(() => pickDefault(initial, null));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success' | 'info' | 'error', message }
  const [seriesPicks, setSeriesPicks] = useState(() => new Set());   // Phase 32.3: event_ids of other dates to request too

  const applyListing = (next, resetSelection = false) => {
    setListing(next);
    setSelectedId((prev) => pickDefault(next, resetSelection ? null : prev));
  };

  const reload = async (resetSelection = false) => {
    try {
      const res = await api.get(`/listings/${eventId}`);
      applyListing(res.data, resetSelection);
      setLoadError('');
    } catch (err) {
      setLoadError(err.response?.data?.detail || 'Could not load this event.');
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(!initial);
    api
      .get(`/listings/${eventId}`)
      .then((res) => {
        if (alive) applyListing(res.data, false);
      })
      .catch((err) => {
        if (alive) setLoadError(err.response?.data?.detail || 'Could not load this event.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Phase 32.3: whenever the event or the picked position changes, tick the other dates that are open and fit
  useEffect(() => {
    const sel = listing?.positions?.find((p) => p.shift_id === selectedId);
    if (!sel || !(listing?.series || []).length) {
      setSeriesPicks(new Set());
      return;
    }
    setSeriesPicks(new Set(listing.series.filter((ev) => seriesRow(ev, sel.role_type).defaultOn).map((ev) => ev.event_id)));
  }, [listing, selectedId]);

  const sendRequest = async (isSwitch, extraDates = []) => {
    if (!selectedId) return;
    setSubmitting(true);
    setResult(null);
    const noteText = note.trim() ? note.trim() : null;
    try {
      const res = await api.post(`/listings/${eventId}/request`, {
        shift_id: selectedId,
        note: noteText,
        switch: Boolean(isSwitch),
      });
      if (!extraDates.length) {
        setResult({ type: res.data.instant ? 'success' : 'info', message: res.data.message });
        if (res.data.listing) applyListing(res.data.listing, true);
      } else {
        // Phase 32.3: one request per extra date, each checked by the server on its own
        let booked = res.data.instant ? 1 : 0;
        let waiting = res.data.instant ? 0 : 1;
        const failed = [];
        for (const d of extraDates) {
          try {
            const r = await api.post(`/listings/${d.event_id}/request`, { shift_id: d.shift_id, note: noteText });
            if (r.data.instant) booked += 1; else waiting += 1;
          } catch (err) {
            failed.push(`${d.label}: ${err.response?.data?.detail || 'could not be sent'}`);
          }
        }
        const lines = [];
        if (booked) lines.push(`Booked ${booked} ${booked === 1 ? 'date' : 'dates'}. They're on your schedule.`);
        if (waiting) lines.push(`${waiting} ${waiting === 1 ? 'request' : 'requests'} sent. The manager reviews each date.`);
        if (failed.length) lines.push(`Not sent:\n${failed.join('\n')}`);
        setResult({ type: failed.length ? 'error' : booked && !waiting ? 'success' : 'info', message: lines.join('\n') });
        await reload(true);
      }
      setNote('');
      if (onChanged) onChanged(res.data);
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not send your request.' });
      reload(false);
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!listing?.my_request) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.post(`/listings/requests/${listing.my_request.request_id}/withdraw`);
      setResult({ type: 'info', message: res.data.message });
      if (res.data.listing) applyListing(res.data.listing, true);
      if (onChanged) onChanged(res.data);
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not withdraw your request.' });
      reload(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!listing) {
    return (
      <ModalShell title="Shift details" onClose={onClose} maxWidth="max-w-md">
        <p className="text-sm text-center py-10 text-slate-400">
          {loading ? 'Loading…' : loadError || 'Event not found.'}
        </p>
      </ModalShell>
    );
  }

  const tz = listing.venue?.timezone;
  const mine = listing.my_request;
  const mineStatus = mine ? String(mine.status).toLowerCase() : null;
  const isWaiting = mine && PENDING_STATUSES.includes(mineStatus);
  const isBooked = mine && !isWaiting;
  const selected = listing.positions.find((p) => p.shift_id === selectedId) || null;
  const selectedIsMine = selected && mine && selected.shift_id === mine.shift_id;
  const bookedPosition = isBooked ? listing.positions.find((p) => p.shift_id === mine.shift_id) : null;
  // Phase 29.4: they dropped a position in this event -> asking back needs a reason and the manager's OK
  const askingBack = !!listing.dropped_here && !isBooked;
  const noteOk = !askingBack || note.trim().length >= ASK_BACK_MIN;
  // Phase 32.3: other dates of this series, offered only for a fresh request (not a switch or an ask-back)
  const seriesOn = !!selected && !selectedIsMine && !mine && !askingBack && !listing.cancelled && !listing.started
    && !listing.conflict && (listing.series || []).length > 0;
  const seriesRows = seriesOn ? listing.series.map((ev) => ({ ev, row: seriesRow(ev, selected.role_type) })) : [];
  const pickableIds = seriesRows.filter((x) => x.row.pickable).map((x) => x.ev.event_id);
  const allPicked = pickableIds.length > 0 && pickableIds.every((id) => seriesPicks.has(id));
  const togglePick = (id) => setSeriesPicks((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addToCalendar = () =>
    downloadIcs({
      uid: `${listing.event_id}@shiftboard`,
      title: `${listing.title} — ${mine?.role_type || 'Shift'} (${listing.venue?.name || ''})`,
      start: listing.start_time,
      end: listing.end_time,
      location: whereOf(listing).address,
      description: [
        listing.notes,
        listing.location?.notes,
        listing.location_staff_notes,
        listing.venue?.arrival_instructions,
        listing.venue?.dress_code && `Dress code: ${listing.venue.dress_code}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

  // ---- Footer actions --------------------------------------------------------------------
  let primary = null;
  let secondary = null;
  let danger = null;          // Phase 32.3: undo-type action (Withdraw). Always far left, never where the primary button was.
  let blockedReason = null;
  if (listing.cancelled) {
    blockedReason = `This event was cancelled${listing.cancel_reason ? `: ${listing.cancel_reason}` : '.'}`;
  } else if (isBooked) {
    secondary = (
      <button type="button" onClick={addToCalendar} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
        <CalendarPlus className="w-4 h-4 text-emerald-400" /> Add to calendar
      </button>
    );
    if (onGoToSchedule) {
      primary = (
        <button type="button" onClick={onGoToSchedule} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold">
          Go to My shifts
        </button>
      );
    }
  } else if (listing.started) {
    blockedReason = 'This shift has already started.';
  } else {
    if (isWaiting) {
      danger = (
        <button type="button" onClick={withdraw} disabled={submitting} className="px-4 py-2 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold disabled:opacity-50 mr-auto">
          Withdraw request
        </button>
      );
    }
    if (listing.conflict) {
      blockedReason = `This overlaps a shift you're booked on (${listing.conflict}).`;
    } else if (!selected) {
      primary = (
        <button type="button" disabled className="px-5 py-2 rounded-xl bg-slate-800 text-slate-500 text-xs font-bold cursor-not-allowed">
          Pick a position
        </button>
      );
    } else if (!selectedIsMine) {
      const extraDates = seriesOn ? seriesRows.filter((x) => x.row.pickable && seriesPicks.has(x.ev.event_id)) : [];   // Phase 32.3
      const label = isWaiting
        ? `Switch to ${selected.role_type}`
        : askingBack
        ? 'Ask to come back'
        : extraDates.length
        ? `Request ${extraDates.length + 1} dates`
        : selected.booking === 'instant'
        ? 'Book instantly'
        : 'Send request';
      primary = (
        <button
          type="button"
          onClick={() => sendRequest(isWaiting, extraDates.map((x) => ({
            event_id: x.ev.event_id, shift_id: x.row.pos.shift_id, label: fmtDate(x.ev.start_time, x.ev.venue?.timezone || tz),
          })))}
          disabled={submitting || !listing.can_request || selected.status !== 'OPEN' || !noteOk}
          title={noteOk ? undefined : 'Tell the manager why you can make it now'}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {selected.booking === 'instant' && !extraDates.length && <Zap className="w-4 h-4" />}
          {submitting ? 'Sending…' : label}
        </button>
      );
    }
  }

  // Phase 32.3: Withdraw sits far left; Close takes the right-hand spot when there's no primary action,
  // so a second click right after "Send request" closes the popup instead of withdrawing.
  const footer = (
    <>
      {danger}
      <button type="button" onClick={onClose} className={`px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 ${danger ? '' : 'mr-auto'}`}>
        Close
      </button>
      {secondary}
      {primary}
    </>
  );

  const showNoteBox = !isBooked && !listing.cancelled && !listing.started && !listing.conflict && selected && !selectedIsMine;

  return (
    <ModalShell
      title={listing.title}
      subtitle={
        <span>
          {listing.venue?.name} · {fmtLongDate(listing.start_time, tz)}
        </span>
      }
      icon={<Briefcase className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      {result && (
        <div
          className={`mb-4 p-3 rounded-xl border text-sm flex items-start gap-2 ${
            result.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
              : result.type === 'error'
              ? 'bg-rose-950/70 border-rose-700 text-rose-200'
              : 'bg-indigo-950/70 border-indigo-700 text-indigo-200'
          }`}
        >
          {result.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span className="whitespace-pre-line">{result.message}</span>
        </div>
      )}

      {askingBack && !listing.cancelled && !listing.started && (
        <div className="mb-4 p-3 rounded-xl border border-slate-600 bg-slate-800/60 text-slate-200 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 text-slate-300" />
          <span>
            You dropped a shift at this event. You can ask to come back: tell the manager why you can make it now.
            It always needs their approval, and until they say yes the drop still counts on your reliability.
          </span>
        </div>
      )}

      {listing.time_off && !isBooked && (
        <div className="mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 border-amber-700/60 bg-amber-950/40 text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            This is during time you blocked off. You can still request it if your plans changed; managers can’t book you
            into it themselves.{' '}
            <Link to="/profile?tab=time-off" onClick={onClose} className="font-bold underline hover:text-amber-100">Your time off</Link>
          </span>
        </div>
      )}

      {blockedReason && (
        <div className="mb-4 p-3 rounded-xl border border-amber-700/60 bg-amber-950/40 text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{blockedReason}</span>
        </div>
      )}

      {isBooked && (
        <div className="mb-4 p-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 text-emerald-200 text-sm">
          <div className="font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> You're booked as {mine.role_type}
          </div>
          <p className="text-xs text-emerald-300/80 mt-1">
            To change position, drop or hand off this shift from My shifts first.
            {bookedPosition && bookedPosition.hourly_rate !== null && (
              <> Pay: <PayLabel rate={bookedPosition.hourly_rate} rateMax={bookedPosition.hourly_rate_max} className="font-semibold" /></>
            )}
          </p>
          {/* Phase 26.2: staff-only notes, shown once confirmed */}
          {(listing.staff_notes || bookedPosition?.staff_notes || listing.location_staff_notes) && (
            <div className="mt-3 space-y-2">
              {listing.location_staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
                  <div className="font-bold text-indigo-300 flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> At this location, for confirmed staff</div>
                  {listing.location_staff_notes}
                </div>
              )}
              {listing.staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
                  <div className="font-bold text-indigo-300 flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> For confirmed staff</div>
                  {listing.staff_notes}
                </div>
              )}
              {bookedPosition?.staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
                  <div className="font-bold text-indigo-300 flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> For confirmed {bookedPosition.role_type} staff</div>
                  {bookedPosition.staff_notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* LEFT: event + venue info */}
        <div className="md:col-span-2 space-y-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <InfoBlock icon={Calendar} label="When">
              {fmtLongDate(listing.start_time, tz)}
            </InfoBlock>
            <InfoBlock icon={Clock} label="Hours">
              {fmtTimeRange(listing.start_time, listing.end_time, tz)} · {hoursText(listing.hours)}
            </InfoBlock>
            <InfoBlock icon={MapPin} label="Where">
              {/* Phase 27: event location (caterer / off-site) if set, otherwise the venue */}
              <span className="font-semibold">{whereOf(listing).name}</span>
              {whereOf(listing).address ? `\n${whereOf(listing).address}` : ''}
              {whereOf(listing).isOffsite ? `\nStaffed by ${listing.venue?.name}` : ''}
            </InfoBlock>
            {listing.geofence_on && (
              <p className="text-[11px] text-slate-400 pl-6">You'll need to be at this location (with phone location on) to clock in.</p>
            )}
            <div className="flex flex-wrap gap-2 pl-6">
              <a
                href={mapsUrl(whereOf(listing))}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
              >
                <Navigation className="w-3 h-3 text-emerald-400" /> Directions
              </a>
              <Link
                to={`/venues/${listing.venue?.id}`}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3 text-emerald-400" /> Venue profile
              </Link>
            </div>
            {listing.venue?.phone && (
              <InfoBlock icon={Phone} label="Venue phone">
                <a href={`tel:${listing.venue.phone}`} className="underline decoration-slate-600">{listing.venue.phone}</a>
              </InfoBlock>
            )}
          </div>

          {(listing.notes || listing.location?.notes || listing.venue?.default_shift_notes || listing.venue?.dress_code || listing.venue?.arrival_instructions) && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <InfoBlock icon={StickyNote} label="About this event">{listing.notes}</InfoBlock>
              <InfoBlock icon={MapPin} label="About this location">{listing.location?.notes}</InfoBlock>
              <InfoBlock icon={Shirt} label="Dress code">{listing.venue?.dress_code}</InfoBlock>
              <InfoBlock icon={MapPin} label="When you arrive">{listing.venue?.arrival_instructions}</InfoBlock>
              <InfoBlock icon={Info} label="Venue notes">{listing.venue?.default_shift_notes}</InfoBlock>
            </div>
          )}
        </div>

        {/* RIGHT: positions */}
        <div className="md:col-span-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-bold text-white">Positions</h4>
            <span className="text-[11px] text-slate-400">You can request one position per event</span>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label="Positions">
            {listing.positions.map((p) => {
              const full = p.status !== 'OPEN';
              const ps = p.my_status ? String(p.my_status).toLowerCase() : null;
              const isMine = mine && mine.shift_id === p.shift_id;
              const locked = LOCKED_POSITION_STATUSES.includes(ps);
              const needsCerts = !isMine && !full && (p.missing_certs || []).length > 0;          // Phase 32
              const disabled = !isMine && (full || locked || needsCerts || isBooked || listing.cancelled || listing.started);
              const active = selectedId === p.shift_id;
              const est = estPayText(p);
              return (
                <button
                  key={p.shift_id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => setSelectedId(p.shift_id)}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
                  } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-slate-800' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${active ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'}`} />
                        <span className="text-sm font-bold text-white">{p.role_type}</span>
                        <TipBadge shift={p} />
                        {p.booking === 'instant' ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <Zap className="w-2.5 h-2.5" /> Instant book
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            <ShieldCheck className="w-2.5 h-2.5" /> Needs approval
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <DeptChip dept={p.department} />
                        {p.department_match === 'outside' && !full && !isMine && (
                          <span className="text-[11px] text-amber-300">Outside your departments, so a manager has to approve it</span>
                        )}
                      </div>
                      {p.role_notes && <p className="text-[11px] text-slate-400 mt-1.5 whitespace-pre-line">{p.role_notes}</p>}
                      {(p.required_certs || []).length > 0 && (
                        <p className={`text-[11px] mt-1.5 inline-flex items-center gap-1 ${needsCerts ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}>
                          <Lock className="w-3 h-3" />
                          {needsCerts ? `You need: ${p.missing_certs.join(', ')}` : `Requires: ${p.required_certs.join(', ')}`}
                        </p>
                      )}
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
                          {ps === 'dropped' ? 'You dropped this' : `You: ${statusLabel(ps)}`}
                          {p.my_status_reason ? ` — ${p.my_status_reason}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <PayLabel rate={p.hourly_rate} rateMax={p.hourly_rate_max} className="text-sm font-black text-emerald-400" hiddenText="Pay shared when booked" />
                      {est && <div className="text-[10px] text-slate-500">{est} for the shift</div>}
                      <div className={`text-[11px] font-semibold mt-0.5 ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                        {full ? 'Full' : `${p.spots_left} of ${p.capacity} open`}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {listing.positions.some((p) => p.status === 'OPEN' && (p.missing_certs || []).length > 0) && (
            <p className="text-xs text-amber-200 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
              Some positions need certificates you haven't added yet.{' '}
              <Link to="/profile?tab=certificates" onClick={onClose} className="font-bold underline hover:text-amber-100">Add them on your profile</Link>
              , then come back to request.
            </p>
          )}

          {listing.positions.some((p) => p.est_pay_min !== null && p.est_pay_min !== undefined) && (
            <p className="text-[10px] text-slate-500">Estimates are hours × hourly rate, before tips and taxes.</p>
          )}

          {/* Phase 32.3: request the same position on other dates of this series */}
          {seriesOn && (
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
              <div className="flex items-baseline justify-between gap-2">
                <h5 className="text-xs font-bold text-white inline-flex items-center gap-1.5">
                  <Repeat className="w-3.5 h-3.5 text-emerald-400" /> Also request {selected.role_type} on other dates
                </h5>
                {pickableIds.length > 1 && (
                  <button type="button" disabled={submitting}
                    onClick={() => setSeriesPicks(allPicked ? new Set() : new Set(pickableIds))}
                    className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 flex-shrink-0">
                    {allPicked ? 'Clear' : 'Pick all'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                This event repeats. Each date is its own request: it's checked on its own, the manager decides each one,
                and you can withdraw any of them later.
              </p>
              <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {seriesRows.map(({ ev, row }) => {
                  const on = row.pickable && seriesPicks.has(ev.event_id);
                  const evTz = ev.venue?.timezone || tz;
                  return (
                    <label key={ev.event_id}
                      className={`flex items-center gap-2.5 p-2 rounded-lg border ${
                        on ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800'
                      } ${row.pickable ? 'cursor-pointer hover:border-slate-600' : 'opacity-60 cursor-not-allowed'}`}>
                      <input type="checkbox" className="w-4 h-4 accent-emerald-500 flex-shrink-0" checked={on}
                        disabled={!row.pickable || submitting} onChange={() => togglePick(ev.event_id)} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-white">
                          {fmtDate(ev.start_time, evTz)} · {fmtTimeRange(ev.start_time, ev.end_time, evTz)}
                          {ev.title !== listing.title && <span className="font-normal text-slate-400"> · {ev.title}</span>}
                        </span>
                        <span className={`block text-[11px] ${row.reason ? 'text-slate-500' : row.warn ? 'text-amber-300' : 'text-slate-400'}`}>
                          {row.reason || row.warn || (row.pos.booking === 'instant' ? 'Instant book' : 'Needs approval')}
                        </span>
                      </span>
                      {row.pos && row.pos.hourly_rate !== null && row.pos.hourly_rate !== undefined && (
                        <PayLabel rate={row.pos.hourly_rate} rateMax={row.pos.hourly_rate_max} className="text-xs font-bold text-emerald-400 flex-shrink-0" />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {isWaiting && selected && !selectedIsMine && !listing.conflict && (
            <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
              Switching replaces your waiting request for <b>{mine.role_type}</b>.
            </p>
          )}

          {showNoteBox && (
            <div>
              <label className={`block text-[11px] font-semibold mb-1 ${askingBack ? 'text-amber-200' : 'text-slate-400'}`}>
                {askingBack ? 'Why you can make it now (required)' : 'Note for the manager (optional)'}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={2}
                placeholder={askingBack ? 'e.g. My appointment moved, I can do the full shift' : 'e.g. 3 years behind the bar, can stay late'}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <div className="text-[10px] text-slate-500 text-right">{note.length}/500</div>
            </div>
          )}

          {isWaiting && mine.note && (
            <p className="text-[11px] text-slate-400">
              Your note: <span className="text-slate-300">{mine.note}</span>
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
