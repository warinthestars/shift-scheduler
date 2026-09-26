import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Plus, Search, ExternalLink, Settings, Users, AlertTriangle, MapPin, ShieldCheck, Trash2, UserCog,
  CalendarDays, Clock, Crosshair,
} from 'lucide-react';
import api from '../../api/client';
import VenueSettingsModal from '../VenueSettingsModal';
import TeamModal from '../TeamModal';
import ActivityFeed from '../ActivityFeed';
import {
  card, inputCls, btnGhost, btnPrimary, btnDanger, POLICY_LABEL, ago, Drawer, TypeToConfirm, openVenueAsManager,
  venuesChanged,
} from './adminUi';

function Num({ value, warn = false }) {
  return (
    <span className={`font-mono font-bold ${value === 0 ? 'text-slate-600' : warn ? 'text-amber-300' : 'text-slate-100'}`}>{value}</span>
  );
}

/**
 * Phase 29.2: Venues tab. GET /admin/venues/summary (+ /admin/venues for the full records the settings modal edits).
 * Props: refreshKey, onOpenVenue(id), onCreate(), onChanged()
 */
export default function AdminVenues({ refreshKey = 0, onOpenVenue, onCreate }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/admin/venues/summary')
      .then((res) => active && setRows(res.data || []))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load venues.'));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!rows) return [];
    if (!t) return rows;
    return rows.filter((v) =>
      v.name.toLowerCase().includes(t) || (v.address || '').toLowerCase().includes(t)
      || v.managers.some((m) => m.name.toLowerCase().includes(t) || (m.email || '').toLowerCase().includes(t)));
  }, [rows, q]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!rows) return <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>;

  return (
    <section className={card}>
      <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search venues, addresses or managers"
            className={`${inputCls} pl-9`} />
        </div>
        <span className="text-xs text-slate-500 sm:ml-auto">{rows.length} venue{rows.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={onCreate} className={btnPrimary}>
          <Plus className="w-4 h-4" /> New venue
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">{rows.length ? 'No venues match.' : 'No venues yet. Create the first one.'}</p>
      ) : (
        <>
        <ul className="md:hidden divide-y divide-slate-800/60">
          {shown.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onOpenVenue(v.id)} className="w-full text-left px-4 py-3 hover:bg-slate-800/30 space-y-1">
                <span className="font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-emerald-400" /> {v.name}</span>
                <span className="block text-[11px] text-slate-500 truncate">{v.address}</span>
                <span className="block text-[11px] text-slate-300">
                  {v.managers.length ? v.managers.map((m) => m.name).join(', ') : 'No manager'} · {v.team_active} on team · {v.open_spots_7d} open this week · {v.pending_requests} waiting
                </span>
                {v.warnings.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {v.warnings.map((w) => (
                      <span key={w} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">{w}</span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Venue</th>
                <th className="py-2.5 px-3">Managers</th>
                <th className="py-2.5 px-3 text-center" title="Active team members">Team</th>
                <th className="py-2.5 px-3 text-center" title="Events in the next 30 days">Events 30d</th>
                <th className="py-2.5 px-3 text-center" title="Unfilled spots on shifts in the next 7 days">Open 7d</th>
                <th className="py-2.5 px-3 text-center" title="Requests waiting for a manager">Waiting</th>
                <th className="py-2.5 px-3">Booking</th>
                <th className="py-2.5 px-3">Clock-in</th>
                <th className="py-2.5 px-3">Last activity</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {shown.map((v) => (
                <tr key={v.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => onOpenVenue(v.id)}>
                  <td className="py-3 px-4 min-w-[14rem]">
                    <div className="font-bold text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> {v.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">{v.address}</div>
                    {v.warnings.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {v.warnings.map((w) => (
                          <span key={w} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold inline-flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" /> {w}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {v.managers.length === 0 ? <span className="text-slate-600">None</span> : (
                      <div className="space-y-0.5">
                        {v.managers.slice(0, 2).map((m) => <div key={m.user_id} className="text-slate-200 truncate max-w-[10rem]">{m.name}</div>)}
                        {v.managers.length > 2 && <div className="text-slate-500">+{v.managers.length - 2} more</div>}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center"><Num value={v.team_active} /></td>
                  <td className="py-3 px-3 text-center"><Num value={v.upcoming_events} /></td>
                  <td className="py-3 px-3 text-center"><Num value={v.open_spots_7d} warn /></td>
                  <td className="py-3 px-3 text-center"><Num value={v.pending_requests} warn /></td>
                  <td className="py-3 px-3 whitespace-nowrap">{POLICY_LABEL[v.approval_policy] || v.approval_policy}</td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {v.geofence_enabled
                      ? <span className="text-emerald-300 inline-flex items-center gap-1"><Crosshair className="w-3 h-3" /> On site only</span>
                      : <span className="text-slate-500">Anywhere</span>}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-slate-400">{ago(v.last_activity_at)}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => openVenueAsManager(navigate, v.id)} className={btnGhost} title="Open this venue's manager dashboard">
                      <ExternalLink className="w-3 h-3" /> Dashboard
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className="text-sm text-white font-semibold mt-0.5">{children}</div>
    </div>
  );
}

/**
 * Phase 29.2: Everything about one venue for an admin: health, managers, settings, team, activity,
 * admin changes, and a safe delete.
 * Props: venueId, onClose, onOpenUser(userId), onChanged(message?), onDeleted(message)
 */
export function AdminVenueDrawer({ venueId, onClose, onOpenUser, onChanged, onDeleted }) {
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [full, setFull] = useState(null);
  const [positions, setPositions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState(null); // 'settings' | 'team' | 'delete'
  const [deleteHistory, setDeleteHistory] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/admin/venues/summary'),
      api.get('/admin/venues'),
      api.get(`/venues/${venueId}/positions`).catch(() => ({ data: [] })),
      api.get('/admin/audit', { params: { target_type: 'venue', target_id: venueId, limit: 10 } }).catch(() => ({ data: [] })),
    ])
      .then(([sum, all, pos, au]) => {
        if (!active) return;
        const r = (sum.data || []).find((v) => v.id === venueId);
        if (!r) {
          setError('This venue no longer exists.');
          return;
        }
        setRow(r);
        setFull((all.data || []).find((v) => v.id === venueId) || null);
        setPositions(pos.data || []);
        setAudit(au.data || []);
      })
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load this venue.'));
    return () => {
      active = false;
    };
  }, [venueId, reload]);

  const doDelete = async () => {
    await api.delete(`/venues/${venueId}`, { params: { confirm_name: row.name, delete_history: deleteHistory } });
    venuesChanged();
    try {
      if (localStorage.getItem('shiftboard_admin_venue_id') === venueId) localStorage.removeItem('shiftboard_admin_venue_id');
    } catch {
      /* ignore */
    }
    onDeleted(`Deleted ${row.name}.`);
  };

  return (
    <Drawer
      title={row?.name || 'Venue'}
      subtitle={row ? <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{row.address}</span> : null}
      onClose={onClose}
      footer={row && (
        <>
          <button type="button" onClick={() => setModal('team')} className={btnGhost}><Users className="w-3 h-3" /> Team</button>
          <button type="button" onClick={() => setModal('settings')} disabled={!full} className={btnGhost}><Settings className="w-3 h-3" /> Settings</button>
          <button type="button" onClick={() => openVenueAsManager(navigate, venueId)} className={btnPrimary}>
            <ExternalLink className="w-3.5 h-3.5" /> Open dashboard
          </button>
        </>
      )}
    >
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!row && !error && <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>}
      {row && (
        <>
          {row.warnings.length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-sm text-amber-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{row.warnings.join(' · ')}</span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Fact icon={Users} label="Team">{row.team_active} active</Fact>
            <Fact icon={CalendarDays} label="Events, 30 days">{row.upcoming_events}</Fact>
            <Fact icon={AlertTriangle} label="Open spots, 7 days">{row.open_spots_7d}</Fact>
            <Fact icon={Clock} label="Requests waiting">{row.pending_requests}</Fact>
            <Fact label="Booking">{POLICY_LABEL[row.approval_policy] || row.approval_policy}</Fact>
            <Fact icon={Crosshair} label="Clock-in">
              {row.geofence_enabled ? `On site (${full?.geofence_radius_meters ?? '?'} m)` : 'Anywhere'}
            </Fact>
            <Fact label="Positions">{row.positions_count}</Fact>
            <Fact label="Locations">{row.locations_count}</Fact>
            <Fact label="Time zone">{row.timezone}</Fact>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <UserCog className="w-3 h-3" /> Managers
            </div>
            {row.managers.length === 0 ? (
              <p className="text-xs text-slate-500">
                No manager yet. Create one on the Users tab (role: Venue manager) or change someone's role there.
              </p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {row.managers.map((m) => (
                  <button key={m.user_id} type="button" onClick={() => onOpenUser(m.user_id)}
                    className="w-full text-left px-3 py-2 bg-slate-950 hover:bg-slate-800/60 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-100 font-semibold">{m.name}</span>
                    <span className="text-slate-500 truncate">{m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <ActivityFeed venueId={venueId} refreshKey={reload} onOpenWorker={onOpenUser} />

          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Admin changes
            </div>
            {audit.length === 0 ? (
              <p className="text-xs text-slate-500">None recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {audit.map((a) => (
                  <li key={a.id} className="text-slate-300">
                    {a.summary} <span className="text-slate-500">· {ago(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/5">
            <div className="text-sm font-bold text-rose-300">Delete this venue</div>
            <p className="text-xs text-slate-400 mt-1">
              Removes the venue with its events, shifts, team, invites and activity. People's accounts stay.
              Created {new Date(row.created_at).toLocaleDateString()}.
            </p>
            <button type="button" onClick={() => setModal('delete')} className={`${btnDanger} mt-2`}>
              <Trash2 className="w-3 h-3" /> Delete venue…
            </button>
          </div>
        </>
      )}

      {modal === 'settings' && full && (
        <VenueSettingsModal
          mode="edit"
          venue={full}
          onClose={() => {
            setModal(null);
            setReload((n) => n + 1);
          }}
          onSaved={(saved) => {
            setModal(null);
            setReload((n) => n + 1);
            venuesChanged();
            onChanged(`Saved settings for ${saved.name}.`);
          }}
        />
      )}
      {modal === 'team' && (
        <TeamModal
          venue={full || { id: venueId, name: row?.name }}
          positions={positions}
          timeZone={row?.timezone}
          onClose={() => {
            setModal(null);
            setReload((n) => n + 1);
          }}
          onChanged={() => setReload((n) => n + 1)}
        />
      )}
      {modal === 'delete' && row && (
        <TypeToConfirm
          title={`Delete ${row.name}?`}
          word={row.name}
          confirmLabel="Delete venue"
          message={(
            <p>
              This can't be undone. {row.upcoming_events > 0 && <b className="text-rose-300">{row.upcoming_events} upcoming event{row.upcoming_events === 1 ? '' : 's'} will be removed and booked people won't be told. </b>}
              If people have clocked in here, you must also delete the payroll history (export time sheets first).
            </p>
          )}
          onConfirm={doDelete}
          onClose={() => {
            setModal(null);
            setDeleteHistory(false);
          }}
        >
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={deleteHistory} onChange={(e) => setDeleteHistory(e.target.checked)} className="mt-0.5" />
            Also delete clock-ins and time sheets (payroll history) for this venue
          </label>
        </TypeToConfirm>
      )}
    </Drawer>
  );
}
