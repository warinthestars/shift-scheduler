import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import WorkerTabBar from './components/WorkerTabBar';   // Phase 33: phone tab bar (workers only)
import LoginPage from './pages/LoginPage';
import WorkerDashboard from './pages/WorkerDashboard';
import VenueManagerDashboard from './pages/VenueManagerDashboard';
import AdminPanel from './pages/AdminPanel';
import VenuesDirectory from './pages/VenuesDirectory';
import VenueProfile from './pages/VenueProfile';
import JoinPage from './pages/JoinPage';
import ProfilePage from './pages/ProfilePage';
import EarningsPage from './pages/EarningsPage';   // Phase 33.1
import PublicBoardPage from './pages/PublicBoardPage';       // Phase 36: home page when the public board is on
import LeadPage from './pages/LeadPage';                     // Phase 36: shift leads
import OrganizationPage from './pages/OrganizationPage';     // Phase 36: organization owners
import { getPublicConfig } from './utils/publicConfig';      // Phase 36

function HomeRedirect() {
  const { user, isAuthenticated, loading } = useAuth();
  // Phase 36: null = not asked yet. Only asked when nobody is signed in.
  const [publicConfig, setPublicConfig] = useState(null);

  useEffect(() => {
    if (loading || isAuthenticated) return undefined;
    let active = true;
    getPublicConfig().then((cfg) => {
      if (active) setPublicConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, [loading, isAuthenticated]);

  if (loading || (!isAuthenticated && publicConfig === null)) {
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
    // Phase 36: PUBLIC_EVENT_BOARD on -> the public board is the home page. Off -> the sign-in page, as before.
    return publicConfig.public_board ? <PublicBoardPage config={publicConfig} /> : <Navigate to="/login" replace />;
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
                  <WorkerTabBar />
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
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/venues/:venueId"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <VenueProfile />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />

            {/* Phase 33.1: a worker's own hours & pay */}
            <Route
              path="/earnings"
              element={
                <ProtectedRoute allowedRoles={['worker', 'platform_admin']}>
                  <Navbar />
                  <EarningsPage />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />

            {/* Phase 31 + 32: everyone's own profile */}
            <Route
              path="/profile"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <ProfilePage />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />

            {/* Phase 36: shift leads (worker accounts marked "shift lead" on a venue's team) */}
            <Route
              path="/lead"
              element={
                <ProtectedRoute allowedRoles={['worker']}>
                  <Navbar />
                  <LeadPage />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />

            {/* Phase 36: organization owners (and platform admins) */}
            <Route
              path="/org"
              element={
                <ProtectedRoute allowedRoles={['venue_manager', 'platform_admin']}>
                  <Navbar />
                  <OrganizationPage />
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
