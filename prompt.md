# Phase 25.2: Wide Modals, Real Events, Notes, Per-Role Approval & Pay Ranges, Editable Posted Shifts

Patch on top of Phase 25.1 (implemented). Goals:

1. **Modals that always fit and scroll.** New shared `ModalShell` uses the standard "scrolling backdrop" pattern (the dark overlay scrolls; the panel is normal height with a sticky header and footer). No height math, so it works on every screen. `VenueSettingsModal` is rebuilt **wide with two columns**.
2. **Real events.** A new `shift_events` table. One "Create Shift" submission = one event row + one `shifts` row per position (linked by `shifts.event_id`). Replaces grouping by matching title/time.
3. **Three levels of notes:**
   * **Venue notes**: set once in Venue Settings (`venues.default_shift_notes`), shown on every shift at that venue. No longer copied into each shift.
   * **Event notes**: `shift_events.notes`, shown to everyone on that event.
   * **Position notes**: per role, e.g. "Bartenders: bring a wine key." Stored in the existing `shifts.description` column, which now means *position notes*.
4. **Approval per event and per position.** Each position has `approval_mode`: `venue_default` (use the venue's policy), `auto` (instant booking), or `manual` (needs approval). The event form has a "set all positions" control. Example: Bartender = Needs approval, Server = Instant.
5. **Pay ranges + hidden pay.** Shifts and venue positions get an optional top of range (`hourly_rate_max`) and a **Hide pay from workers** flag (`hide_rate`). Hidden pay is removed **by the server** for workers; a worker sees it once they're booked on that position. Managers and admins always see it.
6. **Editable posted shifts.** Each event on the Posted Shifts board gets **Details** and **Edit** buttons. Edit uses the same form as Create: change name/time/notes, change or add positions, remove positions that nobody is booked on or waiting for.
7. **Navbar labels**: `Worker`, `Venue Manager`, `Admin` (no "View").

⚠️ **SCHEMA CHANGE.** See §13 for rebuild options (wipe, or keep data with a provided SQL script).

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything in `.secrets/`, `docker-compose.yml`, `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/serializers.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/App.jsx`, `frontend/src/pages/LoginPage.jsx`.
* `backend/src/main.py`: ONLY add the new router import + `include_router` line (§6D).
* No native PostgreSQL ENUMs. `approval_mode` is `VARCHAR(20)`, validated in Python.
* Schema changes go in BOTH `database/init.sql` and `backend/src/models.py`.
* **Never add a field named `event` to `ShiftResponse`**, and never read `shift.event` / `shift.venue` / `shift.requests` on an ORM object unless it was `selectinload`-ed. Event notes reach `ShiftResponse` only through the plain `event_notes` field filled by `to_shift_responses()` (§5B).
* Worker-facing endpoints must never return `hourly_rate` / `hourly_rate_max` for a shift with `hide_rate = TRUE` unless the viewer manages that venue, is an admin, or is booked on that shift.
* All backend datetime comparisons use `datetime.now(timezone.utc)`.
* New files and full-file replacements must be written with the EXACT content given. Only the `lucide-react` icons named in this prompt are used.

---

## 1. Database Schema

### A. `database/init.sql`

**1) Events table.** Directly after the `venue_positions` section (after `CREATE INDEX idx_venue_positions_venue ...;`) and BEFORE `CREATE TABLE shifts`, add:
```sql
-- ------------------------------------------------------------------------------
-- 4c. Shift Events (Phase 25.2): one posting = one event with 1+ positions
-- ------------------------------------------------------------------------------
CREATE TABLE shift_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_event_time CHECK (end_time > start_time)
);

CREATE INDEX idx_shift_events_venue ON shift_events(venue_id);
CREATE INDEX idx_shift_events_start ON shift_events(start_time);
```

**2) `venue_positions`.** In `CREATE TABLE venue_positions (...)`:
* directly after `default_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,` add:
```sql
    default_rate_max NUMERIC(10, 2),
    hide_rate BOOLEAN NOT NULL DEFAULT FALSE,
```
* directly after `CONSTRAINT chk_position_rate CHECK (default_rate > 0)` add a comma and:
```sql
    CONSTRAINT chk_position_rate_range CHECK (default_rate_max IS NULL OR default_rate_max >= default_rate)
```

**3) `shifts`.** In `CREATE TABLE shifts (...)`:
* directly after `venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,` add:
```sql
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
```
* directly after `hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,` add:
```sql
    hourly_rate_max NUMERIC(10, 2),
    hide_rate BOOLEAN NOT NULL DEFAULT FALSE,
    approval_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default',
```
* add to the constraints at the end of the table (comma after the previous constraint):
```sql
    CONSTRAINT chk_shift_rate_range CHECK (hourly_rate_max IS NULL OR hourly_rate_max >= hourly_rate)
```
* after `CREATE INDEX idx_shifts_role_type ...;` add:
```sql
CREATE INDEX idx_shifts_event ON shifts(event_id);
```

**4) Trigger.** Next to the other `trg_..._updated_at` triggers add:
```sql
CREATE TRIGGER trg_shift_events_updated_at BEFORE UPDATE ON shift_events FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
```

### B. `backend/src/models.py`

In `class VenuePosition`, directly after `default_rate = Column(...)`:
```python
    default_rate_max = Column(Numeric(10, 2), nullable=True)
    hide_rate = Column(Boolean, nullable=False, default=False)
```
and add to its `__table_args__` tuple:
```python
        CheckConstraint("default_rate_max IS NULL OR default_rate_max >= default_rate", name="chk_position_rate_range"),
```

Add a new model directly BEFORE `class Shift`:
```python
class ShiftEvent(Base):
    __tablename__ = "shift_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)
    end_time = Column(DateTime(timezone=True), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shifts = relationship("Shift", back_populates="event", cascade="all, delete-orphan")
```

In `class Shift`:
* directly after `venue_id = Column(...)`:
```python
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=True, index=True)
```
* directly after `hourly_rate = Column(...)`:
```python
    hourly_rate_max = Column(Numeric(10, 2), nullable=True)
    hide_rate = Column(Boolean, nullable=False, default=False)
    approval_mode = Column(String(20), nullable=False, default="venue_default")
```
* next to the existing `venue = relationship(...)` line:
```python
    event = relationship("ShiftEvent", back_populates="shifts")
```

---

## 2. Schemas (`backend/src/schemas.py`)

### A. `RoleRequirement`: add after `tip_pool: bool = False`:
```python
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
    approval_mode: Optional[str] = None
```

### B. `ShiftResponse`
* change `hourly_rate: Optional[float] = 25.00` → `hourly_rate: Optional[float] = None`
* add directly after `tip_pool: Optional[bool] = False`:
```python
    hourly_rate_max: Optional[float] = None
    hide_rate: Optional[bool] = False
    approval_mode: Optional[str] = "venue_default"
    event_id: Optional[UUID] = None
    event_notes: Optional[str] = None
```

### C. `EventPosition` (Phase 23 schema): add after `tip_pool: bool = False`:
```python
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
    approval_mode: str = "venue_default"
```
### D. `VenueEventResponse`: add `event_id: Optional[UUID] = None` directly after `event_key: str`.

### E. Venue positions
* `VenuePositionCreate`: add `default_rate_max: Optional[float] = None` and `hide_rate: bool = False`.
* `VenuePositionUpdate`: add `default_rate_max: Optional[float] = None` and `hide_rate: Optional[bool] = None`.
* `VenuePositionResponse`: add `default_rate_max: Optional[float] = None` and `hide_rate: bool = False`.

### F. Public schemas
* `PublicPosition`: add `default_rate_max: Optional[float] = None`.
* `PublicEventPosition`: change `hourly_rate: float` → `hourly_rate: Optional[float] = None`, and add:
```python
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
```

### G. Append at the END of the file:
```python
# ------------------------------------------------------------------------------
# Phase 25.2: Events (create / edit / detail)
# ------------------------------------------------------------------------------
class EventPositionInput(BaseModel):
    shift_id: Optional[UUID] = None          # present = update existing position, absent = new
    role_type: str
    capacity: int = 1
    hourly_rate: float
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    role_notes: Optional[str] = None
    approval_mode: str = "venue_default"     # venue_default | auto | manual


class EventCreate(BaseModel):
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    positions: List[EventPositionInput]


class EventUpdate(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    positions: List[EventPositionInput]


class EventDetailPosition(BaseModel):
    shift_id: UUID
    role_type: str
    capacity: int
    spots_filled: int
    assigned_count: int
    pending_count: int
    hourly_rate: float
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    role_notes: Optional[str] = None
    approval_mode: str = "venue_default"
    status: str


class EventDetail(BaseModel):
    id: UUID
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    positions: List[EventDetailPosition]
```

---

## 3. NEW FILE `backend/src/services/shift_events.py`
```python
"""
Phase 25.2: Create / update / describe events (one posting with 1+ positions).
Each position is a row in `shifts` linked by shifts.event_id.
"""
from datetime import timezone
from typing import Dict, Tuple

from fastapi import HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, User
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
)

VALID_APPROVAL_MODES = ("venue_default", "auto", "manual")
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PENDING_STATUSES = ("pending", "pending_manager_approval")


def _as_utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _clean(text):
    if text is None:
        return None
    text = str(text).strip()
    return text or None


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


def _apply_position(shift: Shift, p: EventPositionInput, event: ShiftEvent) -> None:
    mode = (p.approval_mode or "venue_default").lower()
    shift.title = event.title
    shift.start_time = event.start_time
    shift.end_time = event.end_time
    shift.role_type = p.role_type.strip()[:100]
    shift.capacity = int(p.capacity)
    shift.hourly_rate = p.hourly_rate
    shift.hourly_rate_max = p.hourly_rate_max if (p.hourly_rate_max is not None and p.hourly_rate_max > p.hourly_rate) else None
    shift.hide_rate = bool(p.hide_rate)
    shift.tips_eligible = bool(p.tips_eligible)
    shift.tip_pool = bool(p.tips_eligible and p.tip_pool)
    shift.description = _clean(p.role_notes)          # description = position notes
    shift.approval_mode = mode
    shift.is_shift_auto_confirm = (mode == "auto")    # kept in sync for older screens


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
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)

    existing = (await db.execute(select(Shift).where(Shift.event_id == event.id))).scalars().all()
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
        event.title = data.title.strip()[:255]
        event.start_time = _as_utc(data.start_time)
        event.end_time = _as_utc(data.end_time)
        event.notes = _clean(data.notes)

        remove_ids = [s.id for s in existing if s.id not in keep_ids]
        if remove_ids:
            await db.execute(delete(Shift).where(Shift.id.in_(remove_ids)))

        for p in data.positions:
            if p.shift_id:
                s = by_id[p.shift_id]
                _apply_position(s, p, event)
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
        select(Shift).where(Shift.event_id == event.id).order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    counts = await _request_counts(db, [s.id for s in shifts])
    return EventDetail(
        id=event.id,
        venue_id=event.venue_id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        notes=event.notes,
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
```

---

## 4. Approval engine (`backend/src/services/auto_confirm.py`)
In `evaluate_shift_request`, replace the ENTIRE "Condition 1: Shift-Level Auto-Confirm" block (the banner comment plus the `if shift.is_shift_auto_confirm: ... return RequestStatus.APPROVED, "shift_auto_confirm"`) with:
```python
    # --------------------------------------------------------------------------
    # Condition 1: Position-level approval mode (Phase 25.2)
    # --------------------------------------------------------------------------
    shift_mode = (getattr(shift, "approval_mode", None) or "venue_default").lower()
    if shift_mode == "auto" or (shift_mode == "venue_default" and shift.is_shift_auto_confirm):
        logger.info("[Auto-Confirm Engine] Position is set to instant booking.")
        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
        return RequestStatus.APPROVED, "shift_auto_confirm"
    if shift_mode == "manual":
        logger.info("[Auto-Confirm Engine] Position requires manager approval.")
        return RequestStatus.PENDING, None
```
Everything after it (venue policy, whitelist, rating, fallback) stays unchanged.

---

## 5. Shift responses with notes + hidden pay

### A. NEW FILE `backend/src/services/shift_views.py`
```python
"""
Phase 25.2: Turn Shift ORM rows into ShiftResponse objects for any viewer:
- fills event_notes (explicit query, never touches shift.event)
- removes pay for hide_rate shifts unless the viewer manages the venue, is an admin,
  or the shift id is in reveal_shift_ids (e.g. the worker is booked on it)
Shifts passed in MUST have `venue` selectinload-ed.
"""
from typing import Iterable, List, Optional, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, User, VenueManager
from src.schemas import ShiftResponse
from src.auth import normalize_role


async def viewer_managed_venue_ids(db: AsyncSession, user: Optional[User]) -> Optional[Set]:
    """None = can see every venue (admin). Empty set = none."""
    if user is None:
        return set()
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return None
    rows = (await db.execute(select(VenueManager.venue_id).where(VenueManager.user_id == user.id))).scalars().all()
    return set(rows)


async def to_shift_responses(
    db: AsyncSession,
    shifts: Iterable[Shift],
    user: Optional[User],
    reveal_shift_ids: Optional[Set] = None,
) -> List[ShiftResponse]:
    shifts = list(shifts)
    reveal = reveal_shift_ids or set()
    managed = await viewer_managed_venue_ids(db, user)

    event_ids = {s.event_id for s in shifts if s.event_id}
    notes = {}
    if event_ids:
        notes = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes).where(ShiftEvent.id.in_(event_ids))
        )).all())

    out = []
    for s in shifts:
        r = ShiftResponse.model_validate(s)
        r.event_notes = notes.get(s.event_id) if s.event_id else None
        can_see = (managed is None) or (s.venue_id in managed) or (s.id in reveal)
        if s.hide_rate and not can_see:
            r.hourly_rate = None
            r.hourly_rate_max = None
        out.append(r)
    return out
```

### B. `backend/src/routers/shifts.py`
1. Imports: add `ShiftEvent` to the `from src.models import (...)` block; add `EventCreate, EventPositionInput` to the `from src.schemas import (...)` block; add:
```python
from src.services.shift_events import create_event_with_positions
from src.services.shift_views import to_shift_responses
```
2. **`create_shift`**: keep everything up to and including the manager-authorization check. Replace from the `try:` line to the END of the function with:
```python
    try:
        if shift_in.role_requirements:
            positions = [
                EventPositionInput(
                    role_type=r.role,
                    capacity=max(1, r.quantity),
                    hourly_rate=r.hourly_rate if r.hourly_rate is not None else (shift_in.hourly_rate or 25.0),
                    hourly_rate_max=r.hourly_rate_max,
                    hide_rate=bool(r.hide_rate),
                    tips_eligible=bool(r.tips_eligible),
                    tip_pool=bool(r.tips_eligible and r.tip_pool),
                    role_notes=r.role_notes,
                    approval_mode=r.approval_mode or ("auto" if shift_in.is_shift_auto_confirm else "venue_default"),
                )
                for r in shift_in.role_requirements
            ]
        else:
            positions = [EventPositionInput(
                role_type=shift_in.role_type or "Worker",
                capacity=shift_in.capacity or 1,
                hourly_rate=shift_in.hourly_rate or 25.0,
                tips_eligible=bool(shift_in.tips_eligible),
                tip_pool=bool(shift_in.tips_eligible and shift_in.tip_pool),
                approval_mode="auto" if shift_in.is_shift_auto_confirm else "venue_default",
            )]
        event = await create_event_with_positions(db, venue, current_user, EventCreate(
            venue_id=shift_in.venue_id,
            title=shift_in.title,
            start_time=shift_in.start_time,
            end_time=shift_in.end_time,
            notes=shift_in.description,
            positions=positions,
        ))
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create shift: {str(e)}")

    first_id = await db.scalar(
        select(Shift.id).where(Shift.event_id == event.id).order_by(Shift.created_at.asc()).limit(1)
    )
    result = await db.execute(select(Shift).options(selectinload(Shift.venue)).where(Shift.id == first_id))
    return result.scalar_one()
```
3. **`get_open_shifts`**: add parameter `current_user: User = Depends(get_current_user),` and replace its final `return result.scalars().all()` with:
```python
    return await to_shift_responses(db, result.scalars().all(), current_user)
```
4. **`get_shifts`** (the `@router.get("")` list): same two changes (add `current_user` param; replace its final `return result.scalars().all()` with the `to_shift_responses` line above).
5. **`request_shift`**: replace ONLY its final line `return res.scalar_one()` with:
```python
    req_obj = res.scalar_one()
    resp = ShiftRequestResponse.model_validate(req_obj)
    if req_obj.shift is not None:
        shown = await to_shift_responses(
            db, [req_obj.shift], current_user,
            reveal_shift_ids={req_obj.shift_id} if status_val == "approved" else set(),
        )
        resp.shift = shown[0]
    return resp
```

### C. `backend/src/routers/users.py` — `/me/shifts`
1. Add imports: `ShiftRequestResponse` to the `from src.schemas import ...` line and `from src.services.shift_views import to_shift_responses`.
2. Replace the ENTIRE `get_my_shifts_alias` function with:
```python
@router.get("/me/shifts", response_model=List[ShiftRequestResponse])
async def get_my_shifts_alias(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """My requests + schedule. Hidden pay is shown only on positions I'm booked on."""
    result = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.worker_id == current_user.id)
        .order_by(ShiftRequest.created_at.desc())
    )
    reqs = result.scalars().all()
    booked = ("approved", "confirmed", "checked_in", "completed")
    shifts = [r.shift for r in reqs if r.shift is not None]
    reveal = {r.shift_id for r in reqs if (r.status or "").lower() in booked}
    shown = {s.id: s for s in await to_shift_responses(db, shifts, current_user, reveal_shift_ids=reveal)}
    out = []
    for r in reqs:
        item = ShiftRequestResponse.model_validate(r)
        if r.shift_id in shown:
            item.shift = shown[r.shift_id]
        out.append(item)
    return out
```

---

## 6. Venue + Events routes

### A. `backend/src/routers/venues.py`
1. Imports: add `ShiftEvent` to the `from src.models import (...)` block; add `from src.services.shift_views import to_shift_responses`.
2. **`get_venue_shifts`** (`GET /{venue_id}/shifts`): replace its final `return result.scalars().all()` with:
```python
    return await to_shift_responses(db, result.scalars().all(), None)
```
3. **`get_venue_events`**: replace everything from the line `events = {}` down to (and including) the function's final `return result` with:
```python
    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes = {}
    if event_ids:
        event_notes = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes).where(ShiftEvent.id.in_(event_ids))
        )).all())

    events = {}
    order = []
    for s in shifts:
        key = str(s.event_id) if s.event_id else f"{s.title}|{s.start_time.isoformat()}|{s.end_time.isoformat()}"
        if key not in events:
            events[key] = {
                "event_key": key,
                "event_id": s.event_id,
                "title": s.title or "Shift",
                "start_time": s.start_time,
                "end_time": s.end_time,
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "positions": [],
            }
            order.append(key)
        events[key]["positions"].append(EventPosition(
            shift_id=s.id,
            role_type=s.role_type or "Worker",
            hourly_rate=float(s.hourly_rate) if s.hourly_rate is not None else 0.0,
            hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
            hide_rate=bool(s.hide_rate),
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            role_notes=s.description,
            approval_mode=s.approval_mode or "venue_default",
            capacity=s.capacity if s.capacity is not None else 1,
            spots_filled=s.spots_filled if s.spots_filled is not None else 0,
            status=s.status or "OPEN",
            assigned=assigned_by_shift[s.id],
            requested=requested_by_shift[s.id],
        ))

    result = []
    for key in order:
        ev = events[key]
        positions = ev["positions"]
        result.append(VenueEventResponse(
            **ev,
            total_capacity=sum(p.capacity for p in positions),
            total_assigned=sum(len(p.assigned) for p in positions),
            total_requested=sum(len(p.requested) for p in positions),
        ))
    return result
```
4. **Position endpoints: ranges + hide**
   * `create_venue_position`: directly after the existing `default_rate` validation, add:
```python
    if pos_in.default_rate_max is not None and pos_in.default_rate_max < pos_in.default_rate:
        raise HTTPException(status_code=400, detail="The top of the pay range can't be lower than the bottom.")
    rate_max = pos_in.default_rate_max if (pos_in.default_rate_max and pos_in.default_rate_max > pos_in.default_rate) else None
```
     In the re-activate branch add `existing.default_rate_max = rate_max` and `existing.hide_rate = bool(pos_in.hide_rate)` next to `existing.default_rate = ...`. In the new `VenuePosition(...)` constructor add `default_rate_max=rate_max,` and `hide_rate=bool(pos_in.hide_rate),`.
   * `update_venue_position`: directly BEFORE `await db.commit()` inside its `try:`, add:
```python
        if pos.default_rate_max is not None and float(pos.default_rate_max) < float(pos.default_rate):
            raise HTTPException(status_code=400, detail="The top of the pay range can't be lower than the bottom.")
        if pos.default_rate_max is not None and float(pos.default_rate_max) == float(pos.default_rate):
            pos.default_rate_max = None
```
     and change that `try`'s `except Exception as e:` handling to first catch HTTPException:
```python
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update position: {str(e)}")
```

### B. `backend/src/services/venue_public.py`
1. Add `ShiftEvent` to the `from src.models import ...` line.
2. **Directory rate range** — replace the `rate_rows = (await db.execute(...)).all()` statement with:
```python
    rate_rows = (await db.execute(
        select(
            VenuePosition.venue_id,
            func.min(VenuePosition.default_rate),
            func.max(func.coalesce(VenuePosition.default_rate_max, VenuePosition.default_rate)),
        )
        .where(VenuePosition.is_active == True, VenuePosition.hide_rate == False)
        .group_by(VenuePosition.venue_id)
    )).all()
```
3. **Profile positions** — in `build_profile`, replace the `positions=[PublicPosition(...) for p in positions],` argument with:
```python
        positions=[
            PublicPosition(
                name=p.name,
                default_rate=float(p.default_rate) if (show_rates and (manage or not p.hide_rate)) else None,
                default_rate_max=(
                    float(p.default_rate_max)
                    if (p.default_rate_max is not None and show_rates and (manage or not p.hide_rate))
                    else None
                ),
                tips_eligible=bool(p.tips_eligible),
                tip_pool=bool(p.tip_pool),
            )
            for p in positions
        ],
```
4. **Public events** — in `build_public_events`:
   * directly after `now = datetime.now(timezone.utc)` add `manage = await can_manage_venue(db, user, venue.id)`.
   * replace everything from `events, order = {}, []` to the function's final `return result` with:
```python
    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes = {}
    if event_ids:
        event_notes = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes).where(ShiftEvent.id.in_(event_ids))
        )).all())

    events, order = {}, []
    for s in shifts:
        key = str(s.event_id) if s.event_id else f"{s.title}|{s.start_time.isoformat()}|{s.end_time.isoformat()}"
        if key not in events:
            events[key] = {
                "event_key": key,
                "title": s.title or "Shift",
                "start_time": s.start_time,
                "end_time": s.end_time,
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "positions": [],
            }
            order.append(key)
        cap = s.capacity if s.capacity is not None else 1
        f = filled.get(s.id, 0)
        my = mine.get(s.id)
        can_see = (not s.hide_rate) or manage or (my in ASSIGNED_STATUSES)
        events[key]["positions"].append(PublicEventPosition(
            shift_id=s.id,
            role_type=s.role_type or "Worker",
            hourly_rate=float(s.hourly_rate) if (can_see and s.hourly_rate is not None) else None,
            hourly_rate_max=float(s.hourly_rate_max) if (can_see and s.hourly_rate_max is not None) else None,
            hide_rate=bool(s.hide_rate),
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            role_notes=s.description,
            capacity=cap,
            filled=f,
            spots_left=max(0, cap - f),
            status=s.status or "OPEN",
            my_status=my,
        ))

    result = []
    for key in order:
        ev = events[key]
        result.append(PublicVenueEvent(
            **ev,
            total_capacity=sum(p.capacity for p in ev["positions"]),
            total_filled=sum(p.filled for p in ev["positions"]),
        ))
    return result
```

### C. NEW FILE `backend/src/routers/events.py`
```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, ShiftEvent
from src.schemas import EventCreate, EventUpdate, EventDetail
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.shift_events import create_event_with_positions, update_event, build_event_detail

router = APIRouter(prefix="/api/events", tags=["Events"])


async def _load_managed_event(db: AsyncSession, event_id: UUID, user: User) -> ShiftEvent:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if not await can_manage_venue(db, user, event.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return event


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: EventCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    venue = await db.scalar(select(Venue).where(Venue.id == data.venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not await can_manage_venue(db, current_user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    event = await create_event_with_positions(db, venue, current_user, data)
    return await build_event_detail(db, event)


@router.get("/{event_id}", response_model=EventDetail)
async def get_event(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    event = await _load_managed_event(db, event_id, current_user)
    return await build_event_detail(db, event)


@router.put("/{event_id}", response_model=EventDetail)
async def edit_event(
    event_id: UUID,
    data: EventUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    event = await _load_managed_event(db, event_id, current_user)
    await update_event(db, event, data)
    await db.refresh(event)
    return await build_event_detail(db, event)
```

### D. `backend/src/main.py` — ONLY these two additions
* Import (next to the other router imports): `from src.routers.events import router as events_router`
* Registration (after `app.include_router(admin_router)`): `app.include_router(events_router)`

### E. `backend/src/seed.py`
1. Add import: `from src.services.shift_events import backfill_missing_events`
2. Directly BEFORE the final `logger.info("ShiftBoard database initialization complete.")` line, add:
```python
    try:
        linked = await backfill_missing_events(db)
        if linked:
            logger.info(f"Linked {linked} shift(s) to events.")
    except Exception as e:
        await db.rollback()
        logger.warning(f"Event backfill skipped: {e}")
```

---

## 7. Frontend — shared pieces (NEW FILES)

### A. `frontend/src/components/ModalShell.jsx`
```jsx
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Phase 25.2: One modal wrapper for the whole app.
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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && closeRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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

### B. `frontend/src/components/PayLabel.jsx`
```jsx
import React from 'react';

const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** "$30/hr", "$30–$35/hr", or null when pay is hidden. */
export function payText(rate, rateMax) {
  if (rate === null || rate === undefined || rate === '') return null;
  const lo = Number(rate);
  if (Number.isNaN(lo)) return null;
  const hi = rateMax === null || rateMax === undefined || rateMax === '' ? null : Number(rateMax);
  return hi && hi > lo ? `${money(lo)}–${money(hi)}/hr` : `${money(lo)}/hr`;
}

export default function PayLabel({ rate, rateMax, className = '', hiddenText = 'Pay not listed' }) {
  const text = payText(rate, rateMax);
  return <span className={text ? className : 'text-slate-400 italic text-xs'}>{text || hiddenText}</span>;
}
```

### C. `frontend/src/utils/venueTime.js` — append at the END:
```js
/** UTC ISO -> "YYYY-MM-DDTHH:mm" in the venue's timezone, for <input type="datetime-local">. */
export function utcToZonedLocalInput(value, tz) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const m = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}T${String(Number(m.hour) % 24).padStart(2, '0')}:${m.minute}`;
}
```

---

## 8. NEW FILE `frontend/src/components/ShiftEventFormModal.jsx` (Create + Edit)
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { zonedLocalToUtcIso, utcToZonedLocalInput } from '../utils/venueTime';

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

let rowSeq = 0;
function blankRow(pos) {
  rowSeq += 1;
  return {
    key: `new-${rowSeq}`,
    shift_id: null,
    role_type: pos?.name || '',
    capacity: 1,
    hourly_rate: pos ? Number(pos.default_rate).toFixed(2) : '25.00',
    hourly_rate_max: pos?.default_rate_max != null ? Number(pos.default_rate_max).toFixed(2) : '',
    hide_rate: !!pos?.hide_rate,
    tips_eligible: !!pos?.tips_eligible,
    tip_pool: !!pos?.tip_pool,
    role_notes: '',
    approval_mode: 'venue_default',
    booked: 0,
    pending: 0,
    showNotes: false,
  };
}

export default function ShiftEventFormModal({ mode = 'create', venue, positions = [], eventId = null, onClose, onSaved }) {
  const tz = venue?.timezone;
  const isEdit = mode === 'edit' && !!eventId;
  const activePositions = positions.filter((p) => p.is_active !== false);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState(() => (isEdit ? [] : [blankRow(activePositions[0])]));

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

  const updateRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changeRole = (key, name) => {
    const pos = activePositions.find((p) => p.name === name);
    if (!pos) {
      updateRow(key, { role_type: name });
      return;
    }
    updateRow(key, {
      role_type: name,
      hourly_rate: Number(pos.default_rate).toFixed(2),
      hourly_rate_max: pos.default_rate_max != null ? Number(pos.default_rate_max).toFixed(2) : '',
      hide_rate: !!pos.hide_rate,
      tips_eligible: !!pos.tips_eligible,
      tip_pool: !!pos.tip_pool,
    });
  };

  const addRow = () => {
    const used = new Set(rows.map((r) => r.role_type));
    const next = activePositions.find((p) => !used.has(p.name)) || activePositions[0];
    setRows((rs) => [...rs, blankRow(next)]);
  };

  const removeRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key));

  const eventApproval = useMemo(() => {
    const modes = new Set(rows.map((r) => r.approval_mode));
    return modes.size === 1 ? [...modes][0] : 'mixed';
  }, [rows]);

  const setAllApproval = (value) => {
    if (value === 'mixed') return;
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
      if (!name) return setError('Every row needs a position.');
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

            {rows.map((r) => {
              const locked = (r.booked || 0) + (r.pending || 0) > 0;
              const names = activePositions.map((p) => p.name);
              return (
                <div key={r.key} className="p-3 rounded-xl border border-slate-700 bg-slate-800/40 space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[10rem]">
                      <label className={labelCls}>Position</label>
                      {names.length > 0 ? (
                        <select value={r.role_type} onChange={(e) => changeRole(r.key, e.target.value)} className={inputCls}>
                          {!names.includes(r.role_type) && r.role_type && <option value={r.role_type}>{r.role_type}</option>}
                          {names.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={r.role_type} onChange={(e) => updateRow(r.key, { role_type: e.target.value })} className={inputCls} placeholder="Bartender" />
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

## 9. REPLACE FILE `frontend/src/components/VenueSettingsModal.jsx` (wide, two columns)
```jsx
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
```

---

## 10. REPLACE FILE `frontend/src/components/EventRosterModal.jsx` (Details view)
```jsx
import React from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText } from 'lucide-react';
import ModalShell from './ModalShell';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
import PayLabel from './PayLabel';
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const APPROVAL_LABEL = { venue_default: 'Venue default', auto: 'Instant booking', manual: 'Needs approval' };

function assignedChip(person) {
  if (person.clocked_out || person.status === 'completed') return { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' };
  if (person.clocked_in || person.status === 'checked_in') return { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
  return { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
}

export default function EventRosterModal({
  event, onClose, reliabilityMap = {}, onApprove, onDeny, onOpenBoard, onEdit, actionLoading, timeZone,
}) {
  if (!event) return null;

  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{fmtDate(event.start_time, timeZone)} • {fmtTimeRange(event.start_time, event.end_time, timeZone)}</span>
      <span>Staffed <strong className="text-white">{event.total_assigned}/{event.total_capacity}</strong></span>
      {event.total_requested > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
          {event.total_requested} awaiting review
        </span>
      )}
    </span>
  );

  const headerExtra = (event.description || (onEdit && event.event_id)) ? (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
      {event.description && (
        <div className="flex-1 text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-2.5 whitespace-pre-line">
          <span className="text-slate-500 font-semibold inline-flex items-center gap-1 mr-1"><FileText className="w-3 h-3" /> Event notes:</span>
          {event.description}
        </div>
      )}
      {onEdit && event.event_id && (
        <button type="button" onClick={() => onEdit(event.event_id)}
          className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 text-xs font-bold inline-flex items-center gap-1.5 self-start">
          <Pencil className="w-3.5 h-3.5" /> Edit this shift
        </button>
      )}
    </div>
  ) : null;

  return (
    <ModalShell
      title={event.title}
      subtitle={subtitle}
      icon={<Users className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      headerExtra={headerExtra}
    >
      <div className="space-y-5">
        {event.positions.map((pos) => {
          const isFull = pos.assigned.length >= pos.capacity;
          return (
            <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                  <PayLabel rate={pos.hourly_rate} rateMax={pos.hourly_rate_max} className="text-xs text-emerald-400 font-semibold" />
                  {pos.hide_rate && <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><EyeOff className="w-3 h-3" /> hidden from workers</span>}
                  <TipBadge shift={pos} />
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                    {APPROVAL_LABEL[pos.approval_mode] || 'Venue default'}
                  </span>
                  <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>{pos.assigned.length} / {pos.capacity} filled</span>
                </div>
                {onOpenBoard && (
                  <button type="button" onClick={() => onOpenBoard({ id: pos.shift_id, title: event.title, role_type: pos.role_type })}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-xs border border-slate-700 inline-flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Board
                  </button>
                )}
              </div>

              <div className="p-4 space-y-4">
                {pos.role_notes && (
                  <p className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-2 whitespace-pre-line">
                    <span className="text-slate-500 font-semibold">{pos.role_type} notes: </span>{pos.role_notes}
                  </p>
                )}

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Assigned ({pos.assigned.length})</div>
                  {pos.assigned.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No one assigned yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {pos.assigned.map((p) => {
                        const chip = assignedChip(p);
                        return (
                          <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                            <div>
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
                                {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Mail className="w-3 h-3" />{p.email}</a>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-amber-400" /> Requested ({pos.requested.length})
                  </div>
                  {pos.requested.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No pending requests for this position.</p>
                  ) : (
                    <div className="space-y-2">
                      {pos.requested.map((p) => {
                        const approving = actionLoading === `approve-${p.request_id}`;
                        const denying = actionLoading === `deny-${p.request_id}`;
                        return (
                          <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-500/5 rounded-lg border border-amber-500/20">
                            <div>
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">Requested {p.requested_at ? fmtDateTime(p.requested_at, timeZone) : ''}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}
```

---

## 11. `frontend/src/components/PostedShiftsBoard.jsx` — targeted edits
1. Imports: add `import PayLabel from './PayLabel';` and add `Pencil`, `Eye`, `EyeOff` to the `lucide-react` import list.
2. Add `onEditEvent` to the destructured props (after `onOpenBoard,`).
3. Replace the single **View Roster** `<button ...>…<span>View Roster</span></button>` in each event card header with:
```jsx
                        <div className="flex items-center gap-2 self-start md:self-auto">
                          <button
                            type="button"
                            onClick={() => setSelectedKey(ev.event_key)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white font-semibold text-xs border border-emerald-600/30 transition inline-flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" /> Details
                          </button>
                          {onEditEvent && ev.event_id && (
                            <button
                              type="button"
                              onClick={() => onEditEvent(ev.event_id)}
                              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 font-semibold text-xs border border-amber-500/30 transition inline-flex items-center gap-1.5"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                          )}
                        </div>
```
4. Directly under the event title `<div className="text-sm font-bold text-white">{ev.title}</div>` add:
```jsx
                          {ev.description && <div className="text-[11px] text-slate-400 line-clamp-1">{ev.description}</div>}
```
5. In each position row, replace
```jsx
                                <span>${Number(pos.hourly_rate).toFixed(2)}/hr</span>
```
with:
```jsx
                                <PayLabel rate={pos.hourly_rate} rateMax={pos.hourly_rate_max} />
                                {pos.hide_rate && <EyeOff className="w-3 h-3 text-slate-500" title="Pay hidden from workers" />}
                                {pos.approval_mode === 'auto' && <span className="text-[10px] text-emerald-400">Instant</span>}
                                {pos.approval_mode === 'manual' && <span className="text-[10px] text-amber-400">Needs OK</span>}
```
6. In the `<EventRosterModal ... />` element add the prop:
```jsx
          onEdit={onEditEvent ? (id) => { setSelectedKey(null); onEditEvent(id); } : undefined}
```

---

## 12. Other frontend edits

### A. `frontend/src/pages/VenueManagerDashboard.jsx`
1. Imports: add
```jsx
import ShiftEventFormModal from '../components/ShiftEventFormModal';
import PayLabel from '../components/PayLabel';
```
2. State (below `const [showVenueSettings, setShowVenueSettings] = useState(false);`):
```jsx
  const [eventForm, setEventForm] = useState(null); // { mode: 'create' } | { mode: 'edit', eventId }
```
3. Header **Create New Shift** button: change `onClick={openCreateShiftModal}` → `onClick={() => setEventForm({ mode: 'create' })}` and its label text `Create New Shift` → `Post a Shift`.
4. **Delete** the entire old create modal: from the comment `{/* Modal: Shift Creation */}` through the end of that `{showCreateModal && ( ... )}` block (ends right before `{/* Discussion Board Modal */}`). Leave the old handlers/state in place (unused is fine).
5. Replace BOTH occurrences of `<span>${shift?.hourly_rate}/hr</span>` with `<PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />`.
6. On the `<PostedShiftsBoard ... />` element add the prop `onEditEvent={(id) => setEventForm({ mode: 'edit', eventId: id })}`.
7. Render the form directly BEFORE `{/* Discussion Board Modal */}`:
```jsx
      {eventForm && venueDetails && (
        <ShiftEventFormModal
          mode={eventForm.mode}
          eventId={eventForm.eventId}
          venue={venueDetails}
          positions={venuePositions}
          onClose={() => setEventForm(null)}
          onSaved={() => {
            const wasEdit = eventForm.mode === 'edit';
            setEventForm(null);
            setNotification({ type: 'success', message: wasEdit ? 'Shift updated.' : 'Shift posted.' });
            fetchVenueData(currentVenueId);
          }}
        />
      )}
```

### B. `frontend/src/pages/WorkerDashboard.jsx`
1. Add `import PayLabel from '../components/PayLabel';`
2. **Find Shifts card pay** — replace:
```jsx
                            <div className="flex items-center space-x-1">
                              <span className="text-lg font-black text-emerald-400">
                                ${Number(shift.hourly_rate).toFixed(2)}
                              </span>
                              <span className="text-xs text-slate-400">/hr</span>
                            </div>
```
with:
```jsx
                            <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} className="text-lg font-black text-emerald-400" />
```
3. **Find Shifts card notes** — directly after the closing `</p>` of the address line (the `<p>` that contains `<MapPin`), add:
```jsx
                        {(shift.event_notes || shift.description) && (
                          <div className="text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg p-2 mb-3 space-y-1">
                            {shift.event_notes && <p className="line-clamp-2"><span className="text-slate-500">Event: </span>{shift.event_notes}</p>}
                            {shift.description && <p className="line-clamp-2"><span className="text-slate-500">{shift.role_type}: </span>{shift.description}</p>}
                          </div>
                        )}
```
4. Replace `<span>${shift?.hourly_rate}/hr</span>` with `<PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />`.
5. Replace `<span className="text-emerald-400 font-semibold">${shift?.hourly_rate}/hr</span>` with `<PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} className="text-emerald-400 font-semibold" />`.
6. Replace `• ${shiftToDrop.shift.hourly_rate}/hr` with `• <PayLabel rate={shiftToDrop.shift.hourly_rate} rateMax={shiftToDrop.shift.hourly_rate_max} />`.
7. **My Schedule card notes** — in the **My Schedule** tab card, directly after the `<p className="text-xs text-slate-500">` element that renders `fmtDateTime(shift?.start_time, shift?.venue?.timezone)` (the one WITHOUT `mt-1`), add:
```jsx
                      {(shift?.venue?.default_shift_notes || shift?.event_notes || shift?.description) && (
                        <details className="mt-2 text-[11px] text-slate-400">
                          <summary className="cursor-pointer select-none text-emerald-400">Shift notes</summary>
                          <div className="mt-1.5 space-y-1.5 bg-slate-950/60 border border-slate-800 rounded-lg p-2">
                            {shift?.venue?.default_shift_notes && <p className="whitespace-pre-line"><span className="text-slate-500">Venue: </span>{shift.venue.default_shift_notes}</p>}
                            {shift?.event_notes && <p className="whitespace-pre-line"><span className="text-slate-500">Event: </span>{shift.event_notes}</p>}
                            {shift?.description && <p className="whitespace-pre-line"><span className="text-slate-500">{shift.role_type}: </span>{shift.description}</p>}
                          </div>
                        </details>
                      )}
```

### C. `frontend/src/components/TransferModal.jsx`
Add `import PayLabel from './PayLabel';` and replace `• ${currentShiftObj.hourly_rate}/hr` with `• <PayLabel rate={currentShiftObj.hourly_rate} rateMax={currentShiftObj.hourly_rate_max} />`.

### D. `frontend/src/pages/VenueProfile.jsx`
1. Add `import PayLabel from '../components/PayLabel';`
2. Positions list: replace
`{p.default_rate != null && <span className="text-sm text-emerald-400 font-bold">${p.default_rate.toFixed(2)}/hr</span>}`
with
`{p.default_rate != null && <PayLabel rate={p.default_rate} rateMax={p.default_rate_max} className="text-sm text-emerald-400 font-bold" />}`
3. Event positions: replace
`<span className="text-sm text-emerald-400 font-semibold">${p.hourly_rate.toFixed(2)}/hr</span>`
with
`<PayLabel rate={p.hourly_rate} rateMax={p.hourly_rate_max} className="text-sm text-emerald-400 font-semibold" hiddenText="Pay shared when booked" />`
4. Directly under the event title `<div className="text-sm font-bold text-white">{ev.title}</div>` add:
`{ev.description && <div className="text-[11px] text-slate-400 whitespace-pre-line">{ev.description}</div>}`
5. Inside each position row's left `<div className="flex flex-wrap items-center gap-2">`, after the `filled` span, add:
`{p.role_notes && <span className="w-full text-[11px] text-slate-400">{p.role_notes}</span>}`

### E. `frontend/src/components/Navbar.jsx` — labels only
* `label: isPlatformAdmin ? 'Worker View' : 'My Shifts',` → `label: 'Worker',`
* `label: isPlatformAdmin ? 'Venue Manager View' : 'My Venue',` → `label: 'Venue Manager',`
* `label: 'Platform Admin',` → `label: 'Admin',`

---

## 13. Rebuild & Verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data** (run once, then rebuild):
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
CREATE TABLE IF NOT EXISTS shift_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_event_time CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_shift_events_venue ON shift_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_shift_events_start ON shift_events(start_time);
DROP TRIGGER IF EXISTS trg_shift_events_updated_at ON shift_events;
CREATE TRIGGER trg_shift_events_updated_at BEFORE UPDATE ON shift_events FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS hourly_rate_max NUMERIC(10,2);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS hide_rate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default';
CREATE INDEX IF NOT EXISTS idx_shifts_event ON shifts(event_id);
ALTER TABLE venue_positions ADD COLUMN IF NOT EXISTS default_rate_max NUMERIC(10,2);
ALTER TABLE venue_positions ADD COLUMN IF NOT EXISTS hide_rate BOOLEAN NOT NULL DEFAULT FALSE;
SQL
docker compose up -d --build backend frontend
```
(On startup the backend links every existing shift to an event automatically via `backfill_missing_events`.)

Verify:
1. **Modals:** open Venue Settings on a laptop, a small laptop window, and a phone. It's wide with two columns on desktop and one column on phones. The whole modal scrolls, the header (with tabs) and Save/Cancel footer stay pinned, and nothing is cut off. Esc closes it. Same for Post a Shift and Details.
2. **Post a shift:** "Post a Shift" → left: name, start/end (venue time), event notes, venue notes preview, "Approval for every position"; right: positions. Add Bartender ×2 $30–$35 with **Needs my approval** + note "Bring a wine key", and Server ×3 $25 **Instant booking**. Publish.
3. `SELECT title, notes FROM shift_events ORDER BY created_at DESC LIMIT 1;` shows the event and its notes; `SELECT role_type, event_id, hourly_rate, hourly_rate_max, approval_mode, description FROM shifts ORDER BY created_at DESC LIMIT 2;` shows both positions linked to it.
4. **Per-position approval:** as a worker NOT on the team, request Server → **Confirmed** instantly; request Bartender → **Pending**.
5. **Board:** each event has **Details** and **Edit**. Details shows event notes, position notes, pay range, approval badge, assigned/requested. **Edit** opens the same form filled in; change the time and add a Barback → Save → board updates. Try removing the Bartender row while someone is pending → the trash button is disabled; lowering Server spots below the number booked shows an error.
6. **Hidden pay:** edit a position → check "Hide pay from workers" → Save. As a worker: Find Shifts shows "Pay not listed"; the network response for `/api/shifts/open` has `"hourly_rate": null` for that shift. After the manager approves them, My Schedule shows the pay. The manager always sees it (with a hidden-eye icon).
7. **Venue positions:** Venue Settings → Positions & pay → set Bartender $30 to $38, Hide pay → Save → Post a Shift pre-fills $30–$38 and "Hide pay" when Bartender is picked. The public venue page and directory don't show that position's pay.
8. **Notes on worker side:** Find Shifts card shows event + position notes; My Schedule → "Shift notes" shows venue + event + position notes.
9. **Navbar** reads Worker / Venue Manager / Admin / Venues.
10. Old flows still work: approvals queue, transfers, clock in/out, payroll CSV, public venue pages.