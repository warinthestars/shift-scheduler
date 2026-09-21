import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import WorkerDashboard from './pages/WorkerDashboard';
import AdminPanel from './pages/AdminPanel';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 flex flex-col font-sans">
          <Routes>
            {/* Public Login & Register */}
            <Route path="/login" element={<LoginPage />} />

            {/* Worker Dashboard (Default Home) */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Navbar />
                  <WorkerDashboard />
                </ProtectedRoute>
              }
            />

            {/* Super Admin Control Panel */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute requiredRole="platform_admin">
                  <Navbar />
                  <AdminPanel />
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
