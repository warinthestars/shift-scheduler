import React, { useState } from 'react';
import { KeyRound, Copy, Eye, EyeOff, RefreshCw, Check } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500';

export default function ResetPasswordModal({ user, onClose, onDone }) {
  const [mode, setMode] = useState('generate'); // 'generate' | 'custom'
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { generated, temporary_password }
  const [copied, setCopied] = useState(false);

  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

  const submit = async () => {
    setError('');
    if (mode === 'custom') {
      if (pw.length < 8) return setError('Password must be at least 8 characters.');
      if (pw !== pw2) return setError("The two passwords don't match.");
    }
    setSaving(true);
    try {
      const res = await api.post(`/admin/users/${user.id}/reset-password`, mode === 'custom' ? { new_password: pw } : {});
      setResult(res.data);
      onDone && onDone(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not reset the password.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError('Copy failed. Select the password and copy it manually.');
    }
  };

  const footer = result ? (
    <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">
      Done
    </button>
  ) : (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        Cancel
      </button>
      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
      >
        {saving ? 'Resetting…' : mode === 'generate' ? 'Generate password' : 'Set password'}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Reset password"
      subtitle={`${name} · ${user.email}`}
      icon={<KeyRound className="w-5 h-5 text-indigo-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={footer}
    >
      {error && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}

      {result ? (
        result.generated ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">New temporary password for <strong className="text-white">{name}</strong>:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-lg tracking-wider text-emerald-300 font-mono select-all">
                {result.temporary_password}
              </code>
              <button type="button" onClick={copy} className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200" title="Copy">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              This is the only time it's shown. Send it to them privately (text or in person). They can sign in with it right away.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-300">
            Password updated for <strong className="text-white">{name}</strong>. Let them know the new password privately.
          </p>
        )
      ) : (
        <div className="space-y-3">
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === 'generate' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-800/40'}`}>
            <input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-white flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Generate a temporary password
              </span>
              <span className="block text-xs text-slate-400">Easiest. We'll show it once so you can pass it on.</span>
            </span>
          </label>
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === 'custom' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-800/40'}`}>
            <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-white">Set a specific password</span>
              <span className="block text-xs text-slate-400">At least 8 characters.</span>
            </span>
          </label>

          {mode === 'custom' && (
            <div className="space-y-2">
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="New password"
                  className={`${inputCls} pr-10`}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input
                type={show ? 'text' : 'password'}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Type it again"
                className={inputCls}
                autoComplete="new-password"
              />
            </div>
          )}

          {user.auth_source === 'both' && (
            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
              This person can also sign in with Firebase. That login isn't affected.
            </p>
          )}
        </div>
      )}
    </ModalShell>
  );
}
