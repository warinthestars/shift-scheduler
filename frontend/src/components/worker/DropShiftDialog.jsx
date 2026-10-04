import React, { useState } from 'react';
import { AlertTriangle, LogOut } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import PayLabel from '../PayLabel';
import { fmtDateTime } from '../../utils/venueTime';

const LATE_DROP_HOURS = 72;   // matches backend reliability (dropped with < 72h notice = late drop)

/**
 * Phase 29.4: Drop a booked shift (replaces the old hand-built confirm box).
 * Optional reason goes to the managers. Explains the late-drop rule and that coming back needs approval.
 * Props: req (ShiftRequestResponse), onClose, onDropped(message)
 */
export default function DropShiftDialog({ req, onClose, onDropped }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shift = req.shift || {};
  const hoursLeft = (new Date(shift.start_time).getTime() - Date.now()) / 3600000;
  const late = hoursLeft < LATE_DROP_HOURS;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/shifts/${req.shift_id || shift.id}/drop`, { reason: reason.trim() || null });
      onDropped('Shift dropped. Your manager has been told and the spot is open again.');
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not drop this shift.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Drop this shift?"
      icon={<LogOut className="w-5 h-5 text-rose-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Keep it
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold disabled:opacity-50">
            {busy ? 'Dropping…' : 'Drop shift'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
          <p className="font-bold text-white">{shift.title}</p>
          <p className="text-slate-400">
            {shift.venue?.name} · {shift.role_type} · <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} />
          </p>
          <p className="text-slate-500">{fmtDateTime(shift.start_time, shift.venue?.timezone)}</p>
        </div>
        {late && (
          <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>It starts in less than {LATE_DROP_HOURS} hours, so this counts as a late drop on your reliability score.</span>
          </p>
        )}
        <label className="block text-xs font-semibold text-slate-300">
          Tell your manager why (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="e.g. My car broke down"
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
          />
        </label>
        <p className="text-[11px] text-slate-500">
          The spot opens for other workers straight away. If you can make it after all, you can ask to come back from
          My shifts. Your manager has to approve it.
        </p>
      </div>
    </ModalShell>
  );
}
