import React, { useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import ModalShell from './ModalShell';

/**
 * Phase 29.3: A small yes/no dialog, optionally with one text field.
 * onConfirm(value) may throw; the error is shown and the dialog stays open.
 * input: { label, placeholder, initial, required } (optional)
 */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', danger = false, input = null, onConfirm, onClose,
}) {
  const [value, setValue] = useState(input?.initial || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (input?.required && !value.trim()) return setError(`${input.label || 'This'} is required.`);
    setSaving(true);
    try {
      await onConfirm(value.trim());
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={title}
      icon={danger ? <AlertTriangle className="w-5 h-5 text-rose-400" /> : <HelpCircle className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Go back
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className={`px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'}`}>
            {saving ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {message && <p className="text-sm text-slate-300">{message}</p>}
      {input && (
        <label className="block text-xs font-semibold text-slate-300 mt-3">
          {input.label}
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={input.placeholder || ''}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500" />
        </label>
      )}
    </ModalShell>
  );
}
