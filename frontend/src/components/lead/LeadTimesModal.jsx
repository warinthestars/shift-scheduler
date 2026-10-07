import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Check, X, Clock, UserX } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { fmtDate, fmtTimeRange, fmtTime, fmtShortDate, utcToZonedLocalInput, zonedLocalToUtcIso } from '../../utils/venueTime';
import { GEO_LABELS, metersText } from '../../utils/listingFormat';

const STATUS = {
  approved: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
};
const inputCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white';

function flagsOf(e) {
  const out = [];
  if (e.clock_in_geo_status === 'manager') out.push('entered by hand');
  if (e.clock_in_geo_status === 'outside_geofence') {
    out.push(`${GEO_LABELS.outside_geofence || 'away from site'}${e.clock_in_distance_m != null ? ` · ${metersText(e.clock_in_distance_m)}` : ''}`);
  }
  if (e.auto_closed) out.push('auto-closed, check the hours');
  if (e.late_minutes > 0) out.push(`late ${e.late_minutes} min`);
  if (e.edited) out.push('edited');
  return out;
}

/**
 * Phase 36: the shift lead's "Clock times" for one event: who was in and out, and hours.
 * Reads GET /api/lead/events/{eventId}/times, which has NO pay in it. Don't add pay, tips or
 * pay-rate controls here; those live in the manager's TimesheetModal.
 * A lead can add, fix or delete a time (a reason is required and saved), and mark a no-show.
 * They can't change their own row.
 * Props: eventId, timeZone, onClose, onChanged()
 */
export default function LeadTimesModal({ eventId, timeZone, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // form = { kind: 'add' | 'edit' | 'delete' | 'noshow', requestId, entryId, cin, cout, reason }
  const [form, setForm] = useState(null);
  const tz = data?.timezone || timeZone;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/lead/events/${eventId}/times`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load the clock times.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setForm(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.detail || 'That change did not save.');
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    const f = form;
    if (!f) return null;
    if (f.kind === 'add' || f.kind === 'edit') {
      if (!f.cin) return setError('Clock-in time is required.');
      if (!f.reason.trim()) return setError('Add a short reason for the change.');
      const payload = {
        clock_in_time: zonedLocalToUtcIso(f.cin, tz),
        clock_out_time: f.cout ? zonedLocalToUtcIso(f.cout, tz) : null,
        reason: f.reason.trim(),
      };
      return run(() => (f.kind === 'add'
        ? api.post(`/requests/${f.requestId}/time-entries`, payload)
        : api.patch(`/time-entries/${f.entryId}`, payload)));
    }
    if (f.kind === 'delete') {
      if (!f.reason.trim()) return setError('Add a short reason.');
      return run(() => api.post(`/time-entries/${f.entryId}/delete`, { reason: f.reason.trim() }));
    }
    if (f.kind === 'noshow') {
      return run(() => api.post(`/requests/${f.requestId}/no-show`, { reason: f.reason.trim() || null }));
    }
    return null;
  };

  const formRow = () => {
    const f = form;
    return (
      <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-700 space-y-2">
        {(f.kind === 'add' || f.kind === 'edit') && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-400">In
              <input type="datetime-local" value={f.cin} onChange={(e) => setForm({ ...f, cin: e.target.value })} className={`${inputCls} block mt-0.5`} />
            </label>
            <label className="text-[11px] text-slate-400">Out (blank = still working)
              <input type="datetime-local" value={f.cout} onChange={(e) => setForm({ ...f, cout: e.target.value })} className={`${inputCls} block mt-0.5`} />
            </label>
          </div>
        )}
        {f.kind === 'delete' && <p className="text-xs text-rose-300">Delete this time entry?</p>}
        {f.kind === 'noshow' && <p className="text-xs text-rose-300">Mark as a no-show? This counts against their reliability, they’re told, and their spot opens again.</p>}
        <input
          value={f.reason}
          onChange={(e) => setForm({ ...f, reason: e.target.value })}
          placeholder={f.kind === 'noshow' ? 'Note (optional, they’ll see it)' : 'Reason for the change (required)'}
          aria-label={f.kind === 'noshow' ? 'Note' : 'Reason for the change'}
          className={`${inputCls} w-full`}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setForm(null); setError(''); }} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 inline-flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
          <button type="button" onClick={submitForm} disabled={busy}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50 ${f.kind === 'delete' || f.kind === 'noshow' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>
            <Check className="w-3 h-3" /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <ModalShell
      title={data ? `Clock times: ${data.title}` : 'Clock times'}
      subtitle={data ? `${fmtDate(data.start_time, tz)} • ${fmtTimeRange(data.start_time, data.end_time, tz)}` : null}
      icon={<ClipboardList className="w-5 h-5 text-amber-300" />}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={data ? (
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-300">Total <strong className="text-white">{data.total_hours.toFixed(2)} h</strong></span>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Done</button>
        </div>
      ) : null}
    >
      {error && <div role="alert" className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {loading && !data ? (
        <p className="text-sm text-slate-500 text-center py-10">Loading…</p>
      ) : data && data.people.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-10">No one is booked on this event yet.</p>
      ) : data ? (
        <div className="space-y-3">
          {data.people.map((p) => {
            const st = STATUS[p.status] || { label: p.status, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
            const payroll = p.time_tracking === 'payroll';
            const canNoShow = !p.is_you && data.started && ['approved', 'confirmed'].includes(p.status) && p.entries.length === 0;
            const formHere = form && form.requestId === p.request_id;
            return (
              <div key={p.request_id} className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{p.name}{p.is_you ? ' (you)' : ''}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p.role_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                    {payroll && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-violet-500/10 text-violet-300 border-violet-500/30">Venue payroll</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-300 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {p.total_hours.toFixed(2)} h</span>
                </div>
                {p.status === 'no_show' && p.status_reason && <p className="mt-1 text-[11px] text-rose-300">Note: {p.status_reason}</p>}
                {payroll && <p className="mt-1 text-[11px] text-slate-500">Clocks in with the venue’s own system, so there are usually no times here.</p>}

                <ul className="mt-2 space-y-1">
                  {p.entries.map((e) => {
                    const flags = flagsOf(e);
                    return (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <span>
                          {fmtShortDate(e.clock_in_time, tz)} · {fmtTime(e.clock_in_time, tz)} – {e.clock_out_time ? fmtTime(e.clock_out_time, tz) : <em className="text-sky-300 not-italic">still clocked in</em>}
                          <span className="text-slate-500"> · {e.hours.toFixed(2)} h</span>
                          {flags.length > 0 && <span className="text-amber-300/80"> · {flags.join(' · ')}</span>}
                        </span>
                        {!p.is_you && (
                          <span className="inline-flex items-center gap-1">
                            <button type="button" aria-label={`Fix this time for ${p.name}`}
                              onClick={() => { setError(''); setForm({ kind: 'edit', requestId: p.request_id, entryId: e.id, cin: utcToZonedLocalInput(e.clock_in_time, tz), cout: e.clock_out_time ? utcToZonedLocalInput(e.clock_out_time, tz) : '', reason: '' }); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"><Pencil className="w-3.5 h-3.5" /></button>
                            <button type="button" aria-label={`Delete this time for ${p.name}`}
                              onClick={() => { setError(''); setForm({ kind: 'delete', requestId: p.request_id, entryId: e.id, cin: '', cout: '', reason: '' }); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800"><Trash2 className="w-3.5 h-3.5" /></button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {p.entries.length === 0 && !payroll && <li className="text-[11px] text-slate-500">No clock-in yet.</li>}
                </ul>

                {p.is_you ? (
                  <p className="mt-2 text-[11px] text-slate-500">You can’t change your own times. Clock in and out from My shifts, or ask a manager.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button"
                      onClick={() => { setError(''); setForm({ kind: 'add', requestId: p.request_id, entryId: null, cin: utcToZonedLocalInput(p.shift_start || data.start_time, tz), cout: '', reason: '' }); }}   // Phase 37.2: their own shift's start
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add a time
                    </button>
                    {canNoShow && (
                      <button type="button"
                        onClick={() => { setError(''); setForm({ kind: 'noshow', requestId: p.request_id, entryId: null, cin: '', cout: '', reason: '' }); }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/40 text-[11px] font-semibold text-rose-200 inline-flex items-center gap-1">
                        <UserX className="w-3 h-3" /> No-show
                      </button>
                    )}
                  </div>
                )}
                {formHere && formRow()}
              </div>
            );
          })}
        </div>
      ) : null}
    </ModalShell>
  );
}
