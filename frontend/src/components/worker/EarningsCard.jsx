import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import { money, hoursText } from '../../utils/earnings';

/**
 * Phase 33.1: "This week" hours & pay at the top of My shifts. Taps through to /earnings.
 * Props: refreshKey (changes after clock-in / clock-out so it reloads)
 */
export default function EarningsCard({ refreshKey = 0 }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/me/earnings', { params: { period: 'week' } })
      .then((res) => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [refreshKey]);

  if (!data) return null;
  const up = data.upcoming || {};
  return (
    <Link to="/earnings" className="block p-4 rounded-2xl border border-slate-800 bg-slate-900 hover:border-slate-600 transition">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
          <Wallet className="w-5 h-5 text-brand-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">This week</div>
          <div className="text-base font-black text-white">
            {hoursText(data.total_hours)} · <span className="text-brand-400">{money(data.total_pay)}</span>
            {data.total_tips > 0 && <span className="text-amber-300"> + {money(data.total_tips)} tips</span>}
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {data.in_progress > 0 ? 'Clocked in now · ' : ''}
            {up.shifts > 0 ? `${up.shifts} more booked (~${money(up.est_pay)})` : 'Before tips'}
            {data.payroll_shifts > 0 ? ` · ${data.payroll_shifts} on venue payroll` : ''}
          </div>
        </div>
        <span className="text-xs font-semibold text-brand-400 inline-flex items-center gap-0.5 flex-shrink-0">
          Hours & pay <ChevronRight className="w-4 h-4" />
        </span>
      </div>
    </Link>
  );
}
