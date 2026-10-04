import React, { useState } from 'react';
import { CalendarOff, Check, X, AlertTriangle, MessageSquareQuote } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { fmtDayRange } from '../../utils/availability';

/**
 * Phase 31: Time-off requests from this venue's team, waiting for a decision.
 * Shown in the dashboard's side column only while there are some (like the request / hand-off cards).
 * Clashes list the shifts they're booked on HERE during those days.
 * Props: venueId, items (TimeOffItem[]), onOpenWorker(workerId), onDone(message)
 */
export default function TimeOffCard({ venueId, items = [], onOpenWorker, onDone }) {
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const approve = async (t) => {
    setBusy(t.id);
    try {
      await api.post(`/time-off/${t.id}/decide`, { approve: true }, { params: { venue_id: venueId } });
      onDone(`Approved ${t.worker_name}'s time off.${t.conflicts?.length ? ' They’re still booked on some of those days, so find cover or remove them.' : ''}`);
    } catch (err) {
      onDone(err.response?.data?.detail || 'Could not approve.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const askDeny = (t) => setConfirm({
    title: `Decline ${t.worker_name}'s time off?`,
    message: `${fmtDayRange(t.start_date, t.end_date)}. They’ll see your note.`,
    confirmLabel: 'Decline',
    danger: true,
    input: { label: 'Note for them', placeholder: 'e.g. We’re short that weekend. Can you swap with Sam?', required: true },
    onConfirm: async (note) => {
      await api.post(`/time-off/${t.id}/decide`, { approve: false, note }, { params: { venue_id: venueId } });
      onDone(`Declined. ${t.worker_name} has been told.`);
    },
  });

  if (!items.length) return null;

  return (
    <section id="time-off-queue" className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl scroll-mt-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarOff className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-white">Time off requests</h2>
        <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((t) => (
          <div key={t.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
            <button type="button" onClick={() => onOpenWorker?.(t.worker_id)} className="text-sm font-bold text-white hover:text-emerald-300 text-left">
              {t.worker_name}
            </button>
            <p className="text-xs text-slate-200">{fmtDayRange(t.start_date, t.end_date)}</p>
            {t.reason && (
              <p className="text-[11px] text-slate-400 inline-flex items-start gap-1">
                <MessageSquareQuote className="w-3 h-3 mt-0.5 flex-shrink-0" /> “{t.reason}”
              </p>
            )}
            {t.conflicts?.length > 0 && (
              <p className="text-[11px] text-amber-300 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Booked here then: {t.conflicts.join('; ')}</span>
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => askDeny(t)} disabled={busy === t.id}
                className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Decline
              </button>
              <button type="button" onClick={() => approve(t)} disabled={busy === t.id}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> {busy === t.id ? 'Saving…' : 'Approve'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
