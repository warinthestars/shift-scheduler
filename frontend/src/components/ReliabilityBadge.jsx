import React from 'react';

/**
 * Reliability across all venues. Phase 29.1: with no finished shifts yet it shows a muted
 * "No history" (it used to say "New", which doubled up with the rating's "New" badge).
 */
export default function ReliabilityBadge({ data }) {
  if (!data || data.score === null || data.score === undefined) {
    return (
      <span
        title="No finished shifts yet, so there's no reliability score"
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-slate-500 border border-slate-700/60 whitespace-nowrap"
      >
        No history
      </span>
    );
  }
  const score = Number(data.score);
  const tone =
    score >= 90
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : score >= 75
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  const tooltip = `${data.completed} completed · ${data.late} late · ${data.no_show} no-show · ${data.late_drop} late drop`;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${tone}`}
    >
      {score.toFixed(0)}% reliable
    </span>
  );
}
