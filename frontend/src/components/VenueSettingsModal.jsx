import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

const POLICIES = [
  { id: 'team_auto', title: 'Book my team instantly', body: "People on this venue's team are confirmed right away. Everyone else waits for a manager." },
  { id: 'manual', title: 'I approve everyone', body: 'Every request waits for a manager to approve it.' },
  { id: 'everyone_auto', title: 'Book anyone instantly', body: 'Anyone who picks up a shift is confirmed right away.' },
];

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-semibold text-slate-300 mb-1';
const cardCls = 'p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3';

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
    show_rates_publicly: venue?.show_rates_publicly ?? true,
    auto_approve_rating_threshold:
      venue?.auto_approve_rating_threshold != null ? String(venue.auto_approve_rating_threshold) : '',
    arrival_instructions: venue?.arrival_instructions || '',
    dress_code: venue?.dress_code || '',
    default_shift_notes: venue?.default_shift_notes || '',
    description: venue?.description || '',
    manager_email: '',
  };
}

function toDraft(p) {
  return {
    name: p.name,
    default_rate: Number(p.default_rate).toFixed(2),
    default_rate_max: p.default_rate_max != null ? Number(p.default_rate_max).toFixed(2) : '',
    hide_rate: !!p.hide_rate,
    tips_eligible: !!p.tips_eligible,
    tip_pool: !!p.tip_pool,
  };
}

function PositionCard({ venueId, position, onChanged, onError }) {
  const [draft, setDraft] = useState(toDraft(position));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(toDraft(position)), [position]);

  const original = toDraft(position);
  const dirty = JSON.stringify(original) !== JSON.stringify(draft);
  const disabled = !position.is_active;

  const save = async () => {
    const lo = parseFloat(draft.default_rate);
    const hi = draft.default_rate_max === '' ? null : parseFloat(draft.default_rate_max);
    if (!draft.name.trim() || !lo || lo <= 0) return onError('Each position needs a name and pay above $0.');
    if (hi !== null && (Number.isNaN(hi) || hi < lo)) return onError("The top of the pay range can't be lower than the bottom.");
    setSaving(true);
    try {
      await api.patch(`/venues/${venueId}/positions/${position.id}`, {
        name: draft.name.trim(),
        default_rate: lo,
        default_rate_max: hi !== null && hi > lo ? hi : null,
        hide_rate: draft.hide_rate,
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
      if (position.is_active) await api.delete(`/venues/${venueId}/positions/${position.id}`);
      else await api.patch(`/venues/${venueId}/positions/${position.id}`, { is_active: true });
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not update position.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`p-3 rounded-xl border space-y-2 ${disabled ? 'border-slate-800 bg-slate-950 opacity-60' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className="flex items-center gap-2">
        <input value={draft.name} disabled={disabled} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${inputCls} flex-1`} />
        <button
          type="button"
          onClick={toggleActive}
          disabled={saving}
          title={position.is_active ? 'Remove from the Post a Shift list' : 'Bring back'}
          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
        >
          {position.is_active ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-24">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input type="number" step="0.5" min="0" disabled={disabled} value={draft.default_rate}
            onChange={(e) => setDraft({ ...draft, default_rate: e.target.value })} className={`${inputCls} pl-6`} />
        </div>
        <span className="text-xs text-slate-400">to</span>
        <div className="relative w-24">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input type="number" step="0.5" min="0" disabled={disabled} value={draft.default_rate_max} placeholder="—"
            onChange={(e) => setDraft({ ...draft, default_rate_max: e.target.value })} className={`${inputCls} pl-6`} />
        </div>
        <span className="text-xs text-slate-400">/hr</span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" disabled={disabled} checked={draft.tips_eligible}
            onChange={(e) => setDraft({ ...draft, tips_eligible: e.target.checked, tip_pool: e.target.checked ? draft.tip_pool : false })}
            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
          Tips
        </label>
        {draft.tips_eligible && (
          <label className="flex items-center gap-2 text-xs text-amber-300">
            <input type="checkbox" disabled={disabled} checked={draft.tip_pool}
              onChange={(e) => setDraft({ ...draft, tip_pool: e.target.checked })}
              className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
            Tip pool
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" disabled={disabled} checked={draft.hide_rate}
            onChange={(e) => setDraft({ ...draft, hide_rate: e.target.checked })}
            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
          <EyeOff className="w-3.5 h-3.5" /> Hide pay
        </label>
        {position.is_active && dirty && (
          <button type="button" onClick={save} disabled={saving}
            className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        )}
      </div>
    </div>
  );
}

export default function VenueSettingsModal({ mode = 'edit', venue = null, showManagerEmail = false, onClose, onSaved }) {
  const isEdit = mode === 'edit' && !!venue?.id;
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(emptyForm(venue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [positions, setPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [newPos, setNewPos] = useState({ name: '', default_rate: '25.00', default_rate_max: '', hide_rate: false, tips_eligible: false, tip_pool: false });

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
    if (!navigator.geolocation) return setError("This browser can't share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
      },
      (err) => {
        setError(err.code === 1 ? 'Location permission was denied. Allow location for this site and try again.' : 'Could not get your location. Try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSave = async () => {
    setError('');
    if (!form.name.trim() || !form.address.trim()) return setError('Name and address are required.');
    const lat = form.lat === '' ? null : parseFloat(form.lat);
    const lng = form.lng === '' ? null : parseFloat(form.lng);
    if ((lat === null) !== (lng === null) || (lat !== null && (Number.isNaN(lat) || Number.isNaN(lng)))) {
      return setError('Enter both latitude and longitude, or use "Use my current location".');
    }
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      timezone: form.timezone,
      geofence_radius_meters: parseInt(form.geofence_radius_meters, 10) || 150,
      approval_policy: form.approval_policy,
      show_rates_publicly: !!form.show_rates_publicly,
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
    if (!isEdit && showManagerEmail && form.manager_email.trim()) payload.manager_email = form.manager_email.trim();

    setSaving(true);
    try {
      const res = isEdit ? await api.put(`/venues/${venue.id}/settings`, payload) : await api.post('/venues', payload);
      onSaved && onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save venue.');
    } finally {
      setSaving(false);
    }
  };

  const addPosition = async () => {
    setError('');
    const lo = parseFloat(newPos.default_rate);
    const hi = newPos.default_rate_max === '' ? null : parseFloat(newPos.default_rate_max);
    if (!newPos.name.trim() || !lo || lo <= 0) return setError('New position needs a name and pay above $0.');
    if (hi !== null && (Number.isNaN(hi) || hi < lo)) return setError("The top of the pay range can't be lower than the bottom.");
    try {
      await api.post(`/venues/${venue.id}/positions`, {
        name: newPos.name.trim(),
        default_rate: lo,
        default_rate_max: hi !== null && hi > lo ? hi : null,
        hide_rate: newPos.hide_rate,
        tips_eligible: newPos.tips_eligible,
        tip_pool: newPos.tips_eligible ? newPos.tip_pool : false,
      });
      setNewPos({ name: '', default_rate: '25.00', default_rate_max: '', hide_rate: false, tips_eligible: false, tip_pool: false });
      loadPositions();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add position.');
    }
  };

  const mapUrl = form.lat && form.lng ? `https://www.google.com/maps?q=${form.lat},${form.lng}` : null;

  const tabs = isEdit ? (
    <div className="flex gap-2">
      {[{ id: 'details', label: 'Details' }, { id: 'positions', label: 'Positions & pay' }].map((t) => (
        <button key={t.id} type="button" onClick={() => setTab(t.id)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
          {t.label}
        </button>
      ))}
    </div>
  ) : null;

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        {tab === 'positions' ? 'Done' : 'Cancel'}
      </button>
      {tab === 'details' && (
        <button type="button" onClick={handleSave} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create venue'}
        </button>
      )}
    </>
  );

  return (
    <ModalShell
      title={isEdit ? `Venue settings — ${venue.name}` : 'Add a venue'}
      icon={<Building2 className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      headerExtra={tabs}
      footer={footer}
    >
      {error && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}

      {tab === 'details' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left column */}
          <div className="space-y-4">
            <div className={cardCls}>
              <div>
                <label className={labelCls}>Venue name *</label>
                <input value={form.name} onChange={set('name')} className={inputCls} placeholder="The Copper & Oak Lounge" />
              </div>
              <div>
                <label className={labelCls}>Street address *</label>
                <input value={form.address} onChange={set('address')} className={inputCls} placeholder="142 Grand St, New York, NY" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Venue phone</label>
                  <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="(555) 555-0100" />
                </div>
                <div>
                  <label className={labelCls}>Timezone</label>
                  <select value={form.timezone} onChange={set('timezone')} className={inputCls}>
                    {TIMEZONE_OPTIONS.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className={cardCls}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <MapPin className="w-4 h-4 text-emerald-400" /> Location for clock-in
                </div>
                <button type="button" onClick={useMyLocation} disabled={locating}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Crosshair className="w-3.5 h-3.5" /> {locating ? 'Locating…' : 'Use my current location'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Latitude</label>
                  <input value={form.lat} onChange={set('lat')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Longitude</label>
                  <input value={form.lng} onChange={set('lng')} className={inputCls} />
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
            </div>

            <div className={cardCls}>
              <div>
                <label className={labelCls}>Venue notes (shown on every shift)</label>
                <textarea rows={3} value={form.default_shift_notes} onChange={set('default_shift_notes')} className={inputCls}
                  placeholder="Family meal at 4:30. Phones stay in lockers." />
              </div>
              <div>
                <label className={labelCls}>About this venue (public)</label>
                <textarea rows={2} value={form.description} onChange={set('description')} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className={cardCls}>
              <label className={labelCls}>How should shift requests be approved?</label>
              <div className="grid gap-2">
                {POLICIES.map((p) => (
                  <label key={p.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${form.approval_policy === p.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'}`}>
                    <input type="radio" name="approval_policy" value={p.id} checked={form.approval_policy === p.id} onChange={set('approval_policy')} className="mt-1 text-emerald-500" />
                    <span>
                      <span className="block text-sm font-semibold text-white">{p.title}</span>
                      <span className="block text-xs text-slate-400">{p.body}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">Each posted shift and position can override this.</p>
              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer select-none">Advanced: also auto-approve highly rated workers</summary>
                <div className="mt-2 flex items-center gap-2">
                  <input type="number" step="0.1" min="1" max="5" value={form.auto_approve_rating_threshold}
                    onChange={set('auto_approve_rating_threshold')} placeholder="e.g. 4.5" className={`${inputCls} w-28`} />
                  <span>★ or higher (rated workers only). Blank = off.</span>
                </div>
              </details>
            </div>

            <div className={cardCls}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={!!form.show_rates_publicly}
                  onChange={(e) => setForm({ ...form, show_rates_publicly: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">Show default pay on the public venue page</span>
                  <span className="block text-xs text-slate-400">Positions marked "Hide pay" stay hidden either way.</span>
                </span>
              </label>
            </div>

            <div className={cardCls}>
              <div>
                <label className={labelCls}>Arrival instructions (only booked staff see these)</label>
                <textarea rows={3} value={form.arrival_instructions} onChange={set('arrival_instructions')} className={inputCls}
                  placeholder="Staff entrance on Mercer St. Door code 4521." />
              </div>
              <div>
                <label className={labelCls}>Dress code</label>
                <textarea rows={2} value={form.dress_code} onChange={set('dress_code')} className={inputCls}
                  placeholder="All black, non-slip shoes." />
              </div>
              {!isEdit && showManagerEmail && (
                <div>
                  <label className={labelCls}>Manager email (optional)</label>
                  <input type="email" value={form.manager_email} onChange={set('manager_email')} className={inputCls} placeholder="manager@example.com" />
                  <p className="text-[10px] text-slate-500 mt-1">Must be an existing account.</p>
                </div>
              )}
              {!isEdit && (
                <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  Starter positions are added automatically. Edit their pay under Venue settings → Positions & pay.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            These fill in pay and tips when you post a shift. Changing them doesn't change shifts you already posted. "Hide pay" keeps the rate off listings until someone is booked.
          </p>
          {loadingPositions ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {positions.map((p) => (
                <PositionCard key={p.id} venueId={venue.id} position={p} onChanged={loadPositions} onError={setError} />
              ))}
            </div>
          )}
          <div className="p-3 rounded-xl border border-dashed border-slate-600 space-y-2">
            <div className="text-xs font-semibold text-slate-300">Add a position</div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={newPos.name} onChange={(e) => setNewPos({ ...newPos, name: e.target.value })} placeholder="e.g. Coat Check" className={`${inputCls} flex-1 min-w-[10rem]`} />
              <div className="relative w-24">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                <input type="number" step="0.5" min="0" value={newPos.default_rate} onChange={(e) => setNewPos({ ...newPos, default_rate: e.target.value })} className={`${inputCls} pl-6`} />
              </div>
              <span className="text-xs text-slate-400">to</span>
              <div className="relative w-24">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                <input type="number" step="0.5" min="0" value={newPos.default_rate_max} placeholder="—" onChange={(e) => setNewPos({ ...newPos, default_rate_max: e.target.value })} className={`${inputCls} pl-6`} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={newPos.tips_eligible}
                  onChange={(e) => setNewPos({ ...newPos, tips_eligible: e.target.checked, tip_pool: e.target.checked ? newPos.tip_pool : false })}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
                Tips
              </label>
              {newPos.tips_eligible && (
                <label className="flex items-center gap-2 text-xs text-amber-300">
                  <input type="checkbox" checked={newPos.tip_pool} onChange={(e) => setNewPos({ ...newPos, tip_pool: e.target.checked })}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
                  Tip pool
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={newPos.hide_rate} onChange={(e) => setNewPos({ ...newPos, hide_rate: e.target.checked })}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
                <EyeOff className="w-3.5 h-3.5" /> Hide pay
              </label>
              <button type="button" onClick={addPosition}
                className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
