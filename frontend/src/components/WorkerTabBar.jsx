import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListChecks, Search, CalendarDays, ArrowRightLeft, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ITEMS = [
  { id: 'schedule', label: 'My shifts', icon: ListChecks },
  { id: 'find', label: 'Find', icon: Search },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

function savedState() {
  try {
    return JSON.parse(sessionStorage.getItem('shiftboard_worker_tab') || 'null') || { tab: 'schedule', badges: {} };
  } catch (e) {
    return { tab: 'schedule', badges: {} };
  }
}

/**
 * Phase 33: bottom tab bar for workers on phones (hidden from md up). WorkerDashboard reports the open tab
 * and badge counts with a 'worker_tab_state' event; tapping a tab opens /worker?tab=… (the dashboard reads it).
 */
export default function WorkerTabBar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState(savedState);
  const isWorker = String(user?.role || '').toLowerCase() === 'worker';

  useEffect(() => {
    const onState = (e) => setState(e.detail);
    window.addEventListener('worker_tab_state', onState);
    return () => window.removeEventListener('worker_tab_state', onState);
  }, []);

  useEffect(() => {
    if (!isWorker) return undefined;
    document.documentElement.classList.add('has-tabbar');
    return () => document.documentElement.classList.remove('has-tabbar');
  }, [isWorker]);

  if (!isWorker) return null;

  const activeId = location.pathname === '/profile' ? 'profile' : location.pathname === '/worker' ? state.tab : null;
  const go = (id) => {
    window.scrollTo({ top: 0 });
    navigate(id === 'profile' ? '/profile' : `/worker?tab=${id}`);
  };

  return (
    <>
      <div className="md:hidden" style={{ height: 'var(--tabbar-h, 4rem)' }} aria-hidden="true" />
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5">
          {ITEMS.map(({ id, label, icon: Icon }) => {
            const on = activeId === id;
            const badge = (state.badges || {})[id] || 0;
            return (
              <button key={id} type="button" onClick={() => go(id)} aria-current={on ? 'page' : undefined}
                className={`relative h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                  on ? 'text-emerald-400' : 'text-slate-400 active:text-white'}`}>
                {on && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-emerald-400" />}
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black inline-flex items-center justify-center">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
