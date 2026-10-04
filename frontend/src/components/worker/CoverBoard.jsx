import React from 'react';
import { LifeBuoy, Zap, Clock, Globe, Users, AlertCircle } from 'lucide-react';
import PayLabel from '../PayLabel';
import TipBadge from '../TipBadge';
import { fmtDate, fmtTimeRange } from '../../utils/venueTime';

/**
 * Phase 34: "Need cover" on Find shifts: teammates' (and public) shifts that need someone.
 * Props: items (CoverListing[] from GET /api/cover/open), busyId, onTake(item)
 */
export default function CoverBoard({ items = [], busyId, onTake }) {
  if (!items.length) return null;
  return (
    <section className="mt-6 bg-amber-500/5 border border-amber-500/40 rounded-2xl p-4 space-y-3" aria-label="Shifts that need cover">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
          <LifeBuoy className="w-4 h-4 text-amber-300" />
          Need cover ({items.length})
        </div>
        <p className="text-[11px] text-amber-200/70 mt-0.5">Someone booked can't make it. Take it and it's yours (some need the manager's OK).</p>
      </div>
      {items.map((c) => {
        const busy = busyId === c.cover_id;
        return (
          <div key={c.cover_id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{c.role_type}</span>
                <span className="text-sm font-bold text-white">{c.title}</span>
                <span className="text-xs text-slate-400">· {c.venue_name}</span>
                {c.audience === 'public' && !c.on_team ? (
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-1"><Globe className="w-3 h-3" /> Public</span>
                ) : (
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-1"><Users className="w-3 h-3" /> Your team</span>
                )}
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {fmtDate(c.start_time, c.venue_timezone)} · {fmtTimeRange(c.start_time, c.end_time, c.venue_timezone)}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                <PayLabel rate={c.hourly_rate} rateMax={c.hourly_rate_max} className="text-emerald-400 font-semibold" />
                <TipBadge shift={c} />
                <span className="text-slate-400">Covering for {c.from_first_name}</span>
              </div>
              {c.note && <div className="text-xs text-amber-100 italic mt-1">“{c.note}”</div>}
              {c.can_take && c.booking === 'approval' && (
                <div className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> The manager has to approve it</div>
              )}
              {c.can_take && c.take_note && <div className="text-[11px] text-amber-300 mt-1">{c.take_note}</div>}
              {!c.can_take && c.problem && (
                <div className="text-[11px] text-rose-300 mt-1 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {c.problem}</div>
              )}
            </div>
            {c.can_take && (
              <button type="button" onClick={() => onTake(c)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto">
                {c.booking === 'instant' && <Zap className="w-4 h-4" />}
                {busy ? '…' : c.booking === 'instant' ? 'Take it' : 'Ask to take it'}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
