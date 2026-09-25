import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Calendar,
  Shield,
  UserCheck,
  AlertCircle,
  ArrowRight,
  Building2,
  LogIn,
  MailCheck,
  Info,
} from 'lucide-react';
import {
  getFirebaseStatus,
  PROVIDER_META,
  signInWithProviderId,
  signInWithEmail,
  registerWithEmail,
  resendVerificationEmail,
  completeEmailVerification,
  sendPasswordReset,
  firebaseSignOut,
} from '../firebase';

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 mr-2.5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

function friendlyError(err, fallback) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is turned off in Firebase.';
    case 'auth/account-exists-with-different-credential':
      return 'You already signed up with a different method for this email. Use that method instead.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return err?.response?.data?.detail || err?.message || fallback;
  }
}

const TITLES = {
  signin: 'Sign in',
  register: 'Create your worker account',
  verify: 'Verify your email',
  reset: 'Reset your password',
};

export default function LoginPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'register' | 'verify' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fbStatus, setFbStatus] = useState({
    enabled: false,
    mock: false,
    config: null,
    providers: [],
    self_registration: false,
    show_demo_logins: false,
  });

  const { login, loginWithGoogleMock, loginWithFirebaseToken, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname;

  useEffect(() => {
    let active = true;
    getFirebaseStatus().then((s) => {
      if (active) setFbStatus(s);
    });
    return () => {
      active = false;
    };
  }, []);

  // ---- Derived availability (driven by what is enabled in Firebase) ----
  const fbReady = fbStatus.enabled && !fbStatus.mock;
  const providers = fbReady ? fbStatus.providers || [] : [];
  const oauthProviders = providers.filter((p) => p !== 'password' && PROVIDER_META[p]);
  const firebasePassword = providers.includes('password');
  const showRegisterForm = !fbReady || firebasePassword;
  const canRegister =
    !!fbStatus.self_registration && (!fbReady || firebasePassword || oauthProviders.length > 0);

  const navigateToRoleRoute = (userSession) => {
    const userRole = (userSession?.role || '').toLowerCase();
    const defaultRoute =
      userRole === 'platform_admin' ? '/admin' : userRole === 'venue_manager' ? '/venue' : '/worker';
    const target = from && from !== '/' ? from : defaultRoute;
    navigate(target, { replace: true });
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  const profilePayload = () => ({
    first_name: firstName.trim() || undefined,
    last_name: lastName.trim() || undefined,
    phone: phone.trim() || undefined,
  });

  // ---- Sign in: local password first (demo/admin-created accounts), then Firebase email/password ----
  const handleSignIn = async () => {
    try {
      const userSession = await login(email, password);
      navigateToRoleRoute(userSession);
      return;
    } catch (err) {
      if (!(firebasePassword && err.response?.status === 401)) throw err;
    }
    const fbUser = await signInWithEmail(email, password);
    if (!fbUser.emailVerified) {
      setMode('verify');
      setError('');
      setInfo(`${email} isn't verified yet. Click the link we emailed you, then press "I've verified my email".`);
      return;
    }
    const idToken = await fbUser.getIdToken();
    const userSession = await loginWithFirebaseToken(idToken);
    navigateToRoleRoute(userSession);
  };

  const handleRegister = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (fbReady && firebasePassword) {
      await registerWithEmail({
        email,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      setMode('verify');
      setError('');
      setInfo(`We sent a verification link to ${email}. Click it, then press "I've verified my email".`);
      return;
    }
    const userSession = await register({
      email,
      password,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
    });
    navigateToRoleRoute(userSession);
  };

  const handleResetRequest = async () => {
    await sendPasswordReset(email);
    setInfo('If an account exists for that email, a password reset link is on its way.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setSubmitting(true);
    try {
      if (mode === 'register') await handleRegister();
      else if (mode === 'reset') await handleResetRequest();
      else await handleSignIn();
    } catch (err) {
      const msg = friendlyError(err, 'Authentication failed. Please check your credentials.');
      if (msg) setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifiedContinue = async () => {
    setError('');
    setSubmitting(true);
    try {
      const idToken = await completeEmailVerification();
      const userSession = await loginWithFirebaseToken(idToken, profilePayload());
      navigateToRoleRoute(userSession);
    } catch (err) {
      const msg = friendlyError(err, 'Could not complete sign-in.');
      if (msg) setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setSubmitting(true);
    try {
      await resendVerificationEmail();
      setInfo('Verification email sent again. Check your inbox (and spam folder).');
    } catch (err) {
      const msg = friendlyError(err, 'Could not resend the email.');
      if (msg) setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToSignIn = async () => {
    await firebaseSignOut().catch(() => {});
    switchMode('signin');
  };

  const handleProvider = async (providerId) => {
    setError('');
    setInfo('');
    setSubmitting(true);
    try {
      const idToken = await signInWithProviderId(providerId);
      const userSession = await loginWithFirebaseToken(idToken);
      navigateToRoleRoute(userSession);
    } catch (err) {
      const msg = friendlyError(err, 'Sign-in failed.');
      if (msg) setError(msg);
      if (err?.response) firebaseSignOut().catch(() => {});
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

  const fillCredentials = (demoEmail, demoPassword) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    switchMode('signin');
  };

  const showOauth = (mode === 'signin' || mode === 'register') && oauthProviders.length > 0;
  const showMockButton = mode === 'signin' && fbStatus.mock;
  const showForm = mode === 'signin' || mode === 'reset' || (mode === 'register' && showRegisterForm);
  const inputClass =
    'w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-4">
          <Calendar className="w-8 h-8 text-slate-950 font-black" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Shift<span className="text-emerald-400">Board</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400">Hospitality Call-Board & Shift Scheduling Platform</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {mode === 'signin' && fbStatus.show_demo_logins && (
            <div className="mb-6 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
              <div className="font-semibold text-slate-300 mb-2">⚡ Quick Demo Credentials:</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_admin@shiftboard.com', 'SuperSecretDemo123!')}
                  className="px-2 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 font-medium transition text-left flex items-center space-x-1"
                  title="Super Admin (platform_admin)"
                >
                  <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_manager@shiftboard.com', 'DemoManager123!')}
                  className="px-2 py-1.5 rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-700/50 text-teal-300 font-medium transition text-left flex items-center space-x-1"
                  title="Venue Manager (venue_manager)"
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Manager</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_worker@shiftboard.com', 'DemoWorker123!')}
                  className="px-2 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300 font-medium transition text-left flex items-center space-x-1"
                  title="Demo Worker (worker)"
                >
                  <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Worker</span>
                </button>
              </div>
            </div>
          )}

          <h3 className="text-lg font-bold text-white mb-4">{TITLES[mode]}</h3>

          {mode === 'register' && (
            <div className="mb-4 p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-slate-300 text-xs flex items-start space-x-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
              <span>New accounts start as Workers. Venue manager and admin accounts are set up by an administrator.</span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-sm flex items-start space-x-2">
              <MailCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

          {mode === 'verify' ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleVerifiedContinue}
                disabled={submitting}
                className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-slate-950 text-sm shadow-lg shadow-emerald-500/20 transition disabled:opacity-50"
              >
                <span>{submitting ? 'Checking…' : "I've verified my email"}</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-200 transition disabled:opacity-50"
              >
                Resend verification email
              </button>
              <button
                type="button"
                onClick={handleBackToSignIn}
                className="w-full text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              {showOauth && (
                <div className="space-y-2 mb-6">
                  {oauthProviders.map((pid) => {
                    const verb = mode === 'register' ? 'Sign up' : 'Continue';
                    const isGoogle = pid === 'google.com';
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => handleProvider(pid)}
                        disabled={submitting}
                        className={
                          isGoogle
                            ? 'w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-white hover:bg-slate-100 text-sm font-semibold text-slate-900 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60'
                            : 'w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60'
                        }
                      >
                        {isGoogle ? <GoogleIcon /> : <LogIn className="w-4 h-4 mr-2.5" />}
                        <span>{`${verb} with ${PROVIDER_META[pid].label}`}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {showMockButton && (
                <button
                  type="button"
                  onClick={handleGoogleDemo}
                  disabled={submitting}
                  className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-6"
                >
                  <GoogleIcon />
                  <span>Sign in with Google (Demo)</span>
                  <span className="ml-2 text-xs text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                    Mocked
                  </span>
                </button>
              )}

              {(showOauth || showMockButton) && showForm && (
                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-800"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-slate-900 px-3 text-slate-500 font-medium tracking-wider">or use email</span>
                  </div>
                </div>
              )}

              {showForm && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {mode === 'register' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">First Name</label>
                          <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} placeholder="Jane" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">Last Name</label>
                          <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} placeholder="Doe" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">Phone (optional)</label>
                        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="555-555-0100" />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Email address</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@example.com" />
                  </div>

                  {mode !== 'reset' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-slate-300">Password</label>
                        {mode === 'signin' && firebasePassword && (
                          <button type="button" onClick={() => switchMode('reset')} className="text-xs text-slate-400 hover:text-emerald-400 transition">
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        required
                        minLength={mode === 'register' ? 8 : undefined}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputClass}
                        placeholder="••••••••••••"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full mt-2 flex items-center justify-center py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-slate-950 text-sm shadow-lg shadow-emerald-500/20 transition focus:outline-none disabled:opacity-50"
                  >
                    <span>
                      {submitting
                        ? 'Please wait...'
                        : mode === 'register'
                        ? 'Create Account'
                        : mode === 'reset'
                        ? 'Send reset link'
                        : 'Sign In'}
                    </span>
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </button>
                </form>
              )}

              {mode === 'register' && !showRegisterForm && oauthProviders.length > 0 && (
                <p className="text-xs text-slate-400 text-center">Choose a sign-up option above.</p>
              )}

              <div className="mt-6 text-center">
                {mode === 'signin' && canRegister && (
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
                  >
                    New here? Create a worker account
                  </button>
                )}
                {(mode === 'register' || mode === 'reset') && (
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
                  >
                    Already have an account? Sign in
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
