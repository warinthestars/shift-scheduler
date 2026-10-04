import React from 'react';
import { CheckCircle2, Users, ArrowRightLeft, AlarmClock, UserPlus, BellRing } from 'lucide-react';

/**
 * Phase 30: One slim strip at the top of the manager dashboard.
 * Everything waiting on the manager, with a tap to jump to it. When nothing is waiting it shrinks
 * to a single "all caught up" line (the request / hand-off cards are hidden while they're empty).
 * Props: requests (number), transfers (number), late (number: late + missed), openSpots (number: open-spot alerts),
 *        onJump(targetId)  -> 'approval-queue' | 'pending-transfers' | 'tonight-board'
 */
export default function NeedsYouStrip({ requests = 0, transfers = 0, late = 0, openSpots = 0, onJump }) {
  const total = requests + transfers + late + openSpots;

  if (total === 0) {
    return (
      <div className="px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 inline-flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span><strong className="text-slate-200">Nothing needs you right now.</strong> New requests, hand-offs and late arrivals show up here.</span>
      </div>
    );
  }

  const chip = 'px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition';
  const items = [
    late > 0 && { id: 'tonight-board', n: late, label: 'late or not clocked in', icon: AlarmClock,
      cls: 'bg-rose-500/15 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25' },
    openSpots > 0 && { id: 'tonight-board', n: openSpots, label: openSpots === 1 ? 'open spot soon' : 'open spots soon', icon: UserPlus,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
    requests > 0 && { id: 'approval-queue', n: requests, label: requests === 1 ? 'request' : 'requests', icon: Users,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
    transfers > 0 && { id: 'pending-transfers', n: transfers, label: transfers === 1 ? 'hand-off' : 'hand-offs', icon: ArrowRightLeft,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
  ].filter(Boolean);

  return (
    <div className="p-2.5 rounded-2xl bg-slate-900 border border-amber-500/30 flex flex-wrap items-center gap-2" role="status">
      <span className="px-2 text-sm font-bold text-white inline-flex items-center gap-2">
        <BellRing className="w-4 h-4 text-amber-400" /> Needs you ({total})
      </span>
      {items.map((it) => (
        <button key={it.label} type="button" onClick={() => onJump?.(it.id)} className={`${chip} ${it.cls}`}>
          <it.icon className="w-3.5 h-3.5" /> {it.n} {it.label}
        </button>
      ))}
    </div>
  );
}
