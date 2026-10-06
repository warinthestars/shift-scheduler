import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Plus, Building2, Trash2, Pencil, Check, X, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import OrgOwnersPanel from '../org/OrgOwnersPanel';
import { card, inputCls, selectCls, btnGhost, btnPrimary, btnDanger, SectionTitle } from './adminUi';

/**
 * Phase 36: Admin → Organizations. An organization groups venues under one or more owners;
 * each owner manages every venue in it. There is no venue sign-up yet, so platform admins do this:
 *   create / rename / delete an organization, add or remove its owners, and put venues in or take them out.
 * A venue belongs to at most one organization. Deleting an organization never deletes a venue.
 * Props: refreshKey, venues ([{ id, name }]), onFlash({ type, message }), onChanged()
 */
export default function AdminOrganizations({ refreshKey, venues = [], onFlash, onChanged }) {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(null);       // { id, name }
  const [addVenue, setAddVenue] = useState({});     // org id -> venue id picked
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => api
    .get('/organizations')
    .then((res) => setOrgs(res.data || []))
    .catch(() => setOrgs([])), []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const taken = useMemo(() => new Set((orgs || []).flatMap((o) => o.venues.map((v) => v.id))), [orgs]);
  const freeVenues = venues.filter((v) => !taken.has(v.id));

  const apply = (result, fallback) => {
    if (result?.organization) {
      setOrgs((list) => {
        const rest = (list || []).filter((o) => o.id !== result.organization.id);
        return [...rest, result.organization].sort((a, b) => a.name.localeCompare(b.name));
      });
    }
    const warn = (result?.warnings || []).join(' ');
    onFlash?.({ type: warn ? 'error' : 'success', message: `${result?.message || fallback}${warn ? ` ${warn}` : ''}` });
    onChanged?.();
  };
  const fail = (err, fallback) => onFlash?.({ type: 'error', message: err.response?.data?.detail || fallback });

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await api.post('/organizations', { name: newName.trim(), venue_ids: [] });
      setNewName('');
      setOpenId(res.data.organization.id);
      apply(res.data, 'Organization created.');
    } catch (err) {
      fail(err, 'Could not create the organization.');
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const { id, name } = rename;
    if (!name.trim()) return setRename(null);
    try {
      const res = await api.patch(`/organizations/${id}`, { name: name.trim() });
      apply(res.data, 'Renamed.');
      setRename(null);
    } catch (err) {
      fail(err, 'Could not rename it.');
    }
    return null;
  };

  const putVenue = async (org) => {
    const venueId = addVenue[org.id];
    if (!venueId) return;
    try {
      const res = await api.post(`/organizations/${org.id}/venues`, { venue_id: venueId });
      setAddVenue((m) => ({ ...m, [org.id]: '' }));
      apply(res.data, 'Venue added.');
    } catch (err) {
      fail(err, 'Could not add the venue.');
    }
  };

  const askTakeOut = (org, v) => setConfirm({
    title: `Take ${v.name} out of ${org.name}?`,
    message: 'The venue, its team and its history stay exactly as they are. Its own managers keep managing it; the organization’s owners stop.',
    confirmLabel: 'Take it out',
    onConfirm: async () => {
      const res = await api.delete(`/organizations/${org.id}/venues/${v.id}`);
      apply(res.data, 'Venue taken out.');
    },
  });

  const askDelete = (org) => setConfirm({
    title: `Delete ${org.name}?`,
    message: `Its ${org.venues.length} venue${org.venues.length === 1 ? '' : 's'} and their teams, shifts and history are NOT deleted; they just stop being grouped. Its owners stop managing those venues unless they manage one directly.`,
    confirmLabel: 'Delete organization',
    danger: true,
    onConfirm: async () => {
      await api.delete(`/organizations/${org.id}`);
      setOrgs((list) => (list || []).filter((o) => o.id !== org.id));
      onFlash?.({ type: 'success', message: `Deleted ${org.name}. Its venues are untouched.` });
      onChanged?.();
    },
  });

  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <SectionTitle icon={Network} title="Organizations" tone="text-teal-300" />
        <p className="text-xs text-slate-400 -mt-1 mb-3">
          Group venues under one or more owners. An owner manages every venue in the organization. A venue can be in one organization.
        </p>
        <form onSubmit={create} className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1">
            <span className="sr-only">New organization name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={255} placeholder="New organization name, e.g. Harbor Hospitality Group" className={inputCls} />
          </label>
          <button type="submit" disabled={busy || !newName.trim()} className={btnPrimary}><Plus className="w-4 h-4" /> Create organization</button>
        </form>
      </div>

      {orgs === null && <p className="text-sm text-slate-500 text-center py-8">Loading…</p>}
      {orgs !== null && orgs.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-10 border border-dashed border-slate-800 rounded-2xl">
          No organizations yet. Create one above, then add its owners and venues.
        </p>
      )}

      {(orgs || []).map((org) => {
        const open = openId === org.id;
        return (
          <div key={org.id} className={card}>
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setOpenId(open ? null : org.id)} aria-expanded={open} className="flex-1 min-w-0 text-left">
                <span className="text-base font-bold text-white flex items-center gap-2">
                  <Network className="w-4 h-4 text-teal-300 flex-shrink-0" /> <span className="truncate">{org.name}</span>
                </span>
                <span className="block text-xs text-slate-400 mt-0.5">
                  {org.venues.length} venue{org.venues.length === 1 ? '' : 's'} · {org.owners.length === 0
                    ? <b className="text-amber-300">no owner yet</b>
                    : `owned by ${org.owners.map((o) => `${o.first_name} ${o.last_name}`.trim() || o.email).join(', ')}`}
                </span>
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => navigate(`/org?org=${org.id}`)} className={btnGhost}>Overview <ChevronRight className="w-3 h-3" /></button>
                <button type="button" onClick={() => setOpenId(open ? null : org.id)} className={btnGhost}>{open ? 'Close' : 'Manage'}</button>
              </div>
            </div>

            {open && (
              <div className="border-t border-slate-800 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <OrgOwnersPanel org={org} isAdmin onChanged={(r) => apply(r, 'Saved.')} />

                <div className="space-y-4">
                  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-teal-300" /> Venues</h3>
                    {org.venues.length === 0 ? (
                      <p className="text-sm text-slate-500">No venues yet.</p>
                    ) : (
                      <ul className="divide-y divide-slate-800">
                        {org.venues.map((v) => (
                          <li key={v.id} className="py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{v.name}</p>
                              <p className="text-xs text-slate-400">{v.city || 'No city shown'} · {v.managers} manager{v.managers === 1 ? '' : 's'} of its own</p>
                            </div>
                            <button type="button" onClick={() => askTakeOut(org, v)} className={btnGhost}><X className="w-3 h-3" /> Take out</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <label className="flex-1">
                        <span className="sr-only">Venue to add to {org.name}</span>
                        <select value={addVenue[org.id] || ''} onChange={(e) => setAddVenue((m) => ({ ...m, [org.id]: e.target.value }))} className={`${selectCls} w-full`}>
                          <option value="">{freeVenues.length ? 'Pick a venue to add…' : 'Every venue is already in an organization'}</option>
                          {freeVenues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </label>
                      <button type="button" onClick={() => putVenue(org)} disabled={!addVenue[org.id]} className={btnPrimary}><Plus className="w-4 h-4" /> Add venue</button>
                    </div>
                  </section>

                  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-white">Name</h3>
                    {rename && rename.id === org.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="flex gap-2">
                        <input autoFocus value={rename.name} maxLength={255} aria-label="Organization name" onChange={(e) => setRename({ id: org.id, name: e.target.value })} className={inputCls} />
                        <button type="submit" className={btnPrimary}><Check className="w-4 h-4" /> Save</button>
                        <button type="button" onClick={() => setRename(null)} className={btnGhost}>Cancel</button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setRename({ id: org.id, name: org.name })} className={btnGhost}><Pencil className="w-3 h-3" /> Rename</button>
                        <button type="button" onClick={() => askDelete(org)} className={btnDanger}><Trash2 className="w-3 h-3" /> Delete organization</button>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
