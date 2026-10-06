import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Search, MapPin, Clock, Users, LogIn, UserPlus, Lock, RefreshCw, X } from 'lucide-react';
import api from '../api/client';
import ModalShell from '../components/ModalShell';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import { rememberPublicEvent } from '../utils/publicConfig';
import BrandLogo from '../components/BrandLogo';   // Phase 37
import { APP_NAME, BOARD_NAME } from '../brand';    // Phase 37

const REFRESH_MS = 60000;

/**
 * Phase 36: the public event board. It is the home page (/) for people who aren't signed in when
 * PUBLIC_EVENT_BOARD is on (App.jsx decides). It needs no sign-in and shows only what
 * GET /api/public/board returns: event name, date and time, venue name, city, positions and open spots.
 * Pay, the address and the details need a worker account, so every card leads to sign-up.
 * Props: config ({ public_board, self_registration })
 */
export default function PublicBoardPage({ config }) {
  const navigate = useNavigate();
  const canRegister = !!config?.self_registration;
  const [events, setEvents] = useState(null);       // null = first load
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [picked, setPicked] = useState(null);       // the event someone tapped

  const load = useCallback(async () => {
    try {
      const res = await api.get('/public/board');
      setEvents(res.data?.events || []);
      setError('');
    } catch (err) {
      setError('Shifts couldn’t be loaded. Check your connection and try again.');
      setEvents((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const cities = useMemo(
    () => [...new Set((events || []).map((e) => e.city).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (events || []).filter((e) => {
      if (openOnly && e.full) return false;
      if (city && e.city !== city) return false;
      if (!needle) return true;
      const text = [e.title, e.venue_name, e.city, ...e.positions.map((p) => p.name)].filter(Boolean).join(' ').toLowerCase();
      return text.includes(needle);
    });
  }, [events, q, city, openOnly]);

  // one section per day, in each event's own time zone
  const days = useMemo(() => {
    const out = [];
    shown.forEach((e) => {
      const label = fmtLongDate(e.start_time, e.timezone);
      const last = out[out.length - 1];
      if (last && last.label === label) last.events.push(e);
      else out.push({ label, events: [e] });
    });
    return out;
  }, [shown]);

  const goSignIn = (mode) => {
    if (picked) rememberPublicEvent(picked.event_id);
    navigate('/login', mode === 'register' ? { state: { mode: 'register' } } : undefined);
  };

  const totalOpen = shown.reduce((n, e) => n + (e.open_spots || 0), 0);
  const filtered = !!(q.trim() || city || openOnly);
  const field = 'bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-black border-b border-brand-500/25 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <BrandLogo />
          <button type="button" onClick={() => { setPicked(null); navigate('/login'); }}
            className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
            <LogIn className="w-4 h-4" />
            {canRegister ? (
              <>
                <span className="sm:hidden">Sign in / up</span>
                <span className="hidden sm:inline">Sign in / Sign up</span>
              </>
            ) : 'Sign in'}
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{BOARD_NAME}</h1>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            Open shifts posted by venues on {APP_NAME}.{' '}
            {canRegister
              ? 'Create a free worker account to see the pay and the full details, and to book.'
              : 'Sign in to see the pay and the full details, and to book.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search shifts</span>
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by event, venue, city or position"
              className={`${field} w-full pl-9 pr-3 py-2.5`} />
          </label>
          {cities.length > 1 && (
            <label>
              <span className="sr-only">City</span>
              <select value={city} onChange={(e) => setCity(e.target.value)} className={`${field} w-full sm:w-auto px-3 py-2.5`}>
                <option value="">All cities</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-sm text-slate-300 cursor-pointer select-none">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-brand-500" />
            Open spots only
          </label>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-sm text-rose-200 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs font-bold underline"><RefreshCw className="w-3.5 h-3.5" /> Try again</button>
          </div>
        )}

        {events === null && !error && (
          <p className="py-16 text-center text-sm text-slate-500">Loading open shifts…</p>
        )}

        {events !== null && shown.length === 0 && !error && (
          <div className="py-16 text-center border border-dashed border-slate-800 rounded-2xl">
            <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">
              {filtered ? 'No shifts match that.' : 'No shifts are posted right now.'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {filtered ? 'Try a different search.' : 'Check back soon. New shifts are posted all the time.'}
            </p>
            {filtered && (
              <button type="button" onClick={() => { setQ(''); setCity(''); setOpenOnly(false); }}
                className="mt-3 text-xs font-bold text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Clear the search
              </button>
            )}
          </div>
        )}

        {shown.length > 0 && (
          <p className="text-xs text-slate-500">
            {shown.length} event{shown.length === 1 ? '' : 's'} · {totalOpen} open spot{totalOpen === 1 ? '' : 's'}
          </p>
        )}

        {days.map((day) => (
          <section key={day.label} aria-label={day.label} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 sticky top-16 bg-slate-950/95 backdrop-blur py-2 z-10">{day.label}</h2>
            <ul className="space-y-2">
              {day.events.map((e) => (
                <li key={e.event_id}>
                  <button type="button" onClick={() => setPicked(e)}
                    className={`w-full text-left p-4 rounded-2xl border bg-slate-900 hover:border-brand-500/50 focus:outline-none focus:border-brand-500 transition flex flex-col sm:flex-row sm:items-center gap-3 ${
                      e.full ? 'border-slate-800 opacity-75' : 'border-slate-700'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-brand-300 inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {fmtTimeRange(e.start_time, e.end_time, e.timezone)}
                      </p>
                      <h3 className="text-base font-bold text-white truncate mt-0.5">{e.title}</h3>
                      <p className="text-sm text-slate-400 flex flex-wrap items-center gap-x-1.5">
                        <span className="font-medium text-slate-300">{e.venue_name}</span>
                        {e.city && (
                          <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><MapPin className="w-3.5 h-3.5" />{e.city}</span>
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {e.positions.map((p) => (
                          <span key={p.name}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                              p.open_spots > 0 ? 'bg-brand-500/10 text-brand-200 border-brand-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                            {p.name} · {p.open_spots > 0 ? `${p.open_spots} open` : 'full'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 flex-shrink-0">
                      <span className={`text-sm font-bold inline-flex items-center gap-1 ${e.full ? 'text-slate-500' : 'text-amber-300'}`}>
                        <Users className="w-4 h-4" /> {e.full ? 'Full' : `${e.open_spots} open spot${e.open_spots === 1 ? '' : 's'}`}
                      </span>
                      <span className="text-xs font-bold text-brand-400 inline-flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" /> {e.full ? 'Sign in to join the waitlist' : 'Sign in to see pay & book'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-500 px-4">
        Run a venue? <button type="button" onClick={() => navigate('/login')} className="font-semibold text-slate-300 hover:text-white underline">Sign in</button> to post and manage your shifts.
      </footer>

      {picked && (
        <ModalShell
          title={picked.title}
          subtitle={`${picked.venue_name}${picked.city ? ` · ${picked.city}` : ''} · ${fmtLongDate(picked.start_time, picked.timezone)}, ${fmtTimeRange(picked.start_time, picked.end_time, picked.timezone)}`}
          icon={<Lock className="w-5 h-5 text-brand-400" />}
          onClose={() => setPicked(null)}
          maxWidth="max-w-md"
          footer={(
            <>
              <button type="button" onClick={() => goSignIn('signin')}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-200 inline-flex items-center gap-1.5">
                <LogIn className="w-4 h-4" /> {canRegister ? 'I have an account' : 'Sign in'}
              </button>
              {canRegister && (
                <button type="button" onClick={() => goSignIn('register')}
                  className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-sm font-bold text-slate-950 inline-flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" /> Create a free account
                </button>
              )}
            </>
          )}
        >
          <p className="text-sm text-slate-300">
            {canRegister ? 'Create a free worker account' : 'Sign in'} to see this shift’s <strong className="text-white">pay</strong>,{' '}
            <strong className="text-white">address</strong> and <strong className="text-white">full details</strong>,
            and to {picked.full ? 'join its waitlist' : 'book it'}.
          </p>
          <ul className="mt-3 space-y-1">
            {picked.positions.map((p) => (
              <li key={p.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-200">{p.name}</span>
                <span className={p.open_spots > 0 ? 'text-brand-300 font-semibold' : 'text-slate-500'}>
                  {p.open_spots > 0 ? `${p.open_spots} open` : 'full'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">We’ll bring you straight back to this shift after you sign in.</p>
        </ModalShell>
      )}
    </div>
  );
}
