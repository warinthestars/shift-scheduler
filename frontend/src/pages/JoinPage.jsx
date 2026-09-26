import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Calendar, Building2, MapPin, Check, AlertTriangle, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export const PENDING_INVITE_KEY = 'shiftboard_pending_invite';

function remember(token) {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, token);
  } catch (e) {
    /* storage blocked: the router state still carries the invite */
  }
}
function forget() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Phase 29: /join/:token (team link, QR code or personal invite).
 * Signed out -> preview + Create account / Sign in (returns here afterwards).
 * Signed in as a worker -> joins automatically.
 */
export default function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [invite, setInvite] = useState(null);
  const [state, setState] = useState('loading'); // loading | preview | joining | joined | error
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(null);
  const tried = useRef(false);
  const role = (user?.role || '').toLowerCase();

  useEffect(() => {
    let active = true;
    api
      .get(`/invites/${token}`)
      .then((res) => {
        if (!active) return;
        setInvite(res.data);
        if (res.data.valid) remember(token);
        else forget();
        setState('preview');
      })
      .catch(() => {
        if (!active) return;
        setError('Could not load this invite. Check your connection and try again.');
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [token]);

  // A manager/admin opened a worker invite: don't keep bouncing them back here
  useEffect(() => {
    if (!loading && isAuthenticated && role !== 'worker') forget();
  }, [loading, isAuthenticated, role]);

  useEffect(() => {
    if (loading || !isAuthenticated || role !== 'worker' || !invite?.valid || tried.current) return;
    tried.current = true;
    setState('joining');
    api
      .post(`/invites/${token}/accept`)
      .then((res) => {
        forget();
        setJoined(res.data);
        setState('joined');
      })
      .catch((err) => {
        forget();
        setError(err.response?.data?.detail || 'Could not join the team.');
        setState('error');
      });
  }, [loading, isAuthenticated, role, invite, token]);

  const goLogin = (mode) =>
    navigate('/login', {
      state: { from: { pathname: `/join/${token}` }, mode, inviteVenue: invite?.venue_name || null },
    });

  const shell = (children) => (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 px-4 text-slate-100">
      <div className="text-center mb-6">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-3">
          <Calendar className="w-7 h-7 text-slate-950" />
        </div>
        <h1 className="text-2xl font-extrabold text-white">
          Shift<span className="text-emerald-400">Board</span>
        </h1>
      </div>
      <div className="w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">{children}</div>
    </div>
  );

  if (state === 'loading' || loading) return shell(<p className="text-sm text-slate-400 text-center">Loading invite…</p>);

  if (state === 'error' && !invite?.valid && !joined) {
    return shell(
      <>
        <div className="flex items-start gap-2 text-rose-200 text-sm"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error || invite?.reason}</div>
        <Link to="/" className="block text-center text-sm text-emerald-400 hover:underline">Go to ShiftBoard</Link>
      </>
    );
  }

  const venueHeader = invite?.venue_name && (
    <div className="flex items-center gap-3">
      {invite.logo_url ? (
        <img src={invite.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover bg-slate-800" />
      ) : (
        <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950">
          <Building2 className="w-6 h-6" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-lg font-bold text-white truncate">{invite.venue_name}</div>
        {invite.venue_address && (
          <div className="text-xs text-slate-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {invite.venue_address}</div>
        )}
      </div>
    </div>
  );

  if (!invite?.valid && state !== 'joined') {
    return shell(
      <>
        {venueHeader}
        <div className="flex items-start gap-2 text-amber-200 text-sm"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {invite?.reason}</div>
        <Link to="/" className="block text-center text-sm text-emerald-400 hover:underline">Go to ShiftBoard</Link>
      </>
    );
  }

  if (state === 'joined') {
    return shell(
      <>
        {venueHeader}
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-100 text-sm flex items-start gap-2">
          <Check className="w-5 h-5 flex-shrink-0" />
          {joined?.already_member ? `You're already on the ${joined.venue_name} team.` : `You're on the ${joined?.venue_name} team.`}
          {' '}You'll see their shifts in Find Shifts and get alerts when they post new ones.
        </div>
        <button type="button" onClick={() => navigate('/worker', { replace: true })}
          className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm">
          See open shifts
        </button>
      </>
    );
  }

  if (state === 'error') {
    return shell(
      <>
        {venueHeader}
        <div className="flex items-start gap-2 text-rose-200 text-sm"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}</div>
        <Link to="/" className="block text-center text-sm text-emerald-400 hover:underline">Go to ShiftBoard</Link>
      </>
    );
  }

  if (isAuthenticated && role !== 'worker') {
    return shell(
      <>
        {venueHeader}
        <p className="text-sm text-slate-300">
          You're signed in as <strong>{user?.email}</strong>, which is a {role === 'venue_manager' ? 'manager' : 'admin'} account.
          Team invites are for worker accounts. Sign out, then open this link again to sign in or create a worker account.
        </p>
        <button type="button" onClick={() => logout()}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </>
    );
  }

  if (state === 'joining') return shell(<>{venueHeader}<p className="text-sm text-slate-400">Joining the team…</p></>);

  return shell(
    <>
      {venueHeader}
      <p className="text-sm text-slate-200">
        {invite.first_name ? `Hi ${invite.first_name}! ` : ''}You're invited to join the <strong>{invite.venue_name}</strong> team on ShiftBoard:
        see their shifts, book them from your phone and get reminders.
      </p>
      {invite.positions?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {invite.positions.map((p) => (
            <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p}</span>
          ))}
        </div>
      )}
      <button type="button" onClick={() => goLogin('register')}
        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm">
        Create my account
      </button>
      <button type="button" onClick={() => goLogin('signin')}
        className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm">
        I already have an account
      </button>
      {invite.email && <p className="text-[11px] text-slate-500 text-center">Invite sent to {invite.email}. Use that email if you can.</p>}
    </>
  );
}
