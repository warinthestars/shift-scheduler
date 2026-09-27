# Phase 32.3: No More Undo Buttons Under Your Thumb + Request a Whole Series

## Part 1: A button never turns into its own undo in the same spot

**Why:** In several places, after you click a positive action, the **same spot** re-renders as a negative one. A double-click or a reflex second tap then undoes what you just did. The worst cases:
* **Send request → Withdraw request** (event popup)
* **Clock in → Clock out** (My shifts). A clock-out within a minute of clocking in *deletes* the clock-in.

**The rule from now on:**
* A negative action is never placed where the positive action was, **or**
* it asks first, in a spot the second tap can't hit.

| Where | Before | After |
|---|---|---|
| Worker event popup (Find Shifts, venue page) | `[Close] ……… [Send request]`, then `[Close] ……… [Withdraw request]` | `[Close] ……… [Send request]`, then **`[Withdraw request] ……… [Close]`**. Withdraw is always far left; Close takes the right-hand spot when there's nothing to send. With a switch: `[Withdraw] ……… [Close] [Switch to X]`. |
| My shifts card: **Clock out** (same button as Clock in) | Clocks out immediately | Opens **"Clock out now?"** (Go back / Clock out), which explains that within a minute it undoes the clock-in. |
| Admin → user drawer: **Deactivate** (same button as Reactivate) | Immediate, and the button could double-fire | Asks first ("Deactivate Jordan Lee?"). The button is disabled while saving. Reactivate stays one click. |
| Venue settings → Positions: 🗑 (same spot as ↺ Bring back) | Removes immediately | An inline row below asks: "Remove Bartender from the Post a Shift list? … [Keep it] [Remove]". |
| Venue settings → Locations: Archive (same spot as ↺ Bring back) | Archives immediately | An inline row asks: "Archive …? … [Keep it] [Archive]". |
| Worker offers `[Accept] [Decline]`, and roster requests `[Approve] [Deny]` | Negative on the right: the odd ones out | **`[Decline] [Accept]`** and **`[Deny] [Approve]`**, matching hand-offs, the approval queue and Review (positive always on the right). |

Checked and already safe (no change): hand-offs, the approval queue, Review, Assign/Offer, drop shift (has a dialog), post/publish, team block/remove (inline confirm), manager clock-in / no-show (dialogs), certificates, time off and templates (all confirmed).

## Part 2: Request several dates of a repeating event at once

**Decision (yours):**
* Only events made with **"Copy to dates"** count as a series. Copying a copy stays in the same series.
* Events made from the same **template** are *not* grouped, because a "Concert" template gets reused for unrelated shows.
* The worker gets a **checklist of dates**.

* **Schema:** `shift_events.series_id UUID NULL` (indexed). "Copy to dates" sets it on the original (= the original's own id) and on every copy.
  - Events created before this phase aren't linked (there's nothing reliable to link them by).
  - Only copies made from now on form a series.
* **Find Shifts card:** a **"↻ +4 dates"** chip when other dates of the same series are listed.
* **Event popup:** once a position is picked for a fresh request (not a switch, not an ask-back), a box appears: **"Also request Server on other dates"**.
  - Each upcoming date of the series (up to 12, next 120 days) has a checkbox, the time and the pay.
  - It is **ticked by default** only if it's open for that position and fits. Unticked, with the reason:
    - already requested or booked
    - full
    - no such position that date
    - missing certificates
    - overlaps a booking
    - you dropped a shift there
  - "During your time off" / "Outside your weekly availability" dates can be ticked but start unticked.
  - "Pick all" / "Clear".
  - The button becomes **"Request 5 dates"**.
* **Sending:** one normal request per date through the **existing** `POST /api/listings/{event_id}/request`.
  - Every date is checked by the server on its own: instant vs approval, department, time off, conflicts, certificates.
  - The manager approves or denies each date, and the worker can withdraw any date.
  - The popup then says e.g. "Booked 2 dates… / 3 requests sent… / Not sent: Tue, Oct 20: …".
* **API:** no new endpoints (still 170 operations).
  - `EventListing` gains `series_id`, `series_more` (list view) and `series` (details view: the other dates, each a normal `EventListing`).
  - The details `GET /api/listings/{event_id}` and the request/withdraw responses include `series`.

⚠️ **Schema change:** one new nullable column. The keep-data SQL is in §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` (unchanged)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages.
* No native PostgreSQL ENUMs (no new status columns this phase).
* Aware UTC datetimes only (no new datetime logic).
* **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* Apply this **after 32.2.1** (already in your repo: verified).
* These blocks were generated from your **current** files: every file touched here was checked against your repo and matched. They were verified:
  - the backend imports cleanly: 170 API operations (unchanged)
  - the frontend bundles with no missing imports
  - a new **17-check series suite** passes (series ids on copy / copy-of-copy, drafts and cancelled dates excluded, card counts, details list, one request per date, per-date conflict), and **all earlier suites pass** (28, 20, 97, 36, 64, 67, 39, 49, 107, 32)
  - the keep-data SQL was tested on a 32.2.1 database and is safe to run twice
  - every changed screen was rendered with the real Tailwind build on desktop and phone: the popup before and after sending, the checklist, the Clock-out confirm, and the position Remove confirm

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDITS)

**Edit 1.** Find:
```sql
    status VARCHAR(20) NOT NULL DEFAULT 'published',          -- Phase 29.3: draft | published
    published_at TIMESTAMPTZ,                                 -- Phase 29.3: first time it went live
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    status VARCHAR(20) NOT NULL DEFAULT 'published',          -- Phase 29.3: draft | published
    published_at TIMESTAMPTZ,                                 -- Phase 29.3: first time it went live
    series_id UUID,                                           -- Phase 32.3: events made by one "Copy to dates" share this (the original's id)
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 2.** Find:
```sql
CREATE INDEX idx_shift_events_venue ON shift_events(venue_id);
CREATE INDEX idx_shift_events_start ON shift_events(start_time);

-- ------------------------------------------------------------------------------
```
Replace with:
```sql
CREATE INDEX idx_shift_events_venue ON shift_events(venue_id);
CREATE INDEX idx_shift_events_start ON shift_events(start_time);
CREATE INDEX idx_shift_events_series ON shift_events(series_id);

-- ------------------------------------------------------------------------------
```

---

## A2. `backend/src/models.py` (EDIT)

**Edit 1.** Find:
```python
    status = Column(String(20), nullable=False, default="published")      # Phase 29.3: draft | published
    published_at = Column(DateTime(timezone=True), nullable=True)          # Phase 29.3
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    status = Column(String(20), nullable=False, default="published")      # Phase 29.3: draft | published
    published_at = Column(DateTime(timezone=True), nullable=True)          # Phase 29.3
    series_id = Column(UUID(as_uuid=True), nullable=True, index=True)      # Phase 32.3: shared by an event and its "Copy to dates" copies
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

---

## A3. `backend/src/schemas.py` (EDITS)
`EventListing` gets `series_id`, `series` and `series_more`. `EventListing.model_rebuild()` is needed because `series` refers to `EventListing` itself.

**Edit 1.** Find:
```python
    time_off: Optional[str] = None                    # Phase 32.1: 'blocked' = overlaps one of the viewer's time-off blocks
    department_match: str = "not_set"                 # Phase 32.2: match if any open position fits the viewer's departments


```
Replace with:
```python
    time_off: Optional[str] = None                    # Phase 32.1: 'blocked' = overlaps one of the viewer's time-off blocks
    department_match: str = "not_set"                 # Phase 32.2: match if any open position fits the viewer's departments
    series_id: Optional[UUID] = None                  # Phase 32.3: set when this event was copied to other dates
    series: List["EventListing"] = []                 # Phase 32.3: single-event view only: the series' other upcoming dates
    series_more: int = 0                              # Phase 32.3: list view: how many other dates of this series are listed too


```

**Edit 2.** Find:
```python

WorkerProfile.model_rebuild()
MyProfile.model_rebuild()
```
Replace with:
```python

WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
MyProfile.model_rebuild()
```

---

# PART B: Backend

## B1. `backend/src/services/shift_events.py` (EDIT)
`duplicate_event()` puts the original and its copies in one series.

**Edit 1.** Find:
```python
        ), allow_archived_location=True)
        created.append(ev)
    return created

```
Replace with:
```python
        ), allow_archived_location=True)
        created.append(ev)

    # Phase 32.3: the original and every copy belong to one series (the original's id), so workers
    # can request several dates at once. Copying a copy keeps the same series.
    series_id = event.series_id or event.id
    event.series_id = series_id
    for ev in created:
        ev.series_id = series_id
    await db.commit()
    return created

```

---

## B2. `backend/src/services/listings.py` (EDITS)
List view counts `series_more`. The details view nests the series' other upcoming dates (same list-mode rules, so drafts, cancelled and past dates are left out).

**Edit 1.** Find:
```python

MAX_EVENTS = 200
WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")

```
Replace with:
```python

MAX_EVENTS = 200
SERIES_DAYS = 120        # Phase 32.3: how far ahead the "more dates in this series" list looks
SERIES_MAX = 12
WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")

```

**Edit 2.** Find:
```python
    days: int = 60,
    event_id: Optional[UUID] = None,
) -> List[EventListing]:
    """
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    """
    now = datetime.now(timezone.utc)
```
Replace with:
```python
    days: int = 60,
    event_id: Optional[UUID] = None,
    series_id: Optional[UUID] = None,
    exclude_event_id: Optional[UUID] = None,
) -> List[EventListing]:
    """
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    Phase 32.3: in single mode, `series` holds the series' other upcoming dates (list-mode rules);
    series_id / exclude_event_id narrow list mode to one series.
    """
    now = datetime.now(timezone.utc)
```

**Edit 3.** Find:
```python
        if venue_id is not None:
            q = q.where(ShiftEvent.venue_id == venue_id)
        q = q.order_by(ShiftEvent.start_time.asc()).limit(MAX_EVENTS)
    events = (await db.execute(q)).scalars().all()
```
Replace with:
```python
        if venue_id is not None:
            q = q.where(ShiftEvent.venue_id == venue_id)
        if series_id is not None:                                     # Phase 32.3
            q = q.where(ShiftEvent.series_id == series_id)
        if exclude_event_id is not None:
            q = q.where(ShiftEvent.id != exclude_event_id)
        q = q.order_by(ShiftEvent.start_time.asc()).limit(MAX_EVENTS)
    events = (await db.execute(q)).scalars().all()
```

**Edit 4.** Find:
```python
            time_off=my_fit.off(ev.start_time, ev.end_time, vtz),
            department_match=_event_match(open_positions or positions),                 # Phase 32.2
        ))
    return out
```
Replace with:
```python
            time_off=my_fit.off(ev.start_time, ev.end_time, vtz),
            department_match=_event_match(open_positions or positions),                 # Phase 32.2
            series_id=ev.series_id,                                                     # Phase 32.3
        ))

    # Phase 32.3: list view: each card says how many other dates of its series are listed
    if event_id is None:
        per_series = defaultdict(int)
        for row in out:
            if row.series_id is not None:
                per_series[row.series_id] += 1
        for row in out:
            if row.series_id is not None:
                row.series_more = per_series[row.series_id] - 1

    # Phase 32.3: the details modal lists the series' other upcoming dates so the worker can request several at once
    if event_id is not None and out and out[0].series_id is not None:
        out[0].series = (await build_listings(
            db, user, series_id=out[0].series_id, exclude_event_id=event_id, days=SERIES_DAYS,
        ))[:SERIES_MAX]
    return out
```

---

# PART C: Frontend, worker

## C1. `frontend/src/components/EventListingModal.jsx` (EDITS)
Footer: Withdraw moves far left and Close takes the right-hand spot. Adds the series checklist and the multi-date send.

**Edit 1.** Find:
```jsx
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus,
  Zap, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Briefcase, Lock,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { DeptChip } from '../utils/departments';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, STATUS_LABELS, PENDING_STATUSES, whereOf,
```
Replace with:
```jsx
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus,
  Zap, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Briefcase, Lock, Repeat,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { DeptChip } from '../utils/departments';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange, fmtDate } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, STATUS_LABELS, PENDING_STATUSES, whereOf,
```

**Edit 2.** Find:
```jsx
  const open = listing.positions.filter((p) => p.status === 'OPEN' && !(p.missing_certs || []).length);   // Phase 32
  return open.length === 1 ? open[0].shift_id : null;
}

```
Replace with:
```jsx
  const open = listing.positions.filter((p) => p.status === 'OPEN' && !(p.missing_certs || []).length);   // Phase 32
  return open.length === 1 ? open[0].shift_id : null;
}

/**
 * Phase 32.3: one other date in this event's series, for the position the worker picked (matched by name).
 * reason = why it can't be picked; warn = pickable but not ticked by default.
 */
function seriesRow(ev, roleType) {
  const role = (roleType || '').trim().toLowerCase();
  const pos = (ev.positions || []).find((p) => (p.role_type || '').trim().toLowerCase() === role) || null;
  let reason = null;
  if (ev.my_request) {
    reason = PENDING_STATUSES.includes(String(ev.my_request.status).toLowerCase())
      ? `You already asked for ${ev.my_request.role_type}`
      : `You're booked as ${ev.my_request.role_type}`;
  } else if (!pos) reason = `No ${roleType} spot on this date`;
  else if (pos.status !== 'OPEN') reason = 'Full';
  else if ((pos.missing_certs || []).length) reason = `You need: ${pos.missing_certs.join(', ')}`;
  else if (ev.conflict) reason = `Overlaps your shift (${ev.conflict})`;
  else if (ev.dropped_here) reason = 'You dropped a shift here. Open that date to ask back.';
  else if (!ev.can_request) reason = "Can't be requested";
  const pickable = !reason;
  const warn = !pickable ? null : ev.time_off ? 'During your time off' : ev.availability === 'outside' ? 'Outside your weekly availability' : null;
  return { pos, reason, pickable, warn, defaultOn: pickable && !warn };
}

```

**Edit 3.** Find:
```jsx
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success' | 'info' | 'error', message }

  const applyListing = (next, resetSelection = false) => {
```
Replace with:
```jsx
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success' | 'info' | 'error', message }
  const [seriesPicks, setSeriesPicks] = useState(() => new Set());   // Phase 32.3: event_ids of other dates to request too

  const applyListing = (next, resetSelection = false) => {
```

**Edit 4.** Find:
```jsx
  }, [eventId]);

  const sendRequest = async (isSwitch) => {
    if (!selectedId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.post(`/listings/${eventId}/request`, {
        shift_id: selectedId,
        note: note.trim() ? note.trim() : null,
        switch: Boolean(isSwitch),
      });
      setResult({ type: res.data.instant ? 'success' : 'info', message: res.data.message });
      if (res.data.listing) applyListing(res.data.listing, true);
      setNote('');
      if (onChanged) onChanged(res.data);
```
Replace with:
```jsx
  }, [eventId]);

  // Phase 32.3: whenever the event or the picked position changes, tick the other dates that are open and fit
  useEffect(() => {
    const sel = listing?.positions?.find((p) => p.shift_id === selectedId);
    if (!sel || !(listing?.series || []).length) {
      setSeriesPicks(new Set());
      return;
    }
    setSeriesPicks(new Set(listing.series.filter((ev) => seriesRow(ev, sel.role_type).defaultOn).map((ev) => ev.event_id)));
  }, [listing, selectedId]);

  const sendRequest = async (isSwitch, extraDates = []) => {
    if (!selectedId) return;
    setSubmitting(true);
    setResult(null);
    const noteText = note.trim() ? note.trim() : null;
    try {
      const res = await api.post(`/listings/${eventId}/request`, {
        shift_id: selectedId,
        note: noteText,
        switch: Boolean(isSwitch),
      });
      if (!extraDates.length) {
        setResult({ type: res.data.instant ? 'success' : 'info', message: res.data.message });
        if (res.data.listing) applyListing(res.data.listing, true);
      } else {
        // Phase 32.3: one request per extra date, each checked by the server on its own
        let booked = res.data.instant ? 1 : 0;
        let waiting = res.data.instant ? 0 : 1;
        const failed = [];
        for (const d of extraDates) {
          try {
            const r = await api.post(`/listings/${d.event_id}/request`, { shift_id: d.shift_id, note: noteText });
            if (r.data.instant) booked += 1; else waiting += 1;
          } catch (err) {
            failed.push(`${d.label}: ${err.response?.data?.detail || 'could not be sent'}`);
          }
        }
        const lines = [];
        if (booked) lines.push(`Booked ${booked} ${booked === 1 ? 'date' : 'dates'}. They're on your schedule.`);
        if (waiting) lines.push(`${waiting} ${waiting === 1 ? 'request' : 'requests'} sent. The manager reviews each date.`);
        if (failed.length) lines.push(`Not sent:\n${failed.join('\n')}`);
        setResult({ type: failed.length ? 'error' : booked && !waiting ? 'success' : 'info', message: lines.join('\n') });
        await reload(true);
      }
      setNote('');
      if (onChanged) onChanged(res.data);
```

**Edit 5.** Find:
```jsx
  const askingBack = !!listing.dropped_here && !isBooked;
  const noteOk = !askingBack || note.trim().length >= ASK_BACK_MIN;

  const addToCalendar = () =>
```
Replace with:
```jsx
  const askingBack = !!listing.dropped_here && !isBooked;
  const noteOk = !askingBack || note.trim().length >= ASK_BACK_MIN;
  // Phase 32.3: other dates of this series, offered only for a fresh request (not a switch or an ask-back)
  const seriesOn = !!selected && !selectedIsMine && !mine && !askingBack && !listing.cancelled && !listing.started
    && !listing.conflict && (listing.series || []).length > 0;
  const seriesRows = seriesOn ? listing.series.map((ev) => ({ ev, row: seriesRow(ev, selected.role_type) })) : [];
  const pickableIds = seriesRows.filter((x) => x.row.pickable).map((x) => x.ev.event_id);
  const allPicked = pickableIds.length > 0 && pickableIds.every((id) => seriesPicks.has(id));
  const togglePick = (id) => setSeriesPicks((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addToCalendar = () =>
```

**Edit 6.** Find:
```jsx
  let primary = null;
  let secondary = null;
  let blockedReason = null;
  if (listing.cancelled) {
```
Replace with:
```jsx
  let primary = null;
  let secondary = null;
  let danger = null;          // Phase 32.3: undo-type action (Withdraw). Always far left, never where the primary button was.
  let blockedReason = null;
  if (listing.cancelled) {
```

**Edit 7.** Find:
```jsx
  } else {
    if (isWaiting) {
      secondary = (
        <button type="button" onClick={withdraw} disabled={submitting} className="px-4 py-2 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold disabled:opacity-50">
          Withdraw request
        </button>
```
Replace with:
```jsx
  } else {
    if (isWaiting) {
      danger = (
        <button type="button" onClick={withdraw} disabled={submitting} className="px-4 py-2 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold disabled:opacity-50 mr-auto">
          Withdraw request
        </button>
```

**Edit 8.** Find:
```jsx
      );
    } else if (!selectedIsMine) {
      const label = isWaiting
        ? `Switch to ${selected.role_type}`
        : askingBack
        ? 'Ask to come back'
        : selected.booking === 'instant'
        ? 'Book instantly'
        : 'Send request';
      primary = (
        <button
          type="button"
          onClick={() => sendRequest(isWaiting)}
          disabled={submitting || !listing.can_request || selected.status !== 'OPEN' || !noteOk}
          title={noteOk ? undefined : 'Tell the manager why you can make it now'}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {selected.booking === 'instant' && <Zap className="w-4 h-4" />}
          {submitting ? 'Sending…' : label}
        </button>
      );
    }
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 mr-auto">
        Close
      </button>
```
Replace with:
```jsx
      );
    } else if (!selectedIsMine) {
      const extraDates = seriesOn ? seriesRows.filter((x) => x.row.pickable && seriesPicks.has(x.ev.event_id)) : [];   // Phase 32.3
      const label = isWaiting
        ? `Switch to ${selected.role_type}`
        : askingBack
        ? 'Ask to come back'
        : extraDates.length
        ? `Request ${extraDates.length + 1} dates`
        : selected.booking === 'instant'
        ? 'Book instantly'
        : 'Send request';
      primary = (
        <button
          type="button"
          onClick={() => sendRequest(isWaiting, extraDates.map((x) => ({
            event_id: x.ev.event_id, shift_id: x.row.pos.shift_id, label: fmtDate(x.ev.start_time, x.ev.venue?.timezone || tz),
          })))}
          disabled={submitting || !listing.can_request || selected.status !== 'OPEN' || !noteOk}
          title={noteOk ? undefined : 'Tell the manager why you can make it now'}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {selected.booking === 'instant' && !extraDates.length && <Zap className="w-4 h-4" />}
          {submitting ? 'Sending…' : label}
        </button>
      );
    }
  }

  // Phase 32.3: Withdraw sits far left; Close takes the right-hand spot when there's no primary action,
  // so a second click right after "Send request" closes the popup instead of withdrawing.
  const footer = (
    <>
      {danger}
      <button type="button" onClick={onClose} className={`px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 ${danger ? '' : 'mr-auto'}`}>
        Close
      </button>
```

**Edit 9.** Find:
```jsx
        >
          {result.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}
```
Replace with:
```jsx
        >
          {result.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span className="whitespace-pre-line">{result.message}</span>
        </div>
      )}
```

**Edit 10.** Find:
```jsx
          )}

          {isWaiting && selected && !selectedIsMine && !listing.conflict && (
            <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
```
Replace with:
```jsx
          )}

          {/* Phase 32.3: request the same position on other dates of this series */}
          {seriesOn && (
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
              <div className="flex items-baseline justify-between gap-2">
                <h5 className="text-xs font-bold text-white inline-flex items-center gap-1.5">
                  <Repeat className="w-3.5 h-3.5 text-emerald-400" /> Also request {selected.role_type} on other dates
                </h5>
                {pickableIds.length > 1 && (
                  <button type="button" disabled={submitting}
                    onClick={() => setSeriesPicks(allPicked ? new Set() : new Set(pickableIds))}
                    className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 flex-shrink-0">
                    {allPicked ? 'Clear' : 'Pick all'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                This event repeats. Each date is its own request: it's checked on its own, the manager decides each one,
                and you can withdraw any of them later.
              </p>
              <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {seriesRows.map(({ ev, row }) => {
                  const on = row.pickable && seriesPicks.has(ev.event_id);
                  const evTz = ev.venue?.timezone || tz;
                  return (
                    <label key={ev.event_id}
                      className={`flex items-center gap-2.5 p-2 rounded-lg border ${
                        on ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800'
                      } ${row.pickable ? 'cursor-pointer hover:border-slate-600' : 'opacity-60 cursor-not-allowed'}`}>
                      <input type="checkbox" className="w-4 h-4 accent-emerald-500 flex-shrink-0" checked={on}
                        disabled={!row.pickable || submitting} onChange={() => togglePick(ev.event_id)} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-white">
                          {fmtDate(ev.start_time, evTz)} · {fmtTimeRange(ev.start_time, ev.end_time, evTz)}
                          {ev.title !== listing.title && <span className="font-normal text-slate-400"> · {ev.title}</span>}
                        </span>
                        <span className={`block text-[11px] ${row.reason ? 'text-slate-500' : row.warn ? 'text-amber-300' : 'text-slate-400'}`}>
                          {row.reason || row.warn || (row.pos.booking === 'instant' ? 'Instant book' : 'Needs approval')}
                        </span>
                      </span>
                      {row.pos && row.pos.hourly_rate !== null && row.pos.hourly_rate !== undefined && (
                        <PayLabel rate={row.pos.hourly_rate} rateMax={row.pos.hourly_rate_max} className="text-xs font-bold text-emerald-400 flex-shrink-0" />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {isWaiting && selected && !selectedIsMine && !listing.conflict && (
            <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
```

---

## C2. `frontend/src/components/EventListingCard.jsx` (EDITS)
The "↻ +N dates" chip.

**Edit 1.** Find:
```jsx
import React from 'react';
import { Clock, MapPin, Zap, ShieldCheck, Users, ChevronRight, AlertTriangle, Star, Lock, CalendarOff } from 'lucide-react';
import PayLabel from './PayLabel';
import { fmtTimeRange } from '../utils/venueTime';
```
Replace with:
```jsx
import React from 'react';
import { Clock, MapPin, Zap, ShieldCheck, Users, ChevronRight, AlertTriangle, Star, Lock, CalendarOff, Repeat } from 'lucide-react';
import PayLabel from './PayLabel';
import { fmtTimeRange } from '../utils/venueTime';
```

**Edit 2.** Find:
```jsx
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold whitespace-nowrap">
                <Star className="w-2.5 h-2.5" /> Your venue
              </span>
            )}
```
Replace with:
```jsx
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold whitespace-nowrap">
                <Star className="w-2.5 h-2.5" /> Your venue
              </span>
            )}
            {listing.series_more > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold whitespace-nowrap"
                title="This event repeats. Open it to request several dates at once.">
                <Repeat className="w-2.5 h-2.5" /> +{listing.series_more} {listing.series_more === 1 ? 'date' : 'dates'}
              </span>
            )}
```

---

## C3. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)
Clock out asks first.

**Edit 1.** Find:
```jsx
import MyShiftCard from '../components/worker/MyShiftCard';
import DropShiftDialog from '../components/worker/DropShiftDialog';
import HandoffsPanel from '../components/worker/HandoffsPanel';
import ProfileNudge from '../components/worker/ProfileNudge';
```
Replace with:
```jsx
import MyShiftCard from '../components/worker/MyShiftCard';
import DropShiftDialog from '../components/worker/DropShiftDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import HandoffsPanel from '../components/worker/HandoffsPanel';
import ProfileNudge from '../components/worker/ProfileNudge';
```

**Edit 2.** Find:
```jsx
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
```
Replace with:
```jsx
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [clockOutAsk, setClockOutAsk] = useState(null);   // Phase 32.3: { shiftId, item, title } waiting for "Clock out?" confirm
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
```

**Edit 3.** Find:
```jsx
        onDetails={(calItem || req.shift?.event_id) ? () => openDetailsForRequest(req) : null}
        onClockIn={() => handleClockIn(shiftId, calItem)}
        onClockOut={() => handleClockOut(shiftId, calItem)}
        onBoard={() => setActiveDiscussionShift(req.shift)}
        onHandOff={() => {
```
Replace with:
```jsx
        onDetails={(calItem || req.shift?.event_id) ? () => openDetailsForRequest(req) : null}
        onClockIn={() => handleClockIn(shiftId, calItem)}
        onClockOut={() => setClockOutAsk({ shiftId, item: calItem, title: req.shift?.title || calItem?.title || 'this shift' })}
        onBoard={() => setActiveDiscussionShift(req.shift)}
        onHandOff={() => {
```

**Edit 4.** Find:
```jsx
      )}

      {shiftToDrop && (
        <DropShiftDialog
```
Replace with:
```jsx
      )}

      {/* Phase 32.3: Clock out replaces Clock in on the same button, so it asks first (a quick second tap would undo the clock-in) */}
      {clockOutAsk && (
        <ConfirmDialog
          title="Clock out now?"
          message={`You'll be clocked out of ${clockOutAsk.title} right now. If you clocked in less than a minute ago, this undoes the clock-in instead.`}
          confirmLabel="Clock out"
          danger
          onConfirm={() => handleClockOut(clockOutAsk.shiftId, clockOutAsk.item)}
          onClose={() => setClockOutAsk(null)}
        />
      )}

      {shiftToDrop && (
        <DropShiftDialog
```

---

## C4. `frontend/src/components/WorkerOffers.jsx` (EDIT)
Decline left, Accept right.

**Edit 1.** Find:
```jsx
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onAccept(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Check className="w-4 h-4" /> {busy ? '…' : 'Accept'}
              </button>
              <button type="button" onClick={() => onDecline(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <X className="w-4 h-4" /> Decline
              </button>
            </div>
```
Replace with:
```jsx
              )}
            </div>
            {/* Phase 32.3: Decline left, Accept right, like hand-offs and the manager queues */}
            <div className="flex gap-2">
              <button type="button" onClick={() => onDecline(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <X className="w-4 h-4" /> Decline
              </button>
              <button type="button" onClick={() => onAccept(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Check className="w-4 h-4" /> {busy ? '…' : 'Accept'}
              </button>
            </div>
```

---

# PART D: Frontend, manager & admin

## D1. `frontend/src/components/EventRosterModal.jsx` (EDIT)
Deny left, Approve right.

**Edit 1.** Find:
```jsx
                              <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              <button type="button" onClick={() => onApprove && onApprove(p.request_id)} disabled={isFull || approving || denying}
                                title={isFull ? 'Position is full' : 'Approve'}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                                <Check className="w-3 h-3" /> {approving ? '…' : 'Approve'}
                              </button>
                              <button type="button" onClick={() => onDeny && onDeny(p.request_id)} disabled={approving || denying}
                                className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold border border-rose-600/30 inline-flex items-center gap-1 disabled:opacity-40">
                                <X className="w-3 h-3" /> {denying ? '…' : 'Deny'}
                              </button>
                            </div>
```
Replace with:
```jsx
                              <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              {/* Phase 32.3: Deny left, Approve right, like the approval queue and Review */}
                              <button type="button" onClick={() => onDeny && onDeny(p.request_id)} disabled={approving || denying}
                                className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold border border-rose-600/30 inline-flex items-center gap-1 disabled:opacity-40">
                                <X className="w-3 h-3" /> {denying ? '…' : 'Deny'}
                              </button>
                              <button type="button" onClick={() => onApprove && onApprove(p.request_id)} disabled={isFull || approving || denying}
                                title={isFull ? 'Position is full' : 'Approve'}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                                <Check className="w-3 h-3" /> {approving ? '…' : 'Approve'}
                              </button>
                            </div>
```

---

## D2. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
Removing a position asks inline.

**Edit 1.** Find:
```jsx
  const [draft, setDraft] = useState(toDraft(position));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(toDraft(position)), [position]);

```
Replace with:
```jsx
  const [draft, setDraft] = useState(toDraft(position));
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);   // Phase 32.3: Remove shares a spot with Bring back, so it asks first
  useEffect(() => setDraft(toDraft(position)), [position]);

```

**Edit 2.** Find:
```jsx
  const toggleActive = async () => {
    setSaving(true);
    try {
      if (position.is_active) await api.delete(`/venues/${venueId}/positions/${position.id}`);
```
Replace with:
```jsx
  const toggleActive = async () => {
    setSaving(true);
    setConfirmRemove(false);
    try {
      if (position.is_active) await api.delete(`/venues/${venueId}/positions/${position.id}`);
```

**Edit 3.** Find:
```jsx
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
```
Replace with:
```jsx
        <button
          type="button"
          onClick={position.is_active ? () => setConfirmRemove(true) : toggleActive}
          disabled={saving || confirmRemove}
          title={position.is_active ? 'Remove from the Post a Shift list' : 'Bring back'}
          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
        >
          {position.is_active ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
        </button>
      </div>
      {confirmRemove && (
        <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 flex flex-wrap items-center gap-2">
          <p className="flex-1 min-w-[12rem] text-xs text-rose-100">
            Remove <b>{position.name}</b> from the Post a Shift list? Shifts already posted keep it, and you can bring it back later.
          </p>
          <button type="button" onClick={() => setConfirmRemove(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200">
            Keep it
          </button>
          <button type="button" onClick={toggleActive} disabled={saving} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white disabled:opacity-50">
            Remove
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-24">
```

---

## D3. `frontend/src/components/VenueLocationsPanel.jsx` (EDITS)
Archiving a location asks inline.

**Edit 1.** Find:
```jsx
  const [draft, setDraft] = useState(locationToDraft(loc));
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(locationToDraft(loc)), [loc]);
```
Replace with:
```jsx
  const [draft, setDraft] = useState(locationToDraft(loc));
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);   // Phase 32.3: Archive shares a spot with Bring back, so it asks first

  useEffect(() => setDraft(locationToDraft(loc)), [loc]);
```

**Edit 2.** Find:
```jsx
  const toggleArchive = async () => {
    setBusy(true);
    try {
      await api.post(`/venues/${venue.id}/locations/${loc.id}/${loc.is_archived ? 'unarchive' : 'archive'}`);
```
Replace with:
```jsx
  const toggleArchive = async () => {
    setBusy(true);
    setConfirmArchive(false);
    try {
      await api.post(`/venues/${venue.id}/locations/${loc.id}/${loc.is_archived ? 'unarchive' : 'archive'}`);
```

**Edit 3.** Find:
```jsx
            </button>
          )}
          <button type="button" onClick={toggleArchive} disabled={busy} title={loc.is_archived ? 'Bring back' : 'Archive'}
            className="p-2 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10">
            {loc.is_archived ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {editing && (
```
Replace with:
```jsx
            </button>
          )}
          <button type="button" onClick={loc.is_archived ? toggleArchive : () => setConfirmArchive(true)} disabled={busy || confirmArchive}
            title={loc.is_archived ? 'Bring back' : 'Archive'}
            className="p-2 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10">
            {loc.is_archived ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {confirmArchive && (
        <div className="mt-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 flex flex-wrap items-center gap-2">
          <p className="flex-1 min-w-[12rem] text-xs text-amber-100">
            Archive <b>{loc.name}</b>? It won't be offered for new events. Events already using it keep it, and you can bring it back later.
          </p>
          <button type="button" onClick={() => setConfirmArchive(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200">
            Keep it
          </button>
          <button type="button" onClick={toggleArchive} disabled={busy} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 disabled:opacity-50">
            Archive
          </button>
        </div>
      )}

      {editing && (
```

---

## D4. `frontend/src/components/admin/AdminUserDrawer.jsx` (EDITS)
Deactivate asks first; the button can't double-fire.

**Edit 1.** Find:
```jsx
import { useAuth } from '../../context/AuthContext';
import ResetPasswordModal from '../ResetPasswordModal';
import ReliabilityBadge from '../ReliabilityBadge';
import { Avatar } from '../WorkerProfilePanel';
```
Replace with:
```jsx
import { useAuth } from '../../context/AuthContext';
import ResetPasswordModal from '../ResetPasswordModal';
import ConfirmDialog from '../ConfirmDialog';
import ReliabilityBadge from '../ReliabilityBadge';
import { Avatar } from '../WorkerProfilePanel';
```

**Edit 2.** Find:
```jsx
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [modal, setModal] = useState(null); // 'reset' | 'delete'

  useEffect(() => {
```
Replace with:
```jsx
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [modal, setModal] = useState(null); // 'reset' | 'delete' | 'deactivate'
  const [statusBusy, setStatusBusy] = useState(false);   // Phase 32.3

  useEffect(() => {
```

**Edit 3.** Find:
```jsx
  };

  const toggleActive = async () => {
    setFormError('');
    try {
      await api.patch(`/admin/users/${userId}`, { is_active: !u.is_active });
      setReload((n) => n + 1);
      onChanged(`${personName(u)} is now ${u.is_active ? 'deactivated and can no longer sign in' : 'active again'}.`);
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Could not change the status.');
    }
  };
```
Replace with:
```jsx
  };

  // Phase 32.3: Reactivate and Deactivate share one button, so Deactivate asks first (see the 'deactivate' dialog)
  const toggleActive = async () => {
    setFormError('');
    setStatusBusy(true);
    try {
      await api.patch(`/admin/users/${userId}`, { is_active: !u.is_active });
      setReload((n) => n + 1);
      onChanged(`${personName(u)} is now ${u.is_active ? 'deactivated and can no longer sign in' : 'active again'}.`);
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Could not change the status.');
    } finally {
      setStatusBusy(false);
    }
  };
```

**Edit 4.** Find:
```jsx
                )}
                {!u.always_admin && (
                  <button type="button" onClick={toggleActive} className={u.is_active ? btnDanger : btnGhost}>
                    <Power className="w-3 h-3" /> {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
```
Replace with:
```jsx
                )}
                {!u.always_admin && (
                  <button type="button" onClick={u.is_active ? () => setModal('deactivate') : toggleActive} disabled={statusBusy}
                    className={`${u.is_active ? btnDanger : btnGhost} disabled:opacity-50`}>
                    <Power className="w-3 h-3" /> {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
```

**Edit 5.** Find:
```jsx
        />
      )}
      {modal === 'delete' && u && (
        <TypeToConfirm
```
Replace with:
```jsx
        />
      )}
      {modal === 'deactivate' && u && (
        <ConfirmDialog
          title={`Deactivate ${personName(u)}?`}
          message="They'll be signed out and can't sign in until you reactivate them. Their history stays."
          confirmLabel="Deactivate"
          danger
          onConfirm={toggleActive}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'delete' && u && (
        <TypeToConfirm
```

---

## E. Rebuild & verification

**Schema changed (one new nullable column).** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS series_id UUID;
CREATE INDEX IF NOT EXISTS idx_shift_events_series ON shift_events(series_id);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)

Existing copied events are **not** linked. To try Part 2, copy an event to a few dates after the rebuild.

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### Checklist
**Part 1 (buttons):**
1. As a worker, open an event → pick a position → **Send request**.
   * The footer becomes **`[Withdraw request] …… [Close]`**. Clicking the same spot again just closes the popup.
   * Reopen it and pick another position: `[Withdraw] …… [Close] [Switch to …]`.
2. Clock in on a shift (My shifts), then tap **Clock out**. You get **"Clock out now?"**, and **Go back** keeps you clocked in.
3. Admin → a user → **Deactivate** asks first. **Reactivate** doesn't.
4. Venue settings → Positions & pay → 🗑 shows "Remove …? [Keep it] [Remove]". Locations → Archive does the same.
5. Offers read **[Decline] [Accept]**, and roster requests read **[Deny] [Approve]**.

**Part 2 (series):**

6. As the manager, open an event → **Copy to dates** → pick 4 dates.
7. As a worker, Find Shifts shows those cards with **"↻ +4 dates"**. Open one and pick a position:
   * "Also request … on other dates" lists the other dates, with open ones ticked.
   * A date that overlaps a shift you're booked on is greyed with the reason.
   * The button reads **"Request 5 dates"**.
8. Send. The popup reports what was booked or requested (and anything not sent). My shifts shows each date separately.
9. As the manager, the approval queue has **one request per date**. Approve one, deny another: they're independent.
10. An event you didn't copy, or one made from a template, shows no series box.