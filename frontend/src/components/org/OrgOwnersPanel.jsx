import React, { useState } from 'react';
import { Crown, UserPlus, Trash2, KeyRound, Check } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';

const inputCls = 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500';

/**
 * Phase 36: who owns an organization, and adding or removing owners.
 * Used on the owner's Organization page and in Admin → Organizations.
 * An owner manages every venue in the organization. Owners are manager accounts: an existing manager
 * is linked by email; an email with no account gets a new manager account and a temporary password
 * (shown once, here).
 * Props: org (OrganizationDetail), isAdmin, onChanged(orgChangeResult)
 */
export default function OrgOwnersPanel({ org, isAdmin = false, onChanged }) {
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '' });
  const [needName, setNeedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);     // { email, password }
  const [confirm, setConfirm] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    setCreated(null);
    setBusy(true);
    try {
      const res = await api.post(`/organizations/${org.id}/owners`, {
        email: form.email.trim(), first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      });
      if (res.data.created) setCreated({ email: form.email.trim().toLowerCase(), password: res.data.temporary_password });
      setForm({ email: '', first_name: '', last_name: '' });
      setNeedName(false);
      onChanged?.(res.data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Could not add the owner.';
      if (String(detail).startsWith('First name is required')) {
        setNeedName(true);
        setError('No account uses that email yet. Add their name and we’ll create a manager account for them.');
      } else {
        setError(detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const askRemove = (o) => setConfirm({
    title: `Remove ${o.first_name || o.email} as an owner?`,
    message: `They stop managing this organization’s venues, except any venue they manage directly. Their account isn’t deleted.`,
    confirmLabel: 'Remove owner',
    danger: true,
    onConfirm: async () => {
      const res = await api.delete(`/organizations/${org.id}/owners/${o.user_id}`);
      onChanged?.(res.data);
    },
  });

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-white flex items-center gap-2"><Crown className="w-4 h-4 text-amber-300" /> Owners</h3>
      <p className="text-xs text-slate-400">An owner manages every venue in {org.name}: schedules, teams, pay periods and settings.</p>

      {org.owners.length === 0 ? (
        <p className="text-sm text-slate-500">No owners yet. Add one below.</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {org.owners.map((o) => (
            <li key={o.user_id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {`${o.first_name} ${o.last_name}`.trim() || o.email}{o.is_you ? ' (you)' : ''}
                </p>
                <p className="text-xs text-slate-400 truncate">{o.email}{o.phone ? ` · ${o.phone}` : ''}</p>
              </div>
              {(isAdmin || !o.is_you) && (
                <button type="button" onClick={() => askRemove(o)}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {created && (
        <div role="status" className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-100">
          <p className="font-semibold flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Manager account created for {created.email}</p>
          <p className="mt-1 text-xs">Temporary password (shown only once): <code className="px-1.5 py-0.5 rounded bg-slate-950 text-white font-mono select-all">{created.password}</code></p>
        </div>
      )}

      <form onSubmit={add} className="space-y-2">
        <label className="block text-xs text-slate-400">Add an owner by email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="owner@yourcompany.com" className={`${inputCls} mt-1`} />
        </label>
        {needName && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-400">First name
              <input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs text-slate-400">Last name
              <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <button type="submit" disabled={busy || !form.email.trim()}
          className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />} {busy ? 'Adding…' : 'Add owner'}
        </button>
      </form>

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
