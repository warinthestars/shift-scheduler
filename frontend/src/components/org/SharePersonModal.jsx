import React, { useMemo, useState } from 'react';
import { Users, Check, ArrowRightLeft, Copy } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';

/**
 * Phase 36: put one person on other venues' teams in the organization (copy), or move them
 * from one venue to others (move = also taken off the venue they came from).
 * Props: orgId, person (OrgPerson), venues (OrgVenue[]), onClose, onDone(orgShareResult)
 */
export default function SharePersonModal({ orgId, person, venues, onClose, onDone }) {
  const name = `${person.first_name} ${person.last_name}`.trim() || person.email;
  const activeAt = useMemo(() => person.venues.filter((v) => v.status === 'active'), [person]);
  const statusAt = useMemo(() => Object.fromEntries(person.venues.map((v) => [v.venue_id, v.status])), [person]);
  const [from, setFrom] = useState(activeAt[0]?.venue_id || '');
  const [mode, setMode] = useState('copy');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const targets = venues.filter((v) => statusAt[v.id] !== 'active');

  const submit = async () => {
    setError('');
    if (picked.length === 0) return setError('Pick at least one venue.');
    if (mode === 'move' && !from) return setError('Pick the venue they’re moving from.');
    setBusy(true);
    try {
      const res = await api.post(`/organizations/${orgId}/people/${person.worker_id}/share`, {
        to_venue_ids: picked, from_venue_id: from || null, mode,
      });
      onDone?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'That didn’t save.');
    } finally {
      setBusy(false);
    }
    return null;
  };

  const modeBtn = (id, label, Icon, hint) => (
    <button type="button" onClick={() => setMode(id)} aria-pressed={mode === id}
      className={`flex-1 text-left p-3 rounded-xl border transition ${mode === id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'}`}>
      <span className="text-sm font-bold text-white inline-flex items-center gap-1.5"><Icon className="w-4 h-4" /> {label}</span>
      <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>
    </button>
  );

  return (
    <ModalShell
      title={`Add ${name} to another venue`}
      icon={<Users className="w-5 h-5 text-teal-300" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || targets.length === 0}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-sm font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-50">
            <Check className="w-4 h-4" /> {busy ? 'Saving…' : mode === 'move' ? 'Move' : 'Add to team'}
          </button>
        </>
      )}
    >
      {targets.length === 0 ? (
        <p className="text-sm text-slate-400">{name} is already on the team at every venue in this organization.</p>
      ) : (
        <div className="space-y-4">
          {activeAt.length > 0 && (
            <div className="flex gap-2">
              {modeBtn('copy', 'Copy', Copy, 'On both teams.')}
              {modeBtn('move', 'Move', ArrowRightLeft, 'Taken off the team they come from. Shifts already booked there stay.')}
            </div>
          )}

          {activeAt.length > 0 && (
            <label className="block text-xs text-slate-400">
              {mode === 'move' ? 'Moving from' : 'Bring their positions and staffing company from'}
              <select value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white">
                {mode === 'copy' && <option value="">Nowhere (start blank)</option>}
                {activeAt.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.venue_name}</option>)}
              </select>
            </label>
          )}

          <fieldset>
            <legend className="text-xs text-slate-400 mb-1">Add to</legend>
            <ul className="space-y-1.5">
              {targets.map((v) => {
                const blocked = statusAt[v.id] === 'blocked';
                const same = v.id === from;
                return (
                  <li key={v.id}>
                    <label className={`flex items-center gap-2 p-2.5 rounded-xl border ${blocked || same ? 'border-slate-800 opacity-60' : 'border-slate-700 cursor-pointer hover:border-slate-600'} bg-slate-950/40`}>
                      <input type="checkbox" disabled={blocked || same} checked={picked.includes(v.id)} onChange={() => toggle(v.id)} className="accent-teal-500" />
                      <span className="text-sm text-white flex-1 min-w-0 truncate">{v.name}</span>
                      {blocked && <span className="text-[11px] text-rose-300">Blocked there. Unblock on its Team page first.</span>}
                      {!blocked && statusAt[v.id] === 'removed' && <span className="text-[11px] text-slate-400">Was removed; this puts them back</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <p className="text-[11px] text-slate-500">Positions come along where the other venue has a position with the same name.</p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        </div>
      )}
    </ModalShell>
  );
}
