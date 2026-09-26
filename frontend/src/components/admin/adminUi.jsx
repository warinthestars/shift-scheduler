import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, KeyRound, Flame, AlertTriangle, Check, AlertCircle } from 'lucide-react';
import ModalShell from '../ModalShell';
import { useModalLayer } from '../modalLayer';

/** Phase 29.2: Small shared pieces for the admin console. */

export const card = 'bg-slate-900 border border-slate-800 rounded-2xl shadow-xl';
export const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500';
export const selectCls =
  'px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500';
export const btnGhost =
  'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50';
export const btnPrimary =
  'px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';
export const btnDanger =
  'px-3 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';

export const ROLE_LABEL = { worker: 'Worker', venue_manager: 'Venue manager', platform_admin: 'Platform admin' };
const ROLE_CLS = {
  worker: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
  venue_manager: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  platform_admin: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
};
export const POLICY_LABEL = {
  team_auto: 'Team books instantly',
  manual: 'Manager approves all',
  everyone_auto: 'Anyone books instantly',
};

export function personName(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || p?.email || 'Unknown';
}

export function ago(value) {
  if (!value) return 'never';
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function RoleBadge({ role }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${ROLE_CLS[role] || ROLE_CLS.worker}`}>
      {ROLE_LABEL[role] || role}
    </span>
  );
}

export function AuthBadge({ source }) {
  if (source === 'firebase') {
    return (
      <span title="Signs in with Firebase (Google, email link…)" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
        <Flame className="w-3 h-3" /> Firebase
      </span>
    );
  }
  if (source === 'both') {
    return (
      <span title="Has a ShiftBoard password and is linked to Firebase" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
        <KeyRound className="w-3 h-3" /> Password + <Flame className="w-3 h-3 text-amber-300" />
      </span>
    );
  }
  return (
    <span title="Signs in with a ShiftBoard password" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/50">
      <KeyRound className="w-3 h-3" /> Password
    </span>
  );
}

export function StatTile({ label, value, sub, tone = 'text-white', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 ${onClick ? 'hover:border-slate-600 transition' : ''}`}>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-black mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </Tag>
  );
}

export function SectionTitle({ icon: Icon, title, right, tone = 'text-indigo-400' }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${tone}`} />}
        <h2 className="text-sm font-bold text-white truncate">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/** A dismissable success/error banner. */
export function Flash({ flash, onClose }) {
  useEffect(() => {
    if (!flash || flash.type === 'error') return undefined;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [flash, onClose]);
  if (!flash) return null;
  const ok = flash.type !== 'error';
  return (
    <div className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-sm ${
      ok ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200' : 'bg-rose-950/80 border-rose-700 text-rose-200'}`}>
      <span className="flex items-start gap-2">
        {ok ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
        {flash.message}
      </span>
      <button type="button" onClick={onClose} className="text-xs underline flex-shrink-0">Dismiss</button>
    </div>
  );
}

/** A right-hand side panel (Esc and backdrop close it). */
export function Drawer({ title, subtitle, onClose, children, footer }) {
  useModalLayer(onClose);
  return createPortal(
    <div className="fixed inset-0 z-[55] flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/70" />
      <aside role="dialog" aria-modal="true"
        className="relative w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white truncate">{title}</h3>
            {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap justify-end gap-2">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Confirm a dangerous action by typing a word (usually the name).
 * onConfirm(extra) may throw; the error is shown. `children` renders extra options above the input.
 */
export function TypeToConfirm({ title, message, word, confirmLabel = 'Delete', onConfirm, onClose, children }) {
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const match = typed.trim().toLowerCase() === (word || '').trim().toLowerCase();

  const submit = async () => {
    if (!match) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm();
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
      icon={<AlertTriangle className="w-5 h-5 text-rose-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Go back</button>
          <button type="button" onClick={submit} disabled={!match || saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40">
            {saving ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        {message && <div className="text-sm text-slate-300">{message}</div>}
        {children}
        <label className="block text-xs text-slate-400">
          Type <span className="font-bold text-white">{word}</span> to confirm
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} className={`${inputCls} mt-1`} />
        </label>
      </div>
    </ModalShell>
  );
}

/** Copy-to-clipboard button that flips to "Copied". */
export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={btnGhost}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text is visible to copy by hand */
        }
      }}>
      {done ? <Check className="w-3 h-3" /> : null}{done ? 'Copied' : label}
    </button>
  );
}

/** Switch the manager dashboard to a venue (platform admins) and go there. */
export function openVenueAsManager(navigate, venueId) {
  try {
    localStorage.setItem('shiftboard_admin_venue_id', venueId);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venueId }));
  navigate(`/venue?venue=${venueId}`);
}

/** Tell the navbar's venue switcher to reload its list (after create/delete). */
export function venuesChanged() {
  window.dispatchEvent(new CustomEvent('admin_venues_changed'));
}
