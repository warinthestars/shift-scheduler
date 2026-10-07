import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users, RotateCcw, Lock, MapPin, AlertTriangle, LayoutTemplate, Send, Save, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { payText } from './PayLabel';
import EventLocationPicker from './EventLocationPicker';
import { draftToPayload } from './LocationFields';
import { zonedLocalToUtcIso, utcToZonedLocalInput } from '../utils/venueTime';

const CUSTOM = '__custom__';

const APPROVAL_OPTIONS = [
  { value: 'venue_default', label: 'Use venue setting' },
  { value: 'auto', label: 'Book instantly' },
  { value: 'manual', label: 'Needs my approval' },
];
const POLICY_TEXT = {
  team_auto: 'your team is booked instantly, everyone else needs approval',
  manual: 'you approve every request',
  everyone_auto: 'anyone who picks it up is booked instantly',
};

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500';
const labelCls = 'block text-xs font-semibold text-slate-300 mb-1';

function tipsText(p) {
  if (!p?.tips_eligible) return '';
  return p.tip_pool ? 'pooled tips' : 'tips';
}

function optionLabel(p) {
  const parts = [payText(p.default_rate, p.default_rate_max)];
  const t = tipsText(p);
  if (t) parts.push(t);
  if (p.hide_rate) parts.push('pay hidden');
  return `${p.name} — ${parts.filter(Boolean).join(' · ')}`;
}

function defaultsFor(pos) {
  return {
    hourly_rate: pos ? Number(pos.default_rate).toFixed(2) : '25.00',
    hourly_rate_max: pos?.default_rate_max != null ? Number(pos.default_rate_max).toFixed(2) : '',
    hide_rate: !!pos?.hide_rate,
    tips_eligible: !!pos?.tips_eligible,
    tip_pool: !!pos?.tip_pool,
  };
}

// Phase 29.3: plain 'YYYY-MM-DDTHH:MM' arithmetic (no timezone involved)
function shiftLocal(localValue, ms) {
  const [d, t] = localValue.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  const out = new Date(Date.UTC(y, m - 1, day, hh, mm) + ms);
  return out.toISOString().slice(0, 16);
}
function localMs(localValue) {
  const [d, t] = localValue.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, day, hh, mm);
}

// Phase 37.2: each shift's own start (call) time. A row keeps it as `offset`: minutes after (+) or before (-)
// the event's start, so it moves with the event. 0 = starts when the event starts.
const DAY_MIN = 1440;
function clockMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}
function clockText(totalMinutes) {
  const m = ((totalMinutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/**
 * A typed clock time as minutes from the event's start (0.37.3).
 * It is read as a time on the day the event starts, however long the event runs:
 *   earlier than the event's start -> before it    (event 9:00 AM, typed 8:00 AM  ->  -60)
 *   later than the event's start   -> after it     (event 9:00 AM, typed 2:00 PM  ->  +300)
 * One exception keeps overnight events working: a time more than 12 hours before the start is
 * the next day (event 10:00 PM, typed 1:00 AM -> +180). 12 hours early is the most a shift may be.
 */
function offsetFor(typed, eventClock) {
  const t = clockMinutes(typed);
  const b = clockMinutes(eventClock);
  if (t === null || b === null) return 0;
  const d = t - b;
  return d < -720 ? d + DAY_MIN : d;
}
function gapText(minutes) {
  const a = Math.abs(minutes);
  const parts = [];
  if (Math.floor(a / 60)) parts.push(`${Math.floor(a / 60)} hr`);
  if (a % 60) parts.push(`${a % 60} min`);
  return `${parts.join(' ')} ${minutes < 0 ? 'before' : 'after'} the event starts`;
}

let rowSeq = 0;
function rowFromPosition(p, withIds = false) {
  rowSeq += 1;
  return {
    key: withIds && p.shift_id ? p.shift_id : `tpl-${rowSeq}`,
    shift_id: withIds ? p.shift_id || null : null,
    role_type: p.role_type,
    custom: false,
    capacity: p.capacity,
    hourly_rate: Number(p.hourly_rate).toFixed(2),
    hourly_rate_max: p.hourly_rate_max != null ? Number(p.hourly_rate_max).toFixed(2) : '',
    hide_rate: !!p.hide_rate,
    tips_eligible: !!p.tips_eligible,
    tip_pool: !!p.tip_pool,
    role_notes: p.role_notes || '',
    staff_notes: p.staff_notes || '',
    approval_mode: p.approval_mode || 'venue_default',
    booked: withIds ? p.assigned_count || 0 : 0,
    pending: withIds ? p.pending_count || 0 : 0,
    showNotes: !!(p.role_notes || p.staff_notes),
    offset: Number(p.start_offset_minutes) || 0,       // Phase 37.2 (templates store it as start_offset_minutes)
  };
}

function blankRow(pos) {
  rowSeq += 1;
  return {
    key: `new-${rowSeq}`,
    shift_id: null,
    role_type: pos?.name || '',
    custom: !pos,
    capacity: 1,
    ...defaultsFor(pos),
    role_notes: '',
    staff_notes: '',
    approval_mode: 'venue_default',
    booked: 0,
    pending: 0,
    showNotes: false,
    offset: 0,                                           // Phase 37.2: a new shift starts when the event starts
  };
}

/**
 * Post / edit an event (Phase 25.2+), and Phase 29.3:
 *   mode 'create'   : "Start from a template" picker; Save as draft or Publish. templateId preselects one.
 *   mode 'edit'     : a draft shows Save draft + Save & publish; a published event shows Save changes.
 *   mode 'template' : edit or create an event template (template = existing one, or null for new).
 *                     Times are just start/end clock times; onSaved(savedTemplate).
 * onSaved(result) gets the saved event (EventDetail, with .status) or template.
 */
export default function ShiftEventFormModal({
  mode = 'create', venue, positions = null, eventId = null, templateId = null, template = null, onClose, onSaved,
}) {
  const tz = venue?.timezone;
  const isEdit = mode === 'edit' && !!eventId;
  const isTemplate = mode === 'template';
  const isCreate = !isEdit && !isTemplate;

  // ---- Positions: use the prop if given, otherwise load them for this venue ----
  const [fetchedPositions, setFetchedPositions] = useState(null);
  const hasPropPositions = Array.isArray(positions) && positions.length > 0;
  useEffect(() => {
    if (hasPropPositions || !venue?.id) return;
    let active = true;
    api
      .get(`/venues/${venue.id}/positions`)
      .then((res) => active && setFetchedPositions(res.data || []))
      .catch(() => active && setFetchedPositions([]));
    return () => {
      active = false;
    };
  }, [hasPropPositions, venue?.id]);

  const activePositions = useMemo(() => {
    const src = hasPropPositions ? positions : fetchedPositions || [];
    return src.filter((p) => p.is_active !== false);
  }, [hasPropPositions, positions, fetchedPositions]);
  const positionsLoading = !hasPropPositions && fetchedPositions === null;
  const findPos = (name) => activePositions.find((p) => p.name === name);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [staffNotes, setStaffNotes] = useState(''); // Phase 26.2: confirmed staff only
  // Phase 27: where, clock-in location check, event-specific location notes (confirmed staff only)
  const [where, setWhere] = useState({ kind: 'venue' });
  const [geofenceMode, setGeofenceMode] = useState('venue_default');
  const [locStaffOn, setLocStaffOn] = useState(false);
  const [locStaffNotes, setLocStaffNotes] = useState('');
  const [rows, setRows] = useState(() => (isEdit ? [] : isTemplate && template ? template.positions.map((p) => rowFromPosition(p)) : [blankRow(null)]));
  const [touched, setTouched] = useState(isTemplate && !!template);
  // Phase 29.3
  const [eventStatus, setEventStatus] = useState('published');   // edit mode: the event's status
  const [templates, setTemplates] = useState([]);                  // create mode: the venue's templates
  const [pickedTemplate, setPickedTemplate] = useState('');
  const [templateNote, setTemplateNote] = useState('');
  const [pickerKey, setPickerKey] = useState(0);                   // remounts the location picker after a template fills it
  const [tplName, setTplName] = useState(template?.name || '');
  const [tplStart, setTplStart] = useState(template?.start_local || '18:00');
  const [tplEnd, setTplEnd] = useState(template?.end_local || '23:00');

  // Phase 29.3: template mode starts from the template's own values
  useEffect(() => {
    if (!isTemplate || !template) return;
    setTitle(template.title || '');
    setNotes(template.notes || '');
    setStaffNotes(template.staff_notes || '');
    setWhere(template.location && !template.location.is_archived ? { kind: 'saved', location: template.location } : { kind: 'venue' });
    setGeofenceMode(template.geofence_mode || 'venue_default');
    setLocStaffNotes(template.location_staff_notes || '');
    setLocStaffOn(!!template.location_staff_notes);
    if (template.location?.is_archived) setTemplateNote(`“${template.location.name}” is archived, so this template now uses the venue address.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 29.3: the venue's templates, for "Start from a template" (create mode)
  useEffect(() => {
    if (!isCreate || !venue?.id) return undefined;
    let active = true;
    api
      .get(`/venues/${venue.id}/event-templates`)
      .then((res) => {
        if (!active) return;
        const list = res.data || [];
        setTemplates(list);
        const pre = templateId && list.find((t) => t.id === templateId);
        if (pre) applyTemplate(pre);
      })
      .catch(() => active && setTemplates([]));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, venue?.id, templateId]);

  const applyTemplate = (tpl) => {
    setPickedTemplate(tpl.id);
    setTouched(true);
    setTitle(tpl.title || '');
    setNotes(tpl.notes || '');
    setStaffNotes(tpl.staff_notes || '');
    setGeofenceMode(tpl.geofence_mode || 'venue_default');
    setLocStaffNotes(tpl.location_staff_notes || '');
    setLocStaffOn(!!tpl.location_staff_notes);
    const archived = tpl.location && tpl.location.is_archived;
    setWhere(tpl.location && !archived ? { kind: 'saved', location: tpl.location } : { kind: 'venue' });
    setPickerKey((k) => k + 1);
    setRows(tpl.positions.length ? tpl.positions.map((p) => rowFromPosition(p)) : [blankRow(null)]);
    // Keep the date already picked (or tomorrow), use the template's clock times
    const day = start ? start.slice(0, 10) : utcToZonedLocalInput(new Date(Date.now() + 86400000).toISOString(), tz).slice(0, 10);
    const s = `${day}T${tpl.start_local}`;
    const e = tpl.overnight ? `${shiftLocal(`${day}T00:00`, 86400000).slice(0, 10)}T${tpl.end_local}` : `${day}T${tpl.end_local}`;
    setStart(s);
    setEnd(e);
    setTemplateNote(
      `Filled in from “${tpl.name}”. Check the date` +
      (archived ? `. Its location “${tpl.location.name}” is archived, so the venue address is used.` : '.')
    );
  };

  // Phase 29.3: moving the start keeps the event's length (so changing the date moves the end too)
  const changeStart = (value) => {
    if (start && end && value && value.length >= 16) {
      const dur = localMs(end) - localMs(start);
      if (dur > 0) setEnd(shiftLocal(value, dur));
    }
    setStart(value);
  };

  // Auto-fill the first empty row once the venue's positions arrive (create mode only)
  useEffect(() => {
    if (isEdit || touched || activePositions.length === 0) return;
    setRows((rs) => (rs.length === 1 && !rs[0].role_type ? [blankRow(activePositions[0])] : rs));
  }, [isEdit, touched, activePositions]);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api
      .get(`/events/${eventId}`)
      .then((res) => {
        const ev = res.data;
        setEventStatus(ev.status || 'published');    // Phase 29.3
        setTitle(ev.title || '');
        const evStartLocal = utcToZonedLocalInput(ev.start_time, tz);
        setStart(evStartLocal);
        setEnd(utcToZonedLocalInput(ev.end_time, tz));
        setNotes(ev.notes || '');
        setStaffNotes(ev.staff_notes || '');
        setWhere(ev.location ? { kind: 'saved', location: ev.location } : { kind: 'venue' });
        setGeofenceMode(ev.geofence_mode || 'venue_default');
        setLocStaffNotes(ev.location_staff_notes || '');
        setLocStaffOn(!!ev.location_staff_notes);
        setRows(
          (ev.positions || []).map((p) => ({
            key: p.shift_id,
            shift_id: p.shift_id,
            role_type: p.role_type,
            custom: false,
            capacity: p.capacity,
            hourly_rate: Number(p.hourly_rate).toFixed(2),
            hourly_rate_max: p.hourly_rate_max != null ? Number(p.hourly_rate_max).toFixed(2) : '',
            hide_rate: !!p.hide_rate,
            tips_eligible: !!p.tips_eligible,
            tip_pool: !!p.tip_pool,
            role_notes: p.role_notes || '',
            staff_notes: p.staff_notes || '',
            approval_mode: p.approval_mode || 'venue_default',
            booked: p.assigned_count || 0,
            pending: p.pending_count || 0,
            showNotes: !!(p.role_notes || p.staff_notes),
            // Phase 37.2: this shift's own start, as minutes from the event's start (venue clock)
            offset: p.start_time ? Math.round((localMs(utcToZonedLocalInput(p.start_time, tz)) - localMs(evStartLocal)) / 60000) : 0,
          }))
        );
      })
      .catch((err) => setError(err.response?.data?.detail || 'Could not load this event.'))
      .finally(() => setLoading(false));
  }, [isEdit, eventId, tz]);

  const updateRow = (key, patch) => {
    setTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const pickPosition = (key, value) => {
    if (value === CUSTOM) {
      updateRow(key, { custom: true, role_type: '' });
      return;
    }
    const pos = findPos(value);
    updateRow(key, { custom: false, role_type: value, ...(pos ? defaultsFor(pos) : {}) });
  };

  const resetToDefault = (key, name) => {
    const pos = findPos(name);
    if (pos) updateRow(key, defaultsFor(pos));
  };

  const addRow = () => {
    setTouched(true);
    const used = new Set(rows.map((r) => r.role_type));
    const next = activePositions.find((p) => !used.has(p.name)) || activePositions[0] || null;
    setRows((rs) => [...rs, blankRow(next)]);
  };

  const removeRow = (key) => {
    setTouched(true);
    setRows((rs) => rs.filter((r) => r.key !== key));
  };

  const eventApproval = useMemo(() => {
    const modes = new Set(rows.map((r) => r.approval_mode));
    return modes.size === 1 ? [...modes][0] : 'mixed';
  }, [rows]);

  const setAllApproval = (value) => {
    if (value === 'mixed') return;
    setTouched(true);
    setRows((rs) => rs.map((r) => ({ ...r, approval_mode: value })));
  };

  const anyBooked = rows.some((r) => (r.booked || 0) + (r.pending || 0) > 0);

  // Phase 37.2: the event's start as a clock time ('18:00'); every shift's call time is shown relative to it
  const eventClock = isTemplate ? tplStart : (start && start.length >= 16 ? start.slice(11, 16) : '');

  // Phase 27: effective clock-in location check for this event
  const venueGeoOn = !!venue?.geofence_enabled;
  const geoOn = geofenceMode === 'on' || (geofenceMode === 'venue_default' && venueGeoOn);

  /** publish: create -> publish now (false = draft); edit of a draft -> also publish after saving. */
  const handleSubmit = async (publish = true) => {
    setError('');
    if (isTemplate && !tplName.trim()) return setError('Give the template a name.');
    if (!title.trim()) return setError('Give the event a name.');
    let startIso = null;
    let endIso = null;
    if (isTemplate) {
      if (!tplStart || !tplEnd) return setError('Pick a start and end time.');
      if (tplStart === tplEnd) return setError("The end time can't be the same as the start time.");
    } else {
      if (!start || !end) return setError('Pick a start and end time.');
      startIso = zonedLocalToUtcIso(start, tz);
      endIso = zonedLocalToUtcIso(end, tz);
      if (new Date(endIso) <= new Date(startIso)) return setError('End time must be after the start time.');
    }
    if (rows.length === 0) return setError('Add at least one shift.');

    const payloadPositions = [];
    for (const r of rows) {
      const name = (r.role_type || '').trim();
      const lo = parseFloat(r.hourly_rate);
      const hi = r.hourly_rate_max === '' ? null : parseFloat(r.hourly_rate_max);
      const cap = parseInt(r.capacity, 10) || 1;
      if (!name) return setError('Pick a position for every shift.');
      if (!lo || lo <= 0) return setError(`${name}: pay must be more than $0.`);
      if (hi !== null && (Number.isNaN(hi) || hi < lo)) return setError(`${name}: the top of the pay range can't be lower than the bottom.`);
      if (cap < (r.booked || 0)) return setError(`${name}: ${r.booked} people are already booked, so it needs at least ${r.booked} spots.`);
      // Phase 37.2: this shift's own start (call) time
      const offset = Number(r.offset) || 0;
      let rowStartIso = null;
      if (offset < -720) return setError(`${name}: its call time can be at most 12 hours before the event starts.`);
      if (isTemplate) {
        const length = (((clockMinutes(tplEnd) - clockMinutes(tplStart)) % DAY_MIN) + DAY_MIN) % DAY_MIN;
        if (offset >= length) return setError(`${name}: its call time must be before the event ends.`);
      } else {
        rowStartIso = offset ? zonedLocalToUtcIso(shiftLocal(start, offset * 60000), tz) : startIso;
        if (new Date(rowStartIso) >= new Date(endIso)) return setError(`${name}: its call time must be before the event ends.`);
      }
      payloadPositions.push({
        shift_id: r.shift_id || undefined,
        role_type: name,
        capacity: cap,
        hourly_rate: lo,
        hourly_rate_max: hi !== null && hi > lo ? hi : null,
        hide_rate: !!r.hide_rate,
        tips_eligible: !!r.tips_eligible,
        tip_pool: r.tips_eligible ? !!r.tip_pool : false,
        role_notes: (r.role_notes || '').trim() || null,
        staff_notes: (r.staff_notes || '').trim() || null,
        approval_mode: r.approval_mode,
        start_time: rowStartIso,           // Phase 37.2 (events)
        offset,                            // Phase 37.2 (templates; taken out of the event's payload below)
      });
    }

    // Phase 27: where + location check
    let locationFields = { location_id: null, new_location: null };
    if (where.kind === 'saved') {
      locationFields = { location_id: where.location.id, new_location: null };
    } else if (where.kind === 'new') {
      const { payload, error: locError } = draftToPayload(where.draft);
      if (locError) return setError(`Where: ${locError}`);
      locationFields = { location_id: null, new_location: payload };
    }
    const place = where.kind === 'saved' ? where.location : where.kind === 'new' ? locationFields.new_location : null;
    if (geoOn && place && (place.lat === null || place.lat === undefined)) {
      return setError('The clock-in location check is on, but this location has no map pin. Add a pin, or turn the check off for this event.');
    }

    const body = {
      title: title.trim(),
      start_time: startIso,
      end_time: endIso,
      notes: notes.trim() || null,
      staff_notes: staffNotes.trim() || null,
      ...locationFields,
      geofence_mode: geofenceMode,
      location_staff_notes: locStaffOn ? locStaffNotes.trim() || null : null,
      positions: payloadPositions.map(({ offset: _offset, ...p }) => p),
    };

    setSaving(true);
    try {
      if (isTemplate) {
        // Phase 29.3: a typed-in new location is saved to the venue's list first
        let locationId = locationFields.location_id;
        if (locationFields.new_location) {
          const loc = await api.post(`/venues/${venue.id}/locations`, locationFields.new_location);
          locationId = loc.data.id;
        }
        const tplBody = {
          name: tplName.trim(),
          title: body.title,
          start_local: tplStart,
          end_local: tplEnd,
          notes: body.notes,
          staff_notes: body.staff_notes,
          location_id: locationId,
          geofence_mode: body.geofence_mode,
          location_staff_notes: body.location_staff_notes,
          positions: payloadPositions.map(({ shift_id: _omit, start_time: _start, offset, ...p }) => ({ ...p, start_offset_minutes: offset })),
        };
        const res = template
          ? await api.put(`/venues/${venue.id}/event-templates/${template.id}`, tplBody)
          : await api.post(`/venues/${venue.id}/event-templates`, tplBody);
        onSaved && onSaved(res.data);
        return;
      }
      let res;
      let published = false;
      if (isEdit) {
        res = await api.put(`/events/${eventId}`, body);
        if (publish && eventStatus === 'draft') {
          res = await api.post(`/events/${eventId}/publish`);
          published = true;
        }
      } else {
        res = await api.post('/events', { ...body, venue_id: venue.id, publish });
        published = publish;
      }
      onSaved && onSaved(res.data, { published });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const isDraft = isEdit && eventStatus === 'draft';
  const primaryCls = 'px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5';
  const secondaryCls = 'px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5';
  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Cancel
      </button>
      {isTemplate ? (
        <button type="button" onClick={() => handleSubmit(false)} disabled={saving} className={primaryCls}>
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save template'}
        </button>
      ) : isEdit && !isDraft ? (
        <button type="button" onClick={() => handleSubmit(false)} disabled={saving || loading} className={primaryCls}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      ) : (
        <>
          <button type="button" onClick={() => handleSubmit(false)} disabled={saving || loading} className={secondaryCls}
            title="Only managers can see a draft. Publish it when it's ready.">
            <Save className="w-4 h-4" /> {isDraft ? 'Save draft' : 'Save as draft'}
          </button>
          <button type="button" onClick={() => handleSubmit(true)} disabled={saving || loading} className={primaryCls}
            title="Workers can see and request it, and your team is told.">
            <Send className="w-4 h-4" /> {saving ? 'Saving…' : isDraft ? 'Save & publish' : 'Publish'}
          </button>
        </>
      )}
    </>
  );

  const modalTitle = isTemplate
    ? (template ? `Edit template: ${template.name}` : 'New event template')
    : isDraft ? 'Edit draft' : isEdit ? 'Edit event' : 'Post an event';

  return (
    <ModalShell
      title={modalTitle}
      subtitle={venue?.name}
      icon={<Calendar className="w-5 h-5 text-brand-400" />}
      onClose={onClose}
      footer={footer}
    >
      {error && (
        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
      )}
      {loading ? (
        <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: event details */}
          <div className="lg:col-span-2 space-y-4">
            {/* Phase 29.3: start from a template */}
            {isCreate && templates.length > 0 && (
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/30 space-y-2">
                <label className="flex items-center gap-1 text-xs font-semibold text-indigo-200">
                  <LayoutTemplate className="w-3.5 h-3.5" /> Start from a template
                </label>
                <select
                  value={pickedTemplate}
                  onChange={(e) => {
                    const tpl = templates.find((t) => t.id === e.target.value);
                    if (tpl) applyTemplate(tpl);
                  }}
                  className={inputCls}
                >
                  <option value="" disabled>Choose a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {t.start_local}–{t.end_local}</option>
                  ))}
                </select>
              </div>
            )}
            {isDraft && (
              <p className="text-[11px] text-slate-300 bg-slate-800/60 border border-dashed border-slate-500 rounded-xl p-2.5">
                This is a <strong>draft</strong>. Workers can't see it until you publish it.
              </p>
            )}
            {templateNote && (
              <p className="text-[11px] text-indigo-200 bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-2.5">{templateNote}</p>
            )}
            {isTemplate && (
              <div>
                <label className={labelCls}>Template name *</label>
                <input value={tplName} onChange={(e) => setTplName(e.target.value)} className={inputCls} placeholder="Friday Jazz" />
                <p className="text-[10px] text-slate-500 mt-1">What you'll pick from when posting. Workers never see it.</p>
              </div>
            )}
            <div>
              <label className={labelCls}>Event name *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Friday Gala" />
            </div>
            {isTemplate ? (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Starts at ({tz || 'local'}) *</label>
                    <input type="time" value={tplStart} onChange={(e) => setTplStart(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Ends at *</label>
                    <input type="time" value={tplEnd} onChange={(e) => setTplEnd(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {tplStart && tplEnd && tplEnd <= tplStart && tplEnd !== tplStart
                    ? 'Ends the next day (overnight).'
                    : 'You pick the date each time you post from this template.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                <div>
                  <label className={labelCls}>Starts ({tz || 'local'} time) *</label>
                  <input type="datetime-local" value={start} onChange={(e) => changeStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Ends ({tz || 'local'} time) *</label>
                  <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}
            {/* Phase 27: Where */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-brand-400" /> Where
              </label>
              <EventLocationPicker key={pickerKey} venue={venue} value={where} onChange={setWhere} />

              <div>
                <label className={labelCls}>Clock-in location check</label>
                <select value={geofenceMode} onChange={(e) => setGeofenceMode(e.target.value)} className={inputCls}>
                  <option value="venue_default">Use venue setting ({venueGeoOn ? 'on' : 'off'})</option>
                  <option value="on">On for this event</option>
                  <option value="off">Off for this event</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {geoOn
                    ? 'Workers must be at the location to clock in. A little outside is allowed but flagged for you.'
                    : 'Workers can clock in from anywhere during the clock-in window.'}
                </p>
                {geoOn && where.kind === 'saved' && where.location?.lat == null && (
                  <p className="text-[11px] text-amber-300 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> This location has no map pin yet. Use “Edit this location” to add one.
                  </p>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={locStaffOn}
                    onChange={(e) => setLocStaffOn(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-indigo-500"
                  />
                  <Lock className="w-3 h-3 text-indigo-300" /> Add event-specific location notes (confirmed staff only)
                </label>
                {locStaffOn && (
                  <textarea
                    rows={2}
                    value={locStaffNotes}
                    onChange={(e) => setLocStaffNotes(e.target.value)}
                    className={`${inputCls} mt-2`}
                    placeholder="Only for this event and only booked staff see it. e.g. Gate code 2280 for Saturday, ask for Maria (planner) 555-0142."
                  />
                )}
              </div>
            </div>

            <div>
              <label className={labelCls}>Event notes</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputCls}
                placeholder="Shown to everyone browsing this event. e.g. Load-in through the loading dock at 4pm."
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-300 mb-1">
                <Lock className="w-3 h-3 text-indigo-300" /> Notes for confirmed staff only
              </label>
              <textarea
                rows={2}
                value={staffNotes}
                onChange={(e) => setStaffNotes(e.target.value)}
                className={inputCls}
                placeholder="Only people you've booked see this. e.g. Door code 4471, park in lot B, ask for Sam on arrival."
              />
              {isEdit && !isDraft && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Changing the time or any notes flags the event as “Updated” for everyone booked until they read it.
                </p>
              )}
            </div>
            {venue?.default_shift_notes && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" /> Venue notes (added automatically)
                </div>
                <p className="text-xs text-slate-300 whitespace-pre-line">{venue.default_shift_notes}</p>
                <p className="text-[10px] text-slate-500 mt-1">Change these in Venue Settings.</p>
              </div>
            )}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <label className={labelCls}>Approval for every shift</label>
              <select value={eventApproval} onChange={(e) => setAllApproval(e.target.value)} className={inputCls}>
                {APPROVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                <option value="mixed" disabled>Mixed (set per shift)</option>
              </select>
              <p className="text-[11px] text-slate-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  “Use venue setting” means {POLICY_TEXT[venue?.approval_policy] || POLICY_TEXT.team_auto}. You can also set each shift on the right.
                </span>
              </p>
            </div>
            {isEdit && anyBooked && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                People are already booked or waiting on this event. They'll see the new time and details.
              </p>
            )}
          </div>

          {/* Right: positions */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-400" /> Shifts
              </h4>
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-brand-300 text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add a shift
              </button>
            </div>
            <p className="text-[11px] text-slate-500 -mt-1">
              Each shift's call time is filled in from the event's start. Change it for a position that starts earlier or later.
            </p>

            {!positionsLoading && activePositions.length === 0 && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                This venue has no positions set up yet. Add them in Venue Settings → Positions & pay to get dropdowns with pay filled in. You can still type a position below.
              </p>
            )}

            {rows.map((r) => {
              const locked = (r.booked || 0) + (r.pending || 0) > 0;
              const pos = findPos(r.role_type);
              const inList = !!pos;
              const showSelect = activePositions.length > 0 && !r.custom;
              const def = pos ? defaultsFor(pos) : null;
              // Phase 37.2: this shift's call time, shown as a clock time next to the event's start
              const offset = Number(r.offset) || 0;
              const callClock = eventClock ? clockText(clockMinutes(eventClock) + offset) : '';
              const callDay = eventClock ? Math.floor((clockMinutes(eventClock) + offset) / DAY_MIN) : 0;
              const differsFromDefault =
                def &&
                (Number(def.hourly_rate) !== Number(r.hourly_rate) ||
                  String(def.hourly_rate_max || '') !== String(r.hourly_rate_max || '') ||
                  def.hide_rate !== r.hide_rate ||
                  def.tips_eligible !== r.tips_eligible ||
                  def.tip_pool !== r.tip_pool);

              return (
                <div key={r.key} className="p-3 rounded-xl border border-slate-700 bg-slate-800/40 space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[12rem]">
                      <label className={labelCls}>Position</label>
                      {showSelect ? (
                        <select
                          value={inList ? r.role_type : r.role_type ? `__legacy__${r.role_type}` : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith('__legacy__')) return;
                            pickPosition(r.key, v);
                          }}
                          className={inputCls}
                        >
                          {!r.role_type && <option value="" disabled>Choose a position…</option>}
                          {!inList && r.role_type && (
                            <option value={`__legacy__${r.role_type}`}>{r.role_type} (not in venue list)</option>
                          )}
                          {activePositions.map((p) => (
                            <option key={p.id || p.name} value={p.name}>{optionLabel(p)}</option>
                          ))}
                          <option value={CUSTOM}>Other (type a name)…</option>
                        </select>
                      ) : (
                        <div className="space-y-1">
                          <input
                            value={r.role_type}
                            onChange={(e) => updateRow(r.key, { role_type: e.target.value })}
                            className={inputCls}
                            placeholder={positionsLoading ? 'Loading positions…' : 'e.g. Coat Check'}
                            disabled={positionsLoading}
                          />
                          {activePositions.length > 0 && (
                            <button
                              type="button"
                              onClick={() => pickPosition(r.key, activePositions[0].name)}
                              className="text-[11px] text-brand-400 hover:text-brand-300"
                            >
                              ← Pick from venue positions
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="w-32">
                      <label className={labelCls} htmlFor={`call-${r.key}`}>Call time</label>
                      <input
                        id={`call-${r.key}`}
                        type="time"
                        value={callClock}
                        disabled={!eventClock}
                        title={eventClock ? 'When this shift starts. Filled in from the event; change it if this position starts earlier or later.' : "Set the event's start first"}
                        onChange={(e) => updateRow(r.key, { offset: e.target.value ? offsetFor(e.target.value, eventClock) : 0 })}
                        className={`${inputCls} ${offset ? 'border-brand-500/60' : ''} disabled:opacity-50`}
                      />
                    </div>
                    <div className="w-20">
                      <label className={labelCls}>Spots</label>
                      <input
                        type="number"
                        min={Math.max(1, r.booked || 0)}
                        value={r.capacity}
                        onChange={(e) => updateRow(r.key, { capacity: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      disabled={locked || rows.length <= 1}
                      title={locked ? 'People are booked or waiting on this shift' : 'Remove shift'}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {offset !== 0 && eventClock && (
                    <p className="text-[11px] text-brand-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Starts {gapText(offset)}
                        {callDay < 0 ? ' (the day before)' : callDay > 0 ? ' (the next day)' : ''}.
                      </span>
                      <button type="button" onClick={() => updateRow(r.key, { offset: 0 })} className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 underline underline-offset-2">
                        <RotateCcw className="w-3 h-3" /> Same as the event
                      </button>
                    </p>
                  )}

                  {pos && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        Usual pay: {payText(pos.default_rate, pos.default_rate_max)}
                        {tipsText(pos) ? ` · ${tipsText(pos)}` : ''}
                        {pos.hide_rate ? ' · pay hidden' : ''}
                      </span>
                      {differsFromDefault && (
                        <button
                          type="button"
                          onClick={() => resetToDefault(r.key, r.role_type)}
                          className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300"
                        >
                          <RotateCcw className="w-3 h-3" /> Reset to venue default
                        </button>
                      )}
                    </div>
                  )}

                  {isEdit && (r.booked > 0 || r.pending > 0) && (
                    <p className="text-[11px] text-slate-400">{r.booked} booked · {r.pending} waiting</p>
                  )}

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-28">
                      <label className={labelCls}>Pay from</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                        <input
                          type="number" step="0.5" min="0"
                          value={r.hourly_rate}
                          onChange={(e) => updateRow(r.key, { hourly_rate: e.target.value })}
                          className={`${inputCls} pl-6`}
                        />
                      </div>
                    </div>
                    <div className="w-28">
                      <label className={labelCls}>to (optional)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                        <input
                          type="number" step="0.5" min="0"
                          value={r.hourly_rate_max}
                          onChange={(e) => updateRow(r.key, { hourly_rate_max: e.target.value })}
                          className={`${inputCls} pl-6`}
                          placeholder="—"
                        />
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 pb-2.5">/hr</span>
                    <label className="flex items-center gap-2 text-xs text-slate-300 pb-2.5 ml-auto">
                      <input
                        type="checkbox"
                        checked={r.hide_rate}
                        onChange={(e) => updateRow(r.key, { hide_rate: e.target.checked })}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-brand-500"
                      />
                      <EyeOff className="w-3.5 h-3.5" /> Hide pay from workers
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={r.tips_eligible}
                        onChange={(e) => updateRow(r.key, { tips_eligible: e.target.checked, tip_pool: e.target.checked ? r.tip_pool : false })}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
                      />
                      Tips
                    </label>
                    {r.tips_eligible && (
                      <label className="flex items-center gap-2 text-xs text-amber-300">
                        <input
                          type="checkbox"
                          checked={r.tip_pool}
                          onChange={(e) => updateRow(r.key, { tip_pool: e.target.checked })}
                          className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500"
                        />
                        Tip pool
                      </label>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-slate-400">Approval</span>
                      <select
                        value={r.approval_mode}
                        onChange={(e) => updateRow(r.key, { approval_mode: e.target.value })}
                        className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white"
                      >
                        {APPROVAL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {r.showNotes ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Notes for {r.role_type || 'this shift'}</label>
                        <textarea
                          rows={2}
                          value={r.role_notes}
                          onChange={(e) => updateRow(r.key, { role_notes: e.target.value })}
                          className={inputCls}
                          placeholder="Everyone sees this. e.g. Bring a wine key. Black apron provided."
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-1 text-xs font-semibold text-slate-300 mb-1">
                          <Lock className="w-3 h-3 text-indigo-300" /> Confirmed {r.role_type || 'staff'} only
                        </label>
                        <textarea
                          rows={2}
                          value={r.staff_notes}
                          onChange={(e) => updateRow(r.key, { staff_notes: e.target.value })}
                          className={inputCls}
                          placeholder="Only booked people see this. e.g. POS login 2231, bar lead is Jess."
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateRow(r.key, { showNotes: true })}
                      className="text-xs text-brand-400 hover:text-brand-300"
                    >
                      + Add notes for this shift (public or staff-only)
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
