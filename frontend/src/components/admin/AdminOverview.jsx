import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, AlertOctagon, Info, ChevronRight, History, ShieldCheck, RefreshCw, CheckCircle2,
} from 'lucide-react';
import api from '../../api/client';
import { card, StatTile, SectionTitle, ago, btnGhost } from './adminUi';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const LEVEL = {
  error: [AlertOctagon, 'text-rose-400', 'border-rose-500/30 bg-rose-500/5'],
  warn: [AlertTriangle, 'text-amber-400', 'border-amber-500/30 bg-amber-500/5'],
  info: [Info, 'text-sky-400', 'border-sky-500/30 bg-sky-500/5'],
};

/**
 * Phase 29.2: Admin home. GET /admin/overview.
 * Props: refreshKey, onTab(tab), onOpenVenue(venueId), onOpenUser(userId)
 */
export default function AdminOverview({ refreshKey = 0, onTab, onOpenVenue }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/overview');
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>;

  const openAttention = (a) => {
    if (a.kind === 'venue' && a.target_id) onOpenVenue(a.target_id);
    else if (a.kind === 'deliveries' || a.kind === 'system') onTab('system');
    else if (a.kind === 'users') onTab('users');
  };

  return (
    <div className="space-y-6">
      <section className={`${card} p-4`}>
        <SectionTitle
          icon={AlertTriangle}
          tone="text-amber-400"
          title="Needs attention"
          right={(
            <button type="button" onClick={load} disabled={loading} className={btnGhost}>
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          )}
        />
        {data.attention.length === 0 ? (
          <p className="text-sm text-emerald-300 flex items-center gap-2 py-2">
            <CheckCircle2 className="w-4 h-4" /> Nothing needs you right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.attention.map((a, i) => {
              const [Icon, tone, box] = LEVEL[a.level] || LEVEL.info;
              return (
                <li key={i}>
                  <button type="button" onClick={() => openAttention(a)}
                    className={`w-full text-left px-3 py-2 rounded-xl border flex items-center gap-2 hover:brightness-125 ${box}`}>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${tone}`} />
                    <span className="text-sm text-slate-200 flex-1">{a.text}</span>
                    <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile
          label="People"
          value={data.users_total}
          sub={`${plural(data.workers, 'worker')} · ${plural(data.managers, 'manager')} · ${plural(data.admins, 'admin')}`}
          onClick={() => onTab('users')}
        />
        <StatTile
          label="Venues"
          value={data.venues}
          sub={`${data.events_next_7d} event${data.events_next_7d === 1 ? '' : 's'} in the next 7 days`}
          tone="text-emerald-400"
          onClick={() => onTab('venues')}
        />
        <StatTile
          label="Staffed, next 7 days"
          value={data.fill_rate_next_7d == null ? '—' : `${Math.round(data.fill_rate_next_7d)}%`}
          sub={data.spots_next_7d ? `${data.open_spots_next_7d} of ${data.spots_next_7d} spots still open` : 'No shifts posted'}
          tone={data.fill_rate_next_7d == null ? 'text-slate-400' : data.fill_rate_next_7d >= 90 ? 'text-emerald-400' : data.fill_rate_next_7d >= 60 ? 'text-amber-400' : 'text-rose-400'}
        />
        <StatTile
          label="Waiting on managers"
          value={data.pending_requests + data.pending_handoffs}
          sub={`${data.pending_requests} request${data.pending_requests === 1 ? '' : 's'} · ${data.pending_handoffs} hand-off${data.pending_handoffs === 1 ? '' : 's'}${data.stale_requests_24h ? ` · ${data.stale_requests_24h} over 24 h` : ''}`}
          tone={data.stale_requests_24h ? 'text-amber-400' : 'text-white'}
        />
        <StatTile
          label="Emails & texts, 24 h"
          value={data.deliveries_sent_24h}
          sub={data.deliveries_failed_24h ? `${data.deliveries_failed_24h} failed` : 'None failed'}
          tone={data.deliveries_failed_24h ? 'text-rose-400' : 'text-white'}
          onClick={() => onTab('system')}
        />
      </div>
      {(data.deactivated > 0 || data.new_users_7d > 0) && (
        <p className="text-xs text-slate-500 -mt-3">
          {data.new_users_7d} new account{data.new_users_7d === 1 ? '' : 's'} this week
          {data.deactivated > 0 && ` · ${data.deactivated} deactivated`}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className={`${card} p-4 lg:col-span-2`}>
          <SectionTitle
            icon={History}
            tone="text-amber-400"
            title="Latest at venues"
            right={<button type="button" onClick={() => onTab('activity')} className="text-xs text-indigo-300 hover:text-indigo-200">See all</button>}
          />
          {data.recent_activity.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No venue activity yet.</p>
          ) : (
            <ol className="divide-y divide-slate-800">
              {data.recent_activity.map((a) => (
                <li key={a.id} className="py-2 text-xs">
                  <div className="text-slate-200">{a.summary}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    <span className="text-emerald-300/80 font-semibold">{a.venue_name}</span>
                    {a.actor_name ? ` · by ${a.actor_name}` : ''} · {ago(a.created_at)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={`${card} p-4`}>
          <SectionTitle
            icon={ShieldCheck}
            title="Admin actions"
            right={<button type="button" onClick={() => onTab('activity', { log: 'admin' })} className="text-xs text-indigo-300 hover:text-indigo-200">See all</button>}
          />
          {data.recent_audit.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No admin changes recorded yet.</p>
          ) : (
            <ol className="divide-y divide-slate-800">
              {data.recent_audit.map((a) => (
                <li key={a.id} className="py-2 text-xs">
                  <div className="text-slate-200">{a.summary}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{ago(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
