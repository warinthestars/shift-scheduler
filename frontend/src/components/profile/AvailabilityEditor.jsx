import React, { useEffect, useState } from 'react';
import { Plus, X, Save, Info } from 'lucide-react';
import api from '../../api/client';
import { WEEKDAYS_LONG, PRESETS, fmtHm } from '../../utils/availability';

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const END_TIMES = [...HALF_HOURS.slice(1), '24:00'];
const selCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500';

function toDays(windows) {
  const days = WEEKDAYS_LONG.map(() => []);
  (windows || []).forEach((w) => days[w.weekday]?.push({ start: w.start_local, end: w.end_local }));
  return days;
}

/**
 * Phase 31: Weekly availability. Each day can have one or more time ranges; a range that ends
 * earlier than it starts runs past midnight. Leaving every day empty = "not set" (no warnings anywhere).
 * Props: windows (AvailabilityWindow[]), onSaved(windows, message), onError(message)
 */
export default function AvailabilityEditor({ windows, onSaved, onError }) {
  const [days, setDays] = useState(() => toDays(windows));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDays(toDays(windows));
    setDirty(false);
  }, [windows]);

  const update = (fn) => {
    setDays((prev) => fn(prev.map((d) => d.map((r) => ({ ...r })))));
    setDirty(true);
  };
  const applyPreset = (p) => update(() => WEEKDAYS_LONG.map((_, i) => (p.days.includes(i) ? [{ start: p.start, end: p.end }] : [])));

  const save = async () => {
    setSaving(true);
    try {
      const body = { windows: days.flatMap((ranges, weekday) => ranges.map((r) => ({ weekday, start_local: r.start, end_local: r.end }))) };
      const res = await api.put('/me/availability', body);
      onSaved(res.data, res.data.length ? 'Availability saved.' : 'Availability cleared. Every shift counts as a fit.');
      setDirty(false);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your availability.');
    } finally {
      setSaving(false);
    }
  };

  const empty = days.every((d) => d.length === 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 flex-shrink-0 text-slate-500" />
        <span>
          When you usually can work, in the local time where the venue is. Managers see it when they assign or offer shifts,
          and <b className="text-slate-200">ShiftBoard</b> can hide what doesn't fit. It never stops you picking up a shift.
          For one-off days away, use <b className="text-slate-200">Time off</b> instead.
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-400 self-center">Quick fill:</span>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => applyPreset(p)}
            className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 hover:text-white hover:border-slate-500">
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
        {WEEKDAYS_LONG.map((name, i) => (
          <div key={name} className="p-3 flex flex-col sm:flex-row sm:items-start gap-2">
            <div className="sm:w-32 flex items-center justify-between sm:block">
              <span className={`text-sm font-semibold ${days[i].length ? 'text-white' : 'text-slate-500'}`}>{name}</span>
              {days[i].length === 0 && <span className="sm:block text-[11px] text-slate-500">Not available</span>}
            </div>
            <div className="flex-1 space-y-1.5">
              {days[i].map((r, j) => {
                const overnight = r.end !== '24:00' && r.end <= r.start;
                return (
                  <div key={j} className="flex flex-wrap items-center gap-2">
                    <select aria-label={`${name} from`} value={r.start} className={selCls}
                      onChange={(e) => update((d) => { d[i][j].start = e.target.value; return d; })}>
                      {HALF_HOURS.map((t) => <option key={t} value={t}>{fmtHm(t)}</option>)}
                    </select>
                    <span className="text-xs text-slate-500">to</span>
                    <select aria-label={`${name} until`} value={r.end} className={selCls}
                      onChange={(e) => update((d) => { d[i][j].end = e.target.value; return d; })}>
                      {END_TIMES.map((t) => <option key={t} value={t}>{t === '24:00' ? 'Midnight' : fmtHm(t)}</option>)}
                    </select>
                    {overnight && <span className="text-[11px] text-indigo-300">next day</span>}
                    <button type="button" aria-label="Remove this range" onClick={() => update((d) => { d[i].splice(j, 1); return d; })}
                      className="p-1 rounded-md text-slate-500 hover:text-rose-300 hover:bg-slate-800">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              <button type="button" onClick={() => update((d) => { d[i].push({ start: '17:00', end: '24:00' }); return d; })}
                className="text-[11px] font-semibold text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> {days[i].length ? 'Add another range' : 'Add a time range'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => update(() => WEEKDAYS_LONG.map(() => []))} disabled={empty}
          className="text-xs text-slate-400 underline hover:text-white disabled:opacity-40 disabled:no-underline">
          Clear everything
        </button>
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save availability'}
        </button>
      </div>
    </div>
  );
}
