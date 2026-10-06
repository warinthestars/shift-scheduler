import React, { useState } from 'react';
import { CalendarOff, Plus, Pencil, Trash2, Lock, Eye, AlertTriangle, Repeat, Save, Info } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { WEEKDAYS, fmtHm, todayIso } from '../../utils/availability';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500';
const selCls = 'mt-1 px-2 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500';
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const END_TIMES = [...HALF_HOURS.slice(1), '24:00'];
const REPEATS = [
  { id: 'none', label: "Doesn't repeat" },
  { id: 'weekly', label: 'Every week' },
  { id: 'biweekly', label: 'Every other week' },
];

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // 0 = Monday
}

function emptyForm() {
  const today = todayIso();
  return {
    all_day: true, start_date: today, end_date: today, start_local: '17:00', end_local: '24:00',
    repeat: 'none', weekdays: [weekdayOf(today)], has_until: false, until: '', reason: '', private_note: '',
  };
}

function toForm(b) {
  return {
    all_day: b.all_day,
    start_date: b.start_date,
    end_date: b.repeat === 'none' ? (b.end_date || b.start_date) : b.start_date,
    start_local: b.start_local || '17:00',
    end_local: b.end_local || '24:00',
    repeat: b.repeat,
    weekdays: b.weekdays?.length ? b.weekdays : [weekdayOf(b.start_date)],
    has_until: b.repeat !== 'none' && !!b.end_date,
    until: b.repeat !== 'none' ? (b.end_date || '') : '',
    reason: b.reason || '',
    private_note: b.private_note || '',
  };
}

/**
 * Phase 32.1: Time off is a block you set. Nobody approves it.
 * Full or part of a day, one-off or repeating (every week / every other week), with a reason managers see
 * and a private note only you see. Managers can't assign or offer you shifts inside a block.
 * Shifts you're already booked on stay booked and are listed so you can drop or hand them off.
 * Props: items (TimeOffBlockItem[]), onChanged(message), onError(message)
 */
export default function TimeOffPanel({ items = [], onChanged, onError }) {
  const [editing, setEditing] = useState(null);   // null | 'new' | block id
  const [confirm, setConfirm] = useState(null);
  const active = items.filter((b) => b.active);
  const ended = items.filter((b) => !b.active);

  const askDelete = (b) => setConfirm({
    title: 'Remove this time off?',
    message: `${b.summary}. Managers will be able to book you then again.`,
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: async () => {
      await api.delete(`/me/time-off/${b.id}`);
      onChanged('Time off removed.');
    },
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 flex-shrink-0 text-slate-500" />
        <span>
          Block off time you can't work. <b className="text-slate-200">Nobody has to approve it</b>: managers can't assign
          or offer you shifts inside it, and they see your reason but never your private note. You can still pick up a
          shift in your own time off if your plans change. Shifts you're already booked on stay booked, so they're listed
          here for you to drop or hand off.
        </span>
      </p>

      {editing === 'new' ? (
        <BlockForm onCancel={() => setEditing(null)} onError={onError}
          onSaved={(saved) => { setEditing(null); onChanged(savedMessage(saved)); }} />
      ) : (
        <button type="button" onClick={() => setEditing('new')}
          className="w-full p-3 rounded-2xl border border-dashed border-slate-600 text-sm font-bold text-brand-300 hover:bg-slate-900 inline-flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> Add time off
        </button>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-white">Your time off</h3>
        {active.length === 0 && <p className="text-xs text-slate-500">Nothing blocked off.</p>}
        {active.map((b) => (editing === b.id ? (
          <BlockForm key={b.id} block={b} onCancel={() => setEditing(null)} onError={onError}
            onSaved={(saved) => { setEditing(null); onChanged(savedMessage(saved)); }} />
        ) : (
          <BlockRow key={b.id} b={b} onEdit={() => setEditing(b.id)} onDelete={() => askDelete(b)} />
        )))}
      </section>

      {ended.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-400">Ended</h3>
          {ended.map((b) => <BlockRow key={b.id} b={b} onDelete={() => askDelete(b)} />)}
        </section>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function savedMessage(saved) {
  return saved.conflicts?.length
    ? `Saved. You're still booked on ${saved.conflicts.length} shift${saved.conflicts.length === 1 ? '' : 's'} in that time. Those managers have been told; drop or hand them off if you can't work them.`
    : 'Saved. Managers can’t book you in that time.';
}

function BlockRow({ b, onEdit, onDelete }) {
  return (
    <div className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-start gap-2 ${b.active ? 'bg-slate-900 border-slate-800' : 'bg-slate-950 border-slate-900 opacity-70'}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-semibold text-white flex items-center gap-1.5">
          {b.repeat !== 'none' ? <Repeat className="w-3.5 h-3.5 text-indigo-300" /> : <CalendarOff className="w-3.5 h-3.5 text-amber-300" />}
          {b.summary}
        </p>
        {b.reason && (
          <p className="text-[11px] text-slate-300 inline-flex items-center gap-1 mr-3">
            <Eye className="w-3 h-3 text-slate-500" /> Managers see: {b.reason}
          </p>
        )}
        {b.private_note && (
          <p className="text-[11px] text-slate-400 inline-flex items-center gap-1">
            <Lock className="w-3 h-3 text-slate-500" /> Only you: {b.private_note}
          </p>
        )}
        {b.conflicts?.length > 0 && (
          <p className="text-[11px] text-amber-300 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Still booked: {b.conflicts.join('; ')}. Drop or hand these off from My shifts if you can't work them.</span>
          </p>
        )}
      </div>
      <div className="flex gap-2 self-start">
        {onEdit && (
          <button type="button" onClick={onEdit}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        <button type="button" onClick={onDelete} aria-label="Remove"
          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/40">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function BlockForm({ block = null, onCancel, onSaved, onError }) {
  const [f, setF] = useState(() => (block ? toForm(block) : emptyForm()));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const repeating = f.repeat !== 'none';
  const overnight = !f.all_day && f.end_local !== '24:00' && f.end_local <= f.start_local;

  const setStart = (v) => setF((p) => ({
    ...p,
    start_date: v,
    end_date: p.end_date < v ? v : p.end_date,
    weekdays: p.repeat === 'none' || !p.weekdays.length ? [weekdayOf(v)] : p.weekdays,
  }));
  const toggleDay = (d) => setF((p) => {
    const has = p.weekdays.includes(d);
    const next = has ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d];
    return { ...p, weekdays: next.length ? next.sort() : p.weekdays };
  });

  const save = async () => {
    setBusy(true);
    const body = {
      all_day: f.all_day,
      start_date: f.start_date,
      end_date: repeating ? (f.has_until && f.until ? f.until : null) : f.end_date,
      start_local: f.all_day ? null : f.start_local,
      end_local: f.all_day ? null : f.end_local,
      repeat: f.repeat,
      weekdays: repeating ? f.weekdays : [],
      reason: f.reason.trim() || null,
      private_note: f.private_note.trim() || null,
    };
    try {
      const res = block ? await api.put(`/me/time-off/${block.id}`, body) : await api.post('/me/time-off', body);
      onSaved(res.data);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your time off.');
    } finally {
      setBusy(false);
    }
  };

  const seg = (on) => `px-3 py-1.5 rounded-lg text-xs font-bold transition ${on ? 'bg-brand-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`;

  return (
    <section className="p-4 rounded-2xl bg-slate-900 border border-brand-500/30 space-y-4">
      <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5">
        <CalendarOff className="w-4 h-4 text-amber-300" /> {block ? 'Edit time off' : 'Add time off'}
      </p>

      <div className="flex flex-wrap gap-3">
        <div className="p-1 bg-slate-950 border border-slate-800 rounded-xl flex gap-1" role="radiogroup" aria-label="How long">
          <button type="button" role="radio" aria-checked={f.all_day} onClick={() => set('all_day', true)} className={seg(f.all_day)}>All day</button>
          <button type="button" role="radio" aria-checked={!f.all_day} onClick={() => set('all_day', false)} className={seg(!f.all_day)}>Part of the day</button>
        </div>
        <div className="p-1 bg-slate-950 border border-slate-800 rounded-xl flex flex-wrap gap-1" role="radiogroup" aria-label="Repeats">
          {REPEATS.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={f.repeat === r.id}
              onClick={() => setF((p) => ({ ...p, repeat: r.id, weekdays: p.weekdays.length ? p.weekdays : [weekdayOf(p.start_date)] }))}
              className={seg(f.repeat === r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-slate-300">{repeating ? 'Starting' : 'First day'}
          <input type="date" value={f.start_date} min={block ? undefined : todayIso()} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </label>
        {!repeating ? (
          <label className="block text-xs font-semibold text-slate-300">Last day
            <input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set('end_date', e.target.value)} className={inputCls} />
          </label>
        ) : (
          <div className="text-xs font-semibold text-slate-300">
            Ends
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-slate-300 font-normal">
                <input type="radio" checked={!f.has_until} onChange={() => set('has_until', false)} className="text-brand-500" /> Never
              </label>
              <label className="inline-flex items-center gap-1.5 text-slate-300 font-normal">
                <input type="radio" checked={f.has_until} onChange={() => set('has_until', true)} className="text-brand-500" /> On
              </label>
              <input type="date" value={f.until} min={f.start_date} disabled={!f.has_until}
                onChange={(e) => { set('until', e.target.value); set('has_until', true); }}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white disabled:opacity-40" />
            </div>
          </div>
        )}
      </div>

      {repeating && (
        <div>
          <p className="text-xs font-semibold text-slate-300">On</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((name, d) => {
              const on = f.weekdays.includes(d);
              return (
                <button key={name} type="button" aria-pressed={on} onClick={() => toggleDay(d)}
                  className={`w-12 py-1.5 rounded-lg text-xs font-bold border transition ${on ? 'bg-brand-500/15 text-brand-200 border-brand-500/40' : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'}`}>
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!f.all_day && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs font-semibold text-slate-300">From
            <select value={f.start_local} onChange={(e) => set('start_local', e.target.value)} className={`${selCls} block`}>
              {HALF_HOURS.map((t) => <option key={t} value={t}>{fmtHm(t)}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-300">Until
            <select value={f.end_local} onChange={(e) => set('end_local', e.target.value)} className={`${selCls} block`}>
              {END_TIMES.map((t) => <option key={t} value={t}>{t === '24:00' ? 'Midnight' : fmtHm(t)}</option>)}
            </select>
          </label>
          {overnight && <span className="text-[11px] text-indigo-300 pb-2.5">runs into the next day</span>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-slate-300">
          <span className="inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Reason managers see (optional)</span>
          <input value={f.reason} onChange={(e) => set('reason', e.target.value.slice(0, 200))} placeholder="e.g. Class, Other job, Family" className={inputCls} />
        </label>
        <label className="block text-xs font-semibold text-slate-300">
          <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Private note, only you see it (optional)</span>
          <input value={f.private_note} onChange={(e) => set('private_note', e.target.value.slice(0, 500))} placeholder="e.g. Dentist at 3, pick up Maya" className={inputCls} />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
        <button type="button" onClick={save} disabled={busy || (repeating && !f.weekdays.length)}
          className="px-4 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save time off'}
        </button>
      </div>
    </section>
  );
}
