import React from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="animate-pulse flex items-center space-x-2">
          <div className="w-3 h-3 bg-brand-500 rounded-full animate-bounce"></div>
          <span>Authenticating ShiftUp session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If allowedRoles is specified, check role
  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = (user?.role || '').toLowerCase();
    const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());

    if (!normalizedAllowed.includes(userRole)) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-200">
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-4">
            <ShieldAlert className="w-12 h-12" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">This page isn't for your account</h1>
          <p className="text-sm text-slate-400 max-w-md text-center mb-6">
            {allowedRoles.map((r) => String(r).toLowerCase()).includes('venue_manager') && !allowedRoles.map((r) => String(r).toLowerCase()).includes('worker')
              ? 'This page is for venue managers.'
              : allowedRoles.map((r) => String(r).toLowerCase()).every((r) => r === 'platform_admin')
              ? 'This page is for ShiftUp admins.'
              : 'Your account can’t open this page.'} Head back to your own page instead.
          </p>
          <Link
            to={
              userRole === 'platform_admin'
                ? '/admin'
                : userRole === 'venue_manager'
                ? '/venue'
                : '/worker'
            }
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center space-x-2 border border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to my page</span>
          </Link>
        </div>
      );
    }
  }

  return children;
}
