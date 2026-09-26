import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Check, X, Clock, DollarSign, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { fmtDate, fmtTimeRange, fmtTime, fmtShortDate, utcToZonedLocalInput, zonedLocalToUtcIso } from '../utils/venueTime';
import { GEO_LABELS, metersText } from '../utils/listingFormat';

// Phase 27: small flags on each time entry
const GEO_CHIP = {
  on_site: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  outside_geofence: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  manager: 'bg-indigo-500/10 text-indigo-200 border-indigo-500/30',
  auto: 'bg-rose-500/10 text-rose-200 border-rose-500/40',
};

function EntryFlags({ e }) {
  const chips = [];
  const geo = (status, distance, prefix) => {
    if (!status || status === 'not_checked') return;
    const text = `${prefix}: ${GEO_LABELS[status] || status}${status === 'outside_geofence' && distance != null ? ` · ${metersText(distance)}` : ''}`;
    chips.push(<span key={prefix} className={`px-1.5 py-0.5 rounded border text-[10px] ${GEO_CHIP[status] || 'bg-slate-800 text-slate-300 border-slate-700'}`}>{text}</span>);
  };
  geo(e.clock_in_geo_status, e.clock_in_distance_m, 'In');
  if (!e.auto_closed) geo(e.clock_out_geo_status, e.clock_out_distance_m, 'Out');
  if (e.auto_closed) {
    chips.push(<span key="auto" className={`px-1.5 py-0.5 rounded border text-[10px] ${GEO_CHIP.auto}`}>Auto-closed — check hours</span>);
  }
  if (e.late_minutes > 0) {
    chips.push(<span key="late" className="px-1.5 py-0.5 rounded border text-[10px] bg-amber-500/10 text-amber-300 border-amber-500/30">Late {e.late_minutes} min</span>);
  }
  if (!chips.length) return null;
  return <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">{chips}</span>;
}

const STATUS = {
  approved: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
};
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const inputCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white';

export default function TimesheetModal({ eventId, timeZone, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // form = { kind: 'add'|'edit'|'delete'|'noshow'|'rate', requestId, entryId, cin, cout, value, reason }
  const [form, setForm] = useState(null);
  const tz = data?.timezone || timeZone;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/events/${eventId}/timesheet`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load the time sheet.');
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
      onChanged && onChanged();
    } catch (err) {
      setError(err.response?.data?.detail || 'That change did not save.');
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    const f = form;
    if (!f) return;
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
    if (f.kind === 'rate') {
      const v = f.value === '' ? null : parseFloat(f.value);
      if (v !== null && (Number.isNaN(v) || v <= 0)) return setError('Pay must be more than $0, or blank for the posted rate.');
      return run(() => api.put(`/requests/${f.requestId}/pay-rate`, { pay_rate: v, reason: f.reason.trim() || null }));
    }
    return null;
  };

  const FormRow = () => {
    const f = form;
    return (
      <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-700 space-y-2">
        {(f.kind === 'add' || f.kind === 'edit') && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-400">In
              <input type="datetime-local" value={f.cin} onChange={(e) => setForm({ ...f, cin: e.target.value })} className={`${inputCls} block mt-0.5`} />
            </label>
            <label className="text-[11px] text-slate-400">Out
              <input type="datetime-local" value={f.cout} onChange={(e) => setForm({ ...f, cout: e.target.value })} className={`${inputCls} block mt-0.5`} />
            </label>
          </div>
        )}
        {f.kind === 'rate' && (
          <label className="text-[11px] text-slate-400 block">Actual pay for this person ($/hr, blank = posted rate)
            <input type="number" step="0.5" min="0" value={f.value} onChange={(e) => setForm({ ...f, value: e.target.value })} className={`${inputCls} block mt-0.5 w-32`} />
          </label>
        )}
        {f.kind === 'delete' && <p className="text-xs text-rose-300">Delete this time entry?</p>}
        {f.kind === 'noshow' && <p className="text-xs text-rose-300">Mark as a no-show? This counts against their reliability.</p>}
        <input
          value={f.reason}
          onChange={(e) => setForm({ ...f, reason: e.target.value })}
          placeholder={f.kind === 'noshow' || f.kind === 'rate' ? 'Note (optional)' : 'Reason for the change (required)'}
          className={`${inputCls} w-full`}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 inline-flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
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
      title={data ? `Time sheet — ${data.title}` : 'Time sheet'}
      subtitle={data ? `${fmtDate(data.start_time, tz)} • ${fmtTimeRange(data.start_time, data.end_time, tz)}` : null}
      icon={<ClipboardList className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={data ? (
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-300">
            Total <strong className="text-white">{data.total_hours.toFixed(2)} h</strong> · Est. pay <strong className="text-emerald-400">{money(data.total_pay)}</strong>
          </span>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Done</button>
        </div>
      ) : null}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {loading && !data ? (
        <p className="text-sm text-slate-500 text-center py-10">Loading…</p>
      ) : data && data.people.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-10">No one is booked on this shift yet.</p>
      ) : data ? (
        <div className="space-y-3">
          {data.people.map((p) => {
            const st = STATUS[p.status] || { label: p.status, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
            const canNoShow = data.started && ['approved', 'confirmed'].includes(p.status) && p.entries.length === 0;
            const formHere = form && form.requestId === p.request_id;
            return (
              <div key={p.request_id} className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p.role_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <button type="button"
                      onClick={() => setForm({ kind: 'rate', requestId: p.request_id, value: p.pay_rate_custom ? String(p.pay_rate) : '', reason: '' })}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-emerald-300"
                      title={p.rate_max ? `Posted range $${p.rate_min}–$${p.rate_max}` : `Posted rate $${p.rate_min}`}>
                      <DollarSign className="w-3.5 h-3.5" /> {money(p.pay_rate)}/hr{p.pay_rate_custom ? ' (set)' : ''}
                    </button>
                    <span className="text-slate-400"><Clock className="w-3.5 h-3.5 inline" /> {p.total_hours.toFixed(2)} h</span>
                    <span className="text-emerald-400 font-semibold">{money(p.est_pay)}</span>
                  </div>
                </div>

                {p.entries.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {p.entries.map((e) => (
                      <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-slate-900 rounded-lg px-2.5 py-1.5">
                        <span>
                          {fmtShortDate(e.clock_in_time, tz)} · {fmtTime(e.clock_in_time, tz)} → {e.clock_out_time ? fmtTime(e.clock_out_time, tz) : <span className="text-amber-300">still clocked in</span>}
                          <span className="text-slate-500"> · {e.hours.toFixed(2)} h</span>
                          {e.edited && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] border border-amber-500/30">edited</span>}
                          <EntryFlags e={e} />
                        </span>
                        <span className="flex items-center gap-1">
                          <button type="button" title="Edit"
                            onClick={() => setForm({ kind: 'edit', requestId: p.request_id, entryId: e.id, cin: utcToZonedLocalInput(e.clock_in_time, tz), cout: e.clock_out_time ? utcToZonedLocalInput(e.clock_out_time, tz) : '', reason: '' })}
                            className="p-1.5 rounded text-slate-400 hover:text-amber-300"><Pencil className="w-3.5 h-3.5" /></button>
                          <button type="button" title="Delete"
                            onClick={() => setForm({ kind: 'delete', requestId: p.request_id, entryId: e.id, reason: '' })}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!formHere && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button"
                      onClick={() => setForm({ kind: 'add', requestId: p.request_id, cin: utcToZonedLocalInput(data.start_time, tz), cout: utcToZonedLocalInput(data.end_time, tz), reason: '' })}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs inline-flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add time
                    </button>
                    {canNoShow && (
                      <button type="button" onClick={() => setForm({ kind: 'noshow', requestId: p.request_id, reason: '' })}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-300 text-xs inline-flex items-center gap-1 border border-rose-600/30">
                        <AlertTriangle className="w-3 h-3" /> Mark no-show
                      </button>
                    )}
                  </div>
                )}

                {formHere && <FormRow />}
              </div>
            );
          })}
        </div>
      ) : null}
    </ModalShell>
  );
}
