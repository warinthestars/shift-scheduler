import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Phone, ExternalLink, Info, Users, Calendar, Clock, Building2, Check, AlertCircle,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import TipBadge from '../components/TipBadge';
import { VenueAvatar } from './VenuesDirectory';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

const MY_STATUS = {
  pending: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  pending_manager_approval: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  approved: { label: "You're booked", cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: "You're booked", cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Worked', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  rejected: { label: 'Not selected', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  dropped: { label: 'Released', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  transferred: { label: 'Handed off', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
};

export default function VenueProfile() {
  const { venueId } = useParams();
  const { user } = useAuth();
  const isWorker = (user?.role || '').toLowerCase() === 'worker';

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('upcoming');
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [requestingId, setRequestingId] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .get(`/venues/${venueId}/profile`)
      .then((res) => setProfile(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Could not load this venue.'))
      .finally(() => setLoading(false));
  }, [venueId, refreshKey]);

  const loadEvents = useCallback(() => {
    setEventsLoading(true);
    api
      .get(`/venues/${venueId}/public-events`, { params: { scope } })
      .then((res) => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [venueId, scope]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents, refreshKey]);

  const handleRequest = async (shiftId) => {
    setRequestingId(shiftId);
    setNotice(null);
    try {
      const res = await api.post(`/shifts/${shiftId}/request`);
      const st = String(res.data?.status || '').toLowerCase();
      setNotice({
        type: 'success',
        message: st === 'approved' ? "You're booked! It's on your schedule." : 'Request sent. The manager will review it.',
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.detail || 'Could not request this shift.' });
    } finally {
      setRequestingId(null);
    }
  };

  if (loading && !profile) {
    return <div className="min-h-screen bg-slate-950 text-slate-500 text-sm text-center py-24">Loading venue…</div>;
  }
  if (error || !profile) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <Link to="/venues" className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> All venues
        </Link>
        <p className="mt-8 text-center text-rose-400">{error || 'Venue not found.'}</p>
      </div>
    );
  }

  const tz = profile.timezone;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    profile.lat && profile.lng ? `${profile.lat},${profile.lng}` : profile.address
  )}`;
  const fillPct =
    profile.spots_posted_last_90_days > 0
      ? Math.round((profile.spots_filled_last_90_days / profile.spots_posted_last_90_days) * 100)
      : null;
  const ratesVisible = profile.positions.some((p) => p.default_rate != null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <Link to="/venues" className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-1 mb-4">
            <ArrowLeft className="w-4 h-4" /> All venues
          </Link>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <VenueAvatar venue={profile} size="w-16 h-16" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black text-white">{profile.name}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-400">
                <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-emerald-400">
                  <MapPin className="w-4 h-4" /> {profile.address} <ExternalLink className="w-3 h-3" />
                </a>
                {profile.phone && (
                  <a href={`tel:${profile.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                    <Phone className="w-4 h-4" /> {profile.phone}
                  </a>
                )}
              </div>
            </div>
            {profile.can_manage && (
              <Link
                to="/venue"
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold text-slate-200 inline-flex items-center gap-2 self-start"
              >
                <Building2 className="w-4 h-4 text-amber-400" /> Manage venue
              </Link>
            )}
          </div>
          {profile.description && <p className="text-sm text-slate-300 mt-4 max-w-3xl">{profile.description}</p>}

          <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-5">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xl font-black text-white">{profile.events_last_90_days}</div>
              <div className="text-[11px] text-slate-400">events in the last 90 days</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xl font-black text-white">{fillPct == null ? '—' : `${fillPct}%`}</div>
              <div className="text-[11px] text-slate-400">of spots filled</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xl font-black text-white">{profile.workers_booked_all_time}</div>
              <div className="text-[11px] text-slate-400">people have worked here</div>
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {notice && (
          <div
            className={`p-3 rounded-xl border text-sm flex items-center gap-2 ${
              notice.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            {notice.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {notice.message}
          </div>
        )}

        {(profile.dress_code || profile.arrival_instructions) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profile.dress_code && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Dress code</div>
                <p className="text-sm text-slate-200 whitespace-pre-line">{profile.dress_code}</p>
              </div>
            )}
            {profile.arrival_instructions && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Arrival instructions</div>
                <p className="text-sm text-slate-200 whitespace-pre-line">{profile.arrival_instructions}</p>
                {!profile.can_manage && (
                  <p className="text-[11px] text-slate-500 mt-2">Shown to you because you've been booked here.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Positions{ratesVisible ? ' & usual pay' : ''}</div>
          {profile.positions.length === 0 ? (
            <p className="text-sm text-slate-500">No positions listed yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {profile.positions.map((p) => (
                <div key={p.name} className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{p.name}</span>
                  {p.default_rate != null && <span className="text-sm text-emerald-400 font-bold">${p.default_rate.toFixed(2)}/hr</span>}
                  <TipBadge shift={p} />
                </div>
              ))}
            </div>
          )}
          {!profile.show_rates_publicly && (
            <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              {profile.can_manage
                ? 'Default rates are hidden from workers (Venue Settings). Pay still shows on each posted shift.'
                : 'This venue shows pay on each posted shift instead.'}
            </p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" /> Shifts
            </h2>
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 self-start">
              {[
                { id: 'upcoming', label: 'Upcoming' },
                { id: 'past', label: 'Past 90 days' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScope(s.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                    scope === s.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {eventsLoading && events.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">Loading shifts…</p>
          ) : events.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">
              {scope === 'upcoming' ? 'No upcoming shifts posted right now.' : 'No shifts in the last 90 days.'}
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((ev) => (
                <div key={ev.event_key} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <div className="text-sm font-bold text-white">{ev.title}</div>
                      <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3">
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(ev.start_time, tz)}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtTimeRange(ev.start_time, ev.end_time, tz)}</span>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> {ev.total_filled}/{ev.total_capacity} staffed
                    </span>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {ev.positions.map((p) => {
                      const mine = p.my_status ? MY_STATUS[p.my_status] : null;
                      const canRequest =
                        scope === 'upcoming' && isWorker && !p.my_status && p.status === 'OPEN' && p.spots_left > 0;
                      return (
                        <div key={p.shift_id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{p.role_type}</span>
                            <span className="text-sm text-emerald-400 font-semibold">${p.hourly_rate.toFixed(2)}/hr</span>
                            <TipBadge shift={p} />
                            <span className="text-xs text-slate-400">{p.filled}/{p.capacity} filled</span>
                          </div>
                          <div>
                            {mine ? (
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mine.cls}`}>{mine.label}</span>
                            ) : canRequest ? (
                              <button
                                type="button"
                                onClick={() => handleRequest(p.shift_id)}
                                disabled={requestingId === p.shift_id}
                                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-50"
                              >
                                {requestingId === p.shift_id ? 'Sending…' : 'Pick up shift'}
                              </button>
                            ) : scope === 'upcoming' && p.spots_left === 0 ? (
                              <span className="text-xs text-slate-500">Full</span>
                            ) : scope === 'past' ? (
                              <span className={`text-xs ${p.filled >= p.capacity ? 'text-emerald-400' : 'text-slate-500'}`}>
                                {p.filled >= p.capacity ? 'Fully staffed' : 'Partly staffed'}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
