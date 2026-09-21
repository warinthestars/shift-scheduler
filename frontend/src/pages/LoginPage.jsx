import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Calendar, Shield, UserCheck, AlertCircle, ArrowRight, Building2 } from 'lucide-react';

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('worker');
  const [skills, setSkills] = useState('Bartender, Server');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { login, loginWithGoogleMock, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname;

  const navigateToRoleRoute = (userSession) => {
    const userRole = (userSession?.role || '').toLowerCase();
    const defaultRoute =
      userRole === 'platform_admin'
        ? '/admin'
        : userRole === 'venue_manager'
        ? '/venue'
        : '/worker';
    const target = from && from !== '/' ? from : defaultRoute;
    navigate(target, { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      let userSession;
      if (isRegister) {
        userSession = await register({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          role,
          skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        });
      } else {
        userSession = await login(email, password);
      }
      navigateToRoleRoute(userSession);
    } catch (err) {
      setError(err.response?.data?.detail || 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleDemo = async () => {
    setError('');
    setSubmitting(true);
    try {
      const userSession = await loginWithGoogleMock();
      navigateToRoleRoute(userSession);
    } catch (err) {
      setError(err.response?.data?.detail || 'Google Mock Auth failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillAdminCredentials = () => {
    setEmail('demo_admin@shiftboard.com');
    setPassword('SuperSecretDemo123!');
    setIsRegister(false);
    setError('');
  };

  const fillManagerCredentials = () => {
    setEmail('demo_manager@shiftboard.com');
    setPassword('DemoManager123!');
    setIsRegister(false);
    setError('');
  };

  const fillWorkerCredentials = () => {
    setEmail('demo_worker@shiftboard.com');
    setPassword('DemoWorker123!');
    setIsRegister(false);
    setError('');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-4">
          <Calendar className="w-8 h-8 text-slate-950 font-black" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Shift<span className="text-emerald-400">Board</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Hospitality Call-Board & Shift Scheduling Platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {/* Quick Demo Pre-fill Shortcuts */}
          <div className="mb-6 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
            <div className="font-semibold text-slate-300 mb-2 flex items-center space-x-1">
              <span>⚡ Quick Demo Credentials:</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={fillAdminCredentials}
                className="px-2 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 font-medium transition text-left flex items-center space-x-1"
                title="Super Admin (platform_admin)"
              >
                <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">Admin</span>
              </button>
              <button
                type="button"
                onClick={fillManagerCredentials}
                className="px-2 py-1.5 rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-700/50 text-teal-300 font-medium transition text-left flex items-center space-x-1"
                title="Venue Manager (venue_manager)"
              >
                <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">Manager</span>
              </button>
              <button
                type="button"
                onClick={fillWorkerCredentials}
                className="px-2 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300 font-medium transition text-left flex items-center space-x-1"
                title="Demo Worker (worker)"
              >
                <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">Worker</span>
              </button>
            </div>
          </div>

          {/* Distinct Sign in with Google (Demo Mocked) Button */}
          <button
            type="button"
            onClick={handleGoogleDemo}
            disabled={submitting}
            className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 text-sm font-semibold text-white shadow-sm transition hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-6 group"
          >
            {/* Google G SVG */}
            <svg className="w-4 h-4 mr-2.5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Sign in with Google (Demo)</span>
            <span className="ml-2 text-xs text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">Mocked</span>
          </button>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-3 text-slate-500 font-medium tracking-wider">
                Or continue with local email
              </span>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">First Name</label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Last Name</label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                      placeholder="Doe"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Skills (comma-separated)</label>
                  <input
                    type="text"
                    value={skills}
                    onChange={(e) => setSkills(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="Bartender, Server, Barback"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="worker">Worker (Shift Seeker)</option>
                    <option value="venue_manager">Venue Manager</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                placeholder="name@shiftboard.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                placeholder="••••••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 flex items-center justify-center py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-slate-950 text-sm shadow-lg shadow-emerald-500/20 transition focus:outline-none disabled:opacity-50"
            >
              <span>{submitting ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
              }}
              className="text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
            >
              {isRegister ? 'Already have an account? Sign In' : "Don't have an account? Register as Worker"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
