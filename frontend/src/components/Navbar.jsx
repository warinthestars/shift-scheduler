import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound, Wallet, ClipboardCheck, Network, LayoutGrid } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33
import BrandLogo from './BrandLogo';                        // Phase 37
import { BOARD_NAME } from '../brand';                     // Phase 37

// Phase 33.1: role names people read
const ROLE_TEXT = { worker: 'Worker', venue_manager: 'Manager', platform_admin: 'Admin' };

export default function Navbar() {
  const { user, logout, isAdmin, isWorker } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [adminVenues, setAdminVenues] = useState([]);
  const [selectedVenueId, setSelectedVenueId] = useState(
    localStorage.getItem('shiftboard_admin_venue_id') || ''
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const userRole = (user?.role || '').toLowerCase();
  const isPlatformAdmin = userRole === 'platform_admin' || isAdmin;
  const isManagerRole = userRole === 'venue_manager';

  const handleLogout = async () => {
    setMobileOpen(false);
    await disablePush();          // Phase 33: this device stops getting this account's notifications
    logout();
    navigate('/');                // Phase 36: the home page is the public board, or the sign-in page when the board is off
  };

  // Phase 33: if this device already allowed notifications, make sure the server still has it
  useEffect(() => {
    if (user?.id) syncPush();
  }, [user?.id]);

  // Phase 36: is this worker a shift lead anywhere / does this manager own an organization?
  // Asked once per sign-in; the page-level components ask again for the details.
  const [isLead, setIsLead] = useState(false);
  const [ownsOrg, setOwnsOrg] = useState(false);
  useEffect(() => {
    let active = true;
    setIsLead(false);
    setOwnsOrg(false);
    if (!user?.id) return undefined;
    if (userRole === 'worker') {
      api.get('/lead/venues').then((res) => active && setIsLead((res.data || []).length > 0)).catch(() => {});
    } else if (userRole === 'venue_manager') {
      api.get('/organizations').then((res) => active && setOwnsOrg((res.data || []).length > 0)).catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [user?.id, userRole]);

  // Phase 37: which worker tab is open (My shifts / ShiftBoard are separate links). WorkerDashboard reports it
  // with the same 'worker_tab_state' event the phone tab bar listens to.
  const [workerTab, setWorkerTab] = useState(() => {
    try {
      return (JSON.parse(sessionStorage.getItem('shiftboard_worker_tab') || 'null') || {}).tab || 'schedule';
    } catch (e) {
      return 'schedule';
    }
  });
  useEffect(() => {
    const onState = (e) => setWorkerTab((e.detail || {}).tab || 'schedule');
    window.addEventListener('worker_tab_state', onState);
    return () => window.removeEventListener('worker_tab_state', onState);
  }, []);
  const onWorkerPage = location.pathname === '/worker';

  // Close the mobile menu whenever the route changes (Phase 37: also My shifts <-> ShiftBoard, which share /worker)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  // Super Admin venue switcher data (Phase 29.2: reloads when the admin console creates/deletes a venue)
  useEffect(() => {
    if (!isPlatformAdmin) return undefined;
    const load = () =>
      api
        .get('/admin/venues')
        .then((res) => {
          const list = res.data || [];
          setAdminVenues(list);
          const saved = localStorage.getItem('shiftboard_admin_venue_id');
          if (saved && list.some((v) => v.id === saved)) {
            setSelectedVenueId(saved);
          } else if (list.length > 0) {
            setSelectedVenueId(list[0].id);
            localStorage.setItem('shiftboard_admin_venue_id', list[0].id);
          } else {
            setSelectedVenueId('');
          }
        })
        .catch((err) => console.error('Failed to load admin venues for switcher:', err));
    load();
    window.addEventListener('admin_venues_changed', load);
    return () => window.removeEventListener('admin_venues_changed', load);
  }, [isPlatformAdmin]);

  // Phase 28: stay in sync when a notification link switches the venue
  useEffect(() => {
    const onSwitch = (e) => {
      if (e.detail) setSelectedVenueId(e.detail);
    };
    window.addEventListener('admin_venue_changed', onSwitch);
    return () => window.removeEventListener('admin_venue_changed', onSwitch);
  }, []);

  const handleVenueChange = (e) => {
    const newId = e.target.value;
    setSelectedVenueId(newId);
    localStorage.setItem('shiftboard_admin_venue_id', newId);
    window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: newId }));
    setMobileOpen(false);
    if (location.pathname !== '/venue') {
      navigate('/venue');
    }
  };

  // Phase 37: `on` = is this link the page they're on. Workers get My shifts and the ShiftBoard as two links.
  const links = [
    isPlatformAdmin && {
      to: '/worker',
      label: 'Worker view',
      icon: Briefcase,
      active: 'bg-slate-800 text-brand-400',
    },
    isWorker && !isPlatformAdmin && {
      to: '/worker?tab=schedule',
      label: 'My shifts',
      icon: Briefcase,
      active: 'bg-slate-800 text-brand-400',
      on: onWorkerPage && workerTab !== 'find',
    },
    isWorker && !isPlatformAdmin && {              // Phase 37: every shift that's up and isn't theirs yet
      to: '/worker?tab=find',
      label: BOARD_NAME,
      icon: LayoutGrid,
      active: 'bg-slate-800 text-brand-400',
      on: onWorkerPage && workerTab === 'find',
    },
    isWorker && {                                   // Phase 33.1
      to: '/earnings',
      label: 'Hours & pay',
      icon: Wallet,
      active: 'bg-slate-800 text-brand-400',
    },
    isWorker && isLead && {                         // Phase 36: shift leads
      to: '/lead',
      label: 'Lead',
      icon: ClipboardCheck,
      active: 'bg-slate-800 text-brand-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Manager view' : 'My venue',
      icon: Building2,
      active: 'bg-slate-800 text-brand-400',
    },
    isManagerRole && ownsOrg && {                   // Phase 36: organization owners (admins use Admin → Organizations)
      to: '/org',
      label: 'Organization',
      icon: Network,
      active: 'bg-slate-800 text-brand-400',
    },
    isPlatformAdmin && {
      to: '/admin',
      label: 'Admin',
      icon: Shield,
      active: 'bg-slate-800 text-brand-400',
    },
    {
      to: '/venues',
      label: 'Venues',
      icon: MapPin,
      active: 'bg-slate-800 text-brand-400',
    },
  ].filter(Boolean).map((l) => ({
    ...l,
    on: l.on !== undefined ? l.on : (location.pathname === l.to || (l.to === '/venues' && location.pathname.startsWith('/venues/'))),
  }));

  const venueSwitcher = (idSuffix) =>
    isPlatformAdmin && adminVenues.length > 0 ? (
      <div className="flex items-center space-x-2 bg-slate-950/70 border border-indigo-500/30 px-3 py-1.5 rounded-xl shadow-inner">
        <Building2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <label htmlFor={`admin-venue-switcher-${idSuffix}`} className="text-xs text-indigo-300 font-semibold whitespace-nowrap">
          Viewing Venue:
        </label>
        <select
          id={`admin-venue-switcher-${idSuffix}`}
          value={selectedVenueId}
          onChange={handleVenueChange}
          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-lg px-2.5 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="" disabled>Select Venue</option>
          {adminVenues.map((v) => (
            <option key={v.id} value={v.id} className="bg-slate-900 text-white">
              {v.name}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  const roleDot =
    userRole === 'platform_admin' ? 'bg-indigo-400' : userRole === 'venue_manager' ? 'bg-teal-400' : 'bg-emerald-400';

  return (
    <header className="bg-black border-b border-brand-500/25 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand + desktop links */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center" aria-label="ShiftUp home">
              <BrandLogo />
            </Link>

            <nav className="hidden lg:flex ml-3 xl:ml-6 space-x-1 xl:space-x-2">
              {links.map(({ to, label, icon: Icon, active, on }) => (
                <Link
                  key={to}
                  to={to}
                  aria-current={on ? 'page' : undefined}
                  className={`px-2.5 xl:px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${isPlatformAdmin ? '' : 'whitespace-nowrap '}${
                    on ? active : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Desktop venue switcher */}
          <div className="hidden lg:block">{venueSwitcher('desktop')}</div>

          {/* Right side */}
          <div className="flex items-center space-x-2">
            {user && <NotificationBell />}
            {user && userRole === 'worker' && (
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {user.rating_count ? (
                  <>
                    <span>{Number(user.rating_average || user.aggregate_rating || 0).toFixed(1)}</span>
                    <span className="text-amber-500/70">({user.rating_count})</span>
                  </>
                ) : (
                  <span>New</span>
                )}
              </div>
            )}

            {user && (
              <Link to="/profile" title="Your profile" className={`hidden lg:flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl transition ${
                location.pathname === '/profile' ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                <div className="text-right hidden xl:block">
                  <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                    <span>{ownsOrg ? 'Owner' : isLead ? 'Shift lead' : (ROLE_TEXT[userRole] || 'Worker')}</span>
                  </div>
                </div>
                <Avatar person={user} size="w-8 h-8 text-xs" />
              </Link>
            )}

            {user && (
              <button
                onClick={handleLogout}
                title="Log out"
                className="hidden lg:inline-flex p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}

            {user && (
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                className="lg:hidden p-2.5 rounded-xl text-slate-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition"
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu panel */}
      {user && mobileOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-black px-4 pb-4 pt-3 space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">{user.first_name} {user.last_name}</div>
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{ownsOrg ? 'Owner' : isLead ? 'Shift lead' : (ROLE_TEXT[userRole] || 'Worker')}</span>
              </div>
            </div>
            {userRole === 'worker' && (
              <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{user.rating_count ? Number(user.rating_average || user.aggregate_rating || 0).toFixed(1) : 'New'}</span>
              </div>
            )}
          </div>

          <nav className="grid gap-2">
            {[...links, { to: '/profile', label: 'My profile', icon: UserRound, active: 'bg-slate-800 text-brand-400', on: location.pathname === '/profile' }].map(({ to, label, icon: Icon, active, on }) => (
              <Link
                key={to}
                to={to}
                aria-current={on ? 'page' : undefined}
                className={`px-4 py-3 rounded-xl text-base font-semibold transition flex items-center space-x-3 ${
                  on ? active : 'text-slate-200 bg-slate-800/60 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          {venueSwitcher('mobile')}

          <button
            type="button"
            onClick={handleLogout}
            className="w-full px-4 py-3 rounded-xl text-base font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition flex items-center justify-center space-x-2"
          >
            <LogOut className="w-5 h-5" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </header>
  );
}
