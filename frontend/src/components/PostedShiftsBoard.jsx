import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus, Pencil, Eye, EyeOff, Copy, ClipboardList, Ban, MoreHorizontal, MapPin } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
import PayLabel from './PayLabel';
import EventRosterModal from './EventRosterModal';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'en-US': enUS } });

const SCOPES = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

export default function PostedShiftsBoard({
  venueId,
  refreshKey,
  reliabilityMap = {},
  onApprove,
  onDeny,
  onOpenBoard,
  onEditEvent,
  onCancelEvent,
  onDuplicateEvent,
  onTimesheet,
  onRemovePerson,
  onCancelPosition,
  actionLoading,
  timeZone,
  openEventId = null,      // Phase 28: open this event's roster once it loads (notification link)
  onOpenedEvent,
  onDataChanged,           // Phase 29: after assign / offer / rating (parent reloads, which bumps refreshKey)
}) {
  const [scope, setScope] = useState('upcoming');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const [menuKey, setMenuKey] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null); // `${venueId}|${scope}` of the events in state
  const [reloadTick, setReloadTick] = useState(0);   // Phase 29
  const handleChanged = () => (onDataChanged ? onDataChanged() : setReloadTick((t) => t + 1));

  useEffect(() => {
    if (!venueId) {
      setEvents([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    api
      .get(`/venues/${venueId}/events`, { params: { scope } })
      .then((res) => {
        if (active) {
          setEvents(res.data || []);
          setLoadedFor(`${venueId}|${scope}`);
        }
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.detail || 'Could not load posted shifts.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [venueId, scope, refreshKey, reloadTick]);

  // Phase 28: open the event from a notification link (search 'all' if it's not in this list)
  useEffect(() => {
    if (!openEventId || loading || loadedFor !== `${venueId}|${scope}`) return;
    const hit = events.find((e) => e.event_key === String(openEventId));
    if (hit) {
      setSelectedKey(hit.event_key);
      if (onOpenedEvent) onOpenedEvent();
    } else if (scope !== 'all') {
      setScope('all');
    } else if (onOpenedEvent) {
      onOpenedEvent(); // gone (deleted) — give up quietly
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId, events, loading, loadedFor, scope, venueId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.event_key === selectedKey) || null,
    [events, selectedKey]
  );

  const calendarEvents = useMemo(
    () =>
      events.map((ev) => ({
        id: ev.event_key,
        title: `${ev.title} (${ev.total_assigned}/${ev.total_capacity})`,
        start: new Date(ev.start_time),
        end: new Date(ev.end_time),
        resource: ev,
      })),
    [events]
  );

  const eventsByDate = useMemo(() => {
    const groups = [];
    const index = {};
    events.forEach((ev) => {
      const dateKey = fmtLongDate(ev.start_time, timeZone);
      if (!(dateKey in index)) {
        index[dateKey] = groups.length;
        groups.push({ dateKey, items: [] });
      }
      groups[index[dateKey]].items.push(ev);
    });
    return groups;
  }, [events, timeZone]);

  const toggleBtn = (active) =>
    `flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
      active ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
    }`;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-bold text-white">Posted Shifts ({events.length})</h2>
            <p className="text-xs text-slate-400">Every posted event with its positions, assigned staff and pending requests</p>
            {timeZone && <p className="text-[11px] text-slate-500">Times shown in venue time ({timeZone}). Calendar view uses your device's time.</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" onClick={() => setScope(s.id)} className={toggleBtn(scope === s.id)}>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
            <button type="button" onClick={() => setViewMode('list')} className={toggleBtn(viewMode === 'list')}>
              <ListIcon className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
            <button type="button" onClick={() => setViewMode('calendar')} className={toggleBtn(viewMode === 'calendar')}>
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>Calendar</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
      )}

      {loading && events.length === 0 ? (
        <div className="text-center py-12 text-xs text-slate-400">Loading posted shifts…</div>
      ) : viewMode === 'calendar' ? (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 min-h-[620px]">
          <Calendar
            localizer={localizer}
            events={calendarEvents}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 600 }}
            onSelectEvent={(e) => setSelectedKey(e.resource.event_key)}
            views={['month', 'week', 'day', 'agenda']}
            defaultView="month"
            popup
            eventPropGetter={(e) => ({
              style: {
                backgroundColor: e.resource.total_requested > 0 ? '#b45309' : '#059669',
                borderColor: e.resource.total_requested > 0 ? '#f59e0b' : '#10b981',
                color: '#ffffff',
                borderRadius: '6px',
                padding: '2px 6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              },
            })}
          />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 bg-slate-950/50 rounded-xl border border-slate-800">
          <CalendarIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            {scope === 'upcoming' ? 'No upcoming shifts posted for this venue.' : 'No shifts found.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {eventsByDate.map(({ dateKey, items }) => (
            <div key={dateKey}>
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center space-x-2">
                <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />
                <span>{dateKey}</span>
              </h3>
              <div className="space-y-3">
                {items.map((ev) => {
                  const timeStr = fmtTimeRange(ev.start_time, ev.end_time, timeZone);
                  return (
                    <div key={ev.event_key} className={`bg-slate-950 border rounded-xl overflow-visible ${ev.cancelled ? 'border-rose-900/60 opacity-70' : 'border-slate-800'}`}>
                      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 bg-slate-800/30">
                        <div>
                          <div className="text-sm font-bold text-white">{ev.title}</div>
                          {ev.cancelled && (
                            <div className="text-[11px] text-rose-300">Cancelled{ev.cancel_reason ? `: ${ev.cancel_reason}` : ''}</div>
                          )}
                          {ev.description && <div className="text-[11px] text-slate-400 line-clamp-1">{ev.description}</div>}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeStr}</span>
                            {ev.location_name && (
                              <span className="inline-flex items-center gap-1 text-emerald-300"><MapPin className="w-3 h-3" />{ev.location_name}</span>
                            )}
                            <span>Staffed <strong className="text-white">{ev.total_assigned}/{ev.total_capacity}</strong></span>
                            {ev.total_requested > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                                {ev.total_requested} request{ev.total_requested === 1 ? '' : 's'} to review
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-start md:self-auto relative">
                          <button
                            type="button"
                            onClick={() => setSelectedKey(ev.event_key)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white font-semibold text-xs border border-emerald-600/30 transition inline-flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" /> Details
                          </button>
                          {onEditEvent && ev.event_id && !ev.cancelled && (
                            <button
                              type="button"
                              onClick={() => onEditEvent(ev.event_id)}
                              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 font-semibold text-xs border border-amber-500/30 transition inline-flex items-center gap-1.5"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                          )}
                          {ev.event_id && (
                            <button
                              type="button"
                              onClick={() => setMenuKey(menuKey === ev.event_key ? null : ev.event_key)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                              aria-label="More actions"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          )}
                          {menuKey === ev.event_key && (
                            <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1">
                              {onTimesheet && (
                                <button type="button" onClick={() => { setMenuKey(null); onTimesheet(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2">
                                  <ClipboardList className="w-3.5 h-3.5" /> Time sheet
                                </button>
                              )}
                              {onDuplicateEvent && (
                                <button type="button" onClick={() => { setMenuKey(null); onDuplicateEvent(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2">
                                  <Copy className="w-3.5 h-3.5" /> Duplicate / repeat
                                </button>
                              )}
                              {onCancelEvent && !ev.cancelled && new Date(ev.start_time) > new Date() && (
                                <button type="button" onClick={() => { setMenuKey(null); onCancelEvent(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-2">
                                  <Ban className="w-3.5 h-3.5" /> Cancel event
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="divide-y divide-slate-800/60">
                        {ev.positions.map((pos) => {
                          const pct = pos.capacity > 0 ? Math.min(100, Math.round((pos.assigned.length / pos.capacity) * 100)) : 0;
                          return (
                            <div key={pos.shift_id} className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs">
                              <div className="md:col-span-3 flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                                {pos.status === 'CANCELLED' && <span className="text-[10px] text-rose-300">cancelled</span>}
                              </div>
                              <div className="md:col-span-3 flex items-center gap-1.5 text-emerald-400 font-semibold">
                                <PayLabel rate={pos.hourly_rate} rateMax={pos.hourly_rate_max} />
                                {pos.hide_rate && <EyeOff className="w-3 h-3 text-slate-500" title="Pay hidden from workers" />}
                                {pos.approval_mode === 'auto' && <span className="text-[10px] text-emerald-400">Instant</span>}
                                {pos.approval_mode === 'manual' && <span className="text-[10px] text-amber-400">Needs OK</span>}
                                <TipBadge shift={pos} />
                              </div>
                              <div className="md:col-span-3">
                                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                                  <span>{pos.assigned.length}/{pos.capacity} filled</span>
                                </div>
                                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              <div className="md:col-span-3 text-slate-300 truncate">
                                {pos.assigned.length > 0
                                  ? pos.assigned.map((p) => `${p.first_name} ${p.last_name?.[0] ? p.last_name[0] + '.' : ''}`.trim()).join(', ')
                                  : <span className="text-slate-500 italic">Unassigned</span>}
                                {pos.requested.length > 0 && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-amber-400 font-semibold">
                                    <UserPlus className="w-3 h-3" />{pos.requested.length}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedEvent && (
        <EventRosterModal
          event={selectedEvent}
          onClose={() => setSelectedKey(null)}
          reliabilityMap={reliabilityMap}
          onApprove={onApprove}
          onDeny={onDeny}
          onOpenBoard={onOpenBoard}
          onEdit={onEditEvent ? (id) => { setSelectedKey(null); onEditEvent(id); } : undefined}
          onRemovePerson={onRemovePerson}
          onCancelPosition={onCancelPosition}
          actionLoading={actionLoading}
          timeZone={timeZone}
          venueId={venueId}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
