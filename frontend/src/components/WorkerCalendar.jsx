import React, { useMemo, useState } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths, isSameMonth, format,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, List as ListIcon, AlertTriangle, MapPin, Clock, Eye, EyeOff, ArrowRight,
} from 'lucide-react';
import { fmtTime, fmtTimeRange, fmtLongDate, tzAbbrev } from '../utils/venueTime';
import {
  localDateKey, gridDateKey, countdownText, calendarTone, hoursText,
} from '../utils/listingFormat';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

function entryStart(e) {
  return e.kind === 'mine' ? e.item.start_time : e.listing.start_time;
}

/** One big, easy-to-read row for the day agenda and the list view. */
function AgendaRow({ entry, onSelectItem, onSelectListing }) {
  if (entry.kind === 'open') {
    const l = entry.listing;
    const tz = l.venue?.timezone;
    return (
      <button
        type="button"
        onClick={() => onSelectListing(l)}
        className="w-full text-left p-3 sm:p-4 rounded-xl border border-dashed border-slate-600 bg-slate-950/40 hover:border-emerald-500/60 transition flex items-center gap-4"
      >
        <div className="w-24 sm:w-28 flex-shrink-0">
          <div className="text-base sm:text-lg font-black text-slate-200 leading-tight">{fmtTime(l.start_time, tz)}</div>
          <div className="text-[11px] text-slate-500">to {fmtTime(l.end_time, tz)} {tzAbbrev(l.start_time, tz)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Open shift</div>
          <div className="text-sm font-bold text-slate-200 truncate">{l.title}</div>
          <div className="text-xs text-slate-400 truncate">
            {l.venue?.name}{l.location ? ` · at ${l.location.name}` : ''} · {l.total_spots_left} spot{l.total_spots_left === 1 ? '' : 's'} open
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
      </button>
    );
  }

  const it = entry.item;
  const tz = it.venue?.timezone;
  const tone = calendarTone(it);
  const off = tone.key === 'off';
  return (
    <button
      type="button"
      onClick={() => onSelectItem(it)}
      className={`w-full text-left p-3 sm:p-4 rounded-xl border transition flex items-center gap-4 ${
        it.needs_ack && !off
          ? 'border-amber-500/70 bg-amber-500/5 hover:bg-amber-500/10'
          : 'border-slate-800 bg-slate-900 hover:border-slate-600'
      }`}
    >
      <div className="w-24 sm:w-28 flex-shrink-0">
        <div className={`text-base sm:text-lg font-black leading-tight ${off ? 'text-slate-500 line-through' : 'text-white'}`}>
          {fmtTime(it.start_time, tz)}
        </div>
        <div className="text-[11px] text-slate-400">to {fmtTime(it.end_time, tz)} {tzAbbrev(it.start_time, tz)}</div>
        <div className="text-[10px] text-slate-500">{hoursText(it.hours)}</div>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{tone.label}</span>
          {it.needs_ack && !off && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">
              <AlertTriangle className="w-3 h-3" /> {it.info_change ? 'UPDATED' : 'PLEASE READ'}
            </span>
          )}
        </div>
        <div className={`text-sm font-bold truncate ${off ? 'text-slate-500' : 'text-white'}`}>
          {it.role_type} · {it.title}
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-1 truncate">
          <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{it.venue?.name}{it.location ? ` · at ${it.location.name}` : ''}</span>
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
    </button>
  );
}

/**
 * Phase 26.2: Worker calendar.
 * Month grid (day cells show time + position on desktop, coloured dots on phones) with the selected
 * day's agenda below, or a plain list. Days are computed in each venue's own timezone.
 *
 * Props:
 *   items            WorkerCalendarItem[] from GET /api/me/calendar
 *   openListings     EventListing[] from GET /api/listings (optional overlay)
 *   onSelectItem(item)       open ShiftDetailsModal
 *   onSelectListing(listing) open EventListingModal
 */
export default function WorkerCalendar({ items = [], openListings = [], onSelectItem, onSelectListing }) {
  const todayKey = gridDateKey(new Date());
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [view, setView] = useState('month'); // 'month' | 'list'
  const [showOpen, setShowOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // All entries, keyed by venue-local calendar day
  const entries = useMemo(() => {
    const list = items.map((item) => ({ kind: 'mine', key: localDateKey(item.start_time, item.venue?.timezone), item }));
    if (showOpen) {
      openListings
        .filter((l) => !l.my_request && l.total_spots_left > 0)
        .forEach((l) => list.push({ kind: 'open', key: localDateKey(l.start_time, l.venue?.timezone), listing: l }));
    }
    list.sort((a, b) => new Date(entryStart(a)) - new Date(entryStart(b)));
    return list;
  }, [items, openListings, showOpen]);

  const byDay = useMemo(() => {
    const m = new Map();
    entries.forEach((e) => {
      if (!m.has(e.key)) m.set(e.key, []);
      m.get(e.key).push(e);
    });
    return m;
  }, [entries]);

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) }),
    [cursor]
  );

  const nextShift = useMemo(() => {
    const now = Date.now();
    return items.find(
      (i) => i.booked && !i.cancelled && i.status !== 'completed' && new Date(i.end_time).getTime() > now
    ) || null;
  }, [items]);

  const selectedEntries = byDay.get(selectedKey) || [];
  const selectedDate = new Date(`${selectedKey}T12:00:00`);

  const listGroups = useMemo(() => {
    const groups = [];
    entries
      .filter((e) => showPast || e.key >= todayKey)
      .forEach((e) => {
        const last = groups[groups.length - 1];
        if (last && last.key === e.key) last.entries.push(e);
        else groups.push({ key: e.key, entries: [e] });
      });
    return groups;
  }, [entries, showPast, todayKey]);

  const goToday = () => {
    setCursor(startOfMonth(new Date()));
    setSelectedKey(todayKey);
  };

  return (
    <div className="space-y-5">
      {/* Next shift — big and impossible to miss */}
      {nextShift && (() => {
        const tz = nextShift.venue?.timezone;
        return (
          <button
            type="button"
            onClick={() => onSelectItem(nextShift)}
            className={`w-full text-left rounded-2xl p-4 sm:p-5 border shadow-xl transition ${
              nextShift.needs_ack
                ? 'border-amber-500/70 bg-gradient-to-br from-amber-500/10 to-slate-900'
                : 'border-emerald-600/50 bg-gradient-to-br from-emerald-600/15 to-slate-900 hover:border-emerald-400'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">Your next shift</div>
                <div className="text-xl sm:text-2xl font-black text-white mt-0.5">{fmtLongDate(nextShift.start_time, tz)}</div>
                <div className="text-lg sm:text-xl font-bold text-emerald-300 flex items-center gap-2">
                  <Clock className="w-5 h-5" /> {fmtTimeRange(nextShift.start_time, nextShift.end_time, tz)}
                </div>
                <div className="text-sm text-slate-300 mt-1 truncate">
                  {nextShift.role_type} · {nextShift.title} · {nextShift.venue?.name}
                  {nextShift.location ? ` · at ${nextShift.location.name}` : ''}
                </div>
              </div>
              <div className="flex sm:flex-col items-start sm:items-end gap-2 flex-shrink-0">
                <span className="px-3 py-1 rounded-full bg-slate-950/70 border border-slate-700 text-xs font-bold text-white">
                  {countdownText(nextShift.start_time, nextShift.end_time)}
                </span>
                {nextShift.needs_ack && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-slate-950 text-[11px] font-black">
                    <AlertTriangle className="w-3.5 h-3.5" /> {nextShift.info_change ? 'Shift was updated — tap to read' : 'Read the shift notes'}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })()}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCursor((c) => addMonths(c, -1))} aria-label="Previous month"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-black text-white min-w-[10rem] text-center">{format(cursor, 'MMMM yyyy')}</h2>
          <button type="button" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Next month"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button type="button" onClick={goToday}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-300">
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOpen((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 ${
              showOpen ? 'bg-slate-800 text-white border-slate-600' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            {showOpen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} Open shifts
          </button>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button type="button" onClick={() => setView('month')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 ${view === 'month' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
              <CalendarDays className="w-3.5 h-3.5" /> Month
            </button>
            <button type="button" onClick={() => setView('list')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 ${view === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
              <ListIcon className="w-3.5 h-3.5" /> List
            </button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Confirmed</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Waiting for approval</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> Clocked in</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Done / cancelled</span>
        {showOpen && <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border border-dashed border-slate-400" /> Open shift</span>}
        <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="w-3 h-3" /> Needs your attention</span>
      </div>

      {view === 'month' ? (
        <>
          <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950">
            <div className="grid grid-cols-7 bg-slate-900 border-b border-slate-800">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-2 text-center text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const key = gridDateKey(d);
                const dayEntries = byDay.get(key) || [];
                const inMonth = isSameMonth(d, cursor);
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                const attention = dayEntries.some((e) => e.kind === 'mine' && e.item.needs_ack && calendarTone(e.item).key !== 'off');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={`relative flex flex-col justify-start min-h-[3.5rem] sm:min-h-[6.5rem] p-1 sm:p-1.5 text-left border-b border-r border-slate-800/70 transition ${
                      inMonth ? 'bg-slate-950' : 'bg-slate-950/40'
                    } ${isSelected ? 'ring-2 ring-inset ring-emerald-500 bg-emerald-500/5' : 'hover:bg-slate-900'}`}
                  >
                    <div className="w-full flex items-center justify-between">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          isToday ? 'bg-emerald-500 text-slate-950' : inMonth ? 'text-slate-200' : 'text-slate-600'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      {attention && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                    </div>

                    {/* Phones: dots */}
                    <div className="flex flex-wrap gap-0.5 mt-1 sm:hidden">
                      {dayEntries.slice(0, 4).map((e, i) =>
                        e.kind === 'open' ? (
                          <span key={i} className="w-1.5 h-1.5 rounded-full border border-slate-400" />
                        ) : (
                          <span key={i} className={`w-1.5 h-1.5 rounded-full ${calendarTone(e.item).dot}`} />
                        )
                      )}
                    </div>

                    {/* Tablet / desktop: time + position chips */}
                    <div className="hidden sm:block w-full mt-1 space-y-0.5">
                      {dayEntries.slice(0, MAX_CHIPS).map((e, i) => {
                        if (e.kind === 'open') {
                          const l = e.listing;
                          return (
                            <div key={i} className="px-1 py-0.5 rounded border border-dashed border-slate-600 text-[10px] text-slate-400 truncate">
                              {fmtTime(l.start_time, l.venue?.timezone)} Open
                            </div>
                          );
                        }
                        const it = e.item;
                        const tone = calendarTone(it);
                        return (
                          <div key={i} className={`px-1 py-0.5 rounded border text-[10px] font-semibold truncate ${tone.chip}`}>
                            {fmtTime(it.start_time, it.venue?.timezone)} {it.role_type}
                          </div>
                        );
                      })}
                      {dayEntries.length > MAX_CHIPS && (
                        <div className="text-[10px] text-slate-500 px-1">+{dayEntries.length - MAX_CHIPS} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected day agenda */}
          <div>
            <h3 className="text-sm font-bold text-white mb-2">
              {selectedKey === todayKey ? 'Today · ' : ''}
              {format(selectedDate, 'EEEE, MMMM d')}
            </h3>
            {selectedEntries.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center bg-slate-900/40 border border-slate-800 rounded-xl">
                Nothing on this day.
              </p>
            ) : (
              <div className="space-y-2">
                {selectedEntries.map((e, i) => (
                  <AgendaRow key={i} entry={e} onSelectItem={onSelectItem} onSelectListing={onSelectListing} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <button type="button" onClick={() => setShowPast((v) => !v)} className="text-xs text-slate-400 underline hover:text-white">
            {showPast ? 'Hide past shifts' : 'Show past shifts'}
          </button>
          {listGroups.length === 0 ? (
            <p className="text-xs text-slate-500 py-10 text-center bg-slate-900/40 border border-slate-800 rounded-xl">
              Nothing scheduled yet.
            </p>
          ) : (
            listGroups.map((g) => (
              <section key={g.key}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  {g.key === todayKey ? 'Today · ' : ''}
                  {format(new Date(`${g.key}T12:00:00`), 'EEEE, MMMM d')}
                </h3>
                <div className="space-y-2">
                  {g.entries.map((e, i) => (
                    <AgendaRow key={i} entry={e} onSelectItem={onSelectItem} onSelectListing={onSelectListing} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
