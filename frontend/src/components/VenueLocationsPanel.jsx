import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Pencil, Archive, RotateCcw, X, Save, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import LocationFields, { blankLocationDraft, locationToDraft, draftToPayload } from './LocationFields';

/** Build a PATCH body for a global edit (clears pin / radius when the field was emptied). */
export function locationPatchBody(original, payload) {
  const body = { name: payload.name, address: payload.address, notes: payload.notes ?? '' };
  if (payload.lat === null) {
    if (original?.lat != null) body.clear_pin = true;
  } else {
    body.lat = payload.lat;
    body.lng = payload.lng;
  }
  if (payload.radius_meters === null) {
    if (original?.radius_meters != null) body.clear_radius = true;
  } else {
    body.radius_meters = payload.radius_meters;
  }
  return body;
}

function LocationRow({ venue, loc, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(locationToDraft(loc));
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(locationToDraft(loc)), [loc]);

  const save = async () => {
    const { payload, error } = draftToPayload(draft);
    if (error) return onError(error);
    setBusy(true);
    try {
      await api.patch(`/venues/${venue.id}/locations/${loc.id}`, locationPatchBody(loc, payload));
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save location.');
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    try {
      await api.post(`/venues/${venue.id}/locations/${loc.id}/${loc.is_archived ? 'unarchive' : 'archive'}`);
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not update location.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`p-3 rounded-xl border ${loc.is_archived ? 'border-slate-800 bg-slate-950 opacity-60' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="truncate">{loc.name}</span>
            {loc.is_archived && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Archived</span>}
          </div>
          <div className="text-xs text-slate-400 truncate">{loc.address}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {loc.lat != null ? 'Pin set' : <span className="text-amber-300">No map pin</span>}
            {loc.radius_meters != null ? ` · ${loc.radius_meters} m radius` : ''}
            {` · used by ${loc.event_count} event${loc.event_count === 1 ? '' : 's'}`}
            {loc.upcoming_count ? ` (${loc.upcoming_count} upcoming)` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!loc.is_archived && !editing && (
            <button type="button" onClick={() => setEditing(true)} title="Edit"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={toggleArchive} disabled={busy} title={loc.is_archived ? 'Bring back' : 'Archive'}
            className="p-2 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10">
            {loc.is_archived ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-3">
          {loc.upcoming_count > 0 && (
            <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Changes apply to every event here. People booked on the {loc.upcoming_count} upcoming event
              {loc.upcoming_count === 1 ? '' : 's'} will be asked to re-read the shift info.
            </p>
          )}
          <LocationFields value={draft} onChange={setDraft} venueRadius={venue.geofence_radius_meters || 150} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(false); setDraft(locationToDraft(loc)); }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button type="button" onClick={save} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save location'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Phase 27: Venue Settings → Locations tab. Review, add, edit (global) and archive saved locations.
 * Locations are also added automatically when a manager types a new one on the event screen.
 */
export default function VenueLocationsPanel({ venue, onError }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankLocationDraft());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/venues/${venue.id}/locations`, { params: { include_archived: true } });
      setRows(res.data || []);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not load locations.');
    } finally {
      setLoading(false);
    }
  }, [venue.id, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const { payload, error } = draftToPayload(draft);
    if (error) return onError(error);
    setBusy(true);
    try {
      await api.post(`/venues/${venue.id}/locations`, payload);
      setDraft(blankLocationDraft());
      setAdding(false);
      load();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not add location.');
    } finally {
      setBusy(false);
    }
  };

  const visible = rows.filter((r) => showArchived || !r.is_archived);
  const archivedCount = rows.filter((r) => r.is_archived).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Places you staff besides your own address: client sites, off-site events, other rooms. Pick them on
        “Post a shift”. Typing a new place there saves it here automatically.
      </p>

      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No saved locations yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((loc) => (
            <LocationRow key={loc.id} venue={venue} loc={loc} onChanged={load} onError={onError} />
          ))}
        </div>
      )}

      {archivedCount > 0 && (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs text-slate-400 underline hover:text-white">
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}

      {adding ? (
        <div className="p-3 rounded-xl border border-dashed border-slate-600 space-y-3">
          <LocationFields value={draft} onChange={setDraft} venueRadius={venue.geofence_radius_meters || 150} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setDraft(blankLocationDraft()); }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
            <button type="button" onClick={add} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">
              {busy ? 'Saving…' : 'Add location'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="px-3 py-2 rounded-xl border border-dashed border-slate-600 text-xs font-semibold text-emerald-400 hover:border-emerald-500 inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add a location
        </button>
      )}
    </div>
  );
}
