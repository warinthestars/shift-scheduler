import React, { useState } from 'react';
import { Crosshair, ExternalLink, Link2 } from 'lucide-react';
import { getCurrentPosition, parseMapLink } from '../utils/geo';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-semibold text-slate-300 mb-1';

/** Empty draft for a new location. `name` can be pre-filled with what the manager typed. */
export function blankLocationDraft(name = '') {
  return { name, address: '', lat: '', lng: '', radius_meters: '', notes: '' };
}

/** Draft from a saved location (API shape). */
export function locationToDraft(loc) {
  return {
    name: loc?.name || '',
    address: loc?.address || '',
    lat: loc?.lat != null ? String(loc.lat) : '',
    lng: loc?.lng != null ? String(loc.lng) : '',
    radius_meters: loc?.radius_meters != null ? String(loc.radius_meters) : '',
    notes: loc?.notes || '',
  };
}

/**
 * Validates a draft and returns { payload } or { error }.
 * payload matches VenueLocationInput: {name, address, lat, lng, radius_meters, notes}.
 */
export function draftToPayload(d) {
  const name = (d.name || '').trim();
  const address = (d.address || '').trim();
  if (!name) return { error: 'Give the location a name.' };
  if (!address) return { error: "Add the location's address." };
  const lat = d.lat === '' ? null : parseFloat(d.lat);
  const lng = d.lng === '' ? null : parseFloat(d.lng);
  if ((lat === null) !== (lng === null) || (lat !== null && (Number.isNaN(lat) || Number.isNaN(lng)))) {
    return { error: 'Enter both latitude and longitude for the map pin, or leave both blank.' };
  }
  const radius = d.radius_meters === '' ? null : parseInt(d.radius_meters, 10);
  if (radius !== null && (Number.isNaN(radius) || radius < 25 || radius > 5000)) {
    return { error: 'Location radius must be between 25 and 5000 meters (or blank to use the venue radius).' };
  }
  return {
    payload: {
      name,
      address,
      lat,
      lng,
      radius_meters: radius,
      notes: (d.notes || '').trim() || null,
    },
  };
}

/**
 * Phase 27: Form fields for one location. Controlled: `value` is a draft, `onChange(nextDraft)`.
 * The map pin can come from "Use my current location", a pasted Maps link, or typed lat/lng.
 */
export default function LocationFields({ value, onChange, venueRadius = 150, compact = false }) {
  const [locating, setLocating] = useState(false);
  const [pinMsg, setPinMsg] = useState('');
  const [link, setLink] = useState('');
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  const useMyLocation = async () => {
    setPinMsg('');
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      onChange({ ...value, lat: pos.latitude.toFixed(6), lng: pos.longitude.toFixed(6) });
      setPinMsg('Pin set to where you are now.');
    } catch (err) {
      setPinMsg(err.message);
    } finally {
      setLocating(false);
    }
  };

  const applyLink = (text) => {
    setLink(text);
    const hit = parseMapLink(text);
    if (hit) {
      onChange({ ...value, lat: hit.lat.toFixed(6), lng: hit.lng.toFixed(6) });
      setPinMsg('Pin set from the link.');
    }
  };

  const mapUrl = value.lat && value.lng ? `https://www.google.com/maps?q=${value.lat},${value.lng}` : null;

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-1 ${compact ? '' : 'sm:grid-cols-2'} gap-3`}>
        <div>
          <label className={labelCls}>Location name *</label>
          <input value={value.name} onChange={set('name')} className={inputCls} placeholder="Smith Wedding – Oheka Castle" />
        </div>
        <div>
          <label className={labelCls}>Address *</label>
          <input value={value.address} onChange={set('address')} className={inputCls} placeholder="135 W Gate Dr, Huntington, NY" />
        </div>
      </div>

      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-300">Map pin (needed for the clock-in location check)</span>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Crosshair className="w-3 h-3" /> {locating ? 'Locating…' : "I'm there now"}
          </button>
        </div>
        <div className="relative">
          <Link2 className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={link}
            onChange={(e) => applyLink(e.target.value)}
            className={`${inputCls} pl-8`}
            placeholder="…or paste a Google Maps link / “40.85, -73.44”"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>Latitude</label>
            <input value={value.lat} onChange={set('lat')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Longitude</label>
            <input value={value.lng} onChange={set('lng')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Radius (m)</label>
            <input
              type="number"
              min="25"
              max="5000"
              value={value.radius_meters}
              onChange={set('radius_meters')}
              className={inputCls}
              placeholder={String(venueRadius)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {pinMsg && <span className="text-slate-400">{pinMsg}</span>}
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
              Check the pin on Google Maps <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <span className="text-slate-500">Blank radius = venue radius ({venueRadius} m).</span>
        </div>
      </div>

      <div>
        <label className={labelCls}>Location notes (everyone viewing the event sees these)</label>
        <textarea
          rows={2}
          value={value.notes}
          onChange={set('notes')}
          className={inputCls}
          placeholder="e.g. Service entrance on 4th St. Load-in via the freight elevator."
        />
      </div>
    </div>
  );
}
