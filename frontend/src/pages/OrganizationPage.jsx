import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Network, LayoutDashboard, Users, Settings2, Building2, MapPin, Radio, AlarmClock, UserPlus, Inbox, ChevronRight,
  Search, RefreshCw, Pencil, Check, X, AlertCircle, ClipboardCheck, BellRing,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import OrgOwnersPanel from '../components/org/OrgOwnersPanel';
import SharePersonModal from '../components/org/SharePersonModal';
import RatingBadge from '../components/RatingBadge';
import { fmtDate, fmtTime } from '../utils/venueTime';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'people', label: 'People', icon: Users },
  { id: 'settings', label: 'Owners & settings', icon: Settings2 },
];
const STATUS_CHIP = {
  active: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30',
  removed: 'bg-slate-800 text-slate-400 border-slate-700 line-through',
  blocked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};

function Stat({ label, value, tone = 'text-white', icon: Icon }) {
  return (
    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </p>
      <p className={`text-xl font-black mt-0.5 ${tone}`}>{value}</p>
    </div>
  );
}

/**
 * Phase 36: the organization owner's page (/org). An organization is a group of venues; its owners
 * manage every venue in it.
 *   Overview            every venue side by side: today and the next seven days. "Open venue" goes to the
 *                       normal manager dashboard for that venue.
 *   People              everyone on any venue's team; add a person to another venue, or move them.
 *   Owners & settings   owners, the organization's name, and "send me each venue's manager alerts".
 * Platform admins can open any organization here; they create organizations and choose their venues
 * in Admin → Organizations (there is no venue sign-up yet).
 */
export default function OrganizationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isAdmin = String(user?.role || '').toLowerCase() === 'platform_admin';
  const [orgs, setOrgs] = useState(null);                 // null = loading
  const [overview, setOverview] = useState(null);
  const [people, setPeople] = useState(null);
  const [q, setQ] = useState('');
  const [share, setShare] = useState(null);               // OrgPerson
  const [notice, setNotice] = useState(null);             // { type, message }
  const [renaming, setRenaming] = useState(null);         // string while editing
  const [busy, setBusy] = useState(false);

  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const org = useMemo(() => {
    if (!orgs || orgs.length === 0) return null;
    return orgs.find((o) => o.id === params.get('org')) || orgs[0];
  }, [orgs, params]);
  const orgId = org?.id || null;

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const loadOrgs = useCallback(() => api
    .get('/organizations')
    .then((res) => setOrgs(res.data || []))
    .catch(() => setOrgs([])), []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const loadOverview = useCallback(() => {
    if (!orgId) return;
    api.get(`/organizations/${orgId}/overview`).then((res) => setOverview(res.data)).catch(() => setOverview(null));
  }, [orgId]);

  const loadPeople = useCallback(() => {
    if (!orgId) return;
    api.get(`/organizations/${orgId}/people`).then((res) => setPeople(res.data || [])).catch(() => setPeople([]));
  }, [orgId]);

  useEffect(() => {
    setOverview(null);
    setPeople(null);
    if (!orgId) return;
    if (tab === 'overview') loadOverview();
    if (tab === 'people') loadPeople();
  }, [orgId, tab, loadOverview, loadPeople]);

  useEffect(() => {
    if (!notice || notice.type === 'error') return undefined;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const replaceOrg = (result) => {
    if (result?.organization) setOrgs((list) => (list || []).map((o) => (o.id === result.organization.id ? result.organization : o)));
    const extra = (result?.warnings || []).join(' ');
    if (result?.message) setNotice({ type: extra ? 'error' : 'success', message: `${result.message}${extra ? ` ${extra}` : ''}` });
  };

  const saveName = async () => {
    const name = (renaming || '').trim();
    if (!name || name === org.name) return setRenaming(null);
    setBusy(true);
    try {
      const res = await api.patch(`/organizations/${org.id}`, { name });
      replaceOrg({ organization: res.data.organization, message: 'Renamed.' });
      setRenaming(null);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.detail || 'Could not rename it.' });
    } finally {
      setBusy(false);
    }
    return null;
  };

  const setAlerts = async (on) => {
    setBusy(true);
    try {
      const res = await api.patch(`/organizations/${org.id}/me`, { venue_alerts: on });
      replaceOrg(res.data);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const openVenue = (venueId) => {
    if (isAdmin) {
      try { localStorage.setItem('shiftboard_admin_venue_id', venueId); } catch (e) { /* ignore */ }
      window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venueId }));
    }
    navigate(`/venue?venue=${venueId}`);
  };

  const shownPeople = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people || [];
    return (people || []).filter((p) => `${p.first_name} ${p.last_name} ${p.email || ''} ${p.phone || ''}`.toLowerCase().includes(needle)
      || p.venues.some((v) => v.venue_name.toLowerCase().includes(needle) || v.positions.some((x) => x.toLowerCase().includes(needle))));
  }, [people, q]);

  if (orgs === null) {
    return <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-10 text-sm text-slate-500">Loading…</main>;
  }

  if (!org) {
    return (
      <main className="max-w-xl mx-auto w-full px-4 mt-16 text-center">
        <Network className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-white">No organization yet</h1>
        <p className="mt-2 text-sm text-slate-400">
          {isAdmin
            ? 'An organization groups venues under one or more owners. Create one in Admin → Organizations.'
            : 'An organization groups several venues under one owner. A ShiftUp admin sets it up and makes you an owner.'}
        </p>
        <Link to={isAdmin ? '/admin?tab=organizations' : '/venue'} className="mt-5 inline-block px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
          {isAdmin ? 'Open Admin → Organizations' : 'Back to my venue'}
        </Link>
      </main>
    );
  }

  const me = org.owners.find((o) => o.is_you) || null;
  const t = overview?.totals || {};

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 bg-teal-500/10 text-teal-300 rounded-2xl border border-teal-500/20 flex-shrink-0">
                <Network className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                {renaming === null ? (
                  <h1 className="text-2xl font-black text-white flex items-center gap-2">
                    <span className="truncate">{org.name}</span>
                    <button type="button" onClick={() => setRenaming(org.name)} aria-label="Rename the organization"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>
                  </h1>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="flex items-center gap-2">
                    <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={255} aria-label="Organization name"
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-lg font-bold text-white focus:outline-none focus:border-teal-500" />
                    <button type="submit" disabled={busy} aria-label="Save the name" className="p-2 rounded-lg bg-teal-600 text-white"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setRenaming(null)} aria-label="Cancel" className="p-2 rounded-lg bg-slate-800 text-slate-300"><X className="w-4 h-4" /></button>
                  </form>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {org.venues.length} venue{org.venues.length === 1 ? '' : 's'} · {org.owners.length} owner{org.owners.length === 1 ? '' : 's'}
                  {!org.is_owner && isAdmin && ' · you’re viewing as a platform admin'}
                </p>
              </div>
            </div>
            {orgs.length > 1 && (
              <label className="text-xs text-slate-400">
                Organization
                <select value={org.id} onChange={(e) => setParam('org', e.target.value)}
                  className="block mt-0.5 bg-slate-900 border border-slate-700 text-white text-sm font-semibold rounded-xl px-3 py-2">
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <nav className="flex gap-1 mt-5 overflow-x-auto -mb-px" aria-label="Organization sections">
            {TABS.map((x) => {
              const Icon = x.icon;
              const on = tab === x.id;
              return (
                <button key={x.id} type="button" onClick={() => setParam('tab', x.id)} aria-current={on ? 'page' : undefined}
                  className={`px-3.5 py-2.5 text-sm font-bold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition ${
                    on ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                  <Icon className={`w-4 h-4 ${on ? 'text-teal-300' : ''}`} /> {x.label}
                </button>
              );
            })}
          </nav>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-4">
        {notice && (
          <div role="status" className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'error' ? 'bg-amber-950/60 border-amber-700 text-amber-100' : 'bg-emerald-950/80 border-emerald-700 text-emerald-200'}`}>
            <span className="flex items-start gap-2">
              {notice.type === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {notice.message}
            </span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs underline flex-shrink-0">Dismiss</button>
          </div>
        )}

        {/* ------------------------------------------------------------------ Overview */}
        {tab === 'overview' && (
          <>
            {org.venues.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No venues in this organization yet. A platform admin adds them in Admin → Organizations.
              </p>
            ) : overview === null ? (
              <p className="py-12 text-center text-sm text-slate-500">Loading every venue…</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-white">All venues today</h2>
                  <button type="button" onClick={loadOverview} className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <Stat label="Events today" value={t.events_today || 0} />
                  <Stat label="Live now" value={t.live_now || 0} icon={Radio} tone={t.live_now ? 'text-emerald-300' : 'text-white'} />
                  <Stat label="Clocked in" value={`${t.clocked_in || 0} / ${t.booked_today || 0}`} />
                  <Stat label="Late" value={t.late || 0} icon={AlarmClock} tone={t.late ? 'text-rose-300' : 'text-white'} />
                  <Stat label="Open this week" value={t.open_spots_week || 0} icon={UserPlus} tone={t.open_spots_week ? 'text-amber-300' : 'text-white'} />
                  <Stat label="Requests waiting" value={t.requests_waiting || 0} icon={Inbox} tone={t.requests_waiting ? 'text-amber-300' : 'text-white'} />
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {overview.venues.map((v) => (
                    <li key={v.venue_id} className={`p-4 rounded-2xl bg-slate-900 border ${v.late > 0 ? 'border-rose-500/50' : v.live_now > 0 ? 'border-emerald-500/40' : 'border-slate-800'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white truncate flex items-center gap-1.5">
                            <Building2 className="w-4 h-4 text-teal-300 flex-shrink-0" /> {v.name}
                          </h3>
                          {v.city && <p className="text-xs text-slate-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {v.city}</p>}
                        </div>
                        {v.live_now > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                            <Radio className="w-3 h-3" /> LIVE
                          </span>
                        )}
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div><dt className="text-[10px] text-slate-500 uppercase">Today</dt><dd className="text-sm font-bold text-white">{v.events_today} event{v.events_today === 1 ? '' : 's'}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">In / booked</dt><dd className="text-sm font-bold text-white">{v.clocked_in} / {v.booked_today}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">Late</dt><dd className={`text-sm font-bold ${v.late ? 'text-rose-300' : 'text-white'}`}>{v.late}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">This week</dt><dd className="text-sm font-bold text-white">{v.events_week} event{v.events_week === 1 ? '' : 's'}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">Open spots</dt><dd className={`text-sm font-bold ${v.open_spots_week ? 'text-amber-300' : 'text-white'}`}>{v.open_spots_week}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">Requests</dt><dd className={`text-sm font-bold ${v.requests_waiting ? 'text-amber-300' : 'text-white'}`}>{v.requests_waiting}</dd></div>
                      </dl>
                      <p className="mt-3 text-xs text-slate-400 truncate">
                        {v.next_event_title
                          ? <>Next: <span className="text-slate-200 font-semibold">{v.next_event_title}</span> · {fmtDate(v.next_event_start, v.timezone)}, {fmtTime(v.next_event_start, v.timezone)}</>
                          : 'Nothing else posted this week.'}
                      </p>
                      <button type="button" onClick={() => openVenue(v.venue_id)}
                        className="mt-3 w-full px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white inline-flex items-center justify-center gap-1">
                        Open venue <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {/* ------------------------------------------------------------------ People */}
        {tab === 'people' && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="relative flex-1">
                <span className="sr-only">Search people</span>
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, venue or position"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500" />
              </label>
              <p className="text-xs text-slate-500">{people ? `${shownPeople.length} of ${people.length} people` : ''}</p>
            </div>
            <p className="text-xs text-slate-500">
              Each venue keeps its own team, positions and notes. Add someone to another venue’s team here, or move them. To change positions, notes or shift leads, open that venue’s Team page.
            </p>
            {people === null ? (
              <p className="py-12 text-center text-sm text-slate-500">Loading people…</p>
            ) : shownPeople.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                {people.length === 0 ? 'Nobody is on a team at these venues yet.' : 'Nobody matches that search.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {shownPeople.map((p) => (
                  <li key={p.worker_id} className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="md:w-80 min-w-0">
                      <p className="text-sm font-semibold text-white truncate flex items-center gap-2">
                        {`${p.first_name} ${p.last_name}`.trim() || p.email}
                        <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                      </p>
                      <p className="text-xs text-slate-400 truncate">{p.email}{p.phone ? ` · ${p.phone}` : ''}</p>
                    </div>
                    <ul className="flex-1 flex flex-wrap gap-1.5">
                      {p.venues.map((v) => (
                        <li key={v.venue_id}
                          title={`${v.status === 'active' ? 'On the team' : v.status === 'blocked' ? 'Blocked' : 'Removed'}${v.positions.length ? ` · ${v.positions.join(', ')}` : ''}${v.works_through ? ` · through ${v.works_through}` : ''} · ${v.shifts_worked} worked, ${v.upcoming} coming up`}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 ${STATUS_CHIP[v.status] || STATUS_CHIP.removed}`}>
                          {v.is_lead && <ClipboardCheck className="w-3 h-3 text-amber-300" aria-label="Shift lead" />}
                          {v.venue_name}
                          {v.status === 'blocked' && <span className="font-normal"> · blocked</span>}
                          {v.status === 'active' && v.positions.length > 0 && <span className="font-normal text-emerald-100/70"> · {v.positions.slice(0, 2).join(', ')}{v.positions.length > 2 ? '…' : ''}</span>}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => setShare(p)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white inline-flex items-center gap-1 whitespace-nowrap self-start md:self-center">
                      <UserPlus className="w-3.5 h-3.5" /> Add to a venue
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ------------------------------------------------------------------ Owners & settings */}
        {tab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <OrgOwnersPanel org={org} isAdmin={isAdmin} onChanged={replaceOrg} />
            <div className="space-y-4">
              {me && (
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><BellRing className="w-4 h-4 text-teal-300" /> Your alerts</h3>
                  <label className="mt-2 flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={!!me.venue_alerts} disabled={busy} onChange={(e) => setAlerts(e.target.checked)} className="mt-1 accent-teal-500" />
                    <span>
                      <span className="block text-sm font-semibold text-white">Send me each venue’s manager alerts</span>
                      <span className="block text-xs text-slate-400 mt-0.5">
                        New requests, late arrivals, dropped shifts and so on, for every venue here. Off: each venue’s own managers get them.
                        You always get them for a venue you manage directly, and for a venue that has no other manager.
                      </span>
                    </span>
                  </label>
                </section>
              )}
              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-teal-300" /> Venues</h3>
                {org.venues.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No venues yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-800">
                    {org.venues.map((v) => (
                      <li key={v.id} className="py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{v.name}</p>
                          <p className="text-xs text-slate-400">
                            {v.city || 'No city shown'} · {v.managers} manager{v.managers === 1 ? '' : 's'} of its own
                            {!v.public_board && ' · not on the public board'}
                          </p>
                        </div>
                        <button type="button" onClick={() => openVenue(v.id)} className="text-xs font-bold text-teal-300 hover:text-teal-200 inline-flex items-center gap-0.5 whitespace-nowrap">
                          Open <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  A ShiftUp admin adds venues to an organization or takes them out. Add a venue’s own managers from that venue’s Team page.
                </p>
              </section>
            </div>
          </div>
        )}
      </main>

      {share && (
        <SharePersonModal
          orgId={org.id}
          person={share}
          venues={org.venues}
          onClose={() => setShare(null)}
          onDone={(result) => {
            const skipped = (result.skipped || []).map((s) => `${s.venue_name}: ${s.reason}`).join(' ');
            setNotice({ type: result.added.length ? 'success' : 'error', message: `${result.message}${skipped ? ` ${skipped}` : ''}` });
            if (result.person) setPeople((list) => (list || []).map((p) => (p.worker_id === result.person.worker_id ? result.person : p)));
            else loadPeople();
          }}
        />
      )}
    </div>
  );
}
