# Phase 29.3: Draft & Publish, and Event Templates

**Why:** Until now, pressing Post a Shift made the event public at once and messaged the whole team. A manager couldn't:
- set up next week's events and check them first
- keep a half-finished event
- reuse the setup of an event they run every week, other than copying one that was already posted

This phase adds a **draft** state for events and **event templates**, which are managed from a new tab in Venue Settings.

## What this phase adds

1. **Draft & publish:**
   * Post a Shift now has **Save as draft** and **Publish** buttons.
   * A draft is visible only to managers and admins. Workers never see it anywhere:
     - listings and event pages
     - the venue directory and public venue page
     - new-shift alerts
     - offers
   * Nobody can request a draft, and a manager can't assign or offer it.
   * Editing a draft never flags "Updated" for anyone. The form shows **Save draft** and **Save & publish**.
   * **Publish** (a button on the draft's card) makes it live and sends the usual "New shift at …" alert to the team at that moment.
     - A draft whose start time has passed can't be published until its date is changed.
   * **Move back to drafts** (⋯ menu) hides a published event again, but only while nobody has requested it, been booked on it, or has an open offer.
   * **Delete draft** (⋯ menu) removes a draft completely. Published events still use Cancel.
   * **How it works underneath:**
     - `shift_events.status` is `draft` | `published`, and a draft's positions carry shift status `DRAFT`.
     - Every existing worker-facing query that only looks at `OPEN` positions skips drafts automatically.
     - The few queries that look at "anything not cancelled" were updated.
   * **Posted Shifts:**
     - drafts have a dashed border and a **Draft · not visible to workers** badge
     - a new **Drafts** filter
     - drafts show grey in the calendar
     - the event's roster says it's a draft and hides Assign/Offer and Cancel position
   * **Duplicate / repeat** has a **Create the copies as drafts** checkbox. Copies of a draft are always drafts.
   * Activity log lines: "Saved a draft", "Published", "Moved … back to drafts", "Deleted the draft".
   * Admin console numbers (staffed %, open spots, events) ignore drafts.
2. **Event templates:**
   * A template is a named setup of:
     - an event name
     - start and end clock times (an end earlier than the start means it finishes the next day)
     - a saved location, the clock-in check setting and notes
     - positions with spots, pay range, tips, approval and position notes
   * Templates belong to one venue. There's a limit of 50 per venue, and names must be unique within the venue.
   * **Venue Settings → Event templates** (new tab): cards showing times, location and positions, with **Use**, **Edit** and **Delete**, plus a **New template** button.
     - Templates are created and edited in the same form as posting a shift, so every option is there.
     - A typed-in new location is saved to the venue's list.
   * **Post a Shift → Start from a template:** fills in everything. It keeps the date you already picked, or uses tomorrow; you then change the date and publish or save a draft.
   * **Use** on a template opens Post a Shift already filled in.
   * **⋯ → Save as template** on any posted event or draft saves its times (in venue time), where, notes and positions.
   * A **Templates** button in the dashboard header opens the tab directly.
   * If a template's saved location was archived since, the template falls back to the venue address and says so.
3. **Small form improvement:** moving the start time now moves the end time too (same length), so changing the date no longer leaves the end on the old day.
4. **Layout fixes on Posted Shifts:**
   * The pay / "Needs OK" / "Tips" line no longer runs into the "0/2 filled" column.
   * The action buttons wrap on phones instead of spilling out of the card.

⚠️ **Schema change:** two new columns on `shift_events` and one new table (`event_templates`). See §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` CORS logic (only add the one import and `include_router` line shown)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages. (`JSONB` comes from SQLAlchemy's PostgreSQL dialect, already installed.)
* No native PostgreSQL ENUMs:
  - `shift_events.status`: `draft` | `published`
  - `shifts.status` gains the value `DRAFT` (still VARCHAR)
* Aware UTC datetimes only.
* Activity and notification hooks always run **after** the endpoint's commit. `notify_events.new_event_posted` is called on publish, never for drafts.
* Delete drafts with a `delete(ShiftEvent).where(...)` statement (the database cascades to positions). Never use `db.delete(event)`.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current (Phase 29.2) files and checked:
  - after applying them, the backend imports cleanly and all 155 API operations build (8 new)
  - the frontend bundles with no missing imports
  - 67 new integration checks pass against PostgreSQL 16, and the Phase 29, 29.1 and 29.2 suites still pass
  - the board, Drafts filter, ⋯ menu, Save-as-template dialog, Post a Shift with a template, the Templates tab and the template editor were rendered with the real Tailwind build at desktop and phone widths

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDITS)
Two columns on `shift_events`; the `event_templates` table appended at the end.

**Edit 1.** Find:
```sql
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'published',          -- Phase 29.3: draft | published
    published_at TIMESTAMPTZ,                                 -- Phase 29.3: first time it went live
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 2.** Find:
```sql
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit(target_type, target_id);
```
Replace with:
```sql
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit(target_type, target_id);

-- ------------------------------------------------------------------------------
-- Phase 29.3: Event templates (a venue's reusable event setups)
-- ------------------------------------------------------------------------------
CREATE TABLE event_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,                               -- what managers pick from ("Friday Jazz")
    title VARCHAR(255) NOT NULL,                              -- the event name it fills in
    start_local VARCHAR(5) NOT NULL,                          -- 'HH:MM' venue time
    end_local VARCHAR(5) NOT NULL,                            -- 'HH:MM'; earlier than start = next day
    notes TEXT,
    staff_notes TEXT,
    location_id UUID REFERENCES venue_locations(id) ON DELETE SET NULL,
    geofence_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default',
    location_staff_notes TEXT,
    positions JSONB NOT NULL DEFAULT '[]'::jsonb,             -- [{role_type, capacity, hourly_rate, ...}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_event_templates_venue ON event_templates(venue_id);
```

---

## A2. `backend/src/models.py` (EDITS)
`ShiftEvent.status` / `published_at` and the new `EventTemplate` model (positions stored as JSONB).

**Edit 1.** Find:
```python
    DateTime, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION
from sqlalchemy.orm import relationship
from src.database import Base
```
Replace with:
```python
    DateTime, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, JSONB
from sqlalchemy.orm import relationship
from src.database import Base
```

**Edit 2.** Find:
```python
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shifts = relationship("Shift", back_populates="event", cascade="all, delete-orphan")

class Shift(Base):
```
Replace with:
```python
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="published")      # Phase 29.3: draft | published
    published_at = Column(DateTime(timezone=True), nullable=True)          # Phase 29.3
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shifts = relationship("Shift", back_populates="event", cascade="all, delete-orphan")


class EventTemplate(Base):
    """Phase 29.3: A venue's reusable event setup. Times are venue-local 'HH:MM' (end earlier = next day)."""
    __tablename__ = "event_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(120), nullable=False)
    title = Column(String(255), nullable=False)
    start_local = Column(String(5), nullable=False)
    end_local = Column(String(5), nullable=False)
    notes = Column(Text, nullable=True)
    staff_notes = Column(Text, nullable=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("venue_locations.id", ondelete="SET NULL"), nullable=True)
    geofence_mode = Column(String(20), nullable=False, default="venue_default")
    location_staff_notes = Column(Text, nullable=True)
    positions = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class Shift(Base):
```

---

## A3. `backend/src/schemas.py` (EDITS)
`EventCreate.publish` (default true, so older callers keep publishing), `status` on `EventDetail` and `VenueEventResponse`, `DuplicateEventRequest.as_draft`, and the template schemas at the end.

**Edit 1.** Find:
```python
    event_key: str
    event_id: Optional[UUID] = None
    location_name: Optional[str] = None      # Phase 27: None = venue address
    cancelled: bool = False
```
Replace with:
```python
    event_key: str
    event_id: Optional[UUID] = None
    status: str = "published"                # Phase 29.3: draft | published
    location_name: Optional[str] = None      # Phase 27: None = venue address
    cancelled: bool = False
```

**Edit 2.** Find:
```python
    location_staff_notes: Optional[str] = None          # Phase 27: event-specific, confirmed staff only
    positions: List[EventPositionInput]


```
Replace with:
```python
    location_staff_notes: Optional[str] = None          # Phase 27: event-specific, confirmed staff only
    positions: List[EventPositionInput]
    publish: bool = True                     # Phase 29.3: False = save as a draft (workers can't see it)


```

**Edit 3.** Find:
```python
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    positions: List[EventDetailPosition]

```
Replace with:
```python
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    status: str = "published"                           # Phase 29.3: draft | published
    published_at: Optional[datetime] = None             # Phase 29.3
    positions: List[EventDetailPosition]

```

**Edit 4.** Find:
```python
class DuplicateEventRequest(BaseModel):
    dates: List[date]


```
Replace with:
```python
class DuplicateEventRequest(BaseModel):
    dates: List[date]
    as_draft: bool = False                   # Phase 29.3: copies of a draft are always drafts


```

**Edit 5.** Find:
```python
class AdminTestEmail(BaseModel):
    to: EmailStr
```
Replace with:
```python
class AdminTestEmail(BaseModel):
    to: EmailStr


# ------------------------------------------------------------------------------
# Phase 29.3: Event templates
# ------------------------------------------------------------------------------
class EventTemplatePosition(BaseModel):
    role_type: str
    capacity: int = 1
    hourly_rate: float
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    role_notes: Optional[str] = None
    staff_notes: Optional[str] = None
    approval_mode: str = "venue_default"


class EventTemplateInput(BaseModel):
    name: str                                # what managers pick from ("Friday Jazz")
    title: str                               # the event name it fills in
    start_local: str                         # 'HH:MM' venue time
    end_local: str                           # 'HH:MM'; earlier than start = ends the next day
    notes: Optional[str] = None
    staff_notes: Optional[str] = None
    location_id: Optional[UUID] = None       # a saved venue location (None = venue address)
    geofence_mode: str = "venue_default"
    location_staff_notes: Optional[str] = None
    positions: List[EventTemplatePosition]


class EventTemplateResponse(BaseModel):
    id: UUID
    venue_id: UUID
    name: str
    title: str
    start_local: str
    end_local: str
    overnight: bool = False                  # end_local is on the next day
    notes: Optional[str] = None
    staff_notes: Optional[str] = None
    location: Optional[VenueLocationResponse] = None
    geofence_mode: str = "venue_default"
    location_staff_notes: Optional[str] = None
    positions: List[EventTemplatePosition]
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class SaveAsTemplateRequest(BaseModel):
    name: str
```

---

# PART B: Backend

## B1. `backend/src/services/shift_events.py` (EDITS)
Drafts on create/edit/duplicate, plus `publish_event`, `unpublish_event` and `discard_draft` at the end.

**Edit 1.** Find:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, User, VenueLocation
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
```
Replace with:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, ShiftOffer, Venue, User, VenueLocation
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
```

**Edit 2.** Find:
```python
PENDING_STATUSES = ("pending", "pending_manager_approval")
ACTIVE_REQUEST_STATUSES = PENDING_STATUSES + ("approved", "confirmed")


```
Replace with:
```python
PENDING_STATUSES = ("pending", "pending_manager_approval")
ACTIVE_REQUEST_STATUSES = PENDING_STATUSES + ("approved", "confirmed")
# Phase 29.3: a draft event's positions carry shift status DRAFT, so every worker-facing query that
# only looks at OPEN positions (listings, directory, offers, new-shift alerts) skips them.
DRAFT = "draft"
PUBLISHED = "published"


```

**Edit 3.** Find:
```python
        _validate_position(p)
    mode = validate_geofence_mode(data.geofence_mode)
    try:
        # Phase 27: where is it? (a typed-in new location is saved to the venue's list here)
```
Replace with:
```python
        _validate_position(p)
    mode = validate_geofence_mode(data.geofence_mode)
    is_draft = not getattr(data, "publish", True)          # Phase 29.3
    try:
        # Phase 27: where is it? (a typed-in new location is saved to the venue's list here)
```

**Edit 4.** Find:
```python
            geofence_mode=mode,
            location_staff_notes=_clean(data.location_staff_notes),
        )
        db.add(event)
        await db.flush()
        for p in data.positions:
            s = Shift(venue_id=venue.id, event_id=event.id, created_by_user_id=user.id, spots_filled=0, status="OPEN")
            _apply_position(s, p, event)
            db.add(s)
```
Replace with:
```python
            geofence_mode=mode,
            location_staff_notes=_clean(data.location_staff_notes),
            status=DRAFT if is_draft else PUBLISHED,                                   # Phase 29.3
            published_at=None if is_draft else datetime.now(timezone.utc),
        )
        db.add(event)
        await db.flush()
        for p in data.positions:
            s = Shift(venue_id=venue.id, event_id=event.id, created_by_user_id=user.id, spots_filled=0,
                      status="DRAFT" if is_draft else "OPEN")
            _apply_position(s, p, event)
            db.add(s)
```

**Edit 5.** Find:
```python
                )

    try:
        # Phase 26.2: work out what changed so booked workers are told
```
Replace with:
```python
                )

    is_draft = (event.status or PUBLISHED) == DRAFT      # Phase 29.3: nobody to tell about draft edits
    try:
        # Phase 26.2: work out what changed so booked workers are told
```

**Edit 6.** Find:
```python
        event.notes = _clean(data.notes)
        event.staff_notes = _clean(data.staff_notes)
        if changes:
            event.info_updated_at = datetime.now(timezone.utc)
            event.info_change = "; ".join(changes)
```
Replace with:
```python
        event.notes = _clean(data.notes)
        event.staff_notes = _clean(data.staff_notes)
        if changes and not is_draft:
            event.info_updated_at = datetime.now(timezone.utc)
            event.info_change = "; ".join(changes)
```

**Edit 7.** Find:
```python
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
```
Replace with:
```python
            if p.shift_id:
                s = by_id[p.shift_id]
                _apply_position(s, p, event, track_changes=not is_draft)
                if (s.status or "OPEN").upper() in ("OPEN", "FILLED"):
                    s.status = "FILLED" if (s.spots_filled or 0) >= s.capacity else "OPEN"
            else:
                s = Shift(
                    venue_id=event.venue_id, event_id=event.id,
                    created_by_user_id=event.created_by_user_id, spots_filled=0,
                    status="DRAFT" if is_draft else "OPEN",
                )
                _apply_position(s, p, event)
```

**Edit 8.** Find:
```python
        cancelled=event.cancelled_at is not None,
        cancel_reason=event.cancel_reason,
        positions=[
            EventDetailPosition(
```
Replace with:
```python
        cancelled=event.cancelled_at is not None,
        cancel_reason=event.cancel_reason,
        status=event.status or PUBLISHED,
        published_at=event.published_at,
        positions=[
            EventDetailPosition(
```

**Edit 9.** Find:
```python


async def duplicate_event(db: AsyncSession, event: ShiftEvent, venue: Venue, user: User, dates: List[date]) -> List[ShiftEvent]:
    """Copy an event to each date, keeping the same local start time in the venue's timezone."""
    unique_dates = sorted(set(dates or []))
    if not unique_dates:
```
Replace with:
```python


async def duplicate_event(
    db: AsyncSession, event: ShiftEvent, venue: Venue, user: User, dates: List[date], as_draft: bool = False,
) -> List[ShiftEvent]:
    """Copy an event to each date, keeping the same local start time in the venue's timezone.
    Phase 29.3: copies are drafts when as_draft is set or the source is a draft."""
    as_draft = as_draft or (event.status or PUBLISHED) == DRAFT
    unique_dates = sorted(set(dates or []))
    if not unique_dates:
```

**Edit 10.** Find:
```python
            location_staff_notes=event.location_staff_notes,
            positions=positions,
        ), allow_archived_location=True)
        created.append(ev)
    return created
```
Replace with:
```python
            location_staff_notes=event.location_staff_notes,
            positions=positions,
            publish=not as_draft,
        ), allow_archived_location=True)
        created.append(ev)
    return created


# ------------------------------------------------------------------------------
# Phase 29.3: Draft / publish
# ------------------------------------------------------------------------------
BLOCKING_REQUEST_STATUSES = ACTIVE_REQUEST_STATUSES + ("checked_in", "completed")


async def publish_event(db: AsyncSession, event: ShiftEvent) -> None:
    """Draft -> live. Positions become OPEN; the caller tells the team (new_event_posted)."""
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event was cancelled.")
    if (event.status or PUBLISHED) != DRAFT:
        raise HTTPException(status_code=400, detail="This event is already published.")
    now = datetime.now(timezone.utc)
    if _as_utc(event.start_time) <= now:
        raise HTTPException(status_code=400, detail="This draft's start time has passed. Change the date, then publish.")
    shifts = (await db.execute(
        select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
    )).scalars().all()
    if not shifts:
        raise HTTPException(status_code=400, detail="Add at least one position before publishing.")
    try:
        for s in shifts:
            s.status = "FILLED" if (s.spots_filled or 0) >= (s.capacity or 1) else "OPEN"
        event.status = PUBLISHED
        event.published_at = now
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to publish: {str(e)}")


async def unpublish_event(db: AsyncSession, event: ShiftEvent) -> None:
    """Live -> draft. Only while nobody has requested, been booked or been offered a spot."""
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event was cancelled.")
    if (event.status or PUBLISHED) == DRAFT:
        raise HTTPException(status_code=400, detail="This event is already a draft.")
    shift_ids = (await db.execute(select(Shift.id).where(Shift.event_id == event.id))).scalars().all()
    if shift_ids:
        people = await db.scalar(
            select(func.count(ShiftRequest.id)).where(
                ShiftRequest.shift_id.in_(shift_ids),
                func.lower(ShiftRequest.status).in_(BLOCKING_REQUEST_STATUSES),
            )
        )
        if people:
            raise HTTPException(
                status_code=400,
                detail="People have already requested or been booked on this event, so it can't go back to a draft. Edit it, or cancel it instead.",
            )
        offers = await db.scalar(
            select(func.count(ShiftOffer.id)).where(ShiftOffer.shift_id.in_(shift_ids), ShiftOffer.status == "pending")
        )
        if offers:
            raise HTTPException(status_code=400, detail="Withdraw the open offers on this event first.")
    try:
        await db.execute(
            update(Shift)
            .where(Shift.event_id == event.id, func.upper(Shift.status).in_(("OPEN", "FILLED")))
            .values(status="DRAFT")
            .execution_options(synchronize_session=False)
        )
        event.status = DRAFT
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to move it back to drafts: {str(e)}")


async def discard_draft(db: AsyncSession, event: ShiftEvent) -> None:
    """Delete a draft outright (its positions cascade). Published events are cancelled, never deleted."""
    if (event.status or PUBLISHED) != DRAFT:
        raise HTTPException(status_code=400, detail="Only drafts can be deleted. Cancel a published event instead.")
    try:
        await db.execute(delete(ShiftEvent).where(ShiftEvent.id == event.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete the draft: {str(e)}")
```

---

## B2. NEW FILE `backend/src/services/event_templates.py`

```python
"""
Phase 29.3: Event templates - a venue's reusable event setups (name, times, where, notes, positions).

Times are venue-local 'HH:MM' strings. An end earlier than (or equal to) the start means the event ends
the next day. Templates never create anything by themselves: the "Post a shift" form fills itself in
from one, and the manager picks the date.
"""
import re
from datetime import timezone
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import EventTemplate, ShiftEvent, Shift, Venue, User, VenueLocation
from src.schemas import EventTemplateInput, EventTemplatePosition, EventTemplateResponse, EventPositionInput
from src.services.shift_events import _validate_position, _clean
from src.services.locations import (
    validate_geofence_mode, check_geofence_possible, usage_counts, to_response as location_response,
)

MAX_TEMPLATES_PER_VENUE = 50
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _name(u: Optional[User]) -> Optional[str]:
    if u is None:
        return None
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def _norm_time(value: str, label: str) -> str:
    v = (value or "").strip()
    if len(v) == 4 and v[1] == ":":
        v = "0" + v                                   # '9:30' -> '09:30'
    if not TIME_RE.match(v):
        raise HTTPException(status_code=400, detail=f"{label} must be a time like 18:00.")
    return v


def _position_dicts(positions: List[EventTemplatePosition]) -> List[dict]:
    if not positions:
        raise HTTPException(status_code=400, detail="Add at least one position.")
    out = []
    for p in positions:
        _validate_position(EventPositionInput(**p.model_dump()))
        rate = round(float(p.hourly_rate), 2)
        rate_max = round(float(p.hourly_rate_max), 2) if p.hourly_rate_max is not None and p.hourly_rate_max > p.hourly_rate else None
        out.append({
            "role_type": p.role_type.strip()[:100],
            "capacity": int(p.capacity),
            "hourly_rate": rate,
            "hourly_rate_max": rate_max,
            "hide_rate": bool(p.hide_rate),
            "tips_eligible": bool(p.tips_eligible),
            "tip_pool": bool(p.tips_eligible and p.tip_pool),
            "role_notes": _clean(p.role_notes),
            "staff_notes": _clean(p.staff_notes),
            "approval_mode": (p.approval_mode or "venue_default").lower(),
        })
    return out


async def _location_for(db: AsyncSession, venue: Venue, location_id, keep_id=None) -> Optional[VenueLocation]:
    """A saved, non-archived location of this venue (an archived one may stay on a template that already has it)."""
    if not location_id:
        return None
    loc = await db.scalar(select(VenueLocation).where(VenueLocation.id == location_id))
    if loc is None or loc.venue_id != venue.id:
        raise HTTPException(status_code=400, detail="That location doesn't belong to this venue.")
    if loc.is_archived and location_id != keep_id:
        raise HTTPException(status_code=400, detail=f"“{loc.name}” is archived. Bring it back under Venue Settings → Locations first.")
    return loc


async def _check_name(db: AsyncSession, venue_id, name: str, exclude_id=None) -> str:
    clean = (name or "").strip()[:120]
    if not clean:
        raise HTTPException(status_code=400, detail="Give the template a name.")
    q = select(EventTemplate.id).where(EventTemplate.venue_id == venue_id, func.lower(EventTemplate.name) == clean.lower())
    if exclude_id is not None:
        q = q.where(EventTemplate.id != exclude_id)
    if await db.scalar(q):
        raise HTTPException(status_code=400, detail=f"You already have a template called “{clean}”.")
    return clean


def _apply(tpl: EventTemplate, data: EventTemplateInput, name: str, location: Optional[VenueLocation], mode: str) -> None:
    title = (data.title or "").strip()[:255]
    if not title:
        raise HTTPException(status_code=400, detail="Give the event a name.")
    start = _norm_time(data.start_local, "Start time")
    end = _norm_time(data.end_local, "End time")
    if start == end:
        raise HTTPException(status_code=400, detail="The end time can't be the same as the start time.")
    tpl.name = name
    tpl.title = title
    tpl.start_local = start
    tpl.end_local = end
    tpl.notes = _clean(data.notes)
    tpl.staff_notes = _clean(data.staff_notes)
    tpl.location_id = location.id if location is not None else None
    tpl.geofence_mode = mode
    tpl.location_staff_notes = _clean(data.location_staff_notes)
    tpl.positions = _position_dicts(data.positions)


async def to_responses(db: AsyncSession, templates: List[EventTemplate]) -> List[EventTemplateResponse]:
    loc_ids = [t.location_id for t in templates if t.location_id]
    locations: Dict = {
        l.id: l for l in (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(loc_ids)))).scalars().all()
    } if loc_ids else {}
    counts = await usage_counts(db, list(locations.keys())) if locations else {}
    user_ids = {t.created_by_user_id for t in templates if t.created_by_user_id}
    users = {
        u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    } if user_ids else {}
    out = []
    for t in templates:
        loc = locations.get(t.location_id)
        out.append(EventTemplateResponse(
            id=t.id, venue_id=t.venue_id, name=t.name, title=t.title,
            start_local=t.start_local, end_local=t.end_local, overnight=t.end_local <= t.start_local,
            notes=t.notes, staff_notes=t.staff_notes,
            location=location_response(loc, counts) if loc is not None else None,
            geofence_mode=t.geofence_mode or "venue_default", location_staff_notes=t.location_staff_notes,
            positions=[EventTemplatePosition(**p) for p in (t.positions or [])],
            created_by_name=_name(users.get(t.created_by_user_id)),
            created_at=t.created_at, updated_at=t.updated_at,
        ))
    return out


async def list_templates(db: AsyncSession, venue_id) -> List[EventTemplateResponse]:
    rows = (await db.execute(
        select(EventTemplate).where(EventTemplate.venue_id == venue_id).order_by(func.lower(EventTemplate.name))
    )).scalars().all()
    return await to_responses(db, list(rows))


async def create_template(db: AsyncSession, venue: Venue, user: User, data: EventTemplateInput) -> EventTemplate:
    count = await db.scalar(select(func.count(EventTemplate.id)).where(EventTemplate.venue_id == venue.id)) or 0
    if count >= MAX_TEMPLATES_PER_VENUE:
        raise HTTPException(status_code=400, detail=f"A venue can have up to {MAX_TEMPLATES_PER_VENUE} templates. Delete one you no longer use.")
    name = await _check_name(db, venue.id, data.name)
    mode = validate_geofence_mode(data.geofence_mode)
    location = await _location_for(db, venue, data.location_id)
    check_geofence_possible(mode, venue, location)
    tpl = EventTemplate(venue_id=venue.id, created_by_user_id=user.id)
    _apply(tpl, data, name, location, mode)
    try:
        db.add(tpl)
        await db.commit()
        await db.refresh(tpl)
        return tpl
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save the template: {str(e)}")


async def update_template(db: AsyncSession, venue: Venue, tpl: EventTemplate, data: EventTemplateInput) -> EventTemplate:
    name = await _check_name(db, venue.id, data.name, exclude_id=tpl.id)
    mode = validate_geofence_mode(data.geofence_mode)
    location = await _location_for(db, venue, data.location_id, keep_id=tpl.location_id)
    check_geofence_possible(mode, venue, location)
    _apply(tpl, data, name, location, mode)
    try:
        await db.commit()
        await db.refresh(tpl)
        return tpl
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save the template: {str(e)}")


async def delete_template(db: AsyncSession, tpl: EventTemplate) -> None:
    try:
        await db.execute(delete(EventTemplate).where(EventTemplate.id == tpl.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete the template: {str(e)}")


async def template_from_event(db: AsyncSession, event: ShiftEvent, venue: Venue, user: User, name: str) -> EventTemplate:
    """Save an existing event's setup (times in venue time, where, notes, open positions) as a template."""
    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc())
    )).scalars().all()
    if not shifts:
        raise HTTPException(status_code=400, detail="Nothing to save: every position is cancelled.")
    tz = ZoneInfo(venue.timezone or "America/New_York")
    start = event.start_time if event.start_time.tzinfo else event.start_time.replace(tzinfo=timezone.utc)
    end = event.end_time if event.end_time.tzinfo else event.end_time.replace(tzinfo=timezone.utc)
    location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
    data = EventTemplateInput(
        name=name,
        title=event.title,
        start_local=start.astimezone(tz).strftime("%H:%M"),
        end_local=end.astimezone(tz).strftime("%H:%M"),
        notes=event.notes,
        staff_notes=event.staff_notes,
        location_id=location.id if location is not None and not location.is_archived else None,
        geofence_mode=event.geofence_mode or "venue_default",
        location_staff_notes=event.location_staff_notes,
        positions=[
            EventTemplatePosition(
                role_type=s.role_type, capacity=s.capacity or 1, hourly_rate=float(s.hourly_rate),
                hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
                hide_rate=bool(s.hide_rate), tips_eligible=bool(s.tips_eligible), tip_pool=bool(s.tip_pool),
                role_notes=s.description, staff_notes=s.staff_notes, approval_mode=s.approval_mode or "venue_default",
            )
            for s in shifts
        ],
    )
    return await create_template(db, venue, user, data)
```

---

## B3. NEW FILE `backend/src/routers/event_templates.py`
Manager of the venue or platform admin (`can_manage_venue`).

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/venues/{venue_id}/event-templates` | list (sorted by name) |
| POST | `/api/venues/{venue_id}/event-templates` | create → 201 |
| PUT | `/api/venues/{venue_id}/event-templates/{template_id}` | replace |
| DELETE | `/api/venues/{venue_id}/event-templates/{template_id}` | → 204 |
| POST | `/api/events/{event_id}/save-as-template` | `{name}` → 201 |

```python
"""
Phase 29.3: Event templates (the venue's reusable event setups). Venue managers of the venue, or platform admins.

  GET    /api/venues/{venue_id}/event-templates
  POST   /api/venues/{venue_id}/event-templates                  EventTemplateInput -> 201
  PUT    /api/venues/{venue_id}/event-templates/{template_id}    EventTemplateInput
  DELETE /api/venues/{venue_id}/event-templates/{template_id}    -> 204
  POST   /api/events/{event_id}/save-as-template                 {name} -> 201
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, ShiftEvent, EventTemplate
from src.schemas import EventTemplateInput, EventTemplateResponse, SaveAsTemplateRequest
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.event_templates import (
    list_templates, create_template, update_template, delete_template, template_from_event, to_responses,
)
from src.services import activity

router = APIRouter(tags=["Event templates"])


async def _venue(db: AsyncSession, venue_id: UUID, user: User) -> Venue:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not await can_manage_venue(db, user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return venue


async def _template(db: AsyncSession, venue: Venue, template_id: UUID) -> EventTemplate:
    tpl = await db.scalar(select(EventTemplate).where(EventTemplate.id == template_id, EventTemplate.venue_id == venue.id))
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found.")
    return tpl


@router.get("/api/venues/{venue_id}/event-templates", response_model=List[EventTemplateResponse])
async def get_templates(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    return await list_templates(db, venue.id)


@router.post("/api/venues/{venue_id}/event-templates", response_model=EventTemplateResponse, status_code=status.HTTP_201_CREATED)
async def post_template(
    venue_id: UUID,
    data: EventTemplateInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    tpl = await create_template(db, venue, current_user, data)
    out = (await to_responses(db, [tpl]))[0]
    await activity.for_venue("template_saved", venue.id, current_user.id, f"Created the event template “{tpl.name}”")
    return out


@router.put("/api/venues/{venue_id}/event-templates/{template_id}", response_model=EventTemplateResponse)
async def put_template(
    venue_id: UUID,
    template_id: UUID,
    data: EventTemplateInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    tpl = await update_template(db, venue, await _template(db, venue, template_id), data)
    out = (await to_responses(db, [tpl]))[0]
    await activity.for_venue("template_saved", venue.id, current_user.id, f"Edited the event template “{tpl.name}”")
    return out


@router.delete("/api/venues/{venue_id}/event-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_template(
    venue_id: UUID,
    template_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    tpl = await _template(db, venue, template_id)
    name = tpl.name
    await delete_template(db, tpl)
    await activity.for_venue("template_deleted", venue.id, current_user.id, f"Deleted the event template “{name}”")


@router.post("/api/events/{event_id}/save-as-template", response_model=EventTemplateResponse, status_code=status.HTTP_201_CREATED)
async def save_event_as_template(
    event_id: UUID,
    body: SaveAsTemplateRequest,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    venue = await _venue(db, event.venue_id, current_user)
    tpl = await template_from_event(db, event, venue, current_user, body.name)
    out = (await to_responses(db, [tpl]))[0]
    await activity.for_venue("template_saved", venue.id, current_user.id,
                             f"Saved “{event.title}” as the event template “{tpl.name}”")
    return out
```

---

## B4. `backend/src/routers/events.py` (EDITS)
Drafts stay quiet on create/duplicate. New endpoints:

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/events/{event_id}/publish` | draft → live; tells the team; 400 if already live, cancelled or in the past |
| POST | `/api/events/{event_id}/unpublish` | live → draft; 400 if anyone requested/was booked or an offer is open |
| DELETE | `/api/events/{event_id}` | delete a **draft** → 204; 400 for published events |

**Edit 1.** Find:
```python
from src.services.shift_events import (
    create_event_with_positions, update_event, build_event_detail, cancel_shifts, duplicate_event,
)
from src.services.timesheets import build_timesheet
from src.services import notify_events
from src.services import activity
from datetime import datetime, timezone

```
Replace with:
```python
from src.services.shift_events import (
    create_event_with_positions, update_event, build_event_detail, cancel_shifts, duplicate_event,
    publish_event, unpublish_event, discard_draft, DRAFT,
)
from src.services.timesheets import build_timesheet
from src.services import notify_events
from src.services import activity
from src.services.activity import short_when
from datetime import datetime, timezone

```

**Edit 2.** Find:
```python
    event = await create_event_with_positions(db, venue, current_user, data)
    detail = await build_event_detail(db, event)
    await notify_events.new_event_posted(event.id)          # Phase 28: tell the venue's team
    await activity.for_event("event_created", event.id, current_user.id)   # Phase 29.1
```
Replace with:
```python
    event = await create_event_with_positions(db, venue, current_user, data)
    detail = await build_event_detail(db, event)
    if event.status == DRAFT:                               # Phase 29.3: drafts stay quiet
        await activity.for_event("event_drafted", event.id, current_user.id)
        return detail
    await notify_events.new_event_posted(event.id)          # Phase 28: tell the venue's team
    await activity.for_event("event_created", event.id, current_user.id)   # Phase 29.1
```

**Edit 3.** Find:
```python
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    created = await duplicate_event(db, event, venue, current_user, body.dates)
    for ev in created:
        await notify_events.new_event_posted(ev.id)         # Phase 28
    if created:
        await activity.for_event("event_duplicated", event_id, current_user.id,
                                 f"{len(created)} {'copy' if len(created) == 1 else 'copies'}")   # Phase 29.1
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))


```
Replace with:
```python
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    created = await duplicate_event(db, event, venue, current_user, body.dates, as_draft=body.as_draft)
    drafts = sum(1 for ev in created if ev.status == DRAFT)
    for ev in created:
        if ev.status != DRAFT:
            await notify_events.new_event_posted(ev.id)     # Phase 28 (drafts stay quiet, Phase 29.3)
    if created:
        await activity.for_event("event_duplicated", event_id, current_user.id,
                                 f"{len(created)} {'copy' if len(created) == 1 else 'copies'}"
                                 + (" as drafts" if drafts else ""))   # Phase 29.1
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))


# ------------------------------------------------------------------------------
# Phase 29.3: Draft / publish
# ------------------------------------------------------------------------------
@router.post("/{event_id}/publish", response_model=EventDetail)
async def publish(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Make a draft live: workers can see and request it, and the venue's team is told."""
    event = await _load_managed_event(db, event_id, current_user)
    await publish_event(db, event)
    await db.refresh(event)
    detail = await build_event_detail(db, event)
    await notify_events.new_event_posted(event.id)
    await activity.for_event("event_published", event.id, current_user.id)
    return detail


@router.post("/{event_id}/unpublish", response_model=EventDetail)
async def unpublish(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Take a live event back to drafts (only while nobody has requested, been booked or been offered it)."""
    event = await _load_managed_event(db, event_id, current_user)
    await unpublish_event(db, event)
    await db.refresh(event)
    detail = await build_event_detail(db, event)
    await activity.for_event("event_unpublished", event.id, current_user.id)
    return detail


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete a draft. Published events can only be cancelled."""
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    what = f"{event.title} ({short_when(event.start_time, venue)})"
    venue_id = event.venue_id
    await discard_draft(db, event)
    await activity.for_venue("event_discarded", venue_id, current_user.id, f"Deleted the draft {what}")


```

---

## B5. `backend/src/routers/venues.py` (EDITS)
`GET /api/venues/{id}/events?scope=drafts`, and each event carries `status`.

**Edit 1.** Find:
```python
async def get_venue_events(
    venue_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past|all)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 23: Posted shifts grouped into events. One "Create Shift" submission creates one
    Shift row per role; rows sharing (title, start_time, end_time) are one event.
```
Replace with:
```python
async def get_venue_events(
    venue_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past|all|drafts)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 29.3: scope=drafts lists only draft events (any date, soonest first).
    Phase 23: Posted shifts grouped into events. One "Create Shift" submission creates one
    Shift row per role; rows sharing (title, start_time, end_time) are one event.
```

**Edit 2.** Find:
```python
    elif scope == "past":
        q = q.where(Shift.end_time < now_utc).order_by(Shift.start_time.desc(), Shift.role_type.asc()).limit(500)
    else:
        q = q.order_by(Shift.start_time.asc(), Shift.role_type.asc())
```
Replace with:
```python
    elif scope == "past":
        q = q.where(Shift.end_time < now_utc).order_by(Shift.start_time.desc(), Shift.role_type.asc()).limit(500)
    elif scope == "drafts":
        q = q.where(func.upper(Shift.status) == "DRAFT").order_by(Shift.start_time.asc(), Shift.role_type.asc())
    else:
        q = q.order_by(Shift.start_time.asc(), Shift.role_type.asc())
```

**Edit 3.** Find:
```python
                "event_key": key,
                "event_id": s.event_id,
                "title": s.title or "Shift",
                "start_time": s.start_time,
```
Replace with:
```python
                "event_key": key,
                "event_id": s.event_id,
                "status": (event_objs[s.event_id].status or "published") if s.event_id in event_objs else "published",   # Phase 29.3
                "title": s.title or "Shift",
                "start_time": s.start_time,
```

---

## B6. `backend/src/services/listings.py` (EDIT)
Workers never get drafts (list or single event).

**Edit 1.** Find:
```python
    now = datetime.now(timezone.utc)

    q = select(ShiftEvent)
    if event_id is not None:
        q = q.where(ShiftEvent.id == event_id)
```
Replace with:
```python
    now = datetime.now(timezone.utc)

    q = select(ShiftEvent).where(ShiftEvent.status != "draft")   # Phase 29.3: drafts are manager-only
    if event_id is not None:
        q = q.where(ShiftEvent.id == event_id)
```

---

## B7. `backend/src/services/venue_public.py` (EDITS)
Directory stats and the public venue page skip drafts.

**Edit 1.** Find:
```python
            ).label("open_spots"),
            func.min(Shift.start_time).filter(Shift.start_time >= now).label("next_start"),
        ).group_by(Shift.venue_id)
    )).all()
    stats = {r.venue_id: r for r in stats_rows}
```
Replace with:
```python
            ).label("open_spots"),
            func.min(Shift.start_time).filter(Shift.start_time >= now).label("next_start"),
        ).where(func.upper(Shift.status) != "DRAFT").group_by(Shift.venue_id)      # Phase 29.3: drafts are hidden
    )).all()
    stats = {r.venue_id: r for r in stats_rows}
```

**Edit 2.** Find:
```python
            func.count(distinct(func.concat(Shift.title, "|", Shift.start_time, "|", Shift.end_time))),
            func.coalesce(func.sum(Shift.capacity), 0),
        ).where(Shift.venue_id == venue.id, Shift.start_time >= since, Shift.start_time < now)
    )).one()

```
Replace with:
```python
            func.count(distinct(func.concat(Shift.title, "|", Shift.start_time, "|", Shift.end_time))),
            func.coalesce(func.sum(Shift.capacity), 0),
        ).where(Shift.venue_id == venue.id, Shift.start_time >= since, Shift.start_time < now,
                func.upper(Shift.status) != "DRAFT")      # Phase 29.3
    )).one()

```

**Edit 3.** Find:
```python
async def build_public_events(db: AsyncSession, venue: Venue, user: User, scope: str) -> List[PublicVenueEvent]:
    now = datetime.now(timezone.utc)
    q = select(Shift).where(Shift.venue_id == venue.id)
    if scope == "past":
        q = q.where(
```
Replace with:
```python
async def build_public_events(db: AsyncSession, venue: Venue, user: User, scope: str) -> List[PublicVenueEvent]:
    now = datetime.now(timezone.utc)
    q = select(Shift).where(Shift.venue_id == venue.id, func.upper(Shift.status) != "DRAFT")   # Phase 29.3
    if scope == "past":
        q = q.where(
```

---

## B8. `backend/src/services/booking.py` (EDIT)

**Edit 1.** Find:
```python
        if shift_status == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
```
Replace with:
```python
        if shift_status == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if shift_status == "DRAFT":                                                   # Phase 29.3
            raise HTTPException(status_code=400, detail="This event isn't open for requests.")
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
```

---

## B9. `backend/src/services/staffing.py` (EDITS)
Assign and offers refuse drafts.

**Edit 1.** Find:
```python
    if (shift.status or "").upper() == "CANCELLED":
        raise HTTPException(status_code=400, detail="This position was cancelled.")
    if as_utc(shift.end_time) <= now:
        raise HTTPException(status_code=400, detail="This shift is already over.")
```
Replace with:
```python
    if (shift.status or "").upper() == "CANCELLED":
        raise HTTPException(status_code=400, detail="This position was cancelled.")
    if (shift.status or "").upper() == "DRAFT":                                        # Phase 29.3
        raise HTTPException(status_code=400, detail="This event is still a draft. Publish it before booking people.")
    if as_utc(shift.end_time) <= now:
        raise HTTPException(status_code=400, detail="This shift is already over.")
```

**Edit 2.** Find:
```python
        if (shift.status or "").upper() == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if shift.event_id:
            ev = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
```
Replace with:
```python
        if (shift.status or "").upper() == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if (shift.status or "").upper() == "DRAFT":                                    # Phase 29.3
            raise HTTPException(status_code=400, detail="This event is still a draft. Publish it before sending offers.")
        if shift.event_id:
            ev = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
```

---

## B10. `backend/src/services/activity.py` (EDITS)

**Edit 1.** Find:
```python
    "position_cancelled": "changes",
    "event_duplicated": "changes",
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
```
Replace with:
```python
    "position_cancelled": "changes",
    "event_duplicated": "changes",
    "event_drafted": "changes",          # Phase 29.3
    "event_published": "changes",
    "event_unpublished": "changes",
    "event_discarded": "changes",
    "template_saved": "changes",
    "template_deleted": "changes",
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
```

**Edit 2.** Find:
```python
        "position_cancelled": f"Cancelled a position in {what}",
        "event_duplicated": f"Copied {what}",
    }.get(kind, what)
    if extra:
```
Replace with:
```python
        "position_cancelled": f"Cancelled a position in {what}",
        "event_duplicated": f"Copied {what}",
        "event_drafted": f"Saved a draft: {what}",                 # Phase 29.3
        "event_published": f"Published {what}",
        "event_unpublished": f"Moved {what} back to drafts",
    }.get(kind, what)
    if extra:
```

---

## B11. `backend/src/routers/admin_console.py` (EDITS)
Overview and venue numbers ignore drafts.

**Edit 1.** Find:
```python
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    live = and_(func.upper(Shift.status) != "CANCELLED", Shift.start_time >= now)
    events_7d = int(await db.scalar(
        select(func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=7))
    ) or 0)
    cap, filled = (await db.execute(
```
Replace with:
```python
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    live = and_(func.upper(Shift.status).notin_(("CANCELLED", "DRAFT")), Shift.start_time >= now)   # Phase 29.3: not drafts
    events_7d = int(await db.scalar(
        select(func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.status != "draft",
            ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=7))
    ) or 0)
    cap, filled = (await db.execute(
```

**Edit 2.** Find:
```python
    events = dict((await db.execute(
        select(ShiftEvent.venue_id, func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=30))
        .group_by(ShiftEvent.venue_id)
    )).all())
    open7 = dict((await db.execute(
        select(Shift.venue_id, func.sum(Shift.capacity - Shift.spots_filled)).where(
            func.upper(Shift.status) != "CANCELLED", Shift.start_time >= now, Shift.start_time < now + timedelta(days=7),
            Shift.spots_filled < Shift.capacity)
        .group_by(Shift.venue_id)
```
Replace with:
```python
    events = dict((await db.execute(
        select(ShiftEvent.venue_id, func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.status != "draft",
            ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=30))
        .group_by(ShiftEvent.venue_id)
    )).all())
    open7 = dict((await db.execute(
        select(Shift.venue_id, func.sum(Shift.capacity - Shift.spots_filled)).where(
            func.upper(Shift.status).notin_(("CANCELLED", "DRAFT")), Shift.start_time >= now, Shift.start_time < now + timedelta(days=7),
            Shift.spots_filled < Shift.capacity)
        .group_by(Shift.venue_id)
```

---

## B12. `backend/src/main.py` (EDITS)
Router import + `include_router` only. **Do not touch the CORS block.**

**Edit 1.** Find:
```python
from src.routers.activity import router as activity_router
from src.routers.admin_console import router as admin_console_router
from src.services.notification_worker import notification_worker_loop

```
Replace with:
```python
from src.routers.activity import router as activity_router
from src.routers.admin_console import router as admin_console_router
from src.routers.event_templates import router as event_templates_router
from src.services.notification_worker import notification_worker_loop

```

**Edit 2.** Find:
```python
app.include_router(activity_router)
app.include_router(admin_console_router)


```
Replace with:
```python
app.include_router(activity_router)
app.include_router(admin_console_router)
app.include_router(event_templates_router)


```

---

# PART C: Frontend

## C1. `frontend/src/components/ShiftEventFormModal.jsx` (FULL FILE REPLACEMENT)
Adds `mode="template"`, the template picker, draft/publish buttons and start→end syncing. Everything else (positions, pay, notes, location, approval) is unchanged.

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users, RotateCcw, Lock, MapPin, AlertTriangle, LayoutTemplate, Send, Save } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { payText } from './PayLabel';
import EventLocationPicker from './EventLocationPicker';
import { draftToPayload } from './LocationFields';
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
        setStart(utcToZonedLocalInput(ev.start_time, tz));
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
        staff_notes: (r.staff_notes || '').trim() || null,
        approval_mode: r.approval_mode,
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
      positions: payloadPositions,
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
          positions: payloadPositions.map(({ shift_id: _omit, ...p }) => p),
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
    : isDraft ? 'Edit draft' : isEdit ? 'Edit posted shift' : 'Post a shift';

  return (
    <ModalShell
      title={modalTitle}
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
              <label className={labelCls}>Event / shift name *</label>
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
                <MapPin className="w-3.5 h-3.5 text-emerald-400" /> Where
              </label>
              <EventLocationPicker key={pickerKey} venue={venue} value={where} onChange={setWhere} />

              <div>
                <label className={labelCls}>Clock-in location check</label>
                <select value={geofenceMode} onChange={(e) => setGeofenceMode(e.target.value)} className={inputCls}>
                  <option value="venue_default">Venue default ({venueGeoOn ? 'on' : 'off'})</option>
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
                  Changing the time or any notes flags the shift as “Updated” for everyone booked until they read it.
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
                    <button
                      type="button"
                      onClick={() => updateRow(r.key, { showNotes: true })}
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      + Add notes for this position (public or staff-only)
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

## C2. NEW FILE `frontend/src/components/EventTemplatesPanel.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { LayoutTemplate, Plus, Pencil, Trash2, Send, MapPin, Clock, Users, Moon } from 'lucide-react';
import api from '../api/client';
import ShiftEventFormModal from './ShiftEventFormModal';
import { payText } from './PayLabel';

/**
 * Phase 29.3: Venue Settings → Event templates.
 * A venue's reusable event setups: times, where, notes and positions. "Use" opens Post a Shift filled in.
 * Props: venue, onError(msg), onUseTemplate(template) (optional; hidden when not given, e.g. from the admin console)
 */
export default function EventTemplatesPanel({ venue, onError, onUseTemplate }) {
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);     // null | { template: obj | null }
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState('');

  const load = async () => {
    try {
      const res = await api.get(`/venues/${venue.id}/event-templates`);
      setTemplates(res.data || []);
    } catch (err) {
      setTemplates([]);
      onError(err.response?.data?.detail || 'Could not load templates.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.id]);

  const remove = async (tpl) => {
    setBusyId(tpl.id);
    try {
      await api.delete(`/venues/${venue.id}/event-templates/${tpl.id}`);
      setConfirmId(null);
      setFlash(`Deleted “${tpl.name}”.`);
      load();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not delete the template.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <p className="text-xs text-slate-400 max-w-xl">
          Save the events you run again and again: the name, times, where, notes and positions with pay. When you post a
          shift, pick a template, choose the date, and publish (or save it as a draft). You can also save any posted event
          as a template from its ⋯ menu.
        </p>
        <button type="button" onClick={() => setEditing({ template: null })}
          className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 flex-shrink-0 self-start">
          <Plus className="w-4 h-4" /> New template
        </button>
      </div>

      {flash && (
        <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700 text-emerald-200 text-xs flex justify-between gap-2">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash('')} className="underline">Dismiss</button>
        </div>
      )}

      {templates === null ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-dashed border-slate-700 bg-slate-950/50">
          <LayoutTemplate className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-300 font-semibold">No templates yet</p>
          <p className="text-xs text-slate-500 mt-1">Create one here, or open a posted event's ⋯ menu and choose “Save as template”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => {
            const spots = t.positions.reduce((n, p) => n + (p.capacity || 0), 0);
            return (
              <div key={t.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{t.name}</div>
                    {t.title !== t.name && <div className="text-[11px] text-slate-400 truncate">Posts as “{t.title}”</div>}
                  </div>
                  <LayoutTemplate className="w-4 h-4 text-indigo-300 flex-shrink-0" />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {t.start_local}–{t.end_local}
                    {t.overnight && <Moon className="w-3 h-3 text-indigo-300" title="Ends the next day" />}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {t.location ? (
                      <span className={t.location.is_archived ? 'text-amber-300' : 'text-emerald-300'}>
                        {t.location.name}{t.location.is_archived ? ' (archived)' : ''}
                      </span>
                    ) : 'Venue address'}
                  </span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {spots} spot{spots === 1 ? '' : 's'}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.positions.map((p, i) => (
                    <span key={`${p.role_type}-${i}`} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-semibold">
                      {p.capacity}× {p.role_type} · {payText(p.hourly_rate, p.hourly_rate_max)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-auto pt-1">
                  {onUseTemplate && (
                    <button type="button" onClick={() => onUseTemplate(t)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1">
                      <Send className="w-3 h-3" /> Use
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing({ template: t })}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  {confirmId === t.id ? (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-rose-200">
                      Delete?
                      <button type="button" disabled={busyId === t.id} onClick={() => remove(t)}
                        className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-50">Yes</button>
                      <button type="button" onClick={() => setConfirmId(null)}
                        className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300">No</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(t.id)} title="Delete template"
                      className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ShiftEventFormModal
          mode="template"
          venue={venue}
          template={editing.template}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setFlash(`Saved “${saved.name}”.`);
            load();
          }}
        />
      )}
    </div>
  );
}
```

---

## C3. NEW FILE `frontend/src/components/ConfirmDialog.jsx`

```jsx
import React, { useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import ModalShell from './ModalShell';

/**
 * Phase 29.3: A small yes/no dialog, optionally with one text field.
 * onConfirm(value) may throw; the error is shown and the dialog stays open.
 * input: { label, placeholder, initial, required } (optional)
 */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', danger = false, input = null, onConfirm, onClose,
}) {
  const [value, setValue] = useState(input?.initial || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (input?.required && !value.trim()) return setError(`${input.label || 'This'} is required.`);
    setSaving(true);
    try {
      await onConfirm(value.trim());
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={title}
      icon={danger ? <AlertTriangle className="w-5 h-5 text-rose-400" /> : <HelpCircle className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Go back
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className={`px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'}`}>
            {saving ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {message && <p className="text-sm text-slate-300">{message}</p>}
      {input && (
        <label className="block text-xs font-semibold text-slate-300 mt-3">
          {input.label}
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={input.placeholder || ''}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500" />
        </label>
      )}
    </ModalShell>
  );
}
```

---

## C4. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
New **Event templates** tab; new optional props `initialTab` and `onUseTemplate`.

**Edit 1.** Find:
```jsx
import ModalShell from './ModalShell';
import VenueLocationsPanel from './VenueLocationsPanel';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

```
Replace with:
```jsx
import ModalShell from './ModalShell';
import VenueLocationsPanel from './VenueLocationsPanel';
import EventTemplatesPanel from './EventTemplatesPanel';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

```

**Edit 2.** Find:
```jsx
}

export default function VenueSettingsModal({ mode = 'edit', venue = null, showManagerEmail = false, onClose, onSaved }) {
  const isEdit = mode === 'edit' && !!venue?.id;
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(emptyForm(venue));
  const [saving, setSaving] = useState(false);
```
Replace with:
```jsx
}

// Phase 29.3: initialTab ('details' | 'positions' | 'locations' | 'templates'); onUseTemplate(template) shows "Use" on templates
export default function VenueSettingsModal({
  mode = 'edit', venue = null, showManagerEmail = false, initialTab = 'details', onUseTemplate = null, onClose, onSaved,
}) {
  const isEdit = mode === 'edit' && !!venue?.id;
  const [tab, setTab] = useState(isEdit ? initialTab : 'details');
  const [form, setForm] = useState(emptyForm(venue));
  const [saving, setSaving] = useState(false);
```

**Edit 3.** Find:
```jsx

  const tabs = isEdit ? (
    <div className="flex gap-2">
      {[{ id: 'details', label: 'Details' }, { id: 'positions', label: 'Positions & pay' }, { id: 'locations', label: 'Locations' }].map((t) => (
        <button key={t.id} type="button" onClick={() => setTab(t.id)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
```
Replace with:
```jsx

  const tabs = isEdit ? (
    <div className="flex flex-wrap gap-2">
      {[
        { id: 'details', label: 'Details' },
        { id: 'positions', label: 'Positions & pay' },
        { id: 'locations', label: 'Locations' },
        { id: 'templates', label: 'Event templates' },   // Phase 29.3
      ].map((t) => (
        <button key={t.id} type="button" onClick={() => setTab(t.id)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
```

**Edit 4.** Find:
```jsx
      ) : tab === 'locations' ? (
        <VenueLocationsPanel venue={venue} onError={setError} />
      ) : (
        <div className="space-y-4">
```
Replace with:
```jsx
      ) : tab === 'locations' ? (
        <VenueLocationsPanel venue={venue} onError={setError} />
      ) : tab === 'templates' ? (
        <EventTemplatesPanel venue={venue} onError={setError} onUseTemplate={onUseTemplate} />
      ) : (
        <div className="space-y-4">
```

---

## C5. `frontend/src/components/PostedShiftsBoard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus, Pencil, Eye, EyeOff, Copy, ClipboardList, Ban, MoreHorizontal, MapPin } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
```
Replace with:
```jsx
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus, Pencil, Eye, EyeOff, Copy, ClipboardList, Ban, MoreHorizontal, MapPin, Send, Undo2, Trash2, LayoutTemplate, FilePen } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
```

**Edit 2.** Find:
```jsx
const SCOPES = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
```
Replace with:
```jsx
const SCOPES = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'drafts', label: 'Drafts' },       // Phase 29.3
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
```

**Edit 3.** Find:
```jsx
  onOpenedEvent,
  onDataChanged,           // Phase 29: after assign / offer / rating (parent reloads, which bumps refreshKey)
}) {
  const [scope, setScope] = useState('upcoming');
```
Replace with:
```jsx
  onOpenedEvent,
  onDataChanged,           // Phase 29: after assign / offer / rating (parent reloads, which bumps refreshKey)
  onPublishEvent,          // Phase 29.3: (ev) draft -> live
  onUnpublishEvent,        // Phase 29.3: (ev) live -> draft
  onDeleteDraft,           // Phase 29.3: (ev)
  onSaveTemplate,          // Phase 29.3: (ev)
}) {
  const [scope, setScope] = useState('upcoming');
```

**Edit 4.** Find:
```jsx
            eventPropGetter={(e) => ({
              style: {
                backgroundColor: e.resource.total_requested > 0 ? '#b45309' : '#059669',
                borderColor: e.resource.total_requested > 0 ? '#f59e0b' : '#10b981',
                color: '#ffffff',
                borderRadius: '6px',
```
Replace with:
```jsx
            eventPropGetter={(e) => ({
              style: {
                backgroundColor: e.resource.status === 'draft' ? '#334155' : e.resource.total_requested > 0 ? '#b45309' : '#059669',
                borderColor: e.resource.status === 'draft' ? '#94a3b8' : e.resource.total_requested > 0 ? '#f59e0b' : '#10b981',
                borderStyle: e.resource.status === 'draft' ? 'dashed' : 'solid',
                color: '#ffffff',
                borderRadius: '6px',
```

**Edit 5.** Find:
```jsx
          <CalendarIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            {scope === 'upcoming' ? 'No upcoming shifts posted for this venue.' : 'No shifts found.'}
          </p>
        </div>
```
Replace with:
```jsx
          <CalendarIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            {scope === 'upcoming' ? 'No upcoming shifts posted for this venue.'
              : scope === 'drafts' ? 'No drafts. Use “Save as draft” when posting a shift to prepare it before workers can see it.'
              : 'No shifts found.'}
          </p>
        </div>
```

**Edit 6.** Find:
```jsx
                {items.map((ev) => {
                  const timeStr = fmtTimeRange(ev.start_time, ev.end_time, timeZone);
                  return (
                    <div key={ev.event_key} className={`bg-slate-950 border rounded-xl overflow-visible ${ev.cancelled ? 'border-rose-900/60 opacity-70' : 'border-slate-800'}`}>
                      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 bg-slate-800/30">
                        <div>
                          <div className="text-sm font-bold text-white">{ev.title}</div>
                          {ev.cancelled && (
                            <div className="text-[11px] text-rose-300">Cancelled{ev.cancel_reason ? `: ${ev.cancel_reason}` : ''}</div>
```
Replace with:
```jsx
                {items.map((ev) => {
                  const timeStr = fmtTimeRange(ev.start_time, ev.end_time, timeZone);
                  const isDraft = ev.status === 'draft';          // Phase 29.3
                  const upcoming = new Date(ev.start_time) > new Date();
                  const nobody = ev.total_assigned === 0 && ev.total_requested === 0 && !ev.positions.some((p) => (p.offers || []).some((o) => o.status === 'pending'));
                  return (
                    <div key={ev.event_key} className={`bg-slate-950 border rounded-xl overflow-visible ${ev.cancelled ? 'border-rose-900/60 opacity-70' : isDraft ? 'border-dashed border-slate-500' : 'border-slate-800'}`}>
                      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 bg-slate-800/30">
                        <div>
                          <div className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                            {ev.title}
                            {isDraft && (
                              <span title="Only managers can see a draft" className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-200 border border-slate-500 inline-flex items-center gap-1">
                                <FilePen className="w-3 h-3" /> Draft · not visible to workers
                              </span>
                            )}
                          </div>
                          {ev.cancelled && (
                            <div className="text-[11px] text-rose-300">Cancelled{ev.cancel_reason ? `: ${ev.cancel_reason}` : ''}</div>
```

**Edit 7.** Find:
```jsx
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-start md:self-auto relative">
                          <button
                            type="button"
```
Replace with:
```jsx
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto relative">
                          <button
                            type="button"
```

**Edit 8.** Find:
```jsx
                            <Eye className="w-3.5 h-3.5" /> Details
                          </button>
                          {onEditEvent && ev.event_id && !ev.cancelled && (
                            <button
```
Replace with:
```jsx
                            <Eye className="w-3.5 h-3.5" /> Details
                          </button>
                          {isDraft && onPublishEvent && !ev.cancelled && (
                            <button
                              type="button"
                              onClick={() => onPublishEvent(ev)}
                              disabled={!upcoming}
                              title={upcoming ? 'Workers can see and request it, and your team is told' : 'The start time has passed. Edit the date first.'}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition inline-flex items-center gap-1.5 disabled:opacity-40"
                            >
                              <Send className="w-3.5 h-3.5" /> Publish
                            </button>
                          )}
                          {onEditEvent && ev.event_id && !ev.cancelled && (
                            <button
```

**Edit 9.** Find:
```jsx
                          {menuKey === ev.event_key && (
                            <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1">
                              {onTimesheet && (
                                <button type="button" onClick={() => { setMenuKey(null); onTimesheet(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2">
```
Replace with:
```jsx
                          {menuKey === ev.event_key && (
                            <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1">
                              {onTimesheet && !isDraft && (
                                <button type="button" onClick={() => { setMenuKey(null); onTimesheet(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2">
```

**Edit 10.** Find:
```jsx
                                </button>
                              )}
                              {onCancelEvent && !ev.cancelled && new Date(ev.start_time) > new Date() && (
                                <button type="button" onClick={() => { setMenuKey(null); onCancelEvent(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-2">
```
Replace with:
```jsx
                                </button>
                              )}
                              {onSaveTemplate && (
                                <button type="button" onClick={() => { setMenuKey(null); onSaveTemplate(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2">
                                  <LayoutTemplate className="w-3.5 h-3.5" /> Save as template
                                </button>
                              )}
                              {onUnpublishEvent && !isDraft && !ev.cancelled && upcoming && nobody && (
                                <button type="button" onClick={() => { setMenuKey(null); onUnpublishEvent(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2">
                                  <Undo2 className="w-3.5 h-3.5" /> Move back to drafts
                                </button>
                              )}
                              {onDeleteDraft && isDraft && (
                                <button type="button" onClick={() => { setMenuKey(null); onDeleteDraft(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-2">
                                  <Trash2 className="w-3.5 h-3.5" /> Delete draft
                                </button>
                              )}
                              {onCancelEvent && !isDraft && !ev.cancelled && new Date(ev.start_time) > new Date() && (
                                <button type="button" onClick={() => { setMenuKey(null); onCancelEvent(ev); }}
                                  className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-2">
```

**Edit 11.** Find:
```jsx
                                {pos.status === 'CANCELLED' && <span className="text-[10px] text-rose-300">cancelled</span>}
                              </div>
                              <div className="md:col-span-3 flex items-center gap-1.5 text-emerald-400 font-semibold">
                                <PayLabel rate={pos.hourly_rate} rateMax={pos.hourly_rate_max} />
                                {pos.hide_rate && <EyeOff className="w-3 h-3 text-slate-500" title="Pay hidden from workers" />}
```
Replace with:
```jsx
                                {pos.status === 'CANCELLED' && <span className="text-[10px] text-rose-300">cancelled</span>}
                              </div>
                              <div className="md:col-span-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 text-emerald-400 font-semibold whitespace-nowrap">
                                <PayLabel rate={pos.hourly_rate} rateMax={pos.hourly_rate_max} />
                                {pos.hide_rate && <EyeOff className="w-3 h-3 text-slate-500" title="Pay hidden from workers" />}
```

---

## C6. `frontend/src/components/EventRosterModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
          </div>
        )}
        {event.positions.map((pos) => {
          const isFull = pos.assigned.length >= pos.capacity;
          const canStaff = venueId && !event.cancelled && pos.status !== 'CANCELLED' && !isFull && !ended;
          return (
            <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
```
Replace with:
```jsx
          </div>
        )}
        {event.status === 'draft' && (
          <div className="p-3 rounded-xl text-xs border border-dashed border-slate-500 bg-slate-800/50 text-slate-200">
            This is a <strong>draft</strong>. Workers can't see it, and you can't assign or offer spots until it's published.
          </div>
        )}
        {event.positions.map((pos) => {
          const isFull = pos.assigned.length >= pos.capacity;
          const isDraft = event.status === 'draft';   // Phase 29.3: publish before staffing
          const canStaff = venueId && !event.cancelled && !isDraft && pos.status !== 'CANCELLED' && !isFull && !ended;
          return (
            <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
```

**Edit 2.** Find:
```jsx
                  </button>
                )}
                {onCancelPosition && !event.cancelled && pos.status !== 'CANCELLED' && (
                  <button type="button" onClick={() => onCancelPosition(pos, event)}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-300 text-xs border border-rose-600/30 inline-flex items-center gap-1">
```
Replace with:
```jsx
                  </button>
                )}
                {onCancelPosition && !event.cancelled && !isDraft && pos.status !== 'CANCELLED' && (
                  <button type="button" onClick={() => onCancelPosition(pos, event)}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-300 text-xs border border-rose-600/30 inline-flex items-center gap-1">
```

---

## C7. `frontend/src/components/DuplicateEventModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dates = useMemo(() => {
```
Replace with:
```jsx
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sourceDraft = event.status === 'draft';               // Phase 29.3: copies of a draft are drafts
  const [asDraft, setAsDraft] = useState(sourceDraft);

  const dates = useMemo(() => {
```

**Edit 2.** Find:
```jsx
    setSaving(true);
    try {
      const res = await api.post(`/events/${event.event_id}/duplicate`, { dates });
      onDone && onDone(res.data.count);
      onClose();
    } catch (err) {
```
Replace with:
```jsx
    setSaving(true);
    try {
      const res = await api.post(`/events/${event.event_id}/duplicate`, { dates, as_draft: asDraft });
      onDone && onDone(res.data.count, asDraft);
      onClose();
    } catch (err) {
```

**Edit 3.** Find:
```jsx
      <button type="button" onClick={submit} disabled={saving}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
        {saving ? 'Copying…' : `Create ${dates.length} ${dates.length === 1 ? 'copy' : 'copies'}`}
      </button>
    </>
```
Replace with:
```jsx
      <button type="button" onClick={submit} disabled={saving}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
        {saving ? 'Copying…' : `Create ${dates.length} ${asDraft ? 'draft ' : ''}${dates.length === 1 ? 'copy' : 'copies'}`}
      </button>
    </>
```

**Edit 4.** Find:
```jsx
        )}
      </div>
      <p className="text-[11px] text-slate-500 mt-3">
        Same start time ({timeZone || 'venue'} time), positions, pay, notes and approval settings. Nobody is booked on the copies.
```
Replace with:
```jsx
        )}
      </div>
      <label className={`mt-3 flex items-start gap-2 text-xs ${sourceDraft ? 'text-slate-500' : 'text-slate-300'}`}>
        <input type="checkbox" checked={asDraft} disabled={sourceDraft} onChange={(e) => setAsDraft(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
        <span>
          Create the copies as drafts (workers can't see them until you publish each one)
          {sourceDraft && <span className="block text-[10px]">This event is a draft, so its copies are drafts too.</span>}
        </span>
      </label>
      <p className="text-[11px] text-slate-500 mt-3">
        Same start time ({timeZone || 'venue'} time), positions, pay, notes and approval settings. Nobody is booked on the copies.
```

---

## C8. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
Publish / Move back to drafts / Delete draft / Save as template handlers, the **Templates** header button, and template **Use** → Post a Shift.

**Edit 1.** Find:
```jsx
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, Users, ArrowRightLeft, X,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
```
Replace with:
```jsx
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, Users, ArrowRightLeft, X, LayoutTemplate,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
```

**Edit 2.** Find:
```jsx
import ReasonDialog from '../components/ReasonDialog';
import DuplicateEventModal from '../components/DuplicateEventModal';
import TimesheetModal from '../components/TimesheetModal';
import TeamModal from '../components/TeamModal';
```
Replace with:
```jsx
import ReasonDialog from '../components/ReasonDialog';
import DuplicateEventModal from '../components/DuplicateEventModal';
import ConfirmDialog from '../components/ConfirmDialog';
import TimesheetModal from '../components/TimesheetModal';
import TeamModal from '../components/TeamModal';
```

**Edit 3.** Find:
```jsx
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);
  const [eventForm, setEventForm] = useState(null); // { mode: 'create' } | { mode: 'edit', eventId }
  const [reasonDialog, setReasonDialog] = useState(null);
  const [dupEvent, setDupEvent] = useState(null);
```
Replace with:
```jsx
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('details');   // Phase 29.3
  const [confirmDialog, setConfirmDialog] = useState(null);    // Phase 29.3
  const [eventForm, setEventForm] = useState(null); // { mode: 'create', templateId? } | { mode: 'edit', eventId }
  const [reasonDialog, setReasonDialog] = useState(null);
  const [dupEvent, setDupEvent] = useState(null);
```

**Edit 4.** Find:
```jsx
    });

  const askCancelPosition = (pos, ev) =>
    setReasonDialog({
```
Replace with:
```jsx
    });

  // Phase 29.3: drafts and templates
  const publishEvent = async (ev) => {
    setActionLoading(`publish-${ev.event_id}`);
    try {
      await api.post(`/events/${ev.event_id}/publish`);
      afterChange(`Published “${ev.title}”. Workers can see it and your team has been told.`);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Could not publish.' });
    } finally {
      setActionLoading(null);
    }
  };

  const askUnpublish = (ev) =>
    setConfirmDialog({
      title: 'Move back to drafts?',
      message: `Workers will stop seeing “${ev.title}” until you publish it again. Nobody has requested it yet.`,
      confirmLabel: 'Move to drafts',
      onConfirm: async () => {
        await api.post(`/events/${ev.event_id}/unpublish`);
        afterChange(`“${ev.title}” is a draft again.`);
      },
    });

  const askDeleteDraft = (ev) =>
    setConfirmDialog({
      title: 'Delete this draft?',
      message: `“${ev.title}” and its positions will be deleted. Nobody was told about it, so nobody is affected.`,
      confirmLabel: 'Delete draft',
      danger: true,
      onConfirm: async () => {
        await api.delete(`/events/${ev.event_id}`);
        afterChange('Draft deleted.');
      },
    });

  const askSaveTemplate = (ev) =>
    setConfirmDialog({
      title: 'Save as a template',
      message: 'Saves the times, where, notes and positions (with pay) so you can post this event again in a few clicks. Dates and people are not saved.',
      confirmLabel: 'Save template',
      input: { label: 'Template name', placeholder: 'e.g. Friday Jazz', initial: ev.title, required: true },
      onConfirm: async (name) => {
        await api.post(`/events/${ev.event_id}/save-as-template`, { name });
        setNotification({ type: 'success', message: `Saved the template “${name}”. Pick it next time you post a shift.` });
      },
    });

  const openTemplates = () => {
    setSettingsTab('templates');
    setShowVenueSettings(true);
  };

  const askCancelPosition = (pos, ev) =>
    setReasonDialog({
```

**Edit 5.** Find:
```jsx
              <Plus className="w-4 h-4" /> Post a Shift
            </button>
            <button type="button" onClick={() => setShowTeam(true)} disabled={!venueDetails} className={headerBtn}>
              <UserPlus className="w-4 h-4 text-emerald-400" /> Team
            </button>
            <button type="button" onClick={() => setShowVenueSettings(true)} disabled={!venueDetails} className={headerBtn}>
              <Settings className="w-4 h-4 text-amber-400" /> Settings
            </button>
```
Replace with:
```jsx
              <Plus className="w-4 h-4" /> Post a Shift
            </button>
            <button type="button" onClick={openTemplates} disabled={!venueDetails} className={headerBtn}>
              <LayoutTemplate className="w-4 h-4 text-indigo-300" /> Templates
            </button>
            <button type="button" onClick={() => setShowTeam(true)} disabled={!venueDetails} className={headerBtn}>
              <UserPlus className="w-4 h-4 text-emerald-400" /> Team
            </button>
            <button type="button" onClick={() => { setSettingsTab('details'); setShowVenueSettings(true); }} disabled={!venueDetails} className={headerBtn}>
              <Settings className="w-4 h-4 text-amber-400" /> Settings
            </button>
```

**Edit 6.** Find:
```jsx
              onCancelEvent={askCancelEvent}
              onDuplicateEvent={(ev) => setDupEvent(ev)}
              onTimesheet={(ev) => setTimesheetEventId(ev.event_id)}
              onRemovePerson={askRemovePerson}
```
Replace with:
```jsx
              onCancelEvent={askCancelEvent}
              onDuplicateEvent={(ev) => setDupEvent(ev)}
              onPublishEvent={publishEvent}
              onUnpublishEvent={askUnpublish}
              onDeleteDraft={askDeleteDraft}
              onSaveTemplate={askSaveTemplate}
              onTimesheet={(ev) => setTimesheetEventId(ev.event_id)}
              onRemovePerson={askRemovePerson}
```

**Edit 7.** Find:
```jsx
          mode={eventForm.mode}
          eventId={eventForm.eventId}
          venue={venueDetails}
          positions={venuePositions}
          onClose={() => setEventForm(null)}
          onSaved={() => {
            setEventForm(null);
            fetchVenueData(currentVenueId);
            setNotification({
              type: 'success',
              message: eventForm.mode === 'edit' ? 'Event updated.' : 'Event and shifts published.',
            });
            loadVenuePositions(currentVenueId);
```
Replace with:
```jsx
          mode={eventForm.mode}
          eventId={eventForm.eventId}
          templateId={eventForm.templateId}
          venue={venueDetails}
          positions={venuePositions}
          onClose={() => setEventForm(null)}
          onSaved={(saved, info = {}) => {
            setEventForm(null);
            fetchVenueData(currentVenueId);
            setNotification({
              type: 'success',
              message: saved?.status === 'draft'
                ? 'Draft saved. Only managers can see it. Publish it from Posted Shifts when it’s ready.'
                : info.published
                  ? 'Published. Workers can see it and your team has been told.'
                  : 'Event updated.',
            });
            loadVenuePositions(currentVenueId);
```

**Edit 8.** Find:
```jsx

      {reasonDialog && <ReasonDialog {...reasonDialog} onClose={() => setReasonDialog(null)} />}
      {dupEvent && (
        <DuplicateEventModal
          event={dupEvent}
          timeZone={tz}
          onClose={() => setDupEvent(null)}
          onDone={(count) => afterChange(`Created ${count} ${count === 1 ? 'copy' : 'copies'}.`)}
        />
      )}
```
Replace with:
```jsx

      {reasonDialog && <ReasonDialog {...reasonDialog} onClose={() => setReasonDialog(null)} />}
      {confirmDialog && <ConfirmDialog {...confirmDialog} onClose={() => setConfirmDialog(null)} />}
      {dupEvent && (
        <DuplicateEventModal
          event={dupEvent}
          timeZone={tz}
          onClose={() => setDupEvent(null)}
          onDone={(count, asDraft) => afterChange(`Created ${count} ${asDraft ? 'draft ' : ''}${count === 1 ? 'copy' : 'copies'}.`)}
        />
      )}
```

**Edit 9.** Find:
```jsx
          mode="edit"
          venue={venueDetails}
          onClose={() => {
            setShowVenueSettings(false);
```
Replace with:
```jsx
          mode="edit"
          venue={venueDetails}
          initialTab={settingsTab}
          onUseTemplate={(tpl) => {
            setShowVenueSettings(false);
            loadVenuePositions(currentVenueId);
            setEventForm({ mode: 'create', templateId: tpl.id });
          }}
          onClose={() => {
            setShowVenueSettings(false);
```

---

## E. Rebuild & verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published';
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
UPDATE shift_events SET published_at = created_at WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS event_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    title VARCHAR(255) NOT NULL,
    start_local VARCHAR(5) NOT NULL,
    end_local VARCHAR(5) NOT NULL,
    notes TEXT,
    staff_notes TEXT,
    location_id UUID REFERENCES venue_locations(id) ON DELETE SET NULL,
    geofence_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default',
    location_staff_notes TEXT,
    positions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_templates_venue ON event_templates(venue_id);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.) Existing events all stay published.

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### Checklist
Sign in as the venue manager (or as an admin with the venue picked).

1. **Save as draft:**
   * **Post a Shift**, fill it in, then **Save as draft**. The banner says "Draft saved…".
   * The card has a dashed border and **Draft · not visible to workers**, plus a green **Publish** button.
   * The **Drafts** filter shows only drafts.
2. **Workers can't see it:**
   * As a worker on the team, the draft isn't in the shift list, on the venue's public page or in the bell.
   * Asking the API for the draft as a worker (`GET /api/listings/<draft id>`) returns 404.
3. **No staffing on drafts:** the draft's **Details** says it's a draft and shows no **Assign / Offer** or **Cancel position**.
4. **Edit a draft:**
   * The modal is titled "Edit draft", with **Save draft** and **Save & publish**.
   * Changing the time doesn't mark anything "Updated".
5. **Publish:**
   * Click **Publish** on the card. The banner says your team has been told.
   * Team members get "New shift at …", and the event appears for workers.
   * The Activity log shows "Saved a draft…" and then "Published…".
6. **Move back to drafts:**
   * On a published event nobody has touched, ⋯ → **Move back to drafts** hides it again.
   * Once someone has requested it, that menu item is gone. The API refuses it too.
7. **Delete draft:** ⋯ → **Delete draft** removes it. The log says "Deleted the draft …".
8. **Past draft:** a draft whose start has passed has a disabled Publish button. Editing the date fixes it.
9. **Duplicate:**
   * ⋯ → Duplicate / repeat has **Create the copies as drafts**. With it ticked, the copies appear under Drafts and nobody is told.
   * For a draft the box is ticked and locked.
10. **Templates tab:**
    * **Templates** in the header, or Settings → **Event templates**.
    * **New template**: name "Friday Jazz", 18:00–23:30, two positions, then **Save template**. It appears as a card.
    * An end time earlier than the start shows a moon icon (overnight).
11. **Use a template:**
    * **Use** on the card opens Post a Shift filled in: name, times on tomorrow's date, notes and positions.
    * Change the date: the end time moves with it. Then publish or save a draft.
12. **Start from a template:** in a fresh Post a Shift, the purple **Start from a template** box fills everything in when you pick one.
13. **Save as template:** ⋯ → **Save as template** on any event asks for a name, then the template appears in the tab with the event's times.
14. **Edit and delete a template:** **Edit** opens the same form with name and clock times; **Delete** asks "Delete?" inline. Neither changes events already posted.
15. **Admin:**
    * From the admin console's venue drawer → Settings, the Event templates tab is there (no **Use** button).
    * Overview numbers don't count drafts.