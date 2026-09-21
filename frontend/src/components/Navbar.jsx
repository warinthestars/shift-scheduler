import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Calendar, Shield, User, LogOut, Star, Building2, Briefcase } from 'lucide-react';

export default function Navbar() {
  const { user, logout, isAdmin, isManager, isWorker } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userRole = (user?.role || '').toLowerCase();

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand Logo */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Calendar className="w-5 h-5 text-slate-950 font-bold" />
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight text-white">Shift<span className="text-emerald-400">Board</span></span>
                <span className="hidden sm:inline-block ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">PWA</span>
              </div>
            </Link>

            {/* Navigation links based on role */}
            <nav className="hidden md:flex ml-8 space-x-2">
              {(isWorker || isAdmin) && (
                <Link
                  to="/worker"
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${
                    location.pathname === '/worker'
                      ? 'bg-slate-800 text-emerald-400'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Briefcase className="w-4 h-4" />
                  <span>Worker Call-Board</span>
                </Link>
              )}

              {(userRole === 'venue_manager' || isAdmin) && (
                <Link
                  to="/venue"
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${
                    location.pathname === '/venue'
                      ? 'bg-slate-800 text-teal-400'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Venue Portal</span>
                </Link>
              )}

              {isAdmin && (
                <Link
                  to="/admin"
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center space-x-1.5 transition ${
                    location.pathname === '/admin'
                      ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/50'
                      : 'text-indigo-400 hover:text-indigo-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>Super Admin</span>
                </Link>
              )}
            </nav>
          </div>

          {/* User Info & Actions */}
          <div className="flex items-center space-x-4">
            {user && (
              <div className="flex items-center space-x-3">
                {/* Rating Badge for Workers */}
                {userRole === 'worker' && (
                  <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
                    <span className="text-amber-500/70">({user.rating_count || 0})</span>
                  </div>
                )}

                {/* User Role Tag */}
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      userRole === 'platform_admin'
                        ? 'bg-indigo-400'
                        : userRole === 'venue_manager'
                        ? 'bg-teal-400'
                        : 'bg-emerald-400'
                    }`}></span>
                    <span>{userRole.replace('_', ' ')}</span>
                  </div>
                </div>

                {/* Logout Button */}
                <button
                  onClick={handleLogout}
                  title="Log out"
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
