# Phase 25: Venue Profiles, Positions & Rates, Approval Policy, and Venue-Local Time

Makes venues fully editable and gives each venue its own list of positions with default pay. Built on the CURRENT code (Phases 20–24 are implemented).

1. **Editable venue profile** — by platform admins (Admin Panel → Venues → pencil) and by the venue's own managers (Venue dashboard → **Venue Settings**). New fields: timezone, phone, arrival instructions (parking / which door), dress code, default notes for staff, and an **approval policy** in plain language.
2. **Location that actually works** — "Use my current location" button (manager standing in the venue sets lat/lng with one tap) plus manual lat/lng and a "check on map" link. Required before geofenced clock-in (Phase 31) can work.
3. **Positions & default rates per venue** — e.g. Bartender $30 + pooled tips, AV Tech $32. The Create Shift form's position dropdown comes from this list and pre-fills rate and tips. Every new venue gets 5 starter positions.
4. **Approval policy** replaces the confusing "auto-approve rating" as the main control:
   * `manual` — the manager approves every request.
   * `team_auto` — people on the venue's team (whitelist) are booked instantly, everyone else waits for approval. **(default — matches today's behavior)**
   * `everyone_auto` — anyone who requests is booked instantly.
   The optional rating threshold and per-shift "instant booking" still work on top of this.
5. **Venue-local time** — shift times are entered and displayed in the **venue's** timezone (not the viewer's phone), with the zone abbreviation shown (e.g. "7:00 PM – 1:00 AM EDT").
6. **Bug fix** — the Admin Panel venues table reads `shifts_count / managers_count / workers_count`, but the API returns `total_shifts / total_managers / assigned_workers_count`, so every count shows 0.

⚠️ **SCHEMA CHANGE — destructive rebuild required** (see §10).

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything in `.secrets/`, `docker-compose.yml`, `backend/src/auth.py`, `backend/src/main.py`, `backend/src/routers/auth.py`, `backend/src/serializers.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/src/components/Navbar.jsx`, `frontend/src/App.jsx`, `frontend/src/pages/LoginPage.jsx`.
* **No native PostgreSQL ENUMs.** `approval_policy` is `VARCHAR(20)`, validated in Python.
* Schema changes go in BOTH `database/init.sql` AND `backend/src/models.py`.
* NEVER call `UserResponse.model_validate(<User ORM>)`; never read ORM relationships that weren't `selectinload`-ed in the same query. The new `Venue.positions` relationship must NEVER be read directly — always query `VenuePosition` explicitly.
* All backend datetime comparisons use `datetime.now(timezone.utc)`. The backend stores/returns UTC; venue timezone is used for DISPLAY and for converting the manager's typed-in local time (frontend §6).
* New files are created with the EXACT content given. Do not add npm packages (use the built-in `Intl` API for timezones).

---

## 1. Database Schema

### A. `database/init.sql`

**Venues** — in `CREATE TABLE venues (...)`, add these lines directly after `logo_url TEXT,`:
```sql
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    phone VARCHAR(30),
    arrival_instructions TEXT,
    dress_code TEXT,
    default_shift_notes TEXT,
    approval_policy VARCHAR(20) NOT NULL DEFAULT 'team_auto',
```

**Venue positions** — directly after the `venue_whitelists` section (after `CREATE INDEX idx_whitelist_worker ...;`), add:
```sql
-- ------------------------------------------------------------------------------
-- 4b. Venue Positions (Phase 25): per-venue roles with default pay
-- ------------------------------------------------------------------------------
CREATE TABLE venue_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    default_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
    tips_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    tip_pool BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_position_name UNIQUE (venue_id, name),
    CONSTRAINT chk_position_tip_pool CHECK (tip_pool = FALSE OR tips_eligible = TRUE),
    CONSTRAINT chk_position_rate CHECK (default_rate > 0)
);

CREATE INDEX idx_venue_positions_venue ON venue_positions(venue_id);
```

**Trigger** — next to the other `CREATE TRIGGER trg_..._updated_at` lines, add:
```sql
CREATE TRIGGER trg_venue_positions_updated_at BEFORE UPDATE ON venue_positions FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
```

### B. `backend/src/models.py`

In `class Venue`, directly after `logo_url = Column(Text, nullable=True)`:
```python
    timezone = Column(String(64), nullable=False, default="America/New_York")
    phone = Column(String(30), nullable=True)
    arrival_instructions = Column(Text, nullable=True)
    dress_code = Column(Text, nullable=True)
    default_shift_notes = Column(Text, nullable=True)
    approval_policy = Column(String(20), nullable=False, default="team_auto")
```
In `class Venue`'s `# Relationships` block, add:
```python
    positions = relationship("VenuePosition", back_populates="venue", cascade="all, delete-orphan")
```

Add a new model directly AFTER `class VenueWhitelist` (use the same imports already at the top of the file; add `UniqueConstraint`/`CheckConstraint` to the `from sqlalchemy import (...)` list only if missing):
```python
class VenuePosition(Base):
    __tablename__ = "venue_positions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    default_rate = Column(Numeric(10, 2), nullable=False, default=25.00)
    tips_eligible = Column(Boolean, nullable=False, default=False)
    tip_pool = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("venue_id", "name", name="uq_venue_position_name"),
        CheckConstraint("tip_pool = FALSE OR tips_eligible = TRUE", name="chk_position_tip_pool"),
        CheckConstraint("default_rate > 0", name="chk_position_rate"),
    )

    venue = relationship("Venue", back_populates="positions")
```

### C. `backend/requirements.txt`
Append (guarantees timezone data inside the slim Python image):
```
tzdata>=2024.1
```

---

## 2. Schemas (`backend/src/schemas.py`)

### A. Venue schemas — replace `VenueBase`, `VenueCreate`, and `VenueUpdateSettings` with:
```python
class VenueBase(BaseModel):
    name: str
    address: str
    lat: float
    lng: float
    geofence_radius_meters: int = 100
    auto_approve_rating_threshold: Optional[float] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: str = "America/New_York"
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: str = "team_auto"

class VenueCreate(BaseModel):
    name: str
    address: str
    lat: Optional[float] = 40.7128
    lng: Optional[float] = -74.0060
    geofence_radius_meters: Optional[int] = 100
    auto_approve_rating_threshold: Optional[float] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: Optional[str] = "America/New_York"
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: Optional[str] = "team_auto"
    manager_email: Optional[EmailStr] = None
    initial_manager_email: Optional[EmailStr] = None

class VenueUpdateSettings(BaseModel):
    """Phase 25: partial update — only fields that are sent are changed."""
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    geofence_radius_meters: Optional[int] = None
    auto_approve_rating_threshold: Optional[float] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: Optional[str] = None
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: Optional[str] = None
```
`VenueResponse(VenueBase)` stays as is (it inherits the new fields).

### B. Append at the END of the file:
```python
# ------------------------------------------------------------------------------
# Phase 25: Venue positions
# ------------------------------------------------------------------------------
class VenuePositionCreate(BaseModel):
    name: str
    default_rate: float
    tips_eligible: bool = False
    tip_pool: bool = False


class VenuePositionUpdate(BaseModel):
    name: Optional[str] = None
    default_rate: Optional[float] = None
    tips_eligible: Optional[bool] = None
    tip_pool: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class VenuePositionResponse(BaseModel):
    id: UUID
    venue_id: UUID
    name: str
    default_rate: float
    tips_eligible: bool
    tip_pool: bool
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True
```

---

## 3. Services

### A. NEW FILE `backend/src/services/venue_positions.py`
```python
"""Phase 25: Default positions and venue field validation."""
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import VenuePosition

# (name, default_rate, tips_eligible, tip_pool)
DEFAULT_POSITIONS = [
    ("Bartender", 30.00, True, True),
    ("Server", 25.00, True, False),
    ("Barback", 22.00, True, True),
    ("Dishwasher", 20.00, False, False),
    ("AV Tech", 32.00, False, False),
]

VALID_APPROVAL_POLICIES = ("manual", "team_auto", "everyone_auto")
NOT_NULL_VENUE_FIELDS = ("name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy")
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
)


async def ensure_default_positions(db: AsyncSession, venue_id) -> None:
    """Adds the starter positions if the venue has none. Caller commits."""
    existing = await db.scalar(select(func.count(VenuePosition.id)).where(VenuePosition.venue_id == venue_id))
    if existing:
        return
    for idx, (name, rate, tips, pool) in enumerate(DEFAULT_POSITIONS):
        db.add(VenuePosition(
            venue_id=venue_id, name=name, default_rate=rate,
            tips_eligible=tips, tip_pool=(tips and pool), sort_order=idx, is_active=True,
        ))


def clean_venue_payload(data: dict) -> dict:
    """Normalizes and validates venue fields in-place. Raises HTTPException(400) on bad input."""
    for key in NOT_NULL_VENUE_FIELDS:
        if key in data and data[key] is None:
            data.pop(key)

    for key in TEXT_VENUE_FIELDS:
        if key in data and isinstance(data[key], str):
            data[key] = data[key].strip()
            if data[key] == "" and key not in ("name", "address", "timezone", "approval_policy"):
                data[key] = None

    if "name" in data and not data["name"]:
        raise HTTPException(status_code=400, detail="Venue name can't be empty.")
    if "address" in data and not data["address"]:
        raise HTTPException(status_code=400, detail="Venue address can't be empty.")

    if "timezone" in data:
        try:
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Unknown timezone '{data['timezone']}'.")

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Approval policy must be manual, team_auto, or everyone_auto.")

    if "lat" in data and not (-90 <= float(data["lat"]) <= 90):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90.")
    if "lng" in data and not (-180 <= float(data["lng"]) <= 180):
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180.")
    if "geofence_radius_meters" in data and not (25 <= int(data["geofence_radius_meters"]) <= 5000):
        raise HTTPException(status_code=400, detail="Clock-in radius must be between 25 and 5000 meters.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
        if not (1.0 <= t <= 5.0):
            raise HTTPException(status_code=400, detail="Auto-approve rating must be between 1 and 5.")
    return data
```

### B. `backend/src/services/auto_confirm.py` — approval policy
In `evaluate_shift_request`:
1. Update the docstring order list to:
```
    1. Shift-level instant booking (shift.is_shift_auto_confirm)      -> APPROVED "shift_auto_confirm"
    2. Venue policy 'everyone_auto'                                   -> APPROVED "venue_everyone_auto"
    3. Venue policy 'team_auto' AND worker on venue whitelist         -> APPROVED "venue_whitelist"
    4. Rating threshold (worker has >= 1 rating and meets threshold)  -> APPROVED "rating_threshold"
    5. Otherwise                                                      -> PENDING
```
2. Directly AFTER the Condition 1 block (`if shift.is_shift_auto_confirm: ... return RequestStatus.APPROVED, "shift_auto_confirm"`) and BEFORE the `# Condition 2: Venue Whitelist` banner, insert:
```python
    policy = (getattr(venue, "approval_policy", None) or "team_auto").lower()

    # --------------------------------------------------------------------------
    # Condition 1b: Venue policy - everyone is booked instantly
    # --------------------------------------------------------------------------
    if policy == "everyone_auto":
        logger.info("[Auto-Confirm Engine] Venue policy is everyone_auto.")
        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
        return RequestStatus.APPROVED, "venue_everyone_auto"
```
3. In the Condition 2 (whitelist) block, change the `if whitelist_entry:` line to:
```python
    if whitelist_entry and policy == "team_auto":
```
Leave Conditions 3 (rating) and 4 (fallback) unchanged.

---

## 4. Venue Endpoints (`backend/src/routers/venues.py`)

### A. Imports
* Add `VenuePosition` to the `from src.models import (...)` block.
* Add `VenuePositionCreate, VenuePositionUpdate, VenuePositionResponse` to the `from src.schemas import (...)` block.
* Add: `from src.services.venue_positions import ensure_default_positions, clean_venue_payload`

### B. `create_venue` — two edits (keep everything else from Phase 24)
1. Directly after `venue_dict = venue_in.model_dump(exclude={"manager_email", "initial_manager_email"})`, add:
```python
        venue_dict = clean_venue_payload({k: v for k, v in venue_dict.items() if v is not None or k == "auto_approve_rating_threshold"})
```
2. Directly after `await db.flush()` (the one right after `db.add(venue)`), add:
```python
        await ensure_default_positions(db, venue.id)
```

### C. Replace the ENTIRE `update_venue_settings` function with:
```python
@router.put("/{venue_id}/settings", response_model=VenueResponse)
async def update_venue_settings(
    venue_id: UUID,
    settings_in: VenueUpdateSettings,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25: Edit the venue profile. Admins: any venue. Managers: venues they manage."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    data = clean_venue_payload(settings_in.model_dump(exclude_unset=True))
    try:
        for field, value in data.items():
            setattr(venue, field, value)
        await db.commit()
        await db.refresh(venue)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update venue: {str(e)}")
    return venue
```

### D. New position endpoints — add directly AFTER `update_venue_settings`:
```python
# ------------------------------------------------------------------------------
# Phase 25: Venue positions (roles + default pay)
# ------------------------------------------------------------------------------
@router.get("/{venue_id}/positions", response_model=List[VenuePositionResponse])
async def list_venue_positions(
    venue_id: UUID,
    include_inactive: bool = Query(False),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    await verify_venue_manager_access(venue_id, current_user, db)
    q = select(VenuePosition).where(VenuePosition.venue_id == venue_id)
    if not include_inactive:
        q = q.where(VenuePosition.is_active == True)
    q = q.order_by(VenuePosition.sort_order.asc(), VenuePosition.name.asc())
    return (await db.execute(q)).scalars().all()


@router.post("/{venue_id}/positions", response_model=VenuePositionResponse, status_code=status.HTTP_201_CREATED)
async def create_venue_position(
    venue_id: UUID,
    pos_in: VenuePositionCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    await verify_venue_manager_access(venue_id, current_user, db)
    name = (pos_in.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Position name can't be empty.")
    if pos_in.default_rate is None or pos_in.default_rate <= 0:
        raise HTTPException(status_code=400, detail="Default rate must be greater than $0.")

    existing = await db.scalar(
        select(VenuePosition).where(
            VenuePosition.venue_id == venue_id,
            func.lower(VenuePosition.name) == name.lower()
        )
    )
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=409, detail=f"'{existing.name}' already exists at this venue.")
        # Re-activate a previously removed position instead of duplicating it
        try:
            existing.is_active = True
            existing.default_rate = pos_in.default_rate
            existing.tips_eligible = bool(pos_in.tips_eligible)
            existing.tip_pool = bool(pos_in.tips_eligible and pos_in.tip_pool)
            await db.commit()
            await db.refresh(existing)
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to restore position: {str(e)}")
        return existing

    try:
        max_order = await db.scalar(
            select(func.coalesce(func.max(VenuePosition.sort_order), -1)).where(VenuePosition.venue_id == venue_id)
        )
        pos = VenuePosition(
            venue_id=venue_id,
            name=name[:100],
            default_rate=pos_in.default_rate,
            tips_eligible=bool(pos_in.tips_eligible),
            tip_pool=bool(pos_in.tips_eligible and pos_in.tip_pool),
            sort_order=int(max_order) + 1,
            is_active=True,
        )
        db.add(pos)
        await db.commit()
        await db.refresh(pos)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add position: {str(e)}")
    return pos


@router.patch("/{venue_id}/positions/{position_id}", response_model=VenuePositionResponse)
async def update_venue_position(
    venue_id: UUID,
    position_id: UUID,
    pos_in: VenuePositionUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    await verify_venue_manager_access(venue_id, current_user, db)
    pos = await db.scalar(
        select(VenuePosition).where(VenuePosition.id == position_id, VenuePosition.venue_id == venue_id)
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found.")

    data = pos_in.model_dump(exclude_unset=True)
    if "name" in data:
        new_name = (data["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Position name can't be empty.")
        clash = await db.scalar(
            select(VenuePosition).where(
                VenuePosition.venue_id == venue_id,
                func.lower(VenuePosition.name) == new_name.lower(),
                VenuePosition.id != position_id
            )
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"'{clash.name}' already exists at this venue.")
        data["name"] = new_name[:100]
    if "default_rate" in data and (data["default_rate"] is None or data["default_rate"] <= 0):
        raise HTTPException(status_code=400, detail="Default rate must be greater than $0.")

    try:
        for field, value in data.items():
            if value is None and field in ("tips_eligible", "tip_pool", "is_active", "sort_order"):
                continue
            setattr(pos, field, value)
        if not pos.tips_eligible:
            pos.tip_pool = False
        await db.commit()
        await db.refresh(pos)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update position: {str(e)}")
    return pos


@router.delete("/{venue_id}/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_venue_position(
    venue_id: UUID,
    position_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Soft-remove: hides the position from the Create Shift list. Existing shifts are untouched."""
    await verify_venue_manager_access(venue_id, current_user, db)
    pos = await db.scalar(
        select(VenuePosition).where(VenuePosition.id == position_id, VenuePosition.venue_id == venue_id)
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found.")
    try:
        pos.is_active = False
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove position: {str(e)}")
    return None
```

---

## 5. Other backend touch-ups

### A. `backend/src/routers/admin.py` — `get_admin_venues`
In the `VenueResponse(...)` constructor, add these arguments directly after `logo_url=v.logo_url,`:
```python
            timezone=v.timezone or "America/New_York",
            phone=v.phone,
            arrival_instructions=v.arrival_instructions,
            dress_code=v.dress_code,
            default_shift_notes=v.default_shift_notes,
            approval_policy=v.approval_policy or "team_auto",
```

### B. `backend/src/routers/shifts.py` — `create_shift`
Inside the `try:` block, in BOTH `Shift(...)` constructors, change `description=shift_in.description,` to:
```python
                    description=shift_in.description or venue.default_shift_notes,
```
(match each constructor's existing indentation). Nothing else changes.

### C. `backend/src/seed.py`
1. Add import near the top: `from src.services.venue_positions import ensure_default_positions`
2. In the demo venue block, directly after `await db.refresh(demo_venue)` (inside `if not demo_venue:`), add:
```python
            await ensure_default_positions(db, demo_venue.id)
            await db.commit()
```
3. In the additional venue block, directly after `await db.refresh(venue1)`, add:
```python
            await ensure_default_positions(db, venue1.id)
            await db.commit()
```
Do not change anything else in `seed.py`.

---

## 6. Frontend — time helpers (NEW FILE `frontend/src/utils/venueTime.js`)
```js
/**
 * Phase 25: Venue-local time helpers (built-in Intl only, no extra packages).
 * All values from the API are UTC ISO strings; `tz` is the venue's IANA zone, e.g. 'America/New_York'.
 * If tz is missing, the viewer's device timezone is used.
 */

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'America/Vancouver', label: 'Pacific (Vancouver)' },
  { value: 'Europe/London', label: 'UK (London)' },
  { value: 'UTC', label: 'UTC' },
];

function fmt(value, tz, options) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat([], { ...options, timeZone: tz || undefined }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat([], options).format(d);
  }
}

/** "Fri, Oct 3" */
export const fmtDate = (value, tz) => fmt(value, tz, { weekday: 'short', month: 'short', day: 'numeric' });

/** "Oct 3" */
export const fmtShortDate = (value, tz) => fmt(value, tz, { month: 'short', day: 'numeric' });

/** "Friday, October 3, 2026" */
export const fmtLongDate = (value, tz) =>
  fmt(value, tz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

/** "7:00 PM" */
export const fmtTime = (value, tz) => fmt(value, tz, { hour: 'numeric', minute: '2-digit' });

/** "Oct 3, 2026, 7:00 PM EDT" */
export const fmtDateTime = (value, tz) =>
  fmt(value, tz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

/** "EDT" */
export function tzAbbrev(value, tz) {
  if (!value) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, timeZoneName: 'short' })
      .formatToParts(new Date(value));
    return (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
  } catch (e) {
    return '';
  }
}

/** "7:00 PM – 1:00 AM EDT" */
export function fmtTimeRange(start, end, tz) {
  if (!start) return '';
  const abbr = tzAbbrev(start, tz);
  return `${fmtTime(start, tz)} – ${fmtTime(end, tz)}${abbr ? ` ${abbr}` : ''}`;
}

function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const m = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, (+m.hour) % 24, +m.minute, +m.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Converts a <input type="datetime-local"> value ("2026-10-03T19:00"), interpreted as wall-clock
 * time AT THE VENUE, into a UTC ISO string for the API.
 */
export function zonedLocalToUtcIso(localValue, tz) {
  if (!localValue) return null;
  if (!tz) return new Date(localValue).toISOString();
  const [datePart, timePart = '00:00'] = localValue.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc).toISOString();
}

/** Calendar-day key in the venue timezone, used for grouping lists by day. */
export const dayKey = (value, tz) => fmtLongDate(value, tz);
```

---

## 7. Frontend — `VenueSettingsModal` (NEW FILE `frontend/src/components/VenueSettingsModal.jsx`)
Shared by the Admin Panel (create + edit) and the Venue dashboard (edit).
```jsx
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
```

---

## 8. Frontend — Venue Manager Dashboard (`frontend/src/pages/VenueManagerDashboard.jsx`) — targeted edits

### A. Imports
* Add `Settings` to the existing `lucide-react` import list.
* Add:
```jsx
import VenueSettingsModal from '../components/VenueSettingsModal';
import { zonedLocalToUtcIso, fmtShortDate } from '../utils/venueTime';
```

### B. New state (directly below `const [boardRefreshKey, setBoardRefreshKey] = useState(0);`)
```jsx
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);
```

### C. Load positions — add this effect directly after the existing `useEffect` that listens for `admin_venue_changed`:
```jsx
  const loadVenuePositions = async (venueId) => {
    if (!venueId) {
      setVenuePositions([]);
      return;
    }
    try {
      const res = await api.get(`/venues/${venueId}/positions`);
      setVenuePositions(res.data || []);
    } catch (err) {
      setVenuePositions([]);
    }
  };

  useEffect(() => {
    loadVenuePositions(currentVenueId);
  }, [currentVenueId]);
```

### D. Position-driven role rows — replace `handleAddRoleRow` and add helpers
Replace the ENTIRE `handleAddRoleRow` function with:
```jsx
  const FALLBACK_ROLES = ['Bartender', 'Server', 'Dishwasher', 'Barback', 'AV Tech'];

  const rowForPosition = (pos, fallbackName = 'Bartender') => ({
    role: pos ? pos.name : fallbackName,
    quantity: 1,
    hourly_rate: pos ? Number(pos.default_rate).toFixed(2) : '25.00',
    tips_eligible: pos ? !!pos.tips_eligible : false,
    tip_pool: pos ? !!pos.tip_pool : false,
  });

  const openCreateShiftModal = () => {
    setRoleRequirements([rowForPosition(venuePositions[0])]);
    setShowCreateModal(true);
  };

  const handleAddRoleRow = () => {
    const used = new Set(roleRequirements.map((r) => r.role));
    const next = venuePositions.find((p) => !used.has(p.name)) || venuePositions[0];
    setRoleRequirements([...roleRequirements, rowForPosition(next, 'Server')]);
  };
```
In `handleRoleChange`, replace the final `else { next[field] = value; ... }` branch with:
```jsx
      } else if (field === 'role') {
        next.role = value;
        const pos = venuePositions.find((p) => p.name === value);
        if (pos) {
          next.hourly_rate = Number(pos.default_rate).toFixed(2);
          next.tips_eligible = !!pos.tips_eligible;
          next.tip_pool = !!pos.tip_pool;
        }
      } else {
        next[field] = value; // 'hourly_rate' (kept as string while typing)
      }
```

### E. Venue-local start/end in `handleCreateShiftSubmit`
Replace:
```jsx
      const start = startDateTime
        ? new Date(startDateTime).toISOString()
        : new Date(now.getTime() + 86400000).toISOString();
      const end = endDateTime
        ? new Date(endDateTime).toISOString()
        : new Date(now.getTime() + 86400000 + 21600000).toISOString();
```
with:
```jsx
      const venueTz = venueDetails?.timezone;
      const start = startDateTime
        ? zonedLocalToUtcIso(startDateTime, venueTz)
        : new Date(now.getTime() + 86400000).toISOString();
      const end = endDateTime
        ? zonedLocalToUtcIso(endDateTime, venueTz)
        : new Date(now.getTime() + 86400000 + 21600000).toISOString();
      if (new Date(end) <= new Date(start)) {
        setNotification({ type: 'error', message: 'End time must be after the start time.' });
        return;
      }
```
In the success reset inside the same function, replace the `setRoleRequirements([{ role: 'Bartender', ... }]);` line with:
```jsx
      setRoleRequirements([rowForPosition(venuePositions[0])]);
```

### F. Header buttons
1. Change the Create New Shift button's `onClick={() => setShowCreateModal(true)}` → `onClick={openCreateShiftModal}`.
2. Directly BEFORE the `{/* Download Payroll CSV Button */}` comment, add:
```jsx
            <button
              type="button"
              onClick={() => setShowVenueSettings(true)}
              disabled={!venueDetails}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            >
              <Settings className="w-4 h-4 text-amber-400" />
              <span>Venue Settings</span>
            </button>
```

### G. Create Shift modal
1. Change the label `Start DateTime` → `{`Starts (${venueDetails?.timezone || 'local'} time)`}` and `End DateTime` → `{`Ends (${venueDetails?.timezone || 'local'} time)`}` (keep them inside the existing `<label>` elements).
2. Replace the five hard-coded `<option value="Bartender">…<option value="AV Tech">AV Tech</option>` lines inside the role `<select>` with:
```jsx
                          {(venuePositions.length > 0 ? venuePositions.map((p) => p.name) : FALLBACK_ROLES).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                          {row.role && !(venuePositions.length > 0 ? venuePositions.map((p) => p.name) : FALLBACK_ROLES).includes(row.role) && (
                            <option value={row.role}>{row.role}</option>
                          )}
```
3. Change the auto-confirm checkbox label text `Auto-Confirm Anyone (Instant auto-booking for all applicants)` → `Instant booking for this shift (anyone who picks it up is confirmed)`.

### H. Pending transfers date
Replace
`<span>{new Date(shift?.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>`
with
`<span>{fmtShortDate(shift?.start_time, venueDetails?.timezone)}</span>`

### I. Pass timezone to the board
In the `<PostedShiftsBoard ... />` element, add the prop `timeZone={venueDetails?.timezone}`.

### J. Render the settings modal
Directly BEFORE the final closing `</div>` of the component's main return (next to the other modals), add:
```jsx
      {showVenueSettings && venueDetails && (
        <VenueSettingsModal
          mode="edit"
          venue={venueDetails}
          onClose={() => {
            setShowVenueSettings(false);
            loadVenuePositions(currentVenueId);
          }}
          onSaved={(updated) => {
            setVenueDetails(updated);
            setShowVenueSettings(false);
            loadVenuePositions(currentVenueId);
            setNotification({ type: 'success', message: 'Venue settings saved.' });
            setBoardRefreshKey((k) => k + 1);
          }}
        />
      )}
```

---

## 9. Frontend — other screens

### A. `frontend/src/components/PostedShiftsBoard.jsx`
1. Add import: `import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';`
2. Add `timeZone` to the destructured props (after `actionLoading,`).
3. In the `eventsByDate` memo, replace the `const dateKey = new Date(ev.start_time).toLocaleDateString([], { ... });` statement with `const dateKey = fmtLongDate(ev.start_time, timeZone);` and add `timeZone` to that memo's dependency array (`[events, timeZone]`).
4. In the event card, replace the line that builds `timeStr` with:
```jsx
                  const timeStr = fmtTimeRange(ev.start_time, ev.end_time, timeZone);
```
(the `start`/`end` consts above it may be left or removed.)
5. Pass the zone to the modal: add `timeZone={timeZone}` to the `<EventRosterModal ... />` props.
6. Directly under the header's `<p className="text-xs text-slate-400">…</p>` subtitle, add:
```jsx
            {timeZone && <p className="text-[11px] text-slate-500">Times shown in venue time ({timeZone}). Calendar view uses your device's time.</p>}
```

### B. `frontend/src/components/EventRosterModal.jsx`
1. Add import: `import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';`
2. Add `timeZone` to the destructured props.
3. Replace the `dateStr` and `timeStr` const lines with:
```jsx
  const dateStr = fmtDate(event.start_time, timeZone);
  const timeStr = fmtTimeRange(event.start_time, event.end_time, timeZone);
```
4. Replace `new Date(p.requested_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })` with `fmtDateTime(p.requested_at, timeZone)`.

### C. `frontend/src/pages/WorkerDashboard.jsx`
1. Change the React import to include `useMemo`: `import React, { useState, useEffect, useMemo } from 'react';`
2. Add import: `import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';`
3. Open-shift card date — replace:
```jsx
                              {new Date(shift.start_time).toLocaleDateString(undefined, {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
```
with `{fmtDate(shift.start_time, shift.venue?.timezone)}`
4. Open-shift card time — replace the three lines:
```jsx
                              {new Date(shift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {' - '}
                              {new Date(shift.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
```
with `{fmtTimeRange(shift.start_time, shift.end_time, shift.venue?.timezone)}`
5. Replace BOTH occurrences of `{new Date(shift?.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` with `{fmtDateTime(shift?.start_time, shift?.venue?.timezone)}`.
6. Replace `{new Date(shiftToDrop.shift.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` with `{fmtDateTime(shiftToDrop.shift.start_time, shiftToDrop.shift.venue?.timezone)}`.
7. **Role filter from real data** — directly above `const filteredAvailable = ...`, add:
```jsx
  const roleOptions = useMemo(
    () => Array.from(new Set(availableShifts.map((s) => s.role_type).filter(Boolean))).sort(),
    [availableShifts]
  );
```
and replace the five hard-coded `<option value="Bartender">…<option value="AV Tech">AV Tech</option>` lines in the role filter `<select>` (keep `<option value="ALL">All Roles</option>`) with:
```jsx
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
```

### D. `frontend/src/components/TransferModal.jsx`
1. Add import: `import { fmtShortDate, fmtDateTime } from '../utils/venueTime';`
2. Replace `{new Date(s?.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}` with `{fmtShortDate(s?.start_time, s?.venue?.timezone)}`.
3. Replace `{new Date(currentShiftObj.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` with `{fmtDateTime(currentShiftObj.start_time, currentShiftObj.venue?.timezone)}`.

### E. `frontend/src/pages/AdminPanel.jsx`
1. Add import: `import VenueSettingsModal from '../components/VenueSettingsModal';` (`Pencil` is already imported from Phase 23).
2. Add state below `const [showCreateModal, setShowCreateModal] = useState(false);`:
```jsx
  const [venueModal, setVenueModal] = useState(null); // { mode: 'create' | 'edit', venue }
```
3. Change BOTH occurrences of `onClick={() => setShowCreateModal(true)}` → `onClick={() => setVenueModal({ mode: 'create', venue: null })}`.
4. **Delete** the entire old create-venue modal: from the comment `{/* Modal: Create New Venue */}` down to (but NOT including) the comment `{/* Modal: Create New User (Phase 20) */}`. Leave `handleCreateVenue` and its state variables in place (unused is fine).
5. **Fix the venue counts** in the venues table body:
   * `{venue.shifts_count ?? 0}` → `{venue.total_shifts ?? 0}`
   * `{venue.managers_count ?? 0}` → `{venue.total_managers ?? 0}`
   * `{venue.workers_count ?? 0}` → `{venue.assigned_workers_count ?? 0}`
6. In the venues table Actions cell, directly BEFORE the delete `<button onClick={() => handleDeleteVenue(venue.id)} ...>`, add:
```jsx
                          <button
                            onClick={() => setVenueModal({ mode: 'edit', venue })}
                            title="Edit venue"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-slate-800 transition mr-1"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
```
7. Render the modal directly BEFORE `{/* Modal: Create New User (Phase 20) */}`:
```jsx
      {venueModal && (
        <VenueSettingsModal
          mode={venueModal.mode}
          venue={venueModal.venue}
          showManagerEmail={venueModal.mode === 'create'}
          onClose={() => {
            setVenueModal(null);
            fetchAdminData();
          }}
          onSaved={(saved) => {
            setVenueModal(null);
            setNotification({
              type: 'success',
              message: venueModal.mode === 'create' ? `Venue "${saved.name}" created.` : `Venue "${saved.name}" updated.`,
            });
            fetchAdminData();
          }}
        />
      )}
```

---

## 10. Rebuild & Verification

**⚠️ Schema changed — destructive rebuild required (wipes all data; the seed recreates demo data):**
```bash
docker compose down -v
docker compose up -d --build
```

Verify:
1. `docker compose exec database psql -U shiftboard_user -d shiftboard -c "\d venue_positions"` shows the table; `SELECT name, timezone, approval_policy FROM venues;` shows `America/New_York` / `team_auto` for seeded venues.
2. `SELECT v.name, p.name, p.default_rate, p.tips_eligible, p.tip_pool FROM venue_positions p JOIN venues v ON v.id = p.venue_id ORDER BY v.name, p.sort_order;` → 5 starter positions per seeded venue.
3. **Admin → Venues:** counts now show real numbers (not 0). **Add venue** opens the new form; create one with no manager → it appears with 5 positions. Pencil → edit phone, arrival instructions, dress code, timezone → save → values persist on reopen.
4. **Location:** on a phone, Venue Settings → "Use my current location" → browser asks permission → lat/lng fill in → "Check this spot on Google Maps" opens the right place → Save.
5. **Positions:** Venue Settings → Positions & pay → change Bartender to $30 with Tips + Tip pool → Save. Add "Coat Check" $18. Remove Dishwasher (trash icon) → it greys out; restore icon brings it back.
6. **Create Shift:** the position dropdown lists that venue's active positions; picking one fills in its rate and tips; "Add Role" adds the next unused position. The date labels say "Starts (America/New_York time)".
7. **Timezone:** set a test venue to `America/Los_Angeles`, create a shift for 7:00 PM → the board and the worker card show "7:00 PM – … PDT" even when viewed from an Eastern-time device. `SELECT start_time FROM shifts ORDER BY created_at DESC LIMIT 1;` shows 02:00 UTC next day (during PDT).
8. **Approval policy:**
   * `team_auto` (default): a whitelisted worker's request → Confirmed instantly; a non-team worker → Pending.
   * `manual`: the whitelisted worker → Pending.
   * `everyone_auto`: any worker → Confirmed instantly.
9. A manager can edit their own venue but gets 403 editing a venue they don't manage (`PUT /api/venues/{other_id}/settings`).
10. Worker "Find Shifts" role filter lists only roles that are actually posted.
11. Everything from Phases 20–24 still works: approvals, Posted Shifts board, clock in/out, transfers, payroll CSV.