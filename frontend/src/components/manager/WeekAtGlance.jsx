import React from 'react';
import { FilePen, EyeOff, Users, CalendarOff } from 'lucide-react';
import { fmtTime } from '../../utils/venueTime';

function fillTone(e) {
  if (e.status === 'draft') return 'border-slate-600 border-dashed text-slate-300';
  if (e.capacity > 0 && e.filled >= e.capacity) return 'border-emerald-500/40 text-emerald-100';
  if (e.filled === 0) return 'border-rose-500/40 text-rose-100';
  return 'border-amber-500/40 text-amber-100';
}

/** "2026-09-30" -> "Sep 30" without timezone drift (it's already a venue-local date) */
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Phase 30: Today + the next 6 days. Each day shows how full it is; each event is a chip
 * (green = full, amber = partly filled, red = nobody yet, dashed = draft). Tap to open the roster.
 * Props: week (WeekDay[]), timeZone, onOpenEvent(eventId)
 */
export default function WeekAtGlance({ week = [], timeZone, onOpenEvent }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
      {week.map((d, i) => {
        const pct = d.capacity ? Math.round((100 * Math.min(d.filled, d.capacity)) / d.capacity) : 0;
        return (
          <section key={d.date} className={`rounded-xl border p-2.5 min-w-0 ${i === 0 ? 'bg-slate-900 border-amber-500/30' : 'bg-slate-900/60 border-slate-800'}`}>
            <header className="flex items-baseline justify-between gap-2">
              <h4 className={`text-xs font-bold ${i === 0 ? 'text-amber-300' : 'text-white'}`}>{d.label}</h4>
              <span className="text-[10px] text-slate-500">{shortDate(d.date)}</span>
            </header>
            {d.capacity > 0 ? (
              <div className="mt-1.5">
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{d.filled}/{d.capacity} spots filled</p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 mt-1.5">{d.events.length ? 'Drafts only' : 'Nothing posted'}</p>
            )}
            {d.time_off?.length > 0 && (
              <p className="mt-1.5 text-[10px] text-amber-200/90 flex items-start gap-1" title={`Approved time off: ${d.time_off.join(', ')}`}>
                <CalendarOff className="w-3 h-3 flex-shrink-0 mt-px" />
                <span className="line-clamp-2">Off: {d.time_off.join(', ')}</span>
              </p>
            )}
            <ul className="mt-2 space-y-1.5">
              {d.events.map((e) => (
                <li key={e.event_key}>
                  <button type="button" disabled={!e.event_id} onClick={() => e.event_id && onOpenEvent?.(e.event_id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg border bg-slate-950/50 hover:bg-slate-800/80 transition ${fillTone(e)}`}>
                    <p className="text-[10px] text-slate-400">{fmtTime(e.start_time, timeZone)}</p>
                    <p className="text-xs font-semibold truncate">{e.title}</p>
                    <p className="text-[10px] flex flex-wrap items-center gap-x-1.5 mt-0.5">
                      {e.status === 'draft' ? (
                        <span className="inline-flex items-center gap-0.5 text-slate-400"><FilePen className="w-3 h-3" /> Draft</span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5"><Users className="w-3 h-3" /> {e.filled}/{e.capacity}</span>
                      )}
                      {e.requested > 0 && <span className="text-amber-300">{e.requested} asked</span>}
                      {e.unread > 0 && <span className="text-amber-200 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" />{e.unread}</span>}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
