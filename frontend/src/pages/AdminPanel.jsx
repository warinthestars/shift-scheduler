import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, LayoutDashboard, Building2, Users, History, Server, UserPlus, Plus } from 'lucide-react';
import api from '../api/client';
import VenueSettingsModal from '../components/VenueSettingsModal';
import AdminOverview from '../components/admin/AdminOverview';
import AdminVenues, { AdminVenueDrawer } from '../components/admin/AdminVenues';
import AdminUsers from '../components/admin/AdminUsers';
import AdminUserDrawer from '../components/admin/AdminUserDrawer';
import AdminCreateUserModal from '../components/admin/AdminCreateUserModal';
import AdminActivity from '../components/admin/AdminActivity';
import AdminSystem from '../components/admin/AdminSystem';
import { Flash, venuesChanged } from '../components/admin/adminUi';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'venues', label: 'Venues', icon: Building2 },
  { id: 'users', label: 'People', icon: Users },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'system', label: 'System', icon: Server },
];

/**
 * Phase 29.2: Platform admin console.
 * Tabs (kept in ?tab=): Overview · Venues · People · Activity · System.
 * Venue and person details open in right-hand drawers from any tab.
 */
export default function AdminPanel() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const [logView, setLogView] = useState('venues');
  const [venues, setVenues] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [flash, setFlash] = useState(null);
  const [venueDrawer, setVenueDrawer] = useState(null);
  const [userDrawer, setUserDrawer] = useState(null);
  const [createUser, setCreateUser] = useState(false);
  const [createVenue, setCreateVenue] = useState(false);

  const refresh = () => setRefreshKey((n) => n + 1);
  const clearFlash = useCallback(() => setFlash(null), []);
  const ok = (message) => {
    setFlash({ type: 'success', message });
    refresh();
  };

  useEffect(() => {
    api
      .get('/admin/venues')
      .then((res) => setVenues((res.data || []).map((v) => ({ id: v.id, name: v.name }))))
      .catch(() => setVenues([]));
  }, [refreshKey]);

  const goTab = (id, opts = {}) => {
    if (id === 'activity') setLogView(opts.log || 'venues');
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
                <Shield className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white">Platform admin</h1>
                <p className="text-xs text-slate-400 mt-0.5">Every venue, every account, and the health of the platform.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCreateUser(true)}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white text-xs inline-flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> New user
              </button>
              <button type="button" onClick={() => setCreateVenue(true)}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> New venue
              </button>
            </div>
          </div>
          <nav className="flex gap-1 mt-5 overflow-x-auto -mb-px">
            {TABS.map((t) => {
              const Icon = t.icon;
              const on = tab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => goTab(t.id)}
                  className={`px-3.5 py-2.5 text-sm font-bold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition ${
                    on ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                  <Icon className={`w-4 h-4 ${on ? 'text-indigo-400' : ''}`} /> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-4">
        <Flash flash={flash} onClose={clearFlash} />

        {tab === 'overview' && (
          <AdminOverview refreshKey={refreshKey} onTab={goTab} onOpenVenue={setVenueDrawer} onOpenUser={setUserDrawer} />
        )}
        {tab === 'venues' && (
          <AdminVenues refreshKey={refreshKey} onOpenVenue={setVenueDrawer} onCreate={() => setCreateVenue(true)} />
        )}
        {tab === 'users' && (
          <AdminUsers refreshKey={refreshKey} venues={venues} onOpenUser={setUserDrawer} onCreate={() => setCreateUser(true)} />
        )}
        {tab === 'activity' && (
          <AdminActivity refreshKey={refreshKey} venues={venues} initialLog={logView}
            onOpenUser={setUserDrawer} onOpenVenue={setVenueDrawer} />
        )}
        {tab === 'system' && <AdminSystem refreshKey={refreshKey} onFlash={setFlash} />}
      </main>

      {venueDrawer && (
        <AdminVenueDrawer
          key={venueDrawer}
          venueId={venueDrawer}
          onClose={() => setVenueDrawer(null)}
          onOpenUser={(id) => setUserDrawer(id)}
          onChanged={ok}
          onDeleted={(message) => {
            setVenueDrawer(null);
            ok(message);
          }}
        />
      )}
      {userDrawer && (
        <AdminUserDrawer
          key={userDrawer}
          userId={userDrawer}
          venues={venues}
          onClose={() => setUserDrawer(null)}
          onChanged={ok}
          onDeleted={(message) => {
            setUserDrawer(null);
            ok(message);
          }}
        />
      )}
      {createUser && (
        <AdminCreateUserModal
          venues={venues}
          onClose={() => setCreateUser(false)}
          onCreated={(u) => ok(`Created ${u.first_name} ${u.last_name} (${u.email}).`)}
          onOpenUser={(id) => setUserDrawer(id)}
        />
      )}
      {createVenue && (
        <VenueSettingsModal
          mode="create"
          venue={null}
          showManagerEmail
          onClose={() => setCreateVenue(false)}
          onSaved={(saved) => {
            setCreateVenue(false);
            venuesChanged();
            ok(`Created ${saved.name}. Set up positions and a manager from its panel.`);
            setVenueDrawer(saved.id);
          }}
        />
      )}
    </div>
  );
}
