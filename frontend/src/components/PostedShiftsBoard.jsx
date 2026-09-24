import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
import EventRosterModal from './EventRosterModal';

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
  actionLoading,
}) {
  const [scope, setScope] = useState('upcoming');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);

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
        if (active) setEvents(res.data || []);
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
  }, [venueId, scope, refreshKey]);

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
      const dateKey = new Date(ev.start_time).toLocaleDateString([], {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      if (!(dateKey in index)) {
        index[dateKey] = groups.length;
        groups.push({ dateKey, items: [] });
      }
      groups[index[dateKey]].items.push(ev);
    });
    return groups;
  }, [events]);

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
                  const start = new Date(ev.start_time);
                  const end = new Date(ev.end_time);
                  const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  return (
                    <div key={ev.event_key} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 bg-slate-800/30">
                        <div>
                          <div className="text-sm font-bold text-white">{ev.title}</div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeStr}</span>
                            <span>Staffed <strong className="text-white">{ev.total_assigned}/{ev.total_capacity}</strong></span>
                            {ev.total_requested > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                                {ev.total_requested} request{ev.total_requested === 1 ? '' : 's'} to review
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedKey(ev.event_key)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white font-semibold text-xs border border-emerald-600/30 transition inline-flex items-center space-x-1.5 self-start md:self-auto"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>View Roster</span>
                        </button>
                      </div>
                      <div className="divide-y divide-slate-800/60">
                        {ev.positions.map((pos) => {
                          const pct = pos.capacity > 0 ? Math.min(100, Math.round((pos.assigned.length / pos.capacity) * 100)) : 0;
                          return (
                            <div key={pos.shift_id} className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs">
                              <div className="md:col-span-3 flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                              </div>
                              <div className="md:col-span-3 flex items-center gap-1.5 text-emerald-400 font-semibold">
                                <span>${Number(pos.hourly_rate).toFixed(2)}/hr</span>
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
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}
