import React from 'react';

export default function TipBadge({ shift }) {
  if (!shift?.tips_eligible) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
      {shift.tip_pool ? '+ Tips (Pooled)' : '+ Tips'}
    </span>
  );
}
