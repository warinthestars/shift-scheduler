import React from 'react';
import { Star } from 'lucide-react';

/**
 * Phase 29: A worker's rating. Shows "New" until they have a real rating (rating_count 0),
 * instead of the old default ★ 5.0.
 */
export default function RatingBadge({ rating, count, showCount = true, className = '' }) {
  const n = Number(count || 0);
  if (!n) {
    return (
      <span
        title="No ratings yet"
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 whitespace-nowrap ${className}`}
      >
        New
      </span>
    );
  }
  return (
    <span
      title={`${Number(rating || 0).toFixed(2)} average from ${n} rating${n === 1 ? '' : 's'}`}
      className={`inline-flex items-center gap-1 text-amber-400 text-xs font-bold whitespace-nowrap ${className}`}
    >
      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
      {Number(rating || 0).toFixed(1)}
      {showCount && <span className="text-amber-500/70 font-semibold">({n})</span>}
    </span>
  );
}
