import React, { useState } from 'react';
import { Star, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react';
import api from '../api/client';

/**
 * Phase 29: Rate one finished booking (1-5 stars + "Would book again?").
 * Ratings are private to the venue's managers; only the worker's average is shown elsewhere.
 * Props: venueId, person (RosterPerson), onSaved(result)
 */
export default function RateWorker({ venueId, person, onSaved }) {
  const [stars, setStars] = useState(person.my_rating || 0);
  const [hover, setHover] = useState(0);
  const [again, setAgain] = useState(person.would_book_again ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (nextStars, nextAgain) => {
    if (!nextStars) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/venues/${venueId}/ratings/${person.request_id}`, {
        rating: nextStars,
        would_book_again: nextAgain,
      });
      if (onSaved) onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save the rating.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.delete(`/venues/${venueId}/ratings/${person.request_id}`);
      setStars(0);
      setAgain(null);
      if (onSaved) onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove the rating.');
    } finally {
      setSaving(false);
    }
  };

  const pickStars = (n) => {
    setStars(n);
    save(n, again);
  };
  const pickAgain = (v) => {
    const next = again === v ? null : v;
    setAgain(next);
    if (stars) save(stars, next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-800">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rate</span>
      <div className="flex items-center" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={saving}
            onMouseEnter={() => setHover(n)}
            onClick={() => pickStars(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className="p-0.5 disabled:opacity-50"
          >
            <Star className={`w-4 h-4 ${(hover || stars) >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
          </button>
        ))}
      </div>
      <span className="text-[11px] text-slate-400">Would book again?</span>
      <button
        type="button"
        disabled={saving || !stars}
        onClick={() => pickAgain(true)}
        title={stars ? 'Yes' : 'Pick stars first'}
        className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 disabled:opacity-40 ${
          again === true ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}
      >
        <ThumbsUp className="w-3 h-3" /> Yes
      </button>
      <button
        type="button"
        disabled={saving || !stars}
        onClick={() => pickAgain(false)}
        title={stars ? 'No' : 'Pick stars first'}
        className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 disabled:opacity-40 ${
          again === false ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}
      >
        <ThumbsDown className="w-3 h-3" /> No
      </button>
      {person.my_rating && (
        <button type="button" onClick={clear} disabled={saving} title="Remove rating"
          className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      {saving && <span className="text-[10px] text-slate-500">Saving…</span>}
      {error && <span className="text-[11px] text-rose-400">{error}</span>}
    </div>
  );
}
