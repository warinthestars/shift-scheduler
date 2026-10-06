import React from 'react';
import { ArrowRightLeft, Check, X, Inbox, Send, MessageSquareQuote } from 'lucide-react';
import PayLabel from '../PayLabel';
import TipBadge from '../TipBadge';
import { fmtDateTime } from '../../utils/venueTime';

const OUT_STATUS = {
  pending_worker_acceptance: ['Waiting for them', 'text-amber-300'],
  pending_manager_approval: ['They accepted · waiting for the manager', 'text-amber-300'],
  approved: ['Done · they have the shift', 'text-emerald-300'],
  declined: ['They said no · you still have the shift', 'text-slate-400'],
  denied: ['Manager said no · you still have the shift', 'text-slate-400'],
  cancelled_by_sender: ['You withdrew it', 'text-slate-500'],
};
// Phase 34: hand-offs that came from a cover request (someone took your post)
const COVER_STATUS = {
  pending_manager_approval: ['Took your cover request · waiting for the manager', 'text-amber-300'],
  approved: ['Covered · they have the shift', 'text-emerald-300'],
  denied: ['Manager said no · you still have the shift', 'text-slate-400'],
  cancelled_by_sender: ['You kept the shift', 'text-slate-500'],
  expired: ['The shift started before the manager decided', 'text-slate-500'],
};
const WAITING = ['pending_worker_acceptance', 'pending_manager_approval'];
const RECENT_DAYS = 14;

function ShiftLine({ shift }) {
  return (
    <>
      <h3 className="text-sm font-bold text-white mt-1">{shift?.title}</h3>
      <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
        <span className="font-semibold text-slate-200">{shift?.role_type}</span>
        <span>·</span>
        <span>{shift?.venue?.name}</span>
        <span>·</span>
        <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} className="text-brand-400 font-semibold" />
        <TipBadge shift={shift} />
      </p>
      <p className="text-xs text-slate-500 mt-0.5">{fmtDateTime(shift?.start_time, shift?.venue?.timezone)}</p>
    </>
  );
}

/**
 * Phase 29.4: Hand-offs tab. Incoming (accept / decline) and the ones I sent (withdraw while waiting).
 * Props: incoming[], outgoing[] (ShiftTransferResponse), busyId, onAccept(t), onDecline(t), onWithdraw(t)
 */
export default function HandoffsPanel({ incoming = [], outgoing = [], busyId, onAccept, onDecline, onWithdraw }) {
  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  const sent = outgoing.filter((t) => WAITING.includes(t.status) || new Date(t.updated_at).getTime() >= cutoff);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Inbox className="w-4 h-4 text-amber-400" /> Offered to you by teammates ({incoming.length})
        </h2>
        {incoming.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center">
            When a teammate wants to hand you one of their shifts, it shows up here.
          </p>
        ) : incoming.map((t) => (
          <div key={t.id} className="p-4 bg-slate-900 border border-amber-500/30 rounded-2xl flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-400">
                <strong className="text-white">{t.from_worker?.first_name} {t.from_worker?.last_name}</strong> wants to hand you this shift
              </p>
              <ShiftLine shift={t.shift} />
              {t.notes && (
                <p className="mt-2 text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 inline-flex gap-1">
                  <MessageSquareQuote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" /> “{t.notes}”
                </p>
              )}
              <p className="text-[10px] text-slate-500 mt-1">If you accept, your manager still has to approve it.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onDecline(t)} disabled={busyId === t.id}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Decline
              </button>
              <button type="button" onClick={() => onAccept(t)} disabled={busyId === t.id}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> {busyId === t.id ? 'Working…' : 'Accept'}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Send className="w-4 h-4 text-slate-400" /> Sent by you
          <span className="text-[11px] font-normal text-slate-500">(last {RECENT_DAYS} days)</span>
        </h2>
        {sent.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center flex flex-col items-center gap-1">
            <ArrowRightLeft className="w-5 h-5 text-slate-600" />
            To hand off a shift, open it in My shifts and choose “Hand off to a teammate” from its ⋯ menu.
          </p>
        ) : sent.map((t) => {
          const [label, tone] = (t.cover_request_id && COVER_STATUS[t.status]) || OUT_STATUS[t.status] || [t.status, 'text-slate-400'];
          const waiting = WAITING.includes(t.status);
          return (
            <div key={t.id} className={`p-4 bg-slate-900 border rounded-2xl flex flex-col md:flex-row md:items-center gap-3 ${waiting ? 'border-slate-700' : 'border-slate-800 opacity-80'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400">
                  To <strong className="text-white">{t.to_worker?.first_name} {t.to_worker?.last_name}</strong>
                  <span className={`ml-2 font-semibold ${tone}`}>{label}</span>
                </p>
                <ShiftLine shift={t.shift} />
              </div>
              {waiting && (
                <button type="button" onClick={() => onWithdraw(t)} disabled={busyId === t.id}
                  className="px-3.5 py-2 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold disabled:opacity-50 self-start md:self-auto">
                  {busyId === t.id ? 'Withdrawing…' : 'Withdraw'}
                </button>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
