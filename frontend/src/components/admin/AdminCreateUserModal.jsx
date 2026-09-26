import React, { useState } from 'react';
import { UserPlus, KeyRound, CheckCircle2 } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { inputCls, selectCls, btnGhost, ROLE_LABEL, CopyButton } from './adminUi';

/**
 * Phase 29.2: Create an account. By default the server generates a temporary password and returns it once.
 * POST /admin/users {email, first_name, last_name, phone, role, venue_ids, password?}
 * Props: venues ([{id, name}]), onClose, onCreated(user) (called when the admin closes the result screen or opens the profile),
 *        onOpenUser(id)
 */
export default function AdminCreateUserModal({ venues = [], onClose, onCreated, onOpenUser }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', role: 'worker' });
  const [venueIds, setVenueIds] = useState([]);
  const [pwMode, setPwMode] = useState('generate'); // generate | custom
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (id) => setVenueIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!form.first_name.trim() || !form.email.trim()) return setError('First name and email are required.');
    if (form.role === 'venue_manager' && venueIds.length === 0) return setError('Pick at least one venue for a venue manager.');
    if (pwMode === 'custom' && password.length < 8) return setError('Password must be at least 8 characters.');
    setSaving(true);
    try {
      const res = await api.post('/admin/users', {
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role,
        venue_ids: form.role === 'platform_admin' ? [] : venueIds,
        password: pwMode === 'custom' ? password : undefined,
      });
      setCreated(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create the account.');
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    onCreated(created);
    onClose();
  };

  if (created) {
    const loginUrl = `${window.location.origin}/login`;
    const share = created.temporary_password
      ? `Your ShiftBoard account is ready.\nSign in at ${loginUrl}\nEmail: ${created.email}\nTemporary password: ${created.temporary_password}\nPlease change it after you sign in.`
      : null;
    return (
      <ModalShell
        title="Account created"
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
        onClose={finish}
        maxWidth="max-w-md"
        footer={(
          <>
            <button type="button" onClick={() => { finish(); onOpenUser(created.id); }} className={btnGhost}>Open profile</button>
            <button type="button" onClick={finish} className="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950">Done</button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            <b className="text-white">{created.first_name} {created.last_name}</b> ({created.email}) is set up as a {ROLE_LABEL[(created.role || '').toLowerCase()] || created.role}.
          </p>
          {created.temporary_password ? (
            <>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Temporary password (shown once)</div>
                <div className="font-mono text-lg text-emerald-300 mt-1 break-all">{created.temporary_password}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={created.temporary_password} label="Copy password" />
                <CopyButton text={share} label="Copy sign-in message" />
              </div>
              <p className="text-xs text-slate-500">Send it to them yourself. ShiftBoard doesn't email passwords.</p>
            </>
          ) : (
            <p className="text-xs text-slate-500">They sign in with the password you set.</p>
          )}
        </div>
      </ModalShell>
    );
  }

  const venueLabel = form.role === 'venue_manager' ? 'Manages (at least one)' : form.role === 'worker' ? "Add to these venues' teams (optional)" : null;

  return (
    <ModalShell
      title="New user"
      icon={<UserPlus className="w-5 h-5 text-indigo-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">First name
            <input autoFocus value={form.first_name} onChange={set('first_name')} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-slate-400">Last name
            <input value={form.last_name} onChange={set('last_name')} className={`${inputCls} mt-1`} />
          </label>
        </div>
        <label className="block text-xs text-slate-400">Email
          <input type="email" value={form.email} onChange={set('email')} className={`${inputCls} mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">Phone (optional)
            <input value={form.phone} onChange={set('phone')} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-slate-400">Role
            <select value={form.role} onChange={set('role')} className={`${selectCls} w-full mt-1`}>
              {Object.entries(ROLE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
        {venueLabel && (
          <div>
            <div className="text-xs text-slate-400 mb-1">{venueLabel}</div>
            {venues.length === 0 ? <p className="text-xs text-slate-500">No venues yet.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {venues.map((v) => {
                  const on = venueIds.includes(v.id);
                  return (
                    <button key={v.id} type="button" onClick={() => toggle(v.id)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${on ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                      {v.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div>
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><KeyRound className="w-3 h-3" /> Password</div>
          <div className="flex gap-2">
            {[['generate', 'Generate a temporary one'], ['custom', 'Set one now']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPwMode(id)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${pwMode === id ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {label}
              </button>
            ))}
          </div>
          {pwMode === 'custom' && (
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
              className={`${inputCls} mt-2`} autoComplete="new-password" />
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          Tip: to let someone sign up themselves and join a team, use the venue's Team → Invite instead.
        </p>
      </form>
    </ModalShell>
  );
}
