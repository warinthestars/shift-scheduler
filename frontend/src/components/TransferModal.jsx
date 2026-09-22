import React, { useState, useEffect } from 'react';
import api from '../api/client';
import {
  ArrowRightLeft, X, AlertCircle, Check, Users, Calendar, Clock
} from 'lucide-react';

export default function TransferModal({ isOpen, onClose, myConfirmedShifts = [], preselectedShiftId = null, onTransferSuccess }) {
  const [selectedShiftId, setSelectedShiftId] = useState(preselectedShiftId || '');
  const [eligibleWorkers, setEligibleWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (preselectedShiftId) {
      setSelectedShiftId(preselectedShiftId);
    } else if (myConfirmedShifts.length > 0 && !selectedShiftId) {
      setSelectedShiftId(myConfirmedShifts[0].shift_id || myConfirmedShifts[0].shift?.id || '');
    }
  }, [preselectedShiftId, myConfirmedShifts]);

  // Fetch eligible workers whenever selected shift changes
  useEffect(() => {
    const fetchWorkers = async () => {
      if (!selectedShiftId) return;
      try {
        setLoadingWorkers(true);
        setError(null);

        const currentShift = myConfirmedShifts.find(
          (item) => (item.shift_id || item.shift?.id) === selectedShiftId
        )?.shift;
        const venueId = currentShift?.venue_id || currentShift?.venue?.id;

        let res;
        if (venueId) {
          try {
            res = await api.get(`/venues/${venueId}/workers`);
          } catch (venueErr) {
            res = await api.get(`/transfers/eligible-workers/${selectedShiftId}`);
          }
        } else {
          res = await api.get(`/transfers/eligible-workers/${selectedShiftId}`);
        }

        setEligibleWorkers(res.data || []);
        if (res.data && res.data.length > 0) {
          setSelectedWorkerId(res.data[0].id);
        } else {
          setSelectedWorkerId('');
        }
      } catch (err) {
        console.error('Error fetching eligible workers:', err);
        setError('Could not load eligible workers for this shift.');
      } finally {
        setLoadingWorkers(false);
      }
    };

    if (isOpen && selectedShiftId) {
      fetchWorkers();
    }
  }, [isOpen, selectedShiftId]);

  if (!isOpen) return null;

  const currentShiftObj = myConfirmedShifts.find(
    (item) => (item.shift_id || item.shift?.id) === selectedShiftId
  )?.shift;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedShiftId || !selectedWorkerId || submitting) return;

    try {
      setSubmitting(true);
      setError(null);
      await api.post('/transfers/propose', {
        shift_id: selectedShiftId,
        to_worker_id: selectedWorkerId,
      });

      if (onTransferSuccess) {
        onTransferSuccess();
      }
      onClose();
    } catch (err) {
      console.error('Error proposing shift transfer:', err);
      setError(err.response?.data?.detail || 'Failed to propose shift transfer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-white">Transfer Shift to Peer</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Shift selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Select Shift to Transfer
            </label>
            <select
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
            >
              {myConfirmedShifts.map((req) => {
                const s = req.shift;
                const id = req.shift_id || s?.id;
                return (
                  <option key={id} value={id}>
                    {s?.title} ({s?.role_type}) — {new Date(s?.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </option>
                );
              })}
            </select>
          </div>

          {currentShiftObj && (
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1 text-slate-300">
              <p className="font-bold text-white">{currentShiftObj.title}</p>
              <p className="text-slate-400">{currentShiftObj.venue?.name} • ${currentShiftObj.hourly_rate}/hr</p>
              <p className="text-slate-500 text-[11px]">
                {new Date(currentShiftObj.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          )}

          {/* Peer worker selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Transfer to Worker (Eligible Peers)
            </label>
            {loadingWorkers ? (
              <div className="text-xs text-slate-500 py-2">Loading eligible venue workers...</div>
            ) : eligibleWorkers.length === 0 ? (
              <div className="text-xs text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800">
                No other workers found available for transfer.
              </div>
            ) : (
              <select
                value={selectedWorkerId}
                onChange={(e) => setSelectedWorkerId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
              >
                {eligibleWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.first_name} {w.last_name} ({w.email}) — ★ {Number(w.aggregate_rating || 5.0).toFixed(1)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <p className="text-[11px] text-slate-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl">
            <strong>Dual-Approval Workflow:</strong> The peer will receive this transfer offer. Once they accept, your Venue Manager will review and give final approval before the shift moves to their schedule.
          </p>

          <div className="pt-2 border-t border-slate-800 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedShiftId || !selectedWorkerId || submitting || eligibleWorkers.length === 0}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition disabled:opacity-40 shadow-md shadow-amber-500/20"
            >
              {submitting ? 'Proposing...' : 'Propose Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
