import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { ArrowRightLeft, AlertCircle, Info } from 'lucide-react';
import ModalShell from './ModalShell';
import { fmtShortDate, fmtDateTime } from '../utils/venueTime';
import PayLabel from './PayLabel';

/**
 * Hand off one of my booked shifts to a teammate (they accept, then the manager approves).
 * Phase 29.4: ModalShell (Esc closes it) and "hand off" wording everywhere.
 * Props: isOpen, onClose, myConfirmedShifts (ShiftRequestResponse[]), preselectedShiftId, onTransferSuccess()
 */
export default function TransferModal({ isOpen, onClose, myConfirmedShifts = [], preselectedShiftId = null, onTransferSuccess }) {
  const [selectedShiftId, setSelectedShiftId] = useState(preselectedShiftId || '');
  const [eligibleWorkers, setEligibleWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (preselectedShiftId) {
      setSelectedShiftId(preselectedShiftId);
    } else if (myConfirmedShifts.length > 0 && !selectedShiftId) {
      setSelectedShiftId(myConfirmedShifts[0].shift_id || myConfirmedShifts[0].shift?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedShiftId, myConfirmedShifts]);

  useEffect(() => {
    if (!isOpen || !selectedShiftId) return undefined;
    let active = true;
    setLoadingWorkers(true);
    setError(null);
    api
      .get(`/transfers/eligible-workers/${selectedShiftId}`)
      .then((res) => {
        if (!active) return;
        const list = res.data || [];
        setEligibleWorkers(list);
        setSelectedWorkerId(list.length ? list[0].id : '');
      })
      .catch(() => active && setError('Could not load teammates for this shift.'))
      .finally(() => active && setLoadingWorkers(false));
    return () => {
      active = false;
    };
  }, [isOpen, selectedShiftId]);

  if (!isOpen) return null;

  const currentShiftObj = myConfirmedShifts.find((item) => (item.shift_id || item.shift?.id) === selectedShiftId)?.shift;

  const handleSubmit = async () => {
    if (!selectedShiftId || !selectedWorkerId || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      await api.post('/transfers/propose', {
        shift_id: selectedShiftId,
        to_worker_id: selectedWorkerId,
        notes: notes.trim() || undefined,
      });
      if (onTransferSuccess) onTransferSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send the hand-off.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectCls = 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500';

  return (
    <ModalShell
      title="Hand off a shift"
      icon={<ArrowRightLeft className="w-5 h-5 text-amber-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedShiftId || !selectedWorkerId || submitting || eligibleWorkers.length === 0}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-40"
          >
            {submitting ? 'Sending…' : 'Send hand-off'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <label className="block text-xs font-semibold text-slate-300">
          Shift
          <select value={selectedShiftId} onChange={(e) => setSelectedShiftId(e.target.value)} className={`${selectCls} mt-1`}>
            {myConfirmedShifts.map((req) => {
              const s = req.shift;
              const id = req.shift_id || s?.id;
              return (
                <option key={id} value={id}>
                  {s?.title} ({s?.role_type}) · {fmtShortDate(s?.start_time, s?.venue?.timezone)}
                </option>
              );
            })}
          </select>
        </label>

        {currentShiftObj && (
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1 text-slate-300">
            <p className="font-bold text-white">{currentShiftObj.title}</p>
            <p className="text-slate-400">
              {currentShiftObj.venue?.name} · {currentShiftObj.role_type} ·{' '}
              <PayLabel rate={currentShiftObj.hourly_rate} rateMax={currentShiftObj.hourly_rate_max} />
            </p>
            <p className="text-slate-500 text-[11px]">{fmtDateTime(currentShiftObj.start_time, currentShiftObj.venue?.timezone)}</p>
          </div>
        )}

        <label className="block text-xs font-semibold text-slate-300">
          Hand it to
          {loadingWorkers ? (
            <div className="text-xs text-slate-500 py-2 font-normal">Finding teammates who are free…</div>
          ) : eligibleWorkers.length === 0 ? (
            <div className="text-xs text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800 mt-1 font-normal">
              Nobody on this venue's team is free for this shift. You can still drop it (more than 24 hours before it starts), or message your manager.
            </div>
          ) : (
            <select value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)} className={`${selectCls} mt-1`}>
              {eligibleWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.first_name} {w.last_name} · {w.rating_count ? `★ ${Number(w.aggregate_rating || 0).toFixed(1)}` : 'New'}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="block text-xs font-semibold text-slate-300">
          Note for them and your manager (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder="e.g. Family thing came up. Thanks for covering!"
            rows={2}
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </label>

        <p className="text-[11px] text-slate-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl flex gap-2">
          <Info className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" />
          <span>
            They accept first, then your manager approves. <b className="text-slate-200">You stay on the shift until the manager approves.</b>{' '}
            You can withdraw it from the Hand-offs tab while it's waiting.
          </span>
        </p>
      </div>
    </ModalShell>
  );
}
