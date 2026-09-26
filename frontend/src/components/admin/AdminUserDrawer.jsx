import React, { useEffect, useMemo, useState } from 'react';
import {
  Save, KeyRound, Power, Trash2, ShieldCheck, Building2, CalendarClock, Bell, Mail, Phone, Lock, StickyNote,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import ResetPasswordModal from '../ResetPasswordModal';
import ReliabilityBadge from '../ReliabilityBadge';
import { Avatar } from '../WorkerProfilePanel';
import {
  inputCls, selectCls, btnGhost, btnPrimary, btnDanger, RoleBadge, AuthBadge, ROLE_LABEL, ago, personName, Drawer,
  TypeToConfirm,
} from './adminUi';

const HISTORY_LABEL = {
  pending: ['Waiting', 'text-amber-300'],
  pending_manager_approval: ['Waiting', 'text-amber-300'],
  approved: ['Booked', 'text-emerald-300'],
  confirmed: ['Booked', 'text-emerald-300'],
  checked_in: ['Clocked in', 'text-sky-300'],
  completed: ['Worked', 'text-slate-200'],
  dropped: ['Dropped', 'text-rose-300'],
  no_show: ['No-show', 'text-rose-300'],
  removed: ['Removed', 'text-rose-300'],
  rejected: ['Not selected', 'text-slate-500'],
  withdrawn: ['Withdrew', 'text-slate-500'],
  cancelled: ['Cancelled', 'text-slate-500'],
  transferred: ['Handed off', 'text-slate-400'],
};
const MEMBER_LABEL = {
  active: ['On team', 'text-emerald-300'],
  worked: ['Worked here', 'text-slate-300'],
  removed: ['Removed', 'text-slate-500'],
  blocked: ['Blocked', 'text-rose-300'],
};
const DISCOVER_LABEL = {
  private: 'Private (only venues they work with)',
  venues: 'Findable by venue managers',
  everyone: 'Findable by everyone',
};

function Label({ children }) {
  return <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">{children}</div>;
}

function initialVenueIds(u) {
  if (!u) return [];
  if (u.role === 'venue_manager') return u.managed_venues.map((v) => String(v.id));
  if (u.role === 'worker') return u.memberships.filter((m) => m.status === 'active').map((m) => String(m.venue_id));
  return [];
}

/**
 * Phase 29.2: One person, everything an admin can see and change.
 * GET /admin/users/{id}/detail · PATCH /admin/users/{id} · reset password · deactivate · delete.
 * Props: userId, venues ([{id, name}]), onClose, onChanged(message), onDeleted(message)
 */
export default function AdminUserDrawer({ userId, venues = [], onClose, onChanged, onDeleted }) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [modal, setModal] = useState(null); // 'reset' | 'delete'

  useEffect(() => {
    let active = true;
    setError('');
    api
      .get(`/admin/users/${userId}/detail`)
      .then((res) => {
        if (!active) return;
        setData(res.data);
        const u = res.data.user;
        setForm({
          first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '', role: u.role,
          venue_ids: initialVenueIds(u),
        });
      })
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load this person.'));
    return () => {
      active = false;
    };
  }, [userId, reload]);

  const u = data?.user;
  const isMe = u && String(u.id) === String(me?.id);

  const payload = useMemo(() => {
    if (!u || !form) return {};
    const p = {};
    if (form.first_name.trim() !== u.first_name) p.first_name = form.first_name.trim();
    if (form.last_name.trim() !== u.last_name) p.last_name = form.last_name.trim();
    if (form.email.trim().toLowerCase() !== (u.email || '').toLowerCase()) p.email = form.email.trim();
    if ((form.phone || '').trim() !== (u.phone || '')) p.phone = form.phone.trim();
    if (form.role !== u.role) p.role = form.role;
    const before = [...initialVenueIds(u)].sort().join(',');
    const after = [...form.venue_ids].sort().join(',');
    if (p.role || before !== after) p.venue_ids = form.role === 'platform_admin' ? [] : form.venue_ids;
    return p;
  }, [u, form]);
  const dirty = Object.keys(payload).length > 0;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleVenue = (id) =>
    setForm((f) => ({ ...f, venue_ids: f.venue_ids.includes(id) ? f.venue_ids.filter((x) => x !== id) : [...f.venue_ids, id] }));

  const save = async () => {
    setFormError('');
    if (!form.first_name.trim() || !form.email.trim()) return setFormError('First name and email are required.');
    if (form.role === 'venue_manager' && form.venue_ids.length === 0) return setFormError('Pick at least one venue for a venue manager.');
    setSaving(true);
    try {
      await api.patch(`/admin/users/${userId}`, payload);
      setReload((n) => n + 1);
      onChanged(`Saved ${form.first_name.trim()} ${form.last_name.trim()}.${payload.role ? ' They see the new role next time they sign in or refresh.' : ''}`);
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    setFormError('');
    try {
      await api.patch(`/admin/users/${userId}`, { is_active: !u.is_active });
      setReload((n) => n + 1);
      onChanged(`${personName(u)} is now ${u.is_active ? 'deactivated and can no longer sign in' : 'active again'}.`);
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Could not change the status.');
    }
  };

  const doDelete = async () => {
    await api.delete(`/admin/users/${userId}`);
    onDeleted(`Deleted ${u.email}.`);
  };

  const venueLabel = form?.role === 'venue_manager' ? 'Manages' : form?.role === 'worker' ? "On these venues' teams" : null;

  return (
    <Drawer
      title={u ? personName(u) : 'Person'}
      subtitle={u && (
        <span className="flex flex-wrap items-center gap-1.5 mt-1">
          <RoleBadge role={u.role} />
          <AuthBadge source={u.auth_source} />
          {!u.is_active && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">Deactivated</span>}
          {u.always_admin && <span title="Listed in ALWAYS_ADMIN_EMAILS" className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold inline-flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" /> Always admin</span>}
          {isMe && <span className="text-[10px] text-slate-500">(you)</span>}
        </span>
      )}
      onClose={onClose}
      footer={u && (
        <button type="button" onClick={save} disabled={!dirty || saving} className={btnPrimary}>
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
        </button>
      )}
    >
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!u && !error && <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>}
      {u && form && (
        <>
          <div className="flex items-center gap-3">
            <Avatar person={u} size="w-12 h-12 text-base" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Worked</div>
                <div className="text-sm text-white font-semibold">{u.shifts_worked}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Upcoming</div>
                <div className="text-sm text-white font-semibold">{u.upcoming}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Rating</div>
                <div className="text-sm text-white font-semibold">{u.rating_count ? `${Number(u.aggregate_rating).toFixed(1)} (${u.rating_count})` : '—'}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Reliability</div>
                <div className="text-sm text-white font-semibold"><ReliabilityBadge data={data.reliability} /></div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Details</Label>
            {formError && <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{formError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-slate-400">First name
                <input value={form.first_name} onChange={set('first_name')} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-slate-400">Last name
                <input value={form.last_name} onChange={set('last_name')} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-slate-400">Email
                <input type="email" value={form.email} onChange={set('email')} disabled={u.always_admin}
                  className={`${inputCls} mt-1 disabled:opacity-50`} />
                {u.auth_source !== 'local' && payload.email && (
                  <span className="block text-[11px] text-amber-300 mt-1">They sign in with Firebase; this only changes where ShiftBoard emails go.</span>
                )}
              </label>
              <label className="text-xs text-slate-400">Phone
                <input value={form.phone} onChange={set('phone')} className={`${inputCls} mt-1`} placeholder="For texts" />
              </label>
              <label className="text-xs text-slate-400">Role
                <select value={form.role} onChange={set('role')} disabled={isMe || u.always_admin} className={`${selectCls} w-full mt-1 disabled:opacity-50`}>
                  {Object.entries(ROLE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                {(isMe || u.always_admin) && <span className="block text-[11px] text-slate-500 mt-1">{isMe ? "You can't change your own role." : 'Always-admin accounts stay admins.'}</span>}
              </label>
            </div>
            {venueLabel && (
              <div>
                <div className="text-xs text-slate-400 mb-1">{venueLabel}</div>
                {venues.length === 0 ? <p className="text-xs text-slate-500">No venues yet.</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {venues.map((v) => {
                      const on = form.venue_ids.includes(String(v.id));
                      return (
                        <button key={v.id} type="button" onClick={() => toggleVenue(String(v.id))}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${on ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                          {v.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {form.role === 'worker' && (
                  <p className="text-[11px] text-slate-500 mt-1">Unticking removes them from that team. Team notes, positions and blocks set by managers are kept.</p>
                )}
                {payload.role && u.role !== form.role && (
                  <p className="text-[11px] text-amber-300 mt-1">Changing the role replaces their venue links with the ones picked here.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label><Building2 className="w-3 h-3" /> Venues</Label>
            {u.managed_venues.length === 0 && u.memberships.length === 0 ? (
              <p className="text-xs text-slate-500">Not connected to any venue.</p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {u.managed_venues.map((v) => (
                  <div key={`m-${v.id}`} className="px-3 py-2 bg-slate-950 flex items-center justify-between text-xs">
                    <span className="text-slate-100 font-semibold">{v.name}</span>
                    <span className="text-amber-300 font-semibold">Manager</span>
                  </div>
                ))}
                {u.memberships.map((m) => {
                  const [label, cls] = MEMBER_LABEL[m.status] || [m.status, 'text-slate-300'];
                  return (
                    <div key={`w-${m.venue_id}`} className="px-3 py-2 bg-slate-950 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-100 font-semibold">{m.venue_name}</span>
                        <span className={`font-semibold ${cls}`}>{label}</span>
                      </div>
                      {m.positions.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {m.positions.map((p) => <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold uppercase">{p}</span>)}
                        </div>
                      )}
                      {m.notes && (
                        <div className="text-[11px] text-amber-100 flex gap-1"><StickyNote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" /> {m.notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Label><CalendarClock className="w-3 h-3" /> Recent shifts</Label>
            {data.history.length === 0 ? (
              <p className="text-xs text-slate-500">No shift requests yet.</p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {data.history.map((h) => {
                  const [label, cls] = HISTORY_LABEL[h.status] || [h.status, 'text-slate-300'];
                  return (
                    <div key={h.request_id} className="px-3 py-2 bg-slate-950 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-slate-400 w-20 flex-shrink-0">{new Date(h.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      <span className="flex-1 min-w-[10rem] text-slate-100">
                        <span className="font-semibold">{h.role_type}</span> · {h.title}
                        <span className="text-slate-500"> · {h.venue_name}</span>
                      </span>
                      <span className={`font-semibold ${cls}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Label><Bell className="w-3 h-3" /> Their settings</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-400" /> Emails {data.email_enabled ? <b className="text-emerald-300">on</b> : <b className="text-slate-500">off</b>}
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> Texts {data.sms_enabled ? <b className="text-emerald-300">on</b> : <b className="text-slate-500">off</b>}
                {data.sms_enabled && !u.phone && <span className="text-amber-300">(no phone)</span>}
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                {DISCOVER_LABEL[u.discoverable] || u.discoverable}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Joined {new Date(u.created_at).toLocaleDateString()} · last request {u.last_activity_at ? ago(u.last_activity_at) : 'never'}
            </p>
          </div>

          <div>
            <Label><ShieldCheck className="w-3 h-3" /> Admin changes</Label>
            {data.audit.length === 0 ? <p className="text-xs text-slate-500">None recorded.</p> : (
              <ul className="space-y-1 text-xs">
                {data.audit.map((a) => (
                  <li key={a.id} className="text-slate-300">
                    {a.summary} <span className="text-slate-500">· {ago(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!isMe && (
            <div className="p-3 rounded-xl border border-slate-700 bg-slate-950 space-y-2">
              <div className="text-sm font-bold text-white">Account</div>
              <div className="flex flex-wrap gap-2">
                {u.has_password ? (
                  <button type="button" onClick={() => setModal('reset')} className={btnGhost}><KeyRound className="w-3 h-3" /> Reset password</button>
                ) : (
                  <span className="text-[11px] text-slate-500 self-center">Signs in with Firebase only, so there is no ShiftBoard password to reset.</span>
                )}
                {!u.always_admin && (
                  <button type="button" onClick={toggleActive} className={u.is_active ? btnDanger : btnGhost}>
                    <Power className="w-3 h-3" /> {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
                {!u.always_admin && (
                  <button type="button" onClick={() => setModal('delete')} className={btnDanger}><Trash2 className="w-3 h-3" /> Delete…</button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Deactivating blocks sign-in and keeps their history. Delete is only allowed for people with no clock-ins.
              </p>
            </div>
          )}
        </>
      )}

      {modal === 'reset' && u && (
        <ResetPasswordModal
          user={u}
          onClose={() => setModal(null)}
          onDone={() => {
            setReload((n) => n + 1);
            onChanged(`Password reset for ${u.email}.`);
          }}
        />
      )}
      {modal === 'delete' && u && (
        <TypeToConfirm
          title={`Delete ${personName(u)}?`}
          word={u.email}
          confirmLabel="Delete account"
          message={<p>This removes the account, their requests and team memberships. It can't be undone. If they've ever clocked in, deactivate them instead.</p>}
          onConfirm={doDelete}
          onClose={() => setModal(null)}
        />
      )}
    </Drawer>
  );
}
