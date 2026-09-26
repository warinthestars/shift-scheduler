# Phase 29.2: Admin Console Overhaul

**Why:** The admin page hasn't changed much since Phase 20, while venues, teams, invites, notifications and ratings were added around it. An audit of the live `/admin` page found these problems:

* **Stats:** confusing ("7 users, 4 workers, 1 managers"), and nothing tells the admin what needs doing.
* **Venue table:**
  - The **Geofence** column showed "150m" even when geofencing was off.
  - **Auto-approve** showed the legacy rating threshold instead of the real booking policy.
  - Venues with no manager weren't flagged.
* **User table:**
  - Workers showed **"None assigned"** even after working at a venue.
  - Everything loaded at once, with no paging.
  - No way to open one person and see their history.
* **Edit user:**
  - Could only change role and venues. Name, email and phone were not editable.
  - **Esc didn't close it.**
* **Create user:** forced the admin to type a password (placeholder said "min 6"; the server needs 8).
* **Venue delete:** used a browser `confirm()`, then deleted everything with no protection for payroll history.
* **Missing tools:**
  - no record of what admins changed
  - no way to see whether emails/texts are going out or whether the background worker is alive
  - no way to retry failed notifications
* **Duplicate accounts:** easy to miss (e.g. a Firebase sign-up next to an admin-made account with the same name).

## What this phase adds

The admin page becomes a console with five tabs (kept in the URL as `?tab=`). A venue or a person opens in a **right-hand drawer** from any tab; Esc or the backdrop closes it.

1. **Overview:**
   * **Needs attention**: a clickable list of what needs doing, including:
     - failed emails/texts in the last 24 h
     - venues with **no manager**
     - open spots on shifts starting within **48 h** (per venue)
     - requests waiting **over 24 h**
     - `APP_BASE_URL` pointing at localhost
     - email in console mode
   * **Tiles:**
     - **People**: workers · managers · admins
     - **Venues**: events in the next 7 days
     - **Staffed, next 7 days**: fill %, open spots
     - **Waiting on managers**: requests + hand-offs, plus how many are over 24 h
     - **Emails & texts, 24 h**: sent / failed
   * **Latest at venues** (activity across every venue) and **Admin actions** (the new audit log).
2. **Venues:**
   * **Table** with search. Columns:
     - managers
     - active team
     - events (30 d)
     - open spots (7 d)
     - requests waiting
     - **real booking policy**
     - **Clock-in: On site / Anywhere** (from `geofence_enabled`)
     - last activity
   * **Warning chips**: No manager / No positions set up / No team yet.
   * **Dashboard** button: opens that venue's manager dashboard, switching the navbar venue.
   * **Venue drawer:**
     - health facts
     - managers (click → person drawer)
     - the venue's activity log
     - admin changes for the venue
     - **Team**, **Settings** and **Open dashboard** buttons, reusing the existing TeamModal and VenueSettingsModal
     - a **safe delete**:
       - you must type the venue name
       - it warns about upcoming events
       - a checkbox must be ticked to also delete clock-ins/time sheets; without it the server refuses (409) if payroll history exists
   * **New venue** now lets you name the manager by email at creation, then opens the new venue's drawer.
3. **People** (was "User Management"):
   * **Server-side** search (name/email/phone), 25 per page.
   * **Filters:** role, venue (managers, team members *and* anyone who has requested there), active/deactivated, sign-in type.
   * **Each row shows:**
     - venue chips: amber = manages, green = on team, grey = **worked there**, struck-out = removed, red = blocked
     - shifts worked · upcoming
     - rating, sign-in type
     - last request, joined
   * A **"Same name"** flag marks likely duplicate accounts.
   * Phones get a card list.
   * **Person drawer:**
     - stats: worked, upcoming, rating, reliability
     - **editable name, email, phone, role and venues**, saved with one button that sends only what changed
     - every venue connection (with team positions and the venue's private note)
     - their last 20 shifts across all venues
     - their notification and privacy settings
     - admin changes about them
     - **Account**: reset password, deactivate/reactivate, and delete (type the email to confirm)
     - Esc closes it
   * **New user** generates a **temporary password by default** and shows it once, with **Copy password** and **Copy sign-in message**. "Set one now" requires 8+ characters.
4. **Activity:**
   * **Venue activity** across every venue (venue filter + category chips, Load more). Clicking an event line opens that event in the manager dashboard; a worker line opens the person.
   * **Admin changes**: the full audit log (People / Venues / System filter, Load more).
5. **System:**
   * **Configuration check**, each with ok/warning:
     - public address
     - email
     - texts
     - Google/Firebase sign-in
     - self sign-up
     - always-admin accounts
   * **Background worker:**
     - on/off
     - **last heartbeat** (stored in Redis by whichever backend process runs the worker)
     - last error
     - delivery counts: queued, sent, failed, skipped
   * **Failed emails & texts** list, with **Retry** per row and **Retry all (last 7 days)**.
   * **Send a test email** through the real email settings.
   * Row counts for the main tables.
6. **Admin audit log** (new `admin_audit` table). Records:
   - user created, edited (with the list of changes), role changed, activated/deactivated, password reset, deleted
   - venue created, deleted
   - delivery retries
   - test emails
7. **Backend fixes:**
   * `POST /api/admin/users`: `password` is optional. If it's blank, the server generates a temporary password and returns it once as `temporary_password`. A typed password must be 8+ characters.
   * `PATCH /api/admin/users/{id}`:
     - accepts `email`: unique; ALWAYS_ADMIN accounts are refused
     - a blank `phone` now clears the phone instead of saving `""`
   * `DELETE /api/venues/{id}`:
     - requires `?confirm_name=<venue name>` (case-insensitive)
     - returns **409** if clock-ins exist, unless `&delete_history=true`
     - deletes through database cascades
     - is audited
   * The navbar's admin venue switcher reloads its list when the console creates or deletes a venue.

⚠️ **Schema change:** one new table (`admin_audit`). See §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` CORS logic (only add the one import and `include_router` line shown)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages.
* No native PostgreSQL ENUMs:
  - `admin_audit.target_type`: `user` | `venue` | `system`
  - `admin_audit.action`: see the docstring in `services/admin_audit.py`
* Aware UTC datetimes only.
* `admin_audit.record(...)` always runs **after** the endpoint's commit, opens its own session and never raises. Never move it inside a transaction.
* **Keep the old endpoints.** The new console doesn't call `GET /api/admin/users` or `/api/admin/stats`, but leave them in place.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current (Phase 29.1) files and checked:
  - after applying them, the backend imports cleanly and all 147 API operations build, 16 of them under `/api/admin`
  - the frontend bundles with no missing imports
  - 64 new integration checks pass against PostgreSQL 16, and the Phase 29 and 29.1 suites still pass
  - every tab, both drawers, the delete dialog and the create-user flow were rendered with the real Tailwind build at desktop and phone widths

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDIT: append)

**Edit 1.** Find:
```sql
);
CREATE INDEX idx_venue_activity_venue_created ON venue_activity(venue_id, created_at DESC);
```
Replace with:
```sql
);
CREATE INDEX idx_venue_activity_venue_created ON venue_activity(venue_id, created_at DESC);

-- ==============================================================================
-- Phase 29.2: Platform admin audit log (who changed users, venues and system settings)
-- ==============================================================================
CREATE TABLE admin_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(40) NOT NULL,
    target_type VARCHAR(20) NOT NULL,                     -- user | venue | system
    target_id UUID,                                       -- no FK: the target may be deleted
    summary VARCHAR(400) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit(target_type, target_id);
```

---

## A2. `backend/src/models.py` (EDIT)

**Edit 1.** Find:
```python
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class VenueActivity(Base):
    """Phase 29.1: one line in a venue's activity log."""
```
Replace with:
```python
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class AdminAudit(Base):
    """Phase 29.2: one platform-admin action (user / venue / system)."""
    __tablename__ = "admin_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(40), nullable=False)
    target_type = Column(String(20), nullable=False)          # user | venue | system
    target_id = Column(UUID(as_uuid=True), nullable=True)      # no FK: the target may be deleted
    summary = Column(String(400), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class VenueActivity(Base):
    """Phase 29.1: one line in a venue's activity log."""
```

---

## A3. `backend/src/schemas.py` (EDITS)
`UserResponse.temporary_password`, optional `UserCreateAdmin.password`, `UserUpdateAdmin.email`, and the new `Admin*` response models at the end.

**Edit 1.** Find:
```python
    auth_source: Optional[str] = None     # "local" | "firebase" | "both"
    has_password: bool = False

    # For UI compatibility
```
Replace with:
```python
    auth_source: Optional[str] = None     # "local" | "firebase" | "both"
    has_password: bool = False
    temporary_password: Optional[str] = None   # Phase 29.2: only on admin create, when generated

    # For UI compatibility
```

**Edit 2.** Find:
```python
class UserCreateAdmin(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
```
Replace with:
```python
class UserCreateAdmin(BaseModel):
    email: EmailStr
    password: Optional[str] = None           # Phase 29.2: blank = generate a temporary password (returned once)
    first_name: str
    last_name: str
```

**Edit 3.** Find:
```python
    role: Optional[str] = None
    is_active: Optional[bool] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
```
Replace with:
```python
    role: Optional[str] = None
    is_active: Optional[bool] = None
    email: Optional[EmailStr] = None         # Phase 29.2
    first_name: Optional[str] = None
    last_name: Optional[str] = None
```

**Edit 4.** Find:
```python
    worker_id: Optional[UUID] = None
    created_at: datetime
```
Replace with:
```python
    worker_id: Optional[UUID] = None
    created_at: datetime


# ------------------------------------------------------------------------------
# Phase 29.2: Admin console
# ------------------------------------------------------------------------------
class AdminNameRef(BaseModel):
    id: UUID
    name: str


class AdminPersonRef(BaseModel):
    user_id: UUID
    name: str
    email: Optional[str] = None


class AdminMembership(BaseModel):
    venue_id: UUID
    venue_name: str
    status: str                              # active | removed | blocked | worked
    source: Optional[str] = None
    positions: List[str] = []
    notes: Optional[str] = None              # the venue's private note (admins see all)


class AdminUserRow(BaseModel):
    id: UUID
    first_name: str = ""
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    is_active: bool = True
    auth_source: str = "local"               # local | firebase | both
    has_password: bool = False
    created_at: datetime
    managed_venues: List[AdminNameRef] = []
    memberships: List[AdminMembership] = []
    shifts_worked: int = 0
    upcoming: int = 0
    aggregate_rating: float = 5.0
    rating_count: int = 0
    last_activity_at: Optional[datetime] = None
    discoverable: str = "private"
    always_admin: bool = False


class AdminUserPage(BaseModel):
    total: int
    items: List[AdminUserRow]


class AdminHistoryItem(BaseModel):
    request_id: UUID
    venue_id: UUID
    venue_name: str
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    status: str


class AdminAuditItem(BaseModel):
    id: UUID
    actor_name: Optional[str] = None
    action: str
    target_type: str
    target_id: Optional[UUID] = None
    summary: str
    created_at: datetime


class AdminUserDetail(BaseModel):
    user: AdminUserRow
    reliability: Optional[WorkerReliability] = None
    email_enabled: bool = True
    sms_enabled: bool = False
    history: List[AdminHistoryItem] = []
    audit: List[AdminAuditItem] = []


class AdminVenueRow(BaseModel):
    id: UUID
    name: str
    address: str
    timezone: str = "America/New_York"
    created_at: datetime
    managers: List[AdminPersonRef] = []
    team_active: int = 0
    upcoming_events: int = 0                 # next 30 days, not cancelled
    open_spots_7d: int = 0
    pending_requests: int = 0
    approval_policy: str = "team_auto"
    geofence_enabled: bool = False
    positions_count: int = 0
    locations_count: int = 0
    last_activity_at: Optional[datetime] = None
    warnings: List[str] = []


class AdminAttention(BaseModel):
    level: str                               # error | warn | info
    text: str
    kind: str = "system"                     # venue | users | system | deliveries
    target_id: Optional[UUID] = None


class AdminActivityItem(BaseModel):
    id: UUID
    venue_id: UUID
    venue_name: str
    kind: str
    category: str
    summary: str
    actor_name: Optional[str] = None
    event_id: Optional[UUID] = None
    worker_id: Optional[UUID] = None
    created_at: datetime


class AdminOverview(BaseModel):
    users_total: int = 0
    workers: int = 0
    managers: int = 0
    admins: int = 0
    deactivated: int = 0
    new_users_7d: int = 0
    venues: int = 0
    events_next_7d: int = 0
    spots_next_7d: int = 0
    open_spots_next_7d: int = 0
    fill_rate_next_7d: Optional[float] = None
    urgent_open_spots_48h: int = 0
    pending_requests: int = 0
    stale_requests_24h: int = 0
    pending_handoffs: int = 0
    deliveries_sent_24h: int = 0
    deliveries_failed_24h: int = 0
    attention: List[AdminAttention] = []
    recent_activity: List[AdminActivityItem] = []
    recent_audit: List[AdminAuditItem] = []


class AdminDeliveryStats(BaseModel):
    pending: int = 0
    sent_24h: int = 0
    failed_24h: int = 0
    failed_7d: int = 0
    skipped_24h: int = 0


class AdminSystem(BaseModel):
    app_base_url: str = ""
    app_base_url_ok: bool = False
    email_provider: str = "console"
    email_from: str = ""
    email_ready: bool = False
    sms_provider: str = "off"
    sms_ready: bool = False
    firebase: str = "off"                    # real | mock | off
    self_registration: bool = True
    always_admin_count: int = 0
    worker_enabled: bool = True
    worker_started_at: Optional[datetime] = None
    worker_last_tick_at: Optional[datetime] = None
    worker_last_ok: Optional[bool] = None
    worker_last_error: Optional[str] = None
    worker_heartbeat_at: Optional[datetime] = None   # from Redis (any backend process)
    digest_hour: int = 9
    deliveries: AdminDeliveryStats = AdminDeliveryStats()
    table_counts: dict = {}


class AdminDelivery(BaseModel):
    id: UUID
    channel: str
    status: str
    attempts: int = 0
    last_error: Optional[str] = None
    created_at: datetime
    send_after: Optional[datetime] = None
    user_id: UUID
    user_name: str = ""
    user_email: Optional[str] = None
    title: str = ""


class AdminTestEmail(BaseModel):
    to: EmailStr
```

---

# PART B: Backend

## B1. NEW FILE `backend/src/services/admin_audit.py`

```python
"""
Phase 29.2: Platform admin audit log.

record() opens its own session, commits and NEVER raises: call it AFTER the admin action committed.
Actions: user_created, user_updated, user_role, user_status, user_password, user_deleted,
         venue_created, venue_deleted, delivery_retry, test_email
"""
import logging
from typing import Optional

from src.database import AsyncSessionLocal
from src.models import AdminAudit

logger = logging.getLogger("shiftboard.admin_audit")


async def record(actor_id, action: str, summary: str, *, target_type: str = "system", target_id=None) -> None:
    try:
        async with AsyncSessionLocal() as db:
            db.add(AdminAudit(
                actor_user_id=actor_id, action=action, target_type=target_type,
                target_id=target_id, summary=(summary or "")[:400],
            ))
            await db.commit()
    except Exception:
        logger.exception(f"admin audit '{action}' failed")


def person(u) -> str:
    if u is None:
        return "someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return f"{name} ({u.email})" if name else (u.email or "someone")
```

---

## B2. NEW FILE `backend/src/routers/admin_console.py`
All endpoints require a platform admin (`require_admin`) and share the `/api/admin` prefix with `routers/admin.py`. No paths overlap.

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/admin/overview` | counts, "needs attention", recent activity + audit |
| GET | `/api/admin/venues/summary` | one health row per venue |
| GET | `/api/admin/directory?q=&role=&status=&auth=&venue_id=&limit=50&offset=0` | `{total, items}` people, paged |
| GET | `/api/admin/users/{user_id}/detail` | one person: venues, history, reliability, settings, audit |
| GET | `/api/admin/activity?venue_id=&category=&before=&limit=40` | activity across venues |
| GET | `/api/admin/audit?target_type=&target_id=&before=&limit=40` | admin audit log |
| GET | `/api/admin/system` | config, worker health, delivery stats, table counts |
| GET | `/api/admin/deliveries?status=failed&limit=50` | notification deliveries |
| POST | `/api/admin/deliveries/{delivery_id}/retry` | failed → pending (400 otherwise) |
| POST | `/api/admin/deliveries/retry-failed` | all failed in the last 7 days |
| POST | `/api/admin/test-email` | `{to}`; 502 if sending fails |

```python
"""
Phase 29.2: Admin console (platform admins only).

  GET  /api/admin/overview                     numbers, "needs attention", recent activity + admin log
  GET  /api/admin/venues/summary               one row per venue with health warnings
  GET  /api/admin/directory?q=&role=&status=&auth=&venue_id=&limit=&offset=   users, server-side paged
  GET  /api/admin/users/{user_id}/detail       one user: memberships, history, audit
  GET  /api/admin/activity?venue_id=&category=&before=&limit=   every venue's activity log
  GET  /api/admin/audit?target_type=&target_id=&before=&limit=  admin actions
  GET  /api/admin/system                       configuration + background worker + delivery health
  GET  /api/admin/deliveries?status=failed&limit=
  POST /api/admin/deliveries/{delivery_id}/retry
  POST /api/admin/deliveries/retry-failed
  POST /api/admin/test-email                   {to}
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.models import (
    User, Venue, VenueManager, VenueWhitelist, VenuePosition, VenueLocation, Shift, ShiftEvent, ShiftRequest,
    ShiftTransfer, TimeEntry, VenueActivity, AdminAudit, Notification, NotificationDelivery, NotificationPreference,
)
from src.schemas import (
    AdminOverview, AdminAttention, AdminActivityItem, AdminAuditItem, AdminVenueRow, AdminPersonRef,
    AdminUserRow, AdminUserPage, AdminUserDetail, AdminHistoryItem, AdminMembership, AdminNameRef,
    AdminSystem, AdminDeliveryStats, AdminDelivery, AdminTestEmail, WorkerReliability,
)
from src.auth import require_admin, normalize_role
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email, get_always_admin_emails
from src.services.reliability import compute_reliability
from src.services.messaging import email_available, sms_available, send_email, render_email
from src.services.activity import CATEGORIES
from src.services import admin_audit

router = APIRouter(prefix="/api/admin", tags=["Admin console"])

WORKED = ("approved", "confirmed", "checked_in", "completed", "transferred")
FINISHED = ("approved", "confirmed", "checked_in", "completed")
BOOKED = ("approved", "confirmed", "checked_in")
PENDING = ("pending", "pending_manager_approval")


def _name(u: Optional[User]) -> str:
    if u is None:
        return ""
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or (u.email or "")


async def _names(db: AsyncSession, ids) -> Dict[UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: _name(u) for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}


def _base_url_ok() -> bool:
    url = (settings.APP_BASE_URL or "").strip()
    return bool(url) and "localhost" not in url and "127.0.0.1" not in url


# ---------------------------------------------------------------------------------------------
# Shared builders
# ---------------------------------------------------------------------------------------------
async def _audit_items(db: AsyncSession, q) -> List[AdminAuditItem]:
    rows = (await db.execute(q)).scalars().all()
    names = await _names(db, [r.actor_user_id for r in rows])
    return [
        AdminAuditItem(id=r.id, actor_name=names.get(r.actor_user_id), action=r.action, target_type=r.target_type,
                       target_id=r.target_id, summary=r.summary, created_at=r.created_at)
        for r in rows
    ]


async def _activity_items(db: AsyncSession, q) -> List[AdminActivityItem]:
    rows = (await db.execute(q)).all()
    names = await _names(db, [a.actor_user_id for a, _ in rows])
    return [
        AdminActivityItem(
            id=a.id, venue_id=a.venue_id, venue_name=vname, kind=a.kind, category=a.category, summary=a.summary,
            actor_name=names.get(a.actor_user_id), event_id=a.event_id, worker_id=a.worker_id, created_at=a.created_at,
        )
        for a, vname in rows
    ]


async def _user_rows(db: AsyncSession, users: List[User]) -> List[AdminUserRow]:
    if not users:
        return []
    ids = [u.id for u in users]
    now = datetime.now(timezone.utc)

    managed = defaultdict(list)
    for uid, vid, vname in (await db.execute(
        select(VenueManager.user_id, Venue.id, Venue.name).join(Venue, Venue.id == VenueManager.venue_id)
        .where(VenueManager.user_id.in_(ids)).order_by(Venue.name)
    )).all():
        managed[uid].append(AdminNameRef(id=vid, name=vname))

    members = defaultdict(dict)
    for wl, vname in (await db.execute(
        select(VenueWhitelist, Venue.name).join(Venue, Venue.id == VenueWhitelist.venue_id)
        .where(VenueWhitelist.worker_id.in_(ids))
    )).all():
        members[wl.worker_id][wl.venue_id] = AdminMembership(
            venue_id=wl.venue_id, venue_name=vname, status=wl.status or "active", source=wl.source,
            positions=list(wl.positions or []), notes=wl.notes,
        )
    for wid, vid, vname in (await db.execute(
        select(ShiftRequest.worker_id, Venue.id, Venue.name).distinct()
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .where(ShiftRequest.worker_id.in_(ids), func.lower(ShiftRequest.status).in_(WORKED))
    )).all():
        if vid not in members[wid]:
            members[wid][vid] = AdminMembership(venue_id=vid, venue_name=vname, status="worked", source="worked")

    worked = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), Shift.end_time < now, func.lower(ShiftRequest.status).in_(FINISHED))
        .group_by(ShiftRequest.worker_id)
    )).all())
    upcoming = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), Shift.end_time >= now, func.lower(ShiftRequest.status).in_(BOOKED))
        .group_by(ShiftRequest.worker_id)
    )).all())
    last = dict((await db.execute(
        select(ShiftRequest.worker_id, func.max(ShiftRequest.created_at))
        .where(ShiftRequest.worker_id.in_(ids)).group_by(ShiftRequest.worker_id)
    )).all())

    out = []
    for u in users:
        out.append(AdminUserRow(
            id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email, phone=u.phone,
            avatar_url=u.avatar_url, role=normalize_role(u.role), is_active=bool(u.is_active),
            auth_source=auth_source_for(u), has_password=bool(u.hashed_password), created_at=u.created_at,
            managed_venues=managed.get(u.id, []),
            memberships=sorted(members.get(u.id, {}).values(), key=lambda m: m.venue_name.lower()),
            shifts_worked=int(worked.get(u.id, 0)), upcoming=int(upcoming.get(u.id, 0)),
            aggregate_rating=float(u.aggregate_rating or 0.0), rating_count=int(u.rating_count or 0),
            last_activity_at=last.get(u.id), discoverable=getattr(u, "discoverable", None) or "private",
            always_admin=is_always_admin_email(u.email),
        ))
    return out


# ---------------------------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------------------------
@router.get("/overview", response_model=AdminOverview)
async def overview(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    role_counts = defaultdict(int)
    deactivated = 0
    for role, active, n in (await db.execute(
        select(func.lower(User.role), User.is_active, func.count(User.id)).group_by(func.lower(User.role), User.is_active)
    )).all():
        role_counts[normalize_role(role)] += n
        if not active:
            deactivated += n
    new_7d = int(await db.scalar(select(func.count(User.id)).where(User.created_at >= now - timedelta(days=7))) or 0)
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    live = and_(func.upper(Shift.status) != "CANCELLED", Shift.start_time >= now)
    events_7d = int(await db.scalar(
        select(func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=7))
    ) or 0)
    cap, filled = (await db.execute(
        select(func.coalesce(func.sum(Shift.capacity), 0), func.coalesce(func.sum(Shift.spots_filled), 0))
        .where(live, Shift.start_time < now + timedelta(days=7))
    )).one()
    cap, filled = int(cap or 0), int(filled or 0)
    urgent_by_venue = dict((await db.execute(
        select(Shift.venue_id, func.sum(Shift.capacity - Shift.spots_filled))
        .where(live, Shift.start_time < now + timedelta(hours=48), Shift.spots_filled < Shift.capacity)
        .group_by(Shift.venue_id)
    )).all())
    pending = int(await db.scalar(
        select(func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(func.lower(ShiftRequest.status).in_(PENDING), Shift.end_time > now, func.upper(Shift.status) != "CANCELLED")
    ) or 0)
    stale_by_venue = dict((await db.execute(
        select(Shift.venue_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(func.lower(ShiftRequest.status).in_(PENDING), Shift.end_time > now,
               func.upper(Shift.status) != "CANCELLED", ShiftRequest.created_at < now - timedelta(hours=24))
        .group_by(Shift.venue_id)
    )).all())
    handoffs = int(await db.scalar(
        select(func.count(ShiftTransfer.id)).where(func.lower(ShiftTransfer.status) == "pending_manager_approval")
    ) or 0)
    sent_24h = int(await db.scalar(select(func.count(NotificationDelivery.id)).where(
        NotificationDelivery.status == "sent", NotificationDelivery.sent_at >= now - timedelta(hours=24))) or 0)
    failed_24h = int(await db.scalar(select(func.count(NotificationDelivery.id)).where(
        NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(hours=24))) or 0)

    mgr_counts = dict((await db.execute(
        select(VenueManager.venue_id, func.count(VenueManager.user_id)).group_by(VenueManager.venue_id)
    )).all())
    vname = {v.id: v.name for v in venues}

    attention: List[AdminAttention] = []
    if failed_24h:
        attention.append(AdminAttention(level="error", kind="deliveries",
                                        text=f"{failed_24h} email/text notification{'s' if failed_24h != 1 else ''} failed in the last 24 h."))
    for v in venues:
        if not mgr_counts.get(v.id):
            attention.append(AdminAttention(level="warn", kind="venue", target_id=v.id,
                                            text=f"{v.name} has no manager. Only platform admins can run it."))
    for vid, n in sorted(urgent_by_venue.items(), key=lambda x: -int(x[1] or 0)):
        if n:
            attention.append(AdminAttention(level="warn", kind="venue", target_id=vid,
                                            text=f"{vname.get(vid, 'A venue')}: {int(n)} open spot{'s' if n != 1 else ''} on shifts starting in the next 48 h."))
    for vid, n in stale_by_venue.items():
        attention.append(AdminAttention(level="warn", kind="venue", target_id=vid,
                                        text=f"{vname.get(vid, 'A venue')}: {n} request{'s' if n != 1 else ''} waiting over 24 h."))
    if not _base_url_ok():
        attention.append(AdminAttention(level="warn", kind="system",
                                        text="APP_BASE_URL isn't set to your public address, so links in emails point at localhost."))
    if not email_available():
        attention.append(AdminAttention(level="info", kind="system",
                                        text="Email is in console mode: notification emails are only written to the backend log."))

    recent = await _activity_items(db, (
        select(VenueActivity, Venue.name).join(Venue, Venue.id == VenueActivity.venue_id)
        .order_by(VenueActivity.created_at.desc()).limit(12)
    ))
    audit = await _audit_items(db, select(AdminAudit).order_by(AdminAudit.created_at.desc()).limit(6))

    return AdminOverview(
        users_total=sum(role_counts.values()), workers=role_counts.get("worker", 0),
        managers=role_counts.get("venue_manager", 0), admins=role_counts.get("platform_admin", 0),
        deactivated=deactivated, new_users_7d=new_7d, venues=len(venues), events_next_7d=events_7d,
        spots_next_7d=cap, open_spots_next_7d=max(0, cap - filled),
        fill_rate_next_7d=round(100.0 * filled / cap, 1) if cap else None,
        urgent_open_spots_48h=int(sum(int(n or 0) for n in urgent_by_venue.values())),
        pending_requests=pending, stale_requests_24h=int(sum(stale_by_venue.values())), pending_handoffs=handoffs,
        deliveries_sent_24h=sent_24h, deliveries_failed_24h=failed_24h,
        attention=attention, recent_activity=recent, recent_audit=audit,
    )


# ---------------------------------------------------------------------------------------------
# Venues
# ---------------------------------------------------------------------------------------------
@router.get("/venues/summary", response_model=List[AdminVenueRow])
async def venues_summary(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()
    managers = defaultdict(list)
    for vid, u in (await db.execute(
        select(VenueManager.venue_id, User).join(User, User.id == VenueManager.user_id).order_by(User.first_name)
    )).all():
        managers[vid].append(AdminPersonRef(user_id=u.id, name=_name(u), email=u.email))
    team = dict((await db.execute(
        select(VenueWhitelist.venue_id, func.count(VenueWhitelist.id)).where(VenueWhitelist.status == "active")
        .group_by(VenueWhitelist.venue_id)
    )).all())
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
    )).all())
    pend = dict((await db.execute(
        select(Shift.venue_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(func.lower(ShiftRequest.status).in_(PENDING), Shift.end_time > now, func.upper(Shift.status) != "CANCELLED")
        .group_by(Shift.venue_id)
    )).all())
    positions = dict((await db.execute(
        select(VenuePosition.venue_id, func.count(VenuePosition.id)).where(VenuePosition.is_active == True)
        .group_by(VenuePosition.venue_id)
    )).all())
    locations = dict((await db.execute(
        select(VenueLocation.venue_id, func.count(VenueLocation.id)).where(VenueLocation.is_archived == False)
        .group_by(VenueLocation.venue_id)
    )).all())
    last = dict((await db.execute(
        select(VenueActivity.venue_id, func.max(VenueActivity.created_at)).group_by(VenueActivity.venue_id)
    )).all())

    rows = []
    for v in venues:
        warnings = []
        if not managers.get(v.id):
            warnings.append("No manager")
        if not positions.get(v.id):
            warnings.append("No positions set up")
        if not team.get(v.id):
            warnings.append("No team yet")
        rows.append(AdminVenueRow(
            id=v.id, name=v.name, address=v.address, timezone=v.timezone or "America/New_York", created_at=v.created_at,
            managers=managers.get(v.id, []), team_active=int(team.get(v.id, 0)), upcoming_events=int(events.get(v.id, 0)),
            open_spots_7d=int(open7.get(v.id) or 0), pending_requests=int(pend.get(v.id, 0)),
            approval_policy=v.approval_policy or "team_auto", geofence_enabled=bool(v.geofence_enabled),
            positions_count=int(positions.get(v.id, 0)), locations_count=int(locations.get(v.id, 0)),
            last_activity_at=last.get(v.id), warnings=warnings,
        ))
    return rows


# ---------------------------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------------------------
@router.get("/directory", response_model=AdminUserPage)
async def directory(
    q: str = Query("", max_length=100),
    role: str = Query("all", pattern="^(all|worker|venue_manager|platform_admin)$"),
    status: str = Query("all", pattern="^(all|active|inactive)$"),
    auth: str = Query("all", pattern="^(all|local|firebase|both)$"),
    venue_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    conds = []
    term = (q or "").strip().lower()
    if term:
        like = f"%{term}%"
        conds.append(or_(
            func.lower(func.concat(User.first_name, " ", User.last_name)).like(like),
            func.lower(User.email).like(like),
            func.coalesce(User.phone, "").like(like),
        ))
    if role != "all":
        roles = ("platform_admin", "super_admin") if role == "platform_admin" else (role,)
        conds.append(func.lower(User.role).in_(roles))
    if status == "active":
        conds.append(User.is_active == True)
    elif status == "inactive":
        conds.append(User.is_active == False)
    if auth == "local":
        conds += [User.hashed_password.isnot(None), User.firebase_uid.is_(None)]
    elif auth == "firebase":
        conds += [User.firebase_uid.isnot(None), User.hashed_password.is_(None)]
    elif auth == "both":
        conds += [User.firebase_uid.isnot(None), User.hashed_password.isnot(None)]
    if venue_id is not None:
        conds.append(or_(
            User.id.in_(select(VenueManager.user_id).where(VenueManager.venue_id == venue_id)),
            User.id.in_(select(VenueWhitelist.worker_id).where(VenueWhitelist.venue_id == venue_id)),
            User.id.in_(select(ShiftRequest.worker_id).join(Shift, Shift.id == ShiftRequest.shift_id).where(Shift.venue_id == venue_id)),
        ))
    total = int(await db.scalar(select(func.count(User.id)).where(*conds)) or 0)
    users = (await db.execute(
        select(User).where(*conds).order_by(User.created_at.desc(), User.email).offset(offset).limit(limit)
    )).scalars().all()
    return AdminUserPage(total=total, items=await _user_rows(db, list(users)))


@router.get("/users/{user_id}/detail", response_model=AdminUserDetail)
async def user_detail(user_id: UUID, current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    row = (await _user_rows(db, [user]))[0]
    rel = (await compute_reliability(db, [user.id])).get(user.id)
    prefs = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
    hist = (await db.execute(
        select(ShiftRequest, Shift, Venue.name).join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .where(ShiftRequest.worker_id == user.id).order_by(Shift.start_time.desc()).limit(20)
    )).all()
    event_ids = {s.event_id for _, s, _ in hist if s.event_id}
    titles = {e.id: e.title for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    history = [
        AdminHistoryItem(
            request_id=r.id, venue_id=s.venue_id, venue_name=vn, event_id=s.event_id,
            title=titles.get(s.event_id) or s.title or "Shift", role_type=s.role_type or "Worker",
            start_time=s.start_time, end_time=s.end_time, status=(r.status or "").lower(),
        )
        for r, s, vn in hist
    ]
    audit = await _audit_items(db, (
        select(AdminAudit).where(AdminAudit.target_type == "user", AdminAudit.target_id == user.id)
        .order_by(AdminAudit.created_at.desc()).limit(15)
    ))
    return AdminUserDetail(
        user=row,
        reliability=WorkerReliability(worker_id=user.id, **rel) if rel else None,
        email_enabled=bool(prefs.email_enabled) if prefs else True,
        sms_enabled=bool(prefs.sms_enabled) if prefs else False,
        history=history, audit=audit,
    )


# ---------------------------------------------------------------------------------------------
# Activity + audit
# ---------------------------------------------------------------------------------------------
@router.get("/activity", response_model=List[AdminActivityItem])
async def all_activity(
    venue_id: Optional[UUID] = Query(None),
    category: Optional[str] = Query(None),
    before: Optional[datetime] = Query(None),
    limit: int = Query(40, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if category and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(CATEGORIES)}.")
    q = select(VenueActivity, Venue.name).join(Venue, Venue.id == VenueActivity.venue_id)
    if venue_id is not None:
        q = q.where(VenueActivity.venue_id == venue_id)
    if category:
        q = q.where(VenueActivity.category == category)
    if before is not None:
        q = q.where(VenueActivity.created_at < before)
    return await _activity_items(db, q.order_by(VenueActivity.created_at.desc()).limit(limit))


@router.get("/audit", response_model=List[AdminAuditItem])
async def audit_log(
    target_type: Optional[str] = Query(None, pattern="^(user|venue|system)$"),
    target_id: Optional[UUID] = Query(None),
    before: Optional[datetime] = Query(None),
    limit: int = Query(40, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdminAudit)
    if target_type:
        q = q.where(AdminAudit.target_type == target_type)
    if target_id is not None:
        q = q.where(AdminAudit.target_id == target_id)
    if before is not None:
        q = q.where(AdminAudit.created_at < before)
    return await _audit_items(db, q.order_by(AdminAudit.created_at.desc()).limit(limit))


# ---------------------------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------------------------
async def _delivery_stats(db: AsyncSession) -> AdminDeliveryStats:
    now = datetime.now(timezone.utc)

    async def count(*conds):
        return int(await db.scalar(select(func.count(NotificationDelivery.id)).where(*conds)) or 0)

    return AdminDeliveryStats(
        pending=await count(NotificationDelivery.status == "pending"),
        sent_24h=await count(NotificationDelivery.status == "sent", NotificationDelivery.sent_at >= now - timedelta(hours=24)),
        failed_24h=await count(NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(hours=24)),
        failed_7d=await count(NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(days=7)),
        skipped_24h=await count(NotificationDelivery.status == "skipped", NotificationDelivery.created_at >= now - timedelta(hours=24)),
    )


@router.get("/system", response_model=AdminSystem)
async def system_status(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.services.notification_worker import WORKER_STATE, HEARTBEAT_KEY
    firebase = "off"
    try:
        import src.services.firebase as firebase_service
        if settings.USE_MOCK_FIREBASE:
            firebase = "mock"
        elif firebase_service.load_firebase_web_config() is not None:
            firebase = "real"
    except Exception:
        firebase = "off"

    heartbeat = None
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(settings.REDIS_URL, socket_timeout=2)
        raw = await client.get(HEARTBEAT_KEY)
        await client.aclose()
        if raw:
            heartbeat = datetime.fromisoformat(raw.decode() if isinstance(raw, bytes) else raw)
    except Exception:
        heartbeat = None

    counts = {}
    for label, model in (
        ("users", User), ("venues", Venue), ("events", ShiftEvent), ("shifts", Shift), ("requests", ShiftRequest),
        ("time_entries", TimeEntry), ("notifications", Notification), ("venue_activity", VenueActivity),
    ):
        counts[label] = int(await db.scalar(select(func.count()).select_from(model)) or 0)

    return AdminSystem(
        app_base_url=settings.APP_BASE_URL or "", app_base_url_ok=_base_url_ok(),
        email_provider=(settings.EMAIL_PROVIDER or "console").lower(), email_from=settings.EMAIL_FROM or "",
        email_ready=email_available(), sms_provider=(settings.SMS_PROVIDER or "off").lower(), sms_ready=sms_available(),
        firebase=firebase, self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
        always_admin_count=len(get_always_admin_emails()),
        worker_enabled=bool(settings.NOTIFICATIONS_WORKER_ENABLED),
        worker_started_at=WORKER_STATE.get("started_at"), worker_last_tick_at=WORKER_STATE.get("last_tick_at"),
        worker_last_ok=WORKER_STATE.get("last_ok"), worker_last_error=WORKER_STATE.get("last_error"),
        worker_heartbeat_at=heartbeat, digest_hour=int(settings.NOTIFICATIONS_DIGEST_HOUR),
        deliveries=await _delivery_stats(db), table_counts=counts,
    )


@router.get("/deliveries", response_model=List[AdminDelivery])
async def deliveries(
    status: str = Query("failed", pattern="^(failed|pending|sent|skipped)$"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(NotificationDelivery, Notification.title, User)
        .join(Notification, Notification.id == NotificationDelivery.notification_id)
        .join(User, User.id == NotificationDelivery.user_id)
        .where(NotificationDelivery.status == status)
        .order_by(NotificationDelivery.created_at.desc()).limit(limit)
    )).all()
    return [
        AdminDelivery(
            id=d.id, channel=d.channel, status=d.status, attempts=d.attempts or 0, last_error=d.last_error,
            created_at=d.created_at, send_after=d.send_after, user_id=u.id, user_name=_name(u), user_email=u.email,
            title=title or "",
        )
        for d, title, u in rows
    ]


@router.post("/deliveries/{delivery_id}/retry")
async def retry_delivery(delivery_id: UUID, current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    d = await db.scalar(select(NotificationDelivery).where(NotificationDelivery.id == delivery_id))
    if d is None:
        raise HTTPException(status_code=404, detail="Delivery not found.")
    if d.status != "failed":
        raise HTTPException(status_code=400, detail="Only failed deliveries can be retried.")
    try:
        d.status = "pending"
        d.attempts = 0
        d.last_error = None
        d.send_after = datetime.now(timezone.utc)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not queue the retry: {e}")
    await admin_audit.record(current_user.id, "delivery_retry", f"Retried a failed {d.channel} delivery", target_type="system")
    return {"detail": "Queued. It goes out on the next worker tick (within a minute)."}


@router.post("/deliveries/retry-failed")
async def retry_all_failed(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    try:
        res = await db.execute(
            update(NotificationDelivery)
            .where(NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(days=7))
            .values(status="pending", attempts=0, last_error=None, send_after=now)
        )
        n = int(res.rowcount or 0)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not queue the retries: {e}")
    if n:
        await admin_audit.record(current_user.id, "delivery_retry", f"Retried {n} failed deliveries", target_type="system")
    return {"detail": f"Queued {n} failed deliver{'y' if n == 1 else 'ies'} from the last 7 days.", "count": n}


@router.post("/test-email")
async def test_email(body: AdminTestEmail, current_user: User = Depends(require_admin)):
    to = str(body.to).strip()
    title = "ShiftBoard test email"
    text, html_body = render_email(title, f"Sent by {_name(current_user)} from the admin System page. If you can read this, email works.", "/", "/")
    ok, err = await send_email(to, title, text, html_body)
    await admin_audit.record(current_user.id, "test_email", f"Sent a test email to {to}: {'ok' if ok else 'failed'}", target_type="system")
    if not ok:
        raise HTTPException(status_code=502, detail=f"Sending failed: {err}")
    note = "" if email_available() else " (console mode: it was only written to the backend log)"
    return {"detail": f"Sent to {to}{note}."}
```

---

## B3. `backend/src/routers/admin.py` (EDITS)
Temp-password create, editable email, blank phone clears it, and an audit line after each commit.

**Edit 1.** Find:
```python
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email

router = APIRouter(prefix="/api/admin", tags=["Admin"])
```
Replace with:
```python
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email
from src.services import admin_audit

router = APIRouter(prefix="/api/admin", tags=["Admin"])
```

**Edit 2.** Find:
```python
            )

        # 2. Hash password
        hashed = get_password_hash(user_in.password)

        # 3. Create user
```
Replace with:
```python
            )

        # 2. Hash password (Phase 29.2: blank = generate a temporary one, returned once)
        generated_pw = None
        raw_pw = (user_in.password or "").strip()
        if not raw_pw:
            generated_pw = _generate_temp_password()
            raw_pw = generated_pw
        elif len(raw_pw) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
        hashed = get_password_hash(raw_pw)

        # 3. Create user
```

**Edit 3.** Find:
```python

    await db.refresh(new_user)
    return _build_user_response(new_user, venue_ids, venue_names)

@router.patch("/users/{user_id}", response_model=UserResponse)
```
Replace with:
```python

    await db.refresh(new_user)
    resp = _build_user_response(new_user, venue_ids, venue_names)
    resp.temporary_password = generated_pw
    await admin_audit.record(
        current_user.id, "user_created",
        f"Created {role_clean.replace('_', ' ')} {admin_audit.person(new_user)}"
        + (f" for {', '.join(venue_names)}" if venue_names else ""),
        target_type="user", target_id=new_user.id,
    )
    return resp

@router.patch("/users/{user_id}", response_model=UserResponse)
```

**Edit 4.** Find:
```python

        old_role = normalize_role(user.role)
        new_role = normalize_role(user_update.role) if user_update.role is not None else old_role
        if new_role not in VALID_ROLES:
```
Replace with:
```python

        old_role = normalize_role(user.role)
        old_active = bool(user.is_active)
        old_email = user.email
        new_role = normalize_role(user_update.role) if user_update.role is not None else old_role
        if new_role not in VALID_ROLES:
```

**Edit 5.** Find:
```python
            user.last_name = user_update.last_name.strip()
        if user_update.phone is not None:
            user.phone = user_update.phone.strip()

        if rebuild_venues:
```
Replace with:
```python
            user.last_name = user_update.last_name.strip()
        if user_update.phone is not None:
            user.phone = user_update.phone.strip() or None      # Phase 29.2: blank clears it
        if user_update.email is not None:                     # Phase 29.2
            new_email = str(user_update.email).strip().lower()
            if new_email != (user.email or "").lower():
                if is_always_admin_email(user.email):
                    raise HTTPException(status_code=400, detail="This account is listed in ALWAYS_ADMIN_EMAILS; its email can't be changed here.")
                taken = await db.scalar(select(User.id).where(func.lower(User.email) == new_email, User.id != user.id))
                if taken:
                    raise HTTPException(status_code=400, detail=f"Another account already uses {new_email}.")
                user.email = new_email

        if rebuild_venues:
```

**Edit 6.** Find:
```python

    await db.refresh(user)

    # Build affiliations
```
Replace with:
```python

    await db.refresh(user)

    # Phase 29.2: audit what changed
    changes = []
    if role_changed:
        changes.append(f"role {old_role.replace('_', ' ')} → {new_role.replace('_', ' ')}")
    if user_update.is_active is not None and bool(user_update.is_active) != old_active:
        changes.append("reactivated" if user_update.is_active else "deactivated")
    if (user.email or "") != (old_email or ""):
        changes.append(f"email {old_email} → {user.email}")
    if rebuild_venues and not role_changed:
        changes.append("venues updated")
    if any(v is not None for v in (user_update.first_name, user_update.last_name, user_update.phone)):
        changes.append("profile edited")
    if changes:
        action = "user_role" if role_changed else ("user_status" if user_update.is_active is not None and bool(user_update.is_active) != old_active else "user_updated")
        await admin_audit.record(current_user.id, action, f"{admin_audit.person(user)}: {', '.join(changes)}",
                                 target_type="user", target_id=user.id)

    # Build affiliations
```

**Edit 7.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {str(e)}")

    return AdminPasswordResetResponse(
        user_id=user.id,
```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {str(e)}")

    await admin_audit.record(current_user.id, "user_password",
                             f"Reset the password for {admin_audit.person(user)}", target_type="user", target_id=user.id)   # Phase 29.2
    return AdminPasswordResetResponse(
        user_id=user.id,
```

**Edit 8.** Find:
```python

        # Core delete — do NOT use db.delete(user) (lazy-load -> MissingGreenlet)
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
    return None

```
Replace with:
```python

        # Core delete — do NOT use db.delete(user) (lazy-load -> MissingGreenlet)
        who = admin_audit.person(user)                    # Phase 29.2 (read before delete)
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
    await admin_audit.record(current_user.id, "user_deleted", f"Deleted {who}", target_type="user", target_id=user_id)
    return None

```

---

## B4. `backend/src/routers/venues.py` (EDITS)
Venue create is audited; **delete** needs `confirm_name`, protects payroll history, and deletes with a `delete(Venue)` statement so the database cascades run. Do not switch it to `db.delete(venue)`: that loads relationships and fails with MissingGreenlet.

**Edit 1.** Find:
```python
from src.services.locations import load_locations
from src.services import activity

router = APIRouter(prefix="/api/venues", tags=["Venues"])
```
Replace with:
```python
from src.services.locations import load_locations
from src.services import activity
from src.services import admin_audit

router = APIRouter(prefix="/api/venues", tags=["Venues"])
```

**Edit 2.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Failed to create venue: {str(e)}")

    return venue

```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Failed to create venue: {str(e)}")

    await admin_audit.record(current_user.id, "venue_created", f"Created venue {venue.name}",
                             target_type="venue", target_id=venue.id)   # Phase 29.2
    return venue

```

**Edit 3.** Find:
```python
async def delete_venue(
    venue_id: UUID,
    current_user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete a venue (Super Admin only)"""
    result = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    await db.delete(venue)
    await db.commit()

@router.get("/{venue_id}/export-hours")
```
Replace with:
```python
async def delete_venue(
    venue_id: UUID,
    confirm_name: str = Query("", description="Phase 29.2: must equal the venue's name"),
    delete_history: bool = Query(False, description="Phase 29.2: also allowed when the venue has time entries (payroll)"),
    current_user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a venue (Super Admin only). Everything at the venue goes with it (events, shifts,
    bookings, time entries, invites, activity) through ON DELETE CASCADE.
    Phase 29.2 safety: the caller must type the venue name, and a venue with payroll history
    (time entries) needs delete_history=true.
    """
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    name = venue.name
    if (confirm_name or "").strip().lower() != (name or "").strip().lower():
        raise HTTPException(status_code=400, detail=f"Type the venue name exactly ({name}) to delete it.")
    te_count = int(await db.scalar(
        select(func.count(TimeEntry.id)).join(Shift, Shift.id == TimeEntry.shift_id).where(Shift.venue_id == venue_id)
    ) or 0)
    if te_count and not delete_history:
        raise HTTPException(
            status_code=409,
            detail=f"{name} has {te_count} time entries (payroll history). Download its payroll CSV first, then confirm deleting the history too.",
        )
    try:
        # Core delete with DB cascades. Do NOT use db.delete(venue) (lazy-loads relationships -> MissingGreenlet).
        await db.execute(delete(Venue).where(Venue.id == venue_id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete venue: {str(e)}")
    await admin_audit.record(current_user.id, "venue_deleted",
                             f"Deleted venue {name}" + (f" and {te_count} time entries" if te_count else ""),
                             target_type="venue", target_id=venue_id)

@router.get("/{venue_id}/export-hours")
```

---

## B5. `backend/src/services/notification_worker.py` (EDITS)
`WORKER_STATE` + a Redis heartbeat after each tick. The tick logic itself is unchanged.

**Edit 1.** Find:
```python


async def _acquire_lock():
    """Returns (redis_client or None, got_lock: bool)."""
```
Replace with:
```python


# Phase 29.2: health for the admin System page (this process) + a Redis heartbeat (any process)
WORKER_STATE = {"started_at": None, "last_tick_at": None, "last_ok": None, "last_error": None, "ticks": 0}
HEARTBEAT_KEY = "shiftboard:notification-worker:last-tick"


async def _acquire_lock():
    """Returns (redis_client or None, got_lock: bool)."""
```

**Edit 2.** Find:
```python
async def notification_worker_loop() -> None:
    logger.info("Notification worker started.")
    await asyncio.sleep(10)   # let startup/seed finish
    while True:
```
Replace with:
```python
async def notification_worker_loop() -> None:
    logger.info("Notification worker started.")
    WORKER_STATE["started_at"] = datetime.now(timezone.utc)
    await asyncio.sleep(10)   # let startup/seed finish
    while True:
```

**Edit 3.** Find:
```python
            if got:
                await run_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("notification worker tick failed")
        finally:
```
Replace with:
```python
            if got:
                await run_tick()
                now = datetime.now(timezone.utc)
                WORKER_STATE.update(last_tick_at=now, last_ok=True, last_error=None, ticks=WORKER_STATE["ticks"] + 1)
                if client is not None:
                    try:
                        await client.set(HEARTBEAT_KEY, now.isoformat(), ex=3600)
                    except Exception:
                        pass
        except asyncio.CancelledError:
            raise
        except Exception as e:
            WORKER_STATE.update(last_tick_at=datetime.now(timezone.utc), last_ok=False, last_error=str(e)[:300])
            logger.exception("notification worker tick failed")
        finally:
```

---

## B6. `backend/src/main.py` (EDITS)
Router import + `include_router` only. **Do not touch the CORS block.**

**Edit 1.** Find:
```python
from src.routers.staffing import router as staffing_router
from src.routers.activity import router as activity_router
from src.services.notification_worker import notification_worker_loop

```
Replace with:
```python
from src.routers.staffing import router as staffing_router
from src.routers.activity import router as activity_router
from src.routers.admin_console import router as admin_console_router
from src.services.notification_worker import notification_worker_loop

```

**Edit 2.** Find:
```python
app.include_router(staffing_router)
app.include_router(activity_router)


```
Replace with:
```python
app.include_router(staffing_router)
app.include_router(activity_router)
app.include_router(admin_console_router)


```

---

# PART C: Frontend

All new admin components live in a new folder: `frontend/src/components/admin/`.

## C1. NEW FILE `frontend/src/components/admin/adminUi.jsx`
Shared styles, badges, `Drawer` (uses `useModalLayer`, so Esc closes only the top layer), `TypeToConfirm`, `CopyButton`, and `openVenueAsManager()`.

```jsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, KeyRound, Flame, AlertTriangle, Check, AlertCircle } from 'lucide-react';
import ModalShell from '../ModalShell';
import { useModalLayer } from '../modalLayer';

/** Phase 29.2: Small shared pieces for the admin console. */

export const card = 'bg-slate-900 border border-slate-800 rounded-2xl shadow-xl';
export const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500';
export const selectCls =
  'px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500';
export const btnGhost =
  'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50';
export const btnPrimary =
  'px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';
export const btnDanger =
  'px-3 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';

export const ROLE_LABEL = { worker: 'Worker', venue_manager: 'Venue manager', platform_admin: 'Platform admin' };
const ROLE_CLS = {
  worker: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
  venue_manager: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  platform_admin: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
};
export const POLICY_LABEL = {
  team_auto: 'Team books instantly',
  manual: 'Manager approves all',
  everyone_auto: 'Anyone books instantly',
};

export function personName(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || p?.email || 'Unknown';
}

export function ago(value) {
  if (!value) return 'never';
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function RoleBadge({ role }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${ROLE_CLS[role] || ROLE_CLS.worker}`}>
      {ROLE_LABEL[role] || role}
    </span>
  );
}

export function AuthBadge({ source }) {
  if (source === 'firebase') {
    return (
      <span title="Signs in with Firebase (Google, email link…)" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
        <Flame className="w-3 h-3" /> Firebase
      </span>
    );
  }
  if (source === 'both') {
    return (
      <span title="Has a ShiftBoard password and is linked to Firebase" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
        <KeyRound className="w-3 h-3" /> Password + <Flame className="w-3 h-3 text-amber-300" />
      </span>
    );
  }
  return (
    <span title="Signs in with a ShiftBoard password" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/50">
      <KeyRound className="w-3 h-3" /> Password
    </span>
  );
}

export function StatTile({ label, value, sub, tone = 'text-white', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 ${onClick ? 'hover:border-slate-600 transition' : ''}`}>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-black mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </Tag>
  );
}

export function SectionTitle({ icon: Icon, title, right, tone = 'text-indigo-400' }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${tone}`} />}
        <h2 className="text-sm font-bold text-white truncate">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/** A dismissable success/error banner. */
export function Flash({ flash, onClose }) {
  useEffect(() => {
    if (!flash || flash.type === 'error') return undefined;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [flash, onClose]);
  if (!flash) return null;
  const ok = flash.type !== 'error';
  return (
    <div className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-sm ${
      ok ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200' : 'bg-rose-950/80 border-rose-700 text-rose-200'}`}>
      <span className="flex items-start gap-2">
        {ok ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
        {flash.message}
      </span>
      <button type="button" onClick={onClose} className="text-xs underline flex-shrink-0">Dismiss</button>
    </div>
  );
}

/** A right-hand side panel (Esc and backdrop close it). */
export function Drawer({ title, subtitle, onClose, children, footer }) {
  useModalLayer(onClose);
  return createPortal(
    <div className="fixed inset-0 z-[55] flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/70" />
      <aside role="dialog" aria-modal="true"
        className="relative w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white truncate">{title}</h3>
            {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap justify-end gap-2">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Confirm a dangerous action by typing a word (usually the name).
 * onConfirm(extra) may throw; the error is shown. `children` renders extra options above the input.
 */
export function TypeToConfirm({ title, message, word, confirmLabel = 'Delete', onConfirm, onClose, children }) {
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const match = typed.trim().toLowerCase() === (word || '').trim().toLowerCase();

  const submit = async () => {
    if (!match) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm();
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
      icon={<AlertTriangle className="w-5 h-5 text-rose-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Go back</button>
          <button type="button" onClick={submit} disabled={!match || saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40">
            {saving ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        {message && <div className="text-sm text-slate-300">{message}</div>}
        {children}
        <label className="block text-xs text-slate-400">
          Type <span className="font-bold text-white">{word}</span> to confirm
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} className={`${inputCls} mt-1`} />
        </label>
      </div>
    </ModalShell>
  );
}

/** Copy-to-clipboard button that flips to "Copied". */
export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={btnGhost}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text is visible to copy by hand */
        }
      }}>
      {done ? <Check className="w-3 h-3" /> : null}{done ? 'Copied' : label}
    </button>
  );
}

/** Switch the manager dashboard to a venue (platform admins) and go there. */
export function openVenueAsManager(navigate, venueId) {
  try {
    localStorage.setItem('shiftboard_admin_venue_id', venueId);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venueId }));
  navigate(`/venue?venue=${venueId}`);
}

/** Tell the navbar's venue switcher to reload its list (after create/delete). */
export function venuesChanged() {
  window.dispatchEvent(new CustomEvent('admin_venues_changed'));
}
```

---

## C2. NEW FILE `frontend/src/components/admin/AdminOverview.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, AlertOctagon, Info, ChevronRight, History, ShieldCheck, RefreshCw, CheckCircle2,
} from 'lucide-react';
import api from '../../api/client';
import { card, StatTile, SectionTitle, ago, btnGhost } from './adminUi';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const LEVEL = {
  error: [AlertOctagon, 'text-rose-400', 'border-rose-500/30 bg-rose-500/5'],
  warn: [AlertTriangle, 'text-amber-400', 'border-amber-500/30 bg-amber-500/5'],
  info: [Info, 'text-sky-400', 'border-sky-500/30 bg-sky-500/5'],
};

/**
 * Phase 29.2: Admin home. GET /admin/overview.
 * Props: refreshKey, onTab(tab), onOpenVenue(venueId), onOpenUser(userId)
 */
export default function AdminOverview({ refreshKey = 0, onTab, onOpenVenue }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/overview');
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>;

  const openAttention = (a) => {
    if (a.kind === 'venue' && a.target_id) onOpenVenue(a.target_id);
    else if (a.kind === 'deliveries' || a.kind === 'system') onTab('system');
    else if (a.kind === 'users') onTab('users');
  };

  return (
    <div className="space-y-6">
      <section className={`${card} p-4`}>
        <SectionTitle
          icon={AlertTriangle}
          tone="text-amber-400"
          title="Needs attention"
          right={(
            <button type="button" onClick={load} disabled={loading} className={btnGhost}>
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          )}
        />
        {data.attention.length === 0 ? (
          <p className="text-sm text-emerald-300 flex items-center gap-2 py-2">
            <CheckCircle2 className="w-4 h-4" /> Nothing needs you right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.attention.map((a, i) => {
              const [Icon, tone, box] = LEVEL[a.level] || LEVEL.info;
              return (
                <li key={i}>
                  <button type="button" onClick={() => openAttention(a)}
                    className={`w-full text-left px-3 py-2 rounded-xl border flex items-center gap-2 hover:brightness-125 ${box}`}>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${tone}`} />
                    <span className="text-sm text-slate-200 flex-1">{a.text}</span>
                    <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile
          label="People"
          value={data.users_total}
          sub={`${plural(data.workers, 'worker')} · ${plural(data.managers, 'manager')} · ${plural(data.admins, 'admin')}`}
          onClick={() => onTab('users')}
        />
        <StatTile
          label="Venues"
          value={data.venues}
          sub={`${data.events_next_7d} event${data.events_next_7d === 1 ? '' : 's'} in the next 7 days`}
          tone="text-emerald-400"
          onClick={() => onTab('venues')}
        />
        <StatTile
          label="Staffed, next 7 days"
          value={data.fill_rate_next_7d == null ? '—' : `${Math.round(data.fill_rate_next_7d)}%`}
          sub={data.spots_next_7d ? `${data.open_spots_next_7d} of ${data.spots_next_7d} spots still open` : 'No shifts posted'}
          tone={data.fill_rate_next_7d == null ? 'text-slate-400' : data.fill_rate_next_7d >= 90 ? 'text-emerald-400' : data.fill_rate_next_7d >= 60 ? 'text-amber-400' : 'text-rose-400'}
        />
        <StatTile
          label="Waiting on managers"
          value={data.pending_requests + data.pending_handoffs}
          sub={`${data.pending_requests} request${data.pending_requests === 1 ? '' : 's'} · ${data.pending_handoffs} hand-off${data.pending_handoffs === 1 ? '' : 's'}${data.stale_requests_24h ? ` · ${data.stale_requests_24h} over 24 h` : ''}`}
          tone={data.stale_requests_24h ? 'text-amber-400' : 'text-white'}
        />
        <StatTile
          label="Emails & texts, 24 h"
          value={data.deliveries_sent_24h}
          sub={data.deliveries_failed_24h ? `${data.deliveries_failed_24h} failed` : 'None failed'}
          tone={data.deliveries_failed_24h ? 'text-rose-400' : 'text-white'}
          onClick={() => onTab('system')}
        />
      </div>
      {(data.deactivated > 0 || data.new_users_7d > 0) && (
        <p className="text-xs text-slate-500 -mt-3">
          {data.new_users_7d} new account{data.new_users_7d === 1 ? '' : 's'} this week
          {data.deactivated > 0 && ` · ${data.deactivated} deactivated`}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className={`${card} p-4 lg:col-span-2`}>
          <SectionTitle
            icon={History}
            tone="text-amber-400"
            title="Latest at venues"
            right={<button type="button" onClick={() => onTab('activity')} className="text-xs text-indigo-300 hover:text-indigo-200">See all</button>}
          />
          {data.recent_activity.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No venue activity yet.</p>
          ) : (
            <ol className="divide-y divide-slate-800">
              {data.recent_activity.map((a) => (
                <li key={a.id} className="py-2 text-xs">
                  <div className="text-slate-200">{a.summary}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    <span className="text-emerald-300/80 font-semibold">{a.venue_name}</span>
                    {a.actor_name ? ` · by ${a.actor_name}` : ''} · {ago(a.created_at)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={`${card} p-4`}>
          <SectionTitle
            icon={ShieldCheck}
            title="Admin actions"
            right={<button type="button" onClick={() => onTab('activity', { log: 'admin' })} className="text-xs text-indigo-300 hover:text-indigo-200">See all</button>}
          />
          {data.recent_audit.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No admin changes recorded yet.</p>
          ) : (
            <ol className="divide-y divide-slate-800">
              {data.recent_audit.map((a) => (
                <li key={a.id} className="py-2 text-xs">
                  <div className="text-slate-200">{a.summary}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{ago(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
```

---

## C3. NEW FILE `frontend/src/components/admin/AdminVenues.jsx`
Default export: the Venues tab. Named export `AdminVenueDrawer`. It reuses `VenueSettingsModal`, `TeamModal` and `ActivityFeed` unchanged.

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Plus, Search, ExternalLink, Settings, Users, AlertTriangle, MapPin, ShieldCheck, Trash2, UserCog,
  CalendarDays, Clock, Crosshair,
} from 'lucide-react';
import api from '../../api/client';
import VenueSettingsModal from '../VenueSettingsModal';
import TeamModal from '../TeamModal';
import ActivityFeed from '../ActivityFeed';
import {
  card, inputCls, btnGhost, btnPrimary, btnDanger, POLICY_LABEL, ago, Drawer, TypeToConfirm, openVenueAsManager,
  venuesChanged,
} from './adminUi';

function Num({ value, warn = false }) {
  return (
    <span className={`font-mono font-bold ${value === 0 ? 'text-slate-600' : warn ? 'text-amber-300' : 'text-slate-100'}`}>{value}</span>
  );
}

/**
 * Phase 29.2: Venues tab. GET /admin/venues/summary (+ /admin/venues for the full records the settings modal edits).
 * Props: refreshKey, onOpenVenue(id), onCreate(), onChanged()
 */
export default function AdminVenues({ refreshKey = 0, onOpenVenue, onCreate }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/admin/venues/summary')
      .then((res) => active && setRows(res.data || []))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load venues.'));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!rows) return [];
    if (!t) return rows;
    return rows.filter((v) =>
      v.name.toLowerCase().includes(t) || (v.address || '').toLowerCase().includes(t)
      || v.managers.some((m) => m.name.toLowerCase().includes(t) || (m.email || '').toLowerCase().includes(t)));
  }, [rows, q]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!rows) return <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>;

  return (
    <section className={card}>
      <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search venues, addresses or managers"
            className={`${inputCls} pl-9`} />
        </div>
        <span className="text-xs text-slate-500 sm:ml-auto">{rows.length} venue{rows.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={onCreate} className={btnPrimary}>
          <Plus className="w-4 h-4" /> New venue
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">{rows.length ? 'No venues match.' : 'No venues yet. Create the first one.'}</p>
      ) : (
        <>
        <ul className="md:hidden divide-y divide-slate-800/60">
          {shown.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onOpenVenue(v.id)} className="w-full text-left px-4 py-3 hover:bg-slate-800/30 space-y-1">
                <span className="font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-emerald-400" /> {v.name}</span>
                <span className="block text-[11px] text-slate-500 truncate">{v.address}</span>
                <span className="block text-[11px] text-slate-300">
                  {v.managers.length ? v.managers.map((m) => m.name).join(', ') : 'No manager'} · {v.team_active} on team · {v.open_spots_7d} open this week · {v.pending_requests} waiting
                </span>
                {v.warnings.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {v.warnings.map((w) => (
                      <span key={w} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">{w}</span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Venue</th>
                <th className="py-2.5 px-3">Managers</th>
                <th className="py-2.5 px-3 text-center" title="Active team members">Team</th>
                <th className="py-2.5 px-3 text-center" title="Events in the next 30 days">Events 30d</th>
                <th className="py-2.5 px-3 text-center" title="Unfilled spots on shifts in the next 7 days">Open 7d</th>
                <th className="py-2.5 px-3 text-center" title="Requests waiting for a manager">Waiting</th>
                <th className="py-2.5 px-3">Booking</th>
                <th className="py-2.5 px-3">Clock-in</th>
                <th className="py-2.5 px-3">Last activity</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {shown.map((v) => (
                <tr key={v.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => onOpenVenue(v.id)}>
                  <td className="py-3 px-4 min-w-[14rem]">
                    <div className="font-bold text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> {v.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">{v.address}</div>
                    {v.warnings.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {v.warnings.map((w) => (
                          <span key={w} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold inline-flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" /> {w}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {v.managers.length === 0 ? <span className="text-slate-600">None</span> : (
                      <div className="space-y-0.5">
                        {v.managers.slice(0, 2).map((m) => <div key={m.user_id} className="text-slate-200 truncate max-w-[10rem]">{m.name}</div>)}
                        {v.managers.length > 2 && <div className="text-slate-500">+{v.managers.length - 2} more</div>}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center"><Num value={v.team_active} /></td>
                  <td className="py-3 px-3 text-center"><Num value={v.upcoming_events} /></td>
                  <td className="py-3 px-3 text-center"><Num value={v.open_spots_7d} warn /></td>
                  <td className="py-3 px-3 text-center"><Num value={v.pending_requests} warn /></td>
                  <td className="py-3 px-3 whitespace-nowrap">{POLICY_LABEL[v.approval_policy] || v.approval_policy}</td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {v.geofence_enabled
                      ? <span className="text-emerald-300 inline-flex items-center gap-1"><Crosshair className="w-3 h-3" /> On site only</span>
                      : <span className="text-slate-500">Anywhere</span>}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-slate-400">{ago(v.last_activity_at)}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => openVenueAsManager(navigate, v.id)} className={btnGhost} title="Open this venue's manager dashboard">
                      <ExternalLink className="w-3 h-3" /> Dashboard
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className="text-sm text-white font-semibold mt-0.5">{children}</div>
    </div>
  );
}

/**
 * Phase 29.2: Everything about one venue for an admin: health, managers, settings, team, activity,
 * admin changes, and a safe delete.
 * Props: venueId, onClose, onOpenUser(userId), onChanged(message?), onDeleted(message)
 */
export function AdminVenueDrawer({ venueId, onClose, onOpenUser, onChanged, onDeleted }) {
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [full, setFull] = useState(null);
  const [positions, setPositions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState(null); // 'settings' | 'team' | 'delete'
  const [deleteHistory, setDeleteHistory] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/admin/venues/summary'),
      api.get('/admin/venues'),
      api.get(`/venues/${venueId}/positions`).catch(() => ({ data: [] })),
      api.get('/admin/audit', { params: { target_type: 'venue', target_id: venueId, limit: 10 } }).catch(() => ({ data: [] })),
    ])
      .then(([sum, all, pos, au]) => {
        if (!active) return;
        const r = (sum.data || []).find((v) => v.id === venueId);
        if (!r) {
          setError('This venue no longer exists.');
          return;
        }
        setRow(r);
        setFull((all.data || []).find((v) => v.id === venueId) || null);
        setPositions(pos.data || []);
        setAudit(au.data || []);
      })
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load this venue.'));
    return () => {
      active = false;
    };
  }, [venueId, reload]);

  const doDelete = async () => {
    await api.delete(`/venues/${venueId}`, { params: { confirm_name: row.name, delete_history: deleteHistory } });
    venuesChanged();
    try {
      if (localStorage.getItem('shiftboard_admin_venue_id') === venueId) localStorage.removeItem('shiftboard_admin_venue_id');
    } catch {
      /* ignore */
    }
    onDeleted(`Deleted ${row.name}.`);
  };

  return (
    <Drawer
      title={row?.name || 'Venue'}
      subtitle={row ? <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{row.address}</span> : null}
      onClose={onClose}
      footer={row && (
        <>
          <button type="button" onClick={() => setModal('team')} className={btnGhost}><Users className="w-3 h-3" /> Team</button>
          <button type="button" onClick={() => setModal('settings')} disabled={!full} className={btnGhost}><Settings className="w-3 h-3" /> Settings</button>
          <button type="button" onClick={() => openVenueAsManager(navigate, venueId)} className={btnPrimary}>
            <ExternalLink className="w-3.5 h-3.5" /> Open dashboard
          </button>
        </>
      )}
    >
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!row && !error && <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>}
      {row && (
        <>
          {row.warnings.length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-sm text-amber-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{row.warnings.join(' · ')}</span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Fact icon={Users} label="Team">{row.team_active} active</Fact>
            <Fact icon={CalendarDays} label="Events, 30 days">{row.upcoming_events}</Fact>
            <Fact icon={AlertTriangle} label="Open spots, 7 days">{row.open_spots_7d}</Fact>
            <Fact icon={Clock} label="Requests waiting">{row.pending_requests}</Fact>
            <Fact label="Booking">{POLICY_LABEL[row.approval_policy] || row.approval_policy}</Fact>
            <Fact icon={Crosshair} label="Clock-in">
              {row.geofence_enabled ? `On site (${full?.geofence_radius_meters ?? '?'} m)` : 'Anywhere'}
            </Fact>
            <Fact label="Positions">{row.positions_count}</Fact>
            <Fact label="Locations">{row.locations_count}</Fact>
            <Fact label="Time zone">{row.timezone}</Fact>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <UserCog className="w-3 h-3" /> Managers
            </div>
            {row.managers.length === 0 ? (
              <p className="text-xs text-slate-500">
                No manager yet. Create one on the Users tab (role: Venue manager) or change someone's role there.
              </p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {row.managers.map((m) => (
                  <button key={m.user_id} type="button" onClick={() => onOpenUser(m.user_id)}
                    className="w-full text-left px-3 py-2 bg-slate-950 hover:bg-slate-800/60 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-100 font-semibold">{m.name}</span>
                    <span className="text-slate-500 truncate">{m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <ActivityFeed venueId={venueId} refreshKey={reload} onOpenWorker={onOpenUser} />

          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Admin changes
            </div>
            {audit.length === 0 ? (
              <p className="text-xs text-slate-500">None recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {audit.map((a) => (
                  <li key={a.id} className="text-slate-300">
                    {a.summary} <span className="text-slate-500">· {ago(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/5">
            <div className="text-sm font-bold text-rose-300">Delete this venue</div>
            <p className="text-xs text-slate-400 mt-1">
              Removes the venue with its events, shifts, team, invites and activity. People's accounts stay.
              Created {new Date(row.created_at).toLocaleDateString()}.
            </p>
            <button type="button" onClick={() => setModal('delete')} className={`${btnDanger} mt-2`}>
              <Trash2 className="w-3 h-3" /> Delete venue…
            </button>
          </div>
        </>
      )}

      {modal === 'settings' && full && (
        <VenueSettingsModal
          mode="edit"
          venue={full}
          onClose={() => {
            setModal(null);
            setReload((n) => n + 1);
          }}
          onSaved={(saved) => {
            setModal(null);
            setReload((n) => n + 1);
            venuesChanged();
            onChanged(`Saved settings for ${saved.name}.`);
          }}
        />
      )}
      {modal === 'team' && (
        <TeamModal
          venue={full || { id: venueId, name: row?.name }}
          positions={positions}
          timeZone={row?.timezone}
          onClose={() => {
            setModal(null);
            setReload((n) => n + 1);
          }}
          onChanged={() => setReload((n) => n + 1)}
        />
      )}
      {modal === 'delete' && row && (
        <TypeToConfirm
          title={`Delete ${row.name}?`}
          word={row.name}
          confirmLabel="Delete venue"
          message={(
            <p>
              This can't be undone. {row.upcoming_events > 0 && <b className="text-rose-300">{row.upcoming_events} upcoming event{row.upcoming_events === 1 ? '' : 's'} will be removed and booked people won't be told. </b>}
              If people have clocked in here, you must also delete the payroll history (export time sheets first).
            </p>
          )}
          onConfirm={doDelete}
          onClose={() => {
            setModal(null);
            setDeleteHistory(false);
          }}
        >
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={deleteHistory} onChange={(e) => setDeleteHistory(e.target.checked)} className="mt-0.5" />
            Also delete clock-ins and time sheets (payroll history) for this venue
          </label>
        </TypeToConfirm>
      )}
    </Drawer>
  );
}
```

---

## C4. NEW FILE `frontend/src/components/admin/AdminUsers.jsx`

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, ChevronLeft, ChevronRight, Star, Copy as CopyIcon } from 'lucide-react';
import api from '../../api/client';
import { Avatar } from '../WorkerProfilePanel';
import { card, inputCls, selectCls, btnGhost, btnPrimary, RoleBadge, AuthBadge, ago, personName } from './adminUi';

const PAGE = 25;
const MEMBER_CLS = {
  active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  worked: 'bg-slate-800 text-slate-300 border-slate-700',
  removed: 'bg-slate-800 text-slate-500 border-slate-700 line-through',
  blocked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};
const MEMBER_TITLE = {
  active: 'On the team',
  worked: 'Worked here (not on the team)',
  removed: 'Removed from the team',
  blocked: 'Blocked by the venue',
};

/** Venue chips for one person: what they manage, then the teams they're on / have worked for. */
export function VenueChips({ row, max = 3 }) {
  const chips = [
    ...row.managed_venues.map((v) => ({ key: `m-${v.id}`, label: v.name, cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', title: 'Manages' })),
    ...row.memberships.map((m) => ({ key: `w-${m.venue_id}`, label: m.venue_name, cls: MEMBER_CLS[m.status] || MEMBER_CLS.worked, title: MEMBER_TITLE[m.status] || m.status })),
  ];
  if (chips.length === 0) return <span className="text-[11px] text-slate-600">No venues yet</span>;
  return (
    <div className="flex flex-wrap gap-1 max-w-[16rem]">
      {chips.slice(0, max).map((c) => (
        <span key={c.key} title={c.title} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold truncate max-w-[9rem] ${c.cls}`}>{c.label}</span>
      ))}
      {chips.length > max && <span className="text-[10px] text-slate-500 self-center">+{chips.length - max}</span>}
    </div>
  );
}

/**
 * Phase 29.2: Users tab. Server-side search, filters and paging: GET /admin/directory.
 * Props: refreshKey, venues ([{id, name}]), onOpenUser(id), onCreate()
 */
export default function AdminUsers({ refreshKey = 0, venues = [], onOpenUser, onCreate }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [auth, setAuth] = useState('all');
  const [venueId, setVenueId] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(0);
  }, [debounced, role, status, auth, venueId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get('/admin/directory', {
        params: {
          q: debounced || undefined, role, status, auth, venue_id: venueId || undefined, limit: PAGE, offset: page * PAGE,
        },
      })
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load people.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [debounced, role, status, auth, venueId, page, refreshKey]);

  // Same full name as another account on this page (often a Firebase sign-up next to an admin-made account).
  const dupes = useMemo(() => {
    const seen = {};
    data.items.forEach((u) => {
      const k = personName(u).toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
    });
    return seen;
  }, [data.items]);

  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const filtered = debounced || role !== 'all' || status !== 'all' || auth !== 'all' || venueId;

  return (
    <section className={card}>
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone"
              className={`${inputCls} pl-9`} />
          </div>
          <span className="text-xs text-slate-500 sm:ml-auto">{loading ? 'Loading…' : `${data.total} ${data.total === 1 ? 'person' : 'people'}`}</span>
          <button type="button" onClick={onCreate} className={btnPrimary}>
            <UserPlus className="w-4 h-4" /> New user
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={selectCls} aria-label="Role">
            <option value="all">All roles</option>
            <option value="worker">Workers</option>
            <option value="venue_manager">Venue managers</option>
            <option value="platform_admin">Platform admins</option>
          </select>
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={selectCls} aria-label="Venue">
            <option value="">All venues</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
            <option value="all">Active and deactivated</option>
            <option value="active">Active only</option>
            <option value="inactive">Deactivated only</option>
          </select>
          <select value={auth} onChange={(e) => setAuth(e.target.value)} className={selectCls} aria-label="Sign-in">
            <option value="all">Any sign-in</option>
            <option value="local">Password only</option>
            <option value="firebase">Firebase only</option>
            <option value="both">Password + Firebase</option>
          </select>
          {filtered && (
            <button type="button" className={btnGhost}
              onClick={() => { setQ(''); setRole('all'); setStatus('all'); setAuth('all'); setVenueId(''); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose-300 p-6">{error}</p>
      ) : data.items.length === 0 && !loading ? (
        <p className="text-sm text-slate-500 py-12 text-center">{filtered ? 'Nobody matches these filters.' : 'No accounts yet.'}</p>
      ) : (
        <>
        <ul className={`md:hidden divide-y divide-slate-800/60 ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onOpenUser(u.id)} className="w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-800/30">
                <Avatar person={u} size="w-9 h-9 text-xs" />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-sm font-bold ${u.is_active ? 'text-white' : 'text-slate-500 line-through'}`}>{personName(u)}</span>
                    <RoleBadge role={u.role} />
                    {!u.is_active && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">Deactivated</span>}
                    {dupes[personName(u).toLowerCase()] > 1 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">Same name</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">{u.email}</span>
                  <VenueChips row={u} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Person</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Venues</th>
                <th className="py-2.5 px-3 text-center" title="Finished shifts · upcoming bookings">Shifts</th>
                <th className="py-2.5 px-3">Rating</th>
                <th className="py-2.5 px-3">Sign-in</th>
                <th className="py-2.5 px-3">Last request</th>
                <th className="py-2.5 px-3">Joined</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-slate-800/60 ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((u) => (
                <tr key={u.id} onClick={() => onOpenUser(u.id)} className="hover:bg-slate-800/30 cursor-pointer">
                  <td className="py-2.5 px-4 min-w-[15rem]">
                    <div className="flex items-center gap-2.5">
                      <Avatar person={u} size="w-8 h-8 text-xs" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-bold ${u.is_active ? 'text-white' : 'text-slate-500 line-through'}`}>{personName(u)}</span>
                          {!u.is_active && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">Deactivated</span>}
                          {dupes[personName(u).toLowerCase()] > 1 && (
                            <span title="Another account on this page has the same name" className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold inline-flex items-center gap-0.5">
                              <CopyIcon className="w-2.5 h-2.5" /> Same name
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[16rem]">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3"><RoleBadge role={u.role} /></td>
                  <td className="py-2.5 px-3"><VenueChips row={u} /></td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={u.shifts_worked ? 'text-slate-100 font-bold' : 'text-slate-600'}>{u.shifts_worked}</span>
                    {u.upcoming > 0 && <span className="text-emerald-300"> · {u.upcoming}</span>}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {u.rating_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-slate-200">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {Number(u.aggregate_rating).toFixed(1)}
                        <span className="text-slate-500">({u.rating_count})</span>
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-2.5 px-3"><AuthBadge source={u.auth_source} /></td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">{u.last_activity_at ? ago(u.last_activity_at) : '—'}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {data.total > PAGE && (
        <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            {page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={btnGhost}>
              <ChevronLeft className="w-3 h-3" /> Previous
            </button>
            <span>Page {page + 1} of {pages}</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className={btnGhost}>
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

---

## C5. NEW FILE `frontend/src/components/admin/AdminUserDrawer.jsx`
Reuses `ResetPasswordModal`, `ReliabilityBadge` and `Avatar` (from `WorkerProfilePanel.jsx`) unchanged.

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Save, KeyRound, Power, Trash2, ShieldCheck, Building2, CalendarClock, Bell, Mail, Phone, Lock, StickyNote,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import ResetPasswordModal from '../ResetPasswordModal';
import ReliabilityBadge from '../ReliabilityBadge';
import { Avatar } from '../WorkerProfilePanel';
import {
  inputCls, selectCls, btnGhost, btnPrimary, btnDanger, RoleBadge, AuthBadge, ROLE_LABEL, ago, personName, Drawer,
  TypeToConfirm,
} from './adminUi';

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
const MEMBER_LABEL = {
  active: ['On team', 'text-emerald-300'],
  worked: ['Worked here', 'text-slate-300'],
  removed: ['Removed', 'text-slate-500'],
  blocked: ['Blocked', 'text-rose-300'],
};
const DISCOVER_LABEL = {
  private: 'Private (only venues they work with)',
  venues: 'Findable by venue managers',
  everyone: 'Findable by everyone',
};

function Label({ children }) {
  return <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">{children}</div>;
}

function initialVenueIds(u) {
  if (!u) return [];
  if (u.role === 'venue_manager') return u.managed_venues.map((v) => String(v.id));
  if (u.role === 'worker') return u.memberships.filter((m) => m.status === 'active').map((m) => String(m.venue_id));
  return [];
}

/**
 * Phase 29.2: One person, everything an admin can see and change.
 * GET /admin/users/{id}/detail · PATCH /admin/users/{id} · reset password · deactivate · delete.
 * Props: userId, venues ([{id, name}]), onClose, onChanged(message), onDeleted(message)
 */
export default function AdminUserDrawer({ userId, venues = [], onClose, onChanged, onDeleted }) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [modal, setModal] = useState(null); // 'reset' | 'delete'

  useEffect(() => {
    let active = true;
    setError('');
    api
      .get(`/admin/users/${userId}/detail`)
      .then((res) => {
        if (!active) return;
        setData(res.data);
        const u = res.data.user;
        setForm({
          first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '', role: u.role,
          venue_ids: initialVenueIds(u),
        });
      })
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load this person.'));
    return () => {
      active = false;
    };
  }, [userId, reload]);

  const u = data?.user;
  const isMe = u && String(u.id) === String(me?.id);

  const payload = useMemo(() => {
    if (!u || !form) return {};
    const p = {};
    if (form.first_name.trim() !== u.first_name) p.first_name = form.first_name.trim();
    if (form.last_name.trim() !== u.last_name) p.last_name = form.last_name.trim();
    if (form.email.trim().toLowerCase() !== (u.email || '').toLowerCase()) p.email = form.email.trim();
    if ((form.phone || '').trim() !== (u.phone || '')) p.phone = form.phone.trim();
    if (form.role !== u.role) p.role = form.role;
    const before = [...initialVenueIds(u)].sort().join(',');
    const after = [...form.venue_ids].sort().join(',');
    if (p.role || before !== after) p.venue_ids = form.role === 'platform_admin' ? [] : form.venue_ids;
    return p;
  }, [u, form]);
  const dirty = Object.keys(payload).length > 0;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleVenue = (id) =>
    setForm((f) => ({ ...f, venue_ids: f.venue_ids.includes(id) ? f.venue_ids.filter((x) => x !== id) : [...f.venue_ids, id] }));

  const save = async () => {
    setFormError('');
    if (!form.first_name.trim() || !form.email.trim()) return setFormError('First name and email are required.');
    if (form.role === 'venue_manager' && form.venue_ids.length === 0) return setFormError('Pick at least one venue for a venue manager.');
    setSaving(true);
    try {
      await api.patch(`/admin/users/${userId}`, payload);
      setReload((n) => n + 1);
      onChanged(`Saved ${form.first_name.trim()} ${form.last_name.trim()}.${payload.role ? ' They see the new role next time they sign in or refresh.' : ''}`);
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
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

  const doDelete = async () => {
    await api.delete(`/admin/users/${userId}`);
    onDeleted(`Deleted ${u.email}.`);
  };

  const venueLabel = form?.role === 'venue_manager' ? 'Manages' : form?.role === 'worker' ? "On these venues' teams" : null;

  return (
    <Drawer
      title={u ? personName(u) : 'Person'}
      subtitle={u && (
        <span className="flex flex-wrap items-center gap-1.5 mt-1">
          <RoleBadge role={u.role} />
          <AuthBadge source={u.auth_source} />
          {!u.is_active && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">Deactivated</span>}
          {u.always_admin && <span title="Listed in ALWAYS_ADMIN_EMAILS" className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold inline-flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" /> Always admin</span>}
          {isMe && <span className="text-[10px] text-slate-500">(you)</span>}
        </span>
      )}
      onClose={onClose}
      footer={u && (
        <button type="button" onClick={save} disabled={!dirty || saving} className={btnPrimary}>
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
        </button>
      )}
    >
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!u && !error && <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>}
      {u && form && (
        <>
          <div className="flex items-center gap-3">
            <Avatar person={u} size="w-12 h-12 text-base" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Worked</div>
                <div className="text-sm text-white font-semibold">{u.shifts_worked}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Upcoming</div>
                <div className="text-sm text-white font-semibold">{u.upcoming}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Rating</div>
                <div className="text-sm text-white font-semibold">{u.rating_count ? `${Number(u.aggregate_rating).toFixed(1)} (${u.rating_count})` : '—'}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Reliability</div>
                <div className="text-sm text-white font-semibold"><ReliabilityBadge data={data.reliability} /></div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Details</Label>
            {formError && <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{formError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-slate-400">First name
                <input value={form.first_name} onChange={set('first_name')} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-slate-400">Last name
                <input value={form.last_name} onChange={set('last_name')} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-slate-400">Email
                <input type="email" value={form.email} onChange={set('email')} disabled={u.always_admin}
                  className={`${inputCls} mt-1 disabled:opacity-50`} />
                {u.auth_source !== 'local' && payload.email && (
                  <span className="block text-[11px] text-amber-300 mt-1">They sign in with Firebase; this only changes where ShiftBoard emails go.</span>
                )}
              </label>
              <label className="text-xs text-slate-400">Phone
                <input value={form.phone} onChange={set('phone')} className={`${inputCls} mt-1`} placeholder="For texts" />
              </label>
              <label className="text-xs text-slate-400">Role
                <select value={form.role} onChange={set('role')} disabled={isMe || u.always_admin} className={`${selectCls} w-full mt-1 disabled:opacity-50`}>
                  {Object.entries(ROLE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                {(isMe || u.always_admin) && <span className="block text-[11px] text-slate-500 mt-1">{isMe ? "You can't change your own role." : 'Always-admin accounts stay admins.'}</span>}
              </label>
            </div>
            {venueLabel && (
              <div>
                <div className="text-xs text-slate-400 mb-1">{venueLabel}</div>
                {venues.length === 0 ? <p className="text-xs text-slate-500">No venues yet.</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {venues.map((v) => {
                      const on = form.venue_ids.includes(String(v.id));
                      return (
                        <button key={v.id} type="button" onClick={() => toggleVenue(String(v.id))}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${on ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                          {v.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {form.role === 'worker' && (
                  <p className="text-[11px] text-slate-500 mt-1">Unticking removes them from that team. Team notes, positions and blocks set by managers are kept.</p>
                )}
                {payload.role && u.role !== form.role && (
                  <p className="text-[11px] text-amber-300 mt-1">Changing the role replaces their venue links with the ones picked here.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label><Building2 className="w-3 h-3" /> Venues</Label>
            {u.managed_venues.length === 0 && u.memberships.length === 0 ? (
              <p className="text-xs text-slate-500">Not connected to any venue.</p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {u.managed_venues.map((v) => (
                  <div key={`m-${v.id}`} className="px-3 py-2 bg-slate-950 flex items-center justify-between text-xs">
                    <span className="text-slate-100 font-semibold">{v.name}</span>
                    <span className="text-amber-300 font-semibold">Manager</span>
                  </div>
                ))}
                {u.memberships.map((m) => {
                  const [label, cls] = MEMBER_LABEL[m.status] || [m.status, 'text-slate-300'];
                  return (
                    <div key={`w-${m.venue_id}`} className="px-3 py-2 bg-slate-950 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-100 font-semibold">{m.venue_name}</span>
                        <span className={`font-semibold ${cls}`}>{label}</span>
                      </div>
                      {m.positions.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {m.positions.map((p) => <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold uppercase">{p}</span>)}
                        </div>
                      )}
                      {m.notes && (
                        <div className="text-[11px] text-amber-100 flex gap-1"><StickyNote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" /> {m.notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Label><CalendarClock className="w-3 h-3" /> Recent shifts</Label>
            {data.history.length === 0 ? (
              <p className="text-xs text-slate-500">No shift requests yet.</p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {data.history.map((h) => {
                  const [label, cls] = HISTORY_LABEL[h.status] || [h.status, 'text-slate-300'];
                  return (
                    <div key={h.request_id} className="px-3 py-2 bg-slate-950 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-slate-400 w-20 flex-shrink-0">{new Date(h.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      <span className="flex-1 min-w-[10rem] text-slate-100">
                        <span className="font-semibold">{h.role_type}</span> · {h.title}
                        <span className="text-slate-500"> · {h.venue_name}</span>
                      </span>
                      <span className={`font-semibold ${cls}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Label><Bell className="w-3 h-3" /> Their settings</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-400" /> Emails {data.email_enabled ? <b className="text-emerald-300">on</b> : <b className="text-slate-500">off</b>}
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> Texts {data.sms_enabled ? <b className="text-emerald-300">on</b> : <b className="text-slate-500">off</b>}
                {data.sms_enabled && !u.phone && <span className="text-amber-300">(no phone)</span>}
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                {DISCOVER_LABEL[u.discoverable] || u.discoverable}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Joined {new Date(u.created_at).toLocaleDateString()} · last request {u.last_activity_at ? ago(u.last_activity_at) : 'never'}
            </p>
          </div>

          <div>
            <Label><ShieldCheck className="w-3 h-3" /> Admin changes</Label>
            {data.audit.length === 0 ? <p className="text-xs text-slate-500">None recorded.</p> : (
              <ul className="space-y-1 text-xs">
                {data.audit.map((a) => (
                  <li key={a.id} className="text-slate-300">
                    {a.summary} <span className="text-slate-500">· {ago(a.created_at)}{a.actor_name ? ` · ${a.actor_name}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!isMe && (
            <div className="p-3 rounded-xl border border-slate-700 bg-slate-950 space-y-2">
              <div className="text-sm font-bold text-white">Account</div>
              <div className="flex flex-wrap gap-2">
                {u.has_password ? (
                  <button type="button" onClick={() => setModal('reset')} className={btnGhost}><KeyRound className="w-3 h-3" /> Reset password</button>
                ) : (
                  <span className="text-[11px] text-slate-500 self-center">Signs in with Firebase only, so there is no ShiftBoard password to reset.</span>
                )}
                {!u.always_admin && (
                  <button type="button" onClick={toggleActive} className={u.is_active ? btnDanger : btnGhost}>
                    <Power className="w-3 h-3" /> {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
                {!u.always_admin && (
                  <button type="button" onClick={() => setModal('delete')} className={btnDanger}><Trash2 className="w-3 h-3" /> Delete…</button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Deactivating blocks sign-in and keeps their history. Delete is only allowed for people with no clock-ins.
              </p>
            </div>
          )}
        </>
      )}

      {modal === 'reset' && u && (
        <ResetPasswordModal
          user={u}
          onClose={() => setModal(null)}
          onDone={() => {
            setReload((n) => n + 1);
            onChanged(`Password reset for ${u.email}.`);
          }}
        />
      )}
      {modal === 'delete' && u && (
        <TypeToConfirm
          title={`Delete ${personName(u)}?`}
          word={u.email}
          confirmLabel="Delete account"
          message={<p>This removes the account, their requests and team memberships. It can't be undone. If they've ever clocked in, deactivate them instead.</p>}
          onConfirm={doDelete}
          onClose={() => setModal(null)}
        />
      )}
    </Drawer>
  );
}
```

---

## C6. NEW FILE `frontend/src/components/admin/AdminCreateUserModal.jsx`

```jsx
import React, { useState } from 'react';
import { UserPlus, KeyRound, CheckCircle2 } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { inputCls, selectCls, btnGhost, ROLE_LABEL, CopyButton } from './adminUi';

/**
 * Phase 29.2: Create an account. By default the server generates a temporary password and returns it once.
 * POST /admin/users {email, first_name, last_name, phone, role, venue_ids, password?}
 * Props: venues ([{id, name}]), onClose, onCreated(user) (called when the admin closes the result screen or opens the profile),
 *        onOpenUser(id)
 */
export default function AdminCreateUserModal({ venues = [], onClose, onCreated, onOpenUser }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', role: 'worker' });
  const [venueIds, setVenueIds] = useState([]);
  const [pwMode, setPwMode] = useState('generate'); // generate | custom
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (id) => setVenueIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!form.first_name.trim() || !form.email.trim()) return setError('First name and email are required.');
    if (form.role === 'venue_manager' && venueIds.length === 0) return setError('Pick at least one venue for a venue manager.');
    if (pwMode === 'custom' && password.length < 8) return setError('Password must be at least 8 characters.');
    setSaving(true);
    try {
      const res = await api.post('/admin/users', {
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role,
        venue_ids: form.role === 'platform_admin' ? [] : venueIds,
        password: pwMode === 'custom' ? password : undefined,
      });
      setCreated(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create the account.');
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    onCreated(created);
    onClose();
  };

  if (created) {
    const loginUrl = `${window.location.origin}/login`;
    const share = created.temporary_password
      ? `Your ShiftBoard account is ready.\nSign in at ${loginUrl}\nEmail: ${created.email}\nTemporary password: ${created.temporary_password}\nPlease change it after you sign in.`
      : null;
    return (
      <ModalShell
        title="Account created"
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
        onClose={finish}
        maxWidth="max-w-md"
        footer={(
          <>
            <button type="button" onClick={() => { finish(); onOpenUser(created.id); }} className={btnGhost}>Open profile</button>
            <button type="button" onClick={finish} className="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950">Done</button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            <b className="text-white">{created.first_name} {created.last_name}</b> ({created.email}) is set up as a {ROLE_LABEL[(created.role || '').toLowerCase()] || created.role}.
          </p>
          {created.temporary_password ? (
            <>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Temporary password (shown once)</div>
                <div className="font-mono text-lg text-emerald-300 mt-1 break-all">{created.temporary_password}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={created.temporary_password} label="Copy password" />
                <CopyButton text={share} label="Copy sign-in message" />
              </div>
              <p className="text-xs text-slate-500">Send it to them yourself. ShiftBoard doesn't email passwords.</p>
            </>
          ) : (
            <p className="text-xs text-slate-500">They sign in with the password you set.</p>
          )}
        </div>
      </ModalShell>
    );
  }

  const venueLabel = form.role === 'venue_manager' ? 'Manages (at least one)' : form.role === 'worker' ? "Add to these venues' teams (optional)" : null;

  return (
    <ModalShell
      title="New user"
      icon={<UserPlus className="w-5 h-5 text-indigo-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">First name
            <input autoFocus value={form.first_name} onChange={set('first_name')} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-slate-400">Last name
            <input value={form.last_name} onChange={set('last_name')} className={`${inputCls} mt-1`} />
          </label>
        </div>
        <label className="block text-xs text-slate-400">Email
          <input type="email" value={form.email} onChange={set('email')} className={`${inputCls} mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">Phone (optional)
            <input value={form.phone} onChange={set('phone')} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-slate-400">Role
            <select value={form.role} onChange={set('role')} className={`${selectCls} w-full mt-1`}>
              {Object.entries(ROLE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
        {venueLabel && (
          <div>
            <div className="text-xs text-slate-400 mb-1">{venueLabel}</div>
            {venues.length === 0 ? <p className="text-xs text-slate-500">No venues yet.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {venues.map((v) => {
                  const on = venueIds.includes(v.id);
                  return (
                    <button key={v.id} type="button" onClick={() => toggle(v.id)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${on ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                      {v.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div>
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><KeyRound className="w-3 h-3" /> Password</div>
          <div className="flex gap-2">
            {[['generate', 'Generate a temporary one'], ['custom', 'Set one now']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPwMode(id)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${pwMode === id ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {label}
              </button>
            ))}
          </div>
          {pwMode === 'custom' && (
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
              className={`${inputCls} mt-2`} autoComplete="new-password" />
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          Tip: to let someone sign up themselves and join a team, use the venue's Team → Invite instead.
        </p>
      </form>
    </ModalShell>
  );
}
```

---

## C7. NEW FILE `frontend/src/components/admin/AdminActivity.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, ShieldCheck, CalendarCheck, UserPlus, Users, PencilLine, AlertTriangle, ChevronRight, Building2, Server,
  UserRound,
} from 'lucide-react';
import api from '../../api/client';
import { card, selectCls, btnGhost, ago, fmtDateTime } from './adminUi';

const CATS = [
  { id: '', label: 'All' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'staffing', label: 'Staffing' },
  { id: 'team', label: 'Team' },
  { id: 'changes', label: 'Changes' },
  { id: 'alerts', label: 'Alerts' },
];
const CAT_ICON = {
  bookings: [CalendarCheck, 'text-emerald-400'],
  staffing: [UserPlus, 'text-indigo-300'],
  team: [Users, 'text-sky-300'],
  changes: [PencilLine, 'text-amber-300'],
  alerts: [AlertTriangle, 'text-rose-400'],
};
const TARGETS = [
  { id: '', label: 'All' },
  { id: 'user', label: 'People' },
  { id: 'venue', label: 'Venues' },
  { id: 'system', label: 'System' },
];
const TARGET_ICON = { user: UserRound, venue: Building2, system: Server };
const PAGE = 40;

function Chips({ items, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((f) => (
        <button key={f.id || 'all'} type="button" onClick={() => onChange(f.id)}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${
            value === f.id ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** Loads a newest-first list with "Load more" (before=<last created_at>). */
function usePaged(url, params, refreshKey) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const key = JSON.stringify(params);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(url, { params: { ...params, limit: PAGE } })
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
  }, [url, key, refreshKey]);

  const loadMore = async () => {
    if (!items.length) return;
    setLoading(true);
    try {
      const res = await api.get(url, { params: { ...params, limit: PAGE, before: items[items.length - 1].created_at } });
      setItems((prev) => [...prev, ...(res.data || [])]);
      setMore((res.data || []).length === PAGE);
    } finally {
      setLoading(false);
    }
  };
  return { items, loading, more, loadMore };
}

/**
 * Phase 29.2: Activity tab. Venue activity across every venue (GET /admin/activity) or the admin change log (GET /admin/audit).
 * Props: refreshKey, venues ([{id, name}]), initialLog ('venues' | 'admin'), onOpenUser(id), onOpenVenue(id)
 */
export default function AdminActivity({ refreshKey = 0, venues = [], initialLog = 'venues', onOpenUser, onOpenVenue }) {
  const navigate = useNavigate();
  const [log, setLog] = useState(initialLog);
  const [venueId, setVenueId] = useState('');
  const [cat, setCat] = useState('');
  const [target, setTarget] = useState('');

  useEffect(() => setLog(initialLog), [initialLog]);

  const act = usePaged('/admin/activity', { venue_id: venueId || undefined, category: cat || undefined }, `${refreshKey}-${log}`);
  const aud = usePaged('/admin/audit', { target_type: target || undefined }, `${refreshKey}-${log}`);
  const list = log === 'venues' ? act : aud;
  const venueIds = new Set(venues.map((v) => String(v.id)));

  const openActivity = (a) => {
    if (a.event_id) {
      try {
        localStorage.setItem('shiftboard_admin_venue_id', a.venue_id);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: a.venue_id }));
      navigate(`/venue?venue=${a.venue_id}&event=${a.event_id}`);
    } else if (a.worker_id) {
      onOpenUser(a.worker_id);
    } else {
      onOpenVenue(a.venue_id);
    }
  };

  const openAudit = (a) => {
    if (a.target_type === 'user' && a.target_id && !a.action.endsWith('_deleted')) onOpenUser(a.target_id);
    else if (a.target_type === 'venue' && a.target_id && venueIds.has(String(a.target_id))) onOpenVenue(a.target_id);
  };

  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1">
          <button type="button" onClick={() => setLog('venues')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${log === 'venues' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <History className="w-3.5 h-3.5" /> Venue activity
          </button>
          <button type="button" onClick={() => setLog('admin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${log === 'admin' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <ShieldCheck className="w-3.5 h-3.5" /> Admin changes
          </button>
        </div>
        {log === 'venues' ? (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={selectCls} aria-label="Venue">
              <option value="">All venues</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <Chips items={CATS} value={cat} onChange={setCat} />
          </div>
        ) : (
          <div className="sm:ml-auto"><Chips items={TARGETS} value={target} onChange={setTarget} /></div>
        )}
      </div>

      {list.loading && list.items.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>
      ) : list.items.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">
          {log === 'venues' ? 'Nothing here yet.' : 'No admin changes recorded yet. Changes made from this console show up here.'}
        </p>
      ) : (
        <ol className="divide-y divide-slate-800">
          {log === 'venues'
            ? list.items.map((a) => {
              const [Icon, tone] = CAT_ICON[a.category] || CAT_ICON.changes;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => openActivity(a)} className="w-full text-left py-2.5 px-1 flex gap-3 hover:bg-slate-800/40 rounded-lg">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-200">{a.summary}</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        <span className="text-emerald-300/80 font-semibold">{a.venue_name}</span>
                        {a.actor_name ? ` · by ${a.actor_name}` : ''} · <span title={fmtDateTime(a.created_at)}>{ago(a.created_at)}</span>
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                  </button>
                </li>
              );
            })
            : list.items.map((a) => {
              const Icon = TARGET_ICON[a.target_type] || Server;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => openAudit(a)} className="w-full text-left py-2.5 px-1 flex gap-3 hover:bg-slate-800/40 rounded-lg">
                    <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-indigo-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-200">{a.summary}</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        {a.actor_name || 'Unknown admin'} · {fmtDateTime(a.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
        </ol>
      )}
      {list.more && (
        <button type="button" onClick={list.loadMore} disabled={list.loading} className={`${btnGhost} w-full justify-center mt-3 py-2`}>
          {list.loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
```

---

## C8. NEW FILE `frontend/src/components/admin/AdminSystem.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import {
  Settings2, CheckCircle2, AlertTriangle, XCircle, Activity, Mail, RefreshCw, Send, Database, RotateCcw,
} from 'lucide-react';
import api from '../../api/client';
import { card, inputCls, btnGhost, btnPrimary, SectionTitle, ago, fmtDateTime } from './adminUi';

function Row({ state, label, children }) {
  const [Icon, tone] = state === 'ok' ? [CheckCircle2, 'text-emerald-400'] : state === 'bad' ? [XCircle, 'text-rose-400'] : [AlertTriangle, 'text-amber-400'];
  return (
    <div className="py-2.5 flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white font-semibold">{label}</div>
        <div className="text-xs text-slate-400 mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

/**
 * Phase 29.2: System tab. GET /admin/system, GET /admin/deliveries, retry, test email.
 * Props: refreshKey, onFlash({type, message})
 */
export default function AdminSystem({ refreshKey = 0, onFlash }) {
  const [sys, setSys] = useState(null);
  const [failed, setFailed] = useState([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([api.get('/admin/system'), api.get('/admin/deliveries', { params: { status: 'failed', limit: 25 } })])
      .then(([s, d]) => {
        if (!active) return;
        setSys(s.data);
        setFailed(d.data || []);
      })
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load system status.'));
    return () => {
      active = false;
    };
  }, [refreshKey, reload]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const res = await fn();
      onFlash({ type: 'success', message: res.data?.detail || 'Done.' });
      setReload((n) => n + 1);
    } catch (err) {
      onFlash({ type: 'error', message: err.response?.data?.detail || 'That did not work.' });
    } finally {
      setBusy('');
    }
  };

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!sys) return <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>;

  const beat = sys.worker_heartbeat_at ? new Date(sys.worker_heartbeat_at) : null;
  const beatFresh = beat && Date.now() - beat.getTime() < 3 * 60 * 1000;
  const workerState = !sys.worker_enabled ? 'warn' : beatFresh && sys.worker_last_ok !== false ? 'ok' : 'bad';
  const d = sys.deliveries;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className={`${card} p-4`}>
          <SectionTitle
            icon={Settings2}
            title="Configuration"
            right={(
              <button type="button" onClick={() => setReload((n) => n + 1)} className={btnGhost}>
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            )}
          />
          <div className="divide-y divide-slate-800">
            <Row state={sys.app_base_url_ok ? 'ok' : 'bad'} label="Public address (APP_BASE_URL)">
              {sys.app_base_url || 'Not set'}{!sys.app_base_url_ok && ' · links in emails, texts and invites will not open for people.'}
            </Row>
            <Row state={sys.email_ready ? 'ok' : 'warn'} label="Email">
              {sys.email_ready ? `${sys.email_provider.toUpperCase()} from ${sys.email_from}` : `Console mode: emails are only written to the backend log (provider "${sys.email_provider}").`}
            </Row>
            <Row state={sys.sms_ready && sys.sms_provider !== 'console' ? 'ok' : 'warn'} label="Text messages">
              {sys.sms_provider === 'console'
                ? 'Console mode: texts are only written to the backend log.'
                : sys.sms_ready ? `Sending with ${sys.sms_provider}` : `Not sending (provider "${sys.sms_provider}"). People only get emails and in-app notifications.`}
            </Row>
            <Row state={sys.firebase === 'real' ? 'ok' : 'warn'} label="Google / Firebase sign-in">
              {sys.firebase === 'real' ? 'On' : sys.firebase === 'mock' ? 'Mock mode (testing only)' : 'Off: people sign in with a ShiftBoard password only'}
            </Row>
            <Row state="ok" label="Self sign-up">
              {sys.self_registration ? 'Anyone can create a worker account.' : 'Off: only admins and invites create accounts.'}
            </Row>
            <Row state={sys.always_admin_count ? 'ok' : 'warn'} label="Always-admin accounts">
              {sys.always_admin_count} listed in ALWAYS_ADMIN_EMAILS{sys.always_admin_count ? '' : ' (add one so you can never be locked out)'}
            </Row>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Change these in the backend's secrets file and restart the backend container.</p>
        </section>

        <section className={`${card} p-4`}>
          <SectionTitle icon={Activity} title="Background worker" tone="text-emerald-400" />
          <div className="divide-y divide-slate-800">
            <Row state={workerState} label={!sys.worker_enabled ? 'Turned off' : workerState === 'ok' ? 'Running' : 'Not responding'}>
              {sys.worker_enabled
                ? <>Sends emails and texts, the daily new-shift digest (around {sys.digest_hour}:00 local time), shift reminders and late clock-in alerts.</>
                : 'NOTIFICATIONS_WORKER_ENABLED is false, so no emails, texts, reminders or late alerts go out.'}
            </Row>
            <Row state={beatFresh ? 'ok' : 'warn'} label="Last heartbeat">
              {beat ? `${ago(beat)} (${fmtDateTime(beat)})` : 'None recorded yet (Redis unreachable or the worker has not ticked).'}
            </Row>
            {sys.worker_last_error && (
              <Row state="bad" label="Last error in this process">
                <span className="font-mono">{sys.worker_last_error}</span>
              </Row>
            )}
          </div>
          <div className="grid grid-cols-5 gap-2 mt-3">
            {[
              ['Queued', d.pending, 'text-white'],
              ['Sent 24h', d.sent_24h, 'text-emerald-400'],
              ['Failed 24h', d.failed_24h, d.failed_24h ? 'text-rose-400' : 'text-white'],
              ['Failed 7d', d.failed_7d, d.failed_7d ? 'text-rose-400' : 'text-white'],
              ['Skipped 24h', d.skipped_24h, 'text-slate-400'],
            ].map(([label, value, tone]) => (
              <div key={label} className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold whitespace-nowrap truncate">{label}</div>
                <div className={`text-lg font-black font-mono ${tone}`}>{value}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={`${card} p-4`}>
        <SectionTitle
          icon={XCircle}
          tone="text-rose-400"
          title={`Failed emails & texts (${failed.length})`}
          right={failed.length > 0 && (
            <button type="button" disabled={busy === 'all'} onClick={() => run('all', () => api.post('/admin/deliveries/retry-failed'))} className={btnGhost}>
              <RotateCcw className="w-3 h-3" /> Retry all (last 7 days)
            </button>
          )}
        />
        {failed.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">Nothing failed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Message</th>
                  <th className="py-2 pr-3">Error</th>
                  <th className="py-2 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {failed.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{fmtDateTime(f.created_at)}</td>
                    <td className="py-2 pr-3">
                      <div className="text-slate-100">{f.user_name}</div>
                      <div className="text-[10px] text-slate-500">{f.channel === 'sms' ? 'Text' : 'Email'} · {f.user_email}</div>
                    </td>
                    <td className="py-2 pr-3">{f.title}</td>
                    <td className="py-2 pr-3 font-mono text-rose-300 max-w-xs truncate" title={f.last_error || ''}>{f.last_error || '—'}</td>
                    <td className="py-2 text-right">
                      <button type="button" disabled={busy === f.id} onClick={() => run(f.id, () => api.post(`/admin/deliveries/${f.id}/retry`))} className={btnGhost}>
                        <RotateCcw className="w-3 h-3" /> Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className={`${card} p-4`}>
          <SectionTitle icon={Mail} title="Send a test email" />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (to.trim()) run('test', () => api.post('/admin/test-email', { to: to.trim() }));
            }}
          >
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" className={inputCls} />
            <button type="submit" disabled={busy === 'test' || !to.trim()} className={btnPrimary}>
              <Send className="w-3.5 h-3.5" /> {busy === 'test' ? 'Sending…' : 'Send'}
            </button>
          </form>
          <p className="text-[11px] text-slate-500 mt-2">Uses the same email settings as real notifications, so it proves the whole path works.</p>
        </section>

        <section className={`${card} p-4`}>
          <SectionTitle icon={Database} title="Data" tone="text-slate-400" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(sys.table_counts).map(([k, v]) => (
              <div key={k} className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{k.replace('_', ' ')}</div>
                <div className="text-sm text-white font-mono font-bold">{v.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

---

## C9. `frontend/src/pages/AdminPanel.jsx` (FULL FILE REPLACEMENT)
Replaces the whole 1,053-line Phase 20–25 page. The route in `App.jsx` is unchanged. Note `w-full` on the page root.

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, LayoutDashboard, Building2, Users, History, Server, UserPlus, Plus } from 'lucide-react';
import api from '../api/client';
import VenueSettingsModal from '../components/VenueSettingsModal';
import AdminOverview from '../components/admin/AdminOverview';
import AdminVenues, { AdminVenueDrawer } from '../components/admin/AdminVenues';
import AdminUsers from '../components/admin/AdminUsers';
import AdminUserDrawer from '../components/admin/AdminUserDrawer';
import AdminCreateUserModal from '../components/admin/AdminCreateUserModal';
import AdminActivity from '../components/admin/AdminActivity';
import AdminSystem from '../components/admin/AdminSystem';
import { Flash, venuesChanged } from '../components/admin/adminUi';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'venues', label: 'Venues', icon: Building2 },
  { id: 'users', label: 'People', icon: Users },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'system', label: 'System', icon: Server },
];

/**
 * Phase 29.2: Platform admin console.
 * Tabs (kept in ?tab=): Overview · Venues · People · Activity · System.
 * Venue and person details open in right-hand drawers from any tab.
 */
export default function AdminPanel() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const [logView, setLogView] = useState('venues');
  const [venues, setVenues] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [flash, setFlash] = useState(null);
  const [venueDrawer, setVenueDrawer] = useState(null);
  const [userDrawer, setUserDrawer] = useState(null);
  const [createUser, setCreateUser] = useState(false);
  const [createVenue, setCreateVenue] = useState(false);

  const refresh = () => setRefreshKey((n) => n + 1);
  const clearFlash = useCallback(() => setFlash(null), []);
  const ok = (message) => {
    setFlash({ type: 'success', message });
    refresh();
  };

  useEffect(() => {
    api
      .get('/admin/venues')
      .then((res) => setVenues((res.data || []).map((v) => ({ id: v.id, name: v.name }))))
      .catch(() => setVenues([]));
  }, [refreshKey]);

  const goTab = (id, opts = {}) => {
    if (id === 'activity') setLogView(opts.log || 'venues');
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
                <Shield className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white">Platform admin</h1>
                <p className="text-xs text-slate-400 mt-0.5">Every venue, every account, and the health of the platform.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCreateUser(true)}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white text-xs inline-flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> New user
              </button>
              <button type="button" onClick={() => setCreateVenue(true)}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> New venue
              </button>
            </div>
          </div>
          <nav className="flex gap-1 mt-5 overflow-x-auto -mb-px">
            {TABS.map((t) => {
              const Icon = t.icon;
              const on = tab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => goTab(t.id)}
                  className={`px-3.5 py-2.5 text-sm font-bold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition ${
                    on ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                  <Icon className={`w-4 h-4 ${on ? 'text-indigo-400' : ''}`} /> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-4">
        <Flash flash={flash} onClose={clearFlash} />

        {tab === 'overview' && (
          <AdminOverview refreshKey={refreshKey} onTab={goTab} onOpenVenue={setVenueDrawer} onOpenUser={setUserDrawer} />
        )}
        {tab === 'venues' && (
          <AdminVenues refreshKey={refreshKey} onOpenVenue={setVenueDrawer} onCreate={() => setCreateVenue(true)} />
        )}
        {tab === 'users' && (
          <AdminUsers refreshKey={refreshKey} venues={venues} onOpenUser={setUserDrawer} onCreate={() => setCreateUser(true)} />
        )}
        {tab === 'activity' && (
          <AdminActivity refreshKey={refreshKey} venues={venues} initialLog={logView}
            onOpenUser={setUserDrawer} onOpenVenue={setVenueDrawer} />
        )}
        {tab === 'system' && <AdminSystem refreshKey={refreshKey} onFlash={setFlash} />}
      </main>

      {venueDrawer && (
        <AdminVenueDrawer
          key={venueDrawer}
          venueId={venueDrawer}
          onClose={() => setVenueDrawer(null)}
          onOpenUser={(id) => setUserDrawer(id)}
          onChanged={ok}
          onDeleted={(message) => {
            setVenueDrawer(null);
            ok(message);
          }}
        />
      )}
      {userDrawer && (
        <AdminUserDrawer
          key={userDrawer}
          userId={userDrawer}
          venues={venues}
          onClose={() => setUserDrawer(null)}
          onChanged={ok}
          onDeleted={(message) => {
            setUserDrawer(null);
            ok(message);
          }}
        />
      )}
      {createUser && (
        <AdminCreateUserModal
          venues={venues}
          onClose={() => setCreateUser(false)}
          onCreated={(u) => ok(`Created ${u.first_name} ${u.last_name} (${u.email}).`)}
          onOpenUser={(id) => setUserDrawer(id)}
        />
      )}
      {createVenue && (
        <VenueSettingsModal
          mode="create"
          venue={null}
          showManagerEmail
          onClose={() => setCreateVenue(false)}
          onSaved={(saved) => {
            setCreateVenue(false);
            venuesChanged();
            ok(`Created ${saved.name}. Set up positions and a manager from its panel.`);
            setVenueDrawer(saved.id);
          }}
        />
      )}
    </div>
  );
}
```

---

## C10. `frontend/src/components/Navbar.jsx` (EDIT)
The admin venue switcher also reloads on the `admin_venues_changed` event. Nothing else in the navbar changes.

**Edit 1.** Find:
```jsx
  }, [location.pathname]);

  // Super Admin venue switcher data
  useEffect(() => {
    if (isPlatformAdmin) {
      api
        .get('/admin/venues')
```
Replace with:
```jsx
  }, [location.pathname]);

  // Super Admin venue switcher data (Phase 29.2: reloads when the admin console creates/deletes a venue)
  useEffect(() => {
    if (!isPlatformAdmin) return undefined;
    const load = () =>
      api
        .get('/admin/venues')
```

**Edit 2.** Find:
```jsx
            setSelectedVenueId(list[0].id);
            localStorage.setItem('shiftboard_admin_venue_id', list[0].id);
          }
        })
        .catch((err) => console.error('Failed to load admin venues for switcher:', err));
    }
  }, [isPlatformAdmin]);

```
Replace with:
```jsx
            setSelectedVenueId(list[0].id);
            localStorage.setItem('shiftboard_admin_venue_id', list[0].id);
          } else {
            setSelectedVenueId('');
          }
        })
        .catch((err) => console.error('Failed to load admin venues for switcher:', err));
    load();
    window.addEventListener('admin_venues_changed', load);
    return () => window.removeEventListener('admin_venues_changed', load);
  }, [isPlatformAdmin]);

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
CREATE TABLE IF NOT EXISTS admin_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(40) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id UUID,
    summary VARCHAR(400) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_type, target_id);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### Checklist
Sign in as a platform admin and open `/admin`.

1. **Tabs:** Overview, Venues, People, Activity and System each load. The URL shows `?tab=…`, and reloading keeps the tab.
2. **Overview:**
   * **Needs attention** lists real items (e.g. "Email is in console mode…", any venue with no manager). Clicking a venue item opens its drawer; clicking a delivery or system item opens System.
   * The tiles read "N workers · N managers · N admins" (singular when 1).
3. **Venues:**
   * The **Clock-in** column says "Anywhere" unless the venue turned on on-site clock-in.
   * **Booking** shows the venue's real policy.
   * A venue without a manager has a **No manager** chip.
   * **Dashboard** opens `/venue` on that venue, and the navbar picker switches to it.
4. **Venue drawer:**
   * Click a row. Managers, the activity log and admin changes show.
   * **Team** and **Settings** open the usual modals.
   * Esc closes the drawer (and only the top modal when one is open).
5. **Safe delete:**
   * In a test venue's drawer, **Delete venue…**. The button stays disabled until the name is typed.
   * For a venue where someone has clocked in, deleting without the checkbox shows "…payroll history…" (409). With the box ticked it deletes.
   * The navbar venue list updates without a reload.
6. **People:**
   * The search matches name, email or phone. Paging appears past 25 people.
   * Filter by a venue: its managers, team *and* people who requested there appear.
   * A worker who has worked a venue but isn't on its team shows a **grey** chip for it (not "None assigned").
7. **Person drawer:**
   * Change the phone and last name, then **Save changes**. A banner confirms, and the Admin changes list in the drawer shows "<name> (<email>): profile edited".
   * Change an email to one that's taken: "Another account already uses …".
   * Esc closes the drawer.
   * **Reset password** (password accounts only), **Deactivate** / **Reactivate**, and **Delete…** (type the email) all work. You can't act on your own account.
8. **New user:**
   * Leave "Generate a temporary one" selected. The result screen shows the password once, with **Copy password** and **Copy sign-in message**.
   * Sign in with it in a private window.
9. **Activity tab:**
   * **Venue activity** shows lines from every venue with the venue name. The venue filter and chips work, and clicking an event line opens it in the manager dashboard.
   * **Admin changes** shows the actions from steps 5–8.
10. **System:**
    * Configuration rows are correct for your `.secrets` (email/SMS console mode shows an amber warning).
    * **Background worker** says Running with a recent heartbeat within about a minute of startup. (If it says "Turned off", `NOTIFICATIONS_WORKER_ENABLED` is false.)
    * **Send a test email** to yourself: a banner confirms, and in console mode the email appears in `docker compose logs backend`.
    * Failed deliveries (if any) show **Retry**. It moves them back to Queued.
11. **Managers and workers** get **403** on every `/api/admin/*` endpoint above.

### Notes
* Deleting a venue doesn't notify people booked on its upcoming events. The dialog warns about this. Cancel the events first if people need telling.
* The **Same name** flag only compares people on the current page. Use the search box to check a name across everyone.
* Heartbeat and worker health are best-effort. If Redis is down, the heartbeat shows "None recorded yet" even though the worker still runs (single-process fallback).