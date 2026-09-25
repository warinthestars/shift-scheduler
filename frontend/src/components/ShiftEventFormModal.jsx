import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { zonedLocalToUtcIso, utcToZonedLocalInput } from '../utils/venueTime';

const APPROVAL_OPTIONS = [
  { value: 'venue_default', label: 'Venue default' },
  { value: 'auto', label: 'Instant booking' },
  { value: 'manual', label: 'Needs my approval' },
];
const POLICY_TEXT = {
  team_auto: 'your team is booked instantly, everyone else needs approval',
  manual: 'you approve every request',
  everyone_auto: 'anyone who picks it up is booked instantly',
};

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-semibold text-slate-300 mb-1';

let rowSeq = 0;
function blankRow(pos) {
  rowSeq += 1;
  return {
    key: `new-${rowSeq}`,
    shift_id: null,
    role_type: pos?.name || '',
    capacity: 1,
    hourly_rate: pos ? Number(pos.default_rate).toFixed(2) : '25.00',
    hourly_rate_max: pos?.default_rate_max != null ? Number(pos.default_rate_max).toFixed(2) : '',
    hide_rate: !!pos?.hide_rate,
    tips_eligible: !!pos?.tips_eligible,
    tip_pool: !!pos?.tip_pool,
    role_notes: '',
    approval_mode: 'venue_default',
    booked: 0,
    pending: 0,
    showNotes: false,
  };
}

export default function ShiftEventFormModal({ mode = 'create', venue, positions = [], eventId = null, onClose, onSaved }) {
  const tz = venue?.timezone;
  const isEdit = mode === 'edit' && !!eventId;
  const activePositions = positions.filter((p) => p.is_active !== false);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState(() => (isEdit ? [] : [blankRow(activePositions[0])]));

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api
      .get(`/events/${eventId}`)
      .then((res) => {
        const ev = res.data;
        setTitle(ev.title || '');
        setStart(utcToZonedLocalInput(ev.start_time, tz));
        setEnd(utcToZonedLocalInput(ev.end_time, tz));
        setNotes(ev.notes || '');
        setRows(
          (ev.positions || []).map((p) => ({
            key: p.shift_id,
            shift_id: p.shift_id,
            role_type: p.role_type,
            capacity: p.capacity,
            hourly_rate: Number(p.hourly_rate).toFixed(2),
            hourly_rate_max: p.hourly_rate_max != null ? Number(p.hourly_rate_max).toFixed(2) : '',
            hide_rate: !!p.hide_rate,
            tips_eligible: !!p.tips_eligible,
            tip_pool: !!p.tip_pool,
            role_notes: p.role_notes || '',
            approval_mode: p.approval_mode || 'venue_default',
            booked: p.assigned_count || 0,
            pending: p.pending_count || 0,
            showNotes: !!p.role_notes,
          }))
        );
      })
      .catch((err) => setError(err.response?.data?.detail || 'Could not load this event.'))
      .finally(() => setLoading(false));
  }, [isEdit, eventId, tz]);

  const updateRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changeRole = (key, name) => {
    const pos = activePositions.find((p) => p.name === name);
    if (!pos) {
      updateRow(key, { role_type: name });
      return;
    }
    updateRow(key, {
      role_type: name,
      hourly_rate: Number(pos.default_rate).toFixed(2),
      hourly_rate_max: pos.default_rate_max != null ? Number(pos.default_rate_max).toFixed(2) : '',
      hide_rate: !!pos.hide_rate,
      tips_eligible: !!pos.tips_eligible,
      tip_pool: !!pos.tip_pool,
    });
  };

  const addRow = () => {
    const used = new Set(rows.map((r) => r.role_type));
    const next = activePositions.find((p) => !used.has(p.name)) || activePositions[0];
    setRows((rs) => [...rs, blankRow(next)]);
  };

  const removeRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key));

  const eventApproval = useMemo(() => {
    const modes = new Set(rows.map((r) => r.approval_mode));
    return modes.size === 1 ? [...modes][0] : 'mixed';
  }, [rows]);

  const setAllApproval = (value) => {
    if (value === 'mixed') return;
    setRows((rs) => rs.map((r) => ({ ...r, approval_mode: value })));
  };

  const anyBooked = rows.some((r) => (r.booked || 0) + (r.pending || 0) > 0);

  const handleSubmit = async () => {
    setError('');
    if (!title.trim()) return setError('Give the event a name.');
    if (!start || !end) return setError('Pick a start and end time.');
    const startIso = zonedLocalToUtcIso(start, tz);
    const endIso = zonedLocalToUtcIso(end, tz);
    if (new Date(endIso) <= new Date(startIso)) return setError('End time must be after the start time.');
    if (rows.length === 0) return setError('Add at least one position.');

    const payloadPositions = [];
    for (const r of rows) {
      const name = (r.role_type || '').trim();
      const lo = parseFloat(r.hourly_rate);
      const hi = r.hourly_rate_max === '' ? null : parseFloat(r.hourly_rate_max);
      const cap = parseInt(r.capacity, 10) || 1;
      if (!name) return setError('Every row needs a position.');
      if (!lo || lo <= 0) return setError(`${name}: pay must be more than $0.`);
      if (hi !== null && (Number.isNaN(hi) || hi < lo)) return setError(`${name}: the top of the pay range can't be lower than the bottom.`);
      if (cap < (r.booked || 0)) return setError(`${name}: ${r.booked} people are already booked, so it needs at least ${r.booked} spots.`);
      payloadPositions.push({
        shift_id: r.shift_id || undefined,
        role_type: name,
        capacity: cap,
        hourly_rate: lo,
        hourly_rate_max: hi !== null && hi > lo ? hi : null,
        hide_rate: !!r.hide_rate,
        tips_eligible: !!r.tips_eligible,
        tip_pool: r.tips_eligible ? !!r.tip_pool : false,
        role_notes: (r.role_notes || '').trim() || null,
        approval_mode: r.approval_mode,
      });
    }

    const body = {
      title: title.trim(),
      start_time: startIso,
      end_time: endIso,
      notes: notes.trim() || null,
      positions: payloadPositions,
    };

    setSaving(true);
    try {
      const res = isEdit
        ? await api.put(`/events/${eventId}`, body)
        : await api.post('/events', { ...body, venue_id: venue.id });
      onSaved && onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving || loading}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50"
      >
        {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Publish shift'}
      </button>
    </>
  );

  return (
    <ModalShell
      title={isEdit ? 'Edit posted shift' : 'Post a shift'}
      subtitle={venue?.name}
      icon={<Calendar className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      footer={footer}
    >
      {error && (
        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
      )}
      {loading ? (
        <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: event details */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <label className={labelCls}>Event / shift name *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Friday Gala" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <div>
                <label className={labelCls}>Starts ({tz || 'local'} time) *</label>
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ends ({tz || 'local'} time) *</label>
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Event notes</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputCls}
                placeholder="Shown to everyone working this event. e.g. Load-in through the loading dock at 4pm."
              />
            </div>
            {venue?.default_shift_notes && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" /> Venue notes (added automatically)
                </div>
                <p className="text-xs text-slate-300 whitespace-pre-line">{venue.default_shift_notes}</p>
                <p className="text-[10px] text-slate-500 mt-1">Change these in Venue Settings.</p>
              </div>
            )}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <label className={labelCls}>Approval for every position</label>
              <select value={eventApproval} onChange={(e) => setAllApproval(e.target.value)} className={inputCls}>
                {APPROVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                <option value="mixed" disabled>Mixed (set per position)</option>
              </select>
              <p className="text-[11px] text-slate-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Venue default means {POLICY_TEXT[venue?.approval_policy] || POLICY_TEXT.team_auto}. You can also set each position on the right.
                </span>
              </p>
            </div>
            {isEdit && anyBooked && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                People are already booked or waiting on this event. They'll see the new time and details.
              </p>
            )}
          </div>

          {/* Right: positions */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" /> Positions
              </h4>
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add position
              </button>
            </div>

            {rows.map((r) => {
              const locked = (r.booked || 0) + (r.pending || 0) > 0;
              const names = activePositions.map((p) => p.name);
              return (
                <div key={r.key} className="p-3 rounded-xl border border-slate-700 bg-slate-800/40 space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[10rem]">
                      <label className={labelCls}>Position</label>
                      {names.length > 0 ? (
                        <select value={r.role_type} onChange={(e) => changeRole(r.key, e.target.value)} className={inputCls}>
                          {!names.includes(r.role_type) && r.role_type && <option value={r.role_type}>{r.role_type}</option>}
                          {names.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={r.role_type} onChange={(e) => updateRow(r.key, { role_type: e.target.value })} className={inputCls} placeholder="Bartender" />
                      )}
                    </div>
                    <div className="w-20">
                      <label className={labelCls}>Spots</label>
                      <input
                        type="number"
                        min={Math.max(1, r.booked || 0)}
                        value={r.capacity}
                        onChange={(e) => updateRow(r.key, { capacity: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      disabled={locked || rows.length <= 1}
                      title={locked ? 'People are booked or waiting on this position' : 'Remove position'}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {isEdit && (r.booked > 0 || r.pending > 0) && (
                    <p className="text-[11px] text-slate-400">{r.booked} booked · {r.pending} waiting</p>
                  )}

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-28">
                      <label className={labelCls}>Pay from</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                        <input
                          type="number" step="0.5" min="0"
                          value={r.hourly_rate}
                          onChange={(e) => updateRow(r.key, { hourly_rate: e.target.value })}
                          className={`${inputCls} pl-6`}
                        />
                      </div>
                    </div>
                    <div className="w-28">
                      <label className={labelCls}>to (optional)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                        <input
                          type="number" step="0.5" min="0"
                          value={r.hourly_rate_max}
                          onChange={(e) => updateRow(r.key, { hourly_rate_max: e.target.value })}
                          className={`${inputCls} pl-6`}
                          placeholder="—"
                        />
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 pb-2.5">/hr</span>
                    <label className="flex items-center gap-2 text-xs text-slate-300 pb-2.5 ml-auto">
                      <input
                        type="checkbox"
                        checked={r.hide_rate}
                        onChange={(e) => updateRow(r.key, { hide_rate: e.target.checked })}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500"
                      />
                      <EyeOff className="w-3.5 h-3.5" /> Hide pay from workers
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={r.tips_eligible}
                        onChange={(e) => updateRow(r.key, { tips_eligible: e.target.checked, tip_pool: e.target.checked ? r.tip_pool : false })}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
                      />
                      Tips
                    </label>
                    {r.tips_eligible && (
                      <label className="flex items-center gap-2 text-xs text-amber-300">
                        <input
                          type="checkbox"
                          checked={r.tip_pool}
                          onChange={(e) => updateRow(r.key, { tip_pool: e.target.checked })}
                          className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
                        />
                        Tip pool
                      </label>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-slate-400">Approval</span>
                      <select
                        value={r.approval_mode}
                        onChange={(e) => updateRow(r.key, { approval_mode: e.target.value })}
                        className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white"
                      >
                        {APPROVAL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {r.showNotes ? (
                    <div>
                      <label className={labelCls}>Notes for {r.role_type || 'this position'}</label>
                      <textarea
                        rows={2}
                        value={r.role_notes}
                        onChange={(e) => updateRow(r.key, { role_notes: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Bring a wine key. Black apron provided."
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateRow(r.key, { showNotes: true })}
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      + Add notes for this position
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
