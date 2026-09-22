import React from 'react';

export default function ReliabilityBadge({ data }) {
  if (!data || data.score === null || data.score === undefined) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/40">
        New
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
