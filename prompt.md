# Phase 25.3: Position Dropdowns in "Post a Shift" + Message Board Stacking Fix

Patch on top of Phase 25.2 (implemented). Frontend only. **No backend or schema changes, no rebuild of the database.**

### Bug 1: Post a Shift shows text boxes instead of the venue's positions
`VenueManagerDashboard.jsx` renders `<ShiftEventFormModal ... />` **without** the `positions={venuePositions}` prop, so the form's position list is empty and every row falls back to a free-text input. Fix: (a) pass the prop, and (b) make the form load the venue's positions itself whenever none are passed, so it can never silently fall back again. The dropdown now shows each position's pay and tips (e.g. `Bartender — $30–$38/hr · pooled tips`), picking one fills pay/tips/hidden from the venue defaults, and an **Other (type a name)…** option still allows a one-off position.

### Bug 2: The message board opens behind the modal it was launched from
The discussion board uses an old inline overlay at `z-50`, while `ModalShell` (Details, Post a Shift, Venue Settings) is at `z-[60]`, so the board renders underneath. Fix: a new `ShiftBoardModal` rendered through a portal at `z-[80]`, plus a shared `useModalLayer` hook so stacked modals share one body scroll-lock and **Esc closes only the top-most modal**.

---

## 0. Guardrails
* Frontend only. Do NOT modify any backend file, `database/init.sql`, `.gitignore`, `.secrets/`, `docker-compose.yml`, `AuthContext.jsx`, `api/client.js`, `App.jsx`, `Navbar.jsx`, `LoginPage.jsx`.
* New files and full-file replacements must be written with the EXACT content given.
* Do not change `ShiftBoard.jsx`; it is only wrapped.

---

## 1. NEW FILE `frontend/src/components/modalLayer.js`
```js
import { useEffect, useRef } from 'react';

/**
 * Phase 25.3: Shared behaviour for every overlay/modal.
 * - One body scroll-lock no matter how many modals are stacked.
 * - Esc closes ONLY the top-most modal.
 */
const stack = [];
let lockCount = 0;
let savedOverflow = '';

export function useModalLayer(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = Symbol('modal-layer');
    stack.push(id);

    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (stack[stack.length - 1] !== id) return;
      if (closeRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, []);
}
```

## 2. REPLACE FILE `frontend/src/components/ModalShell.jsx`
```jsx
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalLayer } from './modalLayer';

/**
 * One modal wrapper for the whole app (Phase 25.2, stacking-aware in 25.3).
 * The dark backdrop scrolls (not the panel), so long content always fits on any screen.
 * Header and footer are sticky inside the scrolling backdrop.
 */
export default function ModalShell({
  title,
  subtitle = null,
  icon = null,
  onClose,
  maxWidth = 'max-w-5xl',
  headerExtra = null,
  footer = null,
  children,
}) {
  useModalLayer(onClose);

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-slate-950/85">
      <div className="min-h-full flex items-start justify-center p-2 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          className={`relative w-full ${maxWidth} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl my-2 sm:my-6`}
        >
          <div className="sticky top-0 z-10 bg-slate-900 rounded-t-2xl border-b border-slate-800 px-4 sm:px-6 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {icon}
                  <span className="truncate">{title}</span>
                </h3>
                {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {headerExtra && <div className="mt-3">{headerExtra}</div>}
          </div>

          <div className="px-4 sm:px-6 py-4">{children}</div>

          {footer && (
            <div className="sticky bottom-0 z-10 bg-slate-900 rounded-b-2xl border-t border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap justify-end gap-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
```

## 3. NEW FILE `frontend/src/components/ShiftBoardModal.jsx`
```jsx
import React from 'react';
import { createPortal } from 'react-dom';
import ShiftBoard from './ShiftBoard';
import { useModalLayer } from './modalLayer';

/**
 * Phase 25.3: Discussion board overlay. Always renders above ModalShell (z-[60]).
 */
export default function ShiftBoardModal({ shiftId, shiftTitle, currentUserRole, onClose }) {
  useModalLayer(onClose);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-slate-950/85 flex items-center justify-center p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="max-w-2xl w-full">
        <ShiftBoard shiftId={shiftId} shiftTitle={shiftTitle} currentUserRole={currentUserRole} onClose={onClose} />
      </div>
    </div>,
    document.body
  );
}
```

## 4. Use `ShiftBoardModal` in both dashboards

### A. `frontend/src/pages/VenueManagerDashboard.jsx`
1. Add `import ShiftBoardModal from '../components/ShiftBoardModal';` (leave the existing `ShiftBoard` import; unused is fine).
2. Replace the ENTIRE `{/* Discussion Board Modal */}` block, i.e. `{activeDiscussionShift && ( <div className="fixed inset-0 z-50 ..."> ... </div> )}`, with:
```jsx
      {/* Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.role_type})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}
```
3. **Pass positions to the form.** In the `<ShiftEventFormModal ... />` element, add the prop:
```jsx
          positions={venuePositions}
```
4. After a successful save, also refresh positions (cheap and keeps the list current): inside that element's `onSaved` handler, add `loadVenuePositions(currentVenueId);` as the last line.

### B. `frontend/src/pages/WorkerDashboard.jsx`
1. Add `import ShiftBoardModal from '../components/ShiftBoardModal';`
2. Replace the ENTIRE `{/* Shift Discussion Board Modal */}` block (`{activeDiscussionShift && ( <div className="fixed inset-0 z-50 ..."> ... </div> )}`) with:
```jsx
      {/* Shift Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.venue?.name || ''})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}
```

---

## 5. REPLACE FILE `frontend/src/components/ShiftEventFormModal.jsx`
Changes vs 25.2: loads positions itself if none are passed; dropdown labels show pay/tips; "Other (type a name)…" for one-offs; a helper line shows the venue default for the chosen position with a one-click **Reset to venue default**; the first row auto-fills once positions arrive.
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users, RotateCcw } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { payText } from './PayLabel';
import { zonedLocalToUtcIso, utcToZonedLocalInput } from '../utils/venueTime';

const CUSTOM = '__custom__';

const APPROVAL_OPTIONS = [
  { value: 'venue_default', label: 'Venue default' },
  { value: 'auto', label: 'Instant booking' },
  { value: 'manual', label: 'Needs my approval' },
];
const POLICY_TEXT = {
  team_auto: 'your team is booked instantly, everyone else needs approval',
  manual: 'you approve every request',
  everyone_auto: 'anyone who picks it up is booked instantly',
};

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
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

let rowSeq = 0;
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
    approval_mode: 'venue_default',
    booked: 0,
    pending: 0,
    showNotes: false,
  };
}

export default function ShiftEventFormModal({ mode = 'create', venue, positions = null, eventId = null, onClose, onSaved }) {
  const tz = venue?.timezone;
  const isEdit = mode === 'edit' && !!eventId;

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
  const [rows, setRows] = useState(() => (isEdit ? [] : [blankRow(null)]));
  const [touched, setTouched] = useState(false);

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
        setTitle(ev.title || '');
        setStart(utcToZonedLocalInput(ev.start_time, tz));
        setEnd(utcToZonedLocalInput(ev.end_time, tz));
        setNotes(ev.notes || '');
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
            approval_mode: p.approval_mode || 'venue_default',
            booked: p.assigned_count || 0,
            pending: p.pending_count || 0,
            showNotes: !!p.role_notes,
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

  const handleSubmit = async () => {
    setError('');
    if (!title.trim()) return setError('Give the event a name.');
    if (!start || !end) return setError('Pick a start and end time.');
    const startIso = zonedLocalToUtcIso(start, tz);
    const endIso = zonedLocalToUtcIso(end, tz);
    if (new Date(endIso) <= new Date(startIso)) return setError('End time must be after the start time.');
    if (rows.length === 0) return setError('Add at least one position.');

    const payloadPositions = [];
    for (const r of rows) {
      const name = (r.role_type || '').trim();
      const lo = parseFloat(r.hourly_rate);
      const hi = r.hourly_rate_max === '' ? null : parseFloat(r.hourly_rate_max);
      const cap = parseInt(r.capacity, 10) || 1;
      if (!name) return setError('Pick a position for every row.');
      if (!lo || lo <= 0) return setError(`${name}: pay must be more than $0.`);
      if (hi !== null && (Number.isNaN(hi) || hi < lo)) return setError(`${name}: the top of the pay range can't be lower than the bottom.`);
      if (cap < (r.booked || 0)) return setError(`${name}: ${r.booked} people are already booked, so it needs at least ${r.booked} spots.`);
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
        approval_mode: r.approval_mode,
      });
    }

    const body = {
      title: title.trim(),
      start_time: startIso,
      end_time: endIso,
      notes: notes.trim() || null,
      positions: payloadPositions,
    };

    setSaving(true);
    try {
      const res = isEdit
        ? await api.put(`/events/${eventId}`, body)
        : await api.post('/events', { ...body, venue_id: venue.id });
      onSaved && onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving || loading}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50"
      >
        {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Publish shift'}
      </button>
    </>
  );

  return (
    <ModalShell
      title={isEdit ? 'Edit posted shift' : 'Post a shift'}
      subtitle={venue?.name}
      icon={<Calendar className="w-5 h-5 text-emerald-400" />}
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
            <div>
              <label className={labelCls}>Event / shift name *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Friday Gala" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <div>
                <label className={labelCls}>Starts ({tz || 'local'} time) *</label>
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ends ({tz || 'local'} time) *</label>
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Event notes</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputCls}
                placeholder="Shown to everyone working this event. e.g. Load-in through the loading dock at 4pm."
              />
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
              <label className={labelCls}>Approval for every position</label>
              <select value={eventApproval} onChange={(e) => setAllApproval(e.target.value)} className={inputCls}>
                {APPROVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                <option value="mixed" disabled>Mixed (set per position)</option>
              </select>
              <p className="text-[11px] text-slate-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Venue default means {POLICY_TEXT[venue?.approval_policy] || POLICY_TEXT.team_auto}. You can also set each position on the right.
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
                <Users className="w-4 h-4 text-emerald-400" /> Positions
              </h4>
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add position
              </button>
            </div>

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
                              className="text-[11px] text-emerald-400 hover:text-emerald-300"
                            >
                              ← Pick from venue positions
                            </button>
                          )}
                        </div>
                      )}
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
                      title={locked ? 'People are booked or waiting on this position' : 'Remove position'}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {pos && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        Venue default: {payText(pos.default_rate, pos.default_rate_max)}
                        {tipsText(pos) ? ` · ${tipsText(pos)}` : ''}
                        {pos.hide_rate ? ' · pay hidden' : ''}
                      </span>
                      {differsFromDefault && (
                        <button
                          type="button"
                          onClick={() => resetToDefault(r.key, r.role_type)}
                          className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
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
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500"
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
                    <div>
                      <label className={labelCls}>Notes for {r.role_type || 'this position'}</label>
                      <textarea
                        rows={2}
                        value={r.role_notes}
                        onChange={(e) => updateRow(r.key, { role_notes: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Bring a wine key. Black apron provided."
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateRow(r.key, { showNotes: true })}
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      + Add notes for this position
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
```

---

## 6. Rebuild & Verification
No schema or backend change:
```bash
docker compose up -d --build frontend
```
(Hard-refresh the browser afterwards.)

Verify:
1. **Post a Shift** → each position row has a dropdown listing the venue's positions with pay, e.g. `Bartender — $30–$38/hr · pooled tips`. Picking one fills pay from/to, tips, tip pool, and "Hide pay" from Venue Settings. Below it: "Venue default: …". Change the pay → **Reset to venue default** appears and restores it.
2. **Add position** picks the next position not already used.
3. **Other (type a name)…** switches that row to a text box; "← Pick from venue positions" switches back.
4. A venue with no positions shows the amber hint and plain text boxes.
5. **Edit** an existing event whose position name isn't in the venue list (e.g. an old seeded shift) → the dropdown shows it as "Name (not in venue list)" and saving keeps it unchanged.
6. **Message board stacking:** Posted Shifts → **Details** → **Board** on a position → the board opens ON TOP of Details. Esc closes only the board; Esc again closes Details. The page behind doesn't scroll while either is open, and scrolling is restored after both close. The Worker dashboard's Board button also still works.