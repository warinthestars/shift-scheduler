import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Building2, Plus, Pencil, Search, AlertTriangle, X, Save } from 'lucide-react';
import api from '../api/client';
import LocationFields, { blankLocationDraft, locationToDraft, draftToPayload } from './LocationFields';
import { locationPatchBody } from './VenueLocationsPanel';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';

/**
 * Phase 27: "Where" on Post / Edit a Shift.
 *
 * value (controlled) is one of:
 *   { kind: 'venue' }                          -> at the venue's own address
 *   { kind: 'saved', location: <saved loc> }   -> a saved location
 *   { kind: 'new',   draft: <LocationFields draft> } -> typed in here; saved to the list when the event saves
 *
 * Typing filters saved locations. If nothing matches, the new-location fields open right here.
 * "Edit this location" changes the saved location everywhere (global edit).
 */
export default function EventLocationPicker({ venue, value, onChange }) {
  const [locations, setLocations] = useState([]);
  const [query, setQuery] = useState(() =>
    value?.kind === 'saved' ? value.location?.name || '' : value?.kind === 'new' ? value.draft?.name || '' : ''
  );
  const [open, setOpen] = useState(false);
  const [forceNew, setForceNew] = useState(value?.kind === 'new');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const blurTimer = useRef(null);

  const loadLocations = () => {
    if (!venue?.id) return;
    api
      .get(`/venues/${venue.id}/locations`)
      .then((res) => setLocations(res.data || []))
      .catch(() => setLocations([]));
  };
  useEffect(loadLocations, [venue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the text box in sync when the parent loads an existing event
  useEffect(() => {
    if (value?.kind === 'saved') setQuery(value.location?.name || '');
    if (value?.kind === 'venue') setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.kind, value?.location?.id]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return locations.slice(0, 8);
    return locations
      .filter((l) => l.name.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [locations, q]);
  const exact = locations.find((l) => l.name.toLowerCase() === q) || null;

  const pickVenue = () => {
    setQuery('');
    setForceNew(false);
    setEditing(false);
    setOpen(false);
    onChange({ kind: 'venue' });
  };

  const pickSaved = (loc) => {
    setQuery(loc.name);
    setForceNew(false);
    setEditing(false);
    setOpen(false);
    onChange({ kind: 'saved', location: loc });
  };

  const startNew = (name) => {
    setForceNew(true);
    setEditing(false);
    setOpen(false);
    const prev = value?.kind === 'new' ? value.draft : blankLocationDraft();
    onChange({ kind: 'new', draft: { ...prev, name } });
  };

  const onType = (text) => {
    setQuery(text);
    setOpen(true);
    setEditing(false);
    const t = text.trim();
    if (!t) {
      setForceNew(false);
      onChange({ kind: 'venue' });
      return;
    }
    const hit = locations.find((l) => l.name.toLowerCase() === t.toLowerCase());
    if (hit) {
      setForceNew(false);
      onChange({ kind: 'saved', location: hit });
      return;
    }
    const prev = value?.kind === 'new' ? value.draft : blankLocationDraft();
    onChange({ kind: 'new', draft: { ...prev, name: t } });
  };

  // Show the new-location fields when nothing in the list matches (or the manager chose "Add new").
  const showNewFields = value?.kind === 'new' && (forceNew || matches.length === 0);

  const saveEdit = async () => {
    const { payload, error } = draftToPayload(editDraft);
    if (error) return setEditError(error);
    setEditBusy(true);
    setEditError('');
    try {
      const res = await api.patch(
        `/venues/${venue.id}/locations/${value.location.id}`,
        locationPatchBody(value.location, payload)
      );
      onChange({ kind: 'saved', location: res.data });
      setQuery(res.data.name);
      setEditing(false);
      loadLocations();
    } catch (err) {
      setEditError(err.response?.data?.detail || 'Could not save location.');
    } finally {
      setEditBusy(false);
    }
  };

  const selected = value?.kind === 'saved' ? value.location : null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          className={`${inputCls} pl-9`}
          placeholder={`Venue address — ${venue?.address || ''}`}
        />
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={pickVenue}
              className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2">
              <Building2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm text-white">Venue address</span>
                <span className="block text-[11px] text-slate-400 truncate">{venue?.address}</span>
              </span>
            </button>
            {matches.map((loc) => (
              <button key={loc.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSaved(loc)}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2 border-t border-slate-800">
                <MapPin className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm text-white truncate">{loc.name}</span>
                  <span className="block text-[11px] text-slate-400 truncate">
                    {loc.address}{loc.lat == null ? ' · no map pin' : ''}
                  </span>
                </span>
              </button>
            ))}
            {q && !exact && (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => startNew(query.trim())}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 border-t border-slate-800 text-emerald-400 text-sm font-semibold">
                <Plus className="w-4 h-4" /> Add “{query.trim()}” as a new location
              </button>
            )}
          </div>
        )}
      </div>

      {/* Saved location summary + global edit */}
      {selected && !editing && (
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-slate-200 font-semibold truncate">{selected.name}</div>
              <div className="text-slate-400">{selected.address}</div>
            </div>
            <button type="button" onClick={() => { setEditDraft(locationToDraft(selected)); setEditing(true); setEditError(''); }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 inline-flex items-center gap-1 flex-shrink-0">
              <Pencil className="w-3 h-3" /> Edit this location
            </button>
          </div>
          {selected.notes && <p className="text-slate-300 whitespace-pre-line">{selected.notes}</p>}
          {selected.lat == null && (
            <p className="text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> No map pin yet.</p>
          )}
        </div>
      )}

      {selected && editing && editDraft && (
        <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 space-y-3">
          <p className="text-[11px] text-amber-200 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This changes “{selected.name}” for every event that uses it. People booked on upcoming events there
            will be asked to re-read the shift info.
          </p>
          {editError && <p className="text-xs text-rose-300">{editError}</p>}
          <LocationFields value={editDraft} onChange={setEditDraft} venueRadius={venue?.geofence_radius_meters || 150} compact />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button type="button" onClick={saveEdit} disabled={editBusy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {editBusy ? 'Saving…' : 'Save for all events'}
            </button>
          </div>
        </div>
      )}

      {/* New location typed here: fields open inline and it's saved to the list with the event */}
      {showNewFields && (
        <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 space-y-3">
          <p className="text-[11px] text-emerald-200">
            New location. It will be saved to your locations list when you save this shift.
          </p>
          <LocationFields
            value={value.draft}
            onChange={(d) => {
              setQuery(d.name);
              onChange({ kind: 'new', draft: d });
            }}
            venueRadius={venue?.geofence_radius_meters || 150}
            compact
          />
        </div>
      )}
    </div>
  );
}
