# Phase 29.1: Manager Dashboard Layout, Review Before Approving, Activity Log, Better Team Page, Searchable People

**Why:** Phases 23–29 each added a section to the venue dashboard, one under another. Posted Shifts ended up at the bottom, and the approval queue shows almost nothing about who is asking. This phase reorganizes the page around the work a manager does every day. It also fixes several problems found in an audit of the live page.

## What this phase adds

1. **Two-column dashboard** (desktop):
   - **Posted Shifts** on the left (2/3 width) at the top of the page.
   - On the right, stacked:
     - **Requests to review**
     - **Hand-offs to approve**
     - a new **Activity** log
   - On phones everything stacks, with Posted Shifts first. A **"3 requests to review" / "1 hand-off to approve"** strip at the top jumps down to the queues.
   - Header buttons are reordered: **Post a Shift** first, then Team, Settings, Payroll CSV, Public page. The badge says "Platform admin" when an admin is viewing.
   - Success banners clear themselves after 6 s. Errors stay until dismissed.
2. **Review before approving:**
   - Every request and hand-off in the queues now shows:
     - the **date and time**
     - the position
     - whether the position is **full**
     - the **worker's note** (it was never shown before)
   - **Review** opens a two-pane modal:
     - Left: the shift summary and the note.
     - Right: the worker's profile at this venue:
       - team status, contact details
       - rating, reliability (with the on-time, late, no-show and late-drop breakdown)
       - shifts worked here, this venue's own rating, "would book again" counts
       - positions, private note
       - their **history at this venue** (date, role, outcome, minutes late, rating)
     - For a hand-off you can flip between the person **taking** the shift and the person **giving it up**.
     - Approve, Deny and **Open event** buttons.
3. **Activity log** (new `venue_activity` table). One line per thing that happened at the venue, saying who did it:

   | Category | What's logged |
   |---|---|
   | Bookings | requests, instant bookings, approvals, denials, withdrawals, **drops**, removals, hand-off decisions |
   | Staffing | assigns, offers sent, offers accepted, nobody took it |
   | Team | adds, account creation, remove/block/unblock, invites sent, joins, co-managers added/removed |
   | Changes | event posted, edited (with the change text), cancelled, position cancelled, copied, venue settings |
   | Alerts | "hadn't clocked in 10 min after the start" |

   - Filter chips and **Load more**.
   - Clicking a line opens that event's roster, or the worker's profile.
   - It starts empty and records from this phase on.
4. **Searchable people (privacy setting).** A new per-worker setting, **Who can find me** (in the bell's ⚙ settings, now titled "Notifications & privacy"):
   - **Only venues I work with** (default): only venues they've worked or requested at can see them, plus anyone typing their exact email.
   - **Any venue on ShiftBoard**: any manager can find them by name or email. The email stays partly hidden (`jo***@gmail.com`) until they work together.
   - **Anyone on ShiftBoard**: same as venues today, reserved for future worker-to-worker features.
   - Phone search only ever matches people already related to the venue.
   - The Phase 29 **Assign / Offer** search now follows the same rules. Before, it found every worker on the platform by name.
5. **Team page redesign:**
   - Tab chips show counts: "Team 12", "Invite 3 pending", "Managers 2".
   - One toolbar row: filter box, a segmented **On team / Removed / Blocked / Everyone** control, and **Add people**.
   - Compact member rows: avatar, name, position tags, shifts here / last worked / upcoming, rating and reliability. Tapping a row expands it into call/email buttons, **Positions & note**, Remove/Block and the full profile (history included).
   - **Add people is search-first:**
     - Type a name, email or phone to see results with badges (On your team / Requested here / Removed / Blocked) and one-tap **Add**. The person gets a "You're on the <venue> team" notification.
     - If there's no match: **Invite them** or **Create an account**, with the email pre-filled.
   - The Managers tab has an empty state.
   - The Invite tab warns when the team link points at localhost.
6. **Audit fixes:**
   - **Page width:** the dashboard only took its content's width. Under the app's `flex flex-col` wrapper, `mx-auto` shrank it, which is why the page looked narrow on a wide screen. Fixed with `w-full`.
   - **Hand-off notes:** these never reached the manager, because `ShiftTransferResponse` had no `notes` field.
   - **Stale queue items:** requests for shifts that are **over or cancelled** no longer sit in the queue. The queue is sorted by shift date.
   - **Drops:** when a worker **dropped** a shift, nobody was told. Managers now get a notification (urgent within 48 h) and a log line.
   - **Invite links pointing at localhost:** this is what your screenshot showed. If `APP_BASE_URL` is unset or still localhost, invite links and QR codes now use the site the manager is on. You should still set `APP_BASE_URL` (see §E), because notification emails use it.
   - **Double "New New" badges:** a new worker showed "New" twice, once for rating and once for reliability. Reliability now says **"No history"** in muted grey.
   - **Dead code:** removed the old Phase 16 roster/calendar code from the dashboard. It was never rendered but still made 2 extra API calls on every refresh.
   - **Broken photos:** profile photos that fail to load fall back to initials.
   - **Posted Shifts header:** re-laid out (title row, then controls) so it fits the narrower column.

⚠️ **Schema change:** one new column (`users.discoverable`) and one new table (`venue_activity`). See §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` CORS logic (only add the one import and `include_router` line shown)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages.
* No native PostgreSQL ENUMs:
  - `users.discoverable`: `private` | `venues` | `everyone`
  - `venue_activity.category`: `bookings` | `staffing` | `team` | `changes` | `alerts`
  - `venue_activity.kind`: see `CATEGORY` in `services/activity.py`
* Aware UTC datetimes only.
* Activity and notification hooks always run **after** the endpoint's commit, open their own session and never raise. Never move them inside a transaction.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current (Phase 29 + 28.1) files and checked:
  - after applying them, the backend imports cleanly and all 114 API routes build
  - the frontend bundles with no missing imports
  - 36 new integration checks pass against PostgreSQL 16, and the Phase 29 suite still passes. One Phase 29 check changed on purpose: assign search no longer finds people who haven't opted in.
  - the new dashboard, Review modal and Team page were rendered with the real Tailwind build at desktop and phone widths

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDITS)

**Edit 1.** Find:
```sql
    firebase_uid VARCHAR(128) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    firebase_uid VARCHAR(128) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    discoverable VARCHAR(20) NOT NULL DEFAULT 'private',   -- Phase 29.1: private | venues | everyone
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 2.** Find:
```sql
CREATE INDEX idx_shift_offers_worker ON shift_offers(worker_id, status);
CREATE INDEX idx_shift_offers_shift ON shift_offers(shift_id, status);
```
Replace with:
```sql
CREATE INDEX idx_shift_offers_worker ON shift_offers(worker_id, status);
CREATE INDEX idx_shift_offers_shift ON shift_offers(shift_id, status);

-- ==============================================================================
-- Phase 29.1: Venue activity log (what happened at the venue, and who did it)
-- ==============================================================================
CREATE TABLE venue_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(40) NOT NULL,
    category VARCHAR(20) NOT NULL,                        -- bookings | staffing | team | changes | alerts
    summary VARCHAR(400) NOT NULL,
    event_id UUID REFERENCES shift_events(id) ON DELETE SET NULL,
    request_id UUID REFERENCES shift_requests(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_venue_activity_venue_created ON venue_activity(venue_id, created_at DESC);
```

---

## A2. `backend/src/models.py` (EDITS)

**Edit 1.** Find:
```python
    total_shifts = Column(Integer, nullable=False, default=0)
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```
Replace with:
```python
    total_shifts = Column(Integer, nullable=False, default=0)
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    discoverable = Column(String(20), nullable=False, default="private")   # Phase 29.1: private | venues | everyone
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```

**Edit 2.** Find:
```python
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"
```
Replace with:
```python
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class VenueActivity(Base):
    """Phase 29.1: one line in a venue's activity log."""
    __tablename__ = "venue_activity"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(40), nullable=False)
    category = Column(String(20), nullable=False)
    summary = Column(String(400), nullable=False)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="SET NULL"), nullable=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="SET NULL"), nullable=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"
```

---

## A3. `backend/src/schemas.py` (EDITS)
Includes the missing `notes` on `ShiftTransferResponse`.

**Edit 1.** Find:
```python
    to_worker_id: UUID
    status: str
    created_at: datetime
    updated_at: datetime
```
Replace with:
```python
    to_worker_id: UUID
    status: str
    notes: Optional[str] = None              # Phase 29.1: the note with the hand-off (was never sent)
    created_at: datetime
    updated_at: datetime
```

**Edit 2.** Find:
```python
    sms_available: bool = False              # server has SMS configured
    is_manager: bool = False                 # show manager-only options


```
Replace with:
```python
    sms_available: bool = False              # server has SMS configured
    is_manager: bool = False                 # show manager-only options
    discoverable: str = "private"            # Phase 29.1: private | venues | everyone


```

**Edit 3.** Find:
```python
    timezone: Optional[str] = None
    phone: Optional[str] = None              # saved to users.phone; "" clears it


```
Replace with:
```python
    timezone: Optional[str] = None
    phone: Optional[str] = None              # saved to users.phone; "" clears it
    discoverable: Optional[str] = None       # Phase 29.1: private | venues | everyone


```

**Edit 4.** Find:
```python
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str = "active"                   # active | removed | blocked
    on_list: bool = False                    # has a team-list row (added / invited), not just "worked here"
    source: Optional[str] = None             # manager | invite | import | admin | worked
```
Replace with:
```python
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str = "active"                   # active | removed | blocked | none (Phase 29.1: no relationship yet)
    on_list: bool = False                    # has a team-list row (added / invited), not just "worked here"
    source: Optional[str] = None             # manager | invite | import | admin | worked
```

**Edit 5.** Find:
```python

class TeamAddExisting(BaseModel):
    email: str
    positions: List[str] = []

```
Replace with:
```python

class TeamAddExisting(BaseModel):
    email: Optional[str] = None              # Phase 29.1: email OR worker_id (from People search)
    worker_id: Optional[UUID] = None
    positions: List[str] = []

```

**Edit 6.** Find:
```python
    review: Optional[str] = None
    aggregate_rating: float
    rating_count: int
```
Replace with:
```python
    review: Optional[str] = None
    aggregate_rating: float
    rating_count: int


# ------------------------------------------------------------------------------
# Phase 29.1: People search, worker profile, team summary, activity log
# ------------------------------------------------------------------------------
class PersonResult(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None              # masked (j***@gmail.com) unless related or exact match
    phone: Optional[str] = None              # only for people related to this venue
    avatar_url: Optional[str] = None
    relation: str = "none"                   # active | removed | blocked | worked | requested | none
    positions: List[str] = []
    aggregate_rating: float = 5.0
    rating_count: int = 0
    reliability_score: Optional[float] = None
    can_add: bool = True


class WorkerHistoryItem(BaseModel):
    request_id: UUID
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    status: str
    late_minutes: Optional[int] = None
    my_rating: Optional[int] = None
    would_book_again: Optional[bool] = None


class WorkerProfile(BaseModel):
    member: TeamMember
    history: List[WorkerHistoryItem] = []    # this venue only, newest first
    pending_here: int = 0                    # waiting requests at this venue
    other_venues: int = 0                    # other venues they've worked at (count only)


class TeamSummary(BaseModel):
    active: int = 0
    removed: int = 0
    blocked: int = 0
    invites_pending: int = 0
    managers: int = 0


class ActivityItem(BaseModel):
    id: UUID
    kind: str
    category: str
    summary: str
    actor_name: Optional[str] = None
    event_id: Optional[UUID] = None
    request_id: Optional[UUID] = None
    worker_id: Optional[UUID] = None
    created_at: datetime
```

---

# PART B: Backend

## B1. NEW FILE `backend/src/services/activity.py`

```python
"""
Phase 29.1: The venue activity log ("what happened here, and who did it").

Every public helper opens its own session, commits, and NEVER raises, so call it AFTER the
main action has committed (same rule as notify_events). record_in() works inside a session
you already have (no commit) - used by the background worker.

Categories (for the filter chips on the dashboard):
  bookings  - requests, instant bookings, approvals, denials, withdrawals, drops, removals, hand-offs
  staffing  - direct assigns and offers
  team      - team changes, invites, joins, co-managers
  changes   - events posted / edited / cancelled / copied, venue settings
  alerts    - not clocked in
"""
import logging
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import VenueActivity, Shift, ShiftEvent, ShiftRequest, User, Venue

logger = logging.getLogger("shiftboard.activity")

CATEGORY = {
    "request_created": "bookings",
    "instant_booked": "bookings",
    "request_approved": "bookings",
    "request_denied": "bookings",
    "request_withdrawn": "bookings",
    "shift_dropped": "bookings",
    "person_removed": "bookings",
    "transfer_approved": "bookings",
    "transfer_denied": "bookings",
    "assigned": "staffing",
    "offers_sent": "staffing",
    "offer_accepted": "staffing",
    "offer_nobody": "staffing",
    "team_added": "team",
    "team_account": "team",
    "team_status": "team",
    "invites_sent": "team",
    "team_joined": "team",
    "manager_added": "team",
    "manager_removed": "team",
    "event_created": "changes",
    "event_updated": "changes",
    "event_cancelled": "changes",
    "position_cancelled": "changes",
    "event_duplicated": "changes",
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
}
CATEGORIES = ("bookings", "staffing", "team", "changes", "alerts")


def person(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or (u.email or "Someone")


def short_when(start, venue: Optional[Venue]) -> str:
    try:
        tz = ZoneInfo((venue.timezone if venue else None) or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    return start.astimezone(tz).strftime("%a %b %-d")


async def record_in(
    db: AsyncSession,
    venue_id,
    kind: str,
    summary: str,
    *,
    actor_id=None,
    event_id=None,
    request_id=None,
    worker_id=None,
) -> None:
    """Adds one log line inside `db`. Does NOT commit."""
    db.add(VenueActivity(
        venue_id=venue_id,
        actor_user_id=actor_id,
        kind=kind,
        category=CATEGORY.get(kind, "changes"),
        summary=(summary or "")[:400],
        event_id=event_id,
        request_id=request_id,
        worker_id=worker_id,
    ))
    await db.flush()


async def _run(label: str, fn, *args, **kwargs) -> None:
    try:
        async with AsyncSessionLocal() as db:
            await fn(db, *args, **kwargs)
            await db.commit()
    except Exception:
        logger.exception(f"activity '{label}' failed")


# ---------------------------------------------------------------------------------------------
# Public helpers (own session, never raise)
# ---------------------------------------------------------------------------------------------
async def _for_request(db: AsyncSession, kind: str, request_id, actor_id, extra: str) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift = await db.scalar(select(Shift).where(Shift.id == req.shift_id))
    if shift is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    worker = await db.scalar(select(User).where(User.id == req.worker_id))
    what = f"{shift.role_type} · {event.title if event else shift.title} ({short_when(shift.start_time, venue)})"
    name = person(worker)
    text = {
        "request_created": f"{name} requested {what}",
        "instant_booked": f"{name} booked {what} (instant)",
        "request_approved": f"Approved {name} for {what}",
        "request_denied": f"Declined {name} for {what}",
        "request_withdrawn": f"{name} withdrew their request for {what}",
        "shift_dropped": f"{name} dropped {what}",
        "person_removed": f"Removed {name} from {what}",
        "assigned": f"Assigned {name} to {what}",
        "offer_accepted": f"{name} accepted the offer for {what}",
    }.get(kind, f"{name}: {what}")
    if extra:
        text += f" · {extra}"
    await record_in(db, shift.venue_id, kind, text, actor_id=actor_id, event_id=shift.event_id,
                    request_id=req.id, worker_id=req.worker_id)


async def for_request(kind: str, request_id, actor_id=None, extra: str = "") -> None:
    await _run(kind, _for_request, kind, request_id, actor_id, extra)


async def _for_shift(db: AsyncSession, kind: str, shift_id, actor_id, text_fmt: str) -> None:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    what = f"{shift.role_type} · {event.title if event else shift.title} ({short_when(shift.start_time, venue)})"
    await record_in(db, shift.venue_id, kind, text_fmt.format(what=what), actor_id=actor_id, event_id=shift.event_id)


async def for_shift(kind: str, shift_id, actor_id=None, text_fmt: str = "{what}") -> None:
    """text_fmt may use {what} = 'Role · Event (Sat Oct 4)'."""
    await _run(kind, _for_shift, kind, shift_id, actor_id, text_fmt)


async def _for_event(db: AsyncSession, kind: str, event_id, actor_id, extra: str) -> None:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    what = f"{event.title} ({short_when(event.start_time, venue)})"
    text = {
        "event_created": f"Posted {what}",
        "event_updated": f"Edited {what}",
        "event_cancelled": f"Cancelled {what}",
        "position_cancelled": f"Cancelled a position in {what}",
        "event_duplicated": f"Copied {what}",
    }.get(kind, what)
    if extra:
        text += f" · {extra}"
    await record_in(db, event.venue_id, kind, text, actor_id=actor_id, event_id=event.id)


async def for_event(kind: str, event_id, actor_id=None, extra: str = "") -> None:
    await _run(kind, _for_event, kind, event_id, actor_id, extra)


async def _for_worker(db: AsyncSession, kind: str, venue_id, worker_id, actor_id, text_fmt: str) -> None:
    worker = await db.scalar(select(User).where(User.id == worker_id))
    await record_in(db, venue_id, kind, text_fmt.format(name=person(worker)), actor_id=actor_id, worker_id=worker_id)


async def for_worker(kind: str, venue_id, worker_id, actor_id=None, text_fmt: str = "{name}") -> None:
    """text_fmt may use {name} = the worker's name."""
    await _run(kind, _for_worker, kind, venue_id, worker_id, actor_id, text_fmt)


async def _for_venue(db: AsyncSession, kind: str, venue_id, actor_id, text: str) -> None:
    await record_in(db, venue_id, kind, text, actor_id=actor_id)


async def for_venue(kind: str, venue_id, actor_id=None, text: str = "") -> None:
    await _run(kind, _for_venue, kind, venue_id, actor_id, text)
```

---

## B2. NEW FILE `backend/src/routers/activity.py`
`GET /api/venues/{venue_id}/activity?category=&limit=30&before=<iso>`. Requires the venue's manager or a platform admin. Newest first.

```python
"""
Phase 29.1: The venue activity log.

  GET /api/venues/{venue_id}/activity?category=&limit=30&before=<iso>
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, VenueActivity
from src.schemas import ActivityItem
from src.auth import require_manager_or_admin
from src.routers.venues import verify_venue_manager_access
from src.services.activity import CATEGORIES, person

router = APIRouter(prefix="/api/venues", tags=["Activity"])


@router.get("/{venue_id}/activity", response_model=List[ActivityItem])
async def venue_activity(
    venue_id: UUID,
    category: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    before: Optional[datetime] = Query(None, description="Older than this (for 'Load more')"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if category and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(CATEGORIES)}.")
    q = select(VenueActivity).where(VenueActivity.venue_id == venue_id)
    if category:
        q = q.where(VenueActivity.category == category)
    if before is not None:
        q = q.where(VenueActivity.created_at < before)
    rows = (await db.execute(q.order_by(VenueActivity.created_at.desc()).limit(limit))).scalars().all()
    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id}
    actors = {u.id: person(u) for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()} if actor_ids else {}
    return [
        ActivityItem(
            id=r.id, kind=r.kind, category=r.category, summary=r.summary,
            actor_name=actors.get(r.actor_user_id), event_id=r.event_id, request_id=r.request_id,
            worker_id=r.worker_id, created_at=r.created_at,
        )
        for r in rows
    ]
```

---

## B3. `backend/src/routers/team.py` (EDITS)
New endpoints (manager or admin):

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/venues/{venue_id}/team/summary` | `{active, removed, blocked, invites_pending, managers}` |
| GET | `/api/venues/{venue_id}/people?q=` | search (min 2 characters, max 20 results; privacy rules in the docstring) |
| GET | `/api/venues/{venue_id}/people/{worker_id}` | profile + history here (404 for private strangers) |

`POST /api/venues/{venue_id}/team` now also accepts `{worker_id}` (from search). Team changes write activity lines, and adding someone notifies them.

**Edit 1.** Find:
```python
  PUT    /api/venues/{venue_id}/ratings/{request_id}     rate a finished shift (1-5 + would book again)
  DELETE /api/venues/{venue_id}/ratings/{request_id}
"""
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import (
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftRequest, ShiftOffer, Rating,
)
from src.schemas import (
    TeamMember, TeamMemberUpdate, TeamMemberUpdateResult, TeamAddExisting, TeamCreateWorker,
    AccountCreateResult, VenueManagerItem, ManagerCreate, WorkerReliability, RatingInput, RatingResponse,
)
from src.auth import require_manager_or_admin, get_password_hash, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.routers.admin import _generate_temp_password
from src.services.team import set_membership, TEAM_STATUSES
from src.services.reliability import compute_reliability
from src.services.invites import valid_email

logger = logging.getLogger("shiftboard.team")
```
Replace with:
```python
  PUT    /api/venues/{venue_id}/ratings/{request_id}     rate a finished shift (1-5 + would book again)
  DELETE /api/venues/{venue_id}/ratings/{request_id}

Phase 29.1:
  GET    /api/venues/{venue_id}/team/summary             counts for the Team tabs
  GET    /api/venues/{venue_id}/people?q=                search people (respects each worker's "who can find me")
  GET    /api/venues/{venue_id}/people/{worker_id}       profile + history at this venue (queue "Review")
"""
import logging
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, update, delete, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import (
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftRequest, ShiftOffer, Rating,
    VenueInvite, ShiftEvent, TimeEntry,
)
from src.schemas import (
    TeamMember, TeamMemberUpdate, TeamMemberUpdateResult, TeamAddExisting, TeamCreateWorker,
    AccountCreateResult, VenueManagerItem, ManagerCreate, WorkerReliability, RatingInput, RatingResponse,
    PersonResult, WorkerProfile, WorkerHistoryItem, TeamSummary,
)
from src.auth import require_manager_or_admin, get_password_hash, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.routers.admin import _generate_temp_password
from src.services.team import set_membership, TEAM_STATUSES
from src.services.reliability import compute_reliability
from src.services.invites import valid_email, invite_status
from src.services import activity, notify_events

logger = logging.getLogger("shiftboard.team")
```

**Edit 2.** Find:
```python
# Team list
# ---------------------------------------------------------------------------------------------
async def build_team(db: AsyncSession, venue_id: UUID, only_ids: Optional[List[UUID]] = None) -> List[TeamMember]:
    """Everyone on the list (any status) + everyone who has worked / been booked here."""
    now = datetime.now(timezone.utc)
    wl_q = select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id)
```
Replace with:
```python
# Team list
# ---------------------------------------------------------------------------------------------
async def build_team(
    db: AsyncSession, venue_id: UUID, only_ids: Optional[List[UUID]] = None, force_ids: Optional[List[UUID]] = None,
) -> List[TeamMember]:
    """Everyone on the list (any status) + everyone who has worked / been booked here.
    Phase 29.1: force_ids are included even with no relationship (status 'none'), for profiles."""
    now = datetime.now(timezone.utc)
    wl_q = select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id)
```

**Edit 3.** Find:
```python
    worked_ids = set((await db.execute(worked_q)).scalars().all())

    ids = set(rows.keys()) | worked_ids
    if not ids:
        return []
```
Replace with:
```python
    worked_ids = set((await db.execute(worked_q)).scalars().all())

    ids = set(rows.keys()) | worked_ids | set(force_ids or [])
    if not ids:
        return []
```

**Edit 4.** Find:
```python
            phone=u.phone,
            avatar_url=u.avatar_url,
            status=(row.status or "active") if row is not None else "active",
            on_list=row is not None,
            source=(row.source if row is not None else "worked"),
            positions=list(row.positions or []) if row is not None else [],
            notes=row.notes if row is not None else None,
```
Replace with:
```python
            phone=u.phone,
            avatar_url=u.avatar_url,
            status=(row.status or "active") if row is not None else ("active" if wid in worked_ids else "none"),
            on_list=row is not None,
            source=(row.source if row is not None else ("worked" if wid in worked_ids else None)),
            positions=list(row.positions or []) if row is not None else [],
            notes=row.notes if row is not None else None,
```

**Edit 5.** Find:
```python
):
    await verify_venue_manager_access(venue_id, current_user, db)
    email = (body.email or "").strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    user = await db.scalar(select(User).where(func.lower(User.email) == email))
    if user is None:
        raise HTTPException(status_code=404, detail="No ShiftBoard account uses that email. Create an account for them, or send an invite.")
    if normalize_role(user.role) != "worker":
        raise HTTPException(status_code=400, detail="That account is a manager or admin account, not a worker.")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
    try:
        await set_membership(db, venue_id, user.id, status="active", source="manager",
                             positions=_clean_positions(body.positions), added_by=current_user.id)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not add them: {e}")
    return await _one_member(db, venue_id, user.id)


```
Replace with:
```python
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if body.worker_id is not None:
        # Phase 29.1: picked from People search. Only people the venue may see can be added this way.
        user = await db.scalar(select(User).where(User.id == body.worker_id))
        if user is None or not await _may_see(db, venue_id, user):
            raise HTTPException(status_code=404, detail="Person not found. Add them by their email instead.")
    else:
        email = (body.email or "").strip().lower()
        if not valid_email(email):
            raise HTTPException(status_code=400, detail="Enter a valid email address.")
        user = await db.scalar(select(User).where(func.lower(User.email) == email))
        if user is None:
            raise HTTPException(status_code=404, detail="No ShiftBoard account uses that email. Create an account for them, or send an invite.")
    if normalize_role(user.role) != "worker":
        raise HTTPException(status_code=400, detail="That account is a manager or admin account, not a worker.")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
    user_id = user.id
    try:
        await set_membership(db, venue_id, user_id, status="active", source="manager",
                             positions=_clean_positions(body.positions), added_by=current_user.id)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not add them: {e}")
    await activity.for_worker("team_added", venue_id, user_id, current_user.id, "Added {name} to the team")   # Phase 29.1
    await notify_events.team_added(venue_id, user_id)                                                       # Phase 29.1
    return await _one_member(db, venue_id, user_id)


```

**Edit 6.** Find:
```python
            if normalize_role(existing.role) != "worker":
                raise HTTPException(status_code=409, detail="That email belongs to a manager or admin account.")
            await set_membership(db, venue_id, existing.id, status="active", source="manager",
                                 positions=positions, added_by=current_user.id)
            await db.commit()
            return AccountCreateResult(
                user_id=existing.id, created=False,
```
Replace with:
```python
            if normalize_role(existing.role) != "worker":
                raise HTTPException(status_code=409, detail="That email belongs to a manager or admin account.")
            existing_id = existing.id
            await set_membership(db, venue_id, existing_id, status="active", source="manager",
                                 positions=positions, added_by=current_user.id)
            await db.commit()
            await activity.for_worker("team_added", venue_id, existing_id, current_user.id, "Added {name} to the team")
            await notify_events.team_added(venue_id, existing_id)
            return AccountCreateResult(
                user_id=existing.id, created=False,
```

**Edit 7.** Find:
```python
        logger.exception("create_worker_account failed")
        raise HTTPException(status_code=500, detail=f"Could not create the account: {e}")
    return AccountCreateResult(
        user_id=user_id, created=True, temporary_password=temp,
```
Replace with:
```python
        logger.exception("create_worker_account failed")
        raise HTTPException(status_code=500, detail=f"Could not create the account: {e}")
    await activity.for_worker("team_account", venue_id, user_id, current_user.id, "Created an account for {name} and added them to the team")
    return AccountCreateResult(
        user_id=user_id, created=True, temporary_password=temp,
```

**Edit 8.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")

    if new_status in ("blocked", "removed"):
        booked_upcoming = int(await db.scalar(
```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")

    if new_status is not None:
        await activity.for_worker(
            "team_status", venue_id, worker_id, current_user.id,
            {"active": "Put {name} back on the team", "removed": "Removed {name} from the team", "blocked": "Blocked {name}"}[new_status],
        )
    if new_status in ("blocked", "removed"):
        booked_upcoming = int(await db.scalar(
```

**Edit 9.** Find:
```python
        logger.exception("add_manager failed")
        raise HTTPException(status_code=500, detail=f"Could not add the manager: {e}")
    return AccountCreateResult(
        user_id=user_id, created=created, temporary_password=temp,
```
Replace with:
```python
        logger.exception("add_manager failed")
        raise HTTPException(status_code=500, detail=f"Could not add the manager: {e}")
    await activity.for_worker("manager_added", venue_id, user_id, current_user.id, "Added {name} as a manager")
    return AccountCreateResult(
        user_id=user_id, created=created, temporary_password=temp,
```

**Edit 10.** Find:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the manager: {e}")
    return None

```
Replace with:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the manager: {e}")
    await activity.for_worker("manager_removed", venue_id, user_id, current_user.id, "Removed {name} as a manager")
    return None

```

**Edit 11.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Could not remove the rating: {e}")
    return resp
```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Could not remove the rating: {e}")
    return resp


# ---------------------------------------------------------------------------------------------
# Phase 29.1: people search, profiles, summary
# ---------------------------------------------------------------------------------------------
DISCOVERABLE_VALUES = ("private", "venues", "everyone")


def mask_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    return f"{local[:2]}{'*' * max(3, len(local) - 2)}@{domain}"


async def _relations(db: AsyncSession, venue_id: UUID, ids: List[UUID]) -> Dict[UUID, str]:
    """worker_id -> active | removed | blocked | worked | requested (missing = none)."""
    if not ids:
        return {}
    rel: Dict[UUID, str] = {}
    for wid, st in (await db.execute(
        select(ShiftRequest.worker_id, ShiftRequest.status)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(Shift.venue_id == venue_id, ShiftRequest.worker_id.in_(ids))
    )).all():
        if (st or "").lower() in WORKED_STATUSES:
            rel[wid] = "worked"
        else:
            rel.setdefault(wid, "requested")
    for wid, st in (await db.execute(
        select(VenueWhitelist.worker_id, VenueWhitelist.status)
        .where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id.in_(ids))
    )).all():
        rel[wid] = st or "active"
    return rel


async def _may_see(db: AsyncSession, venue_id: UUID, user: User) -> bool:
    """A venue can look someone up if they're related to it, or chose to be findable by venues."""
    if (user.discoverable or "private") in ("venues", "everyone"):
        return True
    return user.id in await _relations(db, venue_id, [user.id])


@router.get("/{venue_id}/team/summary", response_model=TeamSummary)
async def team_summary(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    members = await build_team(db, venue_id)
    invites = (await db.execute(
        select(VenueInvite).where(VenueInvite.venue_id == venue_id, VenueInvite.kind == "personal")
    )).scalars().all()
    managers = int(await db.scalar(select(func.count(VenueManager.user_id)).where(VenueManager.venue_id == venue_id)) or 0)
    return TeamSummary(
        active=sum(1 for m in members if m.status == "active"),
        removed=sum(1 for m in members if m.status == "removed"),
        blocked=sum(1 for m in members if m.status == "blocked"),
        invites_pending=sum(1 for i in invites if invite_status(i) == "pending"),
        managers=managers,
    )


@router.get("/{venue_id}/people", response_model=List[PersonResult])
async def search_people(
    venue_id: UUID,
    q: str = Query("", max_length=100),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Finds WORKER accounts by name, email or phone.
    * People related to this venue (team list, worked or requested here): name, email or phone.
    * Everyone else: only if they allow venues to find them ("venues" or "everyone"), by name or email.
    * An exact email address always finds the account (the manager already knows it).
    """
    await verify_venue_manager_access(venue_id, current_user, db)
    term = (q or "").strip().lower()
    if len(term) < 2:
        return []
    digits = re.sub(r"\D", "", term)
    related = (
        select(VenueWhitelist.worker_id).where(VenueWhitelist.venue_id == venue_id)
        .union(
            select(ShiftRequest.worker_id).join(Shift, Shift.id == ShiftRequest.shift_id).where(Shift.venue_id == venue_id)
        )
    )
    like = f"%{term}%"
    name_or_email = or_(
        func.lower(func.concat(User.first_name, " ", User.last_name)).like(like),
        func.lower(User.email).like(like),
    )
    conds = [
        and_(name_or_email, or_(User.id.in_(related), User.discoverable.in_(("venues", "everyone")))),
        func.lower(User.email) == term,
    ]
    if len(digits) >= 4:
        conds.append(and_(func.regexp_replace(func.coalesce(User.phone, ""), "[^0-9]", "", "g").like(f"%{digits}%"), User.id.in_(related)))
    users = (await db.execute(
        select(User).where(func.lower(User.role) == "worker", User.is_active == True, or_(*conds)).limit(25)
    )).scalars().all()
    if not users:
        return []
    ids = [u.id for u in users]
    rel = await _relations(db, venue_id, ids)
    positions = {r.worker_id: list(r.positions or []) for r in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id.in_(ids))
    )).scalars().all()}
    scores = await compute_reliability(db, ids)
    out = []
    for u in users:
        r = rel.get(u.id, "none")
        known = r != "none" or (u.email or "").lower() == term
        out.append(PersonResult(
            worker_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "",
            email=u.email if known else mask_email(u.email),
            phone=u.phone if r != "none" else None,
            avatar_url=u.avatar_url, relation=r, positions=positions.get(u.id, []),
            aggregate_rating=float(u.aggregate_rating or 0.0), rating_count=int(u.rating_count or 0),
            reliability_score=(scores.get(u.id) or {}).get("score"),
            can_add=r not in ("active", "worked", "blocked"),   # "worked" (no removed/blocked row) is already on the team
        ))
    order = {"active": 0, "worked": 1, "requested": 2, "removed": 3, "none": 4, "blocked": 5}
    out.sort(key=lambda p: (order.get(p.relation, 9), (p.first_name or "").lower(), (p.last_name or "").lower()))
    return out[:20]


@router.get("/{venue_id}/people/{worker_id}", response_model=WorkerProfile)
async def person_profile(
    venue_id: UUID,
    worker_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Worker profile for this venue: team info, ratings, reliability and their history HERE (newest first)."""
    await verify_venue_manager_access(venue_id, current_user, db)
    user = await db.scalar(select(User).where(User.id == worker_id))
    if user is None or normalize_role(user.role) != "worker" or not await _may_see(db, venue_id, user):
        raise HTTPException(status_code=404, detail="Person not found.")
    found = await build_team(db, venue_id, only_ids=[worker_id], force_ids=[worker_id])
    if not found:
        raise HTTPException(status_code=404, detail="Person not found.")
    member = found[0]
    if member.status == "none":
        member.email = mask_email(member.email)
        member.phone = None

    rows = (await db.execute(
        select(ShiftRequest, Shift)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(Shift.venue_id == venue_id, ShiftRequest.worker_id == worker_id)
        .order_by(Shift.start_time.desc())
        .limit(15)
    )).all()
    req_ids = [r.id for r, _ in rows]
    shift_ids = [s.id for _, s in rows]
    event_ids = {s.event_id for _, s in rows if s.event_id}
    titles = {e.id: e.title for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    ratings = {r.shift_request_id: r for r in (await db.execute(select(Rating).where(Rating.shift_request_id.in_(req_ids)))).scalars().all()} if req_ids else {}
    first_in = dict((await db.execute(
        select(TimeEntry.shift_id, func.min(TimeEntry.clock_in_time))
        .where(TimeEntry.worker_id == worker_id, TimeEntry.shift_id.in_(shift_ids))
        .group_by(TimeEntry.shift_id)
    )).all()) if shift_ids else {}
    history = []
    for r, s in rows:
        late = None
        t = first_in.get(s.id)
        if t is not None:
            mins = int((t - s.start_time).total_seconds() // 60)
            late = mins if mins > 10 else 0
        rt = ratings.get(r.id)
        history.append(WorkerHistoryItem(
            request_id=r.id, event_id=s.event_id, title=titles.get(s.event_id) or s.title or "Shift",
            role_type=s.role_type or "Worker", start_time=s.start_time, end_time=s.end_time,
            status=(r.status or "").lower(), late_minutes=late,
            my_rating=rt.rating if rt else None, would_book_again=rt.would_book_again if rt else None,
        ))
    pending_here = sum(1 for h in history if h.status in ("pending", "pending_manager_approval"))
    other_venues = int(await db.scalar(
        select(func.count(func.distinct(Shift.venue_id)))
        .select_from(ShiftRequest).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id == worker_id, Shift.venue_id != venue_id,
               func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
    ) or 0)
    return WorkerProfile(member=member, history=history, pending_here=pending_here, other_venues=other_venues)
```

---

## B4. `backend/src/services/notify.py` (EDIT)

**Edit 1.** Find:
```python
    "offer_update": ("manager", False),      # Phase 29: offer accepted / nobody took it
    "team_joined": ("manager", False),       # Phase 29: someone joined through an invite
    "test": ("test", True),
}
```
Replace with:
```python
    "offer_update": ("manager", False),      # Phase 29: offer accepted / nobody took it
    "team_joined": ("manager", False),       # Phase 29: someone joined through an invite
    "team_added": ("booking", False),        # Phase 29.1: a manager added you to their team
    "shift_dropped": ("manager", True),      # Phase 29.1: a worker dropped a booked shift
    "test": ("test", True),
}
```

---

## B5. `backend/src/services/notify_events.py` (EDIT: append)

**Edit 1.** Find:
```python
async def team_joined(venue_id, worker_id) -> None:
    await _run("team_joined", _team_joined, venue_id, worker_id)
```
Replace with:
```python
async def team_joined(venue_id, worker_id) -> None:
    await _run("team_joined", _team_joined, venue_id, worker_id)


# ---------------------------------------------------------------------------------------------
# Phase 29.1: added to a team, shift dropped
# ---------------------------------------------------------------------------------------------
async def _team_added(db: AsyncSession, venue_id, worker_id) -> None:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        return
    await notify_in(
        db, [worker_id], "team_added",
        f"You're on the {venue.name} team",
        f"A manager at {venue.name} added you to their team. You'll see their shifts first and get alerts when they post new ones.",
        "/worker", venue_id=venue_id, dedupe_key=f"team-added:{venue_id}:{worker_id}:{datetime.now(timezone.utc).date()}",
    )


async def team_added(venue_id, worker_id) -> None:
    await _run("team_added", _team_added, venue_id, worker_id)


async def _shift_dropped(db: AsyncSession, request_id) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift, venue, event, _ = await _shift_bundle(db, req.shift_id)
    worker = await db.scalar(select(User).where(User.id == req.worker_id))
    if shift is None:
        return
    await notify_in(
        db, await manager_ids(db, shift.venue_id), "shift_dropped",
        f"{person(worker)} dropped {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. The spot is open again. Assign or offer it to someone from the event.",
        manager_link(shift.venue_id, shift.event_id), venue_id=shift.venue_id, event_id=shift.event_id,
        request_id=req.id, urgent=is_soon(shift.start_time), dedupe_key=f"dropped:{req.id}",
    )


async def shift_dropped(request_id) -> None:
    await _run("shift_dropped", _shift_dropped, request_id)
```

---

## B6. `backend/src/routers/notifications.py` (EDITS)
`discoverable` in GET/PUT `/api/notifications/preferences` (400 unless private / venues / everyone).

**Edit 1.** Find:
```python
        sms_available=sms_available(),
        is_manager=is_manager,
    )

```
Replace with:
```python
        sms_available=sms_available(),
        is_manager=is_manager,
        discoverable=user.discoverable or "private",     # Phase 29.1
    )

```

**Edit 2.** Find:
```python
    phone = data.pop("phone", None)
    clear_quiet = data.pop("clear_quiet_hours", False)
    if phone is not None and phone.strip() and not normalize_phone(phone):
        raise HTTPException(status_code=400, detail="Enter a mobile number like (555) 555-0100 or +15555550100.")
```
Replace with:
```python
    phone = data.pop("phone", None)
    clear_quiet = data.pop("clear_quiet_hours", False)
    discoverable = data.pop("discoverable", None)                      # Phase 29.1
    if discoverable is not None and discoverable not in ("private", "venues", "everyone"):
        raise HTTPException(status_code=400, detail="Who can find you must be private, venues or everyone.")
    if phone is not None and phone.strip() and not normalize_phone(phone):
        raise HTTPException(status_code=400, detail="Enter a mobile number like (555) 555-0100 or +15555550100.")
```

**Edit 3.** Find:
```python
        if phone is not None:
            current_user.phone = phone.strip() or None
        await db.commit()
    except HTTPException:
```
Replace with:
```python
        if phone is not None:
            current_user.phone = phone.strip() or None
        if discoverable is not None:
            current_user.discoverable = discoverable
        await db.commit()
    except HTTPException:
```

---

## B7. `backend/src/services/staffing.py` (EDITS)
Assign/Offer search follows the privacy setting.

**Edit 1.** Find:
```python

from fastapi import HTTPException, status
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

```
Replace with:
```python

from fastapi import HTTPException, status
from sqlalchemy import select, func, or_, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

```

**Edit 2.** Find:
```python
    elif q and q.strip():
        term = f"%{q.strip().lower()}%"
        for u in (await db.execute(
            select(User).where(
                func.lower(User.role) == "worker", User.is_active == True,
                or_(
                    func.lower(User.first_name + " " + User.last_name).like(term),
                    func.lower(User.email).like(term),
                ),
            ).limit(25)
```
Replace with:
```python
    elif q and q.strip():
        term = f"%{q.strip().lower()}%"
        # Phase 29.1: outside the team, only people who let venues find them (or an exact email)
        related = (
            select(VenueWhitelist.worker_id).where(VenueWhitelist.venue_id == venue_id)
            .union(select(ShiftRequest.worker_id).join(Shift, Shift.id == ShiftRequest.shift_id).where(Shift.venue_id == venue_id))
        )
        for u in (await db.execute(
            select(User).where(
                func.lower(User.role) == "worker", User.is_active == True,
                or_(
                    and_(
                        or_(
                            func.lower(User.first_name + " " + User.last_name).like(term),
                            func.lower(User.email).like(term),
                        ),
                        or_(User.id.in_(related), User.discoverable.in_(("venues", "everyone"))),
                    ),
                    func.lower(User.email) == q.strip().lower(),
                ),
            ).limit(25)
```

---

## B8. `backend/src/services/invites.py` (EDITS)

**Edit 1.** Find:
```python


def invite_url(token: str) -> str:
    return absolute_link(f"/join/{token}")


```
Replace with:
```python


def invite_url(token: str, base: Optional[str] = None) -> str:
    """Phase 29.1: `base` = the site the manager is using (see public_base), else APP_BASE_URL."""
    if base:
        return f"{base.rstrip('/')}/join/{token}"
    return absolute_link(f"/join/{token}")


def public_base(request) -> Optional[str]:
    """
    Phase 29.1: the public address for invite links.
    APP_BASE_URL wins when it's set to a real address. If it's unset or still points at localhost,
    use the address the manager's browser is on (Origin / Referer header), so links and QR codes
    work before APP_BASE_URL is configured.
    """
    cfg = (settings.APP_BASE_URL or "").rstrip("/")
    if cfg and "localhost" not in cfg and "127.0.0.1" not in cfg:
        return cfg
    origin = (request.headers.get("origin") or "").rstrip("/")
    if not origin:
        ref = request.headers.get("referer") or ""
        m = re.match(r"^(https?://[^/]+)", ref)
        origin = m.group(1) if m else ""
    if origin.startswith("http://") or origin.startswith("https://"):
        return origin
    return cfg or None


```

**Edit 2.** Find:
```python


async def send_invite(inv: VenueInvite, venue: Venue, inviter_name: str) -> Tuple[bool, bool]:
    """Emails / texts one personal invite. Never raises. Returns (emailed, texted)."""
    url = invite_url(inv.token)
    first = (inv.first_name or "").strip()
    hello = f"Hi {first}, " if first else ""
```
Replace with:
```python


async def send_invite(inv: VenueInvite, venue: Venue, inviter_name: str, base: Optional[str] = None) -> Tuple[bool, bool]:
    """Emails / texts one personal invite. Never raises. Returns (emailed, texted)."""
    url = invite_url(inv.token, base)
    first = (inv.first_name or "").strip()
    hello = f"Hi {first}, " if first else ""
```

---

## B9. `backend/src/routers/invites.py` (EDITS)
Invite links use `public_base(request)`. Invites sent and team joins are logged.

**Edit 1.** Find:
```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
```
Replace with:
```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
```

**Edit 2.** Find:
```python
from src.services.invites import (
    get_or_create_link, regenerate_link, invite_url, qr_svg, invite_status, valid_email, new_token,
    send_invite, PERSONAL_DAYS, as_utc,
)
from src.services.messaging import email_available, normalize_phone
from src.services.team import set_membership
```
Replace with:
```python
from src.services.invites import (
    get_or_create_link, regenerate_link, invite_url, qr_svg, invite_status, valid_email, new_token,
    send_invite, PERSONAL_DAYS, as_utc, public_base,
)
from src.services import activity
from src.services.messaging import email_available, normalize_phone
from src.services.team import set_membership
```

**Edit 3.** Find:
```python


def _link_response(inv: VenueInvite) -> InviteLinkResponse:
    url = invite_url(inv.token)
    return InviteLinkResponse(id=inv.id, token=inv.token, url=url, expires_at=inv.expires_at, uses=inv.uses or 0, qr_svg=qr_svg(url))


def _personal_response(inv: VenueInvite, accepted_name=None) -> PersonalInvite:
    return PersonalInvite(
        id=inv.id, first_name=inv.first_name, last_name=inv.last_name, email=inv.email, phone=inv.phone,
        positions=list(inv.positions or []), status=invite_status(inv), url=invite_url(inv.token),
        created_at=inv.created_at, expires_at=inv.expires_at, last_sent_at=inv.last_sent_at,
        accepted_at=inv.accepted_at, accepted_by_name=accepted_name,
```
Replace with:
```python


def _link_response(inv: VenueInvite, base=None) -> InviteLinkResponse:
    url = invite_url(inv.token, base)
    return InviteLinkResponse(id=inv.id, token=inv.token, url=url, expires_at=inv.expires_at, uses=inv.uses or 0, qr_svg=qr_svg(url))


def _personal_response(inv: VenueInvite, accepted_name=None, base=None) -> PersonalInvite:
    return PersonalInvite(
        id=inv.id, first_name=inv.first_name, last_name=inv.last_name, email=inv.email, phone=inv.phone,
        positions=list(inv.positions or []), status=invite_status(inv), url=invite_url(inv.token, base),
        created_at=inv.created_at, expires_at=inv.expires_at, last_sent_at=inv.last_sent_at,
        accepted_at=inv.accepted_at, accepted_by_name=accepted_name,
```

**Edit 4.** Find:
```python
@router.get("/api/venues/{venue_id}/invites/link", response_model=InviteLinkResponse)
async def get_team_link(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
```
Replace with:
```python
@router.get("/api/venues/{venue_id}/invites/link", response_model=InviteLinkResponse)
async def get_team_link(
    request: Request,
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
```

**Edit 5.** Find:
```python
    try:
        inv = await get_or_create_link(db, venue_id, current_user.id)
        resp = _link_response(inv)
        await db.commit()
    except Exception as e:
```
Replace with:
```python
    try:
        inv = await get_or_create_link(db, venue_id, current_user.id)
        resp = _link_response(inv, public_base(request))
        await db.commit()
    except Exception as e:
```

**Edit 6.** Find:
```python
@router.post("/api/venues/{venue_id}/invites/link/regenerate", response_model=InviteLinkResponse)
async def regenerate_team_link(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
```
Replace with:
```python
@router.post("/api/venues/{venue_id}/invites/link/regenerate", response_model=InviteLinkResponse)
async def regenerate_team_link(
    request: Request,
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
```

**Edit 7.** Find:
```python
    try:
        inv = await regenerate_link(db, venue_id, current_user.id)
        resp = _link_response(inv)
        await db.commit()
    except Exception as e:
```
Replace with:
```python
    try:
        inv = await regenerate_link(db, venue_id, current_user.id)
        resp = _link_response(inv, public_base(request))
        await db.commit()
    except Exception as e:
```

**Edit 8.** Find:
```python
@router.get("/api/venues/{venue_id}/invites", response_model=List[PersonalInvite])
async def list_invites(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
```
Replace with:
```python
@router.get("/api/venues/{venue_id}/invites", response_model=List[PersonalInvite])
async def list_invites(
    request: Request,
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
```

**Edit 9.** Find:
```python
    acc_ids = {r.accepted_by_user_id for r in rows if r.accepted_by_user_id}
    names = {u.id: _person(u) for u in (await db.execute(select(User).where(User.id.in_(acc_ids)))).scalars().all()} if acc_ids else {}
    return [_personal_response(r, names.get(r.accepted_by_user_id)) for r in rows]


@router.post("/api/venues/{venue_id}/invites", response_model=InviteBatchResult)
async def create_invites(
    venue_id: UUID,
    body: InviteBatchCreate,
```
Replace with:
```python
    acc_ids = {r.accepted_by_user_id for r in rows if r.accepted_by_user_id}
    names = {u.id: _person(u) for u in (await db.execute(select(User).where(User.id.in_(acc_ids)))).scalars().all()} if acc_ids else {}
    base = public_base(request)
    return [_personal_response(r, names.get(r.accepted_by_user_id), base) for r in rows]


@router.post("/api/venues/{venue_id}/invites", response_model=InviteBatchResult)
async def create_invites(
    request: Request,
    venue_id: UUID,
    body: InviteBatchCreate,
```

**Edit 10.** Find:
```python
        raise HTTPException(status_code=400, detail=f"Up to {MAX_ROWS} people per upload.")
    now = datetime.now(timezone.utc)
    results: List[InviteRowResult] = []
    to_send: List[VenueInvite] = []
```
Replace with:
```python
        raise HTTPException(status_code=400, detail=f"Up to {MAX_ROWS} people per upload.")
    now = datetime.now(timezone.utc)
    base = public_base(request)                     # Phase 29.1
    results: List[InviteRowResult] = []
    to_send: List[VenueInvite] = []
```

**Edit 11.** Find:
```python
                results.append(InviteRowResult(
                    row=i, name=name, email=email, result="already_invited",
                    message="Already invited; use Resend if they lost it.", invite_id=inv.id, url=invite_url(inv.token),
                ))
                continue
```
Replace with:
```python
                results.append(InviteRowResult(
                    row=i, name=name, email=email, result="already_invited",
                    message="Already invited; use Resend if they lost it.", invite_id=inv.id, url=invite_url(inv.token, base),
                ))
                continue
```

**Edit 12.** Find:
```python
            await db.flush()
            results.append(InviteRowResult(
                row=i, name=name, email=email, result="invited", message="Invited.", invite_id=inv.id, url=invite_url(inv.token),
            ))
            if body.send:
```
Replace with:
```python
            await db.flush()
            results.append(InviteRowResult(
                row=i, name=name, email=email, result="invited", message="Invited.", invite_id=inv.id, url=invite_url(inv.token, base),
            ))
            if body.send:
```

**Edit 13.** Find:
```python
        async def _one(inv):
            async with sem:
                return await send_invite(inv, venue, inviter)
        for e_ok, t_ok in await asyncio.gather(*[_one(inv) for inv in to_send]):
            emailed += int(e_ok)
            texted += int(t_ok)

    invited = sum(1 for r in results if r.result == "invited")
    return InviteBatchResult(
        results=results, invited=invited, skipped=len(results) - invited,
```
Replace with:
```python
        async def _one(inv):
            async with sem:
                return await send_invite(inv, venue, inviter, base)
        for e_ok, t_ok in await asyncio.gather(*[_one(inv) for inv in to_send]):
            emailed += int(e_ok)
            texted += int(t_ok)

    invited = sum(1 for r in results if r.result == "invited")
    if invited:
        await activity.for_venue("invites_sent", venue_id, current_user.id,
                                 f"Invited {invited} {'person' if invited == 1 else 'people'}"
                                 + (" from a CSV file" if body.source == "import" else ""))   # Phase 29.1
    return InviteBatchResult(
        results=results, invited=invited, skipped=len(results) - invited,
```

**Edit 14.** Find:
```python
@router.post("/api/venues/{venue_id}/invites/{invite_id}/resend", response_model=PersonalInvite)
async def resend_invite(
    venue_id: UUID,
    invite_id: UUID,
```
Replace with:
```python
@router.post("/api/venues/{venue_id}/invites/{invite_id}/resend", response_model=PersonalInvite)
async def resend_invite(
    request: Request,
    venue_id: UUID,
    invite_id: UUID,
```

**Edit 15.** Find:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not resend: {e}")
    await send_invite(inv, venue, _person(current_user))
    return _personal_response(inv)


```
Replace with:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not resend: {e}")
    base = public_base(request)
    await send_invite(inv, venue, _person(current_user), base)
    return _personal_response(inv, None, base)


```

**Edit 16.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Could not join the team: {e}")
    await notify_events.team_joined(venue_id, current_user.id)
    return InviteAcceptResult(venue_id=venue_id, venue_name=venue_name, already_member=False)
```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Could not join the team: {e}")
    await notify_events.team_joined(venue_id, current_user.id)
    await activity.for_worker("team_joined", venue_id, current_user.id, current_user.id,
                              "{name} joined the team with " + ("a personal invite" if inv.kind == "personal" else "the team link"))   # Phase 29.1
    return InviteAcceptResult(venue_id=venue_id, venue_name=venue_name, already_member=False)
```

---

## B10. `backend/src/routers/venues.py` (EDITS)
The pending queue skips shifts that are over or cancelled and is sorted by shift date; venue-settings saves are logged.

**Edit 1.** Find:
```python
from src.services.clock import auto_close_open_entries, late_minutes as clock_late_minutes
from src.services.locations import load_locations

router = APIRouter(prefix="/api/venues", tags=["Venues"])
```
Replace with:
```python
from src.services.clock import auto_close_open_entries, late_minutes as clock_late_minutes
from src.services.locations import load_locations
from src.services import activity

router = APIRouter(prefix="/api/venues", tags=["Venues"])
```

**Edit 2.** Find:
```python
            func.lower(ShiftRequest.status).in_([
                "pending", "pending_manager_approval"
            ])
        )
        .order_by(ShiftRequest.created_at.asc())
    )
    return result.scalars().all()
```
Replace with:
```python
            func.lower(ShiftRequest.status).in_([
                "pending", "pending_manager_approval"
            ]),
            Shift.end_time > datetime.now(timezone.utc),          # Phase 29.1: not for shifts that are over
            func.upper(Shift.status) != "CANCELLED",
        )
        .order_by(Shift.start_time.asc(), ShiftRequest.created_at.asc())
    )
    return result.scalars().all()
```

**Edit 3.** Find:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update venue: {str(e)}")
    return venue

```
Replace with:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update venue: {str(e)}")
    changed = ", ".join(k.replace("_", " ") for k in list(data.keys())[:6])
    await activity.for_venue("venue_settings", venue_id, current_user.id,
                             f"Updated venue settings{': ' + changed if changed else ''}")   # Phase 29.1
    return venue

```

---

## B11. `backend/src/routers/shifts.py` (EDITS)
Approvals and denials are logged. **Drops now notify managers** and are logged.

**Edit 1.** Find:
```python
from src.services.clock import clock_in, clock_out, auto_close_open_entries
from src.services import notify_events

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```
Replace with:
```python
from src.services.clock import clock_in, clock_out, auto_close_open_entries
from src.services import notify_events
from src.services import activity

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```

**Edit 2.** Find:
```python
    if target_clean == "approved" and prev_status != "approved":
        await notify_events.request_decided(shift_req.id, True)
    elif target_clean == "rejected" and prev_status != "rejected":
        await notify_events.request_decided(shift_req.id, False)

    res = await db.execute(
```
Replace with:
```python
    if target_clean == "approved" and prev_status != "approved":
        await notify_events.request_decided(shift_req.id, True)
        await activity.for_request("request_approved", shift_req.id, current_user.id)     # Phase 29.1
    elif target_clean == "rejected" and prev_status != "rejected":
        await notify_events.request_decided(shift_req.id, False)
        await activity.for_request("request_denied", shift_req.id, current_user.id)       # Phase 29.1

    res = await db.execute(
```

**Edit 3.** Find:
```python
        print(f"Drop shift transaction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
```
Replace with:
```python
        print(f"Drop shift transaction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Phase 29.1: managers hear about drops right away (after commit; never raises)
    await notify_events.shift_dropped(shift_req.id)
    await activity.for_request("shift_dropped", shift_req.id, current_user.id)

    return {
```

---

## B12. `backend/src/services/booking.py` (EDITS)

**Edit 1.** Find:
```python
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events
from src.services.team import is_blocked

```
Replace with:
```python
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events
from src.services import activity
from src.services.team import is_blocked

```

**Edit 2.** Find:
```python
    if status_val != "approved":
        await notify_events.request_pending(req_id)
    return req_id

```
Replace with:
```python
    if status_val != "approved":
        await notify_events.request_pending(req_id)
    await activity.for_request("instant_booked" if status_val == "approved" else "request_created", req_id, worker.id)   # Phase 29.1
    return req_id

```

---

## B13. `backend/src/routers/listings.py` (EDITS)

**Edit 1.** Find:
```python
from src.services.listings import build_listings
from src.services.booking import request_position, withdraw_request

router = APIRouter(prefix="/api/listings", tags=["Listings"])
```
Replace with:
```python
from src.services.listings import build_listings
from src.services.booking import request_position, withdraw_request
from src.services import activity

router = APIRouter(prefix="/api/listings", tags=["Listings"])
```

**Edit 2.** Find:
```python
    """Worker withdraws their own request that is still waiting for approval."""
    event_id = await withdraw_request(db, current_user, request_id)
    await db.refresh(current_user)
    rows = await build_listings(db, current_user, event_id=event_id) if event_id else []
```
Replace with:
```python
    """Worker withdraws their own request that is still waiting for approval."""
    event_id = await withdraw_request(db, current_user, request_id)
    await activity.for_request("request_withdrawn", request_id, current_user.id)   # Phase 29.1
    await db.refresh(current_user)
    rows = await build_listings(db, current_user, event_id=event_id) if event_id else []
```

---

## B14. `backend/src/routers/events.py` (EDITS)

**Edit 1.** Find:
```python
from src.services.timesheets import build_timesheet
from src.services import notify_events
from datetime import datetime, timezone

```
Replace with:
```python
from src.services.timesheets import build_timesheet
from src.services import notify_events
from src.services import activity
from datetime import datetime, timezone

```

**Edit 2.** Find:
```python
    detail = await build_event_detail(db, event)
    await notify_events.new_event_posted(event.id)          # Phase 28: tell the venue's team
    return detail

```
Replace with:
```python
    detail = await build_event_detail(db, event)
    await notify_events.new_event_posted(event.id)          # Phase 28: tell the venue's team
    await activity.for_event("event_created", event.id, current_user.id)   # Phase 29.1
    return detail

```

**Edit 3.** Find:
```python
    detail = await build_event_detail(db, event)
    await notify_events.event_updated(event_id, since)      # Phase 28: tell booked people what changed
    return detail

```
Replace with:
```python
    detail = await build_event_detail(db, event)
    await notify_events.event_updated(event_id, since)      # Phase 28: tell booked people what changed
    changed_now = event.info_updated_at is not None and event.info_updated_at >= since
    await activity.for_event("event_updated", event_id, current_user.id, (event.info_change or "") if changed_now else "")   # Phase 29.1
    return detail

```

**Edit 4.** Find:
```python
    affected = await cancel_shifts(db, event, None, body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    return {"detail": "Event cancelled.", "people_affected": affected}

```
Replace with:
```python
    affected = await cancel_shifts(db, event, None, body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    await activity.for_event("event_cancelled", event_id, current_user.id,
                             f"{affected} {'person' if affected == 1 else 'people'} affected. Reason: {body.reason}")   # Phase 29.1
    return {"detail": "Event cancelled.", "people_affected": affected}

```

**Edit 5.** Find:
```python
    affected = await cancel_shifts(db, event, [shift_id], body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    return {"detail": "Position cancelled.", "people_affected": affected}

```
Replace with:
```python
    affected = await cancel_shifts(db, event, [shift_id], body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    await activity.for_shift("position_cancelled", shift_id, current_user.id,
                             f"Cancelled {{what}} · {affected} {'person' if affected == 1 else 'people'} affected. "
                             f"Reason: {(body.reason or '').replace('{', '{{').replace('}', '}}')}")   # Phase 29.1
    return {"detail": "Position cancelled.", "people_affected": affected}

```

**Edit 6.** Find:
```python
    for ev in created:
        await notify_events.new_event_posted(ev.id)         # Phase 28
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))

```
Replace with:
```python
    for ev in created:
        await notify_events.new_event_posted(ev.id)         # Phase 28
    if created:
        await activity.for_event("event_duplicated", event_id, current_user.id,
                                 f"{len(created)} {'copy' if len(created) == 1 else 'copies'}")   # Phase 29.1
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))

```

---

## B15. `backend/src/routers/timesheets.py` (EDITS)

**Edit 1.** Find:
```python
from src.services.venue_public import can_manage_venue
from src.services import notify_events
from src.services.timesheets import (
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
```
Replace with:
```python
from src.services.venue_public import can_manage_venue
from src.services import notify_events
from src.services import activity
from src.services.timesheets import (
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
```

**Edit 2.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Failed to remove: {str(e)}")
    await notify_events.removed(request_id)                  # Phase 28
    return {"detail": "Removed from shift."}

```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Failed to remove: {str(e)}")
    await notify_events.removed(request_id)                  # Phase 28
    await activity.for_request("person_removed", request_id, current_user.id, f"Reason: {reason}")   # Phase 29.1
    return {"detail": "Removed from shift."}

```

---

## B16. `backend/src/routers/transfers.py` (EDITS)
The names are read **before** the commit (don't move that line).

**Edit 1.** Find:
```python
from src.services.booking import withdraw_other_pending_in_event
from src.services import notify_events
from src.services.team import get_transfer_candidates

```
Replace with:
```python
from src.services.booking import withdraw_other_pending_in_event
from src.services import notify_events
from src.services import activity
from src.services.team import get_transfer_candidates

```

**Edit 2.** Find:
```python
    # Uses verify_venue_access dependency logic
    await verify_venue_access(transfer.shift.venue_id, current_user, db)

    action = body.action.lower().strip()
```
Replace with:
```python
    # Uses verify_venue_access dependency logic
    await verify_venue_access(transfer.shift.venue_id, current_user, db)
    hand_names = (f"{transfer.from_worker.first_name if transfer.from_worker else 'Someone'} → "
                  f"{transfer.to_worker.first_name if transfer.to_worker else 'someone'}")   # Phase 29.1 (read before commit)

    action = body.action.lower().strip()
```

**Edit 3.** Find:
```python
    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    return transfer

@router.post("/{id}/approve", response_model=ShiftTransferResponse)
```
Replace with:
```python
    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    # Phase 29.1: activity log
    await activity.for_shift(
        "transfer_approved" if transfer.status == "approved" else "transfer_denied", transfer.shift_id, current_user.id,
        ("Approved hand-off " if transfer.status == "approved" else "Denied hand-off ") + hand_names + " for {what}",
    )
    return transfer

@router.post("/{id}/approve", response_model=ShiftTransferResponse)
```

---

## B17. `backend/src/routers/staffing.py` (EDITS)

**Edit 1.** Find:
```python
from src.services import staffing
from src.services import notify_events

router = APIRouter(tags=["Staffing"])
```
Replace with:
```python
from src.services import staffing
from src.services import notify_events
from src.services import activity

router = APIRouter(tags=["Staffing"])
```

**Edit 2.** Find:
```python
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id)
    await notify_events.assigned(request_id)          # after commit; never raises
    return AssignResult(request_id=request_id, message=message)

```
Replace with:
```python
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id)
    await notify_events.assigned(request_id)          # after commit; never raises
    await activity.for_request("assigned", request_id, current_user.id)   # Phase 29.1
    return AssignResult(request_id=request_id, message=message)

```

**Edit 3.** Find:
```python
    if offer_ids:
        await notify_events.offers_sent(offer_ids)    # after commit; never raises
    return result

```
Replace with:
```python
    if offer_ids:
        await notify_events.offers_sent(offer_ids)    # after commit; never raises
        await activity.for_shift("offers_sent", shift_id, current_user.id,
                                 f"Offered {{what}} to {len(offer_ids)} {'person' if len(offer_ids) == 1 else 'people'}")   # Phase 29.1
    return result

```

**Edit 4.** Find:
```python
    request_id, o = await staffing.accept_offer(db, current_user, offer_id)
    await notify_events.offer_accepted(o.id, request_id)
    return OfferAcceptResult(request_id=request_id, message="You're booked. It's on your calendar now.")

```
Replace with:
```python
    request_id, o = await staffing.accept_offer(db, current_user, offer_id)
    await notify_events.offer_accepted(o.id, request_id)
    await activity.for_request("offer_accepted", request_id, current_user.id)   # Phase 29.1
    return OfferAcceptResult(request_id=request_id, message="You're booked. It's on your calendar now.")

```

**Edit 5.** Find:
```python
    if nobody_left:
        await notify_events.offer_nobody(o.id)
    return {"detail": "Declined. Thanks for letting them know."}
```
Replace with:
```python
    if nobody_left:
        await notify_events.offer_nobody(o.id)
        await activity.for_shift("offer_nobody", o.shift_id, current_user.id, "No one accepted the offer for {what}")   # Phase 29.1
    return {"detail": "Declined. Thanks for letting them know."}
```

---

## B18. `backend/src/services/notification_worker.py` (EDITS)
A late alert is logged once per booking (the first time the worker is notified).

**Edit 1.** Find:
```python
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack
from src.services.clock import auto_close_open_entries

logger = logging.getLogger("shiftboard.notification_worker")
```
Replace with:
```python
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack
from src.services.clock import auto_close_open_entries
from src.services.activity import record_in

logger = logging.getLogger("shiftboard.notification_worker")
```

**Edit 2.** Find:
```python
        worker = await db.scalar(select(User).where(User.id == r.worker_id))
        name = ev.title if ev else s.title
        sent += await notify_in(
            db, [r.worker_id], "not_clocked_in",
            f"You haven't clocked in: {s.role_type} · {name}",
            f"Your shift started at {when_text(s.start_time, venue)}. Clock in now, or message your manager if you're running late.",
            worker_shift_link(r.id), venue_id=s.venue_id, event_id=s.event_id, request_id=r.id,
            urgent=True, dedupe_key=f"late-w:{r.id}",
        )
        sent += await notify_in(
            db, await manager_ids(db, s.venue_id), "late_worker",
```
Replace with:
```python
        worker = await db.scalar(select(User).where(User.id == r.worker_id))
        name = ev.title if ev else s.title
        first_alert = await notify_in(
            db, [r.worker_id], "not_clocked_in",
            f"You haven't clocked in: {s.role_type} · {name}",
            f"Your shift started at {when_text(s.start_time, venue)}. Clock in now, or message your manager if you're running late.",
            worker_shift_link(r.id), venue_id=s.venue_id, event_id=s.event_id, request_id=r.id,
            urgent=True, dedupe_key=f"late-w:{r.id}",
        )
        sent += first_alert
        if first_alert:   # Phase 29.1: once per booking, in the venue's activity log
            await record_in(db, s.venue_id, "not_clocked_in",
                            f"{person(worker)} hadn't clocked in 10 min after the start: {s.role_type} · {name}",
                            event_id=s.event_id, request_id=r.id, worker_id=r.worker_id)
        sent += await notify_in(
            db, await manager_ids(db, s.venue_id), "late_worker",
```

---

## B19. `backend/src/main.py` (EDITS)
Router import + `include_router` only. **Do not touch the CORS block.**

**Edit 1.** Find:
```python
from src.routers.invites import router as invites_router
from src.routers.staffing import router as staffing_router
from src.services.notification_worker import notification_worker_loop

```
Replace with:
```python
from src.routers.invites import router as invites_router
from src.routers.staffing import router as staffing_router
from src.routers.activity import router as activity_router
from src.services.notification_worker import notification_worker_loop

```

**Edit 2.** Find:
```python
app.include_router(invites_router)
app.include_router(staffing_router)


```
Replace with:
```python
app.include_router(invites_router)
app.include_router(staffing_router)
app.include_router(activity_router)


```

---

# PART C: Frontend

## C1. NEW FILE `frontend/src/components/WorkerProfilePanel.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Phone, Mail, Star, ThumbsUp, ThumbsDown, Clock, Building2, StickyNote } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

const STATUS_CHIP = {
  active: ['On team', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'],
  removed: ['Removed from team', 'bg-slate-700/40 text-slate-300 border-slate-600/40'],
  blocked: ['Blocked', 'bg-rose-500/10 text-rose-300 border-rose-500/30'],
  none: ['Not on team', 'bg-slate-800 text-slate-400 border-slate-700'],
};

const HISTORY_LABEL = {
  pending: ['Waiting', 'text-amber-300'],
  pending_manager_approval: ['Waiting', 'text-amber-300'],
  approved: ['Booked', 'text-emerald-300'],
  confirmed: ['Booked', 'text-emerald-300'],
  checked_in: ['Clocked in', 'text-sky-300'],
  completed: ['Worked', 'text-slate-200'],
  dropped: ['Dropped', 'text-rose-300'],
  no_show: ['No-show', 'text-rose-300'],
  removed: ['Removed', 'text-rose-300'],
  rejected: ['Not selected', 'text-slate-500'],
  withdrawn: ['Withdrew', 'text-slate-500'],
  cancelled: ['Cancelled', 'text-slate-500'],
  transferred: ['Handed off', 'text-slate-400'],
};

export function initials(first, last, email) {
  const a = (first || '').trim()[0] || (email || '?')[0];
  const b = (last || '').trim()[0] || '';
  return `${a}${b}`.toUpperCase();
}

export function Avatar({ person, size = 'w-10 h-10 text-sm' }) {
  const [broken, setBroken] = useState(false);
  if (person?.avatar_url && !broken) {
    return (
      <img src={person.avatar_url} alt="" onError={() => setBroken(true)}
        className={`${size} rounded-full object-cover border border-slate-700 flex-shrink-0`} />
    );
  }
  return (
    <div className={`${size} rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center justify-center font-bold flex-shrink-0`}>
      {initials(person?.first_name, person?.last_name, person?.email)}
    </div>
  );
}

function Stat({ label, children }) {
  return (
    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-sm text-white font-semibold mt-0.5">{children}</div>
    </div>
  );
}

/**
 * Phase 29.1: Who is this person, for this venue.
 * GET /venues/{venueId}/people/{workerId}: team status, contact, ratings, reliability, positions,
 * private note and their history HERE. Used by the queue Review, the activity log and the Team page.
 * Props: venueId, workerId, timeZone, compact (hide the header), refreshKey
 */
export default function WorkerProfilePanel({ venueId, workerId, timeZone, compact = false, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    api
      .get(`/venues/${venueId}/people/${workerId}`)
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load this person.'));
    return () => {
      active = false;
    };
  }, [venueId, workerId, refreshKey]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500 py-6 text-center">Loading…</p>;

  const m = data.member;
  const [statusLabel, statusCls] = STATUS_CHIP[m.status] || STATUS_CHIP.none;
  const rel = m.reliability;
  const againTotal = m.would_book_again_yes + m.would_book_again_no;

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-start gap-3">
          <Avatar person={m} size="w-12 h-12 text-base" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-white">{`${m.first_name} ${m.last_name}`.trim() || m.email}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCls}`}>{statusLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
              {m.phone && <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{m.phone}</a>}
              {m.email && (
                m.email.includes('*')
                  ? <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{m.email}</span>
                  : <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Mail className="w-3 h-3" />{m.email}</a>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Rating">
          <RatingBadge rating={m.aggregate_rating} count={m.rating_count} />
        </Stat>
        <Stat label="Reliability">
          <ReliabilityBadge data={rel} />
        </Stat>
        <Stat label="Shifts here">
          {m.shifts_worked}
          {m.upcoming > 0 && <span className="text-xs text-slate-400 font-normal"> · {m.upcoming} upcoming</span>}
        </Stat>
        <Stat label="Your rating">
          {m.venue_rating_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {Number(m.venue_rating).toFixed(1)}
              <span className="text-xs text-slate-400 font-normal">({m.venue_rating_count})</span>
            </span>
          ) : (
            <span className="text-slate-500 font-normal text-xs">Not rated yet</span>
          )}
        </Stat>
      </div>

      {(rel?.commitments > 0 || againTotal > 0 || data.other_venues > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {rel?.commitments > 0 && (
            <span>
              Everywhere: {rel.completed} worked · {rel.late} late · {rel.no_show} no-show · {rel.late_drop} late drop
            </span>
          )}
          {againTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="w-3 h-3 text-emerald-400" /> {m.would_book_again_yes}
              <ThumbsDown className="w-3 h-3 text-rose-400 ml-1" /> {m.would_book_again_no} would book again
            </span>
          )}
          {data.other_venues > 0 && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Worked at {data.other_venues} other venue{data.other_venues === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {m.positions?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {m.positions.map((p) => (
            <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p}</span>
          ))}
        </div>
      )}

      {m.notes && (
        <p className="text-xs text-slate-200 whitespace-pre-line bg-amber-500/5 border border-amber-500/30 rounded-xl p-2.5">
          <span className="text-amber-300 font-semibold inline-flex items-center gap-1 mr-1"><StickyNote className="w-3 h-3" /> Private note:</span>
          {m.notes}
        </p>
      )}

      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">History here</div>
        {data.history.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing at this venue yet.</p>
        ) : (
          <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
            {data.history.map((h) => {
              const [label, cls] = HISTORY_LABEL[h.status] || [h.status, 'text-slate-300'];
              return (
                <div key={h.request_id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs bg-slate-950">
                  <span className="text-slate-400 w-24 flex-shrink-0">{fmtDate(h.start_time, timeZone)}</span>
                  <span className="text-slate-100 flex-1 min-w-[10rem]">
                    <span className="font-semibold">{h.role_type}</span> · {h.title}
                    <span className="text-slate-500"> · {fmtTimeRange(h.start_time, h.end_time, timeZone)}</span>
                  </span>
                  <span className={`font-semibold ${cls}`}>{label}</span>
                  {h.late_minutes > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-300"><Clock className="w-3 h-3" /> {h.late_minutes} min late</span>
                  )}
                  {h.my_rating && (
                    <span className="inline-flex items-center gap-0.5 text-amber-400"><Star className="w-3 h-3 fill-amber-400" /> {h.my_rating}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A modal that only shows the profile (activity log, Team page). */
export function WorkerProfileModal({ venueId, workerId, timeZone, onClose }) {
  return (
    <ModalShell title="Worker profile" onClose={onClose} maxWidth="max-w-2xl">
      <WorkerProfilePanel venueId={venueId} workerId={workerId} timeZone={timeZone} />
    </ModalShell>
  );
}
```

---

## C2. NEW FILE `frontend/src/components/ReviewModal.jsx`

```jsx
import React, { useState } from 'react';
import { ClipboardCheck, Check, X, CalendarDays, MessageSquareQuote, ArrowRight, ExternalLink } from 'lucide-react';
import ModalShell from './ModalShell';
import WorkerProfilePanel from './WorkerProfilePanel';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

function name(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || p?.email || 'Worker';
}

function ShiftSummary({ shift, timeZone }) {
  if (!shift) return null;
  const cap = shift.capacity || 1;
  const filled = shift.spots_filled || 0;
  return (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{shift.role_type}</span>
        <span className="text-sm font-bold text-white">{shift.title}</span>
      </div>
      <div className="text-xs text-slate-300 inline-flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
        {fmtLongDate(shift.start_time, timeZone)} · {fmtTimeRange(shift.start_time, shift.end_time, timeZone)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} className="text-emerald-400 font-semibold" />
        <TipBadge shift={shift} />
        <span className={filled >= cap ? 'text-rose-300 font-semibold' : 'text-slate-400'}>
          {filled}/{cap} filled{filled >= cap ? ' (full)' : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Phase 29.1: Look before you approve.
 * item = { type: 'request', data: ShiftRequestResponse } | { type: 'transfer', data: ShiftTransferResponse }
 * Props: venueId, item, timeZone, busy, onApprove(id), onDeny(id), onOpenEvent(eventId), onClose
 */
export default function ReviewModal({ venueId, item, timeZone, busy, onApprove, onDeny, onOpenEvent, onClose }) {
  const isTransfer = item.type === 'transfer';
  const d = item.data;
  const shift = d.shift;
  const [who, setWho] = useState(isTransfer ? 'to' : 'worker'); // transfer: 'to' | 'from'
  const workerId = isTransfer ? (who === 'to' ? d.to_worker_id : d.from_worker_id) : d.worker_id;
  const note = d.notes;

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Close
      </button>
      {shift?.event_id && onOpenEvent && (
        <button type="button" onClick={() => onOpenEvent(shift.event_id)}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200 inline-flex items-center gap-1.5">
          <ExternalLink className="w-4 h-4" /> Open event
        </button>
      )}
      <button type="button" onClick={() => onDeny(d.id)} disabled={busy}
        className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-600/40 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
        <X className="w-4 h-4" /> {isTransfer ? 'Deny hand-off' : 'Deny'}
      </button>
      <button type="button" onClick={() => onApprove(d.id)} disabled={busy}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
        <Check className="w-4 h-4" /> {isTransfer ? 'Approve hand-off' : 'Approve'}
      </button>
    </>
  );

  return (
    <ModalShell
      title={isTransfer ? `Hand-off: ${name(d.from_worker)} → ${name(d.to_worker)}` : `${name(d.worker)} wants ${shift?.role_type || 'a shift'}`}
      subtitle={isTransfer ? 'Review who is taking the shift before you approve.' : `Requested ${fmtDateTime(d.created_at, timeZone)}`}
      icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        <div className="md:col-span-2 space-y-3">
          <ShiftSummary shift={shift} timeZone={timeZone} />
          {isTransfer && (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{name(d.from_worker)}</span>
              <ArrowRight className="w-4 h-4 text-amber-400" />
              <span className="font-semibold">{name(d.to_worker)}</span>
              <span className="text-xs text-slate-500 w-full">Proposed {fmtDateTime(d.created_at, timeZone)}. {name(d.to_worker)} already accepted.</span>
            </div>
          )}
          <div className={`p-3 rounded-xl border text-sm ${note ? 'bg-amber-500/5 border-amber-500/40 text-amber-50' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1 text-amber-300">
              <MessageSquareQuote className="w-3.5 h-3.5" /> {isTransfer ? 'Their note' : 'Note with the request'}
            </div>
            <div className="whitespace-pre-line">{note ? `“${note}”` : 'No note.'}</div>
          </div>
        </div>

        <div className="md:col-span-3">
          {isTransfer && (
            <div className="flex gap-2 mb-3">
              {[
                ['to', `Taking it: ${d.to_worker?.first_name || 'worker'}`],
                ['from', `Giving it up: ${d.from_worker?.first_name || 'worker'}`],
              ].map(([id, label]) => (
                <button key={id} type="button" onClick={() => setWho(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${who === id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <WorkerProfilePanel key={workerId} venueId={venueId} workerId={workerId} timeZone={timeZone} />
        </div>
      </div>
    </ModalShell>
  );
}
```

---

## C3. NEW FILE `frontend/src/components/ManagerQueues.jsx`

```jsx
import React from 'react';
import { Users, ArrowRightLeft, Check, X, Eye, MessageSquareQuote, ArrowRight } from 'lucide-react';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

const card = 'bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl';

function name(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || p?.email || 'Worker';
}

function Header({ icon: Icon, title, count, hint }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <h2 className="text-sm font-bold text-white truncate">{title}</h2>
        {count > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">{count}</span>
        )}
      </div>
      {hint && <span className="text-[10px] text-slate-500 text-right">{hint}</span>}
    </div>
  );
}

/**
 * Phase 29.1: Requests waiting for approval (compact, for the dashboard's side column).
 * Props: requests (ShiftRequestResponse[]), reliabilityMap, timeZone, actionLoading, onReview(req), onApprove(id), onDeny(id)
 */
export function ApprovalQueueCard({ requests, reliabilityMap = {}, timeZone, actionLoading, onReview, onApprove, onDeny }) {
  return (
    <section id="approval-queue" className={card}>
      <Header icon={Users} title="Requests to review" count={requests.length} hint="Oldest shift first" />
      {requests.length === 0 ? (
        <p className="text-xs text-slate-500 py-3 text-center">All caught up. No requests waiting.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => {
            const w = req.worker;
            const s = req.shift;
            const busy = actionLoading === `approve-${req.id}` || actionLoading === `deny-${req.id}`;
            const full = s && (s.spots_filled || 0) >= (s.capacity || 1);
            return (
              <div key={req.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onReview(req)} className="text-left min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-white hover:text-emerald-300">{name(w)}</span>
                      <RatingBadge rating={w?.aggregate_rating} count={w?.rating_count} showCount={false} />
                      <ReliabilityBadge data={reliabilityMap[w?.id]} />
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      <span className="font-semibold text-emerald-300">{s?.role_type}</span> · {s?.title}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {fmtDate(s?.start_time, timeZone)} · {fmtTimeRange(s?.start_time, s?.end_time, timeZone)}
                      {full && <span className="text-rose-300 font-semibold"> · full</span>}
                    </div>
                  </button>
                </div>
                {req.notes && (
                  <div className="text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 flex gap-1">
                    <MessageSquareQuote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">“{req.notes}”</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onReview(req)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1 mr-auto">
                    <Eye className="w-3 h-3" /> Review
                  </button>
                  <button type="button" onClick={() => onDeny(req.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <X className="w-3 h-3" /> Deny
                  </button>
                  <button type="button" onClick={() => onApprove(req.id)} disabled={busy || full}
                    title={full ? 'Position is full' : 'Approve'}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                    <Check className="w-3 h-3" /> Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Phase 29.1: Hand-offs waiting for approval.
 * Props: transfers (ShiftTransferResponse[]), timeZone, actionLoading, onReview(t), onApprove(id), onDeny(id)
 */
export function TransfersCard({ transfers, timeZone, actionLoading, onReview, onApprove, onDeny }) {
  return (
    <section id="pending-transfers" className={card}>
      <Header icon={ArrowRightLeft} title="Hand-offs to approve" count={transfers.length} hint="Worker-to-worker" />
      {transfers.length === 0 ? (
        <p className="text-xs text-slate-500 py-3 text-center">No hand-offs waiting.</p>
      ) : (
        <div className="space-y-2">
          {transfers.map((t) => {
            const s = t.shift;
            const busy = actionLoading?.includes(t.id);
            return (
              <div key={t.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <button type="button" onClick={() => onReview(t)} className="text-left w-full">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm text-white font-semibold">
                    {name(t.from_worker)} <ArrowRight className="w-3.5 h-3.5 text-amber-400" /> {name(t.to_worker)}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    <span className="font-semibold text-emerald-300">{s?.role_type}</span> · {s?.title}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {fmtDate(s?.start_time, timeZone)} · {fmtTimeRange(s?.start_time, s?.end_time, timeZone)}
                  </div>
                </button>
                {t.notes && (
                  <div className="text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 flex gap-1">
                    <MessageSquareQuote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">“{t.notes}”</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onReview(t)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1 mr-auto">
                    <Eye className="w-3 h-3" /> Review
                  </button>
                  <button type="button" onClick={() => onDeny(t.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <X className="w-3 h-3" /> Deny
                  </button>
                  <button type="button" onClick={() => onApprove(t.id)} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    <Check className="w-3 h-3" /> Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

---

## C4. NEW FILE `frontend/src/components/ActivityFeed.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { History, CalendarCheck, UserPlus, Users, PencilLine, AlertTriangle, ChevronRight } from 'lucide-react';
import api from '../api/client';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'staffing', label: 'Staffing' },
  { id: 'team', label: 'Team' },
  { id: 'changes', label: 'Changes' },
  { id: 'alerts', label: 'Alerts' },
];
const ICON = {
  bookings: [CalendarCheck, 'text-emerald-400'],
  staffing: [UserPlus, 'text-indigo-300'],
  team: [Users, 'text-sky-300'],
  changes: [PencilLine, 'text-amber-300'],
  alerts: [AlertTriangle, 'text-rose-400'],
};
const PAGE = 20;

function ago(value) {
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Phase 29.1: The venue's activity log (newest first). Everything managers and workers did here:
 * requests, approvals, drops, assigns, offers, team changes, invites, edits, late alerts.
 * Props: venueId, refreshKey, onOpenEvent(eventId), onOpenWorker(workerId)
 */
export default function ActivityFeed({ venueId, refreshKey = 0, onOpenEvent, onOpenWorker }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!venueId) return undefined;
    let active = true;
    setLoading(true);
    api
      .get(`/venues/${venueId}/activity`, { params: { limit: PAGE, ...(filter ? { category: filter } : {}) } })
      .then((res) => {
        if (!active) return;
        setItems(res.data || []);
        setMore((res.data || []).length === PAGE);
      })
      .catch(() => active && setItems([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [venueId, filter, refreshKey]);

  const loadMore = async () => {
    if (!items.length) return;
    setLoading(true);
    try {
      const res = await api.get(`/venues/${venueId}/activity`, {
        params: { limit: PAGE, before: items[items.length - 1].created_at, ...(filter ? { category: filter } : {}) },
      });
      setItems((prev) => [...prev, ...(res.data || [])]);
      setMore((res.data || []).length === PAGE);
    } finally {
      setLoading(false);
    }
  };

  const open = (a) => {
    if (a.event_id && onOpenEvent) onOpenEvent(a.event_id);
    else if (a.worker_id && onOpenWorker) onOpenWorker(a.worker_id);
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-white">Activity</h2>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {FILTERS.map((f) => (
          <button key={f.id || 'all'} type="button" onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
              filter === f.id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}>
            {f.label}
          </button>
        ))}
      </div>
      {loading && items.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">Nothing yet. Actions at this venue show up here from now on.</p>
      ) : (
        <ol className="max-h-[32rem] overflow-y-auto divide-y divide-slate-800 -mx-1">
          {items.map((a) => {
            const [Icon, tone] = ICON[a.category] || ICON.changes;
            const clickable = (a.event_id && onOpenEvent) || (a.worker_id && onOpenWorker);
            return (
              <li key={a.id}>
                <button type="button" onClick={() => open(a)} disabled={!clickable}
                  className={`w-full text-left px-1 py-2 flex gap-2 ${clickable ? 'hover:bg-slate-800/50 rounded-lg' : 'cursor-default'}`}>
                  <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${tone}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-slate-200 leading-snug">{a.summary}</span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {ago(a.created_at)}{a.actor_name ? ` · by ${a.actor_name}` : ''}
                    </span>
                  </span>
                  {clickable && <ChevronRight className="w-3.5 h-3.5 text-slate-600 mt-0.5 flex-shrink-0" />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {more && (
        <button type="button" onClick={loadMore} disabled={loading}
          className="mt-2 w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 disabled:opacity-50">
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
```

---

## C5. `frontend/src/components/ReliabilityBadge.jsx` (FULL FILE REPLACEMENT)

```jsx
import React from 'react';

/**
 * Reliability across all venues. Phase 29.1: with no finished shifts yet it shows a muted
 * "No history" (it used to say "New", which doubled up with the rating's "New" badge).
 */
export default function ReliabilityBadge({ data }) {
  if (!data || data.score === null || data.score === undefined) {
    return (
      <span
        title="No finished shifts yet, so there's no reliability score"
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-slate-500 border border-slate-700/60 whitespace-nowrap"
      >
        No history
      </span>
    );
  }
  const score = Number(data.score);
  const tone =
    score >= 90
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : score >= 75
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  const tooltip = `${data.completed} completed · ${data.late} late · ${data.no_show} no-show · ${data.late_drop} late drop`;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${tone}`}
    >
      {score.toFixed(0)}% reliable
    </span>
  );
}
```

---

## C6. `frontend/src/pages/VenueManagerDashboard.jsx` (FULL FILE REPLACEMENT)
Same data flow, handlers, modals and deep links as before. It no longer fetches `/venues/{id}/shifts` or `/venues/{id}/roster` (they were unused). Note `w-full` on the page root, the header container and `<main>`: that is the width fix.

```jsx
import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, Users, ArrowRightLeft, X,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
import VenueSettingsModal from '../components/VenueSettingsModal';
import ShiftEventFormModal from '../components/ShiftEventFormModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import ReasonDialog from '../components/ReasonDialog';
import DuplicateEventModal from '../components/DuplicateEventModal';
import TimesheetModal from '../components/TimesheetModal';
import TeamModal from '../components/TeamModal';
import ReviewModal from '../components/ReviewModal';
import ActivityFeed from '../components/ActivityFeed';
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
import { WorkerProfileModal } from '../components/WorkerProfilePanel';

/**
 * Venue manager dashboard.
 * Phase 29.1 layout: Posted Shifts on the left (2/3), and on the right the things that need you
 * (requests, hand-offs) plus the venue's activity log. On phones a "Needs attention" strip at the
 * top jumps to the queues. The old Phase 16 roster/calendar code (never shown) was removed.
 */
export default function VenueManagerDashboard() {
  const { user } = useAuth();
  const isPlatformAdmin = ['platform_admin', 'super_admin'].includes((user?.role || '').toLowerCase());
  // Phase 28: notification links open /venue?venue=<id>&event=<id>
  const [searchParams, setSearchParams] = useSearchParams();
  const urlVenue = searchParams.get('venue');
  if (urlVenue && isPlatformAdmin && localStorage.getItem('shiftboard_admin_venue_id') !== urlVenue) {
    localStorage.setItem('shiftboard_admin_venue_id', urlVenue);
  }
  const initialVenue = urlVenue
    || (isPlatformAdmin
      ? (localStorage.getItem('shiftboard_admin_venue_id') || user?.venue_id || null)
      : (user?.venue_id || null));

  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);

  const [reliabilityMap, setReliabilityMap] = useState({});
  const [managedVenues, setManagedVenues] = useState([]);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);
  const [eventForm, setEventForm] = useState(null); // { mode: 'create' } | { mode: 'edit', eventId }
  const [reasonDialog, setReasonDialog] = useState(null);
  const [dupEvent, setDupEvent] = useState(null);
  const [timesheetEventId, setTimesheetEventId] = useState(null);
  const [openTarget, setOpenTarget] = useState(null); // Phase 28: { venueId, eventId } from a notification link
  const [showTeam, setShowTeam] = useState(false);    // Phase 29: Team page
  const [review, setReview] = useState(null);         // Phase 29.1: { type: 'request' | 'transfer', data }
  const [profileWorkerId, setProfileWorkerId] = useState(null); // Phase 29.1: from the activity log
  const noticeTimer = useRef(null);

  // Phase 29.1: success / info banners clear themselves after 6 s; errors stay until dismissed
  useEffect(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (notification && notification.type !== 'error') {
      noticeTimer.current = setTimeout(() => setNotification(null), 6000);
    }
    return () => noticeTimer.current && clearTimeout(noticeTimer.current);
  }, [notification]);

  const fetchVenueData = async (venueId) => {
    try {
      setLoading(true);
      let activeId = venueId;
      if (!activeId && isPlatformAdmin) {
        activeId = localStorage.getItem('shiftboard_admin_venue_id');
      }
      const mvRes = await api.get('/venues/managed').catch(() => ({ data: [] }));
      const mine = mvRes.data || [];
      setManagedVenues(mine);
      if (!isPlatformAdmin && activeId && !mine.some((v) => String(v.id) === String(activeId))) {
        activeId = null;
      }
      if (!activeId && mine.length > 0) {
        activeId = mine[0].id;
      }
      setCurrentVenueId(activeId || null);

      if (!activeId) {
        setLoading(false);
        return;
      }

      const [requestsRes, venueRes, transfersRes, reliabilityRes] = await Promise.all([
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
      ]);

      setPendingRequests(requestsRes.data || []);
      setVenueDetails(venueRes.data || null);
      setPendingTransfers(transfersRes.data || []);
      setReliabilityMap(reliabilityRes.data || {});
      setBoardRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to load venue manager data:', err);
      setNotification({
        type: 'error',
        message: 'Could not load venue shifts, approval queue, or transfers from backend.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVenueData(currentVenueId || user?.venue_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.venue_id]);

  // Listen to Super Admin venue switcher from Navbar
  useEffect(() => {
    const handleAdminVenueSwitch = (e) => {
      const newVenueId = e.detail;
      if (newVenueId) {
        setCurrentVenueId(newVenueId);
        fetchVenueData(newVenueId);
      }
    };
    window.addEventListener('admin_venue_changed', handleAdminVenueSwitch);
    return () => window.removeEventListener('admin_venue_changed', handleAdminVenueSwitch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 28: handle ?venue= / ?event= (also when already on this page); Phase 29: ?team=1
  useEffect(() => {
    const venue = searchParams.get('venue');
    const event = searchParams.get('event');
    const team = searchParams.get('team');
    if (!venue && !event && !team) return;
    const targetVenue = venue || currentVenueId;
    if (venue && String(venue) !== String(currentVenueId)) {
      if (isPlatformAdmin) {
        localStorage.setItem('shiftboard_admin_venue_id', venue);
        window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venue })); // listener above reloads
      } else {
        fetchVenueData(venue);
      }
    }
    if (event) setOpenTarget({ venueId: targetVenue, eventId: event });
    if (team) setShowTeam(true);
    const next = new URLSearchParams(searchParams);
    next.delete('venue');
    next.delete('event');
    next.delete('team');
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  // Approval queue actions
  const handleApprove = async (requestId) => {
    try {
      setActionLoading(`approve-${requestId}`);
      await api.post(`/requests/${requestId}/approve`);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setNotification({ type: 'success', message: 'Approved. They are booked and have been notified.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to approve request.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeny = async (requestId) => {
    try {
      setActionLoading(`deny-${requestId}`);
      await api.post(`/requests/${requestId}/deny`);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setNotification({ type: 'info', message: 'Request declined. They have been notified.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to deny request.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Shift Transfer Approval actions (Phase 20)
  const handleApproveTransfer = async (transferId) => {
    try {
      setActionLoading(`transfer-approve-${transferId}`);
      await api.post(`/transfers/${transferId}/manager-review`, { action: 'approve' });
      setPendingTransfers((prev) => prev.filter((t) => t.id !== transferId));
      setNotification({ type: 'success', message: 'Hand-off approved. The spot now belongs to the new worker.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to approve the hand-off.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDenyTransfer = async (transferId) => {
    try {
      setActionLoading(`transfer-deny-${transferId}`);
      await api.post(`/transfers/${transferId}/manager-review`, { action: 'deny' });
      setPendingTransfers((prev) => prev.filter((t) => t.id !== transferId));
      setNotification({ type: 'info', message: 'Hand-off denied. The original worker keeps the shift.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to deny the hand-off.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Phase 19: Hour Tracking & Payroll CSV Export
  const exportPayroll = async () => {
    if (!currentVenueId) return;
    try {
      setExportingCSV(true);
      const response = await api.get(`/venues/${currentVenueId}/payroll/export`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'payroll.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotification({ type: 'success', message: 'Payroll CSV downloaded.' });
    } catch (err) {
      console.error('Error exporting payroll CSV:', err);
      setNotification({ type: 'error', message: 'Failed to download payroll CSV.' });
    } finally {
      setExportingCSV(false);
    }
  };

  const handleManagerVenueChange = (e) => {
    const newId = e.target.value;
    setCurrentVenueId(newId);
    fetchVenueData(newId);
  };

  const afterChange = (message) => {
    setNotification({ type: 'success', message });
    fetchVenueData(currentVenueId);
  };

  const openEvent = (eventId) => {
    setReview(null);
    setProfileWorkerId(null);
    setOpenTarget({ venueId: currentVenueId, eventId });
  };

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const askCancelEvent = (ev) =>
    setReasonDialog({
      title: 'Cancel this event?',
      message: `Everyone booked or waiting on "${ev.title}" will see it as cancelled, with your reason.`,
      confirmLabel: 'Cancel event',
      danger: true,
      onConfirm: async (reason) => {
        await api.post(`/events/${ev.event_id}/cancel`, { reason });
        afterChange('Event cancelled.');
      },
    });

  const askCancelPosition = (pos, ev) =>
    setReasonDialog({
      title: `Cancel ${pos.role_type}?`,
      message: `Everyone booked or waiting for ${pos.role_type} on "${ev.title}" will see it as cancelled.`,
      confirmLabel: 'Cancel position',
      danger: true,
      onConfirm: async (reason) => {
        await api.post(`/events/${ev.event_id}/positions/${pos.shift_id}/cancel`, { reason });
        afterChange(`${pos.role_type} cancelled.`);
      },
    });

  const askRemovePerson = (person, pos) =>
    setReasonDialog({
      title: `Remove ${person.first_name}?`,
      message: `${person.first_name} ${person.last_name} will be taken off ${pos.role_type} and the spot reopens.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async (reason) => {
        await api.post(`/requests/${person.request_id}/remove`, { reason });
        afterChange(`${person.first_name} removed.`);
      },
    });

  if (!loading && !currentVenueId) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <Building2 className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-1">No venue assigned yet</h1>
          <p className="text-sm text-slate-400">
            Your account is a Venue Manager but isn't linked to a venue. Ask a platform admin to assign you one in the Admin Panel.
          </p>
        </div>
      </div>
    );
  }

  const tz = venueDetails?.timezone;
  const attention = pendingRequests.length + pendingTransfers.length;
  const headerBtn =
    'px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50';

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 pb-16">
      {/* Header */}
      <section className="w-full bg-slate-900 border-b border-slate-800 py-6">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20 flex-shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{venueDetails?.name || 'Venue'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {isPlatformAdmin ? 'Platform admin' : 'Venue manager'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{venueDetails?.address || ''}</p>
              {!isPlatformAdmin && managedVenues.length > 1 && (
                <select
                  value={currentVenueId || ''}
                  onChange={handleManagerVenueChange}
                  className="mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {managedVenues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEventForm({ mode: 'create' })}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" /> Post a Shift
            </button>
            <button type="button" onClick={() => setShowTeam(true)} disabled={!venueDetails} className={headerBtn}>
              <UserPlus className="w-4 h-4 text-emerald-400" /> Team
            </button>
            <button type="button" onClick={() => setShowVenueSettings(true)} disabled={!venueDetails} className={headerBtn}>
              <Settings className="w-4 h-4 text-amber-400" /> Settings
            </button>
            <button type="button" onClick={exportPayroll} disabled={exportingCSV || !currentVenueId} className={headerBtn}>
              <Download className="w-4 h-4 text-emerald-400" /> {exportingCSV ? 'Downloading…' : 'Payroll CSV'}
            </button>
            {currentVenueId && (
              <Link to={`/venues/${currentVenueId}`} className={headerBtn}>
                <Globe className="w-4 h-4 text-sky-400" /> Public page
              </Link>
            )}
          </div>
        </div>
      </section>

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {notification && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {notification.type === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button type="button" onClick={() => setNotification(null)} aria-label="Dismiss" className="p-1 rounded-lg hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Phones / tablets: jump to the queues that sit below the shifts */}
        {attention > 0 && (
          <div className="lg:hidden flex flex-wrap gap-2">
            {pendingRequests.length > 0 && (
              <button type="button" onClick={() => scrollTo('approval-queue')}
                className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {pendingRequests.length} request{pendingRequests.length === 1 ? '' : 's'} to review
              </button>
            )}
            {pendingTransfers.length > 0 && (
              <button type="button" onClick={() => scrollTo('pending-transfers')}
                className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4" /> {pendingTransfers.length} hand-off{pendingTransfers.length === 1 ? '' : 's'} to approve
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: posted shifts */}
          <div className="lg:col-span-2 min-w-0">
            <PostedShiftsBoard
              venueId={currentVenueId}
              openEventId={openTarget && String(openTarget.venueId) === String(currentVenueId) ? openTarget.eventId : null}
              onOpenedEvent={() => setOpenTarget(null)}
              onDataChanged={() => fetchVenueData(currentVenueId)}
              refreshKey={boardRefreshKey}
              reliabilityMap={reliabilityMap}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onOpenBoard={setActiveDiscussionShift}
              onEditEvent={(id) => setEventForm({ mode: 'edit', eventId: id })}
              onCancelEvent={askCancelEvent}
              onDuplicateEvent={(ev) => setDupEvent(ev)}
              onTimesheet={(ev) => setTimesheetEventId(ev.event_id)}
              onRemovePerson={askRemovePerson}
              onCancelPosition={askCancelPosition}
              actionLoading={actionLoading}
              timeZone={tz}
            />
          </div>

          {/* Right: what needs you + activity */}
          <aside className="space-y-6 min-w-0">
            <ApprovalQueueCard
              requests={pendingRequests}
              reliabilityMap={reliabilityMap}
              timeZone={tz}
              actionLoading={actionLoading}
              onReview={(req) => setReview({ type: 'request', data: req })}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
            <TransfersCard
              transfers={pendingTransfers}
              timeZone={tz}
              actionLoading={actionLoading}
              onReview={(t) => setReview({ type: 'transfer', data: t })}
              onApprove={handleApproveTransfer}
              onDeny={handleDenyTransfer}
            />
            <ActivityFeed
              venueId={currentVenueId}
              refreshKey={boardRefreshKey}
              onOpenEvent={openEvent}
              onOpenWorker={setProfileWorkerId}
            />
          </aside>
        </div>
      </main>

      {eventForm && venueDetails && (
        <ShiftEventFormModal
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
          }}
        />
      )}

      {reasonDialog && <ReasonDialog {...reasonDialog} onClose={() => setReasonDialog(null)} />}
      {dupEvent && (
        <DuplicateEventModal
          event={dupEvent}
          timeZone={tz}
          onClose={() => setDupEvent(null)}
          onDone={(count) => afterChange(`Created ${count} ${count === 1 ? 'copy' : 'copies'}.`)}
        />
      )}
      {timesheetEventId && (
        <TimesheetModal
          eventId={timesheetEventId}
          timeZone={tz}
          onClose={() => setTimesheetEventId(null)}
          onChanged={() => fetchVenueData(currentVenueId)}
        />
      )}

      {/* Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.role_type})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {review && currentVenueId && (
        <ReviewModal
          venueId={currentVenueId}
          item={review}
          timeZone={tz}
          busy={!!actionLoading}
          onApprove={review.type === 'transfer' ? handleApproveTransfer : handleApprove}
          onDeny={review.type === 'transfer' ? handleDenyTransfer : handleDeny}
          onOpenEvent={openEvent}
          onClose={() => setReview(null)}
        />
      )}

      {profileWorkerId && currentVenueId && (
        <WorkerProfileModal
          venueId={currentVenueId}
          workerId={profileWorkerId}
          timeZone={tz}
          onClose={() => setProfileWorkerId(null)}
        />
      )}

      {showTeam && venueDetails && (
        <TeamModal
          venue={venueDetails}
          positions={venuePositions}
          timeZone={tz}
          onClose={() => setShowTeam(false)}
          onChanged={() => fetchVenueData(currentVenueId)}
        />
      )}

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
    </div>
  );
}
```

---

## C7. `frontend/src/components/TeamModal.jsx` (FULL FILE REPLACEMENT)
The CSV import, results table, invites list, temporary-password card and co-manager form are unchanged from Phase 29; the Team tab, Add people and the modal header are new.

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import WorkerProfilePanel, { Avatar } from './WorkerProfilePanel';
import { fmtShortDate } from '../utils/venueTime';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const cardCls = 'p-4 rounded-xl bg-slate-950 border border-slate-800';
const btnGhost =
  'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40';
const btnPrimary =
  'px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40';

const STATUS_CHIP = {
  active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  removed: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  blocked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};
const SOURCE_LABEL = {
  manager: 'Added by a manager',
  invite: 'Joined by invite',
  import: 'Imported',
  admin: 'Added by an admin',
  worked: 'Worked here',
};
const INVITE_CHIP = {
  pending: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
  accepted: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  expired: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  revoked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

/** Minimal CSV parser (quotes, commas, CRLF). Returns an array of rows (arrays of strings). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_KEYS = {
  first_name: ['first_name', 'first name', 'firstname', 'first', 'given name'],
  last_name: ['last_name', 'last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'fullname'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'mobile', 'cell', 'phone number', 'mobile number'],
  positions: ['positions', 'position', 'roles', 'role'],
};

/** CSV text -> invite rows. The first row must be a header (name, email, phone, positions ...). */
export function csvToInviteRows(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rows: [], error: 'The file needs a header row and at least one person.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  Object.entries(HEADER_KEYS).forEach(([key, names]) => {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  });
  if (col.email === undefined && col.phone === undefined) {
    return { rows: [], error: 'Add an "email" or "phone" column (first row = column names).' };
  }
  const out = rows.slice(1).map((r) => {
    const get = (k) => (col[k] !== undefined ? (r[col[k]] || '').trim() : '');
    let first = get('first_name');
    let last = get('last_name');
    if (!first && get('name')) {
      const parts = get('name').split(/\s+/);
      first = parts[0] || '';
      last = parts.slice(1).join(' ');
    }
    return {
      first_name: first,
      last_name: last,
      email: get('email') || null,
      phone: get('phone') || null,
      positions: get('positions') ? get('positions').split(/[;|/]/).map((p) => p.trim()).filter(Boolean) : [],
    };
  });
  return { rows: out, error: out.length > 200 ? 'Up to 200 people per file.' : '' };
}

function TempPassword({ result, onDone }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  return (
    <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/5 space-y-2">
      <p className="text-sm text-amber-100">{result.message}</p>
      {result.temporary_password && (
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-300" />
          <code className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-base font-mono text-white tracking-wider select-all">
            {result.temporary_password}
          </code>
          <button type="button" className={btnGhost} onClick={async () => setCopied(await copyText(result.temporary_password))}>
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {result.temporary_password && (
        <p className="text-[11px] text-amber-200/80">
          They sign in on the ShiftBoard login page with their email and this password. Share it privately (text or in person).
        </p>
      )}
      <button type="button" className={btnGhost} onClick={onDone}>Done</button>
    </div>
  );
}

function PositionPicker({ options, value, onChange }) {
  if (!options.length) return <p className="text-[11px] text-slate-500">Add positions in Venue Settings to tag people.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((name) => {
        const on = value.some((v) => v.toLowerCase() === name.toLowerCase());
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v.toLowerCase() !== name.toLowerCase()) : [...value, name])}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
              on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {on && <Check className="w-3 h-3 inline mr-0.5" />}
            {name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Members tab (Phase 29.1: compact rows that expand into the full profile)
// ---------------------------------------------------------------------------------------------
const FILTERS = [
  ['active', 'On team'],
  ['removed', 'Removed'],
  ['blocked', 'Blocked'],
  ['all', 'Everyone'],
];

function MemberRow({ m, venueId, timeZone, positionOptions, open, onToggle, onUpdated, onMessage }) {
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(m.positions || []);
  const [notes, setNotes] = useState(m.notes || '');
  const [confirm, setConfirm] = useState(null); // 'blocked' | 'removed'
  const [busy, setBusy] = useState(false);
  const [profileKey, setProfileKey] = useState(0);
  const name = `${m.first_name} ${m.last_name}`.trim() || m.email;
  const allOptions = useMemo(() => {
    const names = positionOptions.slice();
    (m.positions || []).forEach((p) => {
      if (!names.some((n) => n.toLowerCase() === p.toLowerCase())) names.push(p);
    });
    return names;
  }, [positionOptions, m.positions]);

  const patch = async (body) => {
    setBusy(true);
    try {
      const res = await api.patch(`/venues/${venueId}/team/${m.worker_id}`, body);
      onUpdated(res.data.member);
      onMessage({ type: 'success', text: `${name}: ${res.data.message}` });
      setEditing(false);
      setConfirm(null);
      setProfileKey((k) => k + 1);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border ${open ? 'border-emerald-500/40 bg-slate-950' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}>
      <button type="button" onClick={onToggle} className="w-full text-left px-3 py-2.5 flex items-center gap-3">
        <Avatar person={m} size="w-9 h-9 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{name}</span>
            {m.status !== 'active' && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_CHIP[m.status] || STATUS_CHIP.removed}`}>
                {m.status === 'removed' ? 'Removed' : 'Blocked'}
              </span>
            )}
            {(m.positions || []).slice(0, 3).map((p) => (
              <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px] font-bold uppercase">{p}</span>
            ))}
            {m.notes && <span title={m.notes} className="text-[10px] text-amber-300">• note</span>}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {m.shifts_worked} shift{m.shifts_worked === 1 ? '' : 's'} here
            {m.last_worked && ` · last ${fmtShortDate(m.last_worked, timeZone)}`}
            {m.upcoming > 0 && ` · ${m.upcoming} upcoming`}
            {m.phone ? ` · ${m.phone}` : m.email ? ` · ${m.email}` : ''}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5">
          <RatingBadge rating={m.aggregate_rating} count={m.rating_count} showCount={false} />
          <ReliabilityBadge data={m.reliability} />
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {m.phone && <a href={`tel:${m.phone}`} className={btnGhost}><Phone className="w-3.5 h-3.5" /> Call</a>}
            {m.email && <a href={`mailto:${m.email}`} className={btnGhost}><Mail className="w-3.5 h-3.5" /> Email</a>}
            {!editing && (
              <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5" /> Positions & note
              </button>
            )}
            <span className="flex-1" />
            {m.status === 'active' && (
              <>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirm('removed')}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirm('blocked')}>
                  <Ban className="w-3.5 h-3.5 text-rose-400" /> Block
                </button>
              </>
            )}
            {m.status === 'removed' && (
              <button type="button" className={btnGhost} disabled={busy} onClick={() => patch({ status: 'active' })}>
                <RotateCcw className="w-3.5 h-3.5" /> Add back
              </button>
            )}
            {m.status === 'blocked' && (
              <button type="button" className={btnGhost} disabled={busy} onClick={() => patch({ status: 'active' })}>
                <RotateCcw className="w-3.5 h-3.5" /> Unblock
              </button>
            )}
          </div>

          {confirm && (
            <div className="p-3 rounded-xl border border-rose-600/40 bg-rose-500/5 text-xs text-rose-100 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[12rem]">
                {confirm === 'blocked'
                  ? `Block ${name}? They won't see or be able to request your shifts, and their waiting requests are declined. Existing bookings stay until you remove them.`
                  : `Remove ${name} from the team? They lose team perks (instant booking, new-shift alerts) but can still request open shifts.`}
              </span>
              <button type="button" className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-40"
                disabled={busy} onClick={() => patch({ status: confirm })}>
                {confirm === 'blocked' ? 'Block' : 'Remove'}
              </button>
              <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          )}

          {editing && (
            <div className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-900">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Positions they work here</label>
                <PositionPicker options={allOptions} value={positions} onChange={setPositions} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Private note (managers only)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className={inputCls}
                  placeholder="e.g. Great with VIP tables. Prefers weekends." />
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => patch({ positions, notes })}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={btnGhost} onClick={() => { setEditing(false); setPositions(m.positions || []); setNotes(m.notes || ''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <WorkerProfilePanel venueId={venueId} workerId={m.worker_id} timeZone={timeZone} compact refreshKey={profileKey} />
        </div>
      )}
    </div>
  );
}

const RELATION_LABEL = {
  active: ['On your team', 'text-emerald-300'],
  removed: ['Removed', 'text-slate-400'],
  blocked: ['Blocked', 'text-rose-300'],
  worked: ['On your team (worked here)', 'text-emerald-300'],
  requested: ['Requested here', 'text-amber-300'],
  none: ['', ''],
};
const looksLikeEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v || '').trim());

function CreateAccountForm({ venueId, positionOptions, initialEmail, onDone, onMessage }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: initialEmail || '', phone: '', positions: [] });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/venues/${venueId}/team/accounts`, form);
      setResult(res.data);
      onDone(false);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not create the account.' });
    } finally {
      setBusy(false);
    }
  };

  if (result) return <TempPassword result={result} onDone={() => onDone(true)} />;
  return (
    <form onSubmit={submit} className={`${cardCls} space-y-3`}>
      <div className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /> Create an account for them</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
        <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
        <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        <input className={inputCls} placeholder="Mobile (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      </div>
      <PositionPicker options={positionOptions} value={form.positions} onChange={(v) => set('positions', v)} />
      <p className="text-[11px] text-slate-500">They get a temporary password (shown once) to sign in with. If the email already has a worker account, they're just added to your team.</p>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}><UserPlus className="w-4 h-4" /> {busy ? 'Saving…' : 'Create account'}</button>
        <button type="button" className={btnGhost} onClick={() => onDone(true)}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Phase 29.1: Add people = search first. Finds people who worked or requested here, anyone who
 * lets venues find them, and any account by its exact email. Falls back to invite / create account.
 */
function AddPeoplePanel({ venueId, positionOptions, onAdded, onMessage, onGoInvite, onClose }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [positions, setPositions] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return undefined;
    }
    let active = true;
    setSearching(true);
    api
      .get(`/venues/${venueId}/people`, { params: { q: debounced } })
      .then((res) => active && setResults(res.data || []))
      .catch(() => active && setResults([]))
      .finally(() => active && setSearching(false));
    return () => {
      active = false;
    };
  }, [venueId, debounced]);

  const add = async (p) => {
    setAddingId(p.worker_id);
    try {
      await api.post(`/venues/${venueId}/team`, { worker_id: p.worker_id, positions });
      onMessage({ type: 'success', text: `${p.first_name} ${p.last_name} added to the team. They've been notified.` });
      setResults((rs) => rs.map((r) => (r.worker_id === p.worker_id ? { ...r, relation: 'active', can_add: false } : r)));
      onAdded();
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not add them.' });
    } finally {
      setAddingId(null);
    }
  };

  if (creating) {
    return (
      <CreateAccountForm
        venueId={venueId}
        positionOptions={positionOptions}
        initialEmail={looksLikeEmail(q) ? q.trim() : ''}
        onMessage={onMessage}
        onDone={(close) => {
          onAdded();
          if (close) setCreating(false);
        }}
      />
    );
  }

  const exactEmail = looksLikeEmail(debounced);
  return (
    <div className={`${cardCls} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-white flex items-center gap-2"><UserPlus className="w-4 h-4 text-emerald-400" /> Add people</div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} pl-9`}
          placeholder="Search by name, email or phone" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-400 mb-1">Tag them as (optional)</label>
        <PositionPicker options={positionOptions} value={positions} onChange={setPositions} />
      </div>

      {debounced.length >= 2 && (
        <div className="space-y-1.5">
          {searching && results.length === 0 ? (
            <p className="text-xs text-slate-500">Searching…</p>
          ) : results.length === 0 ? (
            <div className="p-3 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-2">
              <p>
                No one found. People only show up if they've worked or requested here, or let venues find them in their settings.
                {exactEmail ? ' No account uses that email yet.' : ' An exact email address always works.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGhost} onClick={onGoInvite}><Send className="w-3.5 h-3.5" /> Invite {exactEmail ? debounced : 'them'}</button>
                <button type="button" className={btnGhost} onClick={() => setCreating(true)}><KeyRound className="w-3.5 h-3.5" /> Create an account</button>
              </div>
            </div>
          ) : (
            results.map((p) => {
              const [relLabel, relCls] = RELATION_LABEL[p.relation] || RELATION_LABEL.none;
              return (
                <div key={p.worker_id} className="p-2.5 rounded-xl border border-slate-800 bg-slate-900 flex items-center gap-3">
                  <Avatar person={p} size="w-8 h-8 text-[11px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-white">{`${p.first_name} ${p.last_name}`.trim()}</span>
                      <RatingBadge rating={p.aggregate_rating} count={p.rating_count} showCount={false} />
                      {relLabel && <span className={`text-[10px] font-semibold ${relCls}`}>{relLabel}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {[p.email, p.phone].filter(Boolean).join(' · ')}
                      {p.reliability_score !== null && p.reliability_score !== undefined && ` · ${Math.round(p.reliability_score)}% reliable`}
                    </div>
                  </div>
                  {p.can_add ? (
                    <button type="button" className={btnGhost} disabled={addingId === p.worker_id} onClick={() => add(p)}>
                      <Plus className="w-3.5 h-3.5" /> {addingId === p.worker_id ? 'Adding…' : 'Add'}
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">{p.relation === 'blocked' ? 'Unblock them in the list' : 'Already on your team'}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
        <span className="text-[11px] text-slate-500 mr-auto pt-2">Not on ShiftBoard yet?</span>
        <button type="button" className={`${btnGhost} mt-2`} onClick={onGoInvite}><Send className="w-3.5 h-3.5" /> Invite by email, text or QR</button>
        <button type="button" className={`${btnGhost} mt-2`} onClick={() => setCreating(true)}><KeyRound className="w-3.5 h-3.5" /> Create an account</button>
      </div>
    </div>
  );
}

function MembersTab({ venueId, timeZone, positionOptions, onChanged, onMessage, onGoInvite }) {
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/venues/${venueId}/team`, { params: { status: filter } })
      .then((res) => active && setMembers(res.data || []))
      .catch((err) => active && onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not load the team.' }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, filter, tick]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return members;
    return members.filter((m) =>
      `${m.first_name} ${m.last_name} ${m.email || ''} ${m.phone || ''} ${(m.positions || []).join(' ')}`.toLowerCase().includes(term)
    );
  }, [members, q]);

  const updated = (member) => {
    setMembers((prev) =>
      prev
        .map((m) => (m.worker_id === member.worker_id ? member : m))
        .filter((m) => filter === 'all' || m.status === filter)
    );
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your team by name, phone or position" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex bg-slate-800 border border-slate-700 rounded-xl p-0.5 overflow-x-auto">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${filter === id ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        {!adding && (
          <button type="button" className={`${btnPrimary} justify-center`} onClick={() => setAdding(true)}>
            <UserPlus className="w-4 h-4" /> Add people
          </button>
        )}
      </div>

      {adding && (
        <AddPeoplePanel
          venueId={venueId}
          positionOptions={positionOptions}
          onAdded={() => { setTick((t) => t + 1); onChanged(); }}
          onMessage={onMessage}
          onGoInvite={onGoInvite}
          onClose={() => setAdding(false)}
        />
      )}

      {loading && members.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <Users className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">
            {filter === 'active' ? 'No one on the team yet.' : q ? 'No one matches.' : 'No one here.'}
          </p>
          {filter === 'active' && !q && (
            <div className="flex justify-center gap-2">
              <button type="button" className={btnGhost} onClick={() => setAdding(true)}><UserPlus className="w-3.5 h-3.5" /> Add people</button>
              <button type="button" className={btnGhost} onClick={onGoInvite}><Link2 className="w-3.5 h-3.5" /> Share your team link</button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">{shown.length} {shown.length === 1 ? 'person' : 'people'} · tap someone for their history and actions</p>
          {shown.map((m) => (
            <MemberRow
              key={m.worker_id}
              m={m}
              venueId={venueId}
              timeZone={timeZone}
              positionOptions={positionOptions}
              open={openId === m.worker_id}
              onToggle={() => setOpenId(openId === m.worker_id ? null : m.worker_id)}
              onUpdated={updated}
              onMessage={onMessage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Invite tab
// ---------------------------------------------------------------------------------------------
function TeamLinkCard({ venueId, venueName, onMessage }) {
  const [link, setLink] = useState(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get(`/venues/${venueId}/invites/link`)
      .then((res) => setLink(res.data))
      .catch((err) => onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not load the team link.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/venues/${venueId}/invites/link/regenerate`);
      setLink(res.data);
      setConfirmNew(false);
      onMessage({ type: 'success', text: 'New team link made. The old link and QR code no longer work.' });
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not make a new link.' });
    } finally {
      setBusy(false);
    }
  };

  if (!link) return <div className={cardCls}><p className="text-sm text-slate-500">Loading team link…</p></div>;
  const qrSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qr_svg)}`;
  const safeName = (venueName || 'team').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return (
    <div className={`${cardCls} flex flex-col sm:flex-row gap-4`}>
      <img src={qrSrc} alt="Team invite QR code" className="w-40 h-40 rounded-xl bg-white p-1 self-center sm:self-start" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-sm font-bold text-white flex items-center gap-2"><Link2 className="w-4 h-4 text-emerald-400" /> Team link</div>
        <p className="text-xs text-slate-400">
          Anyone with this link or QR code can join your team: post it in the staff group chat or print it for the back office.
          New people create an account; existing ones just sign in.
        </p>
        {/localhost|127\.0\.0\.1/.test(link.url) && !/localhost|127\.0\.0\.1/.test(window.location.hostname) && (
          <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg p-2 flex gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This link points at localhost, so it won't open on anyone's phone. Set APP_BASE_URL in the server's secrets file to your site address.
          </p>
        )}
        <div className="flex gap-2">
          <input readOnly value={link.url} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.target.select()} />
          <button type="button" className={btnGhost} onClick={async () => setCopied(await copyText(link.url))}>
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Joined with it: {link.uses}</span>
          <span>· Works until {fmtShortDate(link.expires_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={qrSrc} download={`${safeName}-team-qr.svg`} className={btnGhost}>
            <Download className="w-3.5 h-3.5" /> Download QR
          </a>
          {!confirmNew ? (
            <button type="button" className={btnGhost} onClick={() => setConfirmNew(true)}>
              <RefreshCw className="w-3.5 h-3.5" /> New link
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-amber-200">
              The current link and QR stop working.
              <button type="button" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold" disabled={busy} onClick={regenerate}>
                Make new link
              </button>
              <button type="button" className={btnGhost} onClick={() => setConfirmNew(false)}>Cancel</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultsTable({ result }) {
  if (!result) return null;
  const chip = {
    invited: 'text-emerald-300',
    already_member: 'text-slate-400',
    already_invited: 'text-indigo-300',
    invalid: 'text-rose-300',
  };
  return (
    <div className={`${cardCls} space-y-2`}>
      <p className="text-sm text-white">
        <strong>{result.invited}</strong> invited, <strong>{result.skipped}</strong> skipped.
        {result.emailed > 0 && ` ${result.emailed} emailed${result.email_available ? '' : ' (email isn’t set up on this server, so they were only logged; copy the links instead)'}.`}
        {result.texted > 0 && ` ${result.texted} texted.`}
      </p>
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-800 text-xs">
        {result.results.map((r) => (
          <div key={r.row} className="py-1.5 flex flex-wrap items-center gap-2">
            <span className="text-slate-500 w-10">#{r.row}</span>
            <span className="text-slate-200 min-w-[8rem]">{r.name || r.email || '—'}</span>
            <span className={`font-semibold ${chip[r.result] || ''}`}>{r.message}</span>
            {r.url && (
              <button type="button" className="text-slate-400 hover:text-white inline-flex items-center gap-1" onClick={() => copyText(r.url)}>
                <Copy className="w-3 h-3" /> link
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InviteTab({ venueId, venueName, positionOptions, onMessage }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [csvRows, setCsvRows] = useState(null);
  const [csvName, setCsvName] = useState('');
  const [invites, setInvites] = useState([]);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get(`/venues/${venueId}/invites`).then((res) => setInvites(res.data || [])).catch(() => setInvites([]));
  }, [venueId, tick]);

  const send = async (rows, source) => {
    setSending(true);
    setResult(null);
    try {
      const res = await api.post(`/venues/${venueId}/invites`, { rows, send: true, source });
      setResult(res.data);
      setTick((t) => t + 1);
      return true;
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not send the invites.' });
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendOne = async (e) => {
    e.preventDefault();
    if (!form.email && !form.phone) {
      onMessage({ type: 'error', text: 'Add an email or a mobile number.' });
      return;
    }
    if (await send([{ ...form, email: form.email || null, phone: form.phone || null }], 'manual')) {
      setForm({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
    }
  };

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, error } = csvToInviteRows(String(reader.result || ''));
      if (error) {
        onMessage({ type: 'error', text: error });
        setCsvRows(null);
        return;
      }
      setCsvName(file.name);
      setCsvRows(rows);
    };
    reader.readAsText(file);
  };

  const act = async (inv, action) => {
    setBusyId(inv.id);
    try {
      if (action === 'resend') {
        await api.post(`/venues/${venueId}/invites/${inv.id}/resend`);
        onMessage({ type: 'success', text: 'Invite sent again.' });
      } else {
        await api.delete(`/venues/${venueId}/invites/${inv.id}`);
        onMessage({ type: 'success', text: 'Invite turned off.' });
      }
      setTick((t) => t + 1);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not update the invite.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <TeamLinkCard venueId={venueId} venueName={venueName} onMessage={onMessage} />

      <form onSubmit={sendOne} className={`${cardCls} space-y-3`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Send className="w-4 h-4 text-emerald-400" /> Invite someone</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
          <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <input className={inputCls} placeholder="Mobile (texted if texts are set up)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <PositionPicker options={positionOptions} value={form.positions} onChange={(v) => set('positions', v)} />
        <button type="submit" className={btnPrimary} disabled={sending}>
          <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      <div className={`${cardCls} space-y-3`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400" /> Import a list (CSV)</div>
        <p className="text-xs text-slate-400">
          First row = column names: <code className="text-slate-200">name</code> (or <code className="text-slate-200">first_name</code>, <code className="text-slate-200">last_name</code>),{' '}
          <code className="text-slate-200">email</code>, <code className="text-slate-200">phone</code>, <code className="text-slate-200">positions</code> (separate several with ;).
          Everyone gets their own invite. Up to 200 people.
        </p>
        <label className={`${btnGhost} cursor-pointer w-fit`}>
          <Upload className="w-3.5 h-3.5" /> Choose file
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
        {csvRows && (
          <div className="space-y-2">
            <p className="text-xs text-slate-300">{csvName}: {csvRows.length} {csvRows.length === 1 ? 'person' : 'people'}. First few:</p>
            <div className="text-xs divide-y divide-slate-800 border border-slate-800 rounded-lg">
              {csvRows.slice(0, 5).map((r, i) => (
                <div key={i} className="px-2 py-1 flex flex-wrap gap-3 text-slate-300">
                  <span className="font-semibold text-white">{`${r.first_name} ${r.last_name}`.trim() || '—'}</span>
                  <span>{r.email || ''}</span>
                  <span>{r.phone || ''}</span>
                  <span className="text-slate-500">{r.positions.join(', ')}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} disabled={sending || csvRows.length > 200}
                onClick={async () => { if (await send(csvRows, 'import')) setCsvRows(null); }}>
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : `Send ${csvRows.length} invites`}
              </button>
              <button type="button" className={btnGhost} onClick={() => setCsvRows(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <ResultsTable result={result} />

      <div className={`${cardCls} space-y-2`}>
        <div className="text-sm font-bold text-white">Sent invites</div>
        {invites.length === 0 ? (
          <p className="text-xs text-slate-500">None yet.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {invites.map((inv) => (
              <div key={inv.id} className="py-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-100 font-semibold min-w-[8rem]">{`${inv.first_name || ''} ${inv.last_name || ''}`.trim() || inv.email || inv.phone}</span>
                <span className="text-slate-400">{inv.email || inv.phone}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${INVITE_CHIP[inv.status]}`}>
                  {inv.status === 'accepted' ? `Joined${inv.accepted_by_name ? ` (${inv.accepted_by_name})` : ''}` : inv.status[0].toUpperCase() + inv.status.slice(1)}
                </span>
                <span className="text-slate-500">
                  {inv.last_sent_at ? `sent ${fmtShortDate(inv.last_sent_at)}` : `created ${fmtShortDate(inv.created_at)}`}
                </span>
                <span className="ml-auto flex gap-1.5">
                  {inv.status !== 'accepted' && inv.status !== 'revoked' && (
                    <>
                      <button type="button" className={btnGhost} onClick={() => copyText(inv.url).then((ok) => ok && onMessage({ type: 'success', text: 'Invite link copied.' }))}>
                        <Copy className="w-3 h-3" /> Link
                      </button>
                      <button type="button" className={btnGhost} disabled={busyId === inv.id} onClick={() => act(inv, 'resend')}>
                        <RefreshCw className="w-3 h-3" /> Resend
                      </button>
                      <button type="button" className={btnGhost} disabled={busyId === inv.id} onClick={() => act(inv, 'revoke')}>
                        <X className="w-3 h-3" /> Turn off
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Managers tab
// ---------------------------------------------------------------------------------------------
function ManagersTab({ venueId, onMessage }) {
  const [managers, setManagers] = useState([]);
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [tick, setTick] = useState(0);
  const [confirmId, setConfirmId] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get(`/venues/${venueId}/managers`).then((res) => setManagers(res.data || [])).catch(() => setManagers([]));
  }, [venueId, tick]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/venues/${venueId}/managers`, form);
      setResult(res.data);
      setForm({ email: '', first_name: '', last_name: '', phone: '' });
      setTick((t) => t + 1);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not add the manager.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId) => {
    setBusy(true);
    try {
      await api.delete(`/venues/${venueId}/managers/${userId}`);
      setConfirmId(null);
      setTick((t) => t + 1);
      onMessage({ type: 'success', text: 'Manager removed from this venue.' });
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not remove the manager.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${cardCls} space-y-2`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Managers of this venue</div>
        {managers.length === 0 && (
          <p className="text-xs text-slate-500">No managers yet. Only platform admins can run this venue until you add one below.</p>
        )}
        <div className="divide-y divide-slate-800">
          {managers.map((m) => (
            <div key={m.user_id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-white">{`${m.first_name} ${m.last_name}`.trim() || m.email}</span>
              {m.is_you && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">You</span>}
              {m.is_primary && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">Primary</span>}
              <span className="text-xs text-slate-400">{m.email}</span>
              {!m.is_you && (
                <span className="ml-auto">
                  {confirmId === m.user_id ? (
                    <span className="inline-flex items-center gap-2 text-xs text-rose-200">
                      Remove their access?
                      <button type="button" className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold" disabled={busy} onClick={() => remove(m.user_id)}>Remove</button>
                      <button type="button" className={btnGhost} onClick={() => setConfirmId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" className={btnGhost} onClick={() => setConfirmId(m.user_id)}>
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {result ? (
        <TempPassword result={result} onDone={() => setResult(null)} />
      ) : (
        <form onSubmit={add} className={`${cardCls} space-y-3`}>
          <div className="text-sm font-bold text-white flex items-center gap-2"><UserCog className="w-4 h-4 text-amber-400" /> Add a co-manager</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
            <input className={inputCls} placeholder="Mobile (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <input className={inputCls} placeholder="First name (for a new account)" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          </div>
          <p className="text-[11px] text-slate-500">
            If they already have a manager account, they're added to this venue. Otherwise a manager account is created with a temporary password.
            Worker accounts can't be made managers here (ask a platform admin).
          </p>
          <button type="submit" className={btnPrimary} disabled={busy}>
            <UserCog className="w-4 h-4" /> {busy ? 'Saving…' : 'Add co-manager'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Phase 29: Team page (modal) for a venue: members, invites (link / QR / CSV), co-managers.
 * Phase 29.1: counts on the tabs, search-first "Add people", rows that expand into the profile.
 * Props: venue ({id, name}), positions (venue positions [{name}]), timeZone, onClose, onChanged
 */
export default function TeamModal({ venue, positions = [], timeZone, onClose, onChanged }) {
  const [tab, setTab] = useState('members');
  const [msg, setMsg] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryTick, setSummaryTick] = useState(0);
  const positionOptions = useMemo(() => (positions || []).map((p) => p.name).filter(Boolean), [positions]);
  const changed = () => {
    setSummaryTick((t) => t + 1);
    if (onChanged) onChanged();
  };

  useEffect(() => {
    api.get(`/venues/${venue.id}/team/summary`).then((res) => setSummary(res.data)).catch(() => setSummary(null));
  }, [venue.id, summaryTick, tab]);

  const tabs = [
    ['members', 'Team', Users, summary?.active],
    ['invite', 'Invite', Send, summary?.invites_pending],
    ['managers', 'Managers', ShieldCheck, summary?.managers],
  ];

  const headerExtra = (
    <div className="flex flex-wrap gap-2">
      {tabs.map(([id, label, Icon, count]) => (
        <button key={id} type="button" onClick={() => { setTab(id); setMsg(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 ${
            tab === id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}>
          <Icon className="w-3.5 h-3.5" /> {label}
          {count > 0 && (
            <span className={`px-1.5 rounded-full text-[10px] ${tab === id ? 'bg-slate-950/20' : 'bg-slate-700 text-slate-200'}`}>
              {id === 'invite' ? `${count} pending` : count}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <ModalShell
      title={`${venue?.name || 'Venue'} team`}
      subtitle="Who's on your team, how to bring new people in, and who else manages this venue."
      icon={<Users className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-5xl"
      headerExtra={headerExtra}
    >
      {msg && (
        <div className={`mb-4 p-3 rounded-xl text-sm border flex items-start justify-between gap-2 ${msg.type === 'success' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' : 'bg-rose-950/60 border-rose-700 text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}
      {tab === 'members' && (
        <MembersTab venueId={venue.id} timeZone={timeZone} positionOptions={positionOptions} onChanged={changed} onMessage={setMsg} onGoInvite={() => setTab('invite')} />
      )}
      {tab === 'invite' && (
        <InviteTab venueId={venue.id} venueName={venue.name} positionOptions={positionOptions} onMessage={setMsg} />
      )}
      {tab === 'managers' && <ManagersTab venueId={venue.id} onMessage={(m) => { setMsg(m); changed(); }} />}
    </ModalShell>
  );
}
```

---

## C8. `frontend/src/components/PostedShiftsBoard.jsx` (EDIT)
Header only: title row, then the controls.

**Edit 1.** Find:
```jsx

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-bold text-white">Posted Shifts ({events.length})</h2>
            <p className="text-xs text-slate-400">Every posted event with its positions, assigned staff and pending requests</p>
            {timeZone && <p className="text-[11px] text-slate-500">Times shown in venue time ({timeZone}). Calendar view uses your device's time.</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
            {SCOPES.map((s) => (
```
Replace with:
```jsx

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
      {/* Phase 29.1: title row, then the controls (fits the narrower 2/3 column) */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-start gap-2">
          <CalendarIcon className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">Posted Shifts ({events.length})</h2>
            <p className="text-xs text-slate-400">
              Every event with its positions, staff and requests.
              {timeZone && <span className="text-slate-500"> Times in venue time ({timeZone}).</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
            {SCOPES.map((s) => (
```

---

## C9. `frontend/src/components/NotificationSettingsModal.jsx` (EDITS)
Adds **Who can find me**; the title becomes "Notifications & privacy".

**Edit 1.** Find:
```jsx
import React, { useEffect, useState } from 'react';
import { Bell, Mail, MessageSquare, Moon, Send, Info } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { Bell, Mail, MessageSquare, Moon, Send, Info, Eye } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```

**Edit 2.** Find:
```jsx
        timezone: prefs.timezone,
        phone,
      };
      if (quietOn) {
```
Replace with:
```jsx
        timezone: prefs.timezone,
        phone,
        discoverable: prefs.discoverable || 'private',   // Phase 29.1
      };
      if (quietOn) {
```

**Edit 3.** Find:
```jsx
  return (
    <ModalShell
      title="Notification settings"
      subtitle="Everything always shows in the bell. Choose what also reaches your email and phone."
      icon={<Bell className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
```
Replace with:
```jsx
  return (
    <ModalShell
      title="Notifications & privacy"
      subtitle="Everything always shows in the bell. Choose what also reaches your email and phone, and who can find you."
      icon={<Bell className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
```

**Edit 4.** Find:
```jsx
              </div>
            </div>
          </div>
        </div>
```
Replace with:
```jsx
              </div>
            </div>

            {/* Phase 29.1: who can find me */}
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Eye className="w-4 h-4 text-emerald-400" /> Who can find me</div>
              <p className="text-xs text-slate-400">
                Lets venue managers find you by name or email to add you to their team. Venues you've worked for or
                requested shifts at can always see you, and anyone can add you if they type your exact email.
              </p>
              {[
                ['private', 'Only venues I work with', 'Nobody else can look you up by name.'],
                ['venues', 'Any venue on ShiftBoard', 'Managers can find you by name or email. Your email is partly hidden until you work together.'],
                ['everyone', 'Anyone on ShiftBoard', 'Venues, plus future features like finding coworkers.'],
              ].map(([value, title, body]) => (
                <label key={value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="discoverable"
                    checked={(prefs.discoverable || 'private') === value}
                    onChange={() => set('discoverable', value)}
                    className="mt-1 w-4 h-4 bg-slate-800 border-slate-700 text-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">{title}</span>
                    <span className="block text-xs text-slate-400">{body}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
```

---

## C10. `frontend/src/components/StaffPositionModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your team, or anyone by name or email"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
          />
```
Replace with:
```jsx
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your team, or people who let venues find them"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
          />
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
ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverable VARCHAR(20) NOT NULL DEFAULT 'private';

CREATE TABLE IF NOT EXISTS venue_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(40) NOT NULL,
    category VARCHAR(20) NOT NULL,
    summary VARCHAR(400) NOT NULL,
    event_id UUID REFERENCES shift_events(id) ON DELETE SET NULL,
    request_id UUID REFERENCES shift_requests(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_venue_activity_venue_created ON venue_activity(venue_id, created_at DESC);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Set `APP_BASE_URL`** (user, not AGY):
- Your team link currently shows `http://localhost:5173/join/…`, because `APP_BASE_URL` isn't set in `.secrets/.secrets.env`.
- Invite links now fall back to the site you're on. **Notification emails still use `APP_BASE_URL`.**
- Add `APP_BASE_URL=https://dev-scheduler.jaccollective.com`, then `docker compose up -d --force-recreate backend` (a plain restart doesn't re-read env files).

### Checklist
Sign in as the manager (or as an admin, with the venue picked in the navbar).

1. **Layout (desktop):**
   * Posted Shifts fills the left two-thirds, right under the header.
   * The right column shows Requests to review, Hand-offs to approve, then Activity.
   * The page uses the full width (no more narrow centred column).
2. **Layout (phone):** Posted Shifts comes first. With anything waiting, an amber "N requests to review" chip at the top scrolls to the queue.
3. **Queue cards:** each request shows the position, event, **date and time**, "full" if the position is full, and the worker's note in amber.
4. **Review:** click **Review** on a request.
   * Left: the shift summary and "Note with the request".
   * Right: the profile, with rating, reliability, shifts here, your rating, positions, private note and **History here**.
   * **Approve** books them and closes the modal; the activity log shows "Approved … for …".
5. **Hand-off review:**
   * A pending hand-off shows "A → B", the date and **their note**.
   * Review has **Taking it / Giving it up** buttons that switch the profile.
6. **Drops:** as a worker, drop a shift more than 24 h out.
   * The manager's bell shows "**<name> dropped …**" (urgent if within 48 h).
   * The log shows "… dropped …".
7. **Activity log:** post, edit, cancel, assign, offer and approve something. Each appears within a refresh, with "by <name>".
   * The **Bookings / Staffing / Team / Changes / Alerts** chips filter the list.
   * Clicking an event line opens its roster; clicking a team line opens the worker profile.
8. **Stale queue:** a request for a shift that has ended no longer appears in Requests to review.
9. **Badges:** a brand-new worker shows **New** (rating) and a grey **No history** (reliability), not "New New".
10. **Team tab:**
    * The tabs show counts (Team N, Invite N pending, Managers N).
    * The filter, On team/Removed/Blocked/Everyone and Add people sit on one row.
    * Rows expand to show Call/Email, **Positions & note**, Remove/Block and the history.
11. **Add people search:**
    * Type part of the name of someone who **requested** here: they appear with "Requested here" and **Add**. Adding them sends them "You're on the <venue> team".
    * Type the name of a worker who never worked here: **not found** (they're private).
    * Type their **exact email**: found.
12. **Privacy setting:** as that worker, open the bell ⚙, choose **Any venue on ShiftBoard** and save.
    * The manager can now find them by name, with the email shown as `wo***@…`.
    * The Assign / Offer search finds them too.
    * Switch back to **Only venues I work with** and they disappear from name search.
13. **No match:** the "No one found" box offers **Invite** and **Create an account**. Create an account pre-fills the typed email.
14. **Invite tab:** with `APP_BASE_URL` unset, the team link and QR use `https://dev-scheduler.jaccollective.com/join/…`, not localhost. If it still says localhost, an amber warning explains how to fix it.
15. **Managers tab:** on a venue with no managers, it says "No managers yet".
16. **Hand-off note:** a worker proposes a hand-off with a note. The note shows in the Hand-offs card and in Review.
17. **Notifications:** the banner after approve/deny disappears by itself after about 6 s. Errors stay.

---