# Phase 26.2: Worker Calendar, Big Date & Time, and "Don't Miss Anything" Notes

Workers need to see their week at a glance and never miss what matters: **when, where, what to wear, how to get in, and what changed**. This phase adds:

1. **Calendar tab** for workers (new `WorkerCalendar.jsx`):
   * a month grid with a day agenda below it, plus a List view
   * phones see coloured dots; tablet and desktop see "6:00 PM Bartender" chips
   * days are computed in each **venue's** timezone
   * a "Your next shift" hero at the top: big date, big time, countdown
   * an optional overlay of **open shifts** (dashed) that opens the 26.1 request modal
2. **Shift details modal** for the worker's own shifts (new `ShiftDetailsModal.jsx`):
   * the date and time in **large type**, the length, a countdown and the status
   * where to go, directions, phone and pay
   * **every note laid out openly**, none hidden behind a click: when you arrive, dress code, event notes, position notes, venue notes
3. **Staff-only notes, shown once confirmed.** Managers can add notes at the event level and per position that **only booked workers** see: door codes, parking, point of contact, POS login. A worker who is still waiting sees "More details will show here once the manager confirms you."
4. **Change tracking and "Got it"**:
   * When a manager edits a posted event, the change is recorded as plain text: time (with old and new times in venue time), title, notes, staff notes, position pay, position notes.
   * Booked workers get an amber **UPDATED / PLEASE READ** flag on the calendar, My Schedule and a dashboard banner, until they tap **"Got it — I've read this"**.
   * First-time notes also need a "Got it".
   * Managers see **Read ✓** or **Not read yet** next to each booked person in the roster.
5. The 26.1 event modal also shows the staff-only notes to people who are booked.

## 0. Rules for this phase (read first)
* Do **NOT** touch `backend/src/auth.py`, `main.py` CORS logic, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, or `frontend/vite.config.js`.
* No native PostgreSQL ENUMs. Use aware UTC datetimes only (`datetime.now(timezone.utc)`, `as_utc()` from `services/booking.py`).
* Never `UserResponse.model_validate(<ORM User>)`. Never touch an ORM relationship that wasn't `selectinload`-ed.
* Staff-only notes must **never** be sent to someone who isn't booked on that event or position (or who doesn't manage the venue / isn't an admin). Do **not** add `staff_notes` to `ShiftResponse`, `PublicEventPosition`, or any public or venue-profile schema.
* **FULL FILE** means replace the whole file. **EDIT** means change only what's shown.
* **Schema change → rebuild required** (see §17).

---

## 1. Database — `database/init.sql` (EDITS)

### 1a. `CREATE TABLE shift_events` — add three columns after `notes TEXT,`
```sql
    notes TEXT,
    staff_notes TEXT,
    info_updated_at TIMESTAMPTZ,
    info_change TEXT,
    cancelled_at TIMESTAMPTZ,
```
### 1b. `CREATE TABLE shifts` — add three columns after `description TEXT,`
```sql
    description TEXT,
    staff_notes TEXT,
    info_updated_at TIMESTAMPTZ,
    info_change TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
```
### 1c. `CREATE TABLE shift_requests` — add one column after `pay_rate NUMERIC(10, 2),`
```sql
    pay_rate NUMERIC(10, 2),
    info_seen_at TIMESTAMPTZ,
```

## 2. Models — `backend/src/models.py` (EDITS)

### 2a. `class ShiftEvent` — directly under `notes = Column(Text, nullable=True)`
```python
    staff_notes = Column(Text, nullable=True)                              # Phase 26.2: booked staff only
    info_updated_at = Column(DateTime(timezone=True), nullable=True)       # Phase 26.2: last time/notes change
    info_change = Column(Text, nullable=True)                              # Phase 26.2: "Time changed: …"
```
### 2b. `class Shift` — directly under `description = Column(Text, nullable=True)`
```python
    staff_notes = Column(Text, nullable=True)                              # Phase 26.2: booked staff only
    info_updated_at = Column(DateTime(timezone=True), nullable=True)       # Phase 26.2
    info_change = Column(Text, nullable=True)                              # Phase 26.2
```
### 2c. `class ShiftRequest` — directly under `pay_rate = Column(Numeric(10, 2), nullable=True)`
```python
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
```

---

## 3. Schemas — `backend/src/schemas.py` (EDITS)

Add a field to each existing class listed. Put it directly after the field named, and keep everything else in the class.

| Class | Add after | New line |
|---|---|---|
| `EventPositionInput` | `role_notes: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2: only shown to people booked on this position` |
| `EventCreate` | `notes: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2: only shown to booked staff` |
| `EventUpdate` | `notes: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2` |
| `EventDetailPosition` | `role_notes: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2` |
| `EventDetail` | `notes: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2` |
| `RosterPerson` | `note: Optional[str] = None` | `info_seen: Optional[bool] = None    # Phase 26.2: booked person has read the latest shift info (None = nothing to read)` |
| `EventPosition` | `role_notes: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2` |
| `VenueEventResponse` | `description: Optional[str] = None` | `staff_notes: Optional[str] = None        # Phase 26.2` |
| `ListingPosition` | `my_status_reason: Optional[str] = None` | `staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)` |
| `EventListing` | `conflict: Optional[str] = None` | `staff_notes: Optional[str] = None                 # Phase 26.2: only when the viewer is booked in this event (or manages)` |

Then **append at the very end of the file**:
```python
# ------------------------------------------------------------------------------
# Phase 26.2: Worker calendar + "make sure they read it"
# ------------------------------------------------------------------------------
class WorkerCalendarItem(BaseModel):
    request_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    status: str                                   # the worker's request status
    status_reason: Optional[str] = None
    booked: bool                                  # approved / confirmed / checked_in / completed
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    hours: float
    venue: ListingVenue
    hourly_rate: Optional[float] = None           # None = hidden until booked
    hourly_rate_max: Optional[float] = None
    pay_rate: Optional[float] = None              # manager-set rate for this person (booked only)
    tips_eligible: bool = False
    tip_pool: bool = False
    event_notes: Optional[str] = None
    role_notes: Optional[str] = None
    event_staff_notes: Optional[str] = None       # booked only
    position_staff_notes: Optional[str] = None    # booked only
    staff_notes_locked: bool = False              # waiting + staff notes exist -> "more details once confirmed"
    info_change: Optional[str] = None             # what changed since the worker last read it
    info_updated_at: Optional[datetime] = None
    info_seen_at: Optional[datetime] = None
    needs_ack: bool = False                       # show "Please read" until they tap "Got it"
    clocked_in: bool = False
    cancelled: bool = False
    cancel_reason: Optional[str] = None


class WorkerCalendarResponse(BaseModel):
    range_start: datetime
    range_end: datetime
    unread_count: int
    items: List[WorkerCalendarItem]


class InfoAckResponse(BaseModel):
    request_id: UUID
    info_seen_at: datetime
```

---

## 4. Backend — `backend/src/services/shift_events.py` (FULL FILE REPLACEMENT)

What changed:
* new helpers `_money()` and `_fmt_range()`
* `_apply_position(..., track_changes=False)` stores `staff_notes`, and when editing an existing position it records changes: renamed, pay, notes, staff notes
* `create_event_with_positions` saves `staff_notes`
* `update_event` records time, title, notes and staff-notes changes in `event.info_change` / `event.info_updated_at`, with old and new times written in the venue's timezone
* `build_event_detail` and `duplicate_event` carry `staff_notes`

```python
"""
Phase 25.2: Create / update / describe events (one posting with 1+ positions).
Each position is a row in `shifts` linked by shifts.event_id.
"""
from datetime import timezone, datetime, date
from typing import Dict, Tuple, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, User
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
)

VALID_APPROVAL_MODES = ("venue_default", "auto", "manual")
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PENDING_STATUSES = ("pending", "pending_manager_approval")
ACTIVE_REQUEST_STATUSES = PENDING_STATUSES + ("approved", "confirmed")


def _as_utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _clean(text):
    if text is None:
        return None
    text = str(text).strip()
    return text or None


def _money(v):
    return None if v is None else round(float(v), 2)


def _fmt_range(start, end, tz_name: str) -> str:
    """Phase 26.2: 'Fri Oct 3, 6:00 PM – 11:00 PM' in the venue's timezone."""
    try:
        tz = ZoneInfo(tz_name or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    s_local = _as_utc(start).astimezone(tz)
    e_local = _as_utc(end).astimezone(tz)
    return f"{s_local.strftime('%a %b %-d, %-I:%M %p')} – {e_local.strftime('%-I:%M %p')}"


def _validate_basics(data) -> None:
    if not (data.title or "").strip():
        raise HTTPException(status_code=400, detail="Give the event a name.")
    if _as_utc(data.end_time) <= _as_utc(data.start_time):
        raise HTTPException(status_code=400, detail="End time must be after the start time.")
    if not data.positions:
        raise HTTPException(status_code=400, detail="Add at least one position.")


def _validate_position(p: EventPositionInput) -> None:
    name = (p.role_type or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Every position needs a name.")
    if p.capacity is None or p.capacity < 1:
        raise HTTPException(status_code=400, detail=f"{name}: needs at least 1 spot.")
    if p.hourly_rate is None or p.hourly_rate <= 0:
        raise HTTPException(status_code=400, detail=f"{name}: pay must be more than $0.")
    if p.hourly_rate_max is not None and p.hourly_rate_max < p.hourly_rate:
        raise HTTPException(status_code=400, detail=f"{name}: the top of the pay range can't be lower than the bottom.")
    mode = (p.approval_mode or "venue_default").lower()
    if mode not in VALID_APPROVAL_MODES:
        raise HTTPException(status_code=400, detail=f"{name}: approval must be venue_default, auto, or manual.")


def _apply_position(shift: Shift, p: EventPositionInput, event: ShiftEvent, track_changes: bool = False) -> None:
    """
    Copy form values onto a Shift row. track_changes=True (existing positions being edited)
    records what changed in shift.info_change / info_updated_at so booked workers are told (Phase 26.2).
    """
    mode = (p.approval_mode or "venue_default").lower()
    new_role = p.role_type.strip()[:100]
    new_rate_max = p.hourly_rate_max if (p.hourly_rate_max is not None and p.hourly_rate_max > p.hourly_rate) else None
    new_desc = _clean(p.role_notes)
    new_staff = _clean(p.staff_notes)

    changes = []
    if track_changes:
        if (shift.role_type or "") != new_role:
            changes.append(f"Position renamed to {new_role}")
        if _money(shift.hourly_rate) != _money(p.hourly_rate) or _money(shift.hourly_rate_max) != _money(new_rate_max):
            changes.append("Pay updated")
        if _clean(shift.description) != new_desc:
            changes.append("Position notes updated")
        if _clean(shift.staff_notes) != new_staff:
            changes.append("Staff-only notes updated")

    shift.title = event.title
    shift.start_time = event.start_time
    shift.end_time = event.end_time
    shift.role_type = new_role
    shift.capacity = int(p.capacity)
    shift.hourly_rate = p.hourly_rate
    shift.hourly_rate_max = new_rate_max
    shift.hide_rate = bool(p.hide_rate)
    shift.tips_eligible = bool(p.tips_eligible)
    shift.tip_pool = bool(p.tips_eligible and p.tip_pool)
    shift.description = new_desc                      # description = position notes
    shift.staff_notes = new_staff                     # Phase 26.2: booked staff only
    shift.approval_mode = mode
    shift.is_shift_auto_confirm = (mode == "auto")    # kept in sync for older screens

    if changes:
        shift.info_updated_at = datetime.now(timezone.utc)
        shift.info_change = "; ".join(changes)


async def _request_counts(db: AsyncSession, shift_ids) -> Dict:
    """{shift_id: (assigned, pending)}"""
    if not shift_ids:
        return {}
    rows = (await db.execute(
        select(ShiftRequest.shift_id, func.lower(ShiftRequest.status), func.count(ShiftRequest.id))
        .where(ShiftRequest.shift_id.in_(shift_ids))
        .group_by(ShiftRequest.shift_id, func.lower(ShiftRequest.status))
    )).all()
    out: Dict = {}
    for sid, st, n in rows:
        a, p = out.get(sid, (0, 0))
        if st in ASSIGNED_STATUSES:
            a += int(n)
        elif st in PENDING_STATUSES:
            p += int(n)
        out[sid] = (a, p)
    return out


async def create_event_with_positions(db: AsyncSession, venue: Venue, user: User, data: EventCreate) -> ShiftEvent:
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)
    try:
        event = ShiftEvent(
            venue_id=venue.id,
            created_by_user_id=user.id,
            title=data.title.strip()[:255],
            start_time=_as_utc(data.start_time),
            end_time=_as_utc(data.end_time),
            notes=_clean(data.notes),
            staff_notes=_clean(data.staff_notes),
        )
        db.add(event)
        await db.flush()
        for p in data.positions:
            s = Shift(venue_id=venue.id, event_id=event.id, created_by_user_id=user.id, spots_filled=0, status="OPEN")
            _apply_position(s, p, event)
            db.add(s)
        await db.commit()
        await db.refresh(event)
        return event
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to post shift: {str(e)}")


async def update_event(db: AsyncSession, event: ShiftEvent, data: EventUpdate) -> None:
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="Cancelled events can't be edited.")
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)

    existing = (await db.execute(
        select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
    )).scalars().all()
    by_id = {s.id: s for s in existing}
    counts = await _request_counts(db, list(by_id.keys()))

    keep_ids = {p.shift_id for p in data.positions if p.shift_id}
    unknown = keep_ids - set(by_id.keys())
    if unknown:
        raise HTTPException(status_code=400, detail="One of the positions doesn't belong to this event.")

    for s in existing:
        if s.id not in keep_ids:
            a, pn = counts.get(s.id, (0, 0))
            if a + pn > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{s.role_type}' has {a} booked and {pn} waiting. Remove or deny them before deleting this position."
                )

    for p in data.positions:
        if p.shift_id:
            a, _ = counts.get(p.shift_id, (0, 0))
            if p.capacity < a:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{p.role_type}' already has {a} people booked, so it needs at least {a} spots."
                )

    try:
        # Phase 26.2: work out what changed so booked workers are told
        tz_name = await db.scalar(select(Venue.timezone).where(Venue.id == event.venue_id)) or "America/New_York"
        new_title = data.title.strip()[:255]
        new_start, new_end = _as_utc(data.start_time), _as_utc(data.end_time)
        changes = []
        if _as_utc(event.start_time) != new_start or _as_utc(event.end_time) != new_end:
            changes.append(
                f"Time changed: {_fmt_range(event.start_time, event.end_time, tz_name)} → {_fmt_range(new_start, new_end, tz_name)}"
            )
        if (event.title or "") != new_title:
            changes.append(f"Renamed to \u201c{new_title}\u201d")
        if _clean(event.notes) != _clean(data.notes):
            changes.append("Event notes updated")
        if _clean(event.staff_notes) != _clean(data.staff_notes):
            changes.append("Staff-only notes updated")

        event.title = new_title
        event.start_time = new_start
        event.end_time = new_end
        event.notes = _clean(data.notes)
        event.staff_notes = _clean(data.staff_notes)
        if changes:
            event.info_updated_at = datetime.now(timezone.utc)
            event.info_change = "; ".join(changes)

        remove_ids = [s.id for s in existing if s.id not in keep_ids]
        if remove_ids:
            await db.execute(delete(Shift).where(Shift.id.in_(remove_ids)))

        for p in data.positions:
            if p.shift_id:
                s = by_id[p.shift_id]
                _apply_position(s, p, event, track_changes=True)
                if (s.status or "OPEN").upper() in ("OPEN", "FILLED"):
                    s.status = "FILLED" if (s.spots_filled or 0) >= s.capacity else "OPEN"
            else:
                s = Shift(
                    venue_id=event.venue_id, event_id=event.id,
                    created_by_user_id=event.created_by_user_id, spots_filled=0, status="OPEN",
                )
                _apply_position(s, p, event)
                db.add(s)

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update event: {str(e)}")


async def build_event_detail(db: AsyncSession, event: ShiftEvent) -> EventDetail:
    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    counts = await _request_counts(db, [s.id for s in shifts])
    return EventDetail(
        id=event.id,
        venue_id=event.venue_id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        notes=event.notes,
        staff_notes=event.staff_notes,
        cancelled=event.cancelled_at is not None,
        cancel_reason=event.cancel_reason,
        positions=[
            EventDetailPosition(
                shift_id=s.id,
                role_type=s.role_type,
                capacity=s.capacity,
                spots_filled=s.spots_filled or 0,
                assigned_count=counts.get(s.id, (0, 0))[0],
                pending_count=counts.get(s.id, (0, 0))[1],
                hourly_rate=float(s.hourly_rate),
                hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
                hide_rate=bool(s.hide_rate),
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
                role_notes=s.description,
                staff_notes=s.staff_notes,
                approval_mode=s.approval_mode or "venue_default",
                status=s.status or "OPEN",
            )
            for s in shifts
        ],
    )


async def backfill_missing_events(db: AsyncSession) -> int:
    """Gives every shift without an event_id an event (grouped by venue + title + times). Idempotent."""
    orphans = (await db.execute(
        select(Shift).where(Shift.event_id.is_(None)).order_by(Shift.start_time.asc())
    )).scalars().all()
    if not orphans:
        return 0
    groups: Dict[Tuple, ShiftEvent] = {}
    try:
        for s in orphans:
            key = (s.venue_id, s.title, s.start_time, s.end_time)
            if key not in groups:
                ev = ShiftEvent(
                    venue_id=s.venue_id, created_by_user_id=s.created_by_user_id,
                    title=s.title, start_time=s.start_time, end_time=s.end_time,
                )
                db.add(ev)
                await db.flush()
                groups[key] = ev
            s.event_id = groups[key].id
            if s.is_shift_auto_confirm and (s.approval_mode or "venue_default") == "venue_default":
                s.approval_mode = "auto"
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return len(orphans)


# ------------------------------------------------------------------------------
# Phase 26: Cancel + duplicate
# ------------------------------------------------------------------------------
async def cancel_shifts(db: AsyncSession, event: ShiftEvent, shift_ids: Optional[List], reason: Optional[str]) -> int:
    """Cancel all positions (shift_ids=None) or some positions. Returns how many requests were cancelled."""
    now = datetime.now(timezone.utc)
    reason = _clean(reason)
    if not reason:
        raise HTTPException(status_code=400, detail="Please give a reason. Staff will see it.")
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event is already cancelled.")
    if _as_utc(event.start_time) <= now:
        raise HTTPException(
            status_code=400,
            detail="This event has already started. Remove individual people or fix the time sheet instead."
        )

    q = select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
    if shift_ids is not None:
        q = q.where(Shift.id.in_(shift_ids))
    shifts = (await db.execute(q)).scalars().all()
    if shift_ids is not None and not shifts:
        raise HTTPException(status_code=404, detail="Position not found or already cancelled.")

    try:
        ids = [s.id for s in shifts]
        for s in shifts:
            s.status = "CANCELLED"
            s.cancelled_at = now
            s.cancel_reason = reason
            s.spots_filled = 0
        affected = 0
        if ids:
            res = await db.execute(
                update(ShiftRequest)
                .where(
                    ShiftRequest.shift_id.in_(ids),
                    func.lower(ShiftRequest.status).in_(ACTIVE_REQUEST_STATUSES),
                )
                .values(status="cancelled", status_reason=reason)
                .execution_options(synchronize_session=False)
            )
            affected = res.rowcount or 0
        await db.flush()
        remaining = await db.scalar(
            select(func.count(Shift.id)).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        )
        if not remaining:
            event.cancelled_at = now
            event.cancel_reason = reason
        await db.commit()
        return affected
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to cancel: {str(e)}")


async def duplicate_event(db: AsyncSession, event: ShiftEvent, venue: Venue, user: User, dates: List[date]) -> List[ShiftEvent]:
    """Copy an event to each date, keeping the same local start time in the venue's timezone."""
    unique_dates = sorted(set(dates or []))
    if not unique_dates:
        raise HTTPException(status_code=400, detail="Pick at least one date.")
    if len(unique_dates) > 26:
        raise HTTPException(status_code=400, detail="You can make up to 26 copies at a time.")

    tz = ZoneInfo(venue.timezone or "America/New_York")
    start_local = _as_utc(event.start_time).astimezone(tz)
    duration = _as_utc(event.end_time) - _as_utc(event.start_time)
    now = datetime.now(timezone.utc)

    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc())
    )).scalars().all()
    if not shifts:
        raise HTTPException(status_code=400, detail="Nothing to copy: every position is cancelled.")

    positions = [
        EventPositionInput(
            role_type=s.role_type,
            capacity=s.capacity,
            hourly_rate=float(s.hourly_rate),
            hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
            hide_rate=bool(s.hide_rate),
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            role_notes=s.description,
            staff_notes=s.staff_notes,
            approval_mode=s.approval_mode or "venue_default",
        )
        for s in shifts
    ]

    starts = []
    for d in unique_dates:
        new_start = datetime.combine(d, start_local.time().replace(tzinfo=None), tzinfo=tz).astimezone(timezone.utc)
        if new_start <= now:
            raise HTTPException(status_code=400, detail=f"{d.isoformat()} is in the past.")
        starts.append(new_start)

    created = []
    for new_start in starts:
        ev = await create_event_with_positions(db, venue, user, EventCreate(
            venue_id=venue.id,
            title=event.title,
            start_time=new_start,
            end_time=new_start + duration,
            notes=event.notes,
            staff_notes=event.staff_notes,
            positions=positions,
        ))
        created.append(ev)
    return created
```

---

## 5. Backend — NEW FILE `backend/src/services/worker_calendar.py`

```python
"""
Phase 26.2: The worker's own calendar, plus "did they read it?" tracking.

A booked worker must acknowledge the shift info when:
* the shift has any notes they haven't acknowledged yet (venue, event, position or staff-only notes), or
* the manager changed the time / notes / pay after the worker booked or last acknowledged.
Staff-only notes are shown only to people BOOKED on the shift (and to managers / admins).
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, Venue, TimeEntry, User
from src.schemas import WorkerCalendarItem, WorkerCalendarResponse, ListingVenue
from src.services.booking import as_utc, ASSIGNED_STATUSES, PENDING_STATUSES

CALENDAR_STATUSES = PENDING_STATUSES + ASSIGNED_STATUSES + ("cancelled", "removed", "no_show")
DEFAULT_PAST = timedelta(days=60)
DEFAULT_FUTURE = timedelta(days=180)
MAX_SPAN = timedelta(days=400)


def latest_info_update(event: Optional[ShiftEvent], shift: Shift) -> Optional[datetime]:
    stamps = [as_utc(d) for d in (
        event.info_updated_at if event is not None else None,
        shift.info_updated_at,
    ) if d is not None]
    return max(stamps) if stamps else None


def info_change_text(event: Optional[ShiftEvent], shift: Shift) -> Optional[str]:
    parts = []
    if event is not None and event.info_change:
        parts.append(event.info_change)
    if shift.info_change:
        parts.append(f"{shift.role_type}: {shift.info_change}")
    return " · ".join(parts) or None


def has_any_notes(venue: Optional[Venue], event: Optional[ShiftEvent], shift: Shift) -> bool:
    values = [shift.description, shift.staff_notes]
    if event is not None:
        values += [event.notes, event.staff_notes]
    if venue is not None:
        values += [venue.default_shift_notes, venue.dress_code, venue.arrival_instructions]
    return any((v or "").strip() for v in values)


def needs_ack(
    *,
    booked: bool,
    has_notes: bool,
    updated_at: Optional[datetime],
    seen_at: Optional[datetime],
    booked_at: Optional[datetime],
) -> bool:
    """True = show the "Please read" flag until the worker taps "Got it"."""
    if not booked:
        return False
    if seen_at is None:
        if has_notes:
            return True
        return updated_at is not None and booked_at is not None and as_utc(updated_at) > as_utc(booked_at)
    return updated_at is not None and as_utc(updated_at) > as_utc(seen_at)


async def build_worker_calendar(
    db: AsyncSession,
    user: User,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> WorkerCalendarResponse:
    now = datetime.now(timezone.utc)
    range_start = as_utc(start) if start else now - DEFAULT_PAST
    range_end = as_utc(end) if end else now + DEFAULT_FUTURE
    if range_end <= range_start:
        raise HTTPException(status_code=400, detail="end must be after start.")
    if range_end - range_start > MAX_SPAN:
        raise HTTPException(status_code=400, detail="Pick a range of 400 days or less.")

    rows = (await db.execute(
        select(ShiftRequest, Shift)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(CALENDAR_STATUSES),
            Shift.start_time < range_end,
            Shift.end_time > range_start,
        )
        .order_by(Shift.start_time.asc())
    )).all()
    if not rows:
        return WorkerCalendarResponse(range_start=range_start, range_end=range_end, unread_count=0, items=[])

    shifts = [s for _, s in rows]
    event_ids = {s.event_id for s in shifts if s.event_id}
    venue_ids = {s.venue_id for s in shifts}
    events = {}
    if event_ids:
        events = {e.id: e for e in (await db.execute(
            select(ShiftEvent).where(ShiftEvent.id.in_(event_ids))
        )).scalars().all()}
    venues = {v.id: v for v in (await db.execute(
        select(Venue).where(Venue.id.in_(venue_ids))
    )).scalars().all()}

    open_entries = set((await db.execute(
        select(TimeEntry.shift_id).where(
            TimeEntry.worker_id == user.id,
            TimeEntry.shift_id.in_([s.id for s in shifts]),
            TimeEntry.clock_out_time.is_(None),
        )
    )).scalars().all())

    items: List[WorkerCalendarItem] = []
    for req, s in rows:
        venue = venues.get(s.venue_id)
        if venue is None:
            continue
        event = events.get(s.event_id) if s.event_id else None
        status = (req.status or "").lower()
        booked = status in ASSIGNED_STATUSES
        start_utc, end_utc = as_utc(s.start_time), as_utc(s.end_time)
        hours = round(max(0.0, (end_utc - start_utc).total_seconds() / 3600.0), 2)

        show_pay = booked or not s.hide_rate
        ev_staff = event.staff_notes if event is not None else None
        updated = latest_info_update(event, s)
        seen = req.info_seen_at
        booked_at = req.approved_at or req.created_at
        flag = needs_ack(
            booked=booked,
            has_notes=has_any_notes(venue, event, s),
            updated_at=updated,
            seen_at=seen,
            booked_at=booked_at,
        )
        # Only describe changes the worker hasn't seen, and only ones made after they booked.
        change = None
        if booked and updated is not None:
            reference = seen or booked_at
            if reference is None or updated > as_utc(reference):
                change = info_change_text(event, s)

        items.append(WorkerCalendarItem(
            request_id=req.id,
            shift_id=s.id,
            event_id=s.event_id,
            status=status,
            status_reason=req.status_reason,
            booked=booked,
            title=(event.title if event is not None else s.title) or "Shift",
            role_type=s.role_type or "Worker",
            start_time=s.start_time,
            end_time=s.end_time,
            hours=hours,
            venue=ListingVenue(
                id=venue.id,
                name=venue.name,
                address=venue.address,
                timezone=venue.timezone or "America/New_York",
                logo_url=venue.logo_url,
                phone=venue.phone,
                lat=float(venue.lat) if venue.lat is not None else None,
                lng=float(venue.lng) if venue.lng is not None else None,
                dress_code=venue.dress_code,
                arrival_instructions=venue.arrival_instructions,
                default_shift_notes=venue.default_shift_notes,
            ),
            hourly_rate=float(s.hourly_rate) if (show_pay and s.hourly_rate is not None) else None,
            hourly_rate_max=float(s.hourly_rate_max) if (show_pay and s.hourly_rate_max is not None) else None,
            pay_rate=float(req.pay_rate) if (booked and req.pay_rate is not None) else None,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            event_notes=event.notes if event is not None else None,
            role_notes=s.description,
            event_staff_notes=ev_staff if booked else None,
            position_staff_notes=s.staff_notes if booked else None,
            staff_notes_locked=(not booked) and bool((ev_staff or "").strip() or (s.staff_notes or "").strip()),
            info_change=change,
            info_updated_at=updated,
            info_seen_at=seen,
            needs_ack=flag,
            clocked_in=(status == "checked_in") or (s.id in open_entries),
            cancelled=(event is not None and event.cancelled_at is not None) or (s.status or "").upper() == "CANCELLED",
            cancel_reason=(event.cancel_reason if event is not None and event.cancelled_at is not None else s.cancel_reason),
        ))

    unread = sum(1 for i in items if i.needs_ack and as_utc(i.end_time) > now)
    return WorkerCalendarResponse(range_start=range_start, range_end=range_end, unread_count=unread, items=items)


async def acknowledge_info(db: AsyncSession, user: User, request_id: UUID) -> datetime:
    """Worker taps "Got it". Only for their own booked shifts. Commits."""
    try:
        req = await db.scalar(
            select(ShiftRequest).where(ShiftRequest.id == request_id, ShiftRequest.worker_id == user.id)
        )
        if req is None:
            raise HTTPException(status_code=404, detail="Shift not found.")
        if (req.status or "").lower() not in ASSIGNED_STATUSES:
            raise HTTPException(status_code=400, detail="Only booked shifts can be marked as read.")
        stamp = datetime.now(timezone.utc)
        req.info_seen_at = stamp
        await db.commit()
        return stamp
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
```

**Rules in plain words:**
* A booked worker is flagged **PLEASE READ** the first time the shift has any notes (venue arrival, dress code, venue notes, event notes, position notes, staff notes).
* They are flagged **UPDATED** whenever the manager changes the time, title, notes, staff notes, position pay or position notes after the worker booked or last tapped "Got it".
* The "what changed" text only covers the **latest** edit.

---

## 6. Backend — NEW FILE `backend/src/routers/me.py`

| Method | URL | Auth | Returns |
|---|---|---|---|
| GET | `/api/me/calendar?start=&end=` | any logged-in user (their own data only) | `WorkerCalendarResponse`. Default range: 60 days back to 180 days ahead. Max 400 days. |
| POST | `/api/me/requests/{request_id}/ack` | any logged-in user; must own the request and be **booked** | `InfoAckResponse` (sets `shift_requests.info_seen_at = now`) |

`acknowledge_info()` does its own `try/except` with `await db.rollback()`.

```python
"""
Phase 26.2: The signed-in worker's own calendar and "I've read this" acknowledgements.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User
from src.schemas import WorkerCalendarResponse, InfoAckResponse
from src.auth import get_current_user
from src.services.worker_calendar import build_worker_calendar, acknowledge_info

router = APIRouter(prefix="/api/me", tags=["My Schedule"])


@router.get("/calendar", response_model=WorkerCalendarResponse)
async def my_calendar(
    start: Optional[datetime] = Query(None, description="Range start (ISO, default: 60 days ago)"),
    end: Optional[datetime] = Query(None, description="Range end (ISO, default: 180 days ahead)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every shift the worker is booked on or waiting for (plus cancelled / removed / no-show) in the range."""
    return await build_worker_calendar(db, current_user, start, end)


@router.post("/requests/{request_id}/ack", response_model=InfoAckResponse)
async def acknowledge_shift_info(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Worker confirms they've read the latest notes / changes for a booked shift."""
    stamp = await acknowledge_info(db, current_user, request_id)
    return InfoAckResponse(request_id=request_id, info_seen_at=stamp)
```

---

## 7. Backend — `backend/src/main.py` (EDIT)
Directly under `from src.routers.listings import router as listings_router` add:
```python
from src.routers.me import router as me_router
```
Directly under `app.include_router(listings_router)` add:
```python
app.include_router(me_router)
```

---

## 8. Backend — `backend/src/services/listings.py` (EDITS)

### 8a. In the `positions.append(ListingPosition(...))` call, find:
```python
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
            ))
```
Replace with:
```python
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
                staff_notes=s.staff_notes if (can_see_all_pay or my_status in ASSIGNED_STATUSES) else None,
            ))
```
### 8b. At the end of the `out.append(EventListing(...))` call, find:
```python
            started=started,
            can_request=can_request,
        ))
```
Replace with:
```python
            started=started,
            can_request=can_request,
            staff_notes=ev.staff_notes if (
                can_see_all_pay or (my_request is not None and my_request.status in ASSIGNED_STATUSES)
            ) else None,
        ))
```

---

## 9. Backend — `backend/src/routers/venues.py` (EDITS in `get_venue_events` + import)

### 9a. Import — directly under `from src.services.shift_views import to_shift_responses`
```python
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack
```

### 9b. Remember each request's read time. Find:
```python
    assigned_by_shift = defaultdict(list)
    requested_by_shift = defaultdict(list)
    for req, worker in req_rows:
```
Replace with:
```python
    assigned_by_shift = defaultdict(list)
    requested_by_shift = defaultdict(list)
    ack_by_request = {}   # Phase 26.2: request_id -> (info_seen_at, booked_at)
    for req, worker in req_rows:
        ack_by_request[req.id] = (req.info_seen_at, req.approved_at or req.created_at)
```

### 9c. Load full event rows and compute "Read" per booked person. Find:
```python
    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes, event_cancel = {}, {}
    if event_ids:
        for eid, enotes, ecan, ereason in (await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes, ShiftEvent.cancelled_at, ShiftEvent.cancel_reason)
            .where(ShiftEvent.id.in_(event_ids))
        )).all():
            event_notes[eid] = enotes
            event_cancel[eid] = (ecan is not None, ereason)
```
Replace with:
```python
    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes, event_cancel = {}, {}
    event_objs = {}   # Phase 26.2
    if event_ids:
        for ev_obj in (await db.execute(
            select(ShiftEvent).where(ShiftEvent.id.in_(event_ids))
        )).scalars().all():
            event_objs[ev_obj.id] = ev_obj
            event_notes[ev_obj.id] = ev_obj.notes
            event_cancel[ev_obj.id] = (ev_obj.cancelled_at is not None, ev_obj.cancel_reason)
    venue_obj = await db.scalar(select(Venue).where(Venue.id == venue_id))

    # Phase 26.2: has each booked person read the latest info?
    for s in shifts:
        ev_obj = event_objs.get(s.event_id) if s.event_id else None
        notes_exist = has_any_notes(venue_obj, ev_obj, s)
        updated = latest_info_update(ev_obj, s)
        for person in assigned_by_shift[s.id]:
            seen_at, booked_at = ack_by_request.get(person.request_id, (None, None))
            if notes_exist or updated is not None:
                person.info_seen = not needs_ack(
                    booked=True, has_notes=notes_exist, updated_at=updated,
                    seen_at=seen_at, booked_at=booked_at,
                )
```

### 9d. Event dict — find:
```python
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "cancelled":
```
Replace with (only the first two lines shown change; the rest of the `"cancelled": …` line stays):
```python
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "staff_notes": event_objs[s.event_id].staff_notes if s.event_id in event_objs else None,
                "cancelled":
```

### 9e. `EventPosition(...)` — find:
```python
            role_notes=s.description,
            approval_mode=s.approval_mode or "venue_default",
            capacity=s.capacity if s.capacity is not None else 1,
```
Replace with:
```python
            role_notes=s.description,
            staff_notes=s.staff_notes,
            approval_mode=s.approval_mode or "venue_default",
            capacity=s.capacity if s.capacity is not None else 1,
```

---

## 10. Frontend — `frontend/src/utils/listingFormat.js` (EDIT: append at end of file)

```javascript
// ---- Phase 26.2: calendar helpers -------------------------------------------------------

/** "2026-10-03" for the calendar day the moment falls on in timezone `tz` (device zone if missing). */
export function localDateKey(value, tz) {
  const d = value instanceof Date ? value : new Date(value);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
}

/** "2026-10-03" for a plain calendar Date built on the device (month grid cells). */
export function gridDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Starts in 2 days 4 hrs" / "Starts in 45 min" / "Happening now" / "Ended" */
export function countdownText(start, end) {
  const now = Date.now();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (now >= e) return 'Ended';
  if (now >= s) return 'Happening now';
  const mins = Math.round((s - now) / 60000);
  if (mins < 60) return `Starts in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const rem = mins % 60;
    return `Starts in ${hrs} hr${hrs === 1 ? '' : 's'}${rem ? ` ${rem} min` : ''}`;
  }
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return `Starts in ${days} day${days === 1 ? '' : 's'}${remH ? ` ${remH} hr${remH === 1 ? '' : 's'}` : ''}`;
}

/** Visual style per calendar item, by the worker's status. */
export function calendarTone(item) {
  const s = String(item?.status || '').toLowerCase();
  if (item?.cancelled || ['cancelled', 'removed', 'no_show'].includes(s)) {
    return { key: 'off', chip: 'bg-slate-800/80 text-slate-400 border-slate-700 line-through', dot: 'bg-slate-500', label: STATUS_LABELS[s] || 'Cancelled' };
  }
  if (s === 'completed') {
    return { key: 'done', chip: 'bg-slate-700/60 text-slate-200 border-slate-600', dot: 'bg-slate-400', label: 'Completed' };
  }
  if (PENDING_STATUSES.includes(s)) {
    return { key: 'waiting', chip: 'bg-amber-500/15 text-amber-200 border-amber-500/50 border-dashed', dot: 'bg-amber-400', label: 'Waiting for approval' };
  }
  if (s === 'checked_in') {
    return { key: 'now', chip: 'bg-sky-500/20 text-sky-100 border-sky-400/60', dot: 'bg-sky-400', label: 'Clocked in' };
  }
  return { key: 'booked', chip: 'bg-emerald-500/20 text-emerald-100 border-emerald-500/60', dot: 'bg-emerald-400', label: 'Confirmed' };
}
```

---

## 11. Frontend — NEW FILE `frontend/src/components/WorkerCalendar.jsx`

This is a custom month grid, **not** react-big-calendar: it's easier to read on phones and uses correct venue-local days. It uses `date-fns` (already installed and pre-bundled).

```jsx
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
            {l.venue?.name} · {l.total_spots_left} spot{l.total_spots_left === 1 ? '' : 's'} open
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
          <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{it.venue?.name}</span>
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
```

---

## 12. Frontend — NEW FILE `frontend/src/components/ShiftDetailsModal.jsx`

```jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus, Lock,
  AlertTriangle, CheckCircle2, MessageSquare, ExternalLink, DollarSign, Briefcase,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, mapsUrl, downloadIcs, countdownText, calendarTone,
} from '../utils/listingFormat';

function NoteCard({ icon: Icon, label, text, tone = 'default', badge = null }) {
  if (!text || !String(text).trim()) return null;
  const toneCls =
    tone === 'staff'
      ? 'border-indigo-500/40 bg-indigo-500/5'
      : 'border-slate-800 bg-slate-950/60';
  return (
    <div className={`p-3 rounded-xl border ${toneCls}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-4 h-4 ${tone === 'staff' ? 'text-indigo-300' : 'text-emerald-400'}`} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{label}</span>
        {badge}
      </div>
      <p className="text-sm text-slate-100 whitespace-pre-line break-words leading-relaxed">{text}</p>
    </div>
  );
}

/**
 * Phase 26.2: Everything a worker needs for one of THEIR shifts, in one place.
 * Big date and time, countdown, where to go, pay, and every note (venue, event, position,
 * and staff-only notes once they're confirmed). Booked workers confirm "Got it" so
 * the manager knows they've read the latest info.
 *
 * Props:
 *   item               WorkerCalendarItem
 *   onClose()
 *   onAcknowledged(requestId, seenAtIso)   parent updates its copy / refetches
 *   onOpenBoard(shiftLike)                 optional: opens ShiftBoardModal
 */
export default function ShiftDetailsModal({ item, onClose, onAcknowledged, onOpenBoard }) {
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState('');
  const [ackedNow, setAckedNow] = useState(false);

  if (!item) return null;
  const tz = item.venue?.timezone;
  const tone = calendarTone(item);
  const off = tone.key === 'off';
  const mustRead = item.needs_ack && !ackedNow && !off;

  const acknowledge = async () => {
    setAcking(true);
    setAckError('');
    try {
      const res = await api.post(`/me/requests/${item.request_id}/ack`);
      setAckedNow(true);
      if (onAcknowledged) onAcknowledged(item.request_id, res.data?.info_seen_at);
    } catch (err) {
      setAckError(err.response?.data?.detail || 'Could not save. Try again.');
    } finally {
      setAcking(false);
    }
  };

  const addToCalendar = () =>
    downloadIcs({
      uid: `${item.request_id}@shiftboard`,
      title: `${item.role_type} — ${item.title} (${item.venue?.name || ''})`,
      start: item.start_time,
      end: item.end_time,
      location: item.venue?.address,
      description: [
        item.venue?.arrival_instructions && `When you arrive: ${item.venue.arrival_instructions}`,
        item.venue?.dress_code && `Dress code: ${item.venue.dress_code}`,
        item.event_notes,
        item.role_notes,
        item.event_staff_notes,
        item.position_staff_notes,
      ].filter(Boolean).join('\n\n'),
    });

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 mr-auto">
        Close
      </button>
      {item.booked && !off && (
        <button type="button" onClick={addToCalendar} className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
          <CalendarPlus className="w-4 h-4 text-emerald-400" /> Add to calendar
        </button>
      )}
      {item.booked && onOpenBoard && (
        <button
          type="button"
          onClick={() => onOpenBoard({ id: item.shift_id, title: item.title, venue: { name: item.venue?.name } })}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
        >
          <MessageSquare className="w-4 h-4 text-indigo-400" /> Board
        </button>
      )}
      {mustRead && (
        <button
          type="button"
          onClick={acknowledge}
          disabled={acking}
          className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-md shadow-amber-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-4 h-4" /> {acking ? 'Saving…' : "Got it — I've read this"}
        </button>
      )}
    </>
  );

  return (
    <ModalShell
      title={`${item.role_type} · ${item.title}`}
      subtitle={item.venue?.name}
      icon={<Briefcase className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      {/* Big date & time */}
      <div className={`rounded-2xl p-4 sm:p-5 border mb-4 ${off ? 'border-slate-700 bg-slate-950/60' : 'border-emerald-600/40 bg-gradient-to-br from-emerald-600/10 to-slate-950'}`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className={`text-2xl sm:text-3xl font-black ${off ? 'text-slate-500 line-through' : 'text-white'}`}>
              {fmtLongDate(item.start_time, tz)}
            </div>
            <div className={`text-xl sm:text-2xl font-bold mt-1 flex items-center gap-2 ${off ? 'text-slate-500' : 'text-emerald-300'}`}>
              <Clock className="w-6 h-6" /> {fmtTimeRange(item.start_time, item.end_time, tz)}
            </div>
            <div className="text-sm text-slate-400 mt-1">{hoursText(item.hours)}</div>
          </div>
          <div className="flex sm:flex-col items-start sm:items-end gap-2">
            <span className={`px-3 py-1 rounded-full border text-xs font-bold ${tone.chip.replace('line-through', '')}`}>{tone.label}</span>
            {!off && (
              <span className="px-3 py-1 rounded-full bg-slate-950/70 border border-slate-700 text-xs font-bold text-white">
                {countdownText(item.start_time, item.end_time)}
              </span>
            )}
          </div>
        </div>
      </div>

      {off && (
        <div className="mb-4 p-3 rounded-xl border border-rose-700/60 bg-rose-950/40 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            {tone.label}
            {item.cancel_reason || item.status_reason ? ` — ${item.cancel_reason || item.status_reason}` : ''}. You don't need to go to this shift.
          </span>
        </div>
      )}

      {mustRead && (
        <div className="mb-4 p-3 rounded-xl border-2 border-amber-500 bg-amber-500/10 text-amber-100 text-sm flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-400" />
          <div>
            <div className="font-black">{item.info_change ? 'This shift was updated' : 'Please read before your shift'}</div>
            {item.info_change && <div className="text-xs mt-0.5 text-amber-200">{item.info_change}</div>}
            <div className="text-xs mt-1 text-amber-200/80">Tap “Got it” at the bottom so your manager knows you've seen it.</div>
          </div>
        </div>
      )}
      {ackedNow && (
        <div className="mb-4 p-3 rounded-xl border border-emerald-700 bg-emerald-950/60 text-emerald-200 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Thanks — your manager can see you've read this.
        </div>
      )}
      {ackError && <div className="mb-4 p-3 rounded-xl border border-rose-700 bg-rose-950/60 text-rose-200 text-sm">{ackError}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* LEFT: where + pay */}
        <div className="md:col-span-2 space-y-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex gap-2.5">
              <MapPin className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Where</div>
                <div className="text-sm font-semibold text-white">{item.venue?.name}</div>
                {item.venue?.address && <div className="text-xs text-slate-300">{item.venue.address}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pl-6">
              <a href={mapsUrl(item.venue)} target="_blank" rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                <Navigation className="w-3 h-3 text-emerald-400" /> Directions
              </a>
              <Link to={`/venues/${item.venue?.id}`}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3 text-emerald-400" /> Venue profile
              </Link>
            </div>
            {item.venue?.phone && (
              <div className="flex gap-2.5">
                <Phone className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Venue phone</div>
                  <a href={`tel:${item.venue.phone}`} className="text-sm text-slate-100 underline decoration-slate-600">{item.venue.phone}</a>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Pay
            </div>
            {item.pay_rate !== null && item.pay_rate !== undefined ? (
              <div className="text-lg font-black text-emerald-400">${Number(item.pay_rate).toFixed(2)}/hr <span className="text-xs font-semibold text-slate-400">your rate</span></div>
            ) : (
              <PayLabel rate={item.hourly_rate} rateMax={item.hourly_rate_max} className="text-lg font-black text-emerald-400" hiddenText="Pay shared when you're confirmed" />
            )}
            <TipBadge shift={item} />
          </div>
        </div>

        {/* RIGHT: every note, nothing hidden behind a click */}
        <div className="md:col-span-3 space-y-3">
          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
            <StickyNote className="w-4 h-4 text-emerald-400" /> Shift notes
          </h4>
          <NoteCard icon={MapPin} label="When you arrive" text={item.venue?.arrival_instructions} />
          <NoteCard icon={Shirt} label="Dress code" text={item.venue?.dress_code} />
          <NoteCard icon={Calendar} label="About this event" text={item.event_notes} />
          <NoteCard icon={Briefcase} label={`${item.role_type} notes`} text={item.role_notes} />
          <NoteCard
            icon={Lock}
            label="For confirmed staff"
            text={item.event_staff_notes}
            tone="staff"
            badge={<span className="ml-auto text-[10px] text-indigo-300">Only booked staff see this</span>}
          />
          <NoteCard
            icon={Lock}
            label={`For confirmed ${item.role_type} staff`}
            text={item.position_staff_notes}
            tone="staff"
            badge={<span className="ml-auto text-[10px] text-indigo-300">Only booked staff see this</span>}
          />
          <NoteCard icon={Info} label="Venue notes" text={item.venue?.default_shift_notes} />

          {item.staff_notes_locked && (
            <div className="p-3 rounded-xl border border-dashed border-indigo-500/40 text-xs text-indigo-200 flex items-start gap-2">
              <Lock className="w-4 h-4 flex-shrink-0" />
              More details for this shift will show here once the manager confirms you.
            </div>
          )}

          {![
            item.venue?.arrival_instructions, item.venue?.dress_code, item.event_notes, item.role_notes,
            item.event_staff_notes, item.position_staff_notes, item.venue?.default_shift_notes,
          ].some((t) => t && String(t).trim()) && !item.staff_notes_locked && (
            <p className="text-xs text-slate-500 italic">No notes for this shift.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
```

---

## 13. Frontend — `frontend/src/pages/WorkerDashboard.jsx` (FULL FILE REPLACEMENT)

What changed vs. the 26.1 file:
* New state:
  * `calendar` (`{items, unread_count}`)
  * `detailRequestId`
* `fetchWorkerData` also loads `GET /me/calendar`.
* New **Calendar** tab, with an amber unread count, between Find Shifts and My Schedule.
* An amber **"N of your shifts have info you haven't read"** banner with a **Review now** button.
* My Schedule cards:
  * show a **PLEASE READ** or **UPDATED — READ** badge
  * **Details** now opens `ShiftDetailsModal`, falling back to the 26.1 event modal if the calendar item isn't loaded
* `ShiftDetailsModal` is rendered. Its **Board** button opens the existing `ShiftBoardModal`, which sits on top at z-[80].

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter,
  Timer, ArrowRightLeft, MessageSquare, X, Star, Zap, Info, CalendarPlus, Navigation,
  CalendarDays, AlertTriangle,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import TipBadge from '../components/TipBadge';
import PayLabel from '../components/PayLabel';
import EventListingCard from '../components/EventListingCard';
import EventListingModal from '../components/EventListingModal';
import WorkerCalendar from '../components/WorkerCalendar';
import ShiftDetailsModal from '../components/ShiftDetailsModal';
import { fmtDateTime } from '../utils/venueTime';
import {
  STATUS_LABELS, PENDING_STATUSES, dayGroupLabel, isOnDay, downloadIcs, mapsUrl,
} from '../utils/listingFormat';

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];

export default function WorkerDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('find'); // 'find' | 'calendar' | 'schedule' | 'transfers'
  const [listings, setListings] = useState([]);
  const [calendar, setCalendar] = useState({ items: [], unread_count: 0 }); // Phase 26.2
  const [detailRequestId, setDetailRequestId] = useState(null);           // Phase 26.2: ShiftDetailsModal
  const [myShifts, setMyShifts] = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);
  const [activeClockIns, setActiveClockIns] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [clockActionLoading, setClockActionLoading] = useState(null);
  const [transferActionLoading, setTransferActionLoading] = useState(null);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [notification, setNotification] = useState(null);

  // Phase 26.1: Find Shifts filters
  const [search, setSearch] = useState('');
  const [whenFilter, setWhenFilter] = useState('all'); // 'all' | 'today' | 'tomorrow' | 'week'
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);

  // Modals state
  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferShiftId, setTransferShiftId] = useState(null);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [dropping, setDropping] = useState(false);

  const fetchWorkerData = async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, activeClocksRes, calendarRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
        api.get('/transfers/my-incoming'),
        api.get('/shifts/time-entries/active').catch(() => ({ data: [] })),
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
      ]);
      setListings(listingsRes.data || []);
      setCalendar({
        items: calendarRes.data?.items || [],
        unread_count: calendarRes.data?.unread_count || 0,
      });
      setMyShifts(myRes.data || []);
      setIncomingTransfers(transfersRes.data || []);

      const clockedIds = new Set((activeClocksRes.data || []).map((te) => te.shift_id));
      setActiveClockIns(clockedIds);
    } catch (err) {
      console.error('Error loading worker dashboard data:', err);
      setNotification({
        type: 'error',
        message: 'Failed to load shifts from backend server.',
      });
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkerData();
  }, []);

  // Phase 26.1: withdraw a request that is still waiting for approval
  const handleWithdraw = async (req) => {
    try {
      setWithdrawingId(req.id);
      await api.post(`/listings/requests/${req.id}/withdraw`);
      setNotification({ type: 'info', message: 'Request withdrawn.' });
      fetchWorkerData(false);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to withdraw request.',
      });
    } finally {
      setWithdrawingId(null);
    }
  };

  // Hour tracking Clock In / Clock Out
  const handleClockIn = async (shiftId) => {
    try {
      setClockActionLoading(shiftId);
      await api.post(`/shifts/${shiftId}/clock-in`);
      setActiveClockIns((prev) => new Set([...prev, shiftId]));
      setNotification({
        type: 'success',
        message: '⏱️ Clocked in! Time tracking has commenced for this shift.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to clock in.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  const handleClockOut = async (shiftId) => {
    try {
      setClockActionLoading(shiftId);
      await api.post(`/shifts/${shiftId}/clock-out`);
      setActiveClockIns((prev) => {
        const updated = new Set(prev);
        updated.delete(shiftId);
        return updated;
      });
      setNotification({
        type: 'success',
        message: '🏁 Clocked out! Shift hours recorded successfully.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to clock out.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  // Shift Transfers (Accept / Reject)
  const handleAcceptTransfer = async (transferId) => {
    try {
      setTransferActionLoading(transferId);
      await api.post(`/transfers/${transferId}/accept`);
      setNotification({
        type: 'success',
        message: 'Shift transfer accepted! Awaiting Venue Manager approval.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to accept transfer.',
      });
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleRejectTransfer = async (transferId) => {
    try {
      setTransferActionLoading(transferId);
      await api.post(`/transfers/${transferId}/reject`);
      setNotification({
        type: 'info',
        message: 'Shift transfer proposal declined.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to decline transfer.',
      });
    } finally {
      setTransferActionLoading(null);
    }
  };

  // Phase 14: Shift Dropping
  const handleDropShift = async () => {
    if (!shiftToDrop) return;
    const targetShiftId = shiftToDrop.shift_id || shiftToDrop.shift?.id;
    try {
      setDropping(true);
      await api.post(`/shifts/${targetShiftId}/drop`);
      // Immediately remove the shift from the UI without requiring a page reload
      setMyShifts((prev) => prev.filter((s) => s.id !== shiftToDrop.id));
      setNotification({
        type: 'success',
        message: 'Shift dropped successfully. Capacity has been returned to the open marketplace.',
      });
      setShiftToDrop(null);
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to drop shift.',
      });
    } finally {
      setDropping(false);
    }
  };

  const confirmedShifts = myShifts.filter((s) =>
    ['approved', 'checked_in', 'confirmed'].includes(String(s.status || '').toLowerCase())
  );

  // ---- Phase 26.2: calendar items by request id + "please read" handling -------------------
  const calendarByRequest = useMemo(() => {
    const m = new Map();
    calendar.items.forEach((i) => m.set(i.request_id, i));
    return m;
  }, [calendar.items]);
  const detailItem = detailRequestId ? calendarByRequest.get(detailRequestId) || null : null;
  const firstUnread = calendar.items.find((i) => i.needs_ack && new Date(i.end_time).getTime() > Date.now()) || null;

  const handleAcknowledged = (requestId, seenAt) => {
    setCalendar((prev) => {
      const items = prev.items.map((i) =>
        i.request_id === requestId ? { ...i, needs_ack: false, info_change: null, info_seen_at: seenAt || new Date().toISOString() } : i
      );
      const unread = items.filter((i) => i.needs_ack && new Date(i.end_time).getTime() > Date.now()).length;
      return { items, unread_count: unread };
    });
  };

  const openDetailsForRequest = (req) => {
    if (calendarByRequest.has(req.id)) {
      setDetailRequestId(req.id);
    } else if (req.shift?.event_id) {
      setOpenListing({ eventId: req.shift.event_id, initial: null });
    }
  };

  // ---- Phase 26.1: Find Shifts (one card per event) ------------------------------------
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;

  const roleOptions = useMemo(
    () =>
      Array.from(
        new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN').map((p) => p.role_type)))
      ).sort(),
    [listings]
  );

  const venueOptions = useMemo(() => {
    const m = new Map();
    listings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [listings]);

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return listings.filter((l) => {
      const tz = l.venue?.timezone;
      if (q) {
        const hay = [l.title, l.venue?.name, l.venue?.address, ...l.positions.map((p) => p.role_type)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (whenFilter === 'today' && !isOnDay(l.start_time, tz, 0)) return false;
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested]);

  const listingGroups = useMemo(() => {
    const groups = [];
    filteredListings.forEach((l) => {
      const label = dayGroupLabel(l.start_time, l.venue?.timezone);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(l);
      else groups.push({ label, items: [l] });
    });
    return groups;
  }, [filteredListings]);

  const filtersActive =
    search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setHideRequested(false);
  };

  // ---- Phase 26.1: My Schedule split -------------------------------------------------------
  const nowMs = Date.now();
  const isUpcomingReq = (req) => {
    const st = String(req.status || '').toLowerCase();
    if (!UPCOMING_STATUSES.includes(st)) return false;
    if (st === 'checked_in') return true;
    const end = new Date(req.shift?.end_time).getTime();
    return Number.isNaN(end) ? true : end >= nowMs;
  };
  const upcomingRequests = myShifts
    .filter(isUpcomingReq)
    .sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const historyRequests = myShifts
    .filter((r) => !isUpcomingReq(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));

  const addShiftToCalendar = (req) => {
    const shift = req.shift;
    if (!shift) return;
    downloadIcs({
      uid: `${req.id}@shiftboard`,
      title: `${shift.title} — ${shift.role_type || 'Shift'} (${shift.venue?.name || ''})`,
      start: shift.start_time,
      end: shift.end_time,
      location: shift.venue?.address,
      description: [shift.event_notes, shift.description, shift.venue?.arrival_instructions].filter(Boolean).join('\n\n'),
    });
  };

  const renderRequestCard = (req) => {
    const shift = req.shift;
    const shiftId = req.shift_id || shift?.id;
    const statusLower = String(req.status || '').toLowerCase();
    const isApproved = ['approved', 'confirmed'].includes(statusLower);
    const isCheckedIn = statusLower === 'checked_in' || activeClockIns.has(shiftId);
    const isCompleted = statusLower === 'completed';
    const isPending = PENDING_STATUSES.includes(statusLower);
    const isClockLoading = clockActionLoading === shiftId;

    return (
      <div
        key={req.id}
        className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                isCheckedIn
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                  : isApproved
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : isCompleted
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : isPending
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isCheckedIn ? 'CLOCKED IN' : STATUS_LABELS[statusLower] || req.status}
            </span>

            {req.approval_source && (
              <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                Via: {req.approval_source.replace(/_/g, ' ')}
              </span>
            )}

            {calendarByRequest.get(req.id)?.needs_ack && (
              <button
                type="button"
                onClick={() => setDetailRequestId(req.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black"
              >
                <AlertTriangle className="w-3 h-3" />
                {calendarByRequest.get(req.id)?.info_change ? 'UPDATED — READ' : 'PLEASE READ'}
              </button>
            )}
          </div>

          <h3 className="text-base font-bold text-white mt-1">{shift?.title}</h3>
          {req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn'].includes(statusLower) && (
            <p className="text-xs text-rose-300">Reason: {req.status_reason}</p>
          )}
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
            <span>•</span>
            <span>{shift?.role_type || shift?.role_required}</span>
            <span>•</span>
            <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />
            <TipBadge shift={shift} />
          </p>
          <p className="text-xs text-slate-500">
            {fmtDateTime(shift?.start_time, shift?.venue?.timezone)}
          </p>
          {req.notes && isPending && (
            <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          {(calendarByRequest.has(req.id) || shift?.event_id) && (
            <button
              type="button"
              onClick={() => openDetailsForRequest(req)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              <span>Details</span>
            </button>
          )}

          {(isApproved || isCheckedIn) && shift?.venue && (
            <a
              href={mapsUrl(shift.venue)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              <span>Directions</span>
            </a>
          )}

          {isApproved && (
            <button
              type="button"
              onClick={() => addShiftToCalendar(req)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Calendar</span>
            </button>
          )}

          {/* Discussion Board button for confirmed shifts */}
          {(isApproved || isCheckedIn || isCompleted) && (
            <button
              type="button"
              onClick={() => setActiveDiscussionShift(shift)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Board</span>
            </button>
          )}

          {/* Transfer Shift button */}
          {isApproved && !isCheckedIn && (
            <button
              type="button"
              onClick={() => {
                setTransferShiftId(shiftId);
                setTransferModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center space-x-1"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer</span>
            </button>
          )}

          {/* Drop Shift button (Phase 14) */}
          {isApproved && !isCheckedIn && !isCompleted && (() => {
            const shiftStartTime = new Date(shift?.start_time).getTime();
            const hoursRemaining = (shiftStartTime - Date.now()) / (1000 * 60 * 60);
            const canDrop = hoursRemaining >= 24;

            return (
              <div className="flex flex-col items-end">
                <button
                  type="button"
                  onClick={() => setShiftToDrop(req)}
                  disabled={!canDrop}
                  title={
                    !canDrop
                      ? 'Shifts cannot be dropped within 24 hours of the start time. Please request a transfer or contact the manager.'
                      : 'Drop this shift and return it to the open marketplace.'
                  }
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition text-red-600 border border-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  Drop Shift
                </button>
                {!canDrop && (
                  <span className="text-[10px] text-slate-500 italic mt-0.5">
                    &lt;24h to start (locked)
                  </span>
                )}
              </div>
            );
          })()}

          {/* Time Tracking Clock In / Clock Out Button */}
          {(isApproved || isCheckedIn) && (
            isCheckedIn ? (
              <button
                type="button"
                onClick={() => handleClockOut(shiftId)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : 'Clock Out'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleClockIn(shiftId)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : 'Clock In'}</span>
              </button>
            )
          )}

          {isCompleted && (
            <span className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-emerald-400 border border-emerald-800/40 text-xs font-bold flex items-center space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Completed</span>
            </span>
          )}

          {isPending && (
            <>
              <span className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3.5 py-2 rounded-xl font-medium">
                Awaiting Venue Manager Review
              </span>
              <button
                type="button"
                onClick={() => handleWithdraw(req)}
                disabled={withdrawingId === req.id}
                className="px-3 py-1.5 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold transition disabled:opacity-50"
              >
                {withdrawingId === req.id ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header Profile Section */}
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/20">
              {user?.first_name?.[0] || 'W'}{user?.last_name?.[0] || 'K'}
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-2xl font-bold text-white">
                  {user?.first_name} {user?.last_name || 'Worker'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Worker
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {user?.bio || 'Ready for shifts across verified hospitality venues.'}
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center space-x-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-amber-400 text-sm font-bold">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              <span>{Number(user?.aggregate_rating || user?.rating_average || 5.0).toFixed(1)}</span>
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{confirmedShifts.length}</span> scheduled
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{incomingTransfers.length}</span> transfers
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{openListingCount}</span> open
            </div>
          </div>
        </div>
      </section>

      {/* Main Dashboard */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {notification && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center justify-between transition ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              {notification.type === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button onClick={() => setNotification(null)} className="text-xs underline hover:opacity-80">
              Dismiss
            </button>
          </div>
        )}

        {/* Phase 26.2: don't let anyone miss updated shift info */}
        {calendar.unread_count > 0 && firstUnread && (
          <div className="mb-6 p-4 rounded-xl border-2 border-amber-500 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-amber-100">
                  {calendar.unread_count === 1
                    ? '1 of your shifts has info you haven\'t read'
                    : `${calendar.unread_count} of your shifts have info you haven't read`}
                </div>
                <div className="text-xs text-amber-200/80">
                  Notes or times can change after you book. Open the shift and tap “Got it”.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDetailRequestId(firstUnread.request_id)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black whitespace-nowrap"
            >
              Review now
            </button>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div className="flex space-x-3 overflow-x-auto whitespace-nowrap -mx-1 px-1">
            <button
              onClick={() => setActiveTab('find')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'find'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Find Shifts ({openListingCount})
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
                activeTab === 'calendar'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Calendar</span>
              {calendar.unread_count > 0 && (
                <span className="ml-0.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black inline-flex items-center justify-center">
                  {calendar.unread_count}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'schedule'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              My Schedule ({upcomingRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('transfers')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'transfers'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Pending Transfers ({incomingTransfers.length})</span>
            </button>
          </div>
        </div>

        {/* TAB 1: Find Shifts (Phase 26.1: one card per event) */}
        {activeTab === 'find' && (
          <div className="mt-6">
            {/* Filters */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events, venues, positions"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 overflow-x-auto">
                  {[
                    { id: 'all', label: 'All dates' },
                    { id: 'today', label: 'Today' },
                    { id: 'tomorrow', label: 'Tomorrow' },
                    { id: 'week', label: 'Next 7 days' },
                  ].map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setWhenFilter(w.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                        whenFilter === w.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" />
                </span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All positions</option>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={venueFilter}
                  onChange={(e) => setVenueFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All venues</option>
                  {venueOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setInstantOnly((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    instantOnly
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button
                  type="button"
                  onClick={() => setHideRequested((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    hideRequested
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  Hide ones I've requested
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading open shifts...</div>
            ) : filteredListings.length === 0 ? (
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">
                  {listings.length === 0 ? 'No shifts open right now' : 'Nothing matches these filters'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {listings.length === 0 ? 'Check back soon as venue managers post new shifts.' : 'Try clearing a filter or two.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.map((g) => (
                  <section key={g.label}>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      {g.label}
                      <span className="text-slate-600 font-semibold normal-case tracking-normal">
                        · {g.items.length} event{g.items.length === 1 ? '' : 's'}
                      </span>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                      {g.items.map((l) => (
                        <EventListingCard
                          key={l.event_id}
                          listing={l}
                          onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: Calendar (Phase 26.2) */}
        {activeTab === 'calendar' && (
          <div className="mt-6">
            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading your calendar...</div>
            ) : (
              <WorkerCalendar
                items={calendar.items}
                openListings={listings}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
              />
            )}
          </div>
        )}

        {/* TAB 2: My Schedule (Phase 26.1: upcoming first, history folded away) */}
        {activeTab === 'schedule' && (
          <div className="mt-6 space-y-4">
            {upcomingRequests.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                <p className="text-xs text-slate-500 mt-1">Browse "Find Shifts" to pick up your next shift.</p>
              </div>
            ) : (
              upcomingRequests.map(renderRequestCard)
            )}

            {historyRequests.length > 0 && (
              <details className="group pt-2">
                <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white">
                  Past & closed ({historyRequests.length})
                </summary>
                <div className="mt-4 space-y-4 opacity-80">
                  {historyRequests.map(renderRequestCard)}
                </div>
              </details>
            )}
          </div>
        )}

        {/* TAB 3: Pending Shift Transfers */}
        {activeTab === 'transfers' && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">
                  Incoming Shift Transfer Offers ({incomingTransfers.length})
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                Peers proposing to transfer confirmed shifts to you
              </span>
            </div>

            {incomingTransfers.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <ArrowRightLeft className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No incoming transfer offers</h3>
                <p className="text-xs text-slate-500 mt-1">
                  When other workers propose shift transfers to you, they will appear here.
                </p>
              </div>
            ) : (
              incomingTransfers.map((transfer) => {
                const shift = transfer.shift;
                const fromWorker = transfer.from_worker;
                const isActionLoading = transferActionLoading === transfer.id;

                return (
                  <div
                    key={transfer.id}
                    className="p-5 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold uppercase px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          Transfer Offer
                        </span>
                        <span className="text-xs text-slate-400">
                          From: <strong className="text-white">{fromWorker?.first_name} {fromWorker?.last_name}</strong> ({fromWorker?.email})
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white mt-1.5">{shift?.title}</h3>
                      <p className="text-xs text-slate-400 flex items-center space-x-2 mt-1">
                        <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
                        <span>•</span>
                        <span>{shift?.role_type}</span>
                        <span>•</span>
                        <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} className="text-emerald-400 font-semibold" />
                        <TipBadge shift={shift} />
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {fmtDateTime(shift?.start_time, shift?.venue?.timezone)}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2.5 w-full md:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => handleAcceptTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isActionLoading ? 'Processing...' : 'Accept Transfer'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Phase 26.2: My shift details (big date/time, all notes, "Got it") */}
      {detailItem && (
        <ShiftDetailsModal
          key={detailItem.request_id}
          item={detailItem}
          onClose={() => setDetailRequestId(null)}
          onAcknowledged={handleAcknowledged}
          onOpenBoard={(shiftLike) => setActiveDiscussionShift(shiftLike)}
        />
      )}

      {/* Phase 26.1: Event details + request modal */}
      {openListing && (
        <EventListingModal
          eventId={openListing.eventId}
          initial={openListing.initial}
          onClose={() => setOpenListing(null)}
          onChanged={() => fetchWorkerData(false)}
          onGoToSchedule={() => {
            setOpenListing(null);
            setActiveTab('schedule');
          }}
        />
      )}

      {/* Transfer Proposal Modal */}
      {transferModalOpen && (
        <TransferModal
          isOpen={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          myConfirmedShifts={confirmedShifts}
          preselectedShiftId={transferShiftId}
          onTransferSuccess={() => {
            setNotification({
              type: 'success',
              message: 'Transfer proposal sent to peer worker! Awaiting their acceptance.',
            });
            fetchWorkerData();
          }}
        />
      )}

      {/* Shift Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.venue?.name || ''})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {/* Confirm Drop Modal (Phase 14) */}
      {shiftToDrop && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2 text-rose-500">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Confirm Drop Shift</h3>
              </div>
              <button
                type="button"
                onClick={() => setShiftToDrop(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to drop this shift? This action cannot be undone, and the shift will be offered to other workers.
              </p>

              {shiftToDrop.shift && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
                  <p className="font-bold text-white">{shiftToDrop.shift.title}</p>
                  <p className="text-slate-400">
                    {shiftToDrop.shift.venue?.name} • {shiftToDrop.shift.role_type} • <PayLabel rate={shiftToDrop.shift.hourly_rate} rateMax={shiftToDrop.shift.hourly_rate_max} />
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    {fmtDateTime(shiftToDrop.shift.start_time, shiftToDrop.shift.venue?.timezone)}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShiftToDrop(null)}
                disabled={dropping}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDropShift}
                disabled={dropping}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                {dropping ? 'Dropping...' : 'Confirm Drop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 14. Frontend — `frontend/src/components/ShiftEventFormModal.jsx` (EDITS)

### 14a. Import — add `Lock`
```jsx
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users, RotateCcw, Lock } from 'lucide-react';
```
### 14b. `blankRow()` — add `staff_notes: ''` directly after `role_notes: '',`

### 14c. State — directly under `const [notes, setNotes] = useState('');`
```jsx
  const [staffNotes, setStaffNotes] = useState(''); // Phase 26.2: confirmed staff only
```
### 14d. Edit-mode load
Directly under `setNotes(ev.notes || '');` add:
```jsx
        setStaffNotes(ev.staff_notes || '');
```
In the `(ev.positions || []).map((p) => ({ … }))` row object:
* add `staff_notes: p.staff_notes || '',` directly after `role_notes: p.role_notes || '',`
* change `showNotes: !!p.role_notes,` to `showNotes: !!(p.role_notes || p.staff_notes),`

### 14e. Payload
In `payloadPositions.push({ … })` add, directly after `role_notes: (r.role_notes || '').trim() || null,`:
```jsx
        staff_notes: (r.staff_notes || '').trim() || null,
```
In `const body = { … }` add, directly after `notes: notes.trim() || null,`:
```jsx
      staff_notes: staffNotes.trim() || null,
```

### 14f. Event-level field
Find the Event notes textarea's placeholder and closing:
```jsx
                placeholder="Shown to everyone working this event. e.g. Load-in through the loading dock at 4pm."
              />
            </div>
```
Replace with:
```jsx
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
              {isEdit && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Changing the time or any notes flags the shift as “Updated” for everyone booked until they read it.
                </p>
              )}
            </div>
```

### 14g. Per-position notes → two boxes (public + staff-only)
Find:
```jsx
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
```
Replace with:
```jsx
                  {r.showNotes ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Notes for {r.role_type || 'this position'}</label>
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
```
Also change the button text `+ Add notes for this position` to `+ Add notes for this position (public or staff-only)`.

---

## 15. Frontend — `frontend/src/components/EventRosterModal.jsx` (EDITS)

### 15a. Import line → replace with
```jsx
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle } from 'lucide-react';
```

### 15b. Header notes — find:
```jsx
  const headerExtra = (event.description || (onEdit && event.event_id)) ? (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
      {event.description && (
        <div className="flex-1 text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-2.5 whitespace-pre-line">
          <span className="text-slate-500 font-semibold inline-flex items-center gap-1 mr-1"><FileText className="w-3 h-3" /> Event notes:</span>
          {event.description}
        </div>
      )}
```
Replace with:
```jsx
  const headerExtra = (event.description || event.staff_notes || (onEdit && event.event_id)) ? (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
      {(event.description || event.staff_notes) && (
        <div className="flex-1 space-y-2">
          {event.description && (
            <div className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-2.5 whitespace-pre-line">
              <span className="text-slate-500 font-semibold inline-flex items-center gap-1 mr-1"><FileText className="w-3 h-3" /> Event notes:</span>
              {event.description}
            </div>
          )}
          {event.staff_notes && (
            <div className="text-xs text-indigo-100 bg-indigo-500/5 border border-indigo-500/40 rounded-xl p-2.5 whitespace-pre-line">
              <span className="text-indigo-300 font-semibold inline-flex items-center gap-1 mr-1"><Lock className="w-3 h-3" /> Confirmed staff only:</span>
              {event.staff_notes}
            </div>
          )}
        </div>
      )}
```

### 15c. Position staff notes — find the end of the role-notes paragraph:
```jsx
                    <span className="text-slate-500 font-semibold">{pos.role_type} notes: </span>{pos.role_notes}
                  </p>
                )}
```
Add directly after it:
```jsx
                {pos.staff_notes && (
                  <p className="text-xs text-indigo-100 bg-indigo-500/5 border border-indigo-500/40 rounded-lg p-2 whitespace-pre-line">
                    <span className="text-indigo-300 font-semibold inline-flex items-center gap-1"><Lock className="w-3 h-3" /> {pos.role_type} — confirmed staff only: </span>{pos.staff_notes}
                  </p>
                )}
```

### 15d. "Read" chip on assigned people — find (in the Assigned list):
```jsx
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
                              {onRemovePerson
```
Replace with:
```jsx
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
                              {p.info_seen === true && (
                                <span title="Has read the latest notes and changes" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                                  <BookOpenCheck className="w-3 h-3" /> Read
                                </span>
                              )}
                              {p.info_seen === false && (
                                <span title="Hasn't opened the latest notes or changes yet" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/40">
                                  <AlertTriangle className="w-3 h-3" /> Not read yet
                                </span>
                              )}
                              {onRemovePerson
```

---

## 16. Frontend — `frontend/src/components/EventListingModal.jsx` (EDITS)

### 16a. Add `Lock` to the lucide import list (after `Briefcase,`).

### 16b. Booked banner — find:
```jsx
            {bookedPosition && bookedPosition.hourly_rate !== null && (
              <> Pay: <PayLabel rate={bookedPosition.hourly_rate} rateMax={bookedPosition.hourly_rate_max} className="font-semibold" /></>
            )}
          </p>
        </div>
      )}
```
Replace with:
```jsx
            {bookedPosition && bookedPosition.hourly_rate !== null && (
              <> Pay: <PayLabel rate={bookedPosition.hourly_rate} rateMax={bookedPosition.hourly_rate_max} className="font-semibold" /></>
            )}
          </p>
          {/* Phase 26.2: staff-only notes, shown once confirmed */}
          {(listing.staff_notes || bookedPosition?.staff_notes) && (
            <div className="mt-3 space-y-2">
              {listing.staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
                  <div className="font-bold text-indigo-300 flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> For confirmed staff</div>
                  {listing.staff_notes}
                </div>
              )}
              {bookedPosition?.staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
                  <div className="font-bold text-indigo-300 flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> For confirmed {bookedPosition.role_type} staff</div>
                  {bookedPosition.staff_notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}
```

---

## 17. Rebuild & Verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS staff_notes TEXT;
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS info_updated_at TIMESTAMPTZ;
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS info_change TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS staff_notes TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS info_updated_at TIMESTAMPTZ;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS info_change TEXT;
ALTER TABLE shift_requests ADD COLUMN IF NOT EXISTS info_seen_at TIMESTAMPTZ;
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ from `database` / `shiftboard_user` / `shiftboard`.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Checklist**
1. **Manager, adding staff notes:**
   * Edit a posted event. Add **Notes for confirmed staff only**, e.g. "Door code 4471".
   * Open a position's notes and fill **Confirmed Bartender only**. Save.
   * **Details** shows both in indigo "confirmed staff only" boxes.
2. **Worker who is waiting:**
   * In Find Shifts, the event modal does **not** show staff notes.
   * In Calendar, the day shows an amber dashed "Waiting" chip. Its details say "More details will show here once the manager confirms you."
3. **Manager approves the worker:**
   * The worker reloads and sees an amber banner: "1 of your shifts has info you haven't read".
   * The Calendar tab has a badge, the day cell shows ⚠, and the My Schedule card shows **PLEASE READ**.
4. **Worker reads the details:** Review now opens the shift with:
   * the big date, big time and countdown
   * all notes, including the indigo staff-only notes
   * **Got it** clears the flags
   * The manager's roster now shows **Read ✓** next to the worker.
5. **Manager changes the time:**
   * Change the start time by one hour and save.
   * The worker sees **UPDATED — READ** with "Time changed: Fri Oct 3, 6:00 PM – 11:00 PM → Fri Oct 3, 7:00 PM – 11:00 PM", and the roster shows **Not read yet** until they tap Got it.
6. **Calendar views:**
   * Month view: phone width shows dots; desktop shows "6:00 PM Bartender" chips. Today is highlighted, and tapping a day lists its shifts below with big times.
   * **List** view shows upcoming days, and "Show past shifts" reveals history.
   * **Open shifts** toggle: dashed "Open" entries appear, and clicking one opens the 26.1 request modal.
7. **Add to calendar** in the shift details downloads an `.ics` whose description includes arrival, dress code and all notes.
8. **Security check:** `GET /api/listings/<event_id>` as a worker who isn't booked has `staff_notes: null` on the event and every position, and `GET /api/venues/<id>/public-events` never contains `staff_notes`.

**Note:** existing booked shifts with venue notes, dress code or arrival instructions will show **PLEASE READ** once after this deploy. That's intended: each worker confirms once.