import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin } from 'lucide-react';

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

  const handleLogout = () => {
    setMobileOpen(false);
    logout();
    navigate('/login');
  };

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Super Admin venue switcher data
  useEffect(() => {
    if (isPlatformAdmin) {
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
          }
        })
        .catch((err) => console.error('Failed to load admin venues for switcher:', err));
    }
  }, [isPlatformAdmin]);

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

  const links = [
    (isWorker || isPlatformAdmin) && {
      to: '/worker',
      label: 'Worker',
      icon: Briefcase,
      active: 'bg-slate-800 text-emerald-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: 'Venue Manager',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
    },
    isPlatformAdmin && {
      to: '/admin',
      label: 'Admin',
      icon: Shield,
      active: 'bg-indigo-950 text-indigo-300 border border-indigo-700/50',
    },
    {
      to: '/venues',
      label: 'Venues',
      icon: MapPin,
      active: 'bg-slate-800 text-amber-400',
    },
  ].filter(Boolean);

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
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand + desktop links */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Calendar className="w-5 h-5 text-slate-950 font-bold" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">
                Shift<span className="text-emerald-400">Board</span>
              </span>
            </Link>

            <nav className="hidden lg:flex ml-6 space-x-2">
              {links.map(({ to, label, icon: Icon, active }) => (
                <Link
                  key={to}
                  to={to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${
                    (location.pathname === to || (to === '/venues' && location.pathname.startsWith('/venues/'))) ? active : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Desktop venue switcher */}
          <div className="hidden lg:block">{venueSwitcher('desktop')}</div>

          {/* Right side */}
          <div className="flex items-center space-x-2">
            {user && userRole === 'worker' && (
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
                <span className="text-amber-500/70">({user.rating_count || 0})</span>
              </div>
            )}

            {user && (
              <div className="text-right hidden lg:block">
                <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                  <span>{userRole.replace('_', ' ')}</span>
                </div>
              </div>
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
        <div className="lg:hidden border-t border-slate-800 bg-slate-900 px-4 pb-4 pt-3 space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">{user.first_name} {user.last_name}</div>
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{userRole.replace('_', ' ')}</span>
              </div>
            </div>
            {userRole === 'worker' && (
              <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
              </div>
            )}
          </div>

          <nav className="grid gap-2">
            {links.map(({ to, label, icon: Icon, active }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-3 rounded-xl text-base font-semibold transition flex items-center space-x-3 ${
                  (location.pathname === to || (to === '/venues' && location.pathname.startsWith('/venues/'))) ? active : 'text-slate-200 bg-slate-800/60 hover:bg-slate-800'
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
