import React, { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, ChevronLeft, ChevronRight, Star, Copy as CopyIcon } from 'lucide-react';
import api from '../../api/client';
import { Avatar } from '../WorkerProfilePanel';
import { card, inputCls, selectCls, btnGhost, btnPrimary, RoleBadge, AuthBadge, ago, personName } from './adminUi';

const PAGE = 25;
const MEMBER_CLS = {
  active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  worked: 'bg-slate-800 text-slate-300 border-slate-700',
  removed: 'bg-slate-800 text-slate-500 border-slate-700 line-through',
  blocked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};
const MEMBER_TITLE = {
  active: 'On the team',
  worked: 'Worked here (not on the team)',
  removed: 'Removed from the team',
  blocked: 'Blocked by the venue',
};

/** Venue chips for one person: what they manage, then the teams they're on / have worked for. */
export function VenueChips({ row, max = 3 }) {
  const chips = [
    ...row.managed_venues.map((v) => ({ key: `m-${v.id}`, label: v.name, cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', title: 'Manages' })),
    ...row.memberships.map((m) => ({ key: `w-${m.venue_id}`, label: m.venue_name, cls: MEMBER_CLS[m.status] || MEMBER_CLS.worked, title: MEMBER_TITLE[m.status] || m.status })),
  ];
  if (chips.length === 0) return <span className="text-[11px] text-slate-600">No venues yet</span>;
  return (
    <div className="flex flex-wrap gap-1 max-w-[16rem]">
      {chips.slice(0, max).map((c) => (
        <span key={c.key} title={c.title} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold truncate max-w-[9rem] ${c.cls}`}>{c.label}</span>
      ))}
      {chips.length > max && <span className="text-[10px] text-slate-500 self-center">+{chips.length - max}</span>}
    </div>
  );
}

/**
 * Phase 29.2: Users tab. Server-side search, filters and paging: GET /admin/directory.
 * Props: refreshKey, venues ([{id, name}]), onOpenUser(id), onCreate()
 */
export default function AdminUsers({ refreshKey = 0, venues = [], onOpenUser, onCreate }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [auth, setAuth] = useState('all');
  const [venueId, setVenueId] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(0);
  }, [debounced, role, status, auth, venueId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get('/admin/directory', {
        params: {
          q: debounced || undefined, role, status, auth, venue_id: venueId || undefined, limit: PAGE, offset: page * PAGE,
        },
      })
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load people.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [debounced, role, status, auth, venueId, page, refreshKey]);

  // Same full name as another account on this page (often a Firebase sign-up next to an admin-made account).
  const dupes = useMemo(() => {
    const seen = {};
    data.items.forEach((u) => {
      const k = personName(u).toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
    });
    return seen;
  }, [data.items]);

  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const filtered = debounced || role !== 'all' || status !== 'all' || auth !== 'all' || venueId;

  return (
    <section className={card}>
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone"
              className={`${inputCls} pl-9`} />
          </div>
          <span className="text-xs text-slate-500 sm:ml-auto">{loading ? 'Loading…' : `${data.total} ${data.total === 1 ? 'person' : 'people'}`}</span>
          <button type="button" onClick={onCreate} className={btnPrimary}>
            <UserPlus className="w-4 h-4" /> New user
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={selectCls} aria-label="Role">
            <option value="all">All roles</option>
            <option value="worker">Workers</option>
            <option value="venue_manager">Venue managers</option>
            <option value="platform_admin">Platform admins</option>
          </select>
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={selectCls} aria-label="Venue">
            <option value="">All venues</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
            <option value="all">Active and deactivated</option>
            <option value="active">Active only</option>
            <option value="inactive">Deactivated only</option>
          </select>
          <select value={auth} onChange={(e) => setAuth(e.target.value)} className={selectCls} aria-label="Sign-in">
            <option value="all">Any sign-in</option>
            <option value="local">Password only</option>
            <option value="firebase">Firebase only</option>
            <option value="both">Password + Firebase</option>
          </select>
          {filtered && (
            <button type="button" className={btnGhost}
              onClick={() => { setQ(''); setRole('all'); setStatus('all'); setAuth('all'); setVenueId(''); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose-300 p-6">{error}</p>
      ) : data.items.length === 0 && !loading ? (
        <p className="text-sm text-slate-500 py-12 text-center">{filtered ? 'Nobody matches these filters.' : 'No accounts yet.'}</p>
      ) : (
        <>
        <ul className={`md:hidden divide-y divide-slate-800/60 ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onOpenUser(u.id)} className="w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-800/30">
                <Avatar person={u} size="w-9 h-9 text-xs" />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-sm font-bold ${u.is_active ? 'text-white' : 'text-slate-500 line-through'}`}>{personName(u)}</span>
                    <RoleBadge role={u.role} />
                    {!u.is_active && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">Deactivated</span>}
                    {dupes[personName(u).toLowerCase()] > 1 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">Same name</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">{u.email}</span>
                  <VenueChips row={u} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Person</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Venues</th>
                <th className="py-2.5 px-3 text-center" title="Finished shifts · upcoming bookings">Shifts</th>
                <th className="py-2.5 px-3">Rating</th>
                <th className="py-2.5 px-3">Sign-in</th>
                <th className="py-2.5 px-3">Last request</th>
                <th className="py-2.5 px-3">Joined</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-slate-800/60 ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((u) => (
                <tr key={u.id} onClick={() => onOpenUser(u.id)} className="hover:bg-slate-800/30 cursor-pointer">
                  <td className="py-2.5 px-4 min-w-[15rem]">
                    <div className="flex items-center gap-2.5">
                      <Avatar person={u} size="w-8 h-8 text-xs" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-bold ${u.is_active ? 'text-white' : 'text-slate-500 line-through'}`}>{personName(u)}</span>
                          {!u.is_active && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">Deactivated</span>}
                          {dupes[personName(u).toLowerCase()] > 1 && (
                            <span title="Another account on this page has the same name" className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold inline-flex items-center gap-0.5">
                              <CopyIcon className="w-2.5 h-2.5" /> Same name
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[16rem]">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3"><RoleBadge role={u.role} /></td>
                  <td className="py-2.5 px-3"><VenueChips row={u} /></td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={u.shifts_worked ? 'text-slate-100 font-bold' : 'text-slate-600'}>{u.shifts_worked}</span>
                    {u.upcoming > 0 && <span className="text-emerald-300"> · {u.upcoming}</span>}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {u.rating_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-slate-200">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {Number(u.aggregate_rating).toFixed(1)}
                        <span className="text-slate-500">({u.rating_count})</span>
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-2.5 px-3"><AuthBadge source={u.auth_source} /></td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">{u.last_activity_at ? ago(u.last_activity_at) : '—'}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {data.total > PAGE && (
        <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            {page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={btnGhost}>
              <ChevronLeft className="w-3 h-3" /> Previous
            </button>
            <span>Page {page + 1} of {pages}</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className={btnGhost}>
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
