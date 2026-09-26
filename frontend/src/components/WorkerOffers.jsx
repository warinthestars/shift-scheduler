import React from 'react';
import { Send, MapPin, Check, X, Users } from 'lucide-react';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

/**
 * Phase 29: Shifts a manager offered to you. First to accept gets it.
 * Props: offers (WorkerOffer[]), busyId, onAccept(offer), onDecline(offer)
 */
export default function WorkerOffers({ offers = [], busyId, onAccept, onDecline }) {
  if (!offers.length) return null;
  return (
    <div className="mt-6 bg-indigo-500/5 border border-indigo-500/40 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-100">
        <Send className="w-4 h-4 text-indigo-300" />
        Offered to you ({offers.length})
      </div>
      {offers.map((o) => {
        const busy = busyId === o.offer_id;
        return (
          <div key={o.offer_id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{o.role_type}</span>
                <span className="text-sm font-bold text-white">{o.title}</span>
                <span className="text-xs text-slate-400">· {o.venue_name}</span>
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {fmtDate(o.start_time, o.venue_timezone)} · {fmtTimeRange(o.start_time, o.end_time, o.venue_timezone)}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                <PayLabel rate={o.hourly_rate} rateMax={o.hourly_rate_max} className="text-emerald-400 font-semibold" />
                <TipBadge shift={o} />
                {(o.location_name || o.address) && (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <MapPin className="w-3 h-3" /> {o.location_name || o.address}
                  </span>
                )}
              </div>
              {o.message && <div className="text-xs text-indigo-100 italic mt-1">“{o.message}”{o.offered_by ? ` · ${o.offered_by}` : ''}</div>}
              {o.others_offered > 0 && (
                <div className="text-[11px] text-amber-300 mt-1 inline-flex items-center gap-1">
                  <Users className="w-3 h-3" /> Also offered to {o.others_offered} other{o.others_offered === 1 ? '' : 's'}: first to accept gets it.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onAccept(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Check className="w-4 h-4" /> {busy ? '…' : 'Accept'}
              </button>
              <button type="button" onClick={() => onDecline(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <X className="w-4 h-4" /> Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
