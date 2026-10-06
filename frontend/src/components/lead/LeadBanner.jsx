import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ChevronRight } from 'lucide-react';
import api from '../../api/client';

/**
 * Phase 36: on the worker page, a slim banner for people who are a shift lead somewhere.
 * It is the way into the Lead view on a phone (the bottom tab bar has no room for it).
 * Shows nothing for everyone else.
 */
export default function LeadBanner() {
  const [venues, setVenues] = useState([]);

  useEffect(() => {
    let active = true;
    api
      .get('/lead/venues')
      .then((res) => {
        if (active) setVenues(res.data || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (venues.length === 0) return null;
  const names = venues.map((v) => v.name);
  const where = names.length > 2 ? `${names.length} venues` : names.join(' and ');

  return (
    <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
      <ClipboardCheck className="w-5 h-5 text-amber-300 flex-shrink-0" />
      <p className="flex-1 min-w-0 text-xs text-amber-100">
        <b className="text-amber-200">You’re a shift lead at {where}.</b> See who’s on today, clock people in and out, and fill open spots.
      </p>
      <Link to="/lead" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-0.5 whitespace-nowrap">
        Open Lead <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
