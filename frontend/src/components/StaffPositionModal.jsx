import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, Search, Send, Check, AlertTriangle, Clock, Lock, CalendarOff, BadgeCheck, Briefcase } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';

const MAX_OFFER = 5;

/**
 * Phase 29: Fill a position with specific people.
 *   Assign  -> books that person now (they get a notification).
 *   Offer   -> sends the position to 1-5 people; the first to accept is booked.
 * Props: event (VenueEventResponse), position (EventPosition), onClose, onDone(message)
 */
export default function StaffPositionModal({ event, position, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);   // worker ids
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);          // 'offer' | `assign-${id}`
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState([]);

  const spotsLeft = Math.max(0, (position.capacity || 1) - (position.assigned?.length || 0));
  const started = new Date(event.start_time).getTime() <= Date.now();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/shifts/${position.shift_id}/candidates`, { params: debouncedQ ? { q: debouncedQ } : {} })
      .then((res) => active && setCandidates(res.data || []))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load people.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [position.shift_id, debouncedQ]);

  const selectable = (c) => (c.available || c.requested_this) && !c.offered && !(c.dropped_at && !c.requested_this)   // Phase 29.4
    && !(c.missing_certs || []).length && c.time_off !== 'blocked';                                                // Phase 32 / 32.1
  const toggle = (c) => {
    if (!selectable(c)) return;
    setSelected((prev) => {
      if (prev.includes(c.worker_id)) return prev.filter((x) => x !== c.worker_id);
      if (prev.length >= MAX_OFFER) return prev;
      return [...prev, c.worker_id];
    });
  };

  const [reasonFor, setReasonFor] = useState(null);   // Phase 29.4: candidate who dropped this event
  const [reason, setReason] = useState('');
  const [warnFor, setWarnFor] = useState(null);       // Phase 31 + 32: "Assign anyway?" for this candidate

  const assign = async (c, why = null, confirmed = false) => {
    // Phase 31 + 32: missing certificates, time off or outside their availability -> ask first
    if (!confirmed && warningsOf(c).length) {
      setWarnFor(c.worker_id);
      return;
    }
    setWarnFor(null);
    // Phase 29.4: someone who dropped this event needs a reason (unless they asked back themselves)
    if (c.dropped_at && !c.requested_this && why === null) {
      setReasonFor(c.worker_id);
      setReason('');
      return;
    }
    setBusy(`assign-${c.worker_id}`);
    setError('');
    try {
      const res = await api.post(`/shifts/${position.shift_id}/assign`, { worker_id: c.worker_id, reason: why || undefined });
      onDone(res.data.message);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not assign.');
    } finally {
      setBusy(null);
    }
  };

  const sendOffers = async () => {
    setBusy('offer');
    setError('');
    setSkipped([]);
    try {
      const res = await api.post(`/shifts/${position.shift_id}/offers`, {
        worker_ids: selected,
        message: message.trim() || null,
      });
      if (res.data.offered > 0) {
        const extra = res.data.skipped?.length ? ` (${res.data.skipped.length} skipped)` : '';
        onDone(res.data.message + extra);
      } else {
        setSkipped(res.data.skipped || []);
        setError(res.data.message || 'No offers sent.');
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send the offers.');
    } finally {
      setBusy(null);
    }
  };

  const nameOf = useMemo(() => {
    const m = {};
    candidates.forEach((c) => {
      m[c.worker_id] = `${c.first_name} ${c.last_name}`.trim() || c.email;
    });
    return m;
  }, [candidates]);

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Close
      </button>
      <button
        type="button"
        onClick={sendOffers}
        disabled={!selected.length || busy !== null || started}
        title={started ? 'This shift has started. Use Assign.' : ''}
        className="px-5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
      >
        <Send className="w-4 h-4" />
        {busy === 'offer' ? 'Sending…' : selected.length ? `Offer to ${selected.length} selected` : 'Offer to selected'}
      </button>
    </>
  );

  return (
    <ModalShell
      title={`Fill ${position.role_type}`}
      subtitle={`${event.title} · ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
      icon={<UserPlus className="w-5 h-5 text-brand-400" />}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={footer}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          <strong className="text-slate-200">Assign</strong> books someone right now.{' '}
          <strong className="text-slate-200">Offer</strong> sends it to up to {MAX_OFFER} people at once; the first to accept gets it
          and the other offers close.
        </p>

        {error && (
          <div className="p-3 rounded-xl text-sm border bg-rose-950/60 border-rose-700 text-rose-200">
            {error}
            {skipped.length > 0 && (
              <ul className="mt-1 text-xs list-disc pl-5">
                {skipped.map((s) => (
                  <li key={s.worker_id}>{s.name}: {s.reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your team, or people who let venues find them"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 py-6 text-center">Loading…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            {debouncedQ ? 'No one matches.' : 'No one on your team yet. Invite people from the Team page, or search by name.'}
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => {
              const isSel = selected.includes(c.worker_id);
              const canPick = selectable(c);
              return (
                <div
                  key={c.worker_id}
                  className={`p-3 rounded-xl border flex flex-wrap items-center gap-3 ${
                    isSel ? 'border-brand-500/60 bg-brand-500/5' : 'border-slate-800 bg-slate-950'
                  } ${canPick ? '' : 'opacity-70'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    disabled={!canPick || (!isSel && selected.length >= MAX_OFFER)}
                    onChange={() => toggle(c)}
                    aria-label={`Select ${nameOf[c.worker_id]}`}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-brand-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">{nameOf[c.worker_id]}</span>
                      <RatingBadge rating={c.aggregate_rating} count={c.rating_count} />
                      {c.reliability_score !== null && c.reliability_score !== undefined && (
                        <span className="text-[10px] text-slate-400">{Math.round(c.reliability_score)}% reliable</span>
                      )}
                      {c.position_match && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-0.5">
                          <Check className="w-3 h-3" /> {position.role_type}
                        </span>
                      )}
                      {!c.on_team && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">Not on team</span>
                      )}
                      {c.requested_this && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">Requested this</span>
                      )}
                      {c.offered && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 inline-flex items-center gap-0.5">
                          <Clock className="w-3 h-3" /> Offer waiting
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {c.venue_shifts > 0 ? `${c.venue_shifts} shift${c.venue_shifts === 1 ? '' : 's'} here` : 'Hasn’t worked here yet'}
                      {c.positions?.length > 0 && ` · ${c.positions.join(', ')}`}
                    </div>
                    {c.reason && (
                      <div className="text-[11px] text-amber-300 mt-0.5 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {c.reason}
                      </div>
                    )}
                    {c.dropped_at && (
                      <div className="text-[11px] text-rose-300 mt-0.5">
                        Dropped this event on {new Date(c.dropped_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        {c.drop_reason ? ` · “${c.drop_reason}”` : ''}. {c.requested_this ? 'They asked to come back.' : 'Assign needs a reason; offers skip them.'}
                      </div>
                    )}
                    <FitChips c={c} />
                    {warnFor === c.worker_id && (
                      <div className="mt-2 p-2 rounded-lg border border-amber-500/40 bg-amber-500/5 flex flex-wrap items-center gap-2 w-full">
                        <span className="text-xs text-amber-200 flex-1 min-w-[12rem]">
                          Assign anyway? {warningsOf(c).join(' · ')}.
                        </span>
                        <button type="button" onClick={() => assign(c, null, true)} disabled={busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold disabled:opacity-40">Assign anyway</button>
                        <button type="button" onClick={() => setWarnFor(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
                      </div>
                    )}
                    {reasonFor === c.worker_id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))}
                          onKeyDown={(e) => e.key === 'Enter' && reason.trim().length >= 5 && assign(c, reason.trim(), true)}
                          placeholder="Why are you booking them back?"
                          className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500" />
                        <button type="button" onClick={() => assign(c, reason.trim(), true)} disabled={reason.trim().length < 5 || busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold disabled:opacity-40">Book back</button>
                        <button type="button" onClick={() => setReasonFor(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => assign(c)}
                    disabled={!(c.available || c.requested_this) || busy !== null || spotsLeft === 0}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-brand-500 text-brand-300 hover:text-slate-950 border border-slate-700 text-xs font-bold disabled:opacity-40"
                  >
                    {busy === `assign-${c.worker_id}` ? '…' : c.requested_this ? 'Approve' : 'Assign'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Message with the offer (optional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. We're short on the main bar. Can you help?"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">{selected.length}/{MAX_OFFER} selected.</p>
        </div>
      </div>
    </ModalShell>
  );
}


/** Phase 31 + 32: what a manager should know before booking this person. */
export function warningsOf(c) {
  const out = [];
  if ((c.missing_certs || []).length) out.push(`Missing ${c.missing_certs.join(', ')}`);
  if (c.availability === 'outside') out.push('Outside their availability');
  if (c.department_match === 'outside') out.push('Outside the departments they work');   // Phase 32.2
  return out;
}

function FitChips({ c }) {
  const chip = 'px-1.5 py-0.5 rounded text-[10px] font-semibold border inline-flex items-center gap-0.5';
  const items = [];
  (c.missing_certs || []).forEach((m) => items.push(
    <span key={`m-${m}`} className={`${chip} bg-rose-500/10 text-rose-300 border-rose-500/30`}><Lock className="w-3 h-3" /> No {m}</span>,
  ));
  (c.unverified_certs || []).forEach((m) => items.push(
    <span key={`u-${m}`} className={`${chip} bg-sky-500/10 text-sky-300 border-sky-500/30`}><BadgeCheck className="w-3 h-3" /> {m} not verified</span>,
  ));
  if (c.time_off === 'blocked') items.push(   // Phase 32.1: their time-off block (can't be assigned or offered)
    <span key="off" className={`${chip} bg-rose-500/10 text-rose-300 border-rose-500/30`}>
      <CalendarOff className="w-3 h-3" /> Time off{c.time_off_reason ? `: ${c.time_off_reason}` : ''}
    </span>,
  );
  if (c.department_match === 'outside') items.push(   // Phase 32.2
    <span key="dept" className={`${chip} bg-amber-500/10 text-amber-300 border-amber-500/30`}><Briefcase className="w-3 h-3" /> Other department</span>,
  );
  if (c.availability === 'outside') items.push(
    <span key="av" className={`${chip} bg-slate-800 text-slate-300 border-slate-700`}><CalendarOff className="w-3 h-3" /> Outside their availability</span>,
  );
  if (c.availability === 'fits') items.push(
    <span key="fit" className={`${chip} bg-emerald-500/10 text-emerald-300 border-emerald-500/30`}><Check className="w-3 h-3" /> Available</span>,
  );
  return items.length ? <div className="flex flex-wrap gap-1 mt-1">{items}</div> : null;
}
