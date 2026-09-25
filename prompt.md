# Phase 25.1: Modal Scrolling Fix + Public Venue Profiles

Patch on top of Phase 25 (implemented). Two parts:

**A. Modal scrolling bug.** `VenueSettingsModal` (and `EventRosterModal`) overflow the screen and can't be scrolled. Cause: the panel is a `flex flex-col` box with `max-h-[..vh]`, and the scrolling body is `flex-1 overflow-y-auto` **without `min-h-0`**. Flex children default to `min-height: auto`, so the body grows to its full content height, pushes past the cap, and never scrolls. Fix: add `min-h-0` to the scrolling body, make header/footer `shrink-0`, use `dvh` units (correct on phones with browser toolbars), render through a React portal on `document.body` so no parent can clip it, and lock page scroll behind the modal.

**B. Public venue profiles for workers.**
* **`/venues` — Venue directory.** Every venue, sorted by open spots, with next shift, pay range (if the venue allows it), and how many shifts it has posted. Searchable.
* **`/venues/:venueId` — Venue profile.** Name, address (Directions link), phone, about, dress code, positions (with default pay if the venue allows it), a transparency strip (events and fill rate in the last 90 days, people who've worked there), and **Upcoming** and **Past (90 days)** shifts grouped by event with positions, pay, tips, and how many spots are filled. Workers can request an open position right from the profile.
* **Privacy:** no worker names or contact info appear anywhere on the public pages. Arrival instructions (can contain door codes) are shown only to that venue's managers/admins and to workers who have been booked there.
* **New venue setting:** "Show our default pay rates on the public profile" (`show_rates_publicly`, default ON). When off, the profile and directory hide default rates; posted shifts still show their own pay (as they already do on Find Shifts).
* Navbar gets a **Venues** link for everyone; venue names on the worker's Find Shifts cards link to the profile; the manager dashboard gets a **Public page** button.

⚠️ **One new column** (`venues.show_rates_publicly`). See §9 for the rebuild options.

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything in `.secrets/`, `docker-compose.yml`, `backend/src/auth.py`, `backend/src/main.py`, `backend/src/routers/auth.py`, `backend/src/serializers.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/pages/LoginPage.jsx`.
* `frontend/src/App.jsx` and `frontend/src/components/Navbar.jsx`: ONLY the edits listed in §7 and §8.
* No native PostgreSQL ENUMs. Schema changes go in BOTH `database/init.sql` and `backend/src/models.py`.
* Public endpoints (`/directory`, `/{venue_id}/profile`, `/{venue_id}/public-events`) must NEVER return worker names, emails, phones, or IDs of other users.
* Route ORDER in `venues.py`: `GET /directory` must be declared ABOVE `@router.get("/{venue_id}", ...)`.
* Never read ORM relationship attributes that weren't `selectinload`-ed; use explicit `select(...)` queries.
* All backend datetime comparisons use `datetime.now(timezone.utc)`.
* New files are created with the EXACT content given. Only use `lucide-react` icons already used elsewhere in the app (the ones imported below are all safe).

---

## 1. Part A — Modal scrolling fix

### A1. `frontend/src/components/VenueSettingsModal.jsx`
1. Change the first import line to:
```jsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
```
2. Inside the `VenueSettingsModal` component (NOT `PositionRow`), directly after the existing `useEffect` that calls `loadPositions()`, add a scroll lock:
```jsx
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
```
3. In the component's main `return`, change `return (` → `return createPortal(` and change the final
```jsx
    </div>
  );
}
```
at the very end of the file to:
```jsx
    </div>,
    document.body
  );
}
```
4. Replace the two outermost wrapper `<div>` opening tags:
```jsx
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl max-h-[92vh] flex flex-col">
```
with:
```jsx
    <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
```
5. Add `shrink-0` to the className of each of these fixed (non-scrolling) blocks:
   * the header `<div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-slate-800">`
   * the tabs `<div className="px-6 pt-3 flex gap-2">`
   * the error `<div className="mx-6 mt-3 p-3 bg-rose-500/10 ...">`
   * the footer `<div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-3">`
6. Change the scrolling body `<div className="overflow-y-auto px-6 py-4 flex-1">` to:
```jsx
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4">
```

### A2. `frontend/src/components/EventRosterModal.jsx` (same bug)
1. Add `import { createPortal } from 'react-dom';` below the React import.
2. Change `return (` (the main return that renders the modal, AFTER the `if (!event) return null;` line) → `return createPortal(`, and the final `</div>\n  );\n}` → `</div>,\n    document.body\n  );\n}`.
3. Outer wrapper: `<div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">` → `<div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">`
4. Panel: replace `max-h-[90vh] flex flex-col` with `max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden` (keep the other classes on that element).
5. Header `<div className="flex justify-between items-start pb-4 border-b border-slate-800">` → add `shrink-0`.
6. Body `<div className="overflow-y-auto flex-1 pt-4 space-y-5 pr-1">` → `<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-4 space-y-5 pr-1">`

---

## 2. Database — `show_rates_publicly`

### `database/init.sql`
In `CREATE TABLE venues (...)`, directly after `approval_policy VARCHAR(20) NOT NULL DEFAULT 'team_auto',` add:
```sql
    show_rates_publicly BOOLEAN NOT NULL DEFAULT TRUE,
```

### `backend/src/models.py`
In `class Venue`, directly after the `approval_policy = Column(...)` line:
```python
    show_rates_publicly = Column(Boolean, nullable=False, default=True)
```

---

## 3. Schemas (`backend/src/schemas.py`)
1. Add `show_rates_publicly: bool = True` to `VenueBase` (after `approval_policy`).
2. Add `show_rates_publicly: Optional[bool] = True` to `VenueCreate` (after `approval_policy`).
3. Add `show_rates_publicly: Optional[bool] = None` to `VenueUpdateSettings` (after `approval_policy`).
4. Append at the END of the file:
```python
# ------------------------------------------------------------------------------
# Phase 25.1: Public venue directory & profile (no worker PII)
# ------------------------------------------------------------------------------
class VenueDirectoryItem(BaseModel):
    id: UUID
    name: str
    address: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: str = "America/New_York"
    lat: float
    lng: float
    open_spots: int = 0
    upcoming_shift_count: int = 0
    total_shifts_posted: int = 0
    next_shift_start: Optional[datetime] = None
    show_rates_publicly: bool = True
    rate_min: Optional[float] = None
    rate_max: Optional[float] = None


class PublicPosition(BaseModel):
    name: str
    default_rate: Optional[float] = None
    tips_eligible: bool = False
    tip_pool: bool = False


class VenueProfileResponse(BaseModel):
    id: UUID
    name: str
    address: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    phone: Optional[str] = None
    timezone: str = "America/New_York"
    lat: float
    lng: float
    dress_code: Optional[str] = None
    arrival_instructions: Optional[str] = None
    show_rates_publicly: bool = True
    positions: List[PublicPosition] = []
    events_last_90_days: int = 0
    spots_posted_last_90_days: int = 0
    spots_filled_last_90_days: int = 0
    workers_booked_all_time: int = 0
    can_manage: bool = False


class PublicEventPosition(BaseModel):
    shift_id: UUID
    role_type: str
    hourly_rate: float
    tips_eligible: bool = False
    tip_pool: bool = False
    capacity: int
    filled: int
    spots_left: int
    status: str
    my_status: Optional[str] = None


class PublicVenueEvent(BaseModel):
    event_key: str
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
    total_capacity: int
    total_filled: int
    positions: List[PublicEventPosition]
```

### `backend/src/routers/admin.py` — `get_admin_venues`
In the `VenueResponse(...)` constructor, directly after `approval_policy=v.approval_policy or "team_auto",` add:
```python
            show_rates_publicly=bool(v.show_rates_publicly),
```

---

## 4. NEW FILE `backend/src/services/venue_public.py`
```python
"""
Phase 25.1: Worker-facing venue directory, profile, and shift history.
Never returns other users' names, emails, phones, or IDs.
"""
from datetime import datetime, timezone, timedelta
from typing import List

from sqlalchemy import select, func, and_, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Venue, Shift, ShiftRequest, VenuePosition, VenueManager, User
from src.auth import normalize_role
from src.schemas import (
    VenueDirectoryItem, PublicPosition, VenueProfileResponse,
    PublicEventPosition, PublicVenueEvent,
)

ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PAST_WINDOW_DAYS = 90
MAX_SHIFTS = 300


async def can_manage_venue(db: AsyncSession, user: User, venue_id) -> bool:
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return True
    row = await db.scalar(
        select(VenueManager.user_id).where(
            VenueManager.venue_id == venue_id,
            VenueManager.user_id == user.id,
        )
    )
    return row is not None


async def build_directory(db: AsyncSession) -> List[VenueDirectoryItem]:
    now = datetime.now(timezone.utc)
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    stats_rows = (await db.execute(
        select(
            Shift.venue_id.label("venue_id"),
            func.count(Shift.id).label("total"),
            func.count(Shift.id).filter(Shift.end_time >= now).label("upcoming"),
            func.coalesce(
                func.sum(Shift.capacity - Shift.spots_filled).filter(
                    and_(Shift.start_time >= now, Shift.status == "OPEN")
                ),
                0,
            ).label("open_spots"),
            func.min(Shift.start_time).filter(Shift.start_time >= now).label("next_start"),
        ).group_by(Shift.venue_id)
    )).all()
    stats = {r.venue_id: r for r in stats_rows}

    rate_rows = (await db.execute(
        select(VenuePosition.venue_id, func.min(VenuePosition.default_rate), func.max(VenuePosition.default_rate))
        .where(VenuePosition.is_active == True)
        .group_by(VenuePosition.venue_id)
    )).all()
    rates = {vid: (mn, mx) for vid, mn, mx in rate_rows}

    items = []
    for v in venues:
        s = stats.get(v.id)
        show = bool(v.show_rates_publicly)
        mn, mx = rates.get(v.id, (None, None))
        items.append(VenueDirectoryItem(
            id=v.id,
            name=v.name,
            address=v.address,
            description=v.description,
            logo_url=v.logo_url,
            timezone=v.timezone or "America/New_York",
            lat=float(v.lat),
            lng=float(v.lng),
            open_spots=max(0, int(s.open_spots or 0)) if s else 0,
            upcoming_shift_count=int(s.upcoming or 0) if s else 0,
            total_shifts_posted=int(s.total or 0) if s else 0,
            next_shift_start=s.next_start if s else None,
            show_rates_publicly=show,
            rate_min=float(mn) if (show and mn is not None) else None,
            rate_max=float(mx) if (show and mx is not None) else None,
        ))
    items.sort(key=lambda i: (-i.open_spots, -i.upcoming_shift_count, i.name.lower()))
    return items


async def build_profile(db: AsyncSession, venue: Venue, user: User) -> VenueProfileResponse:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=PAST_WINDOW_DAYS)
    manage = await can_manage_venue(db, user, venue.id)

    booked_here = await db.scalar(
        select(ShiftRequest.id)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            Shift.venue_id == venue.id,
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES),
        )
        .limit(1)
    )

    positions = (await db.execute(
        select(VenuePosition)
        .where(VenuePosition.venue_id == venue.id, VenuePosition.is_active == True)
        .order_by(VenuePosition.sort_order.asc(), VenuePosition.name.asc())
    )).scalars().all()
    show_rates = bool(venue.show_rates_publicly) or manage

    events_count, spots_posted = (await db.execute(
        select(
            func.count(distinct(func.concat(Shift.title, "|", Shift.start_time, "|", Shift.end_time))),
            func.coalesce(func.sum(Shift.capacity), 0),
        ).where(Shift.venue_id == venue.id, Shift.start_time >= since, Shift.start_time < now)
    )).one()

    spots_filled = await db.scalar(
        select(func.count(ShiftRequest.id))
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            Shift.venue_id == venue.id,
            Shift.start_time >= since,
            Shift.start_time < now,
            func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES),
        )
    ) or 0

    workers_booked = await db.scalar(
        select(func.count(distinct(ShiftRequest.worker_id)))
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(Shift.venue_id == venue.id, func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES))
    ) or 0

    return VenueProfileResponse(
        id=venue.id,
        name=venue.name,
        address=venue.address,
        description=venue.description,
        logo_url=venue.logo_url,
        phone=venue.phone,
        timezone=venue.timezone or "America/New_York",
        lat=float(venue.lat),
        lng=float(venue.lng),
        dress_code=venue.dress_code,
        arrival_instructions=venue.arrival_instructions if (manage or booked_here) else None,
        show_rates_publicly=bool(venue.show_rates_publicly),
        positions=[
            PublicPosition(
                name=p.name,
                default_rate=float(p.default_rate) if show_rates else None,
                tips_eligible=bool(p.tips_eligible),
                tip_pool=bool(p.tip_pool),
            )
            for p in positions
        ],
        events_last_90_days=int(events_count or 0),
        spots_posted_last_90_days=int(spots_posted or 0),
        spots_filled_last_90_days=int(spots_filled),
        workers_booked_all_time=int(workers_booked),
        can_manage=manage,
    )


async def build_public_events(db: AsyncSession, venue: Venue, user: User, scope: str) -> List[PublicVenueEvent]:
    now = datetime.now(timezone.utc)
    q = select(Shift).where(Shift.venue_id == venue.id)
    if scope == "past":
        q = q.where(
            Shift.end_time < now,
            Shift.start_time >= now - timedelta(days=PAST_WINDOW_DAYS),
        ).order_by(Shift.start_time.desc(), Shift.role_type.asc())
    else:
        q = q.where(Shift.end_time >= now).order_by(Shift.start_time.asc(), Shift.role_type.asc())
    shifts = (await db.execute(q.limit(MAX_SHIFTS))).scalars().all()
    if not shifts:
        return []

    ids = [s.id for s in shifts]
    filled_rows = (await db.execute(
        select(ShiftRequest.shift_id, func.count(ShiftRequest.id))
        .where(ShiftRequest.shift_id.in_(ids), func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES))
        .group_by(ShiftRequest.shift_id)
    )).all()
    filled = {sid: int(n) for sid, n in filled_rows}

    mine_rows = (await db.execute(
        select(ShiftRequest.shift_id, ShiftRequest.status)
        .where(ShiftRequest.shift_id.in_(ids), ShiftRequest.worker_id == user.id)
    )).all()
    mine = {sid: (st or "").lower() for sid, st in mine_rows}

    events, order = {}, []
    for s in shifts:
        key = f"{s.title}|{s.start_time.isoformat()}|{s.end_time.isoformat()}"
        if key not in events:
            events[key] = {
                "event_key": key,
                "title": s.title or "Shift",
                "start_time": s.start_time,
                "end_time": s.end_time,
                "description": s.description,
                "positions": [],
            }
            order.append(key)
        cap = s.capacity if s.capacity is not None else 1
        f = filled.get(s.id, 0)
        events[key]["positions"].append(PublicEventPosition(
            shift_id=s.id,
            role_type=s.role_type or "Worker",
            hourly_rate=float(s.hourly_rate) if s.hourly_rate is not None else 0.0,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            capacity=cap,
            filled=f,
            spots_left=max(0, cap - f),
            status=s.status or "OPEN",
            my_status=mine.get(s.id),
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

---

## 5. Venue routes (`backend/src/routers/venues.py`)
1. Add `VenueDirectoryItem, VenueProfileResponse, PublicVenueEvent` to the `from src.schemas import (...)` block.
2. Add: `from src.services.venue_public import build_directory, build_profile, build_public_events`
3. Directly AFTER the `list_managed_venues` function (and therefore ABOVE `@router.get("/{venue_id}", ...)`), add:
```python
@router.get("/directory", response_model=List[VenueDirectoryItem])
async def venue_directory(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25.1: Worker-facing list of venues with open spots and (optional) pay ranges."""
    return await build_directory(db)
```
4. Add these two routes at the END of the file:
```python
@router.get("/{venue_id}/profile", response_model=VenueProfileResponse)
async def venue_public_profile(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25.1: Public venue profile (no worker PII)."""
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return await build_profile(db, venue, current_user)


@router.get("/{venue_id}/public-events", response_model=List[PublicVenueEvent])
async def venue_public_events(
    venue_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25.1: Upcoming or past (90 days) shifts grouped by event, with fill counts only."""
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return await build_public_events(db, venue, current_user, scope)
```

---

## 6. Venue setting toggle (`frontend/src/components/VenueSettingsModal.jsx`)
1. In `emptyForm(venue)`, add after the `approval_policy` line:
```jsx
    show_rates_publicly: venue?.show_rates_publicly ?? true,
```
2. In `handleSave`'s `payload` object, add after `approval_policy: form.approval_policy,`:
```jsx
      show_rates_publicly: !!form.show_rates_publicly,
```
3. Directly BEFORE the `<section className="space-y-3">` that contains the `Arrival instructions` label, add:
```jsx
              <section className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.show_rates_publicly}
                    onChange={(e) => setForm({ ...form, show_rates_publicly: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">Show our default pay rates on the public venue page</span>
                    <span className="block text-xs text-slate-400">
                      Workers browsing venues will see each position's usual pay. If off, they only see pay on individual posted shifts.
                    </span>
                  </span>
                </label>
              </section>
```

---

## 7. New pages

### 7A. NEW FILE `frontend/src/pages/VenuesDirectory.jsx`
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, MapPin, Search, Calendar, ChevronRight, DollarSign } from 'lucide-react';
import api from '../api/client';
import { fmtDate, fmtTime } from '../utils/venueTime';

function VenueAvatar({ venue, size = 'w-14 h-14' }) {
  if (venue.logo_url) {
    return <img src={venue.logo_url} alt="" className={`${size} rounded-2xl object-cover border border-slate-700 flex-shrink-0`} />;
  }
  return (
    <div className={`${size} rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950 font-black text-xl flex-shrink-0`}>
      {(venue.name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

export { VenueAvatar };

export default function VenuesDirectory() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .get('/venues/directory')
      .then((res) => setVenues(res.data || []))
      .catch((err) => setError(err.response?.data?.detail || 'Could not load venues.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) => v.name.toLowerCase().includes(q) || (v.address || '').toLowerCase().includes(q)
    );
  }, [venues, query]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Building2 className="w-7 h-7 text-amber-400" /> Venues
          </h1>
          <p className="text-sm text-slate-400 mt-1">See who's posting shifts, what they pay, and what they've posted before.</p>
          <div className="mt-5 relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or neighborhood"
              className="w-full pl-9 pr-3 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
        )}
        {loading ? (
          <p className="text-center text-sm text-slate-500 py-16">Loading venues…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-16">No venues match your search.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((v) => (
              <Link
                key={v.id}
                to={`/venues/${v.id}`}
                className="group bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-2xl p-5 flex gap-4 transition"
              >
                <VenueAvatar venue={v} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-bold text-white truncate">{v.name}</h2>
                    <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-slate-300 flex-shrink-0" />
                  </div>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{v.address}</span>
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {v.open_spots > 0 ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {v.open_spots} open spot{v.open_spots === 1 ? '' : 's'}
                      </span>
                    ) : v.upcoming_shift_count > 0 ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        Fully booked
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-500 border border-slate-700">
                        No upcoming shifts
                      </span>
                    )}
                    {v.show_rates_publicly && v.rate_min != null && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700 inline-flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-emerald-400" />
                        {v.rate_min === v.rate_max
                          ? `${v.rate_min.toFixed(0)}/hr`
                          : `${v.rate_min.toFixed(0)}–${v.rate_max.toFixed(0)}/hr`}
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {v.next_shift_start && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Next: {fmtDate(v.next_shift_start, v.timezone)} · {fmtTime(v.next_shift_start, v.timezone)}
                      </span>
                    )}
                    <span>{v.total_shifts_posted} shift{v.total_shifts_posted === 1 ? '' : 's'} posted</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
```

### 7B. NEW FILE `frontend/src/pages/VenueProfile.jsx`
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Phone, ExternalLink, Info, Users, Calendar, Clock, Building2, Check, AlertCircle,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import TipBadge from '../components/TipBadge';
import { VenueAvatar } from './VenuesDirectory';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

const MY_STATUS = {
  pending: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  pending_manager_approval: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  approved: { label: "You're booked", cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: "You're booked", cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Worked', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  rejected: { label: 'Not selected', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  dropped: { label: 'Released', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  transferred: { label: 'Handed off', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
};

export default function VenueProfile() {
  const { venueId } = useParams();
  const { user } = useAuth();
  const isWorker = (user?.role || '').toLowerCase() === 'worker';

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('upcoming');
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [requestingId, setRequestingId] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .get(`/venues/${venueId}/profile`)
      .then((res) => setProfile(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Could not load this venue.'))
      .finally(() => setLoading(false));
  }, [venueId, refreshKey]);

  const loadEvents = useCallback(() => {
    setEventsLoading(true);
    api
      .get(`/venues/${venueId}/public-events`, { params: { scope } })
      .then((res) => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [venueId, scope]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents, refreshKey]);

  const handleRequest = async (shiftId) => {
    setRequestingId(shiftId);
    setNotice(null);
    try {
      const res = await api.post(`/shifts/${shiftId}/request`);
      const st = String(res.data?.status || '').toLowerCase();
      setNotice({
        type: 'success',
        message: st === 'approved' ? "You're booked! It's on your schedule." : 'Request sent. The manager will review it.',
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.detail || 'Could not request this shift.' });
    } finally {
      setRequestingId(null);
    }
  };

  if (loading && !profile) {
    return <div className="min-h-screen bg-slate-950 text-slate-500 text-sm text-center py-24">Loading venue…</div>;
  }
  if (error || !profile) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <Link to="/venues" className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> All venues
        </Link>
        <p className="mt-8 text-center text-rose-400">{error || 'Venue not found.'}</p>
      </div>
    );
  }

  const tz = profile.timezone;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    profile.lat && profile.lng ? `${profile.lat},${profile.lng}` : profile.address
  )}`;
  const fillPct =
    profile.spots_posted_last_90_days > 0
      ? Math.round((profile.spots_filled_last_90_days / profile.spots_posted_last_90_days) * 100)
      : null;
  const ratesVisible = profile.positions.some((p) => p.default_rate != null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <Link to="/venues" className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-1 mb-4">
            <ArrowLeft className="w-4 h-4" /> All venues
          </Link>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <VenueAvatar venue={profile} size="w-16 h-16" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black text-white">{profile.name}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-400">
                <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-emerald-400">
                  <MapPin className="w-4 h-4" /> {profile.address} <ExternalLink className="w-3 h-3" />
                </a>
                {profile.phone && (
                  <a href={`tel:${profile.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                    <Phone className="w-4 h-4" /> {profile.phone}
                  </a>
                )}
              </div>
            </div>
            {profile.can_manage && (
              <Link
                to="/venue"
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold text-slate-200 inline-flex items-center gap-2 self-start"
              >
                <Building2 className="w-4 h-4 text-amber-400" /> Manage venue
              </Link>
            )}
          </div>
          {profile.description && <p className="text-sm text-slate-300 mt-4 max-w-3xl">{profile.description}</p>}

          <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-5">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xl font-black text-white">{profile.events_last_90_days}</div>
              <div className="text-[11px] text-slate-400">events in the last 90 days</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xl font-black text-white">{fillPct == null ? '—' : `${fillPct}%`}</div>
              <div className="text-[11px] text-slate-400">of spots filled</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xl font-black text-white">{profile.workers_booked_all_time}</div>
              <div className="text-[11px] text-slate-400">people have worked here</div>
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {notice && (
          <div
            className={`p-3 rounded-xl border text-sm flex items-center gap-2 ${
              notice.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            {notice.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {notice.message}
          </div>
        )}

        {(profile.dress_code || profile.arrival_instructions) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profile.dress_code && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Dress code</div>
                <p className="text-sm text-slate-200 whitespace-pre-line">{profile.dress_code}</p>
              </div>
            )}
            {profile.arrival_instructions && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Arrival instructions</div>
                <p className="text-sm text-slate-200 whitespace-pre-line">{profile.arrival_instructions}</p>
                {!profile.can_manage && (
                  <p className="text-[11px] text-slate-500 mt-2">Shown to you because you've been booked here.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Positions{ratesVisible ? ' & usual pay' : ''}</div>
          {profile.positions.length === 0 ? (
            <p className="text-sm text-slate-500">No positions listed yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {profile.positions.map((p) => (
                <div key={p.name} className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{p.name}</span>
                  {p.default_rate != null && <span className="text-sm text-emerald-400 font-bold">${p.default_rate.toFixed(2)}/hr</span>}
                  <TipBadge shift={p} />
                </div>
              ))}
            </div>
          )}
          {!profile.show_rates_publicly && (
            <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              {profile.can_manage
                ? 'Default rates are hidden from workers (Venue Settings). Pay still shows on each posted shift.'
                : 'This venue shows pay on each posted shift instead.'}
            </p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" /> Shifts
            </h2>
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 self-start">
              {[
                { id: 'upcoming', label: 'Upcoming' },
                { id: 'past', label: 'Past 90 days' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScope(s.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                    scope === s.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {eventsLoading && events.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">Loading shifts…</p>
          ) : events.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">
              {scope === 'upcoming' ? 'No upcoming shifts posted right now.' : 'No shifts in the last 90 days.'}
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((ev) => (
                <div key={ev.event_key} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <div className="text-sm font-bold text-white">{ev.title}</div>
                      <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3">
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(ev.start_time, tz)}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtTimeRange(ev.start_time, ev.end_time, tz)}</span>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> {ev.total_filled}/{ev.total_capacity} staffed
                    </span>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {ev.positions.map((p) => {
                      const mine = p.my_status ? MY_STATUS[p.my_status] : null;
                      const canRequest =
                        scope === 'upcoming' && isWorker && !p.my_status && p.status === 'OPEN' && p.spots_left > 0;
                      return (
                        <div key={p.shift_id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{p.role_type}</span>
                            <span className="text-sm text-emerald-400 font-semibold">${p.hourly_rate.toFixed(2)}/hr</span>
                            <TipBadge shift={p} />
                            <span className="text-xs text-slate-400">{p.filled}/{p.capacity} filled</span>
                          </div>
                          <div>
                            {mine ? (
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mine.cls}`}>{mine.label}</span>
                            ) : canRequest ? (
                              <button
                                type="button"
                                onClick={() => handleRequest(p.shift_id)}
                                disabled={requestingId === p.shift_id}
                                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-50"
                              >
                                {requestingId === p.shift_id ? 'Sending…' : 'Pick up shift'}
                              </button>
                            ) : scope === 'upcoming' && p.spots_left === 0 ? (
                              <span className="text-xs text-slate-500">Full</span>
                            ) : scope === 'past' ? (
                              <span className={`text-xs ${p.filled >= p.capacity ? 'text-emerald-400' : 'text-slate-500'}`}>
                                {p.filled >= p.capacity ? 'Fully staffed' : 'Partly staffed'}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
```

### 7C. `frontend/src/App.jsx`
1. Add imports below the existing page imports:
```jsx
import VenuesDirectory from './pages/VenuesDirectory';
import VenueProfile from './pages/VenueProfile';
```
2. Directly BEFORE the `{/* Catch-all fallback */}` route, add:
```jsx
            {/* Phase 25.1: Public venue directory & profiles (any signed-in role) */}
            <Route
              path="/venues"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <VenuesDirectory />
                </ProtectedRoute>
              }
            />
            <Route
              path="/venues/:venueId"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <VenueProfile />
                </ProtectedRoute>
              }
            />
```
Change nothing else in `App.jsx`.

---

## 8. Links into the new pages

### 8A. `frontend/src/components/Navbar.jsx`
1. Add `MapPin` to the `lucide-react` import list.
2. In the `links` array, add this entry as the LAST item (before `].filter(Boolean);`):
```jsx
    {
      to: '/venues',
      label: 'Venues',
      icon: MapPin,
      active: 'bg-slate-800 text-amber-400',
    },
```
3. In BOTH places that compute the active style (`location.pathname === to ? active : ...`), replace `location.pathname === to` with:
```jsx
(location.pathname === to || (to === '/venues' && location.pathname.startsWith('/venues/')))
```
Change nothing else in `Navbar.jsx`.

### 8B. `frontend/src/pages/WorkerDashboard.jsx`
1. Add `import { Link } from 'react-router-dom';` below the React import.
2. On the Find Shifts card, replace:
```jsx
                        <p className="text-xs font-semibold text-slate-300 mb-1">
                          {shift.venue?.name || 'Hospitality Venue'}
                        </p>
```
with:
```jsx
                        <p className="text-xs font-semibold text-slate-300 mb-1">
                          {shift.venue_id ? (
                            <Link to={`/venues/${shift.venue_id}`} className="hover:text-emerald-400 underline underline-offset-2 decoration-slate-600">
                              {shift.venue?.name || 'Hospitality Venue'}
                            </Link>
                          ) : (
                            shift.venue?.name || 'Hospitality Venue'
                          )}
                        </p>
```

### 8C. `frontend/src/pages/VenueManagerDashboard.jsx`
1. Add `import { Link } from 'react-router-dom';` below the React import (skip if already imported).
2. Directly AFTER the closing `</button>` of the **Venue Settings** button in the header, add:
```jsx
            {currentVenueId && (
              <Link
                to={`/venues/${currentVenueId}`}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
              >
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Public page</span>
              </Link>
            )}
```
(`Users` is already imported in this file.)

---

## 9. Rebuild & Verification

**Schema changed (one column).** Choose ONE:

* **Standard (wipes data, matches project policy):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data (adds the column in place, then rebuilds code):**
```bash
docker compose exec database psql -U shiftboard_user -d shiftboard -c "ALTER TABLE venues ADD COLUMN IF NOT EXISTS show_rates_publicly BOOLEAN NOT NULL DEFAULT TRUE;"
docker compose up -d --build backend frontend
```
(`init.sql` is still updated so fresh databases get the column.)

Verify:
1. **Scrolling:** Venue Settings on a laptop and on a phone (or dev tools at 375×667): the header and Save/Cancel footer stay visible, the middle scrolls, the page behind does not scroll, and the modal never runs off-screen. Same for the Posted Shifts → View Roster modal with many positions.
2. **Directory:** as a worker, navbar → **Venues** → every venue listed; venues with open spots first; badges show "N open spots" / "Fully booked" / "No upcoming shifts", next shift in venue time, pay range when allowed. Search filters by name/address.
3. **Profile:** tap a venue → header with Directions link and phone; the 3 stats; dress code; positions with usual pay; Upcoming tab shows events with positions, pay, tips, "x/y filled".
4. **Pick up from profile:** as a worker, **Pick up shift** on an open position → notice "You're booked!" or "Request sent…", and the row changes to the matching status badge. It also appears in My Schedule.
5. **Past tab:** shows the last 90 days of events with "Fully staffed" / "Partly staffed".
6. **Privacy:** `GET /api/venues/{id}/public-events` and `/profile` contain no names, emails, phones, or other users' IDs. A worker never booked at the venue does NOT see arrival instructions; after being approved there, they do.
7. **Rate toggle:** Venue Settings → uncheck "Show our default pay rates…" → Save. As a worker: the directory card has no pay range, the profile positions show no rates and say "This venue shows pay on each posted shift instead." Posted shifts still show their pay. As that venue's manager, the profile still shows rates plus the "hidden from workers" note.
8. Manager dashboard **Public page** button opens the venue's profile; the profile's **Manage venue** button (managers/admins only) returns to `/venue`.
9. Venue names on Find Shifts cards link to the venue profile.