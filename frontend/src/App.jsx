import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import WorkerDashboard from './pages/WorkerDashboard';
import VenueManagerDashboard from './pages/VenueManagerDashboard';
import AdminPanel from './pages/AdminPanel';
import VenuesDirectory from './pages/VenuesDirectory';
import VenueProfile from './pages/VenueProfile';
import JoinPage from './pages/JoinPage';

function HomeRedirect() {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="animate-pulse flex items-center space-x-2">
          <div className="w-3 h-3 bg-emerald-500 rounded-full animate-bounce"></div>
          <span>Loading ShiftBoard...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const role = (user?.role || '').toLowerCase();
  if (role === 'platform_admin') {
    return <Navigate to="/admin" replace />;
  }
  if (role === 'venue_manager') {
    return <Navigate to="/venue" replace />;
  }
  return <Navigate to="/worker" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 flex flex-col font-sans">
          <Routes>
            {/* Public Login & Register */}
            <Route path="/login" element={<LoginPage />} />

            {/* Phase 29: team invite link / QR code (works signed in or out) */}
            <Route path="/join/:token" element={<JoinPage />} />

            {/* Smart Home Redirect */}
            <Route path="/" element={<HomeRedirect />} />

            {/* Worker Dashboard (Requires worker role) */}
            <Route
              path="/worker"
              element={
                <ProtectedRoute allowedRoles={['worker', 'platform_admin']}>
                  <Navbar />
                  <WorkerDashboard />
                </ProtectedRoute>
              }
            />

            {/* Venue Manager Dashboard (Requires venue_manager role) */}
            <Route
              path="/venue"
              element={
                <ProtectedRoute allowedRoles={['venue_manager', 'platform_admin']}>
                  <Navbar />
                  <VenueManagerDashboard />
                </ProtectedRoute>
              }
            />

            {/* Platform Admin Control Panel (Requires platform_admin role) */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['platform_admin']}>
                  <Navbar />
                  <AdminPanel />
                </ProtectedRoute>
              }
            />

            {/* Phase 25.1: Public venue directory & profiles (any signed-in role) */}
            <Route
              path="/venues"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <VenuesDirectory />
                </ProtectedRoute>
              }
            />
            <Route
              path="/venues/:venueId"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <VenueProfile />
                </ProtectedRoute>
              }
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
