# Phase 27: Clock-in Guardrails, Opt-in Geofence & Event Locations

**Why:** today a worker can clock in days early and get marked *Completed* with 0 hours. The venue's location and radius are stored but never checked. And caterers or off-site events have no way to say *where* a shift actually is.

## What this phase adds

1. **Clock-in window (always on).**
   - Clock-in opens `clock_in_early_minutes` before the start (venue setting, default 30) and closes at the scheduled end.
   - Late arrivals can still clock in; they're flagged **Late N min** after a 10-minute grace.
   - Clocking out less than a minute after clocking in is treated as a mis-tap: the entry is removed, not logged as a 0-hour shift.
2. **Geofence: opt-in.**
   - The venue sets a default (`geofence_enabled`, off by default).
   - Each event can set **Venue default / On / Off**.
   - When it's on for a shift:

   | Where the worker is | Result |
   |---|---|
   | inside the radius | ✅ clocked in, **On site** |
   | inside radius + `geofence_buffer_meters` (default 150) | ✅ clocked in, flagged **Outside geofence** (with distance) |
   | beyond the buffer | ⛔ blocked, with the distance |
   | location blocked / unavailable | ⛔ blocked, with instructions |

   - Clock-out is **never** blocked, only recorded or flagged.
   - When the geofence is off, the app never asks for location.
3. **Manager override.** Times a manager adds or edits on the time sheet are marked **Manager entry**; that's the override for a dead phone or bad GPS.
4. **Auto clock-out.** Anyone still clocked in `auto_clock_out_hours` (default 2) after the scheduled end is clocked out **at the scheduled end** and flagged **Auto-closed, check hours**. There's no background worker: it runs whenever a clock, time sheet, payroll, calendar or active-entries endpoint is used.
5. **Event locations (caterers, off-site events):**
   - Venues keep **saved locations**: name, address, optional map pin and radius, and **location notes**.
   - On Post / Edit a Shift, **"Where"** is a search box: venue address (default), a saved location, or anything typed. If it isn't in the list, the new-location fields open inline and the location is **saved to the list automatically** when the event is saved.
   - **"Edit this location"** changes it **globally**, and flags upcoming events there as **Updated** (the 26.2 "Got it" flow).
   - A checkbox adds **event-specific location notes** that only **confirmed staff** see. They're separate from the existing staff-only event notes.
   - Workers see the event's location everywhere: cards, popout, calendar, Shift Details, Directions, `.ics`, clock-in check. Managers see the location name on Posted Shifts, the roster and the payroll CSV.
6. **Payroll CSV** gains Work Location, Clock-In and Clock-Out location check, Late (min) and Auto-Closed columns.
7. **Privacy fix.** Venue **arrival instructions** now reach only booked workers, as Venue Settings already promises. Before, the Find Shifts popout sent them to everyone.
8. **Seed fix.** "Friday Evening Barback" lands on a Friday, and likewise for Saturday and Sunday.

⚠️ **Schema change**: see §E for the rebuild (wipe or keep-data SQL).

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`
  - `main.py` CORS logic (only add the import and `include_router` lines shown)
  - `frontend/src/context/AuthContext.jsx`
  - `frontend/src/api/client.js`
  - `frontend/vite.config.js`
* No native PostgreSQL ENUMs. New statuses are VARCHAR:
  - `geofence_mode`: `venue_default` | `on` | `off`
  - `clock_in_geo_status` / `clock_out_geo_status`: `on_site` | `outside_geofence` | `not_checked` | `manager` | `auto`
* Aware UTC datetimes only.
* Never `UserResponse.model_validate(<ORM User>)`. Never touch relationships that weren't `selectinload`-ed.
* **NEW FILE / FULL FILE**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* block appears **exactly once** in the current file; apply them in order.
* The session factory has `autoflush=False`. The new code calls `await db.flush()` where it needs IDs or fresh reads. Keep those calls.
* These blocks were generated from the real current files and checked:
  - after applying them, the backend imports cleanly and all 84 API routes build
  - the frontend bundles with no missing imports
  
  Don't "improve" them.

---
## A1. `database/init.sql` (EDITS)

Adds four venue columns, the `venue_locations` table (before `shift_events`, which references it), three `shift_events` columns, the time-entry location columns, and the `venue_locations` updated_at trigger.

**Edit 1.** Find:
```sql
    approval_policy VARCHAR(20) NOT NULL DEFAULT 'team_auto',
    show_rates_publicly BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    approval_policy VARCHAR(20) NOT NULL DEFAULT 'team_auto',
    show_rates_publicly BOOLEAN NOT NULL DEFAULT TRUE,
    geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    geofence_buffer_meters INT NOT NULL DEFAULT 150,
    clock_in_early_minutes INT NOT NULL DEFAULT 30,
    auto_clock_out_hours INT NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 2.** Find:
```sql
CREATE INDEX idx_venue_positions_venue ON venue_positions(venue_id);

-- ------------------------------------------------------------------------------
-- 4c. Shift Events (Phase 25.2): one posting = one event with 1+ positions
```
Replace with:
```sql
CREATE INDEX idx_venue_positions_venue ON venue_positions(venue_id);

-- Phase 27: saved service locations (caterers, off-site events)
CREATE TABLE venue_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_meters INT,
    notes TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_location_name UNIQUE (venue_id, name)
);
CREATE INDEX idx_venue_locations_venue ON venue_locations(venue_id);

-- ------------------------------------------------------------------------------
-- 4c. Shift Events (Phase 25.2): one posting = one event with 1+ positions
```

**Edit 3.** Find:
```sql
    info_updated_at TIMESTAMPTZ,
    info_change TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
```
Replace with:
```sql
    info_updated_at TIMESTAMPTZ,
    info_change TEXT,
    location_id UUID REFERENCES venue_locations(id) ON DELETE SET NULL,
    geofence_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default',
    location_staff_notes TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
```

**Edit 4.** Find:
```sql
CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_venue_positions_updated_at BEFORE UPDATE ON venue_positions FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_events_updated_at BEFORE UPDATE ON shift_events FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
```
Replace with:
```sql
CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_venue_positions_updated_at BEFORE UPDATE ON venue_positions FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_venue_locations_updated_at BEFORE UPDATE ON venue_locations FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_events_updated_at BEFORE UPDATE ON shift_events FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
```

**Edit 5.** Find:
```sql
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out_time TIMESTAMPTZ
);

```
Replace with:
```sql
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out_time TIMESTAMPTZ,
    clock_in_lat DOUBLE PRECISION,
    clock_in_lng DOUBLE PRECISION,
    clock_in_distance_m INT,
    clock_in_geo_status VARCHAR(20) NOT NULL DEFAULT 'not_checked',
    clock_out_lat DOUBLE PRECISION,
    clock_out_lng DOUBLE PRECISION,
    clock_out_distance_m INT,
    clock_out_geo_status VARCHAR(20),
    auto_closed BOOLEAN NOT NULL DEFAULT FALSE
);

```


---

## A2. `backend/src/models.py` (EDITS)

New columns on `Venue`, `ShiftEvent` and `TimeEntry`; new `VenueLocation` model and the `Venue.locations` relationship.

**Edit 1.** Find:
```python
    approval_policy = Column(String(20), nullable=False, default="team_auto")
    show_rates_publicly = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    approval_policy = Column(String(20), nullable=False, default="team_auto")
    show_rates_publicly = Column(Boolean, nullable=False, default=True)
    geofence_enabled = Column(Boolean, nullable=False, default=False)          # Phase 27: opt-in
    geofence_buffer_meters = Column(Integer, nullable=False, default=150)      # Phase 27: flagged, not blocked
    clock_in_early_minutes = Column(Integer, nullable=False, default=30)       # Phase 27
    auto_clock_out_hours = Column(Integer, nullable=False, default=2)          # Phase 27
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 2.** Find:
```python
    whitelists = relationship("VenueWhitelist", back_populates="venue", cascade="all, delete-orphan")
    positions = relationship("VenuePosition", back_populates="venue", cascade="all, delete-orphan")

class VenueManager(Base):
```
Replace with:
```python
    whitelists = relationship("VenueWhitelist", back_populates="venue", cascade="all, delete-orphan")
    positions = relationship("VenuePosition", back_populates="venue", cascade="all, delete-orphan")
    locations = relationship("VenueLocation", back_populates="venue", cascade="all, delete-orphan")

class VenueManager(Base):
```

**Edit 3.** Find:
```python
    venue = relationship("Venue", back_populates="positions")

class ShiftEvent(Base):
    __tablename__ = "shift_events"
```
Replace with:
```python
    venue = relationship("Venue", back_populates="positions")

class VenueLocation(Base):
    """Phase 27: a saved place a venue works at (client site, off-site event, second room)."""
    __tablename__ = "venue_locations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    address = Column(Text, nullable=False)
    lat = Column(DOUBLE_PRECISION, nullable=True)
    lng = Column(DOUBLE_PRECISION, nullable=True)
    radius_meters = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("venue_id", "name", name="uq_venue_location_name"),)

    venue = relationship("Venue", back_populates="locations")

class ShiftEvent(Base):
    __tablename__ = "shift_events"
```

**Edit 4.** Find:
```python
    info_updated_at = Column(DateTime(timezone=True), nullable=True)       # Phase 26.2: last time/notes change
    info_change = Column(Text, nullable=True)                              # Phase 26.2: "Time changed: …"
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
```
Replace with:
```python
    info_updated_at = Column(DateTime(timezone=True), nullable=True)       # Phase 26.2: last time/notes change
    info_change = Column(Text, nullable=True)                              # Phase 26.2: "Time changed: …"
    location_id = Column(UUID(as_uuid=True), ForeignKey("venue_locations.id", ondelete="SET NULL"), nullable=True)  # Phase 27
    geofence_mode = Column(String(20), nullable=False, default="venue_default")  # Phase 27: venue_default | on | off
    location_staff_notes = Column(Text, nullable=True)                     # Phase 27: event-specific, booked staff only
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
```

**Edit 5.** Find:
```python
    clock_in_time = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    clock_out_time = Column(DateTime(timezone=True), nullable=True)

    worker = relationship("User", foreign_keys=[worker_id])
```
Replace with:
```python
    clock_in_time = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    clock_out_time = Column(DateTime(timezone=True), nullable=True)
    # Phase 27: where the clock happened and what the geofence said
    clock_in_lat = Column(DOUBLE_PRECISION, nullable=True)
    clock_in_lng = Column(DOUBLE_PRECISION, nullable=True)
    clock_in_distance_m = Column(Integer, nullable=True)
    clock_in_geo_status = Column(String(20), nullable=False, default="not_checked")  # on_site | outside_geofence | not_checked | manager
    clock_out_lat = Column(DOUBLE_PRECISION, nullable=True)
    clock_out_lng = Column(DOUBLE_PRECISION, nullable=True)
    clock_out_distance_m = Column(Integer, nullable=True)
    clock_out_geo_status = Column(String(20), nullable=True)                         # same values + auto
    auto_closed = Column(Boolean, nullable=False, default=False)

    worker = relationship("User", foreign_keys=[worker_id])
```


---

## A3. `backend/src/schemas.py` (EDITS)

New settings fields on the venue schemas. Location fields on `TimeEntryResponse` / `TimeEntryRow`.

New Phase 27 block, placed **before** `class EventPositionInput` so later classes can reference it:
- `VenueLocationInput`
- `VenueLocationUpdate`
- `VenueLocationResponse`
- `ListingLocation`
- `ClockBody`
- `ClockResult`

Location fields added to:
- `EventCreate` / `EventUpdate` / `EventDetail`
- `VenueEventResponse` / `PublicVenueEvent`
- `EventListing` / `WorkerCalendarItem`

**Edit 1.** Find:
```python
    approval_policy: str = "team_auto"
    show_rates_publicly: bool = True

class VenueCreate(BaseModel):
```
Replace with:
```python
    approval_policy: str = "team_auto"
    show_rates_publicly: bool = True
    geofence_enabled: bool = False          # Phase 27
    geofence_buffer_meters: int = 150       # Phase 27
    clock_in_early_minutes: int = 30        # Phase 27
    auto_clock_out_hours: int = 2           # Phase 27

class VenueCreate(BaseModel):
```

**Edit 2.** Find:
```python
    approval_policy: Optional[str] = "team_auto"
    show_rates_publicly: Optional[bool] = True
    manager_email: Optional[EmailStr] = None
    initial_manager_email: Optional[EmailStr] = None
```
Replace with:
```python
    approval_policy: Optional[str] = "team_auto"
    show_rates_publicly: Optional[bool] = True
    geofence_enabled: Optional[bool] = False          # Phase 27
    geofence_buffer_meters: Optional[int] = 150       # Phase 27
    clock_in_early_minutes: Optional[int] = 30        # Phase 27
    auto_clock_out_hours: Optional[int] = 2           # Phase 27
    manager_email: Optional[EmailStr] = None
    initial_manager_email: Optional[EmailStr] = None
```

**Edit 3.** Find:
```python
    approval_policy: Optional[str] = None
    show_rates_publicly: Optional[bool] = None

class VenueResponse(VenueBase):
```
Replace with:
```python
    approval_policy: Optional[str] = None
    show_rates_publicly: Optional[bool] = None
    geofence_enabled: Optional[bool] = None           # Phase 27
    geofence_buffer_meters: Optional[int] = None      # Phase 27
    clock_in_early_minutes: Optional[int] = None      # Phase 27
    auto_clock_out_hours: Optional[int] = None        # Phase 27

class VenueResponse(VenueBase):
```

**Edit 4.** Find:
```python
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None

    class Config:
```
Replace with:
```python
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None
    clock_in_geo_status: Optional[str] = None       # Phase 27
    clock_in_distance_m: Optional[int] = None       # Phase 27
    clock_out_geo_status: Optional[str] = None      # Phase 27
    clock_out_distance_m: Optional[int] = None      # Phase 27
    auto_closed: bool = False                       # Phase 27

    class Config:
```

**Edit 5.** Find:
```python
    event_key: str
    event_id: Optional[UUID] = None
    cancelled: bool = False
    cancel_reason: Optional[str] = None
```
Replace with:
```python
    event_key: str
    event_id: Optional[UUID] = None
    location_name: Optional[str] = None      # Phase 27: None = venue address
    cancelled: bool = False
    cancel_reason: Optional[str] = None
```

**Edit 6.** Find:
```python
    event_key: str
    event_id: Optional[UUID] = None     # Phase 26.1: opens the worker listing modal
    title: str
    start_time: datetime
```
Replace with:
```python
    event_key: str
    event_id: Optional[UUID] = None     # Phase 26.1: opens the worker listing modal
    location_name: Optional[str] = None # Phase 27
    title: str
    start_time: datetime
```

**Edit 7.** Find:
```python
# Phase 25.2: Events (create / edit / detail)
# ------------------------------------------------------------------------------
class EventPositionInput(BaseModel):
    shift_id: Optional[UUID] = None          # present = update existing position, absent = new
```
Replace with:
```python
# Phase 25.2: Events (create / edit / detail)
# ------------------------------------------------------------------------------
# ------------------------------------------------------------------------------
# Phase 27: Saved locations, geofence, clocking
# ------------------------------------------------------------------------------
class VenueLocationInput(BaseModel):
    name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_meters: Optional[int] = None      # None = use the venue's radius
    notes: Optional[str] = None              # "Location notes": everyone viewing the event sees these


class VenueLocationUpdate(BaseModel):
    """Partial update: only fields that are sent change. Edits are global (every event using it)."""
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    clear_pin: bool = False                  # true = remove lat/lng
    radius_meters: Optional[int] = None
    clear_radius: bool = False               # true = back to the venue radius
    notes: Optional[str] = None


class VenueLocationResponse(BaseModel):
    id: UUID
    venue_id: UUID
    name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_meters: Optional[int] = None
    notes: Optional[str] = None
    is_archived: bool = False
    event_count: int = 0                     # how many events use it (all time)
    upcoming_count: int = 0                  # upcoming, not-cancelled events using it

    class Config:
        from_attributes = True


class ListingLocation(BaseModel):
    """What a worker sees for an event held somewhere other than the venue's own address."""
    id: UUID
    name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    notes: Optional[str] = None


class ClockBody(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None


class ClockResult(BaseModel):
    status: str                               # clocked_in | clocked_out | undone | already_clocked_in
    message: str
    entry: Optional[TimeEntryResponse] = None
    geo_status: Optional[str] = None          # on_site | outside_geofence | not_checked
    distance_m: Optional[int] = None
    late_minutes: int = 0


class EventPositionInput(BaseModel):
    shift_id: Optional[UUID] = None          # present = update existing position, absent = new
```

**Edit 8.** Find:
```python
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2: only shown to booked staff
    positions: List[EventPositionInput]

```
Replace with:
```python
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2: only shown to booked staff
    location_id: Optional[UUID] = None       # Phase 27: saved location (None = venue address)
    new_location: Optional[VenueLocationInput] = None   # Phase 27: create + save to the list, then use it
    geofence_mode: str = "venue_default"     # Phase 27: venue_default | on | off
    location_staff_notes: Optional[str] = None          # Phase 27: event-specific, confirmed staff only
    positions: List[EventPositionInput]

```

**Edit 9.** Find:
```python
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    positions: List[EventPositionInput]

```
Replace with:
```python
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    location_id: Optional[UUID] = None       # Phase 27
    new_location: Optional[VenueLocationInput] = None   # Phase 27
    geofence_mode: str = "venue_default"     # Phase 27
    location_staff_notes: Optional[str] = None          # Phase 27
    positions: List[EventPositionInput]

```

**Edit 10.** Find:
```python
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    cancelled: bool = False
    cancel_reason: Optional[str] = None
```
Replace with:
```python
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    location: Optional[VenueLocationResponse] = None    # Phase 27 (None = venue address)
    geofence_mode: str = "venue_default"                # Phase 27
    geofence_on: bool = False                           # Phase 27: effective setting
    location_staff_notes: Optional[str] = None          # Phase 27
    cancelled: bool = False
    cancel_reason: Optional[str] = None
```

**Edit 11.** Find:
```python
    hours: float
    edited: bool = False


```
Replace with:
```python
    hours: float
    edited: bool = False
    clock_in_geo_status: Optional[str] = None    # Phase 27
    clock_in_distance_m: Optional[int] = None
    clock_out_geo_status: Optional[str] = None
    clock_out_distance_m: Optional[int] = None
    auto_closed: bool = False
    late_minutes: int = 0


```

**Edit 12.** Find:
```python
    title: str
    notes: Optional[str] = None
    start_time: datetime
    end_time: datetime
```
Replace with:
```python
    title: str
    notes: Optional[str] = None
    location: Optional[ListingLocation] = None        # Phase 27: None = at the venue's address
    location_staff_notes: Optional[str] = None        # Phase 27: booked viewers only
    geofence_on: bool = False                         # Phase 27
    start_time: datetime
    end_time: datetime
```

**Edit 13.** Find:
```python
    hours: float
    venue: ListingVenue
    hourly_rate: Optional[float] = None           # None = hidden until booked
    hourly_rate_max: Optional[float] = None
```
Replace with:
```python
    hours: float
    venue: ListingVenue
    location: Optional[ListingLocation] = None    # Phase 27: None = at the venue's address
    location_staff_notes: Optional[str] = None    # Phase 27: booked only
    geofence_on: bool = False                     # Phase 27: phone location needed to clock in
    clock_in_opens_at: Optional[datetime] = None  # Phase 27
    time_entry_id: Optional[UUID] = None          # Phase 27: open entry, if clocked in
    hourly_rate: Optional[float] = None           # None = hidden until booked
    hourly_rate_max: Optional[float] = None
```


---

## B1. NEW FILE `backend/src/services/locations.py`

Saved locations, "where is this event", geofence on/off resolution and distance math. Its create/update/archive helpers do **not** commit; routers and event services commit.
```python
"""
Phase 27: Saved locations, "where is this event?", and geofence math.

* A venue keeps a list of saved locations (client sites, off-site rooms). Events point at one
  with shift_events.location_id; NULL means "at the venue's own address".
* New locations typed on the event form are saved to the list automatically.
* Edits are GLOBAL: every event using the location sees the change. Upcoming events get the
  26.2 "Updated" flag so booked workers have to tap "Got it".
* Geofence is opt-in: venue.geofence_enabled is the default, event.geofence_mode overrides.
"""
import math
from datetime import datetime, timezone
from typing import Optional, Dict, List

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import VenueLocation, ShiftEvent, Venue
from src.schemas import VenueLocationInput, VenueLocationUpdate, VenueLocationResponse, ListingLocation

GEOFENCE_MODES = ("venue_default", "on", "off")
RADIUS_MIN, RADIUS_MAX = 25, 5000


# ---------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------
def _clean(text: Optional[str]) -> Optional[str]:
    if text is None:
        return None
    text = str(text).strip()
    return text or None


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fmt_distance(meters: float) -> str:
    """US-friendly: '450 ft' under ~0.1 mi, otherwise '0.8 mi'."""
    if meters < 161:
        return f"{int(round(meters / 0.3048))} ft"
    return f"{meters / 1609.344:.1f} mi"


def validate_geofence_mode(mode: Optional[str]) -> str:
    m = (mode or "venue_default").lower()
    if m not in GEOFENCE_MODES:
        raise HTTPException(status_code=400, detail="Location check must be venue_default, on, or off.")
    return m


def geofence_on(event: Optional[ShiftEvent], venue: Venue) -> bool:
    mode = (getattr(event, "geofence_mode", None) or "venue_default").lower() if event is not None else "venue_default"
    if mode == "on":
        return True
    if mode == "off":
        return False
    return bool(venue.geofence_enabled)


def effective_place(venue: Venue, location: Optional[VenueLocation]) -> Dict:
    """Where the work happens: the saved location if set, otherwise the venue itself."""
    if location is not None:
        return {
            "name": location.name,
            "address": location.address,
            "lat": location.lat,
            "lng": location.lng,
            "radius": location.radius_meters or venue.geofence_radius_meters,
            "is_offsite": True,
        }
    return {
        "name": venue.name,
        "address": venue.address,
        "lat": venue.lat,
        "lng": venue.lng,
        "radius": venue.geofence_radius_meters,
        "is_offsite": False,
    }


def to_listing_location(location: Optional[VenueLocation]) -> Optional[ListingLocation]:
    if location is None:
        return None
    return ListingLocation(
        id=location.id,
        name=location.name,
        address=location.address,
        lat=location.lat,
        lng=location.lng,
        notes=location.notes,
    )


async def load_locations(db: AsyncSession, location_ids) -> Dict:
    ids = {i for i in location_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(ids)))).scalars().all()
    return {loc.id: loc for loc in rows}


def _validate_fields(name, address, lat, lng, radius) -> None:
    if name is not None and not name:
        raise HTTPException(status_code=400, detail="Give the location a name.")
    if address is not None and not address:
        raise HTTPException(status_code=400, detail="Add the location's address.")
    if (lat is None) != (lng is None):
        raise HTTPException(status_code=400, detail="Enter both latitude and longitude for the map pin, or neither.")
    if lat is not None and not (-90 <= float(lat) <= 90):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90.")
    if lng is not None and not (-180 <= float(lng) <= 180):
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180.")
    if radius is not None and not (RADIUS_MIN <= int(radius) <= RADIUS_MAX):
        raise HTTPException(status_code=400, detail=f"Location radius must be between {RADIUS_MIN} and {RADIUS_MAX} meters.")


async def _name_taken(db: AsyncSession, venue_id, name: str, exclude_id=None) -> Optional[VenueLocation]:
    q = select(VenueLocation).where(
        VenueLocation.venue_id == venue_id,
        func.lower(VenueLocation.name) == name.lower(),
    )
    if exclude_id is not None:
        q = q.where(VenueLocation.id != exclude_id)
    return await db.scalar(q)


# ---------------------------------------------------------------------------------------------
# Create / update / archive (these do NOT commit; callers commit)
# ---------------------------------------------------------------------------------------------
async def create_location(db: AsyncSession, venue_id, data: VenueLocationInput) -> VenueLocation:
    name = _clean(data.name) or ""
    address = _clean(data.address) or ""
    _validate_fields(name, address, data.lat, data.lng, data.radius_meters)
    name = name[:255]
    existing = await _name_taken(db, venue_id, name)
    if existing is not None:
        hint = " (it's archived; bring it back under Venue Settings → Locations)" if existing.is_archived else ""
        raise HTTPException(
            status_code=400,
            detail=f"A saved location called “{existing.name}” already exists{hint}. Pick it from the list or use a different name.",
        )
    loc = VenueLocation(
        venue_id=venue_id,
        name=name,
        address=address,
        lat=float(data.lat) if data.lat is not None else None,
        lng=float(data.lng) if data.lng is not None else None,
        radius_meters=int(data.radius_meters) if data.radius_meters is not None else None,
        notes=_clean(data.notes),
        is_archived=False,
    )
    db.add(loc)
    await db.flush()
    return loc


async def update_location(db: AsyncSession, loc: VenueLocation, data: VenueLocationUpdate) -> List[str]:
    """Global edit. Returns the list of human-readable changes (empty = nothing changed)."""
    new_name = _clean(data.name) if data.name is not None else loc.name
    new_address = _clean(data.address) if data.address is not None else loc.address
    if data.clear_pin:
        new_lat, new_lng = None, None
    elif data.lat is not None or data.lng is not None:
        new_lat, new_lng = data.lat, data.lng
    else:
        new_lat, new_lng = loc.lat, loc.lng
    if data.clear_radius:
        new_radius = None
    elif data.radius_meters is not None:
        new_radius = data.radius_meters
    else:
        new_radius = loc.radius_meters
    new_notes = _clean(data.notes) if data.notes is not None else loc.notes

    _validate_fields(new_name or "", new_address or "", new_lat, new_lng, new_radius)
    if new_name != loc.name and await _name_taken(db, loc.venue_id, new_name, exclude_id=loc.id):
        raise HTTPException(status_code=400, detail=f"Another saved location is already called “{new_name}”.")

    changes = []
    if new_name != loc.name:
        changes.append(f"renamed to “{new_name}”")
    if new_address != loc.address:
        changes.append("address changed")
    if (new_lat, new_lng) != (loc.lat, loc.lng):
        changes.append("map pin moved" if new_lat is not None else "map pin removed")
    if new_radius != loc.radius_meters:
        changes.append("check-in radius changed")
    if new_notes != loc.notes:
        changes.append("location notes updated")

    loc.name = new_name[:255]
    loc.address = new_address
    loc.lat = float(new_lat) if new_lat is not None else None
    loc.lng = float(new_lng) if new_lng is not None else None
    loc.radius_meters = int(new_radius) if new_radius is not None else None
    loc.notes = new_notes

    if changes:
        await _flag_upcoming_events(db, loc.id, "Location updated: " + ", ".join(changes))
    return changes


async def _flag_upcoming_events(db: AsyncSession, location_id, change_text: str) -> int:
    """Upcoming, not-cancelled events at this location get the 26.2 'Updated' flag."""
    now = datetime.now(timezone.utc)
    events = (await db.execute(
        select(ShiftEvent).where(
            ShiftEvent.location_id == location_id,
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.end_time > now,
        )
    )).scalars().all()
    for ev in events:
        ev.info_updated_at = now
        ev.info_change = change_text
    return len(events)


async def usage_counts(db: AsyncSession, location_ids) -> Dict:
    """{location_id: (event_count, upcoming_count)}"""
    ids = [i for i in location_ids if i]
    if not ids:
        return {}
    now = datetime.now(timezone.utc)
    out = {i: (0, 0) for i in ids}
    for lid, total in (await db.execute(
        select(ShiftEvent.location_id, func.count(ShiftEvent.id))
        .where(ShiftEvent.location_id.in_(ids))
        .group_by(ShiftEvent.location_id)
    )).all():
        out[lid] = (int(total), out[lid][1])
    for lid, upcoming in (await db.execute(
        select(ShiftEvent.location_id, func.count(ShiftEvent.id))
        .where(
            ShiftEvent.location_id.in_(ids),
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.end_time > now,
        )
        .group_by(ShiftEvent.location_id)
    )).all():
        out[lid] = (out[lid][0], int(upcoming))
    return out


def to_response(loc: VenueLocation, counts: Dict) -> VenueLocationResponse:
    total, upcoming = counts.get(loc.id, (0, 0))
    return VenueLocationResponse(
        id=loc.id,
        venue_id=loc.venue_id,
        name=loc.name,
        address=loc.address,
        lat=loc.lat,
        lng=loc.lng,
        radius_meters=loc.radius_meters,
        notes=loc.notes,
        is_archived=bool(loc.is_archived),
        event_count=total,
        upcoming_count=upcoming,
    )


async def resolve_event_location(
    db: AsyncSession,
    venue: Venue,
    location_id,
    new_location: Optional[VenueLocationInput],
    current_location_id=None,
) -> Optional[VenueLocation]:
    """
    Turns the event form's "Where" into a VenueLocation (or None = venue address).
    new_location wins over location_id and is saved to the list. An archived location can only
    stay on an event that already uses it.
    """
    if new_location is not None:
        return await create_location(db, venue.id, new_location)
    if not location_id:
        return None
    loc = await db.scalar(select(VenueLocation).where(VenueLocation.id == location_id))
    if loc is None or loc.venue_id != venue.id:
        raise HTTPException(status_code=400, detail="That location doesn't belong to this venue.")
    if loc.is_archived and location_id != current_location_id:
        raise HTTPException(status_code=400, detail=f"“{loc.name}” is archived. Bring it back under Venue Settings → Locations first.")
    return loc


def check_geofence_possible(mode: str, venue: Venue, location: Optional[VenueLocation]) -> None:
    """If the location check will be on, the place needs a map pin."""
    on = mode == "on" or (mode == "venue_default" and venue.geofence_enabled)
    if on and location is not None and (location.lat is None or location.lng is None):
        raise HTTPException(
            status_code=400,
            detail=f"“{location.name}” has no map pin, so the clock-in location check can't work there. "
                   "Add a pin to the location, or turn the location check off for this event.",
        )
```


---

## B2. NEW FILE `backend/src/services/clock.py`

The clock-in / clock-out rules and the auto clock-out sweep. `clock_in` / `clock_out` commit or roll back themselves. `auto_close_open_entries` never raises (it logs and returns 0).
```python
"""
Phase 27: Clock-in / clock-out rules.

Window  : clock-in opens `venue.clock_in_early_minutes` before start and closes at the scheduled end.
          Late arrivals can still clock in (flagged late after LATE_GRACE).
Geofence: only when on for the event (event.geofence_mode, else venue.geofence_enabled).
            inside radius             -> accepted, 'on_site'
            inside radius + buffer    -> accepted, 'outside_geofence' (flagged for the manager)
            beyond the buffer         -> BLOCKED (clock-in only)
            no location from phone    -> BLOCKED (clock-in only)
          Clock-out is never blocked; it's just recorded / flagged.
Undo    : clocking out under a minute after clocking in removes the entry (a mis-tap).
Auto    : open entries are closed at the scheduled end once `venue.auto_clock_out_hours` have passed.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, User, Venue, VenueLocation
from src.schemas import ClockBody, ClockResult, TimeEntryResponse
from src.services.locations import geofence_on, effective_place, haversine_m, fmt_distance

logger = logging.getLogger("shiftboard.clock")

BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
LATE_GRACE = timedelta(minutes=10)
UNDO_WINDOW = timedelta(seconds=60)


def as_utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def late_minutes(clock_in, shift_start) -> int:
    if clock_in is None or shift_start is None:
        return 0
    diff = as_utc(clock_in) - as_utc(shift_start)
    return int(diff.total_seconds() // 60) if diff > LATE_GRACE else 0


def clock_in_opens_at(shift: Shift, venue: Venue) -> datetime:
    return as_utc(shift.start_time) - timedelta(minutes=int(venue.clock_in_early_minutes or 0))


def _local_time(dt: datetime, venue: Venue) -> str:
    try:
        tz = ZoneInfo(venue.timezone or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    local = as_utc(dt).astimezone(tz)
    today = datetime.now(timezone.utc).astimezone(tz).date()
    time_txt = local.strftime("%-I:%M %p")
    return time_txt if local.date() == today else f"{local.strftime('%a %b %-d')}, {time_txt}"


async def _context(db: AsyncSession, shift_id) -> Tuple[Shift, Venue, Optional[ShiftEvent], Optional[VenueLocation]]:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    location = None
    if event is not None and event.location_id:
        location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id))
    return shift, venue, event, location


def _judge(body: Optional[ClockBody], venue: Venue, place: dict) -> Tuple[str, Optional[int], Optional[float], Optional[float]]:
    """Returns (geo_status, distance_m, lat, lng). geo_status 'blocked_far' / 'blocked_no_fix' mean block (clock-in)."""
    lat = body.latitude if body else None
    lng = body.longitude if body else None
    if lat is None or lng is None:
        return "blocked_no_fix", None, None, None
    if place["lat"] is None or place["lng"] is None:
        return "not_checked", None, lat, lng
    d = haversine_m(float(lat), float(lng), float(place["lat"]), float(place["lng"]))
    radius = int(place["radius"] or 100)
    buffer = int(venue.geofence_buffer_meters or 0)
    if d <= radius:
        return "on_site", int(round(d)), lat, lng
    if d <= radius + buffer:
        return "outside_geofence", int(round(d)), lat, lng
    return "blocked_far", int(round(d)), lat, lng


async def clock_in(db: AsyncSession, user: User, shift_id, body: Optional[ClockBody]) -> ClockResult:
    await auto_close_open_entries(db, worker_id=user.id)
    shift, venue, event, location = await _context(db, shift_id)

    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id,
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
        )
    )
    if req is None:
        raise HTTPException(status_code=400, detail="You're not booked on this shift.")

    open_entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift.id,
            TimeEntry.worker_id == user.id,
            TimeEntry.clock_out_time.is_(None),
        )
    )
    if open_entry is not None:
        return ClockResult(
            status="already_clocked_in",
            message="You're already clocked in.",
            entry=TimeEntryResponse.model_validate(open_entry),
            geo_status=open_entry.clock_in_geo_status,
            distance_m=open_entry.clock_in_distance_m,
            late_minutes=late_minutes(open_entry.clock_in_time, shift.start_time),
        )

    if (shift.status or "").upper() == "CANCELLED" or (event is not None and event.cancelled_at is not None):
        raise HTTPException(status_code=400, detail="This shift was cancelled.")

    now = datetime.now(timezone.utc)
    opens = clock_in_opens_at(shift, venue)
    if now < opens:
        raise HTTPException(status_code=400, detail=f"Too early. You can clock in from {_local_time(opens, venue)}.")
    if now >= as_utc(shift.end_time):
        raise HTTPException(status_code=400, detail="This shift has already ended. Ask your manager to add your hours.")

    geo_status, distance, lat, lng = "not_checked", None, None, None
    place = effective_place(venue, location)
    if geofence_on(event, venue):
        geo_status, distance, lat, lng = _judge(body, venue, place)
        if geo_status == "blocked_no_fix":
            raise HTTPException(
                status_code=400,
                detail="This shift needs your location to clock in. Turn on location for this site in your browser settings and try again.",
            )
        if geo_status == "blocked_far":
            raise HTTPException(
                status_code=400,
                detail=f"You're {fmt_distance(distance)} from {place['name']}. Clock in when you arrive. "
                       "If you're already there, move closer to the entrance or ask your manager to clock you in.",
            )

    try:
        entry = TimeEntry(
            worker_id=user.id,
            shift_id=shift.id,
            clock_in_time=now,
            clock_in_lat=lat,
            clock_in_lng=lng,
            clock_in_distance_m=distance,
            clock_in_geo_status=geo_status,
        )
        db.add(entry)
        req.status = "checked_in"
        if not req.check_in_time:
            req.check_in_time = now
        req.check_in_verified = geo_status == "on_site"
        await db.commit()
        await db.refresh(entry)
    except Exception as e:
        await db.rollback()
        logger.exception("clock_in failed")
        raise HTTPException(status_code=500, detail=f"Could not clock in: {e}")

    late = late_minutes(now, shift.start_time)
    if geo_status == "outside_geofence":
        msg = f"Clocked in. You're {fmt_distance(distance)} from {place['name']}, so your manager will see this clock-in flagged."
    else:
        msg = "Clocked in. Have a great shift!"
    if late:
        msg += f" (Recorded {late} min after start.)"
    return ClockResult(
        status="clocked_in", message=msg, entry=TimeEntryResponse.model_validate(entry),
        geo_status=geo_status, distance_m=distance, late_minutes=late,
    )


async def clock_out(db: AsyncSession, user: User, shift_id, body: Optional[ClockBody]) -> ClockResult:
    shift, venue, event, location = await _context(db, shift_id)
    entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift.id,
            TimeEntry.worker_id == user.id,
            TimeEntry.clock_out_time.is_(None),
        )
    )
    if entry is None:
        raise HTTPException(status_code=400, detail="You're not clocked in on this shift.")
    req = await db.scalar(
        select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == user.id)
    )
    now = datetime.now(timezone.utc)

    try:
        # A mis-tap: clocked out within a minute. Remove the entry instead of logging a 0-hour shift.
        if now - as_utc(entry.clock_in_time) < UNDO_WINDOW:
            await db.execute(delete(TimeEntry).where(TimeEntry.id == entry.id))
            await db.flush()
            remaining = await db.scalar(
                select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == shift.id, TimeEntry.worker_id == user.id)
            )
            if req is not None and not remaining:
                req.status = "approved"
                req.check_in_time = None
                req.check_in_verified = False
            await db.commit()
            return ClockResult(status="undone", message="Clock-in undone (that was under a minute).")

        geo_status, distance, lat, lng = "not_checked", None, None, None
        if geofence_on(event, venue) and body is not None and body.latitude is not None:
            geo_status, distance, lat, lng = _judge(body, venue, effective_place(venue, location))
            if geo_status == "blocked_far":
                geo_status = "outside_geofence"   # never block a clock-out; just flag it
            if geo_status == "blocked_no_fix":
                geo_status = "not_checked"

        entry.clock_out_time = now
        entry.clock_out_lat = lat
        entry.clock_out_lng = lng
        entry.clock_out_distance_m = distance
        entry.clock_out_geo_status = geo_status
        if req is not None:
            was_completed = (req.status or "").lower() == "completed"
            req.status = "completed"
            req.check_out_time = now
            req.check_out_verified = geo_status == "on_site"
            if not was_completed:
                user.total_shifts = (user.total_shifts or 0) + 1
        await db.commit()
        await db.refresh(entry)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("clock_out failed")
        raise HTTPException(status_code=500, detail=f"Could not clock out: {e}")

    return ClockResult(
        status="clocked_out", message="Clocked out. Thanks for your shift!",
        entry=TimeEntryResponse.model_validate(entry), geo_status=geo_status, distance_m=distance,
    )


async def auto_close_open_entries(db: AsyncSession, venue_id=None, worker_id=None) -> int:
    """
    Closes entries still open `venue.auto_clock_out_hours` after the scheduled end.
    The clock-out is set to the SCHEDULED END and flagged (auto_closed=True, status 'auto').
    Safe to call from any endpoint; failures are logged and never break the caller.
    """
    now = datetime.now(timezone.utc)
    q = (
        select(TimeEntry, Shift, Venue)
        .join(Shift, TimeEntry.shift_id == Shift.id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(TimeEntry.clock_out_time.is_(None), Shift.end_time < now)
    )
    if venue_id is not None:
        q = q.where(Shift.venue_id == venue_id)
    if worker_id is not None:
        q = q.where(TimeEntry.worker_id == worker_id)
    try:
        rows = (await db.execute(q)).all()
        closed = 0
        for entry, shift, venue in rows:
            end = as_utc(shift.end_time)
            if now < end + timedelta(hours=int(venue.auto_clock_out_hours or 2)):
                continue
            entry.clock_out_time = max(end, as_utc(entry.clock_in_time))
            entry.clock_out_geo_status = "auto"
            entry.auto_closed = True
            req = await db.scalar(
                select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == entry.worker_id)
            )
            if req is not None and (req.status or "").lower() == "checked_in":
                req.status = "completed"
                req.check_out_time = entry.clock_out_time
                worker = await db.scalar(select(User).where(User.id == entry.worker_id))
                if worker is not None:
                    worker.total_shifts = (worker.total_shifts or 0) + 1
            closed += 1
        if closed:
            await db.commit()
        return closed
    except Exception:
        await db.rollback()
        logger.exception("auto_close_open_entries failed")
        return 0
```


---

## B3. NEW FILE `backend/src/routers/locations.py`

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/api/venues/{venue_id}/locations?include_archived=false` | manager of venue / admin | List (with `event_count`, `upcoming_count`) |
| POST | `/api/venues/{venue_id}/locations` | same | Add (`VenueLocationInput`) |
| PATCH | `/api/venues/{venue_id}/locations/{location_id}` | same | **Global** edit (`VenueLocationUpdate`); flags upcoming events "Updated" |
| POST | `/api/venues/{venue_id}/locations/{location_id}/archive` | same | Hide from the picker (events keep it) |
| POST | `/api/venues/{venue_id}/locations/{location_id}/unarchive` | same | Bring back |

There is no hard delete, so time sheets and payroll history stay accurate.


```python
"""
Phase 27: A venue's saved locations (client sites, off-site events, second rooms).
Managers of the venue and platform admins only.
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, VenueLocation
from src.schemas import VenueLocationInput, VenueLocationUpdate, VenueLocationResponse
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.locations import create_location, update_location, usage_counts, to_response

router = APIRouter(prefix="/api/venues", tags=["Locations"])


async def _venue(db: AsyncSession, venue_id: UUID, user: User) -> Venue:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not await can_manage_venue(db, user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return venue


async def _location(db: AsyncSession, venue: Venue, location_id: UUID) -> VenueLocation:
    loc = await db.scalar(select(VenueLocation).where(VenueLocation.id == location_id))
    if loc is None or loc.venue_id != venue.id:
        raise HTTPException(status_code=404, detail="Location not found.")
    return loc


async def _respond(db: AsyncSession, loc: VenueLocation) -> VenueLocationResponse:
    counts = await usage_counts(db, [loc.id])
    return to_response(loc, counts)


@router.get("/{venue_id}/locations", response_model=List[VenueLocationResponse])
async def list_locations(
    venue_id: UUID,
    include_archived: bool = Query(False),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    q = select(VenueLocation).where(VenueLocation.venue_id == venue.id)
    if not include_archived:
        q = q.where(VenueLocation.is_archived == False)
    rows = (await db.execute(q.order_by(VenueLocation.is_archived.asc(), VenueLocation.name.asc()))).scalars().all()
    counts = await usage_counts(db, [r.id for r in rows])
    return [to_response(r, counts) for r in rows]


@router.post("/{venue_id}/locations", response_model=VenueLocationResponse, status_code=status.HTTP_201_CREATED)
async def add_location(
    venue_id: UUID,
    body: VenueLocationInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    try:
        loc = await create_location(db, venue.id, body)
        await db.commit()
        await db.refresh(loc)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save location: {e}")
    return await _respond(db, loc)


@router.patch("/{venue_id}/locations/{location_id}", response_model=VenueLocationResponse)
async def edit_location(
    venue_id: UUID,
    location_id: UUID,
    body: VenueLocationUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Global edit: every event at this location changes. Upcoming events are flagged 'Updated'."""
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
    try:
        await update_location(db, loc, body)
        await db.commit()
        await db.refresh(loc)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update location: {e}")
    return await _respond(db, loc)


@router.post("/{venue_id}/locations/{location_id}/archive", response_model=VenueLocationResponse)
async def archive_location(
    venue_id: UUID,
    location_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hide from the picker. Events already using it keep it."""
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
    try:
        loc.is_archived = True
        await db.commit()
        await db.refresh(loc)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not archive location: {e}")
    return await _respond(db, loc)


@router.post("/{venue_id}/locations/{location_id}/unarchive", response_model=VenueLocationResponse)
async def unarchive_location(
    venue_id: UUID,
    location_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
    try:
        loc.is_archived = False
        await db.commit()
        await db.refresh(loc)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not restore location: {e}")
    return await _respond(db, loc)
```


---

## B4. `backend/src/main.py` (EDITS)

Register the locations router. Change nothing else.

**Edit 1.** Find:
```python
from src.routers.listings import router as listings_router
from src.routers.me import router as me_router


```
Replace with:
```python
from src.routers.listings import router as listings_router
from src.routers.me import router as me_router
from src.routers.locations import router as locations_router


```

**Edit 2.** Find:
```python
app.include_router(listings_router)
app.include_router(me_router)


```
Replace with:
```python
app.include_router(listings_router)
app.include_router(me_router)
app.include_router(locations_router)


```


---

## B5. `backend/src/services/shift_events.py` (FULL FILE REPLACEMENT)

Changes vs. the current file:
- **Create** resolves "Where": a `new_location` is saved to the venue's list; an archived location is refused.
- **Validation:** the geofence mode is validated, and the check is refused when it's on and the location has no map pin.
- **Stored on the event:** `location_id`, `geofence_mode` and `location_staff_notes`.
- **Update** does the same, and records "Location changed: A → B", "Location notes for staff updated" and "Clock-in location check turned on/off" in the 26.2 change tracking.
- **Detail** returns `location`, `geofence_mode`, `geofence_on` and `location_staff_notes`.
- **Duplicate** copies them (archived locations are allowed on copies).
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

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, User, VenueLocation
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
)
from src.services.locations import (
    resolve_event_location, validate_geofence_mode, check_geofence_possible, geofence_on,
    usage_counts, to_response as location_response,
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


async def create_event_with_positions(
    db: AsyncSession, venue: Venue, user: User, data: EventCreate, allow_archived_location: bool = False,
) -> ShiftEvent:
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)
    mode = validate_geofence_mode(data.geofence_mode)
    try:
        # Phase 27: where is it? (a typed-in new location is saved to the venue's list here)
        location = await resolve_event_location(
            db, venue, data.location_id, data.new_location,
            current_location_id=data.location_id if allow_archived_location else None,
        )
        check_geofence_possible(mode, venue, location)
        event = ShiftEvent(
            venue_id=venue.id,
            created_by_user_id=user.id,
            title=data.title.strip()[:255],
            start_time=_as_utc(data.start_time),
            end_time=_as_utc(data.end_time),
            notes=_clean(data.notes),
            staff_notes=_clean(data.staff_notes),
            location_id=location.id if location is not None else None,
            geofence_mode=mode,
            location_staff_notes=_clean(data.location_staff_notes),
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
        venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
        tz_name = venue.timezone or "America/New_York"
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

        # Phase 27: location, location notes for staff, and the clock-in location check
        mode = validate_geofence_mode(data.geofence_mode)
        old_location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
        new_location = await resolve_event_location(
            db, venue, data.location_id, data.new_location, current_location_id=event.location_id,
        )
        check_geofence_possible(mode, venue, new_location)
        old_loc_id = old_location.id if old_location is not None else None
        new_loc_id = new_location.id if new_location is not None else None
        if old_loc_id != new_loc_id:
            old_name = old_location.name if old_location is not None else "venue address"
            new_name = new_location.name if new_location is not None else "venue address"
            changes.append(f"Location changed: {old_name} → {new_name}")
        if _clean(event.location_staff_notes) != _clean(data.location_staff_notes):
            changes.append("Location notes for staff updated")
        was_on = geofence_on(event, venue)
        event.geofence_mode = mode
        now_on = geofence_on(event, venue)
        if was_on != now_on:
            changes.append("Clock-in location check turned " + ("on" if now_on else "off"))
        event.location_id = new_loc_id
        event.location_staff_notes = _clean(data.location_staff_notes)

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
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
    loc_counts = await usage_counts(db, [location.id]) if location is not None else {}
    return EventDetail(
        id=event.id,
        venue_id=event.venue_id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        notes=event.notes,
        staff_notes=event.staff_notes,
        location=location_response(location, loc_counts) if location is not None else None,
        geofence_mode=event.geofence_mode or "venue_default",
        geofence_on=geofence_on(event, venue) if venue is not None else False,
        location_staff_notes=event.location_staff_notes,
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
            location_id=event.location_id,
            geofence_mode=event.geofence_mode or "venue_default",
            location_staff_notes=event.location_staff_notes,
            positions=positions,
        ), allow_archived_location=True)
        created.append(ev)
    return created
```


---

## B6. `backend/src/routers/shifts.py` (EDITS)

- `POST /api/shifts/{shift_id}/clock-in` and `/clock-out` now take an **optional** JSON body `{latitude, longitude, accuracy_m}` and return `ClockResult` (`status`, `message`, `entry`, `geo_status`, `distance_m`, `late_minutes`).
- The legacy `/check-in` and `/check-out` endpoints now go through the same rules, so there's no bypass.
- `GET /api/shifts/time-entries/active` runs the auto clock-out sweep first.

**Edit 1.** Find:
```python
    CheckInRequest, CheckOutRequest, TimeEntryResponse,
    ShiftBoardMessageCreate, ShiftBoardMessageResponse,
    EventCreate, EventPositionInput
)
from src.auth import get_current_user, require_manager_or_admin, require_worker, normalize_role
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services.shift_events import create_event_with_positions
from src.services.shift_views import to_shift_responses
from src.services.booking import request_position, withdraw_other_pending_in_event

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```
Replace with:
```python
    CheckInRequest, CheckOutRequest, TimeEntryResponse,
    ShiftBoardMessageCreate, ShiftBoardMessageResponse,
    EventCreate, EventPositionInput,
    ClockBody, ClockResult,
)
from src.auth import get_current_user, require_manager_or_admin, require_worker, normalize_role
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services.shift_events import create_event_with_positions
from src.services.shift_views import to_shift_responses
from src.services.booking import request_position, withdraw_other_pending_in_event
from src.services.clock import clock_in, clock_out, auto_close_open_entries

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```

**Edit 2.** Find:
```python
    }

@router.post("/{shift_id}/check-in", response_model=ShiftRequestResponse)
async def check_in_shift(
```
Replace with:
```python
    }

async def _my_request_response(db: AsyncSession, shift_id: UUID, user: User) -> ShiftRequest:
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == user.id)
    )
    req = res.scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Shift request not found")
    return req


@router.post("/{shift_id}/check-in", response_model=ShiftRequestResponse)
async def check_in_shift(
```

**Edit 3.** Find:
```python
    db: AsyncSession = Depends(get_db)
):
    """Check in to an approved shift with GPS validation"""
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == current_user.id)
    )
    shift_req = res.scalar_one_or_none()
    if not shift_req or str(shift_req.status).lower() not in ("approved", "confirmed"):
        raise HTTPException(status_code=400, detail="Only approved shifts can be checked into")

    shift_req.status = "checked_in"
    shift_req.check_in_time = datetime.utcnow()
    shift_req.check_in_verified = True
    await db.commit()
    await db.refresh(shift_req)
    return shift_req

@router.post("/{shift_id}/check-out", response_model=ShiftRequestResponse)
```
Replace with:
```python
    db: AsyncSession = Depends(get_db)
):
    """Legacy alias. Phase 27: same rules as /clock-in (window + opt-in geofence)."""
    await clock_in(db, current_user, shift_id, ClockBody(latitude=coords.latitude, longitude=coords.longitude))
    return await _my_request_response(db, shift_id, current_user)

@router.post("/{shift_id}/check-out", response_model=ShiftRequestResponse)
```

**Edit 4.** Find:
```python
    db: AsyncSession = Depends(get_db)
):
    """Check out of a shift, completing it and incrementing total shifts"""
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == current_user.id)
    )
    shift_req = res.scalar_one_or_none()
    if not shift_req:
        raise HTTPException(status_code=404, detail="Shift request not found")

    shift_req.status = "completed"
    shift_req.check_out_time = datetime.utcnow()
    shift_req.check_out_verified = True
    current_user.total_shifts += 1
    await db.commit()
    await db.refresh(shift_req)
    return shift_req

# ------------------------------------------------------------------------------
```
Replace with:
```python
    db: AsyncSession = Depends(get_db)
):
    """Legacy alias. Phase 27: same rules as /clock-out."""
    await clock_out(db, current_user, shift_id, ClockBody(latitude=coords.latitude, longitude=coords.longitude))
    return await _my_request_response(db, shift_id, current_user)

# ------------------------------------------------------------------------------
```

**Edit 5.** Find:
```python
# Phase 13: Hour Tracking (Clock In / Clock Out)
# ------------------------------------------------------------------------------
@router.post("/{shift_id}/clock-in", response_model=TimeEntryResponse)
async def clock_in_shift_time(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Verify the user is assigned to the shift.
    Create a new TimeEntry setting clock_in_time to datetime.now(timezone.utc).
    """
    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id,
            func.lower(ShiftRequest.status).in_([
                "approved", "checked_in", "confirmed"
            ])
        )
    )
    if not req:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are not assigned to this shift."
        )

    # Check if there is already an active clock-in
    active_entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift_id,
            TimeEntry.worker_id == current_user.id,
            TimeEntry.clock_out_time.is_(None)
        )
    )
    if active_entry:
        return active_entry

    now_utc = datetime.now(timezone.utc)
    entry = TimeEntry(
        worker_id=current_user.id,
        shift_id=shift_id,
        clock_in_time=now_utc
    )
    db.add(entry)

    # Synchronize ShiftRequest check-in status
    req.status = "checked_in"
    if not req.check_in_time:
        req.check_in_time = now_utc
    req.check_in_verified = True

    await db.commit()
    await db.refresh(entry)
    return entry

@router.post("/{shift_id}/clock-out", response_model=TimeEntryResponse)
async def clock_out_shift_time(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Find the active TimeEntry for this user and shift. Set clock_out_time to current UTC time.
    """
    entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift_id,
            TimeEntry.worker_id == current_user.id,
            TimeEntry.clock_out_time.is_(None)
        )
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active clock-in found for this shift."
        )

    now_utc = datetime.now(timezone.utc)
    entry.clock_out_time = now_utc

    # Synchronize ShiftRequest check-out status
    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id
        )
    )
    if req:
        req.status = "completed"
        req.check_out_time = now_utc
        req.check_out_verified = True

    current_user.total_shifts += 1

    await db.commit()
    await db.refresh(entry)
    return entry

@router.get("/{shift_id}/time-entry", response_model=Optional[TimeEntryResponse])
```
Replace with:
```python
# Phase 13: Hour Tracking (Clock In / Clock Out)
# ------------------------------------------------------------------------------
@router.post("/{shift_id}/clock-in", response_model=ClockResult)
async def clock_in_shift_time(
    shift_id: UUID,
    body: Optional[ClockBody] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 27: Clock in. Allowed from venue.clock_in_early_minutes before start until the scheduled end.
    If the location check is on for this event, body must carry latitude/longitude:
    inside radius = on site, inside radius + buffer = accepted but flagged, beyond = blocked.
    """
    return await clock_in(db, current_user, shift_id, body)

@router.post("/{shift_id}/clock-out", response_model=ClockResult)
async def clock_out_shift_time(
    shift_id: UUID,
    body: Optional[ClockBody] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 27: Clock out. Never blocked by location (only flagged). Under a minute = undo."""
    return await clock_out(db, current_user, shift_id, body)

@router.get("/{shift_id}/time-entry", response_model=Optional[TimeEntryResponse])
```

**Edit 6.** Find:
```python
):
    """Retrieve all open clock-ins for current worker"""
    res = await db.execute(
        select(TimeEntry)
```
Replace with:
```python
):
    """Retrieve all open clock-ins for current worker"""
    await auto_close_open_entries(db, worker_id=current_user.id)   # Phase 27
    res = await db.execute(
        select(TimeEntry)
```


---

## B7. `backend/src/services/timesheets.py` (EDITS)

The time sheet runs the auto clock-out sweep, and each entry carries its location flags, `auto_closed` and `late_minutes`.

**Edit 1.** Find:
```python
from src.models import ShiftEvent, Shift, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EventTimesheet, TimesheetPerson, TimeEntryRow

ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
```
Replace with:
```python
from src.models import ShiftEvent, Shift, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EventTimesheet, TimesheetPerson, TimeEntryRow
from src.services.clock import auto_close_open_entries, late_minutes

ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
```

**Edit 2.** Find:
```python

async def build_timesheet(db: AsyncSession, event: ShiftEvent, venue: Venue) -> EventTimesheet:
    shifts = (await db.execute(select(Shift).where(Shift.event_id == event.id))).scalars().all()
    by_id = {s.id: s for s in shifts}
```
Replace with:
```python

async def build_timesheet(db: AsyncSession, event: ShiftEvent, venue: Venue) -> EventTimesheet:
    await auto_close_open_entries(db, venue_id=venue.id)   # Phase 27
    shifts = (await db.execute(select(Shift).where(Shift.event_id == event.id))).scalars().all()
    by_id = {s.id: s for s in shifts}
```

**Edit 3.** Find:
```python
                    id=e.id, clock_in_time=e.clock_in_time, clock_out_time=e.clock_out_time,
                    hours=round(entry_hours(e), 2), edited=e.id in edited_ids,
                )
                for e in es
```
Replace with:
```python
                    id=e.id, clock_in_time=e.clock_in_time, clock_out_time=e.clock_out_time,
                    hours=round(entry_hours(e), 2), edited=e.id in edited_ids,
                    clock_in_geo_status=e.clock_in_geo_status,
                    clock_in_distance_m=e.clock_in_distance_m,
                    clock_out_geo_status=e.clock_out_geo_status,
                    clock_out_distance_m=e.clock_out_distance_m,
                    auto_closed=bool(e.auto_closed),
                    late_minutes=late_minutes(e.clock_in_time, s.start_time),
                )
                for e in es
```


---

## B8. `backend/src/routers/timesheets.py` (EDITS)

Manager-added times, and times a manager changes, are marked `manager` (the override).

**Edit 1.** Find:
```python
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    try:
        entry = TimeEntry(worker_id=req.worker_id, shift_id=req.shift_id, clock_in_time=cin, clock_out_time=cout)
        db.add(entry)
        await db.flush()
```
Replace with:
```python
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    try:
        entry = TimeEntry(
            worker_id=req.worker_id, shift_id=req.shift_id, clock_in_time=cin, clock_out_time=cout,
            clock_in_geo_status="manager",                                   # Phase 27: manager override
            clock_out_geo_status="manager" if cout is not None else None,
        )
        db.add(entry)
        await db.flush()
```

**Edit 2.** Find:
```python
    try:
        old = fmt_range(entry.clock_in_time, entry.clock_out_time)
        entry.clock_in_time = cin
        entry.clock_out_time = cout
```
Replace with:
```python
    try:
        old = fmt_range(entry.clock_in_time, entry.clock_out_time)
        # Phase 27: a time the manager typed in is a manager override
        if as_utc(entry.clock_in_time) != cin:
            entry.clock_in_geo_status = "manager"
        if cout is not None and (entry.clock_out_time is None or as_utc(entry.clock_out_time) != cout):
            entry.clock_out_geo_status = "manager"
            entry.auto_closed = False
        entry.clock_in_time = cin
        entry.clock_out_time = cout
```


---

## B9. `backend/src/routers/venues.py` (EDITS)

Payroll CSV: sweep plus the new columns. Posted Shifts events get `location_name`. Roster read-receipts count location notes.

**Edit 1.** Find:
```python
from src.services.shift_views import to_shift_responses
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack

router = APIRouter(prefix="/api/venues", tags=["Venues"])
```
Replace with:
```python
from src.services.shift_views import to_shift_responses
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack
from src.services.clock import auto_close_open_entries, late_minutes as clock_late_minutes
from src.services.locations import load_locations

router = APIRouter(prefix="/api/venues", tags=["Venues"])
```

**Edit 2.** Find:
```python
    Phase 19: Hour Tracking & Payroll CSV Export.
    Calculates hours worked for workers at this venue.
    """
    await verify_venue_manager_access(venue_id, current_user, db)

    query = (
```
Replace with:
```python
    Phase 19: Hour Tracking & Payroll CSV Export.
    Calculates hours worked for workers at this venue.
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    """
    await verify_venue_manager_access(venue_id, current_user, db)
    await auto_close_open_entries(db, venue_id=venue_id)

    query = (
```

**Edit 3.** Find:
```python
        )).scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Worker Name", "Email", "Shift Title", "Role", "Date", "Clock In", "Clock Out", "Total Hours",
        "Hourly Rate", "Gross Pay", "Tips Eligible", "Tip Pool", "Edited",
    ])

```
Replace with:
```python
        )).scalars().all())

    # Phase 27: where each event was held
    ev_ids = {r[2].event_id for r in records if r[2].event_id}
    ev_loc = {}
    if ev_ids:
        ev_loc = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.location_id).where(ShiftEvent.id.in_(ev_ids))
        )).all())
    locations = await load_locations(db, ev_loc.values())
    geo_label = {
        "on_site": "On site", "outside_geofence": "Outside geofence", "not_checked": "Not checked",
        "manager": "Manager entry", "auto": "Auto-closed",
    }

    def geo_text(status_value, distance):
        if not status_value:
            return ""
        label = geo_label.get(status_value, status_value)
        return f"{label} ({distance} m)" if (status_value == "outside_geofence" and distance is not None) else label

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Worker Name", "Email", "Shift Title", "Role", "Date", "Work Location", "Clock In", "Clock Out", "Total Hours",
        "Hourly Rate", "Gross Pay", "Tips Eligible", "Tip Pool", "Edited",
        "Clock-In Location Check", "Clock-Out Location Check", "Late (min)", "Auto-Closed",
    ])

```

**Edit 4.** Find:
```python
        else:
            hours = 0.0
        writer.writerow([
            worker_name, worker.email or "", shift.title or "", shift.role_type or "", shift_date, clock_in, clock_out,
            f"{hours:.2f}", f"{rate:.2f}", f"{hours * rate:.2f}",
            "Yes" if shift.tips_eligible else "No",
            "Yes" if shift.tip_pool else "No",
            "Yes" if entry.id in edited_ids else "No",
        ])

```
Replace with:
```python
        else:
            hours = 0.0
        loc = locations.get(ev_loc.get(shift.event_id)) if shift.event_id else None
        writer.writerow([
            worker_name, worker.email or "", shift.title or "", shift.role_type or "", shift_date,
            loc.name if loc is not None else "Venue",
            clock_in, clock_out,
            f"{hours:.2f}", f"{rate:.2f}", f"{hours * rate:.2f}",
            "Yes" if shift.tips_eligible else "No",
            "Yes" if shift.tip_pool else "No",
            "Yes" if entry.id in edited_ids else "No",
            geo_text(entry.clock_in_geo_status, entry.clock_in_distance_m),
            geo_text(entry.clock_out_geo_status, entry.clock_out_distance_m),
            clock_late_minutes(entry.clock_in_time, shift.start_time) or "",
            "Yes" if entry.auto_closed else "No",
        ])

```

**Edit 5.** Find:
```python
            event_cancel[ev_obj.id] = (ev_obj.cancelled_at is not None, ev_obj.cancel_reason)
    venue_obj = await db.scalar(select(Venue).where(Venue.id == venue_id))

    # Phase 26.2: has each booked person read the latest info?
    for s in shifts:
        ev_obj = event_objs.get(s.event_id) if s.event_id else None
        notes_exist = has_any_notes(venue_obj, ev_obj, s)
        updated = latest_info_update(ev_obj, s)
        for person in assigned_by_shift[s.id]:
```
Replace with:
```python
            event_cancel[ev_obj.id] = (ev_obj.cancelled_at is not None, ev_obj.cancel_reason)
    venue_obj = await db.scalar(select(Venue).where(Venue.id == venue_id))
    event_locations = await load_locations(db, [e.location_id for e in event_objs.values()])   # Phase 27

    # Phase 26.2: has each booked person read the latest info?
    for s in shifts:
        ev_obj = event_objs.get(s.event_id) if s.event_id else None
        ev_location = event_locations.get(ev_obj.location_id) if ev_obj is not None and ev_obj.location_id else None
        notes_exist = has_any_notes(venue_obj, ev_obj, s, ev_location)
        updated = latest_info_update(ev_obj, s)
        for person in assigned_by_shift[s.id]:
```

**Edit 6.** Find:
```python
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "staff_notes": event_objs[s.event_id].staff_notes if s.event_id in event_objs else None,
                "cancelled": event_cancel.get(s.event_id, (False, None))[0] if s.event_id else False,
                "cancel_reason": event_cancel.get(s.event_id, (False, None))[1] if s.event_id else None,
```
Replace with:
```python
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "staff_notes": event_objs[s.event_id].staff_notes if s.event_id in event_objs else None,
                "location_name": (
                    event_locations[event_objs[s.event_id].location_id].name
                    if s.event_id in event_objs and event_objs[s.event_id].location_id in event_locations
                    else None
                ),
                "cancelled": event_cancel.get(s.event_id, (False, None))[0] if s.event_id else False,
                "cancel_reason": event_cancel.get(s.event_id, (False, None))[1] if s.event_id else None,
```


---

## B10. `backend/src/services/venue_positions.py` (EDITS)

Validation for the new venue settings:

| Setting | Range |
|---|---|
| buffer | 0–2000 m |
| early clock-in | 0–240 min |
| auto clock-out | 1–12 h |

**Edit 1.** Find:
```python

VALID_APPROVAL_POLICIES = ("manual", "team_auto", "everyone_auto")
NOT_NULL_VENUE_FIELDS = ("name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy")
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
```
Replace with:
```python

VALID_APPROVAL_POLICIES = ("manual", "team_auto", "everyone_auto")
NOT_NULL_VENUE_FIELDS = (
    "name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy",
    "geofence_enabled", "geofence_buffer_meters", "clock_in_early_minutes", "auto_clock_out_hours",   # Phase 27
)
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
```

**Edit 2.** Find:
```python
    if "geofence_radius_meters" in data and not (25 <= int(data["geofence_radius_meters"]) <= 5000):
        raise HTTPException(status_code=400, detail="Clock-in radius must be between 25 and 5000 meters.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
```
Replace with:
```python
    if "geofence_radius_meters" in data and not (25 <= int(data["geofence_radius_meters"]) <= 5000):
        raise HTTPException(status_code=400, detail="Clock-in radius must be between 25 and 5000 meters.")
    # Phase 27: clock-in settings
    if "geofence_buffer_meters" in data and not (0 <= int(data["geofence_buffer_meters"]) <= 2000):
        raise HTTPException(status_code=400, detail="Geofence buffer must be between 0 and 2000 meters.")
    if "clock_in_early_minutes" in data and not (0 <= int(data["clock_in_early_minutes"]) <= 240):
        raise HTTPException(status_code=400, detail="Early clock-in must be between 0 and 240 minutes.")
    if "auto_clock_out_hours" in data and not (1 <= int(data["auto_clock_out_hours"]) <= 12):
        raise HTTPException(status_code=400, detail="Auto clock-out must be between 1 and 12 hours after the shift ends.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
```


---

## B11. `backend/src/services/worker_calendar.py` (FULL FILE REPLACEMENT)

Changes vs. the current file:
- Items carry `location`, `location_staff_notes` (booked only), `geofence_on`, `clock_in_opens_at` and `time_entry_id`.
- "Please read" now counts location notes and event-specific location notes.
- Arrival instructions are sent only for booked shifts.
- The auto clock-out sweep runs first.
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
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.clock import auto_close_open_entries, clock_in_opens_at

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


def has_any_notes(venue: Optional[Venue], event: Optional[ShiftEvent], shift: Shift, location=None) -> bool:
    values = [shift.description, shift.staff_notes]
    if event is not None:
        values += [event.notes, event.staff_notes, event.location_staff_notes]   # Phase 27
    if location is not None:
        values.append(location.notes)                                             # Phase 27
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
    await auto_close_open_entries(db, worker_id=user.id)   # Phase 27
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

    open_entries = dict((await db.execute(
        select(TimeEntry.shift_id, TimeEntry.id).where(
            TimeEntry.worker_id == user.id,
            TimeEntry.shift_id.in_([s.id for s in shifts]),
            TimeEntry.clock_out_time.is_(None),
        )
    )).all())
    locations = await load_locations(db, [e.location_id for e in events.values()])   # Phase 27

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
        location = locations.get(event.location_id) if event is not None and event.location_id else None
        loc_staff = event.location_staff_notes if event is not None else None
        updated = latest_info_update(event, s)
        seen = req.info_seen_at
        booked_at = req.approved_at or req.created_at
        flag = needs_ack(
            booked=booked,
            has_notes=has_any_notes(venue, event, s, location),
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
                arrival_instructions=venue.arrival_instructions if booked else None,   # Phase 27: booked only
                default_shift_notes=venue.default_shift_notes,
            ),
            location=to_listing_location(location),
            location_staff_notes=loc_staff if booked else None,
            geofence_on=geofence_on(event, venue),
            clock_in_opens_at=clock_in_opens_at(s, venue),
            time_entry_id=open_entries.get(s.id),
            hourly_rate=float(s.hourly_rate) if (show_pay and s.hourly_rate is not None) else None,
            hourly_rate_max=float(s.hourly_rate_max) if (show_pay and s.hourly_rate_max is not None) else None,
            pay_rate=float(req.pay_rate) if (booked and req.pay_rate is not None) else None,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            event_notes=event.notes if event is not None else None,
            role_notes=s.description,
            event_staff_notes=ev_staff if booked else None,
            position_staff_notes=s.staff_notes if booked else None,
            staff_notes_locked=(not booked) and bool(
                (ev_staff or "").strip() or (s.staff_notes or "").strip() or (loc_staff or "").strip()
            ),
            info_change=change,
            info_updated_at=updated,
            info_seen_at=seen,
            needs_ack=flag,
            clocked_in=s.id in open_entries,
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


---

## B12. `backend/src/services/listings.py` (FULL FILE REPLACEMENT)

Changes vs. the current file:
- Listings carry `location`, `location_staff_notes` (booked viewers only) and `geofence_on`.
- **Venue arrival instructions are only sent to viewers booked in the event** (privacy fix).
```python
"""
Phase 26.1: Worker-facing event listings. One listing = one event with its positions.

* Never exposes other workers (only counts).
* Hidden pay stays hidden unless the viewer is booked on that position, manages the venue,
  or is an admin.
* `booking` tells THIS viewer whether a position books instantly or needs approval
  (same decision function the request endpoint uses).
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, VenueWhitelist, User, RequestStatus
from src.schemas import EventListing, ListingPosition, ListingVenue, ListingMyRequest
from src.services.auto_confirm import decide_approval
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
)

MAX_EVENTS = 200
WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")


def _f(v) -> Optional[float]:
    return float(v) if v is not None else None


async def build_listings(
    db: AsyncSession,
    user: User,
    *,
    venue_id: Optional[UUID] = None,
    days: int = 60,
    event_id: Optional[UUID] = None,
) -> List[EventListing]:
    """
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    """
    now = datetime.now(timezone.utc)

    q = select(ShiftEvent)
    if event_id is not None:
        q = q.where(ShiftEvent.id == event_id)
    else:
        q = q.where(
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.start_time > now,
            ShiftEvent.start_time <= now + timedelta(days=days),
        )
        if venue_id is not None:
            q = q.where(ShiftEvent.venue_id == venue_id)
        q = q.order_by(ShiftEvent.start_time.asc()).limit(MAX_EVENTS)
    events = (await db.execute(q)).scalars().all()
    if not events:
        return []

    event_ids = [e.id for e in events]
    venue_ids = {e.venue_id for e in events}

    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id.in_(event_ids), func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    shifts_by_event = defaultdict(list)
    for s in shifts:
        shifts_by_event[s.event_id].append(s)

    venues = {
        v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()
    }

    # The viewer's own requests on these positions
    mine = {}
    if shifts:
        for r in (await db.execute(
            select(ShiftRequest).where(
                ShiftRequest.worker_id == user.id,
                ShiftRequest.shift_id.in_([s.id for s in shifts]),
            )
        )).scalars().all():
            mine[r.shift_id] = r

    whitelisted = set((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.venue_id.in_(venue_ids),
        )
    )).scalars().all())
    worked = set((await db.execute(
        select(Shift.venue_id)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == user.id,
            Shift.venue_id.in_(venue_ids),
            func.lower(ShiftRequest.status).in_(WORKED_STATUSES),
        )
        .distinct()
    )).scalars().all())

    # Phase 26.3: listings are a WORKER screen. Everyone (admins and managers included) gets worker
    # rules: hidden pay and staff-only notes are shown only on a position the viewer is booked on.

    # The viewer's booked shifts, for "overlaps your shift" warnings
    bookings = (await db.execute(
        select(Shift.event_id, Shift.title, Shift.start_time, Shift.end_time, Venue.name)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.end_time > now,
        )
    )).all()

    locations = await load_locations(db, [e.location_id for e in events])   # Phase 27

    out: List[EventListing] = []
    for ev in events:
        venue = venues.get(ev.venue_id)
        if venue is None:
            continue
        ev_shifts = shifts_by_event.get(ev.id, [])
        start, end = as_utc(ev.start_time), as_utc(ev.end_time)
        hours = round(max(0.0, (end - start).total_seconds() / 3600.0), 2)

        positions: List[ListingPosition] = []
        my_request: Optional[ListingMyRequest] = None
        for s in ev_shifts:
            r = mine.get(s.id)
            my_status = (r.status or "").lower() if r is not None else None
            if r is not None and my_status in ACTIVE_STATUSES:
                my_request = ListingMyRequest(
                    request_id=r.id, shift_id=s.id, role_type=s.role_type,
                    status=my_status, note=r.notes,
                )
            booked_here = my_status in ASSIGNED_STATUSES
            visible = (not s.hide_rate) or booked_here
            rate = _f(s.hourly_rate) if visible else None
            rate_max = _f(s.hourly_rate_max) if visible else None
            cap = s.capacity if s.capacity is not None else 1
            left = max(0, cap - (s.spots_filled or 0))
            is_open = (s.status or "").upper() == "OPEN" and left > 0
            decision, _src = decide_approval(s, venue, user, venue.id in whitelisted)
            positions.append(ListingPosition(
                shift_id=s.id,
                role_type=s.role_type or "Worker",
                role_notes=s.description,
                hourly_rate=rate,
                hourly_rate_max=rate_max,
                hide_rate=bool(s.hide_rate),
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
                capacity=cap,
                spots_left=left,
                status="OPEN" if is_open else "FILLED",
                booking="instant" if decision == RequestStatus.APPROVED else "approval",
                est_pay_min=round(rate * hours, 2) if rate is not None else None,
                est_pay_max=round((rate_max or rate) * hours, 2) if rate is not None else None,
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
                staff_notes=s.staff_notes if booked_here else None,
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        if event_id is None and not open_positions and my_request is None:
            continue   # list mode: nothing to request and nothing of mine here

        conflict = None
        if my_request is None or my_request.status not in ASSIGNED_STATUSES:
            for b_event_id, b_title, b_start, b_end, b_venue in bookings:
                if b_event_id == ev.id:
                    continue
                if as_utc(b_start) < end and as_utc(b_end) > start:
                    conflict = f"{b_venue} · {b_title}"
                    break

        priced = [p for p in positions if p.hourly_rate is not None]
        started = start <= now
        cancelled = ev.cancelled_at is not None
        can_request = (
            not cancelled
            and not started
            and bool(open_positions)
            and conflict is None
            and (my_request is None or my_request.status in PENDING_STATUSES)
        )

        out.append(EventListing(
            event_id=ev.id,
            title=ev.title,
            notes=ev.notes,
            start_time=ev.start_time,
            end_time=ev.end_time,
            hours=hours,
            venue=ListingVenue(
                id=venue.id,
                name=venue.name,
                address=venue.address,
                timezone=venue.timezone or "America/New_York",
                logo_url=venue.logo_url,
                phone=venue.phone,
                lat=_f(venue.lat),
                lng=_f(venue.lng),
                dress_code=venue.dress_code,
                # Phase 27: arrival instructions are for booked staff only (as Venue Settings promises)
                arrival_instructions=venue.arrival_instructions if (
                    my_request is not None and my_request.status in ASSIGNED_STATUSES
                ) else None,
                default_shift_notes=venue.default_shift_notes,
            ),
            positions=positions,
            total_capacity=sum(p.capacity for p in positions),
            total_spots_left=sum(p.spots_left for p in open_positions),
            open_positions=len(open_positions),
            pay_min=min((p.hourly_rate for p in priced), default=None),
            pay_max=max(((p.hourly_rate_max or p.hourly_rate) for p in priced), default=None),
            any_tips=any(p.tips_eligible for p in positions),
            any_instant=any(p.booking == "instant" for p in open_positions),
            on_team=(venue.id in whitelisted) or (venue.id in worked),
            my_request=my_request,
            conflict=conflict,
            cancelled=cancelled,
            cancel_reason=ev.cancel_reason,
            started=started,
            can_request=can_request,
            staff_notes=ev.staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
            ) else None,
            location=to_listing_location(locations.get(ev.location_id)) if ev.location_id else None,   # Phase 27
            location_staff_notes=ev.location_staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
            ) else None,
            geofence_on=geofence_on(ev, venue),
        ))
    return out
```


---

## B13. `backend/src/services/venue_public.py` (EDITS)

Public venue events show the location name.

**Edit 1.** Find:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Venue, Shift, ShiftRequest, VenuePosition, VenueManager, User, ShiftEvent
from src.auth import normalize_role
from src.schemas import (
```
Replace with:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Venue, Shift, ShiftRequest, VenuePosition, VenueManager, User, ShiftEvent, VenueLocation
from src.auth import normalize_role
from src.schemas import (
```

**Edit 2.** Find:
```python

    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes = {}
    if event_ids:
        event_notes = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes).where(ShiftEvent.id.in_(event_ids))
        )).all())

    events, order = {}, []
```
Replace with:
```python

    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes, event_loc_names = {}, {}
    if event_ids:
        for eid, enotes, loc_name in (await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes, VenueLocation.name)
            .outerjoin(VenueLocation, VenueLocation.id == ShiftEvent.location_id)
            .where(ShiftEvent.id.in_(event_ids))
        )).all():
            event_notes[eid] = enotes
            event_loc_names[eid] = loc_name        # Phase 27

    events, order = {}, []
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
                "location_name": event_loc_names.get(s.event_id) if s.event_id else None,
                "title": s.title or "Shift",
                "start_time": s.start_time,
```


---

## B14. `backend/src/seed.py` (EDITS)

Seed shifts land on the weekday in their title, at sensible local times. This only affects newly created seed rows.

**Edit 1.** Find:
```python
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
```
Replace with:
```python
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
```

**Edit 2.** Find:
```python

logger = logging.getLogger("shiftboard.seed")

async def seed_initial_data(db: AsyncSession):
```
Replace with:
```python

logger = logging.getLogger("shiftboard.seed")


def _next_local(weekday: int, hour: int, tz_name: str, hours_long: int):
    """
    Phase 27: next <weekday> (Mon=0 … Sun=6) at <hour>:00 in the venue's timezone, at least 12h away,
    so seed titles like "Friday Evening Barback" land on an actual Friday.
    Returns (start_utc, end_utc).
    """
    tz = ZoneInfo(tz_name or "America/New_York")
    now_local = datetime.now(timezone.utc).astimezone(tz)
    days_ahead = (weekday - now_local.weekday()) % 7
    start_local = (now_local + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    if start_local - now_local < timedelta(hours=12):
        start_local += timedelta(days=7)
    start_utc = start_local.astimezone(timezone.utc)
    return start_utc, start_utc + timedelta(hours=hours_long)

async def seed_initial_data(db: AsyncSession):
```

**Edit 3.** Find:
```python
                    title="Saturday Night Bartending",
                    role_type="Bartender",
                    start_time=now_utc + timedelta(days=2, hours=4),
                    end_time=now_utc + timedelta(days=2, hours=10),
                    hourly_rate=38.00,
                    capacity=3,
```
Replace with:
```python
                    title="Saturday Night Bartending",
                    role_type="Bartender",
                    start_time=_next_local(5, 18, demo_venue.timezone, 6)[0],   # Saturday 6 PM
                    end_time=_next_local(5, 18, demo_venue.timezone, 6)[1],
                    hourly_rate=38.00,
                    capacity=3,
```

**Edit 4.** Find:
```python
                    title="Sunday Brunch Serving",
                    role_type="Server",
                    start_time=now_utc + timedelta(days=3, hours=2),
                    end_time=now_utc + timedelta(days=3, hours=8),
                    hourly_rate=32.00,
                    capacity=3,
```
Replace with:
```python
                    title="Sunday Brunch Serving",
                    role_type="Server",
                    start_time=_next_local(6, 10, demo_venue.timezone, 6)[0],   # Sunday 10 AM
                    end_time=_next_local(6, 10, demo_venue.timezone, 6)[1],
                    hourly_rate=32.00,
                    capacity=3,
```

**Edit 5.** Find:
```python
                    title="Friday Evening Barback",
                    role_type="Barback",
                    start_time=now_utc + timedelta(days=1, hours=5),
                    end_time=now_utc + timedelta(days=1, hours=11),
                    hourly_rate=28.00,
                    capacity=2,
```
Replace with:
```python
                    title="Friday Evening Barback",
                    role_type="Barback",
                    start_time=_next_local(4, 17, demo_venue.timezone, 6)[0],   # Friday 5 PM
                    end_time=_next_local(4, 17, demo_venue.timezone, 6)[1],
                    hourly_rate=28.00,
                    capacity=2,
```


---

## C1. NEW FILE `frontend/src/utils/geo.js`

Two helpers:
- `getCurrentPosition()` returns a promise with friendly error messages.
- `parseMapLink()` reads coordinates from a pasted Google/Apple Maps link or "lat, lng".
```javascript
/**
 * Phase 27: Ask the phone/browser for the current position.
 * Resolves { latitude, longitude, accuracy_m }. Rejects with an Error whose message is ready to show.
 */
export function getCurrentPosition({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share its location. Try Chrome or Safari on your phone."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }),
      (err) => {
        if (err.code === 1) {
          reject(new Error('Location is blocked for this site. Allow location in your browser settings, then try again.'));
        } else if (err.code === 3) {
          reject(new Error("Couldn't get your location in time. Step outside or near a window and try again."));
        } else {
          reject(new Error("Couldn't get your location. Check that location services are on, then try again."));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/**
 * Pulls coordinates out of a pasted Google/Apple Maps link or a "lat, lng" string.
 * Returns { lat, lng } or null.
 */
export function parseMapLink(text) {
  if (!text) return null;
  const s = String(text).trim();
  const patterns = [
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,                 // .../@40.72,-74.00,17z
    /[?&](?:q|query|ll|sll|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // ?q=40.72,-74.00
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,                // ...!3d40.72!4d-74.00
    /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/,             // "40.72, -74.00"
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}
```


---

## C2. `frontend/src/utils/listingFormat.js` (EDIT: append)

Adds:
- `whereOf(item)`: the event location if set, otherwise the venue
- `GEO_LABELS`
- `metersText()`

**Edit 1.** Find:
```javascript
  return { key: 'booked', chip: 'bg-emerald-500/20 text-emerald-100 border-emerald-500/60', dot: 'bg-emerald-400', label: 'Confirmed' };
}

```
Replace with:
```javascript
  return { key: 'booked', chip: 'bg-emerald-500/20 text-emerald-100 border-emerald-500/60', dot: 'bg-emerald-400', label: 'Confirmed' };
}


// ---- Phase 27: where the work happens -----------------------------------------------------

/**
 * The place a worker should go: the event's saved location if it has one, otherwise the venue.
 * Works for EventListing and WorkerCalendarItem (both have `venue` and optional `location`).
 */
export function whereOf(item) {
  const loc = item?.location;
  if (loc) {
    return {
      name: loc.name,
      address: loc.address,
      lat: loc.lat,
      lng: loc.lng,
      notes: loc.notes || null,
      isOffsite: true,
    };
  }
  const v = item?.venue || {};
  return { name: v.name, address: v.address, lat: v.lat, lng: v.lng, notes: null, isOffsite: false };
}

/** "Distance / location" labels used on time sheets and chips. */
export const GEO_LABELS = {
  on_site: 'On site',
  outside_geofence: 'Outside geofence',
  not_checked: 'No location check',
  manager: 'Manager entry',
  auto: 'Auto-closed',
};

export function metersText(m) {
  if (m === null || m === undefined) return '';
  return m < 161 ? `${Math.round(m / 0.3048)} ft` : `${(m / 1609.344).toFixed(1)} mi`;
}
```


---

## C3. NEW FILE `frontend/src/components/LocationFields.jsx`

Reusable location form: name, address, and a map pin set by "I'm there now", a pasted Maps link, or typed lat/lng. Also an optional radius and **location notes**.

It exports:
- `blankLocationDraft`
- `locationToDraft`
- `draftToPayload`
```jsx
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
```


---

## C4. NEW FILE `frontend/src/components/VenueLocationsPanel.jsx`

Venue Settings → **Locations** tab: list, add, edit (global) and archive/restore. It also exports `locationPatchBody()`, which the event picker uses.
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Pencil, Archive, RotateCcw, X, Save, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import LocationFields, { blankLocationDraft, locationToDraft, draftToPayload } from './LocationFields';

/** Build a PATCH body for a global edit (clears pin / radius when the field was emptied). */
export function locationPatchBody(original, payload) {
  const body = { name: payload.name, address: payload.address, notes: payload.notes ?? '' };
  if (payload.lat === null) {
    if (original?.lat != null) body.clear_pin = true;
  } else {
    body.lat = payload.lat;
    body.lng = payload.lng;
  }
  if (payload.radius_meters === null) {
    if (original?.radius_meters != null) body.clear_radius = true;
  } else {
    body.radius_meters = payload.radius_meters;
  }
  return body;
}

function LocationRow({ venue, loc, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(locationToDraft(loc));
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(locationToDraft(loc)), [loc]);

  const save = async () => {
    const { payload, error } = draftToPayload(draft);
    if (error) return onError(error);
    setBusy(true);
    try {
      await api.patch(`/venues/${venue.id}/locations/${loc.id}`, locationPatchBody(loc, payload));
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save location.');
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    try {
      await api.post(`/venues/${venue.id}/locations/${loc.id}/${loc.is_archived ? 'unarchive' : 'archive'}`);
      onChanged();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not update location.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`p-3 rounded-xl border ${loc.is_archived ? 'border-slate-800 bg-slate-950 opacity-60' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="truncate">{loc.name}</span>
            {loc.is_archived && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Archived</span>}
          </div>
          <div className="text-xs text-slate-400 truncate">{loc.address}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {loc.lat != null ? 'Pin set' : <span className="text-amber-300">No map pin</span>}
            {loc.radius_meters != null ? ` · ${loc.radius_meters} m radius` : ''}
            {` · used by ${loc.event_count} event${loc.event_count === 1 ? '' : 's'}`}
            {loc.upcoming_count ? ` (${loc.upcoming_count} upcoming)` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!loc.is_archived && !editing && (
            <button type="button" onClick={() => setEditing(true)} title="Edit"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={toggleArchive} disabled={busy} title={loc.is_archived ? 'Bring back' : 'Archive'}
            className="p-2 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10">
            {loc.is_archived ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-3">
          {loc.upcoming_count > 0 && (
            <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Changes apply to every event here. People booked on the {loc.upcoming_count} upcoming event
              {loc.upcoming_count === 1 ? '' : 's'} will be asked to re-read the shift info.
            </p>
          )}
          <LocationFields value={draft} onChange={setDraft} venueRadius={venue.geofence_radius_meters || 150} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(false); setDraft(locationToDraft(loc)); }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button type="button" onClick={save} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save location'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Phase 27: Venue Settings → Locations tab. Review, add, edit (global) and archive saved locations.
 * Locations are also added automatically when a manager types a new one on the event screen.
 */
export default function VenueLocationsPanel({ venue, onError }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankLocationDraft());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/venues/${venue.id}/locations`, { params: { include_archived: true } });
      setRows(res.data || []);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not load locations.');
    } finally {
      setLoading(false);
    }
  }, [venue.id, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const { payload, error } = draftToPayload(draft);
    if (error) return onError(error);
    setBusy(true);
    try {
      await api.post(`/venues/${venue.id}/locations`, payload);
      setDraft(blankLocationDraft());
      setAdding(false);
      load();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not add location.');
    } finally {
      setBusy(false);
    }
  };

  const visible = rows.filter((r) => showArchived || !r.is_archived);
  const archivedCount = rows.filter((r) => r.is_archived).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Places you staff besides your own address: client sites, off-site events, other rooms. Pick them on
        “Post a shift”. Typing a new place there saves it here automatically.
      </p>

      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No saved locations yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((loc) => (
            <LocationRow key={loc.id} venue={venue} loc={loc} onChanged={load} onError={onError} />
          ))}
        </div>
      )}

      {archivedCount > 0 && (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs text-slate-400 underline hover:text-white">
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}

      {adding ? (
        <div className="p-3 rounded-xl border border-dashed border-slate-600 space-y-3">
          <LocationFields value={draft} onChange={setDraft} venueRadius={venue.geofence_radius_meters || 150} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setDraft(blankLocationDraft()); }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
            <button type="button" onClick={add} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">
              {busy ? 'Saving…' : 'Add location'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="px-3 py-2 rounded-xl border border-dashed border-slate-600 text-xs font-semibold text-emerald-400 hover:border-emerald-500 inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add a location
        </button>
      )}
    </div>
  );
}
```


---

## C5. NEW FILE `frontend/src/components/EventLocationPicker.jsx`

The **"Where"** search box for Post / Edit a Shift. It's controlled; `value` is one of:
- `{kind:'venue'}`
- `{kind:'saved', location}`
- `{kind:'new', draft}`

Behavior:
- Typing filters saved locations.
- With **no match**, the new-location fields open inline, and the location is saved to the list when the event saves.
- "Edit this location" does a global PATCH, with a warning.
```jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Building2, Plus, Pencil, Search, AlertTriangle, X, Save } from 'lucide-react';
import api from '../api/client';
import LocationFields, { blankLocationDraft, locationToDraft, draftToPayload } from './LocationFields';
import { locationPatchBody } from './VenueLocationsPanel';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';

/**
 * Phase 27: "Where" on Post / Edit a Shift.
 *
 * value (controlled) is one of:
 *   { kind: 'venue' }                          -> at the venue's own address
 *   { kind: 'saved', location: <saved loc> }   -> a saved location
 *   { kind: 'new',   draft: <LocationFields draft> } -> typed in here; saved to the list when the event saves
 *
 * Typing filters saved locations. If nothing matches, the new-location fields open right here.
 * "Edit this location" changes the saved location everywhere (global edit).
 */
export default function EventLocationPicker({ venue, value, onChange }) {
  const [locations, setLocations] = useState([]);
  const [query, setQuery] = useState(() =>
    value?.kind === 'saved' ? value.location?.name || '' : value?.kind === 'new' ? value.draft?.name || '' : ''
  );
  const [open, setOpen] = useState(false);
  const [forceNew, setForceNew] = useState(value?.kind === 'new');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const blurTimer = useRef(null);

  const loadLocations = () => {
    if (!venue?.id) return;
    api
      .get(`/venues/${venue.id}/locations`)
      .then((res) => setLocations(res.data || []))
      .catch(() => setLocations([]));
  };
  useEffect(loadLocations, [venue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the text box in sync when the parent loads an existing event
  useEffect(() => {
    if (value?.kind === 'saved') setQuery(value.location?.name || '');
    if (value?.kind === 'venue') setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.kind, value?.location?.id]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return locations.slice(0, 8);
    return locations
      .filter((l) => l.name.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [locations, q]);
  const exact = locations.find((l) => l.name.toLowerCase() === q) || null;

  const pickVenue = () => {
    setQuery('');
    setForceNew(false);
    setEditing(false);
    setOpen(false);
    onChange({ kind: 'venue' });
  };

  const pickSaved = (loc) => {
    setQuery(loc.name);
    setForceNew(false);
    setEditing(false);
    setOpen(false);
    onChange({ kind: 'saved', location: loc });
  };

  const startNew = (name) => {
    setForceNew(true);
    setEditing(false);
    setOpen(false);
    const prev = value?.kind === 'new' ? value.draft : blankLocationDraft();
    onChange({ kind: 'new', draft: { ...prev, name } });
  };

  const onType = (text) => {
    setQuery(text);
    setOpen(true);
    setEditing(false);
    const t = text.trim();
    if (!t) {
      setForceNew(false);
      onChange({ kind: 'venue' });
      return;
    }
    const hit = locations.find((l) => l.name.toLowerCase() === t.toLowerCase());
    if (hit) {
      setForceNew(false);
      onChange({ kind: 'saved', location: hit });
      return;
    }
    const prev = value?.kind === 'new' ? value.draft : blankLocationDraft();
    onChange({ kind: 'new', draft: { ...prev, name: t } });
  };

  // Show the new-location fields when nothing in the list matches (or the manager chose "Add new").
  const showNewFields = value?.kind === 'new' && (forceNew || matches.length === 0);

  const saveEdit = async () => {
    const { payload, error } = draftToPayload(editDraft);
    if (error) return setEditError(error);
    setEditBusy(true);
    setEditError('');
    try {
      const res = await api.patch(
        `/venues/${venue.id}/locations/${value.location.id}`,
        locationPatchBody(value.location, payload)
      );
      onChange({ kind: 'saved', location: res.data });
      setQuery(res.data.name);
      setEditing(false);
      loadLocations();
    } catch (err) {
      setEditError(err.response?.data?.detail || 'Could not save location.');
    } finally {
      setEditBusy(false);
    }
  };

  const selected = value?.kind === 'saved' ? value.location : null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          className={`${inputCls} pl-9`}
          placeholder={`Venue address — ${venue?.address || ''}`}
        />
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={pickVenue}
              className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2">
              <Building2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm text-white">Venue address</span>
                <span className="block text-[11px] text-slate-400 truncate">{venue?.address}</span>
              </span>
            </button>
            {matches.map((loc) => (
              <button key={loc.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSaved(loc)}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2 border-t border-slate-800">
                <MapPin className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm text-white truncate">{loc.name}</span>
                  <span className="block text-[11px] text-slate-400 truncate">
                    {loc.address}{loc.lat == null ? ' · no map pin' : ''}
                  </span>
                </span>
              </button>
            ))}
            {q && !exact && (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => startNew(query.trim())}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 border-t border-slate-800 text-emerald-400 text-sm font-semibold">
                <Plus className="w-4 h-4" /> Add “{query.trim()}” as a new location
              </button>
            )}
          </div>
        )}
      </div>

      {/* Saved location summary + global edit */}
      {selected && !editing && (
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-slate-200 font-semibold truncate">{selected.name}</div>
              <div className="text-slate-400">{selected.address}</div>
            </div>
            <button type="button" onClick={() => { setEditDraft(locationToDraft(selected)); setEditing(true); setEditError(''); }}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 inline-flex items-center gap-1 flex-shrink-0">
              <Pencil className="w-3 h-3" /> Edit this location
            </button>
          </div>
          {selected.notes && <p className="text-slate-300 whitespace-pre-line">{selected.notes}</p>}
          {selected.lat == null && (
            <p className="text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> No map pin yet.</p>
          )}
        </div>
      )}

      {selected && editing && editDraft && (
        <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 space-y-3">
          <p className="text-[11px] text-amber-200 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This changes “{selected.name}” for every event that uses it. People booked on upcoming events there
            will be asked to re-read the shift info.
          </p>
          {editError && <p className="text-xs text-rose-300">{editError}</p>}
          <LocationFields value={editDraft} onChange={setEditDraft} venueRadius={venue?.geofence_radius_meters || 150} compact />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button type="button" onClick={saveEdit} disabled={editBusy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {editBusy ? 'Saving…' : 'Save for all events'}
            </button>
          </div>
        </div>
      )}

      {/* New location typed here: fields open inline and it's saved to the list with the event */}
      {showNewFields && (
        <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 space-y-3">
          <p className="text-[11px] text-emerald-200">
            New location. It will be saved to your locations list when you save this shift.
          </p>
          <LocationFields
            value={value.draft}
            onChange={(d) => {
              setQuery(d.name);
              onChange({ kind: 'new', draft: d });
            }}
            venueRadius={venue?.geofence_radius_meters || 150}
            compact
          />
        </div>
      )}
    </div>
  );
}
```


---

## C6. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)

Changes:
- **Details tab:**
  - a "Check location when workers clock in" toggle, and the buffer field when it's on
  - a new **Clock-in rules** card (opens N minutes early; auto clock-out N hours after end)
- A new **Locations** tab.
- The footer reads **Done** on the Positions and Locations tabs.

**Edit 1.** Find:
```jsx
import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

```
Replace with:
```jsx
import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import VenueLocationsPanel from './VenueLocationsPanel';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

```

**Edit 2.** Find:
```jsx
    lng: venue?.lng != null ? String(venue.lng) : '',
    geofence_radius_meters: String(venue?.geofence_radius_meters ?? 150),
    approval_policy: venue?.approval_policy || 'team_auto',
    show_rates_publicly: venue?.show_rates_publicly ?? true,
```
Replace with:
```jsx
    lng: venue?.lng != null ? String(venue.lng) : '',
    geofence_radius_meters: String(venue?.geofence_radius_meters ?? 150),
    geofence_enabled: !!venue?.geofence_enabled,                                  // Phase 27
    geofence_buffer_meters: String(venue?.geofence_buffer_meters ?? 150),         // Phase 27
    clock_in_early_minutes: String(venue?.clock_in_early_minutes ?? 30),          // Phase 27
    auto_clock_out_hours: String(venue?.auto_clock_out_hours ?? 2),               // Phase 27
    approval_policy: venue?.approval_policy || 'team_auto',
    show_rates_publicly: venue?.show_rates_publicly ?? true,
```

**Edit 3.** Find:
```jsx
      timezone: form.timezone,
      geofence_radius_meters: parseInt(form.geofence_radius_meters, 10) || 150,
      approval_policy: form.approval_policy,
      show_rates_publicly: !!form.show_rates_publicly,
```
Replace with:
```jsx
      timezone: form.timezone,
      geofence_radius_meters: parseInt(form.geofence_radius_meters, 10) || 150,
      geofence_enabled: !!form.geofence_enabled,
      geofence_buffer_meters: Number.isNaN(parseInt(form.geofence_buffer_meters, 10)) ? 150 : parseInt(form.geofence_buffer_meters, 10),
      clock_in_early_minutes: Number.isNaN(parseInt(form.clock_in_early_minutes, 10)) ? 30 : parseInt(form.clock_in_early_minutes, 10),
      auto_clock_out_hours: parseInt(form.auto_clock_out_hours, 10) || 2,
      approval_policy: form.approval_policy,
      show_rates_publicly: !!form.show_rates_publicly,
```

**Edit 4.** Find:
```jsx
  const tabs = isEdit ? (
    <div className="flex gap-2">
      {[{ id: 'details', label: 'Details' }, { id: 'positions', label: 'Positions & pay' }].map((t) => (
        <button key={t.id} type="button" onClick={() => setTab(t.id)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
```
Replace with:
```jsx
  const tabs = isEdit ? (
    <div className="flex gap-2">
      {[{ id: 'details', label: 'Details' }, { id: 'positions', label: 'Positions & pay' }, { id: 'locations', label: 'Locations' }].map((t) => (
        <button key={t.id} type="button" onClick={() => setTab(t.id)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
```

**Edit 5.** Find:
```jsx
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        {tab === 'positions' ? 'Done' : 'Cancel'}
      </button>
      {tab === 'details' && (
```
Replace with:
```jsx
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        {tab === 'details' ? 'Cancel' : 'Done'}
      </button>
      {tab === 'details' && (
```

**Edit 6.** Find:
```jsx
                </a>
              )}
            </div>

```
Replace with:
```jsx
                </a>
              )}

              {/* Phase 27: opt-in location check */}
              <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-slate-800">
                <input type="checkbox" checked={!!form.geofence_enabled}
                  onChange={(e) => setForm({ ...form, geofence_enabled: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">Check location when workers clock in</span>
                  <span className="block text-xs text-slate-400">
                    Default for every shift. Each shift can turn it on or off (e.g. off for an off-site event).
                  </span>
                </span>
              </label>
              {form.geofence_enabled && (
                <div>
                  <label className={labelCls}>Buffer outside the radius (m)</label>
                  <input type="number" min="0" max="2000" value={form.geofence_buffer_meters} onChange={set('geofence_buffer_meters')} className={`${inputCls} w-32`} />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Inside the radius: clocked in. Within the buffer: clocked in but flagged “Outside geofence” for you.
                    Farther out: clock-in is blocked.
                  </p>
                </div>
              )}
            </div>

            {/* Phase 27: clock-in window + auto clock-out */}
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Clock className="w-4 h-4 text-emerald-400" /> Clock-in rules
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Clock-in opens (minutes before start)</label>
                  <input type="number" min="0" max="240" value={form.clock_in_early_minutes} onChange={set('clock_in_early_minutes')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Auto clock-out (hours after end)</label>
                  <input type="number" min="1" max="12" value={form.auto_clock_out_hours} onChange={set('auto_clock_out_hours')} className={inputCls} />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Workers can clock in from this many minutes before start until the shift ends. Anyone still clocked in
                this many hours after the end is clocked out at the scheduled end and flagged “Auto-closed” on the time sheet.
              </p>
            </div>

```

**Edit 7.** Find:
```jsx
          </div>
        </div>
      ) : (
        <div className="space-y-4">
```
Replace with:
```jsx
          </div>
        </div>
      ) : tab === 'locations' ? (
        <VenueLocationsPanel venue={venue} onError={setError} />
      ) : (
        <div className="space-y-4">
```


---

## C7. `frontend/src/components/ShiftEventFormModal.jsx` (EDITS)

New state:
- `where`
- `geofenceMode`
- `locStaffOn`
- `locStaffNotes`

It loads them in edit mode and sends them in the body:
- `location_id` or `new_location`
- `geofence_mode`
- `location_staff_notes`

A new **Where** card, above Event notes, holds:
- the location picker
- the clock-in location check select, which warns when the check is on but there's no pin
- the checkbox that opens **event-specific location notes (confirmed staff only)**

**Edit 1.** Find:
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users, RotateCcw, Lock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { payText } from './PayLabel';
import { zonedLocalToUtcIso, utcToZonedLocalInput } from '../utils/venueTime';

```
Replace with:
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Info, EyeOff, FileText, Users, RotateCcw, Lock, MapPin, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { payText } from './PayLabel';
import EventLocationPicker from './EventLocationPicker';
import { draftToPayload } from './LocationFields';
import { zonedLocalToUtcIso, utcToZonedLocalInput } from '../utils/venueTime';

```

**Edit 2.** Find:
```jsx
  const [notes, setNotes] = useState('');
  const [staffNotes, setStaffNotes] = useState(''); // Phase 26.2: confirmed staff only
  const [rows, setRows] = useState(() => (isEdit ? [] : [blankRow(null)]));
  const [touched, setTouched] = useState(false);
```
Replace with:
```jsx
  const [notes, setNotes] = useState('');
  const [staffNotes, setStaffNotes] = useState(''); // Phase 26.2: confirmed staff only
  // Phase 27: where, clock-in location check, event-specific location notes (confirmed staff only)
  const [where, setWhere] = useState({ kind: 'venue' });
  const [geofenceMode, setGeofenceMode] = useState('venue_default');
  const [locStaffOn, setLocStaffOn] = useState(false);
  const [locStaffNotes, setLocStaffNotes] = useState('');
  const [rows, setRows] = useState(() => (isEdit ? [] : [blankRow(null)]));
  const [touched, setTouched] = useState(false);
```

**Edit 3.** Find:
```jsx
        setNotes(ev.notes || '');
        setStaffNotes(ev.staff_notes || '');
        setRows(
          (ev.positions || []).map((p) => ({
```
Replace with:
```jsx
        setNotes(ev.notes || '');
        setStaffNotes(ev.staff_notes || '');
        setWhere(ev.location ? { kind: 'saved', location: ev.location } : { kind: 'venue' });
        setGeofenceMode(ev.geofence_mode || 'venue_default');
        setLocStaffNotes(ev.location_staff_notes || '');
        setLocStaffOn(!!ev.location_staff_notes);
        setRows(
          (ev.positions || []).map((p) => ({
```

**Edit 4.** Find:
```jsx
  const anyBooked = rows.some((r) => (r.booked || 0) + (r.pending || 0) > 0);

  const handleSubmit = async () => {
    setError('');
```
Replace with:
```jsx
  const anyBooked = rows.some((r) => (r.booked || 0) + (r.pending || 0) > 0);

  // Phase 27: effective clock-in location check for this event
  const venueGeoOn = !!venue?.geofence_enabled;
  const geoOn = geofenceMode === 'on' || (geofenceMode === 'venue_default' && venueGeoOn);

  const handleSubmit = async () => {
    setError('');
```

**Edit 5.** Find:
```jsx
    }

    const body = {
      title: title.trim(),
      start_time: startIso,
      end_time: endIso,
      notes: notes.trim() || null,
      staff_notes: staffNotes.trim() || null,
      positions: payloadPositions,
    };
```
Replace with:
```jsx
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
```

**Edit 6.** Find:
```jsx
              </div>
            </div>
            <div>
              <label className={labelCls}>Event notes</label>
```
Replace with:
```jsx
              </div>
            </div>
            {/* Phase 27: Where */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" /> Where
              </label>
              <EventLocationPicker venue={venue} value={where} onChange={setWhere} />

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
```


---

## C8. `frontend/src/components/TimesheetModal.jsx` (EDITS)

Chips on each time entry: In / Out location check (with distance when outside), **Auto-closed — check hours**, and **Late N min**.

**Edit 1.** Find:
```jsx
import ModalShell from './ModalShell';
import { fmtDate, fmtTimeRange, fmtTime, fmtShortDate, utcToZonedLocalInput, zonedLocalToUtcIso } from '../utils/venueTime';

const STATUS = {
```
Replace with:
```jsx
import ModalShell from './ModalShell';
import { fmtDate, fmtTimeRange, fmtTime, fmtShortDate, utcToZonedLocalInput, zonedLocalToUtcIso } from '../utils/venueTime';
import { GEO_LABELS, metersText } from '../utils/listingFormat';

// Phase 27: small flags on each time entry
const GEO_CHIP = {
  on_site: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  outside_geofence: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  manager: 'bg-indigo-500/10 text-indigo-200 border-indigo-500/30',
  auto: 'bg-rose-500/10 text-rose-200 border-rose-500/40',
};

function EntryFlags({ e }) {
  const chips = [];
  const geo = (status, distance, prefix) => {
    if (!status || status === 'not_checked') return;
    const text = `${prefix}: ${GEO_LABELS[status] || status}${status === 'outside_geofence' && distance != null ? ` · ${metersText(distance)}` : ''}`;
    chips.push(<span key={prefix} className={`px-1.5 py-0.5 rounded border text-[10px] ${GEO_CHIP[status] || 'bg-slate-800 text-slate-300 border-slate-700'}`}>{text}</span>);
  };
  geo(e.clock_in_geo_status, e.clock_in_distance_m, 'In');
  if (!e.auto_closed) geo(e.clock_out_geo_status, e.clock_out_distance_m, 'Out');
  if (e.auto_closed) {
    chips.push(<span key="auto" className={`px-1.5 py-0.5 rounded border text-[10px] ${GEO_CHIP.auto}`}>Auto-closed — check hours</span>);
  }
  if (e.late_minutes > 0) {
    chips.push(<span key="late" className="px-1.5 py-0.5 rounded border text-[10px] bg-amber-500/10 text-amber-300 border-amber-500/30">Late {e.late_minutes} min</span>);
  }
  if (!chips.length) return null;
  return <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">{chips}</span>;
}

const STATUS = {
```

**Edit 2.** Find:
```jsx
                          <span className="text-slate-500"> · {e.hours.toFixed(2)} h</span>
                          {e.edited && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] border border-amber-500/30">edited</span>}
                        </span>
                        <span className="flex items-center gap-1">
```
Replace with:
```jsx
                          <span className="text-slate-500"> · {e.hours.toFixed(2)} h</span>
                          {e.edited && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] border border-amber-500/30">edited</span>}
                          <EntryFlags e={e} />
                        </span>
                        <span className="flex items-center gap-1">
```


---

## C9. `frontend/src/components/PostedShiftsBoard.jsx` (EDITS)

Shows the event's location name next to the time.

**Edit 1.** Find:
```jsx
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus, Pencil, Eye, EyeOff, Copy, ClipboardList, Ban, MoreHorizontal } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
```
Replace with:
```jsx
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus, Pencil, Eye, EyeOff, Copy, ClipboardList, Ban, MoreHorizontal, MapPin } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
```

**Edit 2.** Find:
```jsx
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeStr}</span>
                            <span>Staffed <strong className="text-white">{ev.total_assigned}/{ev.total_capacity}</strong></span>
                            {ev.total_requested > 0 && (
```
Replace with:
```jsx
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeStr}</span>
                            {ev.location_name && (
                              <span className="inline-flex items-center gap-1 text-emerald-300"><MapPin className="w-3 h-3" />{ev.location_name}</span>
                            )}
                            <span>Staffed <strong className="text-white">{ev.total_assigned}/{ev.total_capacity}</strong></span>
                            {ev.total_requested > 0 && (
```


---

## C10. `frontend/src/components/EventRosterModal.jsx` (EDITS)

Shows the event's location name in the Details subtitle.

**Edit 1.** Find:
```jsx
import React from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle } from 'lucide-react';
import ModalShell from './ModalShell';
import TipBadge from './TipBadge';
```
Replace with:
```jsx
import React from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin } from 'lucide-react';
import ModalShell from './ModalShell';
import TipBadge from './TipBadge';
```

**Edit 2.** Find:
```jsx
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{fmtDate(event.start_time, timeZone)} • {fmtTimeRange(event.start_time, event.end_time, timeZone)}</span>
      <span>Staffed <strong className="text-white">{event.total_assigned}/{event.total_capacity}</strong></span>
      {event.total_requested > 0 && (
```
Replace with:
```jsx
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{fmtDate(event.start_time, timeZone)} • {fmtTimeRange(event.start_time, event.end_time, timeZone)}</span>
      {event.location_name && (
        <span className="inline-flex items-center gap-1 text-emerald-300"><MapPin className="w-3 h-3" />{event.location_name}</span>
      )}
      <span>Staffed <strong className="text-white">{event.total_assigned}/{event.total_capacity}</strong></span>
      {event.total_requested > 0 && (
```


---

## D1. `frontend/src/components/EventListingCard.jsx` (EDITS)

The card shows the event's location ("At Oheka Castle · address") when it isn't the venue.

**Edit 1.** Find:
```jsx
import { fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, listingPayText, estPayText, STATUS_LABELS, PENDING_STATUSES, BOOKED_STATUSES,
} from '../utils/listingFormat';

```
Replace with:
```jsx
import { fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, listingPayText, estPayText, STATUS_LABELS, PENDING_STATUSES, BOOKED_STATUSES, whereOf,
} from '../utils/listingFormat';

```

**Edit 2.** Find:
```jsx
            )}
          </p>
          {listing.venue?.address && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{listing.venue.address}</span>
            </p>
          )}
        </div>
      </div>
```
Replace with:
```jsx
            )}
          </p>
          {(() => {
            const where = whereOf(listing);   // Phase 27: event location if set, else the venue
            if (!where.address) return null;
            return (
              <p className={`text-[11px] flex items-center gap-1 mt-0.5 ${where.isOffsite ? 'text-emerald-300' : 'text-slate-500'}`}>
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{where.isOffsite ? `At ${where.name} · ${where.address}` : where.address}</span>
              </p>
            );
          })()}
        </div>
      </div>
```


---

## D2. `frontend/src/components/EventListingModal.jsx` (EDITS)

Changes:
- **Where** block: shows the event location, plus "Staffed by <venue>" when it's off-site.
- Directions and `.ics` use the event location.
- If the location check is on, there's a note that phone location is needed.
- The notes card adds "About this location".
- Once booked, the worker sees an indigo **"At this location, for confirmed staff"** block.

**Edit 1.** Find:
```jsx
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, STATUS_LABELS, PENDING_STATUSES,
} from '../utils/listingFormat';

```
Replace with:
```jsx
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, STATUS_LABELS, PENDING_STATUSES, whereOf,
} from '../utils/listingFormat';

```

**Edit 2.** Find:
```jsx
      start: listing.start_time,
      end: listing.end_time,
      location: listing.venue?.address,
      description: [listing.notes, listing.venue?.arrival_instructions, listing.venue?.dress_code && `Dress code: ${listing.venue.dress_code}`]
        .filter(Boolean)
        .join('\n\n'),
```
Replace with:
```jsx
      start: listing.start_time,
      end: listing.end_time,
      location: whereOf(listing).address,
      description: [
        listing.notes,
        listing.location?.notes,
        listing.location_staff_notes,
        listing.venue?.arrival_instructions,
        listing.venue?.dress_code && `Dress code: ${listing.venue.dress_code}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
```

**Edit 3.** Find:
```jsx
          </p>
          {/* Phase 26.2: staff-only notes, shown once confirmed */}
          {(listing.staff_notes || bookedPosition?.staff_notes) && (
            <div className="mt-3 space-y-2">
              {listing.staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
```
Replace with:
```jsx
          </p>
          {/* Phase 26.2: staff-only notes, shown once confirmed */}
          {(listing.staff_notes || bookedPosition?.staff_notes || listing.location_staff_notes) && (
            <div className="mt-3 space-y-2">
              {listing.location_staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
                  <div className="font-bold text-indigo-300 flex items-center gap-1 mb-0.5"><Lock className="w-3 h-3" /> At this location, for confirmed staff</div>
                  {listing.location_staff_notes}
                </div>
              )}
              {listing.staff_notes && (
                <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs whitespace-pre-line">
```

**Edit 4.** Find:
```jsx
            </InfoBlock>
            <InfoBlock icon={MapPin} label="Where">
              <span className="font-semibold">{listing.venue?.name}</span>
              {listing.venue?.address ? `\n${listing.venue.address}` : ''}
            </InfoBlock>
            <div className="flex flex-wrap gap-2 pl-6">
              <a
                href={mapsUrl(listing.venue)}
                target="_blank"
                rel="noreferrer"
```
Replace with:
```jsx
            </InfoBlock>
            <InfoBlock icon={MapPin} label="Where">
              {/* Phase 27: event location (caterer / off-site) if set, otherwise the venue */}
              <span className="font-semibold">{whereOf(listing).name}</span>
              {whereOf(listing).address ? `\n${whereOf(listing).address}` : ''}
              {whereOf(listing).isOffsite ? `\nStaffed by ${listing.venue?.name}` : ''}
            </InfoBlock>
            {listing.geofence_on && (
              <p className="text-[11px] text-slate-400 pl-6">You'll need to be at this location (with phone location on) to clock in.</p>
            )}
            <div className="flex flex-wrap gap-2 pl-6">
              <a
                href={mapsUrl(whereOf(listing))}
                target="_blank"
                rel="noreferrer"
```

**Edit 5.** Find:
```jsx
          </div>

          {(listing.notes || listing.venue?.default_shift_notes || listing.venue?.dress_code || listing.venue?.arrival_instructions) && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <InfoBlock icon={StickyNote} label="About this event">{listing.notes}</InfoBlock>
              <InfoBlock icon={Shirt} label="Dress code">{listing.venue?.dress_code}</InfoBlock>
              <InfoBlock icon={MapPin} label="When you arrive">{listing.venue?.arrival_instructions}</InfoBlock>
```
Replace with:
```jsx
          </div>

          {(listing.notes || listing.location?.notes || listing.venue?.default_shift_notes || listing.venue?.dress_code || listing.venue?.arrival_instructions) && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <InfoBlock icon={StickyNote} label="About this event">{listing.notes}</InfoBlock>
              <InfoBlock icon={MapPin} label="About this location">{listing.location?.notes}</InfoBlock>
              <InfoBlock icon={Shirt} label="Dress code">{listing.venue?.dress_code}</InfoBlock>
              <InfoBlock icon={MapPin} label="When you arrive">{listing.venue?.arrival_instructions}</InfoBlock>
```


---

## D3. `frontend/src/components/ShiftDetailsModal.jsx` (EDITS)

Changes:
- Where, Directions and `.ics` use the event location.
- Shows "Clock-in opens at …" and the phone-location note.
- New notes: "About this location" and "At this location, for confirmed staff".

**Edit 1.** Find:
```jsx
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, mapsUrl, downloadIcs, countdownText, calendarTone,
} from '../utils/listingFormat';

```
Replace with:
```jsx
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange, fmtTime } from '../utils/venueTime';
import {
  hoursText, mapsUrl, downloadIcs, countdownText, calendarTone, whereOf,
} from '../utils/listingFormat';

```

**Edit 2.** Find:
```jsx
      start: item.start_time,
      end: item.end_time,
      location: item.venue?.address,
      description: [
        item.venue?.arrival_instructions && `When you arrive: ${item.venue.arrival_instructions}`,
        item.venue?.dress_code && `Dress code: ${item.venue.dress_code}`,
```
Replace with:
```jsx
      start: item.start_time,
      end: item.end_time,
      location: whereOf(item).address,
      description: [
        item.location?.notes && `About this location: ${item.location.notes}`,
        item.location_staff_notes && `At this location (staff): ${item.location_staff_notes}`,
        item.venue?.arrival_instructions && `When you arrive: ${item.venue.arrival_instructions}`,
        item.venue?.dress_code && `Dress code: ${item.venue.dress_code}`,
```

**Edit 3.** Find:
```jsx
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
```
Replace with:
```jsx
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Where</div>
                {/* Phase 27: event location (caterer / off-site) if set, otherwise the venue */}
                <div className="text-sm font-semibold text-white">{whereOf(item).name}</div>
                {whereOf(item).address && <div className="text-xs text-slate-300">{whereOf(item).address}</div>}
                {whereOf(item).isOffsite && <div className="text-[11px] text-slate-500">Staffed by {item.venue?.name}</div>}
              </div>
            </div>
            {item.booked && !off && (
              <div className="pl-6 text-[11px] text-slate-400 space-y-0.5">
                {item.clock_in_opens_at && <div>Clock-in opens at {fmtTime(item.clock_in_opens_at, tz)}.</div>}
                {item.geofence_on && <div>You'll need to be at this location with phone location on to clock in.</div>}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pl-6">
              <a href={mapsUrl(whereOf(item))} target="_blank" rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                <Navigation className="w-3 h-3 text-emerald-400" /> Directions
```

**Edit 4.** Find:
```jsx
          </h4>
          <NoteCard icon={MapPin} label="When you arrive" text={item.venue?.arrival_instructions} />
          <NoteCard icon={Shirt} label="Dress code" text={item.venue?.dress_code} />
          <NoteCard icon={Calendar} label="About this event" text={item.event_notes} />
```
Replace with:
```jsx
          </h4>
          <NoteCard icon={MapPin} label="When you arrive" text={item.venue?.arrival_instructions} />
          <NoteCard icon={MapPin} label="About this location" text={item.location?.notes} />
          <NoteCard
            icon={Lock}
            label="At this location, for confirmed staff"
            text={item.location_staff_notes}
            tone="staff"
            badge={<span className="ml-auto text-[10px] text-indigo-300">Only booked staff see this</span>}
          />
          <NoteCard icon={Shirt} label="Dress code" text={item.venue?.dress_code} />
          <NoteCard icon={Calendar} label="About this event" text={item.event_notes} />
```

**Edit 5.** Find:
```jsx
            item.venue?.arrival_instructions, item.venue?.dress_code, item.event_notes, item.role_notes,
            item.event_staff_notes, item.position_staff_notes, item.venue?.default_shift_notes,
          ].some((t) => t && String(t).trim()) && !item.staff_notes_locked && (
            <p className="text-xs text-slate-500 italic">No notes for this shift.</p>
```
Replace with:
```jsx
            item.venue?.arrival_instructions, item.venue?.dress_code, item.event_notes, item.role_notes,
            item.event_staff_notes, item.position_staff_notes, item.venue?.default_shift_notes,
            item.location?.notes, item.location_staff_notes,
          ].some((t) => t && String(t).trim()) && !item.staff_notes_locked && (
            <p className="text-xs text-slate-500 italic">No notes for this shift.</p>
```


---

## D4. `frontend/src/components/WorkerCalendar.jsx` (EDITS)

Calendar rows and the next-shift card show "· at <location>".

**Edit 1.** Find:
```jsx
          <div className="text-sm font-bold text-slate-200 truncate">{l.title}</div>
          <div className="text-xs text-slate-400 truncate">
            {l.venue?.name} · {l.total_spots_left} spot{l.total_spots_left === 1 ? '' : 's'} open
          </div>
        </div>
```
Replace with:
```jsx
          <div className="text-sm font-bold text-slate-200 truncate">{l.title}</div>
          <div className="text-xs text-slate-400 truncate">
            {l.venue?.name}{l.location ? ` · at ${l.location.name}` : ''} · {l.total_spots_left} spot{l.total_spots_left === 1 ? '' : 's'} open
          </div>
        </div>
```

**Edit 2.** Find:
```jsx
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-1 truncate">
          <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{it.venue?.name}</span>
        </div>
      </div>
```
Replace with:
```jsx
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-1 truncate">
          <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{it.venue?.name}{it.location ? ` · at ${it.location.name}` : ''}</span>
        </div>
      </div>
```

**Edit 3.** Find:
```jsx
                <div className="text-sm text-slate-300 mt-1 truncate">
                  {nextShift.role_type} · {nextShift.title} · {nextShift.venue?.name}
                </div>
              </div>
```
Replace with:
```jsx
                <div className="text-sm text-slate-300 mt-1 truncate">
                  {nextShift.role_type} · {nextShift.title} · {nextShift.venue?.name}
                  {nextShift.location ? ` · at ${nextShift.location.name}` : ''}
                </div>
              </div>
```


---

## D5. `frontend/src/pages/WorkerDashboard.jsx` (FULL FILE REPLACEMENT)

Changes vs. the current file:
- `handleClockIn(shiftId, item)` / `handleClockOut(shiftId, item)` ask for phone location **only when the shift's check is on**. They show the server's message; outside-geofence and undo show as blue info.
- My Schedule cards:
  - show **"Clock in opens 5:30 PM"** (disabled) before the window
  - show "Shift ended. Ask your manager…" after the end
  - label the button "Clock In (uses location)" when needed
  - Directions and `.ics` use the event location
- Search also matches location name and address.
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
import { fmtDateTime, fmtTime } from '../utils/venueTime';
import {
  STATUS_LABELS, PENDING_STATUSES, dayGroupLabel, isOnDay, downloadIcs, mapsUrl, whereOf,
} from '../utils/listingFormat';
import { getCurrentPosition } from '../utils/geo';

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
  // Phase 27: `item` is the calendar item for this booking (geofence + clock-in window info).
  const handleClockIn = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      let body = {};
      if (item?.geofence_on) {
        setNotification({ type: 'info', message: 'Checking your location…' });
        body = await getCurrentPosition(); // throws a friendly Error if blocked / unavailable
      }
      const res = await api.post(`/shifts/${shiftId}/clock-in`, body);
      setActiveClockIns((prev) => new Set([...prev, shiftId]));
      setNotification({
        type: res.data?.geo_status === 'outside_geofence' ? 'info' : 'success',
        message: `⏱️ ${res.data?.message || 'Clocked in.'}`,
      });
      fetchWorkerData(false);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || err.message || 'Failed to clock in.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  const handleClockOut = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      // Clock-out is never blocked by location; we only record it when the check is on.
      const body = item?.geofence_on ? await getCurrentPosition({ timeoutMs: 8000 }).catch(() => ({})) : {};
      const res = await api.post(`/shifts/${shiftId}/clock-out`, body);
      setActiveClockIns((prev) => {
        const updated = new Set(prev);
        updated.delete(shiftId);
        return updated;
      });
      setNotification({
        type: res.data?.status === 'undone' ? 'info' : 'success',
        message: `🏁 ${res.data?.message || 'Clocked out.'}`,
      });
      fetchWorkerData(false);
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
        const hay = [l.title, l.venue?.name, l.venue?.address, l.location?.name, l.location?.address, ...l.positions.map((p) => p.role_type)]
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
      location: calendarByRequest.get(req.id) ? whereOf(calendarByRequest.get(req.id)).address : shift.venue?.address,
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
    // Phase 27: clock-in window + where to go, from the calendar item
    const calItem = calendarByRequest.get(req.id);
    const opensAt = calItem?.clock_in_opens_at ? new Date(calItem.clock_in_opens_at) : null;
    const tooEarly = !!opensAt && Date.now() < opensAt.getTime();
    const shiftEnded = shift?.end_time ? Date.now() >= new Date(shift.end_time).getTime() : false;
    const place = calItem ? whereOf(calItem) : shift?.venue;

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

          {(isApproved || isCheckedIn) && place && (
            <a
              href={mapsUrl(place)}
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
                onClick={() => handleClockOut(shiftId, calItem)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : 'Clock Out'}</span>
              </button>
            ) : shiftEnded ? (
              <span className="text-[11px] text-slate-500 italic">Shift ended. Ask your manager to add your hours.</span>
            ) : tooEarly ? (
              <span
                title="Clock-in opens shortly before your shift starts"
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 text-xs font-semibold flex items-center space-x-1.5"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>Clock in opens {fmtTime(opensAt, shift?.venue?.timezone)}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleClockIn(shiftId, calItem)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : calItem?.geofence_on ? 'Clock In (uses location)' : 'Clock In'}</span>
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

        {/* Phase 26.3: admins / managers looking at the Worker view see exactly what workers see */}
        {!['worker'].includes(String(user?.role || '').toLowerCase()) && (
          <div className="mb-6 p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-300 flex-shrink-0 mt-0.5" />
            <span>
              <b>Worker preview.</b> You're seeing this page exactly as a worker would: hidden pay and
              staff-only notes stay hidden unless you're booked on that position. Your manager screens still show full pay.
            </span>
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

## E. Rebuild & Verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE venues ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS geofence_buffer_meters INT NOT NULL DEFAULT 150;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS clock_in_early_minutes INT NOT NULL DEFAULT 30;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS auto_clock_out_hours INT NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS venue_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_meters INT,
    notes TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_location_name UNIQUE (venue_id, name)
);
CREATE INDEX IF NOT EXISTS idx_venue_locations_venue ON venue_locations(venue_id);
DROP TRIGGER IF EXISTS trg_venue_locations_updated_at ON venue_locations;
CREATE TRIGGER trg_venue_locations_updated_at BEFORE UPDATE ON venue_locations FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES venue_locations(id) ON DELETE SET NULL;
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS geofence_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default';
ALTER TABLE shift_events ADD COLUMN IF NOT EXISTS location_staff_notes TEXT;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_lat DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_lng DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_distance_m INT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_geo_status VARCHAR(20) NOT NULL DEFAULT 'not_checked';
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_lat DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_lng DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_distance_m INT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_geo_status VARCHAR(20);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE;
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)
  - With keep-data, existing seed shifts keep their old dates. Only new seeds use the weekday fix.
  - The old "Completed 0.00 h" test entry on Test Concert stays; delete it from the Time sheet if you like.

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Phone testing note:** browsers only share location on **https** (the Cloudflare dev URL is fine) or `localhost`.

### Checklist
1. **Venue Settings → Details:**
   * "Check location when workers clock in" is **off** by default. Turn it on and set a buffer of 150 m.
   * Clock-in rules show 30 min / 2 h. Save.
2. **Venue Settings → Locations:**
   * Add "Test Site" with the address and **I'm there now**. Its pin and "used by 0 events" show.
   * Archive it, then **Show archived**, then restore it.
3. **Post a Shift → Where:**
   * Type "Smith Wedding". There's no match, so the **new-location fields open inline**. Fill in the address and paste a Google Maps link; the pin fills in.
   * Tick **Add event-specific location notes** and type "Gate code 2280".
   * Publish. "Smith Wedding" now appears in Venue Settings → Locations (used by 1 event).
4. **Where on the manager screens:** Posted Shifts and Details show 📍 Smith Wedding.
5. **Worker, before booking (Find Shifts):**
   * The card reads "At Smith Wedding · <address>".
   * The popout shows Where, "Staffed by <venue>", About this location, and the phone-location note.
   * It does **not** show the gate code or venue arrival instructions.
6. **Worker, after booking:** the popout and Shift Details show the indigo "At this location, for confirmed staff" block, and the calendar item shows "PLEASE READ".
7. **Global location edit:** as the manager, open the event → Edit → Where → **Edit this location**, change the notes, and save for all events. The booked worker sees **UPDATED — "Location updated: location notes updated"**.
8. **Clock-in window:** before the window opens, My Schedule shows a greyed **"Clock in opens <time>"**. (To test now, post a shift starting in 20 minutes.)
9. **Clock-in with the check on:**
   * At the location: "Clocked in", and the time sheet shows **In: On site**.
   * About 200 m away (within the buffer): clocked in, and the time sheet shows **In: Outside geofence · 0.1 mi**.
   * About 1 km away: **blocked** — "You're 0.6 mi from Smith Wedding…".
   * Location permission denied: blocked, with instructions.
10. **Location check off:** set one event's check to **Off for this event**. Clock-in never asks for location, and the time sheet shows no location chip.
11. **Undo:** clock in, then clock out within a minute. The message reads "Clock-in undone…", no entry is kept, and the status returns to Confirmed.
12. **Auto clock-out:** stay clocked in past end + 2 h, then open the time sheet. The entry closes at the scheduled end, shows **Auto-closed — check hours**, and the status is Completed.
13. **Manager entry:** add time on the time sheet. It shows **In: Manager entry**.
14. **Payroll CSV** has the columns Work Location, Clock-In Location Check, Clock-Out Location Check, Late (min) and Auto-Closed.
15. **Guard:** with the check **on** and a saved location that has **no pin**, saving the event is refused with a clear message.


---