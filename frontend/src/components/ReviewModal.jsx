import React, { useState } from 'react';
import { ClipboardCheck, Check, X, CalendarDays, MessageSquareQuote, ArrowRight, ExternalLink } from 'lucide-react';
import ModalShell from './ModalShell';
import WorkerProfilePanel from './WorkerProfilePanel';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

function name(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || p?.email || 'Worker';
}

function ShiftSummary({ shift, timeZone }) {
  if (!shift) return null;
  const cap = shift.capacity || 1;
  const filled = shift.spots_filled || 0;
  return (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{shift.role_type}</span>
        <span className="text-sm font-bold text-white">{shift.title}</span>
      </div>
      <div className="text-xs text-slate-300 inline-flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
        {fmtLongDate(shift.start_time, timeZone)} · {fmtTimeRange(shift.start_time, shift.end_time, timeZone)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} className="text-emerald-400 font-semibold" />
        <TipBadge shift={shift} />
        <span className={filled >= cap ? 'text-rose-300 font-semibold' : 'text-slate-400'}>
          {filled}/{cap} filled{filled >= cap ? ' (full)' : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Phase 29.1: Look before you approve.
 * item = { type: 'request', data: ShiftRequestResponse } | { type: 'transfer', data: ShiftTransferResponse }
 * Props: venueId, item, timeZone, busy, onApprove(id), onDeny(id), onOpenEvent(eventId), onClose
 */
export default function ReviewModal({ venueId, item, timeZone, busy, onApprove, onDeny, onOpenEvent, onClose }) {
  const isTransfer = item.type === 'transfer';
  const d = item.data;
  const shift = d.shift;
  const [who, setWho] = useState(isTransfer ? 'to' : 'worker'); // transfer: 'to' | 'from'
  const workerId = isTransfer ? (who === 'to' ? d.to_worker_id : d.from_worker_id) : d.worker_id;
  const note = d.notes;

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Close
      </button>
      {shift?.event_id && onOpenEvent && (
        <button type="button" onClick={() => onOpenEvent(shift.event_id)}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200 inline-flex items-center gap-1.5">
          <ExternalLink className="w-4 h-4" /> Open event
        </button>
      )}
      <button type="button" onClick={() => onDeny(d.id)} disabled={busy}
        className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-600/40 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
        <X className="w-4 h-4" /> {isTransfer ? 'Deny hand-off' : 'Deny'}
      </button>
      <button type="button" onClick={() => onApprove(d.id)} disabled={busy}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
        <Check className="w-4 h-4" /> {isTransfer ? 'Approve hand-off' : 'Approve'}
      </button>
    </>
  );

  return (
    <ModalShell
      title={isTransfer ? `Hand-off: ${name(d.from_worker)} → ${name(d.to_worker)}` : `${name(d.worker)} wants ${shift?.role_type || 'a shift'}`}
      subtitle={isTransfer ? 'Review who is taking the shift before you approve.' : `Requested ${fmtDateTime(d.created_at, timeZone)}`}
      icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        <div className="md:col-span-2 space-y-3">
          <ShiftSummary shift={shift} timeZone={timeZone} />
          {isTransfer && (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{name(d.from_worker)}</span>
              <ArrowRight className="w-4 h-4 text-amber-400" />
              <span className="font-semibold">{name(d.to_worker)}</span>
              <span className="text-xs text-slate-500 w-full">Proposed {fmtDateTime(d.created_at, timeZone)}. {name(d.to_worker)} already accepted.</span>
            </div>
          )}
          <div className={`p-3 rounded-xl border text-sm ${note ? 'bg-amber-500/5 border-amber-500/40 text-amber-50' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1 text-amber-300">
              <MessageSquareQuote className="w-3.5 h-3.5" /> {isTransfer ? 'Their note' : 'Note with the request'}
            </div>
            <div className="whitespace-pre-line">{note ? `“${note}”` : 'No note.'}</div>
          </div>
        </div>

        <div className="md:col-span-3">
          {isTransfer && (
            <div className="flex gap-2 mb-3">
              {[
                ['to', `Taking it: ${d.to_worker?.first_name || 'worker'}`],
                ['from', `Giving it up: ${d.from_worker?.first_name || 'worker'}`],
              ].map(([id, label]) => (
                <button key={id} type="button" onClick={() => setWho(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${who === id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <WorkerProfilePanel key={workerId} venueId={venueId} workerId={workerId} timeZone={timeZone} />
        </div>
      </div>
    </ModalShell>
  );
}
