import React, { useEffect, useState } from 'react';
import { Hourglass, Check, X, ListOrdered, Zap } from 'lucide-react';
import { fmtDate, fmtTimeRange } from '../../utils/venueTime';

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function left(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Phase 34: My waitlists (on My shifts). Offers first (Take / Pass with a countdown), then my places in line.
 * Props: entries (WaitlistMine[] from GET /api/waitlist/mine), busyId, onTake(e), onPass(e), onLeave(e), onExpired()
 */
export default function WaitlistPanel({ entries = [], busyId, onTake, onPass, onLeave, onExpired }) {
  const offers = entries.filter((e) => e.status === 'offered');
  const waiting = entries.filter((e) => e.status === 'waiting');
  const now = useNow(offers.length > 0);
  const anyRanOut = offers.some((o) => new Date(o.offer_expires_at).getTime() <= now);
  useEffect(() => {
    if (anyRanOut && onExpired) onExpired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyRanOut]);
  if (!entries.length) return null;

  const line = (e) => (
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{e.role_type}</span>
        <span className="text-sm font-bold text-white">{e.title}</span>
        <span className="text-xs text-slate-400">· {e.venue_name}</span>
      </div>
      <div className="text-xs text-slate-300 mt-1">
        {fmtDate(e.start_time, e.venue_timezone)} · {fmtTimeRange(e.start_time, e.end_time, e.venue_timezone)}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {offers.length > 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-100">
            <Hourglass className="w-4 h-4 text-emerald-300" />
            A spot opened for you ({offers.length})
          </div>
          {offers.map((e) => {
            const ms = new Date(e.offer_expires_at).getTime() - now;
            const busy = busyId === e.entry_id;
            return (
              <div key={e.entry_id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  {line(e)}
                  <div className={`text-[11px] mt-1 font-semibold ${ms < 120000 ? 'text-rose-300' : 'text-amber-300'}`}>
                    You're next on the waitlist. {ms > 0 ? `${left(ms)} left to take it.` : 'Time ran out.'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onPass(e)} disabled={busy || ms <= 0}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                    <X className="w-4 h-4" /> Pass
                  </button>
                  <button type="button" onClick={() => onTake(e)} disabled={busy || ms <= 0}
                    className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                    <Check className="w-4 h-4" /> {busy ? '…' : 'Take it'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {waiting.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ListOrdered className="w-3.5 h-3.5" /> On a waitlist ({waiting.length})
          </h2>
          {waiting.map((e) => (
            <div key={e.entry_id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                {line(e)}
                <div className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1">
                  {e.place === 1 ? 'You\'re next in line' : `#${e.place} in line`}
                  {' · '}
                  {e.auto_book
                    ? <><Zap className="w-3 h-3 text-emerald-400" /> we'll ask for the spot for you as soon as one opens</>
                    : "we'll offer you the spot first when one opens"}
                </div>
              </div>
              {/* Phase 32.3 rule: the negative action is never where the positive one just was */}
              <button type="button" onClick={() => onLeave(e)} disabled={busyId === e.entry_id}
                className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold self-start sm:self-auto disabled:opacity-50">
                Leave waitlist
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
