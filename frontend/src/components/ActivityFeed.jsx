import React, { useEffect, useState } from 'react';
import { History, CalendarCheck, UserPlus, Users, PencilLine, AlertTriangle, ChevronRight } from 'lucide-react';
import api from '../api/client';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'staffing', label: 'Staffing' },
  { id: 'team', label: 'Team' },
  { id: 'changes', label: 'Changes' },
  { id: 'alerts', label: 'Alerts' },
];
const ICON = {
  bookings: [CalendarCheck, 'text-emerald-400'],
  staffing: [UserPlus, 'text-indigo-300'],
  team: [Users, 'text-sky-300'],
  changes: [PencilLine, 'text-amber-300'],
  alerts: [AlertTriangle, 'text-rose-400'],
};
const PAGE = 20;

function ago(value) {
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Phase 29.1: The venue's activity log (newest first). Everything managers and workers did here:
 * requests, approvals, drops, assigns, offers, team changes, invites, edits, late alerts.
 * Props: venueId, refreshKey, onOpenEvent(eventId), onOpenWorker(workerId)
 */
export default function ActivityFeed({ venueId, refreshKey = 0, onOpenEvent, onOpenWorker }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!venueId) return undefined;
    let active = true;
    setLoading(true);
    api
      .get(`/venues/${venueId}/activity`, { params: { limit: PAGE, ...(filter ? { category: filter } : {}) } })
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
  }, [venueId, filter, refreshKey]);

  const loadMore = async () => {
    if (!items.length) return;
    setLoading(true);
    try {
      const res = await api.get(`/venues/${venueId}/activity`, {
        params: { limit: PAGE, before: items[items.length - 1].created_at, ...(filter ? { category: filter } : {}) },
      });
      setItems((prev) => [...prev, ...(res.data || [])]);
      setMore((res.data || []).length === PAGE);
    } finally {
      setLoading(false);
    }
  };

  const open = (a) => {
    if (a.event_id && onOpenEvent) onOpenEvent(a.event_id);
    else if (a.worker_id && onOpenWorker) onOpenWorker(a.worker_id);
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-white">Activity</h2>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {FILTERS.map((f) => (
          <button key={f.id || 'all'} type="button" onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
              filter === f.id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}>
            {f.label}
          </button>
        ))}
      </div>
      {loading && items.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">Nothing yet. Actions at this venue show up here from now on.</p>
      ) : (
        <ol className="max-h-[32rem] overflow-y-auto divide-y divide-slate-800 -mx-1">
          {items.map((a) => {
            const [Icon, tone] = ICON[a.category] || ICON.changes;
            const clickable = (a.event_id && onOpenEvent) || (a.worker_id && onOpenWorker);
            return (
              <li key={a.id}>
                <button type="button" onClick={() => open(a)} disabled={!clickable}
                  className={`w-full text-left px-1 py-2 flex gap-2 ${clickable ? 'hover:bg-slate-800/50 rounded-lg' : 'cursor-default'}`}>
                  <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${tone}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-slate-200 leading-snug">{a.summary}</span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {ago(a.created_at)}{a.actor_name ? ` · by ${a.actor_name}` : ''}
                    </span>
                  </span>
                  {clickable && <ChevronRight className="w-3.5 h-3.5 text-slate-600 mt-0.5 flex-shrink-0" />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {more && (
        <button type="button" onClick={loadMore} disabled={loading}
          className="mt-2 w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 disabled:opacity-50">
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
