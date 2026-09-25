import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, MapPin, Search, Calendar, ChevronRight, DollarSign } from 'lucide-react';
import api from '../api/client';
import { fmtDate, fmtTime } from '../utils/venueTime';

function VenueAvatar({ venue, size = 'w-14 h-14' }) {
  if (venue.logo_url) {
    return <img src={venue.logo_url} alt="" className={`${size} rounded-2xl object-cover border border-slate-700 flex-shrink-0`} />;
  }
  return (
    <div className={`${size} rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950 font-black text-xl flex-shrink-0`}>
      {(venue.name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

export { VenueAvatar };

export default function VenuesDirectory() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .get('/venues/directory')
      .then((res) => setVenues(res.data || []))
      .catch((err) => setError(err.response?.data?.detail || 'Could not load venues.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) => v.name.toLowerCase().includes(q) || (v.address || '').toLowerCase().includes(q)
    );
  }, [venues, query]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Building2 className="w-7 h-7 text-amber-400" /> Venues
          </h1>
          <p className="text-sm text-slate-400 mt-1">See who's posting shifts, what they pay, and what they've posted before.</p>
          <div className="mt-5 relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or neighborhood"
              className="w-full pl-9 pr-3 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
        )}
        {loading ? (
          <p className="text-center text-sm text-slate-500 py-16">Loading venues…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-16">No venues match your search.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((v) => (
              <Link
                key={v.id}
                to={`/venues/${v.id}`}
                className="group bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-2xl p-5 flex gap-4 transition"
              >
                <VenueAvatar venue={v} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-bold text-white truncate">{v.name}</h2>
                    <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-slate-300 flex-shrink-0" />
                  </div>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{v.address}</span>
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {v.open_spots > 0 ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {v.open_spots} open spot{v.open_spots === 1 ? '' : 's'}
                      </span>
                    ) : v.upcoming_shift_count > 0 ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        Fully booked
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-500 border border-slate-700">
                        No upcoming shifts
                      </span>
                    )}
                    {v.show_rates_publicly && v.rate_min != null && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700 inline-flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-emerald-400" />
                        {v.rate_min === v.rate_max
                          ? `${v.rate_min.toFixed(0)}/hr`
                          : `${v.rate_min.toFixed(0)}–${v.rate_max.toFixed(0)}/hr`}
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {v.next_shift_start && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Next: {fmtDate(v.next_shift_start, v.timezone)} · {fmtTime(v.next_shift_start, v.timezone)}
                      </span>
                    )}
                    <span>{v.total_shifts_posted} shift{v.total_shifts_posted === 1 ? '' : 's'} posted</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
