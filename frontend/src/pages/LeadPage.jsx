import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Check, AlertCircle, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import TonightBoard from '../components/manager/TonightBoard';
import ShiftBoardModal from '../components/ShiftBoardModal';
import LeadTimesModal from '../components/lead/LeadTimesModal';

const VENUE_KEY = 'shiftboard_lead_venue_id';

/**
 * Phase 36: the shift lead's page (/lead). A shift lead is a worker a manager marked "shift lead"
 * on the venue's Team page. Here they run the floor for that venue:
 *   the Today board (who's booked, in, late), clock someone in, mark a no-show, fix clock times,
 *   message a shift (and send it to everyone booked), and fill an open spot from the team.
 * There is no pay anywhere on this page, and nothing here reads a manager endpoint that has pay in it.
 */
export default function LeadPage() {
  const { user } = useAuth();
  const [venues, setVenues] = useState(null);          // null = loading
  const [venueId, setVenueId] = useState('');
  const [boardShift, setBoardShift] = useState(null);  // { id, title, role_type }
  const [timesEventId, setTimesEventId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState(null);          // { type, message }

  useEffect(() => {
    let active = true;
    api
      .get('/lead/venues')
      .then((res) => {
        if (!active) return;
        const list = res.data || [];
        setVenues(list);
        let saved = '';
        try { saved = localStorage.getItem(VENUE_KEY) || ''; } catch (e) { /* private mode */ }
        setVenueId(list.some((v) => v.venue_id === saved) ? saved : (list[0]?.venue_id || ''));
      })
      .catch(() => active && setVenues([]));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const pickVenue = (id) => {
    setVenueId(id);
    try { localStorage.setItem(VENUE_KEY, id); } catch (e) { /* private mode */ }
  };

  const venue = (venues || []).find((v) => v.venue_id === venueId) || null;

  if (venues === null) {
    return <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-10 text-sm text-slate-500">Loading…</main>;
  }

  if (venues.length === 0) {
    return (
      <main className="max-w-xl mx-auto w-full px-4 mt-16 text-center">
        <ClipboardCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-white">You’re not a shift lead right now</h1>
        <p className="mt-2 text-sm text-slate-400">
          A venue’s manager makes someone a shift lead from their Team page. When they do, this page shows who’s on today.
        </p>
        <Link to="/worker" className="mt-5 inline-block px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">Back to my shifts</Link>
      </main>
    );
  }

  return (
    <>
      <section className="bg-slate-900/50 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-amber-300" /> Shift lead
            </h1>
            <p className="text-sm text-slate-400 truncate">
              {venue ? venue.name : ''} · {user?.first_name}, you can clock people in and out, mark no-shows, message shifts and fill open spots.
            </p>
          </div>
          {venues.length > 1 && (
            <label className="text-xs text-slate-400">
              Venue
              <select value={venueId} onChange={(e) => pickVenue(e.target.value)}
                className="block mt-0.5 bg-slate-900 border border-slate-700 text-white text-sm font-semibold rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500">
                {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6 space-y-4">
        {notice && (
          <div role="status" className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'error' ? 'bg-rose-950/80 border-rose-700 text-rose-200' : 'bg-emerald-950/80 border-emerald-700 text-emerald-200'}`}>
            <span className="inline-flex items-start gap-2">
              {notice.type === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {notice.message}
            </span>
            <button type="button" aria-label="Hide" onClick={() => setNotice(null)} className="p-0.5 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
          </div>
        )}

        {venue && (
          <TonightBoard
            key={venue.venue_id}
            venueId={venue.venue_id}
            timeZone={venue.timezone}
            refreshKey={refreshKey}
            reliabilityMap={null}
            tonightPath={`/lead/venues/${venue.venue_id}/tonight`}
            timesLabel="Clock times"
            onOpenBoard={(shift) => setBoardShift(shift)}
            onTimesheet={(eventId) => setTimesEventId(eventId)}
            onChanged={(message) => message && setNotice({ type: 'success', message })}
          />
        )}

        <p className="text-xs text-slate-500">
          Pay, tips, approving requests, the team list and posting shifts stay with the venue’s managers.
        </p>
      </main>

      {timesEventId && venue && (
        <LeadTimesModal
          eventId={timesEventId}
          timeZone={venue.timezone}
          onClose={() => setTimesEventId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {boardShift && (
        <ShiftBoardModal
          shiftId={boardShift.id}
          shiftTitle={`${boardShift.title} (${boardShift.role_type})`}
          currentUserRole={user?.role}
          canNotify
          onClose={() => setBoardShift(null)}
        />
      )}
    </>
  );
}
