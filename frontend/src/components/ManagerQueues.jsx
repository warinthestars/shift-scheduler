import React from 'react';
import { Users, ArrowRightLeft, Check, X, Eye, MessageSquareQuote, ArrowRight } from 'lucide-react';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

const card = 'bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl';

function name(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || p?.email || 'Worker';
}

function Header({ icon: Icon, title, count, hint }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <h2 className="text-sm font-bold text-white truncate">{title}</h2>
        {count > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">{count}</span>
        )}
      </div>
      {hint && <span className="text-[10px] text-slate-500 text-right">{hint}</span>}
    </div>
  );
}

/**
 * Phase 29.1: Requests waiting for approval (compact, for the dashboard's side column).
 * Props: requests (ShiftRequestResponse[]), reliabilityMap, timeZone, actionLoading, onReview(req), onApprove(id), onDeny(id)
 */
export function ApprovalQueueCard({ requests, reliabilityMap = {}, timeZone, actionLoading, onReview, onApprove, onDeny }) {
  return (
    <section id="approval-queue" className={card}>
      <Header icon={Users} title="Requests to review" count={requests.length} hint="Oldest shift first" />
      {requests.length === 0 ? (
        <p className="text-xs text-slate-500 py-3 text-center">All caught up. No requests waiting.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => {
            const w = req.worker;
            const s = req.shift;
            const busy = actionLoading === `approve-${req.id}` || actionLoading === `deny-${req.id}`;
            const full = s && (s.spots_filled || 0) >= (s.capacity || 1);
            return (
              <div key={req.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onReview(req)} className="text-left min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-white hover:text-emerald-300">{name(w)}</span>
                      <RatingBadge rating={w?.aggregate_rating} count={w?.rating_count} showCount={false} />
                      <ReliabilityBadge data={reliabilityMap[w?.id]} />
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      <span className="font-semibold text-emerald-300">{s?.role_type}</span> · {s?.title}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {fmtDate(s?.start_time, timeZone)} · {fmtTimeRange(s?.start_time, s?.end_time, timeZone)}
                      {full && <span className="text-rose-300 font-semibold"> · full</span>}
                    </div>
                  </button>
                </div>
                {req.notes && (
                  <div className="text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 flex gap-1">
                    <MessageSquareQuote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">“{req.notes}”</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onReview(req)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1 mr-auto">
                    <Eye className="w-3 h-3" /> Review
                  </button>
                  <button type="button" onClick={() => onDeny(req.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <X className="w-3 h-3" /> Deny
                  </button>
                  <button type="button" onClick={() => onApprove(req.id)} disabled={busy || full}
                    title={full ? 'Position is full' : 'Approve'}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                    <Check className="w-3 h-3" /> Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Phase 29.1: Hand-offs waiting for approval.
 * Props: transfers (ShiftTransferResponse[]), timeZone, actionLoading, onReview(t), onApprove(id), onDeny(id)
 */
export function TransfersCard({ transfers, timeZone, actionLoading, onReview, onApprove, onDeny }) {
  return (
    <section id="pending-transfers" className={card}>
      <Header icon={ArrowRightLeft} title="Hand-offs to approve" count={transfers.length} hint="Worker-to-worker" />
      {transfers.length === 0 ? (
        <p className="text-xs text-slate-500 py-3 text-center">No hand-offs waiting.</p>
      ) : (
        <div className="space-y-2">
          {transfers.map((t) => {
            const s = t.shift;
            const busy = actionLoading?.includes(t.id);
            return (
              <div key={t.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <button type="button" onClick={() => onReview(t)} className="text-left w-full">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm text-white font-semibold">
                    {name(t.from_worker)} <ArrowRight className="w-3.5 h-3.5 text-amber-400" /> {name(t.to_worker)}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    <span className="font-semibold text-emerald-300">{s?.role_type}</span> · {s?.title}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {fmtDate(s?.start_time, timeZone)} · {fmtTimeRange(s?.start_time, s?.end_time, timeZone)}
                  </div>
                </button>
                {t.notes && (
                  <div className="text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 flex gap-1">
                    <MessageSquareQuote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">“{t.notes}”</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onReview(t)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1 mr-auto">
                    <Eye className="w-3 h-3" /> Review
                  </button>
                  <button type="button" onClick={() => onDeny(t.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <X className="w-3 h-3" /> Deny
                  </button>
                  <button type="button" onClick={() => onApprove(t.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <Check className="w-3 h-3" /> Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
