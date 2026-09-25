import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalShell from './ModalShell';

/** Confirm an action with an optional/required reason. onConfirm(reason) may throw to show an error. */
export default function ReasonDialog({
  title, message, confirmLabel = 'Confirm', danger = false, requireReason = true,
  placeholder = 'Reason (staff will see this)', onConfirm, onClose,
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (requireReason && !reason.trim()) return setError('Please add a short reason.');
    setSaving(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        Go back
      </button>
      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className={`px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'}`}
      >
        {saving ? 'Working…' : confirmLabel}
      </button>
    </>
  );

  return (
    <ModalShell
      title={title}
      icon={<AlertTriangle className={`w-5 h-5 ${danger ? 'text-rose-400' : 'text-amber-400'}`} />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={footer}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {message && <p className="text-sm text-slate-300 mb-3">{message}</p>}
      <textarea
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={requireReason ? placeholder : `${placeholder} (optional)`}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
      />
    </ModalShell>
  );
}
