import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, ShieldCheck, CalendarCheck, UserPlus, Users, PencilLine, AlertTriangle, ChevronRight, Building2, Server,
  UserRound,
} from 'lucide-react';
import api from '../../api/client';
import { card, selectCls, btnGhost, ago, fmtDateTime } from './adminUi';

const CATS = [
  { id: '', label: 'All' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'staffing', label: 'Staffing' },
  { id: 'team', label: 'Team' },
  { id: 'changes', label: 'Changes' },
  { id: 'alerts', label: 'Alerts' },
];
const CAT_ICON = {
  bookings: [CalendarCheck, 'text-emerald-400'],
  staffing: [UserPlus, 'text-indigo-300'],
  team: [Users, 'text-sky-300'],
  changes: [PencilLine, 'text-amber-300'],
  alerts: [AlertTriangle, 'text-rose-400'],
};
const TARGETS = [
  { id: '', label: 'All' },
  { id: 'user', label: 'People' },
  { id: 'venue', label: 'Venues' },
  { id: 'system', label: 'System' },
];
const TARGET_ICON = { user: UserRound, venue: Building2, system: Server };
const PAGE = 40;

function Chips({ items, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((f) => (
        <button key={f.id || 'all'} type="button" onClick={() => onChange(f.id)}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
            value === f.id ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** Loads a newest-first list with "Load more" (before=<last created_at>). */
function usePaged(url, params, refreshKey) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const key = JSON.stringify(params);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(url, { params: { ...params, limit: PAGE } })
      .then((res) => {
        if (!active) return;
        setItems(res.data || []);
        setMore((res.data || []).length === PAGE);
      })
      .catch(() => active && setItems([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [url, key, refreshKey]);

  const loadMore = async () => {
    if (!items.length) return;
    setLoading(true);
    try {
      const res = await api.get(url, { params: { ...params, limit: PAGE, before: items[items.length - 1].created_at } });
      setItems((prev) => [...prev, ...(res.data || [])]);
      setMore((res.data || []).length === PAGE);
    } finally {
      setLoading(false);
    }
  };
  return { items, loading, more, loadMore };
}

/**
 * Phase 29.2: Activity tab. Venue activity across every venue (GET /admin/activity) or the admin change log (GET /admin/audit).
 * Props: refreshKey, venues ([{id, name}]), initialLog ('venues' | 'admin'), onOpenUser(id), onOpenVenue(id)
 */
export default function AdminActivity({ refreshKey = 0, venues = [], initialLog = 'venues', onOpenUser, onOpenVenue }) {
  const navigate = useNavigate();
  const [log, setLog] = useState(initialLog);
  const [venueId, setVenueId] = useState('');
  const [cat, setCat] = useState('');
  const [target, setTarget] = useState('');

  useEffect(() => setLog(initialLog), [initialLog]);

  const act = usePaged('/admin/activity', { venue_id: venueId || undefined, category: cat || undefined }, `${refreshKey}-${log}`);
  const aud = usePaged('/admin/audit', { target_type: target || undefined }, `${refreshKey}-${log}`);
  const list = log === 'venues' ? act : aud;
  const venueIds = new Set(venues.map((v) => String(v.id)));

  const openActivity = (a) => {
    if (a.event_id) {
      try {
        localStorage.setItem('shiftboard_admin_venue_id', a.venue_id);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: a.venue_id }));
      navigate(`/venue?venue=${a.venue_id}&event=${a.event_id}`);
    } else if (a.worker_id) {
      onOpenUser(a.worker_id);
    } else {
      onOpenVenue(a.venue_id);
    }
  };

  const openAudit = (a) => {
    if (a.target_type === 'user' && a.target_id && !a.action.endsWith('_deleted')) onOpenUser(a.target_id);
    else if (a.target_type === 'venue' && a.target_id && venueIds.has(String(a.target_id))) onOpenVenue(a.target_id);
  };

  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1">
          <button type="button" onClick={() => setLog('venues')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${log === 'venues' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <History className="w-3.5 h-3.5" /> Venue activity
          </button>
          <button type="button" onClick={() => setLog('admin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${log === 'admin' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <ShieldCheck className="w-3.5 h-3.5" /> Admin changes
          </button>
        </div>
        {log === 'venues' ? (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={selectCls} aria-label="Venue">
              <option value="">All venues</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <Chips items={CATS} value={cat} onChange={setCat} />
          </div>
        ) : (
          <div className="sm:ml-auto"><Chips items={TARGETS} value={target} onChange={setTarget} /></div>
        )}
      </div>

      {list.loading && list.items.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>
      ) : list.items.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">
          {log === 'venues' ? 'Nothing here yet.' : 'No admin changes recorded yet. Changes made from this console show up here.'}
        </p>
      ) : (
        <ol className="divide-y divide-slate-800">
          {log === 'venues'
            ? list.items.map((a) => {
              const [Icon, tone] = CAT_ICON[a.category] || CAT_ICON.changes;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => openActivity(a)} className="w-full text-left py-2.5 px-1 flex gap-3 hover:bg-slate-800/40 rounded-lg">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-200">{a.summary}</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        <span className="text-emerald-300/80 font-semibold">{a.venue_name}</span>
                        {a.actor_name ? ` · by ${a.actor_name}` : ''} · <span title={fmtDateTime(a.created_at)}>{ago(a.created_at)}</span>
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                  </button>
                </li>
              );
            })
            : list.items.map((a) => {
              const Icon = TARGET_ICON[a.target_type] || Server;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => openAudit(a)} className="w-full text-left py-2.5 px-1 flex gap-3 hover:bg-slate-800/40 rounded-lg">
                    <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-indigo-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-200">{a.summary}</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        {a.actor_name || 'Unknown admin'} · {fmtDateTime(a.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
        </ol>
      )}
      {list.more && (
        <button type="button" onClick={list.loadMore} disabled={list.loading} className={`${btnGhost} w-full justify-center mt-3 py-2`}>
          {list.loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
