import React, { useState, useEffect } from 'react';
import {
  X, Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info,
} from 'lucide-react';
import api from '../api/client';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

const POLICIES = [
  {
    id: 'team_auto',
    title: 'Book my team instantly',
    body: "People on this venue's team are confirmed right away. Everyone else waits for a manager.",
  },
  {
    id: 'manual',
    title: 'I approve everyone',
    body: 'Every request waits for a manager to approve it.',
  },
  {
    id: 'everyone_auto',
    title: 'Book anyone instantly',
    body: 'Anyone who picks up a shift is confirmed right away. Best when you need bodies fast.',
  },
];

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-semibold text-slate-300 mb-1';

function emptyForm(venue) {
  return {
    name: venue?.name || '',
    address: venue?.address || '',
    phone: venue?.phone || '',
    timezone: venue?.timezone || 'America/New_York',
    lat: venue?.lat != null ? String(venue.lat) : '',
    lng: venue?.lng != null ? String(venue.lng) : '',
    geofence_radius_meters: String(venue?.geofence_radius_meters ?? 150),
    approval_policy: venue?.approval_policy || 'team_auto',
    auto_approve_rating_threshold:
      venue?.auto_approve_rating_threshold != null ? String(venue.auto_approve_rating_threshold) : '',
    arrival_instructions: venue?.arrival_instructions || '',
    dress_code: venue?.dress_code || '',
    default_shift_notes: venue?.default_shift_notes || '',
    description: venue?.description || '',
    manager_email: '',
  };
}

function PositionRow({ venueId, position, onChanged, onError }) {
  const [draft, setDraft] = useState({
    name: position.name,
    default_rate: Number(position.default_rate).toFixed(2),
    tips_eligible: position.tips_eligible,
    tip_pool: position.tip_pool,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      name: position.name,
      default_rate: Number(position.default_rate).toFixed(2),
      tips_eligible: position.tips_eligible,
      tip_pool: position.tip_pool,
    });
  }, [position]);

  const dirty =
    draft.name !== position.name ||
    Number(draft.default_rate) !== Number(position.default_rate) ||
    draft.tips_eligible !== position.tips_eligible ||
    draft.tip_pool !== position.tip_pool;

  const save = async () => {
    const rate = parseFloat(draft.default_rate);
    if (!draft.name.trim() || !rate || rate <= 0) {
      onError('Each position needs a name and a rate above $0.');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/venues/${venueId}/positions/${position.id}`, {
        name: draft.name.trim(),
        default_rate: rate,
        tips_eligible: draft.tips_eligible,
        tip_pool: draft.tips_eligible ? draft.tip_pool : false,
      });
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save position.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    setSaving(true);
    try {
      if (position.is_active) {
        await api.delete(`/venues/${venueId}/positions/${position.id}`);
      } else {
        await api.patch(`/venues/${venueId}/positions/${position.id}`, { is_active: true });
      }
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not update position.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`p-3 rounded-xl border ${position.is_active ? 'border-slate-700 bg-slate-800/50' : 'border-slate-800 bg-slate-950 opacity-60'} space-y-2`}>
      <div className="flex items-center gap-2">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          disabled={!position.is_active}
          className={`${inputCls} flex-1`}
        />
        <div className="relative w-28">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input
            type="number"
            step="0.5"
            min="0"
            value={draft.default_rate}
            onChange={(e) => setDraft({ ...draft, default_rate: e.target.value })}
            disabled={!position.is_active}
            className={`${inputCls} pl-6`}
          />
        </div>
        <span className="text-xs text-slate-400">/hr</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={draft.tips_eligible}
              disabled={!position.is_active}
              onChange={(e) => setDraft({ ...draft, tips_eligible: e.target.checked, tip_pool: e.target.checked ? draft.tip_pool : false })}
              className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
            />
            Tips
          </label>
          {draft.tips_eligible && (
            <label className="flex items-center gap-2 text-xs text-amber-300">
              <input
                type="checkbox"
                checked={draft.tip_pool}
                disabled={!position.is_active}
                onChange={(e) => setDraft({ ...draft, tip_pool: e.target.checked })}
                className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
              />
              Tip pool
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          {position.is_active && dirty && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          )}
          <button
            type="button"
            onClick={toggleActive}
            disabled={saving}
            title={position.is_active ? 'Remove from the Create Shift list' : 'Bring back'}
            className={`p-2 rounded-lg text-xs ${position.is_active ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10'}`}
          >
            {position.is_active ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VenueSettingsModal({ mode = 'edit', venue = null, showManagerEmail = false, onClose, onSaved }) {
  const isEdit = mode === 'edit' && venue?.id;
  const [tab, setTab] = useState('details'); // 'details' | 'positions'
  const [form, setForm] = useState(emptyForm(venue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);

  const [positions, setPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [newPos, setNewPos] = useState({ name: '', default_rate: '25.00', tips_eligible: false, tip_pool: false });

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const loadPositions = async () => {
    if (!isEdit) return;
    setLoadingPositions(true);
    try {
      const res = await api.get(`/venues/${venue.id}/positions`, { params: { include_inactive: true } });
      setPositions(res.data || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load positions.');
    } finally {
      setLoadingPositions(false);
    }
  };

  useEffect(() => {
    if (tab === 'positions') loadPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const useMyLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError("This browser can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      (err) => {
        setError(err.code === 1 ? 'Location permission was denied. Allow location for this site and try again.' : 'Could not get your location. Try again outside or near a window.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.address.trim()) {
      setError('Name and address are required.');
      return;
    }
    const lat = form.lat === '' ? null : parseFloat(form.lat);
    const lng = form.lng === '' ? null : parseFloat(form.lng);
    if ((lat === null) !== (lng === null) || (lat !== null && (Number.isNaN(lat) || Number.isNaN(lng)))) {
      setError('Enter both latitude and longitude, or use "Use my current location".');
      return;
    }
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      timezone: form.timezone,
      geofence_radius_meters: parseInt(form.geofence_radius_meters, 10) || 150,
      approval_policy: form.approval_policy,
      auto_approve_rating_threshold: form.auto_approve_rating_threshold === '' ? null : parseFloat(form.auto_approve_rating_threshold),
      arrival_instructions: form.arrival_instructions,
      dress_code: form.dress_code,
      default_shift_notes: form.default_shift_notes,
      description: form.description,
    };
    if (lat !== null) {
      payload.lat = lat;
      payload.lng = lng;
    }
    if (!isEdit && showManagerEmail && form.manager_email.trim()) {
      payload.manager_email = form.manager_email.trim();
    }

    setSaving(true);
    try {
      const res = isEdit
        ? await api.put(`/venues/${venue.id}/settings`, payload)
        : await api.post('/venues', payload);
      onSaved && onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save venue.');
    } finally {
      setSaving(false);
    }
  };

  const addPosition = async () => {
    setError('');
    const rate = parseFloat(newPos.default_rate);
    if (!newPos.name.trim() || !rate || rate <= 0) {
      setError('New position needs a name and a rate above $0.');
      return;
    }
    try {
      await api.post(`/venues/${venue.id}/positions`, {
        name: newPos.name.trim(),
        default_rate: rate,
        tips_eligible: newPos.tips_eligible,
        tip_pool: newPos.tips_eligible ? newPos.tip_pool : false,
      });
      setNewPos({ name: '', default_rate: '25.00', tips_eligible: false, tip_pool: false });
      loadPositions();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add position.');
    }
  };

  const mapUrl = form.lat && form.lng ? `https://www.google.com/maps?q=${form.lat},${form.lng}` : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-slate-800">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-400" />
            {isEdit ? `Venue settings — ${venue.name}` : 'Add a venue'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isEdit && (
          <div className="px-6 pt-3 flex gap-2">
            {[
              { id: 'details', label: 'Details' },
              { id: 'positions', label: 'Positions & pay' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                  tab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mx-6 mt-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
        )}

        <div className="overflow-y-auto px-6 py-4 flex-1">
          {tab === 'details' ? (
            <form id="venue-settings-form" onSubmit={handleSave} className="space-y-5">
              <section className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Venue name *</label>
                    <input value={form.name} onChange={set('name')} className={inputCls} placeholder="The Copper & Oak Lounge" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Street address *</label>
                    <input value={form.address} onChange={set('address')} className={inputCls} placeholder="142 Grand St, New York, NY" />
                  </div>
                  <div>
                    <label className={labelCls}>Venue phone</label>
                    <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="(555) 555-0100" />
                  </div>
                  <div>
                    <label className={labelCls}>Timezone</label>
                    <select value={form.timezone} onChange={set('timezone')} className={inputCls}>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="space-y-2 p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <MapPin className="w-4 h-4 text-emerald-400" /> Location for clock-in
                  </div>
                  <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={locating}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {locating ? 'Locating…' : 'Use my current location'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">Easiest while you're standing inside the venue. Staff must be within the radius to clock in (coming soon).</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>Latitude</label>
                    <input value={form.lat} onChange={set('lat')} className={inputCls} placeholder="40.7205" />
                  </div>
                  <div>
                    <label className={labelCls}>Longitude</label>
                    <input value={form.lng} onChange={set('lng')} className={inputCls} placeholder="-74.0011" />
                  </div>
                  <div>
                    <label className={labelCls}>Radius (m)</label>
                    <input type="number" min="25" max="5000" value={form.geofence_radius_meters} onChange={set('geofence_radius_meters')} className={inputCls} />
                  </div>
                </div>
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                    Check this spot on Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </section>

              <section className="space-y-2">
                <label className={labelCls}>How should shift requests be approved?</label>
                <div className="grid gap-2">
                  {POLICIES.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                        form.approval_policy === p.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="approval_policy"
                        value={p.id}
                        checked={form.approval_policy === p.id}
                        onChange={set('approval_policy')}
                        className="mt-1 text-emerald-500"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-white">{p.title}</span>
                        <span className="block text-xs text-slate-400">{p.body}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <details className="text-xs text-slate-400">
                  <summary className="cursor-pointer select-none">Advanced: also auto-approve highly rated workers</summary>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      max="5"
                      value={form.auto_approve_rating_threshold}
                      onChange={set('auto_approve_rating_threshold')}
                      placeholder="e.g. 4.5"
                      className={`${inputCls} w-32`}
                    />
                    <span>★ or higher (only workers who have been rated). Leave blank to turn off.</span>
                  </div>
                </details>
              </section>

              <section className="space-y-3">
                <div>
                  <label className={labelCls}>Arrival instructions</label>
                  <textarea rows={2} value={form.arrival_instructions} onChange={set('arrival_instructions')} className={inputCls} placeholder="Staff entrance on Mercer St. Street parking only. Check in with the bar lead." />
                </div>
                <div>
                  <label className={labelCls}>Dress code</label>
                  <textarea rows={2} value={form.dress_code} onChange={set('dress_code')} className={inputCls} placeholder="All black, non-slip shoes. Hair tied back." />
                </div>
                <div>
                  <label className={labelCls}>Default notes added to new shifts</label>
                  <textarea rows={2} value={form.default_shift_notes} onChange={set('default_shift_notes')} className={inputCls} placeholder="Family meal at 4:30. Bring a wine key." />
                </div>
                <div>
                  <label className={labelCls}>About this venue</label>
                  <textarea rows={2} value={form.description} onChange={set('description')} className={inputCls} />
                </div>
                {!isEdit && showManagerEmail && (
                  <div>
                    <label className={labelCls}>Manager email (optional)</label>
                    <input type="email" value={form.manager_email} onChange={set('manager_email')} className={inputCls} placeholder="manager@example.com" />
                    <p className="text-[10px] text-slate-500 mt-1">Must be an existing account. You can also assign a manager later from Users → Edit.</p>
                  </div>
                )}
                {!isEdit && (
                  <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    Starter positions (Bartender, Server, Barback, Dishwasher, AV Tech) are added automatically. Edit their pay under Venue settings → Positions & pay.
                  </p>
                )}
              </section>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                These show up in the Create Shift form and pre-fill the pay and tips. Changing a rate here does not change shifts you already posted.
              </p>
              {loadingPositions ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : (
                positions.map((p) => (
                  <PositionRow key={p.id} venueId={venue.id} position={p} onChanged={loadPositions} onError={setError} />
                ))
              )}
              <div className="p-3 rounded-xl border border-dashed border-slate-600 space-y-2">
                <div className="text-xs font-semibold text-slate-300">Add a position</div>
                <div className="flex items-center gap-2">
                  <input
                    value={newPos.name}
                    onChange={(e) => setNewPos({ ...newPos, name: e.target.value })}
                    placeholder="e.g. Coat Check"
                    className={`${inputCls} flex-1`}
                  />
                  <div className="relative w-28">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={newPos.default_rate}
                      onChange={(e) => setNewPos({ ...newPos, default_rate: e.target.value })}
                      className={`${inputCls} pl-6`}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={newPos.tips_eligible}
                        onChange={(e) => setNewPos({ ...newPos, tips_eligible: e.target.checked, tip_pool: e.target.checked ? newPos.tip_pool : false })}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
                      />
                      Tips
                    </label>
                    {newPos.tips_eligible && (
                      <label className="flex items-center gap-2 text-xs text-amber-300">
                        <input
                          type="checkbox"
                          checked={newPos.tip_pool}
                          onChange={(e) => setNewPos({ ...newPos, tip_pool: e.target.checked })}
                          className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
                        />
                        Tip pool
                      </label>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={addPosition}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            {tab === 'positions' ? 'Done' : 'Cancel'}
          </button>
          {tab === 'details' && (
            <button
              type="submit"
              form="venue-settings-form"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create venue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
