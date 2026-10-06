import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Check, X, Clock, DollarSign, AlertTriangle, Coins, Lock } from 'lucide-react';
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

// Phase 35.2: the event's tips: a tip pool shared by tip-pool positions, and own tips per person
const toStr = (n) => (n ? String(Number(n).toFixed(2)) : '');

function TipsPanel({ eventId, refreshKey, onSaved }) {
  const [tips, setTips] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reset = (t) => {
    setTips(t);
    setDraft({
      pool: toStr(t.pool_amount), split: t.split, note: t.note || '',
      own: Object.fromEntries(t.people.map((p) => [p.request_id, toStr(p.individual)])),
    });
  };

  useEffect(() => {
    let alive = true;
    api.get(`/events/${eventId}/tips`)
      .then((res) => { if (alive) reset(res.data); })
      .catch(() => { if (alive) setTips(null); });
    return () => { alive = false; };
  }, [eventId, refreshKey]);

  if (!tips || !draft || !tips.enabled) return null;
  if (!tips.people.some((p) => p.tips_eligible || p.in_pool) && !tips.pool_amount) return null;

  const numOr0 = (v) => (v === '' ? 0 : parseFloat(v));
  const changedOwn = tips.people.filter((p) => numOr0(draft.own[p.request_id] ?? '') !== p.individual);
  const dirty = numOr0(draft.pool) !== tips.pool_amount || draft.split !== tips.split
    || (draft.note || '') !== (tips.note || '') || changedOwn.length > 0;

  const save = async () => {
    const bad = [draft.pool, ...Object.values(draft.own)].some((v) => v !== '' && (Number.isNaN(parseFloat(v)) || parseFloat(v) < 0));
    if (bad) return setError('Tips must be amounts of $0 or more.');
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await api.put(`/events/${eventId}/tips`, {
        pool_amount: numOr0(draft.pool),
        split: draft.split,
        note: draft.note,
        individual: changedOwn.map((p) => ({ request_id: p.request_id, amount: numOr0(draft.own[p.request_id] ?? '') || null })),
      });
      reset(res.data);
      setNotice('Tips saved.');
      onSaved && onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'The tips did not save.');
    } finally {
      setSaving(false);
    }
  };

  const ro = !tips.can_edit;
  const inCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white disabled:opacity-50';
  return (
    <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-amber-100 inline-flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-amber-400" /> Tips
          {tips.locked && <span className="text-[10px] font-semibold text-emerald-300 inline-flex items-center gap-0.5"><Lock className="w-3 h-3" /> locked</span>}
        </div>
        <span className="text-xs text-amber-100">Total <strong>{money(tips.total_tips)}</strong></span>
      </div>
      {ro && <p className="text-[11px] text-amber-100/80">{tips.blocked_reason}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-300">Tip pool ($)
          <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Tip pool" disabled={ro} value={draft.pool}
            onChange={(e) => setDraft({ ...draft, pool: e.target.value })} className={`${inCls} block mt-0.5 w-28`} placeholder="0.00" />
        </label>
        <label className="text-[11px] text-slate-300">Share it
          <select aria-label="Tip pool split" disabled={ro} value={draft.split} onChange={(e) => setDraft({ ...draft, split: e.target.value })} className={`${inCls} block mt-0.5`}>
            <option value="hours">By hours worked</option>
            <option value="equal">Equally</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-300 flex-1 min-w-[10rem]">Note
          <input disabled={ro} value={draft.note} maxLength={300} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            className={`${inCls} block mt-0.5 w-full`} placeholder="e.g. card tips from the bar" />
        </label>
      </div>
      {tips.fell_back_equal && <p className="text-[11px] text-amber-200">Nobody in the pool has hours yet, so it's shared equally for now.</p>}
      {tips.pool_unshared && <p className="text-[11px] text-rose-300">Nobody on this event is in a tip-pool position, so the pool isn't shared with anyone.</p>}
      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/60">
        {tips.people.map((p) => (
          <div key={p.request_id} className="px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-white font-semibold min-w-[7rem]">{p.name}</span>
            <span className="text-[10px] text-slate-400 uppercase font-bold">{p.role_type}</span>
            {p.in_pool && (
              <span className="text-[10px] text-amber-300">
                pool{draft.split === 'hours' ? ` · ${p.basis_hours.toFixed(2)} h${p.time_tracking === 'payroll' ? ' scheduled' : ''}` : ''}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {p.tips_eligible ? (
                <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Own tips for ${p.name}`} disabled={ro}
                  value={draft.own[p.request_id] ?? ''} placeholder="own tips"
                  onChange={(e) => setDraft({ ...draft, own: { ...draft.own, [p.request_id]: e.target.value } })} className={`${inCls} w-24`} />
              ) : <span className="text-[11px] text-slate-600 w-24 text-center">no tips</span>}
              <span className="text-slate-400 w-20 text-right" title="Share of the tip pool">{p.in_pool ? money(p.pool_share) : '—'}</span>
              <span className="text-amber-200 font-semibold w-20 text-right">{money(p.total)}</span>
            </span>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {notice && !dirty && <p className="text-xs text-emerald-300">{notice}</p>}
      {!ro && dirty && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => reset(tips)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300">Undo</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
            <Check className="w-3 h-3" /> {saving ? 'Saving…' : 'Save tips'}
          </button>
        </div>
      )}
    </div>
  );
}

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
        {f.kind === 'noshow' && <p className="text-xs text-rose-300">Mark as a no-show? This counts against their reliability, they’re told, and their spot opens again.</p>}
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
      icon={<ClipboardList className="w-5 h-5 text-brand-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={data ? (
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-300">
            Total <strong className="text-white">{data.total_hours.toFixed(2)} h</strong> · Est. pay <strong className="text-brand-400">{money(data.total_pay)}</strong>
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
          <TipsPanel eventId={eventId} refreshKey={data} onSaved={onChanged} />
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
                    {/* Phase 35 */}
                    {p.time_tracking === 'payroll' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-violet-500/10 text-violet-300 border-violet-500/30">Venue payroll</span>
                    )}
                    {p.works_through && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/30">{p.works_through}</span>
                    )}
                    {p.overtime_hours > 0 && (
                      <span title="Hours past the venue's overtime limits (Venue settings → Time & pay periods)"
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-orange-500/10 text-orange-300 border-orange-500/40">
                        OT {p.overtime_hours.toFixed(2)} h
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <button type="button"
                      onClick={() => setForm({ kind: 'rate', requestId: p.request_id, value: p.pay_rate_custom ? String(p.pay_rate) : '', reason: '' })}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-brand-300"
                      title={p.rate_max ? `Posted range $${p.rate_min}–$${p.rate_max}` : `Posted rate $${p.rate_min}`}>
                      <DollarSign className="w-3.5 h-3.5" /> {money(p.pay_rate)}/hr{p.pay_rate_custom ? ' (set)' : ''}
                    </button>
                    <span className="text-slate-400"><Clock className="w-3.5 h-3.5 inline" /> {p.total_hours.toFixed(2)} h</span>
                    <span className="text-brand-400 font-semibold">{money(p.est_pay)}</span>
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

                {p.time_tracking === 'payroll' && p.entries.length === 0 && (
                  <p className="mt-2 text-[11px] text-violet-200/80">
                    Their hours are tracked in your venue's own payroll, so there's nothing to clock here. Times you add still count in ShiftUp.
                  </p>
                )}
                {!formHere && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button"
                      onClick={() => setForm({ kind: 'add', requestId: p.request_id, cin: utcToZonedLocalInput(data.start_time, tz), cout: utcToZonedLocalInput(data.end_time, tz), reason: '' })}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-brand-300 text-xs inline-flex items-center gap-1">
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
