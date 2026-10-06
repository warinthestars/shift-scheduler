import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun, CalendarDays, RefreshCw, AlarmClock, UserX, UserPlus, EyeOff, MapPinOff, Phone, LogIn, ClipboardList, MessageSquare, CheckCircle2,
} from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import StaffPositionModal from '../StaffPositionModal';
import TodayEventCard from './TodayEventCard';
import WeekAtGlance from './WeekAtGlance';
import { fmtDate, fmtTime } from '../../utils/venueTime';

const POLL_MS = 60000;          // live refresh while the tab is visible
const ALERTS_SHOWN = 4;
const ALERT_ICON = {
  late: [AlarmClock, 'text-rose-400'],
  missed: [UserX, 'text-rose-300'],
  open_spot: [UserPlus, 'text-amber-300'],
  unread: [EyeOff, 'text-amber-200'],
  geo: [MapPinOff, 'text-amber-300'],
};

function agoText(ms) {
  const s = Math.round(ms / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  return `${m} min ago`;
}

/**
 * Phase 30: The manager's "Today / This week" board (top of the dashboard).
 * Today: every event touching today with live clock status and one-tap actions, plus alerts.
 * This week: today + 6 days at a glance.
 * Refreshes every minute while visible, when the tab comes back, and when refreshKey changes.
 * Props: venueId, timeZone, refreshKey, reliabilityMap,
 *        onOpenBoard({ id, title, role_type }), onOpenEvent(eventId), onTimesheet(eventId), onOpenWorker(workerId),
 *        onChanged(message)   -> parent reloads everything and shows the message
 *        onSummary({ late, openSpots })
 * Phase 36: also the shift lead's board (pages/LeadPage.jsx). Lead mode passes
 *        tonightPath = `/lead/venues/${venueId}/tonight` and timesLabel = 'Clock times', and leaves out
 *        onOpenEvent / onOpenWorker (those buttons then aren't drawn). Everything else is the same.
 */
export default function TonightBoard({
  venueId, timeZone, refreshKey = 0, reliabilityMap = {},
  onOpenBoard, onOpenEvent, onTimesheet, onOpenWorker, onChanged, onSummary,
  tonightPath = null, timesLabel = 'Time sheet',
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(null);                 // 'today' | 'week' (picked after the first load)
  const [loadedAt, setLoadedAt] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [confirm, setConfirm] = useState(null);         // ConfirmDialog props
  const [cover, setCover] = useState(null);             // { event, position } for StaffPositionModal
  const [highlight, setHighlight] = useState(null);     // request id flashed after tapping an alert
  const venueRef = useRef(venueId);
  venueRef.current = venueId;

  const load = useCallback(async (quiet = false) => {
    if (!venueId) return;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(tonightPath || `/venues/${venueId}/tonight`);
      if (venueRef.current !== venueId) return;
      setData(res.data);
      setError('');
      setLoadedAt(Date.now());
      setTab((t) => t || ((res.data.events || []).length ? 'today' : 'week'));
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load today’s board.');
    } finally {
      setLoading(false);
    }
  }, [venueId, tonightPath]);

  useEffect(() => {
    setData(null);
    setTab(null);
    load();
  }, [venueId, load]);

  useEffect(() => {
    if (refreshKey) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // live: poll while visible, reload when the tab comes back, tick the clock for "starts in" text
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, POLL_MS);
    const tick = setInterval(() => setNowMs(Date.now()), 15000);
    const onVis = () => document.visibilityState === 'visible' && load(true);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!data || !onSummary) return;
    onSummary({
      late: (data.counts?.late || 0) + (data.counts?.missed || 0),
      openSpots: (data.alerts || []).filter((a) => a.kind === 'open_spot').length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const lookup = useMemo(() => {
    const people = {};
    const positions = {};
    const events = {};
    (data?.events || []).forEach((ev) => {
      events[ev.event_key] = ev;
      ev.positions.forEach((pos) => {
        positions[pos.shift_id] = { pos, ev };
        pos.people.forEach((p) => { people[p.request_id] = { p, pos, ev }; });
      });
    });
    return { people, positions, events };
  }, [data]);

  const done = (message) => {
    load(true);
    onChanged?.(message);
  };

  // ---- actions ----
  const openBoard = (pos, ev) => onOpenBoard?.({ id: pos.shift_id, title: ev.title, role_type: pos.role_type });

  const askClockIn = (p) => setConfirm({
    title: `Clock ${p.first_name} in now?`,
    message: `Records ${p.first_name} as clocked in at ${fmtTime(new Date(), timeZone)}. They clock out as usual, or you can fix the times on the time sheet.`,
    confirmLabel: 'Clock in',
    input: { label: 'Reason (saved on the time sheet)', placeholder: 'e.g. Phone died, signed in at the door', required: true },
    onConfirm: async (reason) => {
      await api.post(`/requests/${p.request_id}/time-entries`, { clock_in_time: new Date().toISOString(), clock_out_time: null, reason });
      done(`${p.first_name} is clocked in.`);
    },
  });

  const askNoShow = (p, ev) => setConfirm({
    title: `Mark ${p.first_name} as a no-show?`,
    message: ev.state === 'ended'
      ? 'This counts against their reliability, and they’ll be told. If they did work, add their hours on the time sheet instead.'
      : 'This counts against their reliability, and they’ll be told. Their spot opens up so you can find cover.',
    confirmLabel: 'Mark no-show',
    danger: true,
    input: { label: 'Note (optional, they’ll see it)', placeholder: 'e.g. No answer on the phone' },
    onConfirm: async (reason) => {
      const res = await api.post(`/requests/${p.request_id}/no-show`, { reason: reason || null });
      done(res.data?.spot_reopened
        ? `${p.first_name} marked as a no-show. Their spot is open: tap “Find cover”.`
        : `${p.first_name} marked as a no-show.`);
    },
  });

  const findCover = (pos, ev) => setCover({
    event: { title: ev.title, start_time: ev.start_time },
    position: {
      shift_id: pos.shift_id, role_type: pos.role_type, capacity: pos.capacity,
      assigned: pos.people.filter((p) => p.clock_state !== 'no_show'),
    },
  });

  const alertActions = (a) => {
    const person = a.request_id ? lookup.people[a.request_id] : null;
    const position = a.shift_id ? lookup.positions[a.shift_id] : null;
    const ev = lookup.events[a.event_key];
    const btn = 'px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition';
    const out = [];
    if (a.kind === 'late' && person) {
      if (person.p.phone) {
        out.push(<a key="call" href={`tel:${person.p.phone}`} className={`${btn} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}><Phone className="w-3 h-3" /> Call</a>);
      }
      out.push(<button key="in" type="button" onClick={() => askClockIn(person.p)} className={`${btn} border-brand-500/40 bg-brand-600/20 text-brand-200`}><LogIn className="w-3 h-3" /> Clock in</button>);
      out.push(<button key="ns" type="button" onClick={() => askNoShow(person.p, person.ev)} className={`${btn} border-rose-500/40 bg-rose-600/15 text-rose-200`}><UserX className="w-3 h-3" /> No-show</button>);
    }
    if (a.kind === 'missed' && person) {
      out.push(<button key="ns" type="button" onClick={() => askNoShow(person.p, person.ev)} className={`${btn} border-rose-500/40 bg-rose-600/15 text-rose-200`}><UserX className="w-3 h-3" /> No-show</button>);
      if (a.event_id) out.push(<button key="ts" type="button" onClick={() => onTimesheet?.(a.event_id)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><ClipboardList className="w-3 h-3" /> Add hours</button>);
    }
    if (a.kind === 'open_spot' && position) {
      out.push(<button key="cover" type="button" onClick={() => findCover(position.pos, position.ev)} className={`${btn} border-amber-500 bg-amber-500 text-slate-950`}><UserPlus className="w-3 h-3" /> Find cover</button>);
    }
    if (a.kind === 'unread' && ev && ev.positions[0]) {
      out.push(<button key="board" type="button" onClick={() => openBoard(ev.positions[0], ev)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><MessageSquare className="w-3 h-3" /> Message</button>);
    }
    if (a.kind === 'geo' && a.event_id) {
      out.push(<button key="ts" type="button" onClick={() => onTimesheet?.(a.event_id)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><ClipboardList className="w-3 h-3" /> {timesLabel}</button>);
    }
    return out;
  };

  const events = data?.events || [];
  const alerts = data?.alerts || [];
  const shownAlerts = showAllAlerts ? alerts : alerts.slice(0, ALERTS_SHOWN);
  const nextUp = (data?.week || []).slice(1).flatMap((d) => d.events.map((e) => ({ ...e, day: d.label }))).find((e) => e.status !== 'draft');
  const c = data?.counts || {};
  const tabBtn = (id) => `px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition ${
    tab === id ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
  }`;
  // live events first, then upcoming, then ended
  const ordered = [...events].sort((a, b) => {
    const rank = { live: 0, upcoming: 1, ended: 2 };
    return (rank[a.state] - rank[b.state]) || (new Date(a.start_time) - new Date(b.start_time));
  });

  return (
    <section id="tonight-board" className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-4 scroll-mt-4">
      <header className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white">
            {tab === 'week' ? 'This week' : 'Today'}
            {data && <span className="ml-2 text-sm font-normal text-slate-400">{fmtDate(data.now, timeZone)}</span>}
          </h2>
          {data && (
            <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live · updated {agoText(nowMs - loadedAt)}
              </span>
              {c.events > 0 && (
                <span>
                  {c.events} event{c.events === 1 ? '' : 's'} · {c.booked} booked · {c.clocked_in} in now
                  {c.late > 0 && <strong className="text-rose-300"> · {c.late} late</strong>}
                  {c.open_spots > 0 && <strong className="text-amber-300"> · {c.open_spots} open</strong>}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="p-1 bg-slate-900 border border-slate-800 rounded-xl flex gap-1" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'today'} onClick={() => setTab('today')} className={tabBtn('today')}>
              <Sun className="w-3.5 h-3.5" /> Today
            </button>
            <button type="button" role="tab" aria-selected={tab === 'week'} onClick={() => setTab('week')} className={tabBtn('week')}>
              <CalendarDays className="w-3.5 h-3.5" /> This week
            </button>
          </div>
          <button type="button" onClick={() => load()} disabled={loading} aria-label="Refresh"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
      {!data && !error && <div className="h-24 rounded-xl bg-slate-900 animate-pulse" />}

      {data && tab === 'today' && (
        <>
          {alerts.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/70">
              {shownAlerts.map((a, i) => {
                const [Icon, tone] = ALERT_ICON[a.kind] || [AlarmClock, 'text-slate-400'];
                return (
                  <div key={`${a.kind}-${a.request_id || a.shift_id || a.event_key}-${i}`}
                    className={`p-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${a.severity === 'high' ? 'bg-rose-500/5' : ''}`}>
                    <button type="button" onClick={() => setHighlight(a.request_id)} className="flex-1 min-w-0 flex items-start gap-2 text-left">
                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${tone}`} />
                      <span className={`text-xs ${a.severity === 'high' ? 'text-white font-semibold' : 'text-slate-300'}`}>{a.text}</span>
                    </button>
                    <div className="flex flex-wrap gap-1.5 pl-6 sm:pl-0">{alertActions(a)}</div>
                  </div>
                );
              })}
              {alerts.length > ALERTS_SHOWN && (
                <button type="button" onClick={() => setShowAllAlerts((s) => !s)} className="w-full p-2 text-[11px] text-slate-400 hover:text-white">
                  {showAllAlerts ? 'Show fewer' : `Show all ${alerts.length} alerts`}
                </button>
              )}
            </div>
          )}

          {events.length === 0 ? (
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
              <CheckCircle2 className="w-6 h-6 text-slate-600 mx-auto mb-1" />
              <p className="text-sm text-slate-300 font-semibold">Nothing on today.</p>
              {nextUp && (
                <p className="text-xs text-slate-500 mt-1">
                  Next up: <strong className="text-slate-300">{nextUp.title}</strong> · {nextUp.day} {fmtTime(nextUp.start_time, timeZone)}
                </p>
              )}
              <button type="button" onClick={() => setTab('week')} className="mt-3 text-xs font-bold text-amber-300 hover:text-amber-200">See the week →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
              {ordered.map((ev) => (
                <TodayEventCard
                  key={ev.event_key}
                  event={ev}
                  timeZone={timeZone}
                  nowMs={nowMs}
                  reliabilityMap={reliabilityMap}
                  highlightRequestId={highlight}
                  onBoard={(pos) => openBoard(pos, ev)}
                  onClockIn={(p) => askClockIn(p)}
                  onNoShow={(p) => askNoShow(p, ev)}
                  onFindCover={(pos) => findCover(pos, ev)}
                  onOpenEvent={onOpenEvent}
                  onTimesheet={onTimesheet}
                  onOpenWorker={onOpenWorker}
                  timesLabel={timesLabel}
                />
              ))}
            </div>
          )}
        </>
      )}

      {data && tab === 'week' && <WeekAtGlance week={data.week} timeZone={timeZone} onOpenEvent={onOpenEvent} />}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {cover && (
        <StaffPositionModal
          event={cover.event}
          position={cover.position}
          onClose={() => setCover(null)}
          onDone={(message) => {
            setCover(null);
            done(message);
          }}
        />
      )}
    </section>
  );
}
