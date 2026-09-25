import React, { useMemo, useState } from 'react';
import { Copy, Repeat, CalendarPlus } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { utcToZonedLocalInput, fmtDate, fmtTimeRange } from '../utils/venueTime';

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function prettyDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function DuplicateEventModal({ event, timeZone, onClose, onDone }) {
  const baseDay = utcToZonedLocalInput(event.start_time, timeZone).slice(0, 10);
  const [mode, setMode] = useState('once'); // 'once' | 'weekly'
  const [date, setDate] = useState(addDays(baseDay, 7));
  const [weeks, setWeeks] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dates = useMemo(() => {
    if (!date) return [];
    if (mode === 'once') return [date];
    const n = Math.max(1, Math.min(12, parseInt(weeks, 10) || 1));
    return Array.from({ length: n }, (_, i) => addDays(date, i * 7));
  }, [mode, date, weeks]);

  const submit = async () => {
    setError('');
    if (dates.length === 0) return setError('Pick a date.');
    setSaving(true);
    try {
      const res = await api.post(`/events/${event.event_id}/duplicate`, { dates });
      onDone && onDone(res.data.count);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not copy this event.');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
      <button type="button" onClick={submit} disabled={saving}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
        {saving ? 'Copying…' : `Create ${dates.length} ${dates.length === 1 ? 'copy' : 'copies'}`}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Duplicate shift"
      subtitle={`${event.title} · ${fmtDate(event.start_time, timeZone)} · ${fmtTimeRange(event.start_time, event.end_time, timeZone)}`}
      icon={<Copy className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={footer}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {[
          { id: 'once', label: 'Copy to one date', icon: CalendarPlus },
          { id: 'weekly', label: 'Repeat weekly', icon: Repeat },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setMode(id)}
            className={`px-3 py-2.5 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-2 ${mode === id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/40 text-slate-300'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">{mode === 'once' ? 'Date' : 'First date'}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white" />
        </div>
        {mode === 'weekly' && (
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">How many weeks (max 12)</label>
            <input type="number" min="1" max="12" value={weeks} onChange={(e) => setWeeks(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white" />
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mt-3">
        Same start time ({timeZone || 'venue'} time), positions, pay, notes and approval settings. Nobody is booked on the copies.
      </p>
      {dates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <span key={d} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200">{prettyDay(d)}</span>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
