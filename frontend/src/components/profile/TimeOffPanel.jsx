import React, { useState } from 'react';
import { CalendarOff, Send, AlertTriangle, MessageSquareQuote } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { fmtDayRange, todayIso } from '../../utils/availability';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const STATUS = {
  pending: ['Waiting for a manager', 'bg-amber-500/10 text-amber-300 border-amber-500/30'],
  approved: ['Approved', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'],
  denied: ['Not approved', 'bg-rose-500/10 text-rose-300 border-rose-500/30'],
  cancelled: ['Cancelled', 'bg-slate-800 text-slate-400 border-slate-700'],
};

/**
 * Phase 31: Ask for days off and see what happened to earlier requests.
 * Requests go to the managers of every venue you're on the team with; one of them decides.
 * Props: items (TimeOffItem[]), onChanged(message), onError(message)
 */
export default function TimeOffPanel({ items = [], onChanged, onError }) {
  const today = todayIso();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post('/me/time-off', { start_date: start, end_date: end < start ? start : end, reason: reason.trim() || null });
      setReason('');
      onChanged(res.data.conflicts?.length
        ? 'Sent. Heads up: you’re booked on some of those days. Drop or hand off those shifts if you can’t work them.'
        : 'Sent to your managers. You’ll get a notification when they decide.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not send your request.');
    } finally {
      setBusy(false);
    }
  };

  const askCancel = (t) => setConfirm({
    title: t.status === 'approved' ? 'Cancel this time off?' : 'Withdraw this request?',
    message: `${fmtDayRange(t.start_date, t.end_date)}. You can ask again later if you need to.`,
    confirmLabel: t.status === 'approved' ? 'Cancel time off' : 'Withdraw',
    danger: true,
    onConfirm: async () => {
      await api.post(`/me/time-off/${t.id}/cancel`);
      onChanged('Done.');
    },
  });

  const open = items.filter((t) => ['pending', 'approved'].includes(t.status) && t.end_date >= today);
  const past = items.filter((t) => !open.includes(t));

  return (
    <div className="space-y-6">
      <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5"><CalendarOff className="w-4 h-4 text-amber-300" /> Ask for time off</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs font-semibold text-slate-300">First day
            <input type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Last day
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300 sm:col-span-1">Reason (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="e.g. Family wedding" className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">Goes to the managers at the venues you're on the team with. Shifts you're already booked on stay booked.</p>
          <button type="button" onClick={submit} disabled={busy || !start}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Send className="w-4 h-4" /> {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-white">Coming up</h3>
        {open.length === 0 && <p className="text-xs text-slate-500">No time off coming up.</p>}
        {open.map((t) => <TimeOffRow key={t.id} t={t} onCancel={() => askCancel(t)} />)}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-400">Earlier</h3>
          {past.map((t) => <TimeOffRow key={t.id} t={t} />)}
        </section>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function TimeOffRow({ t, onCancel }) {
  const [label, cls] = STATUS[t.status] || [t.status, STATUS.cancelled[1]];
  return (
    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">{fmtDayRange(t.start_date, t.end_date)}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{label}</span>
        </div>
        {t.reason && <p className="text-xs text-slate-400 mt-0.5">{t.reason}</p>}
        {(t.decided_by_name || t.decision_note) && ['approved', 'denied'].includes(t.status) && (
          <p className="text-[11px] text-slate-400 mt-1 inline-flex items-start gap-1">
            <MessageSquareQuote className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              {t.decided_by_name}{t.decided_venue_name ? ` · ${t.decided_venue_name}` : ''}
              {t.decision_note ? `: “${t.decision_note}”` : ''}
            </span>
          </p>
        )}
        {t.conflicts?.length > 0 && ['pending', 'approved'].includes(t.status) && (
          <p className="text-[11px] text-amber-300 mt-1 inline-flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Still booked: {t.conflicts.join('; ')}</span>
          </p>
        )}
      </div>
      {onCancel && (
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold self-start sm:self-auto">
          {t.status === 'approved' ? 'Cancel' : 'Withdraw'}
        </button>
      )}
    </div>
  );
}
