# Phase 36.1: Calendar Sync (v0.36.1)

**Why:** people live in their phone's calendar. This phase lets every account type see ShiftBoard there, in Google Calendar, Apple Calendar, Outlook or any other calendar app, without anyone having to re-type a shift.

## What changes

### 1. How it works
* A person opens **Profile → Calendar sync** and turns a calendar on. That makes a **private link** (an iCalendar feed).
* Their calendar app **subscribes** to the link and re-reads it on its own schedule. One tap adds it to Google Calendar, Apple Calendar, Outlook.com or Microsoft 365; the link can be copied for anything else.
* It is **one-way**: nothing done in a calendar app changes ShiftBoard.
* It works with every calendar provider because it uses the standard they all read. There is **no Google or Microsoft sign-in, no API key and no new package** in this phase.
* How fast changes show up is decided by the calendar app, not by ShiftBoard: usually every few hours, and Google can take up to a day. The settings page says so.

### 2. Calendars by role
Which calendars a person can turn on follows their access. `users.role` is not changed.

| Who | Calendars offered |
| :--- | :--- |
| Worker | **My shifts** (Worker calendar) |
| Shift lead | My shifts, plus a **Venue calendar** for each venue they lead (posted events only, never drafts) |
| Manager | **All my venues** (Manager calendar), plus one **Venue calendar** per venue |
| Owner | the above, plus an **Organization calendar** for each organization they own |
| Platform admin | **Every venue** (Admin calendar), plus any organization's or venue's calendar |

### 3. What a worker's calendar shows
* Every shift is tagged at the start of its title:
  * `[Confirmed]` booked
  * `[REQUESTED]` asked for, waiting on the venue
  * `[WAITLIST]` in line for a full position
  * `[OFFERED]` offered to them (by a manager, or a waitlist spot being held), not answered yet
* The title is `[tag] <event name> (<position>)`, for example `[Confirmed] Smith Wedding (Bartender)`.
* Only confirmed shifts block the time as "busy". The other three are tentative and leave the time free.
* When the venue confirms a request, the **same entry** changes from `[REQUESTED]` to `[Confirmed]`.
* Their **time off** is shown too.
* Requested, waitlisted, offered and time off can each be switched off per link. Confirmed shifts are always shown.
* Cancelled shifts, and shifts whose event went back to draft, are left out.

### 4. What venue calendars show (venue, manager, organization, admin)
* **One entry per event**, for example `Smith Wedding (6/8 filled)`.
  * Calendars that cover several venues put the venue first: `Harbor House: Smith Wedding (6/8 filled)`.
  * The details list each position with who is booked (`Bartender 2/3: Ana Ruiz, Bo Chen`) and how many requests are waiting.
* A shift that isn't part of an event is an entry of its own.
* Managers, owners and admins can switch on **draft events**, tagged `[DRAFT]`. A shift lead's calendar never has drafts.
* These entries never block the time ("free"), so an owner's own calendar isn't marked busy all day.

### 5. What is never in a calendar
* **Pay, of any kind:** no rate, tip, cost or earnings. Calendar entries get copied to shared and work calendars.
* Staff-only notes, private time-off notes, the message on an offer, email addresses and phone numbers.
* Each entry links back to ShiftBoard for the rest.

### 6. The link is the key
* Anyone who has a link can read that calendar. So the token in it is 43 random characters, and the settings say not to share it.
* **Reset link** makes a new one; the old one stops working at once. **Turn off** deletes it.
* **Access is worked out again each time a feed is built** (a built feed is reused for up to one minute). If someone stops managing or leading a venue, leaves an organization, or their account is turned off, their link shows an **empty calendar**, so the entries disappear from their calendar app. Their settings then list it as **No longer available** with a Turn off button.
* The settings show when a calendar app last read each link.
* New setting **`CALENDAR_SYNC`** (default `true`). `false` hides the settings and makes every link answer `404`; turning it back on brings the same links back.
* Google and Outlook read the link from their own servers, so the site needs a public `https` address. On a local address the settings page says so.

### API (6 new operations: 217 in all)

| Method and path | Who | What |
| :--- | :--- | :--- |
| `GET /api/me/calendar-links` | any signed-in user | `CalendarLinks`: `{ enabled, public_address_ok, calendars[] }`. Every calendar they may have; the ones that are on carry `id` and the addresses |
| `POST /api/me/calendar-links` | any signed-in user | `{ kind, venue_id?, organization_id? }` → `CalendarLink` (201). `kind`: `worker` \| `manager` \| `venue` \| `organization` \| `admin`. `403` if that calendar isn't theirs to have; `400` for an unknown kind or a missing id. Turning the same one on twice returns the same link |
| `PUT /api/me/calendar-links/{id}` | the link's owner | any of `include_requested`, `include_waitlist`, `include_offers`, `include_time_off`, `include_drafts` → `CalendarLink`. A switch that doesn't belong to that calendar is ignored |
| `POST /api/me/calendar-links/{id}/reset` | the link's owner | a new token → `CalendarLink` |
| `DELETE /api/me/calendar-links/{id}` | the link's owner | 204 |
| `GET /api/public/calendar/{token}.ics` | **no sign-in** (the token is the credential) | `text/calendar`. `404` for an unknown or replaced token, or when `CALENDAR_SYNC` is off. Supports `ETag` / `If-None-Match` and `HEAD` |

Someone else's link id answers `404` on `PUT`, `reset` and `DELETE`.

### Database (schema change ⚠️, Part R)
* **One new table:** `calendar_feeds` (`user_id`, `kind`, `scope_key`, `venue_id`, `organization_id`, `token` UNIQUE, five `include_*` booleans, `last_fetched_at`, `created_at`, `updated_at`; UNIQUE `(user_id, scope_key)`).
* `kind` is `VARCHAR(20)`, checked in the app by `models.CalendarKind`. **No ENUMs.**
* No existing table changes.

**Version 0.36.1.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## 0. Rules for this phase
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - `docker-compose.yaml`, `docker-compose.demo.yaml`, `deploy_test_data.sh`, `deploy_test_data.ps1`, `backend/src/demo_data.py`
  - Any real settings file (`.env`, anything in `.secrets/` that isn't a `.template`, any `*.bak`). Never open, read or print one.
  - In `backend/src/main.py`, **only** the one router import and the one `include_router` line (C1). The CORS block is not touched.
  - In `agy_system_instructions.md`, only the edit in F3. Leave the Standing rules section exactly as it is.
  - `database/upgrades/0.36.0.sql` (already in the repo). Leave it as it is.
* **Do NOT run any `docker` or `docker compose` command, the SQL in B3, or the demo data loader.** Andrew does all of that himself (Part R).
* **`users.role` stays `platform_admin` | `venue_manager` | `worker`.** Don't add a role value.
* **No native PostgreSQL ENUMs.** `calendar_feeds.kind` is `VARCHAR(20)`.
* **Datetimes** are timezone-aware UTC (`datetime.now(timezone.utc)`).
* **No new packages**, backend or frontend. The calendar text is written by hand in `services/calendar_feeds.py`. No `VITE_` variables.
* **No pay in a feed.** Don't add a rate, tip, cost or earnings to any calendar entry, and don't add staff-only notes.
* **Keep the tags exactly as written:** `[Confirmed]`, `[REQUESTED]`, `[WAITLIST]`, `[OFFERED]`, `[DRAFT]` (that capitalisation).
* **The feed is the only new endpoint with no sign-in.** It lives in `routers/public.py`, as rule 11 of the guide requires. Don't add another.
* **Code fences are not file content.** Every file and every *Find* / *Replace with* block in this prompt is wrapped in fence lines of three backticks. Those lines are Markdown; never write them into a file.
* **NEW FILES (4):** create them with exactly the content shown, with LF line endings. Each one states its first and last line: check them when you finish.
* **EDITS (32 in 17 files):** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order, top to bottom of each file.
  - If a *Find* doesn't match, stop and report it. Don't improvise a different edit.
  - Keep each file's existing line endings (all 17 have LF on this computer). Match on the text.
* **Verification.** All 32 edits were generated from the files in your repo (0.36.0 is applied) and replayed by a script: each *Find* matched exactly once, and the result is the code that was tested.
  - **Backend:** imports cleanly. 217 API operations (211 + 6). The API reports **0.36.1**.
  - **A new 106-check suite passes** against a real PostgreSQL. Every feed in it is also parsed by an independent iCalendar library. It covers:
    - **Format:** CRLF line endings; no line over 75 bytes, and no character split by folding (accents and emoji in titles); commas, semicolons, backslashes and line breaks escaped; unique ids; exact start and end times in UTC; all-day entries with the right end day.
    - **Nothing injected:** a title containing line breaks (including the Unicode ones) stays inside the title.
    - **Worker calendar:** each of the four tags; tentative vs. busy; a request that gets confirmed keeps its entry; a held waitlist spot shows as `[OFFERED]`, as `[WAITLIST]` when offers are switched off, and not at all once its time has run out; time off over several days, weekly time off, a one-off day, the night the clocks go forward, and a cap that never pushes shifts out; cancelled, draft, too-old and too-far shifts left out; each of the four switches.
    - **No pay or private text:** every feed was searched for each pay rate used, `$`, the words rate / tip / wage / earn / cost, the staff-only note, the private time-off note, the offer message and email addresses. None.
    - **Who can have what:** a worker can't turn on a manager, admin, venue or organization calendar; a manager can't have a worker or admin calendar, another venue's, or an organization they don't own; a shift lead gets only the venue they lead; an admin has no worker calendar. Nobody can change, reset or turn off someone else's link.
    - **Venue calendars:** one entry per event with the fill count; same-named positions added up; names of booked staff; requests counted, not named; shifts with no event; drafts only when switched on, never for a shift lead; a lead's entries link to the Lead page.
    - **Losing access:** a manager moved off a venue, a lead who stops being a lead, and an account that is turned off all get an empty calendar; the link is listed as no longer available and can be turned off; getting access back restores the same link. Deleting a venue, an organization or an account deletes its links.
    - **The link:** 43-character token; reset replaces it and the old one answers `404` at once; turning off and on gives a new one; unknown and malformed tokens answer `404`; `ETag` (also weakened by a proxy), `304` and `HEAD`; a changed switch shows on the very next read; `CALENDAR_SYNC=false` stops everything and `true` brings it back.
    - **Sign-in:** the complete list of endpoints that work without a sign-in is the old list plus `GET /api/public/calendar/{token}.ics`.
  - **All 21 earlier suites still pass** (1,034 checks). 1,140 checks in all.
  - **`database/init.sql` and `models.py` describe the same schema** (the existing audit suite).
  - **Upgrade path:** the 0.36.1 code was run against a 0.36.0 database with nothing else done: the backend creates the new table when it starts, and the whole new suite passes. The SQL in B3 was run on a 0.36.0 database, twice, and after the backend had made the table: each time the table is identical to a fresh install's.
  - **Demo data:** loads, clears and reloads unchanged. It needs no edit: links are made when a person turns a calendar on.
  - **An independent review** of the new code looked for pay leaks, ways to read someone else's calendar, text injection and wrong dates. It found no pay leak and no way across accounts.
    - The defects it did find are fixed in the code below: Unicode line breaks in titles, lost links that couldn't be seen or turned off, a lapsed waitlist offer still shown, entry links when `APP_BASE_URL` isn't set, the clock-change night, time off crowding out shifts, and several smaller ones. The new suite covers each of those.
    - Three points are accepted as they are and written down in Part R: a lost access can take up to a minute to show, tokens are stored as they are, and the Apple button's `webcal://` address relies on the site sending http to https.
  - **Frontend:** bundles with no missing imports (same `lucide-react` 0.359.0 as the repo). In real Chromium, with the demo data:
    - a worker: the **Sync** button on the calendar opens Profile → Calendar sync; Turn on; the four buttons and the link; Copy (and the "select it yourself" message when the browser blocks copying); the switches tick at once and keep keyboard focus; the feed read back has only tagged entries and no `$`; Reset link; Turn off; no sideways scrolling on a phone
    - a shift lead: My shifts plus the venue they lead, with no switches; after the lead role ends, the card says *No longer available* and Turn off removes it
    - a manager: All my venues and the venue; an owner: also the organization; an admin: Every venue, the organization, and a venue picker
    - No page errors and no console errors.
  - **Not tested:** nothing was run in Docker or behind the Cloudflare tunnel, and **no real Google, Apple or Outlook account was used**. The one-tap buttons use each service's usual "subscribe by address" link; the copied link is the fallback if one of them changes. See Part R for how to check with your own calendar.

  Don't "improve" them.

---

# PART A: Database

## A1. `backend/src/models.py` (2 EDITS)
`timezone` added to the `datetime` import, and two new classes at the end of the file: `CalendarKind` and `CalendarFeed`.

**Edit 1.** Find:
```python
import uuid
from enum import Enum
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float, Numeric,
```
Replace with:
```python
import uuid
from enum import Enum
from datetime import datetime, timezone   # Phase 36.1: timezone (new tables use aware UTC defaults)
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float, Numeric,
```

**Edit 2.** Find:
```python
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_event_tips_venue", "venue_id"),)
```
Replace with:
```python
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_event_tips_venue", "venue_id"),)


# ------------------------------------------------------------------------------
# Phase 36.1: Calendar sync (private subscription links)
# ------------------------------------------------------------------------------
class CalendarKind(str, Enum):
    """Phase 36.1: which calendar a link shows. Stored as VARCHAR; checked here (no native PG ENUM)."""
    worker = "worker"                # the person's own shifts
    manager = "manager"              # every venue they manage, in one calendar
    venue = "venue"                  # one venue
    organization = "organization"    # every venue in an organization
    admin = "admin"                  # every venue on the platform


class CalendarFeed(Base):
    """Phase 36.1: one private calendar link. The token in the link is the only credential, so it is long,
    random and replaceable. What the link shows is decided again on every read (services/calendar_feeds.py):
    a link for a venue the person no longer runs shows an empty calendar. No pay is ever written to a feed."""
    __tablename__ = "calendar_feeds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(20), nullable=False)                                # CalendarKind
    scope_key = Column(String(60), nullable=False)                           # worker | manager | admin | venue:<id> | organization:<id>
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    token = Column(String(64), nullable=False, unique=True)
    include_requested = Column(Boolean, nullable=False, default=True)        # worker: shifts waiting for an answer
    include_waitlist = Column(Boolean, nullable=False, default=True)         # worker: waitlisted shifts
    include_offers = Column(Boolean, nullable=False, default=True)           # worker: offers they haven't answered
    include_time_off = Column(Boolean, nullable=False, default=True)         # worker: their own time off
    include_drafts = Column(Boolean, nullable=False, default=False)          # venue calendars: draft events (never for shift leads)
    last_fetched_at = Column(DateTime(timezone=True), nullable=True)         # last time a calendar app read it
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "scope_key", name="uq_calendar_feed_scope"),
        Index("idx_calendar_feeds_user", "user_id"),
    )
```

---

## A2. `database/init.sql` (1 EDIT)
The new table goes at the end of the file. Same columns as A1.

**Edit 1.** Find:
```sql
);
CREATE INDEX idx_event_tips_venue ON event_tips(venue_id);
```
Replace with:
```sql
);
CREATE INDEX idx_event_tips_venue ON event_tips(venue_id);

-- ==============================================================================
-- Phase 36.1: Calendar sync (private subscription links; the token in the link is the credential)
-- ==============================================================================
CREATE TABLE calendar_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,                                -- worker | manager | venue | organization | admin (models.CalendarKind)
    scope_key VARCHAR(60) NOT NULL,                           -- worker | manager | admin | venue:<id> | organization:<id>
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    include_requested BOOLEAN NOT NULL DEFAULT TRUE,          -- worker: shifts waiting for an answer
    include_waitlist BOOLEAN NOT NULL DEFAULT TRUE,           -- worker: waitlisted shifts
    include_offers BOOLEAN NOT NULL DEFAULT TRUE,             -- worker: offers they haven't answered
    include_time_off BOOLEAN NOT NULL DEFAULT TRUE,           -- worker: their own time off
    include_drafts BOOLEAN NOT NULL DEFAULT FALSE,            -- venue calendars: draft events (never for shift leads)
    last_fetched_at TIMESTAMPTZ,                              -- last time a calendar app read it
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_calendar_feed_scope UNIQUE (user_id, scope_key)
);
CREATE INDEX idx_calendar_feeds_user ON calendar_feeds(user_id);
```

---

# PART B: Backend, new files

## B1. NEW FILE `backend/src/services/calendar_feeds.py`
Who may have which calendar, what goes in a feed, and the calendar text itself. The first line is `"""` and the **last line is `    return False`**.

```python
"""
Phase 36.1: Calendar sync by private link.

A person turns a calendar on in Profile -> Calendar sync and gets a private address (an iCalendar feed).
Google Calendar, Apple Calendar, Outlook and every other calendar app can subscribe to it. It is one-way:
the calendar app reads ShiftBoard; nothing a person does in their calendar app changes ShiftBoard.

Which calendars a person may have (scopes_for) follows their access:
  worker            "My shifts": their own shifts, tagged
                        [REQUESTED]  asked for, waiting on the venue
                        [Confirmed]  booked
                        [WAITLIST]   in line for a full position
                        [OFFERED]    offered to them, not answered yet
                    plus their own time off. Each of the last four can be switched off per link.
  shift lead        a venue calendar for each venue they lead (posted events only, never drafts)
  venue manager     "All my venues", one calendar per venue, one per organization they own
  platform admin    "Every venue", one calendar per venue, one per organization

Venue calendars have ONE entry per event ("Smith Wedding (6/8 filled)") with the positions and who is
booked in the details. Shifts that aren't part of an event are entries of their own.

Rules that must hold:
  * NO PAY, ever: no rate, tip, cost or earnings is written to a feed (a calendar entry gets copied to shared
    and work calendars). Staff-only notes are left out too; the entry links back to ShiftBoard.
  * The token in the address is the only credential. It is long and random, and "Reset link" replaces it.
  * Access is decided again every time a feed is built: a link for a venue the person no longer runs, or for an
    account that was turned off, gives an empty calendar. An unknown or replaced token gives 404 at once.
    A built feed is reused for up to CACHE_SECONDS, so losing access shows within a minute.
"""
import hashlib
import ipaddress
import re
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote, urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import normalize_role
from src.config import settings
from src.models import (
    CalendarFeed, CalendarKind, Organization, OrganizationMember, OrgRole, Shift, ShiftEvent, ShiftOffer, ShiftRequest,
    TimeOffBlock, User, Venue, VenueManager, VenueWhitelist, WaitlistEntry,
)
from src.schemas import CalendarLink
from src.services.booking import ASSIGNED_STATUSES, PENDING_STATUSES, as_utc
from src.services.locations import effective_place, load_locations
from src.services.messaging import absolute_link
from src.services.time_off import BlockSpec, applies_on, interval_on

TAG_REQUESTED = "[REQUESTED]"
TAG_CONFIRMED = "[Confirmed]"
TAG_WAITLIST = "[WAITLIST]"
TAG_OFFERED = "[OFFERED]"
TAG_DRAFT = "[DRAFT]"

PAST = timedelta(days=30)             # how far back a feed goes
FUTURE = timedelta(days=180)          # how far ahead
MAX_ENTRIES = 1500                    # shifts or events per feed (the admin calendar on a big site)
MAX_TIME_OFF = 400                    # time-off entries per feed, counted apart so they never push shifts out
CACHE_SECONDS = 60                    # a feed is built at most once a minute per link
CACHE_LINKS = 500                     # built feeds kept in memory
FETCH_STAMP_EVERY = timedelta(minutes=10)
DEFAULT_TZ = "America/New_York"

WORKER_OPTIONS = ["include_requested", "include_waitlist", "include_offers", "include_time_off"]
VENUE_OPTIONS = ["include_drafts"]
ALL_OPTIONS = WORKER_OPTIONS + VENUE_OPTIONS

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
_CACHE: Dict[str, Tuple[float, object, str, str]] = {}     # token -> (expires, link's updated_at, etag, body)


def clear_cache(token: Optional[str] = None) -> None:
    if token is None:
        _CACHE.clear()
    else:
        _CACHE.pop(token, None)


def new_token() -> str:
    return secrets.token_urlsafe(32)          # 43 URL-safe characters


# ------------------------------------------------------------------------------------------------
# Which calendars a person may have
# ------------------------------------------------------------------------------------------------
@dataclass
class Scope:
    kind: str
    scope_key: str
    name: str
    description: str
    venue_id: Optional[UUID] = None
    organization_id: Optional[UUID] = None
    shift_lead: bool = False
    venue_ids: Tuple = ()                # the venues a venue-type calendar covers

    @property
    def options(self) -> List[str]:
        if self.kind == CalendarKind.worker.value:
            return list(WORKER_OPTIONS)
        return [] if self.shift_lead else list(VENUE_OPTIONS)


def scope_key_for(kind: str, venue_id=None, organization_id=None) -> Optional[str]:
    if kind in (CalendarKind.worker.value, CalendarKind.manager.value, CalendarKind.admin.value):
        return kind
    if kind == CalendarKind.venue.value and venue_id:
        return f"venue:{venue_id}"
    if kind == CalendarKind.organization.value and organization_id:
        return f"organization:{organization_id}"
    return None


async def scopes_for(db: AsyncSession, user: User) -> List[Scope]:
    """Every calendar this person may have right now, in the order the settings page shows them."""
    if user is None or not user.is_active:
        return []
    role = normalize_role(user.role)
    out: List[Scope] = []

    if role == "worker":
        out.append(Scope(
            kind=CalendarKind.worker.value, scope_key="worker", name="My shifts",
            description="Your own shifts: confirmed, requested, waitlisted and offered, plus your time off.",
        ))
        lead_venues = (await db.execute(
            select(Venue).join(VenueWhitelist, VenueWhitelist.venue_id == Venue.id).where(
                VenueWhitelist.worker_id == user.id,
                VenueWhitelist.is_active == True,
                VenueWhitelist.is_lead == True,
            ).order_by(func.lower(Venue.name))
        )).scalars().all()
        for v in lead_venues:
            out.append(Scope(
                kind=CalendarKind.venue.value, scope_key=f"venue:{v.id}", name=v.name, venue_id=v.id, shift_lead=True,
                venue_ids=(v.id,), description="Every posted event at this venue, with who is booked. You're a shift lead here.",
            ))
        return out

    if role == "venue_manager":
        venues = (await db.execute(
            select(Venue).join(VenueManager, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == user.id).order_by(func.lower(Venue.name))
        )).scalars().all()
        orgs = (await db.execute(
            select(Organization).join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(OrganizationMember.user_id == user.id, OrganizationMember.role == OrgRole.owner.value)
            .order_by(func.lower(Organization.name))
        )).scalars().all()
        if venues:
            out.append(Scope(
                kind=CalendarKind.manager.value, scope_key="manager", name="All my venues",
                venue_ids=tuple(v.id for v in venues),
                description="Every event at every venue you manage, in one calendar.",
            ))
    elif role == "platform_admin":
        venues = (await db.execute(select(Venue).order_by(func.lower(Venue.name)))).scalars().all()
        orgs = (await db.execute(select(Organization).order_by(func.lower(Organization.name)))).scalars().all()
        out.append(Scope(
            kind=CalendarKind.admin.value, scope_key="admin", name="Every venue",
            venue_ids=tuple(v.id for v in venues),
            description="Every event at every venue on this site, in one calendar.",
        ))
    else:
        return out

    if orgs:
        org_venues = defaultdict(list)
        for vid, oid in (await db.execute(
            select(Venue.id, Venue.organization_id).where(Venue.organization_id.in_([o.id for o in orgs]))
        )).all():
            org_venues[oid].append(vid)
        for o in orgs:
            out.append(Scope(
                kind=CalendarKind.organization.value, scope_key=f"organization:{o.id}", name=o.name,
                organization_id=o.id, venue_ids=tuple(org_venues.get(o.id, [])),
                description="Every event at every venue in this organization, in one calendar.",
            ))
    for v in venues:
        out.append(Scope(
            kind=CalendarKind.venue.value, scope_key=f"venue:{v.id}", name=v.name, venue_id=v.id, venue_ids=(v.id,),
            description="Every event at this venue, with who is booked.",
        ))
    return out


# ------------------------------------------------------------------------------------------------
# Addresses
# ------------------------------------------------------------------------------------------------
def _host_is_public(host: Optional[str]) -> bool:
    host = (host or "").lower().strip("[]")
    if not host or host == "localhost" or host.endswith((".localhost", ".local", ".test", ".internal")):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return "." in host                      # a name: needs a dot ("backend" is a Docker service, not a site)
    return ip.is_global


def address_ok(base: Optional[str]) -> bool:
    """Can Google / Outlook reach this site? (They read the feed from their own servers.)"""
    try:
        parts = urlsplit(base or "")
    except ValueError:
        return False
    return parts.scheme == "https" and _host_is_public(parts.hostname)


def app_link(path: str) -> str:
    """A link back into the web app for a calendar entry, or '' when APP_BASE_URL isn't a real address yet.
    (A feed is read by a calendar service, so there is no browser address to fall back on.)"""
    try:
        parts = urlsplit((settings.APP_BASE_URL or "").strip())
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not _host_is_public(parts.hostname):
        return ""
    return absolute_link(path)


def feed_urls(token: str, calendar_name: str, base: Optional[str]) -> Dict[str, str]:
    root = (base or settings.APP_BASE_URL or "").rstrip("/")
    url = f"{root}/api/public/calendar/{token}.ics"
    rest = url.split("://", 1)[1] if "://" in url else url.lstrip("/")
    webcal = f"webcal://{rest}"
    name = quote(f"ShiftBoard: {calendar_name}", safe="")
    return {
        "url": url,
        "webcal_url": webcal,
        "google_url": "https://calendar.google.com/calendar/render?cid=" + quote(webcal, safe=":/"),
        "outlook_url": f"https://outlook.live.com/calendar/0/addfromweb?url={quote(url, safe='')}&name={name}",
        "office_url": f"https://outlook.office.com/calendar/0/addfromweb?url={quote(url, safe='')}&name={name}",
    }


def to_link(scope: Scope, feed: Optional[CalendarFeed], base: Optional[str]) -> CalendarLink:
    item = CalendarLink(
        kind=scope.kind, scope_key=scope.scope_key, name=scope.name, description=scope.description,
        venue_id=scope.venue_id, organization_id=scope.organization_id, shift_lead=scope.shift_lead,
        options=scope.options,
    )
    if feed is None:
        return item
    urls = feed_urls(feed.token, scope.name, base)
    item.id = feed.id
    item.url, item.webcal_url = urls["url"], urls["webcal_url"]
    item.google_url, item.outlook_url, item.office_url = urls["google_url"], urls["outlook_url"], urls["office_url"]
    item.include_requested = bool(feed.include_requested)
    item.include_waitlist = bool(feed.include_waitlist)
    item.include_offers = bool(feed.include_offers)
    item.include_time_off = bool(feed.include_time_off)
    item.include_drafts = bool(feed.include_drafts) and not scope.shift_lead
    item.last_fetched_at = feed.last_fetched_at
    item.created_at = feed.created_at
    return item


async def lost_link(db: AsyncSession, feed: CalendarFeed) -> CalendarLink:
    """A link the person turned on for a calendar they can no longer have (they stopped managing or leading the
    venue, left the organization, or changed role). It shows an empty calendar; listing it lets them turn it off."""
    name = None
    if feed.venue_id is not None:
        name = await db.scalar(select(Venue.name).where(Venue.id == feed.venue_id))
    elif feed.organization_id is not None:
        name = await db.scalar(select(Organization.name).where(Organization.id == feed.organization_id))
    return CalendarLink(
        kind=feed.kind, scope_key=feed.scope_key, name=name or "A calendar you used to have", available=False,
        description="You no longer have access to this calendar, so its link shows an empty calendar. Turn it off, and remove it from your calendar app.",
        venue_id=feed.venue_id, organization_id=feed.organization_id, options=[], id=feed.id,
        include_drafts=False, last_fetched_at=feed.last_fetched_at, created_at=feed.created_at,
    )


# ------------------------------------------------------------------------------------------------
# iCalendar text (RFC 5545), written by hand: no new package
# ------------------------------------------------------------------------------------------------
@dataclass
class Entry:
    uid: str
    start: object                       # aware datetime, or a date when all_day
    end: object
    summary: str
    description: List[str] = field(default_factory=list)
    location: str = ""
    url: str = ""
    tentative: bool = False             # STATUS:TENTATIVE (not theirs yet)
    busy: bool = True                   # False = doesn't block the time (TRANSP:TRANSPARENT)
    modified: Optional[datetime] = None
    all_day: bool = False


# Control characters, and the Unicode line breaks some calendar apps treat as the end of a line
# (NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR): a title must never be able to start a new property.
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]")


def ics_text(value) -> str:
    """Escape a text value: backslash, semicolon, comma, and line breaks."""
    s = _CONTROL.sub(" ", str(value or "").replace("\r\n", "\n").replace("\r", "\n"))
    s = s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return s.replace("\n", "\\n")


def ics_fold(line: str) -> str:
    """Lines longer than 75 bytes continue on the next line after one space. Never splits a character."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, limit = [], 75
    while len(raw) > limit:
        cut = limit
        while cut > 0 and (raw[cut] & 0xC0) == 0x80:      # don't cut inside a multi-byte character
            cut -= 1
        parts.append(raw[:cut].decode("utf-8"))
        raw = raw[cut:]
        limit = 74                                        # the leading space counts on continuation lines
    parts.append(raw.decode("utf-8"))
    return "\r\n ".join(parts)


def ics_stamp(dt: datetime) -> str:
    return as_utc(dt).strftime("%Y%m%dT%H%M%SZ")


def render(calendar_name: str, description: str, entries: List[Entry]) -> str:
    epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ShiftBoard//Calendar sync//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_text(calendar_name)}",
        f"NAME:{ics_text(calendar_name)}",
        f"X-WR-CALDESC:{ics_text(description)}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for e in entries:
        stamp = ics_stamp(e.modified or epoch)
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}", f"DTSTAMP:{stamp}", f"LAST-MODIFIED:{stamp}"]
        if e.all_day:
            lines += [f"DTSTART;VALUE=DATE:{e.start.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{e.end.strftime('%Y%m%d')}"]
        else:
            lines += [f"DTSTART:{ics_stamp(e.start)}", f"DTEND:{ics_stamp(e.end)}"]
        lines.append(f"SUMMARY:{ics_text(e.summary)}")
        if e.location:
            lines.append(f"LOCATION:{ics_text(e.location)}")
        body = "\n".join(x for x in e.description if x is not None)
        if body:
            lines.append(f"DESCRIPTION:{ics_text(body)}")
        if e.url:
            lines.append(f"URL:{e.url}")
        lines += [
            "STATUS:TENTATIVE" if e.tentative else "STATUS:CONFIRMED",
            "TRANSP:OPAQUE" if e.busy else "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(ics_fold(x) for x in lines) + "\r\n"


# ------------------------------------------------------------------------------------------------
# Small helpers
# ------------------------------------------------------------------------------------------------
def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def _clock(dt: datetime) -> str:
    hour = dt.hour % 12 or 12
    return f"{hour}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"


def when_text(start: datetime, end: datetime, tz_name: Optional[str]) -> str:
    """'Sat, Oct 10, 4:00 PM to 11:00 PM EDT' in the venue's own time zone."""
    tz = _zone(tz_name)
    s, e = as_utc(start).astimezone(tz), as_utc(end).astimezone(tz)
    day = f"{s.strftime('%a')}, {s.strftime('%b')} {s.day}"
    tail = _clock(e) if e.date() == s.date() else f"{e.strftime('%a')} {_clock(e)}"
    return f"{day}, {_clock(s)} to {tail} {s.tzname() or ''}".strip()


def moment_text(at: Optional[datetime], tz_name: Optional[str]) -> str:
    """'Sat, Oct 10, 4:00 PM EDT' in the venue's own time zone ('' when there is no time)."""
    if at is None:
        return ""
    t = as_utc(at).astimezone(_zone(tz_name))
    return f"{t.strftime('%a')}, {t.strftime('%b')} {t.day}, {_clock(t)} {t.tzname() or ''}".strip()


def _person(u: Optional[User]) -> str:
    """A name for a roster line. Never an email address."""
    if u is None:
        return "Someone"
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or "Someone"


def _clean(text: Optional[str]) -> str:
    return (text or "").strip()


def _place(venue: Venue, location) -> str:
    p = effective_place(venue, location)
    name, address = _clean(p.get("name")), _clean(p.get("address"))
    if location is not None and name and venue.name and name != venue.name:
        name = f"{name} ({venue.name})"
    return ", ".join(x for x in (name, address) if x)


def _latest(*stamps) -> Optional[datetime]:
    real = [as_utc(s) for s in stamps if s is not None]
    return max(real) if real else None


def _shift_off(shift: Shift, event: Optional[ShiftEvent]) -> bool:
    """Cancelled, or part of an event that is cancelled or back in draft."""
    if (shift.status or "").upper() == "CANCELLED" or shift.cancelled_at is not None:
        return True
    if event is not None and (event.cancelled_at is not None or (event.status or "published").lower() == "draft"):
        return True
    return False


# ------------------------------------------------------------------------------------------------
# A worker's own calendar
# ------------------------------------------------------------------------------------------------
async def _home_zone(db: AsyncSession, user: User) -> ZoneInfo:
    """Time off is wall-clock time where the person works: the time zone most of their venues use."""
    rows = (await db.execute(
        select(Venue.timezone, func.count(Venue.id)).join(VenueWhitelist, VenueWhitelist.venue_id == Venue.id)
        .where(VenueWhitelist.worker_id == user.id, VenueWhitelist.is_active == True)
        .group_by(Venue.timezone)
    )).all()
    if not rows:
        rows = (await db.execute(
            select(Venue.timezone, func.count(ShiftRequest.id)).join(Shift, Shift.venue_id == Venue.id)
            .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
            .where(ShiftRequest.worker_id == user.id).group_by(Venue.timezone)
        )).all()
    best = sorted(rows, key=lambda r: (-int(r[1] or 0), r[0] or ""))
    return _zone(best[0][0] if best else None)


def _time_off_entries(blocks, tz: ZoneInfo, today: date) -> List[Entry]:
    first, last = today - PAST, today + FUTURE
    out: List[Entry] = []
    for row in blocks:
        b = BlockSpec.of(row)
        title = "Time off" + (f": {_clean(b.reason)}" if _clean(b.reason) else "")
        modified = _latest(row.updated_at, row.created_at)
        lo = max(first, b.start_date)
        if b.repeat == "none":
            hi = min(last, b.end_date or b.start_date)      # a one-off with no end date is that one day
        else:
            hi = min(last, b.end_date) if b.end_date is not None else last
        if hi < lo:
            continue
        if b.all_day and b.repeat == "none":
            # one entry for the whole run of days (the end date of an all-day entry is the day after)
            out.append(Entry(uid=f"timeoff-{row.id}@shiftboard", start=lo, end=hi + timedelta(days=1), summary=title,
                             description=["Time off you set in ShiftBoard."], all_day=True, modified=modified))
            continue
        d = lo
        while d <= hi:
            if applies_on(b, d):
                uid = f"timeoff-{row.id}-{d.strftime('%Y%m%d')}@shiftboard"
                if b.all_day:
                    out.append(Entry(uid=uid, start=d, end=d + timedelta(days=1), summary=title,
                                     description=["Time off you set in ShiftBoard."], all_day=True, modified=modified))
                else:
                    start, end = interval_on(b, d, tz)
                    if as_utc(end) > as_utc(start):         # the hour skipped when clocks go forward can leave nothing
                        out.append(Entry(uid=uid, start=start, end=end, summary=title,
                                         description=["Time off you set in ShiftBoard."], modified=modified))
            d += timedelta(days=1)
    # most useful first if there are too many: what's coming up, then the recent past
    out.sort(key=lambda e: (_day_of(e) < today, abs((_day_of(e) - today).days)))
    return out[:MAX_TIME_OFF]


def _day_of(e: "Entry") -> date:
    return e.start if e.all_day else as_utc(e.start).date()


async def worker_entries(db: AsyncSession, user: User, feed: CalendarFeed, now: datetime) -> List[Entry]:
    lo, hi = now - PAST, now + FUTURE
    statuses = ASSIGNED_STATUSES + (PENDING_STATUSES if feed.include_requested else ())
    req_rows = (await db.execute(
        select(ShiftRequest, Shift).join(Shift, ShiftRequest.shift_id == Shift.id).where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(statuses),
            Shift.start_time < hi, Shift.end_time > lo,
        ).order_by(Shift.start_time.asc()).limit(MAX_ENTRIES)
    )).all()
    wait_rows = []
    if feed.include_waitlist or feed.include_offers:
        wait_rows = (await db.execute(
            select(WaitlistEntry, Shift).join(Shift, Shift.id == WaitlistEntry.shift_id).where(
                WaitlistEntry.worker_id == user.id, WaitlistEntry.status.in_(("waiting", "offered")),
                Shift.start_time > now, Shift.start_time < hi,
            ).order_by(Shift.start_time.asc())
        )).all()
        # a spot that was held for them and has run out is no longer theirs (the waitlist engine closes it shortly)
        wait_rows = [(w, s) for w, s in wait_rows
                     if not (w.status == "offered" and w.offer_expires_at is not None and as_utc(w.offer_expires_at) <= now)]
    offer_rows = []
    if feed.include_offers:
        offer_rows = (await db.execute(
            select(ShiftOffer, Shift).join(Shift, Shift.id == ShiftOffer.shift_id).where(
                ShiftOffer.worker_id == user.id, ShiftOffer.status == "pending", ShiftOffer.expires_at > now,
                func.upper(Shift.status) == "OPEN", Shift.end_time > now, Shift.start_time < hi,
            ).order_by(Shift.start_time.asc())
        )).all()

    shifts = [s for _, s in req_rows] + [s for _, s in wait_rows] + [s for _, s in offer_rows]
    events, venues, locations = {}, {}, {}
    if shifts:
        event_ids = {s.event_id for s in shifts if s.event_id}
        if event_ids:
            events = {e.id: e for e in (await db.execute(
                select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()}
        venues = {v.id: v for v in (await db.execute(
            select(Venue).where(Venue.id.in_({s.venue_id for s in shifts})))).scalars().all()}
        locations = await load_locations(db, [e.location_id for e in events.values()])

    out: List[Entry] = []
    taken = set()        # one entry per shift: a request wins over an offer, an offer over the waitlist

    def base(shift: Shift, tag: str, uid: str, lines: List[str], link: str, booked: bool, stamps) -> Optional[Entry]:
        venue = venues.get(shift.venue_id)
        event = events.get(shift.event_id) if shift.event_id else None
        if venue is None or _shift_off(shift, event) or shift.id in taken:
            return None
        taken.add(shift.id)
        location = locations.get(event.location_id) if event is not None and event.location_id else None
        role = _clean(shift.role_type) or "Shift"
        title = _clean(event.title if event is not None else shift.title) or role
        summary = f"{tag} {title}" + (f" ({role})" if role.lower() != title.lower() else "")
        body = list(lines)
        if event is not None:
            body.append(f"Event: {_clean(event.title)}")
        body += [f"Position: {role}", f"Venue: {venue.name}",
                 f"When: {when_text(shift.start_time, shift.end_time, venue.timezone)} (venue time)"]
        if _clean(venue.dress_code):
            body.append(f"Dress code: {_clean(venue.dress_code)}")
        if booked and _clean(venue.arrival_instructions):
            body.append(f"Arriving: {_clean(venue.arrival_instructions)}")
        for label, text in (("Event notes", event.notes if event is not None else None), ("Position notes", shift.description)):
            if _clean(text):
                body.append(f"{label}: {_clean(text)}")
        url = app_link(link)
        body.append("")
        if url:
            body.append(f"Open in ShiftBoard: {url}")
        body.append("Pay and staff-only notes are in ShiftBoard, not in this calendar.")
        return Entry(
            uid=uid, start=shift.start_time, end=shift.end_time, summary=summary, description=body,
            location=_place(venue, location), url=url, tentative=not booked, busy=booked,
            modified=_latest(shift.updated_at, venue.updated_at, event.updated_at if event is not None else None,
                             location.updated_at if location is not None else None, *stamps),
        )

    for req, s in req_rows:
        booked = (req.status or "").lower() in ASSIGNED_STATUSES
        entry = base(
            s, TAG_CONFIRMED if booked else TAG_REQUESTED, f"request-{req.id}@shiftboard",
            ["Confirmed: you're booked on this shift." if booked
             else "Requested: waiting for the venue to confirm. This isn't your shift yet."],
            f"/worker?tab=calendar&request={req.id}", booked, (req.updated_at,),
        )
        if entry:
            out.append(entry)

    def zone_of(shift: Shift) -> Optional[str]:
        venue = venues.get(shift.venue_id)
        return venue.timezone if venue is not None else None

    held = [(w, s) for w, s in wait_rows if w.status == "offered"]
    for w, s in held:
        if feed.include_offers:
            until = moment_text(w.offer_expires_at, zone_of(s))
            entry = base(s, TAG_OFFERED, f"waitlist-{w.id}@shiftboard",
                         ["Offered: a spot opened and it's being held for you" + (f" until {until}" if until else "")
                          + ". Answer in ShiftBoard. This isn't your shift yet."],
                         "/worker?tab=schedule", False, (w.updated_at,))
            if entry:
                out.append(entry)

    for o, s in offer_rows:
        if (s.spots_filled or 0) >= (s.capacity or 1):
            continue
        venue = venues.get(s.venue_id)
        entry = base(s, TAG_OFFERED, f"offer-{o.id}@shiftboard",
                     [f"Offered: {venue.name if venue is not None else 'The venue'} offered you this shift. "
                      f"Answer in ShiftBoard by {moment_text(o.expires_at, zone_of(s))}. This isn't your shift yet."],
                     "/worker?tab=find", False, (o.created_at,))
        if entry:
            out.append(entry)

    # still in line: waiting, or a held spot when offers are switched off for this link
    for w, s in wait_rows:
        if feed.include_waitlist:
            entry = base(s, TAG_WAITLIST, f"waitlist-{w.id}@shiftboard",
                         ["Waitlist: you're in line for this position. This isn't your shift yet."],
                         "/worker?tab=schedule", False, (w.updated_at,))
            if entry:
                out.append(entry)

    if feed.include_time_off:
        blocks = (await db.execute(
            select(TimeOffBlock).where(TimeOffBlock.worker_id == user.id).order_by(TimeOffBlock.start_date.asc())
        )).scalars().all()
        if blocks:
            tz = await _home_zone(db, user)
            out += _time_off_entries(blocks, tz, now.astimezone(tz).date())      # capped on its own (MAX_TIME_OFF)

    out.sort(key=lambda e: (e.start.isoformat() if e.all_day else as_utc(e.start).strftime("%Y-%m-%dT%H:%M:%S"), e.uid))
    return out


# ------------------------------------------------------------------------------------------------
# Venue calendars (one venue, a manager's venues, an organization, every venue)
# ------------------------------------------------------------------------------------------------
async def venue_entries(
    db: AsyncSession, venue_ids, *, show_venue: bool, drafts: bool, lead: bool, now: datetime,
) -> List[Entry]:
    ids = list(venue_ids or [])
    if not ids:
        return []
    lo, hi = now - PAST, now + FUTURE
    venues = {v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(ids)))).scalars().all()}

    q = select(ShiftEvent).where(
        ShiftEvent.venue_id.in_(ids), ShiftEvent.cancelled_at.is_(None),
        ShiftEvent.start_time < hi, ShiftEvent.end_time > lo,
    )
    if not drafts or lead:
        q = q.where(func.lower(ShiftEvent.status) != "draft")
    events = (await db.execute(q.order_by(ShiftEvent.start_time.asc()).limit(MAX_ENTRIES))).scalars().all()
    event_ids = [e.id for e in events]

    live = (func.upper(Shift.status) != "CANCELLED", Shift.cancelled_at.is_(None))
    shifts = []
    if event_ids:
        shifts += (await db.execute(select(Shift).where(Shift.event_id.in_(event_ids), *live))).scalars().all()
    loose = (await db.execute(
        select(Shift).where(Shift.venue_id.in_(ids), Shift.event_id.is_(None), *live,
                            Shift.start_time < hi, Shift.end_time > lo)
        .order_by(Shift.start_time.asc()).limit(MAX_ENTRIES)
    )).scalars().all()
    shifts += loose

    booked = defaultdict(list)       # shift id -> [names]
    waiting = defaultdict(int)       # shift id -> requests not answered
    newest = {}                      # shift id -> latest change to its requests
    if shifts:
        for req, person in (await db.execute(
            select(ShiftRequest, User).join(User, User.id == ShiftRequest.worker_id).where(
                ShiftRequest.shift_id.in_([s.id for s in shifts]),
                func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES + PENDING_STATUSES),
            ).order_by(func.lower(User.first_name), func.lower(User.last_name))
        )).all():
            if (req.status or "").lower() in ASSIGNED_STATUSES:
                booked[req.shift_id].append(_person(person))
                newest[req.shift_id] = _latest(newest.get(req.shift_id), req.updated_at, person.updated_at)
            else:
                waiting[req.shift_id] += 1
                newest[req.shift_id] = _latest(newest.get(req.shift_id), req.updated_at)
    locations = await load_locations(db, [e.location_id for e in events])

    def staffing(group: List[Shift]) -> Tuple[int, int, int, List[str]]:
        by_role = {}
        for s in sorted(group, key=lambda x: (as_utc(x.start_time), (x.role_type or "").lower())):
            role = _clean(s.role_type) or "Shift"
            r = by_role.setdefault(role, {"cap": 0, "names": []})
            r["cap"] += s.capacity if s.capacity is not None else 1
            r["names"] += booked.get(s.id, [])
        cap = sum(r["cap"] for r in by_role.values())
        filled = sum(len(r["names"]) for r in by_role.values())
        asks = sum(waiting.get(s.id, 0) for s in group)
        lines = [f"{role} {len(r['names'])}/{r['cap']}" + (": " + ", ".join(r["names"]) if r["names"] else "")
                 for role, r in by_role.items()]
        return cap, filled, asks, lines

    def make(uid, title, start, end, venue, location, group, draft, link, notes, stamps) -> Entry:
        cap, filled, asks, role_lines = staffing(group)
        count = f"({filled}/{cap} filled)" if cap else "(no positions yet)"
        summary = " ".join(x for x in (TAG_DRAFT if draft else "", f"{venue.name}:" if show_venue else "", title, count) if x)
        body = [venue.name, f"{when_text(start, end, venue.timezone)} (venue time)"]
        if draft:
            body.append("Draft: not posted to staff yet.")
        if cap:
            open_spots = max(0, cap - filled)
            body.append(f"Staffing: {filled} of {cap} filled" + (f", {open_spots} open" if open_spots else ""))
            body += role_lines
        if asks:
            body.append(f"{asks} request{'s' if asks != 1 else ''} waiting for an answer")
        if _clean(notes):
            body.append(f"Notes: {_clean(notes)}")
        url = app_link(link)
        if url:
            body += ["", f"Open in ShiftBoard: {url}"]
        return Entry(
            uid=uid, start=start, end=end, summary=summary, description=body, location=_place(venue, location), url=url,
            tentative=draft, busy=False,
            modified=_latest(*stamps, venue.updated_at, location.updated_at if location is not None else None,
                             *(s.updated_at for s in group), *(newest.get(s.id) for s in group)),
        )

    by_event = defaultdict(list)
    for s in shifts:
        if s.event_id:
            by_event[s.event_id].append(s)

    out: List[Entry] = []
    for e in events:
        venue = venues.get(e.venue_id)
        if venue is None:
            continue
        link = "/lead" if lead else f"/venue?venue={e.venue_id}&event={e.id}"
        out.append(make(
            f"event-{e.id}@shiftboard", _clean(e.title) or "Event", e.start_time, e.end_time, venue,
            locations.get(e.location_id) if e.location_id else None, by_event.get(e.id, []),
            (e.status or "published").lower() == "draft", link, e.notes, (e.updated_at,),
        ))
    for s in loose:
        venue = venues.get(s.venue_id)
        if venue is None:
            continue
        role = _clean(s.role_type) or "Shift"
        title = _clean(s.title) or role
        link = "/lead" if lead else f"/venue?venue={s.venue_id}"
        out.append(make(f"shift-{s.id}@shiftboard", title, s.start_time, s.end_time, venue, None, [s], False, link,
                        s.description, ()))
    out.sort(key=lambda x: (as_utc(x.start), x.uid))
    return out[:MAX_ENTRIES]


# ------------------------------------------------------------------------------------------------
# One feed
# ------------------------------------------------------------------------------------------------
async def build_feed(db: AsyncSession, feed: CalendarFeed, now: Optional[datetime] = None) -> str:
    """The calendar text for one link. Access is worked out again here, every time."""
    now = now or datetime.now(timezone.utc)
    user = await db.get(User, feed.user_id)
    scope = None
    if user is not None and user.is_active:
        scope = next((s for s in await scopes_for(db, user) if s.scope_key == feed.scope_key), None)
    if scope is None:
        return render("ShiftBoard (no longer available)",
                      "This calendar isn't available to this account any more. Remove it from your calendar app.", [])
    if scope.kind == CalendarKind.worker.value:
        entries = await worker_entries(db, user, feed, now)
    else:
        entries = await venue_entries(
            db, scope.venue_ids, show_venue=scope.kind != CalendarKind.venue.value,
            drafts=bool(feed.include_drafts), lead=scope.shift_lead, now=now,
        )
    return render(f"ShiftBoard: {scope.name}", scope.description, entries)


async def feed_text(db: AsyncSession, feed: CalendarFeed) -> Tuple[str, str]:
    """(body, etag), built at most once a minute per link."""
    token, version = feed.token, feed.updated_at     # a saved change to the link (its switches) makes a new version
    hit = _CACHE.get(token)
    stamp = time.monotonic()
    if hit and hit[0] > stamp and hit[1] == version:
        return hit[3], hit[2]
    body = await build_feed(db, feed)
    etag = '"' + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32] + '"'
    if len(_CACHE) >= CACHE_LINKS:
        for key in [k for k, v in _CACHE.items() if v[0] <= stamp]:
            _CACHE.pop(key, None)
        if len(_CACHE) >= CACHE_LINKS:
            _CACHE.clear()
    _CACHE[token] = (stamp + CACHE_SECONDS, version, etag, body)
    return body, etag


def etag_matches(header: Optional[str], etag: str) -> bool:
    """If-None-Match: a list of tags, weak or strong, or *."""
    wanted = etag.strip('"')
    for part in (header or "").split(","):
        tag = part.strip()
        if not tag:
            continue
        if tag == "*":
            return True
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag.strip('"') == wanted:
            return True
    return False
```

---

## B2. NEW FILE `backend/src/routers/calendar_sync.py`
The settings endpoints (signed in). The first line is `"""` and the **last line is `    return Response(status_code=status.HTTP_204_NO_CONTENT)`**.

```python
"""
Phase 36.1: Calendar sync settings (Profile -> Calendar sync). Every account type.

  GET    /api/me/calendar-links               the calendars this person may connect, and the ones that are on
  POST   /api/me/calendar-links               turn one on (makes its private link)
  PUT    /api/me/calendar-links/{id}          what it includes
  POST   /api/me/calendar-links/{id}/reset    a new link; the old one stops working
  DELETE /api/me/calendar-links/{id}          turn it off

The feed itself (no sign-in, the token is the credential) is GET /api/public/calendar/{token}.ics in
routers/public.py. services/calendar_feeds.py decides who may have which calendar and what goes in it.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_current_user
from src.config import settings
from src.database import get_db
from src.models import CalendarFeed, CalendarKind, User
from src.schemas import CalendarLink, CalendarLinkCreate, CalendarLinks, CalendarLinkUpdate
from src.services.calendar_feeds import (
    ALL_OPTIONS, address_ok, clear_cache, lost_link, new_token, scope_key_for, scopes_for, to_link,
)
from src.services.invites import public_base

router = APIRouter(prefix="/api/me/calendar-links", tags=["Calendar sync"])

OFF = "Calendar sync is turned off on this site."
KINDS = tuple(k.value for k in CalendarKind)


def _require_on() -> None:
    if not settings.CALENDAR_SYNC:
        raise HTTPException(status_code=404, detail=OFF)


async def _own_feed(db: AsyncSession, user: User, feed_id: UUID) -> CalendarFeed:
    feed = await db.get(CalendarFeed, feed_id)
    if feed is None or feed.user_id != user.id:
        raise HTTPException(status_code=404, detail="That calendar link doesn't exist any more.")
    return feed


async def _scope_of(db: AsyncSession, user: User, scope_key: str):
    scope = next((s for s in await scopes_for(db, user) if s.scope_key == scope_key), None)
    if scope is None:
        raise HTTPException(status_code=403, detail="That calendar isn't available to your account.")
    return scope


@router.get("", response_model=CalendarLinks)
async def my_calendar_links(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.CALENDAR_SYNC:
        return CalendarLinks(enabled=False, public_address_ok=True, calendars=[])
    base = public_base(request)
    feeds = {f.scope_key: f for f in (await db.execute(
        select(CalendarFeed).where(CalendarFeed.user_id == current_user.id)
    )).scalars().all()}
    scopes = await scopes_for(db, current_user)
    calendars = [to_link(s, feeds.get(s.scope_key), base) for s in scopes]
    # links for calendars they can no longer have: still listed, so they can be turned off
    have = {s.scope_key for s in scopes}
    for key in sorted(k for k in feeds if k not in have):
        calendars.append(await lost_link(db, feeds[key]))
    return CalendarLinks(enabled=True, public_address_ok=address_ok(base), calendars=calendars)


@router.post("", response_model=CalendarLink, status_code=status.HTTP_201_CREATED)
async def turn_on_calendar_link(
    body: CalendarLinkCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_on()
    kind = (body.kind or "").strip().lower()
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="Pick one of the calendars on the list.")
    key = scope_key_for(kind, body.venue_id, body.organization_id)
    if key is None:
        raise HTTPException(status_code=400, detail="Pick which venue or organization the calendar is for.")
    scope = await _scope_of(db, current_user, key)
    user_id = current_user.id

    existing = await db.scalar(select(CalendarFeed).where(CalendarFeed.user_id == user_id, CalendarFeed.scope_key == key))
    if existing is not None:
        return to_link(scope, existing, public_base(request))
    try:
        feed = CalendarFeed(
            user_id=user_id, kind=scope.kind, scope_key=scope.scope_key, venue_id=scope.venue_id,
            organization_id=scope.organization_id, token=new_token(),
        )
        db.add(feed)
        await db.commit()
        await db.refresh(feed)
    except IntegrityError:
        # two taps at once: the other one made it
        await db.rollback()
        feed = await db.scalar(select(CalendarFeed).where(CalendarFeed.user_id == user_id, CalendarFeed.scope_key == key))
        if feed is None:
            raise HTTPException(status_code=409, detail="Couldn't turn that calendar on. Try again.")
    except Exception:
        await db.rollback()
        raise
    return to_link(scope, feed, public_base(request))


@router.put("/{feed_id}", response_model=CalendarLink)
async def update_calendar_link(
    feed_id: UUID,
    body: CalendarLinkUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_on()
    feed = await _own_feed(db, current_user, feed_id)
    scope = await _scope_of(db, current_user, feed.scope_key)
    changes = body.model_dump(exclude_unset=True)
    try:
        for name in ALL_OPTIONS:
            if name in changes and changes[name] is not None and name in scope.options:
                setattr(feed, name, bool(changes[name]))
        feed.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(feed)
    except Exception:
        await db.rollback()
        raise
    clear_cache(feed.token)
    return to_link(scope, feed, public_base(request))


@router.post("/{feed_id}/reset", response_model=CalendarLink)
async def reset_calendar_link(
    feed_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A new private address. The old one stops working at once, wherever it was added."""
    _require_on()
    feed = await _own_feed(db, current_user, feed_id)
    scope = await _scope_of(db, current_user, feed.scope_key)
    old = feed.token
    try:
        feed.token = new_token()
        feed.last_fetched_at = None
        feed.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(feed)
    except Exception:
        await db.rollback()
        raise
    clear_cache(old)
    return to_link(scope, feed, public_base(request))


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
async def turn_off_calendar_link(
    feed_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Works even when CALENDAR_SYNC is off, and for a calendar the person can no longer have."""
    feed = await _own_feed(db, current_user, feed_id)
    token = feed.token
    try:
        await db.delete(feed)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    clear_cache(token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

---

## B3. NEW FILE `database/upgrades/0.36.1.sql`
The "keep your data" SQL for this version. The `database/upgrades/` folder already exists. **Create the file; do not run it.** The first line is `-- ShiftBoard database upgrade: 0.36.0 -> 0.36.1 (Phase 36.1, calendar sync). Keeps all your data.` and the **last line is `COMMIT;`**.

```sql
-- ShiftBoard database upgrade: 0.36.0 -> 0.36.1 (Phase 36.1, calendar sync). Keeps all your data.
-- Safe to run more than once. Only needed if you did NOT wipe the database (docker compose down -v).
-- Run it from the repository root, in each stack's folder:
--
--   PowerShell:  Get-Content database\upgrades\0.36.1.sql | docker compose exec -T database sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB'
--   bash:        docker compose exec -T database sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < database/upgrades/0.36.1.sql
--
-- It should end with COMMIT.
BEGIN;

CREATE TABLE IF NOT EXISTS calendar_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,
    scope_key VARCHAR(60) NOT NULL,
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    include_requested BOOLEAN NOT NULL DEFAULT TRUE,
    include_waitlist BOOLEAN NOT NULL DEFAULT TRUE,
    include_offers BOOLEAN NOT NULL DEFAULT TRUE,
    include_time_off BOOLEAN NOT NULL DEFAULT TRUE,
    include_drafts BOOLEAN NOT NULL DEFAULT FALSE,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_calendar_feed_scope UNIQUE (user_id, scope_key)
);

-- The backend makes this table by itself when 0.36.1 first starts, but without the database defaults.
-- These lines add them (and change nothing otherwise).
ALTER TABLE calendar_feeds ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE calendar_feeds ALTER COLUMN include_requested SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_waitlist SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_offers SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_time_off SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_drafts SET DEFAULT FALSE;
ALTER TABLE calendar_feeds ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE calendar_feeds ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_calendar_feeds_user ON calendar_feeds(user_id);

COMMIT;
```

---

# PART C: Backend, edits

## C1. `backend/src/main.py` (2 EDITS)
One import and one `include_router` line. Nothing else in this file.

**Edit 1.** Find:
```python
from src.routers.organizations import router as organizations_router   # Phase 36
from src.routers.lead import router as lead_router                 # Phase 36
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```
Replace with:
```python
from src.routers.organizations import router as organizations_router   # Phase 36
from src.routers.lead import router as lead_router                 # Phase 36
from src.routers.calendar_sync import router as calendar_sync_router   # Phase 36.1
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```

**Edit 2.** Find:
```python
app.include_router(organizations_router) # Phase 36
app.include_router(lead_router)          # Phase 36


@app.get("/healthz", tags=["System"])
```
Replace with:
```python
app.include_router(organizations_router) # Phase 36
app.include_router(lead_router)          # Phase 36
app.include_router(calendar_sync_router) # Phase 36.1


@app.get("/healthz", tags=["System"])
```

---

## C2. `backend/src/config.py` (1 EDIT)
The new setting, right after `PUBLIC_EVENT_BOARD`.

**Edit 1.** Find:
```python
    # with a Sign in / Sign up button. false = the home page is the sign-in page, as before.
    PUBLIC_EVENT_BOARD: bool = os.getenv("PUBLIC_EVENT_BOARD", "false").lower() in ("true", "1", "yes")
    # Phase 28.1: emails that are always platform admins (comma-separated)
    ALWAYS_ADMIN_EMAILS: str = os.getenv("ALWAYS_ADMIN_EMAILS", "")
```
Replace with:
```python
    # with a Sign in / Sign up button. false = the home page is the sign-in page, as before.
    PUBLIC_EVENT_BOARD: bool = os.getenv("PUBLIC_EVENT_BOARD", "false").lower() in ("true", "1", "yes")
    # Phase 36.1: true = people can connect their shifts to Google / Apple / Outlook with a private calendar link
    # (Profile -> Calendar sync). false = the links stop working and the settings are hidden.
    CALENDAR_SYNC: bool = os.getenv("CALENDAR_SYNC", "true").lower() in ("true", "1", "yes")
    # Phase 28.1: emails that are always platform admins (comma-separated)
    ALWAYS_ADMIN_EMAILS: str = os.getenv("ALWAYS_ADMIN_EMAILS", "")
```

---

## C3. `backend/src/schemas.py` (1 EDIT)
Four new models appended at the end of the file.

**Edit 1.** Find:
```python
    public_board: bool = False
    self_registration: bool = True
```
Replace with:
```python
    public_board: bool = False
    self_registration: bool = True


# ------------------------------------------------------------------------------
# Phase 36.1: Calendar sync (private subscription links)
# ------------------------------------------------------------------------------
class CalendarLink(BaseModel):
    """One calendar this person can connect. `id` and the addresses are None until they turn it on."""
    kind: str                                # worker | manager | venue | organization | admin
    scope_key: str
    name: str
    description: str
    venue_id: Optional[UUID] = None
    organization_id: Optional[UUID] = None
    shift_lead: bool = False                 # a venue calendar a shift lead gets (never drafts)
    available: bool = True                   # False = they turned it on, then lost access: empty calendar, can only be turned off
    options: List[str] = []                  # which include_* switches apply to this calendar
    id: Optional[UUID] = None                # set = turned on
    url: Optional[str] = None                # https address of the feed
    webcal_url: Optional[str] = None         # same address as webcal:// (Apple Calendar and most phone apps)
    google_url: Optional[str] = None
    outlook_url: Optional[str] = None        # outlook.com
    office_url: Optional[str] = None         # Microsoft 365 (work or school)
    include_requested: bool = True
    include_waitlist: bool = True
    include_offers: bool = True
    include_time_off: bool = True
    include_drafts: bool = False
    last_fetched_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class CalendarLinks(BaseModel):
    enabled: bool = True                     # CALENDAR_SYNC
    public_address_ok: bool = True           # False = the site address is local, so Google / Outlook can't reach it
    calendars: List[CalendarLink] = []


class CalendarLinkCreate(BaseModel):
    kind: str
    venue_id: Optional[UUID] = None
    organization_id: Optional[UUID] = None


class CalendarLinkUpdate(BaseModel):
    include_requested: Optional[bool] = None
    include_waitlist: Optional[bool] = None
    include_offers: Optional[bool] = None
    include_time_off: Optional[bool] = None
    include_drafts: Optional[bool] = None
```

---

## C4. `backend/src/routers/public.py` (2 EDITS)
The feed endpoint: the one new endpoint with no sign-in. The two existing endpoints are not changed.

**Edit 1.** Find:
```python
"""
Phase 36: endpoints that need NO sign-in.
  GET /api/public/config   what the web app needs before anyone signs in
  GET /api/public/board    the public event board (404 unless PUBLIC_EVENT_BOARD is on)

Nothing here may return pay, addresses, notes, people's names or ids of anything but the event.
See services/public_board.py for exactly what is shown.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.schemas import PublicBoard, PublicConfig
from src.services.public_board import DEFAULT_DAYS, MAX_DAYS, build_public_board

router = APIRouter(prefix="/api/public", tags=["Public"])
```
Replace with:
```python
"""
Phase 36: endpoints that need NO sign-in.
  GET /api/public/config                  what the web app needs before anyone signs in
  GET /api/public/board                   the public event board (404 unless PUBLIC_EVENT_BOARD is on)
  GET /api/public/calendar/{token}.ics    Phase 36.1: one person's private calendar link (404 unless CALENDAR_SYNC is on)

config and board may never return pay, addresses, notes, people's names or ids of anything but the event.
See services/public_board.py for exactly what is shown.

The calendar link is different: its long random token IS the sign-in, and it shows what its owner may see
(services/calendar_feeds.py decides, again each time a feed is built). It never returns pay either.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.models import CalendarFeed
from src.schemas import PublicBoard, PublicConfig
from src.services.calendar_feeds import FETCH_STAMP_EVERY, TOKEN_RE, etag_matches, feed_text
from src.services.public_board import DEFAULT_DAYS, MAX_DAYS, build_public_board

router = APIRouter(prefix="/api/public", tags=["Public"])
```

**Edit 2.** Find:
```python
        raise HTTPException(status_code=404, detail="The public board is turned off.")
    return await build_public_board(db, days)
```
Replace with:
```python
        raise HTTPException(status_code=404, detail="The public board is turned off.")
    return await build_public_board(db, days)


@router.get("/calendar/{token}.ics", response_class=Response)
@router.head("/calendar/{token}.ics", include_in_schema=False)
async def calendar_feed(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Phase 36.1: the iCalendar feed behind a private calendar link. Calendar apps read this on their own."""
    missing = HTTPException(status_code=404, detail="This calendar link doesn't work any more.")
    if not settings.CALENDAR_SYNC or not TOKEN_RE.match(token or ""):
        raise missing
    feed = await db.scalar(select(CalendarFeed).where(CalendarFeed.token == token))
    if feed is None:
        raise missing
    feed_id, last = feed.id, feed.last_fetched_at
    body, etag = await feed_text(db, feed)

    now = datetime.now(timezone.utc)
    if last is None or now - (last if last.tzinfo else last.replace(tzinfo=timezone.utc)) > FETCH_STAMP_EVERY:
        try:
            # updated_at is set to itself so "last read" doesn't count as a change to the link.
            # Matching the token too means a link that was reset a moment ago isn't marked as read.
            await db.execute(update(CalendarFeed).where(CalendarFeed.id == feed_id, CalendarFeed.token == token)
                             .values(last_fetched_at=now, updated_at=CalendarFeed.updated_at))
            await db.commit()
        except Exception:
            await db.rollback()

    headers = {
        "ETag": etag,
        "Cache-Control": "private, no-cache",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Disposition": 'inline; filename="shiftboard.ics"',
    }
    if etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    if request.method == "HEAD":
        headers["Content-Length"] = str(len(body.encode("utf-8")))     # what a GET would send
        return Response(content=b"", media_type="text/calendar; charset=utf-8", headers=headers)
    return Response(content=body, media_type="text/calendar; charset=utf-8", headers=headers)
```

---

# PART D: Frontend

## D1. NEW FILE `frontend/src/components/profile/CalendarSyncPanel.jsx`
The settings panel. State: `busy`, `confirm`, `pick` in the panel; `copied`, `help` in each card. Calls: `POST /me/calendar-links`, `PUT /me/calendar-links/{id}`, `POST /me/calendar-links/{id}/reset`, `DELETE /me/calendar-links/{id}`. The first line is `import React, { useRef, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useRef, useState } from 'react';
import {
  CalendarPlus, CalendarCheck, Copy, Check, RefreshCw, PowerOff, ExternalLink, Smartphone, Info, AlertTriangle, Lock,
  Briefcase, Building2, Network, Shield, ClipboardCheck, ChevronDown,
} from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';

const KIND = {
  worker: { label: 'Worker calendar', icon: Briefcase, tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  manager: { label: 'Manager calendar', icon: Building2, tone: 'text-teal-300 bg-teal-500/10 border-teal-500/30' },
  venue: { label: 'Venue calendar', icon: Building2, tone: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
  organization: { label: 'Organization calendar', icon: Network, tone: 'text-violet-300 bg-violet-500/10 border-violet-500/30' },
  admin: { label: 'Admin calendar', icon: Shield, tone: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30' },
};
const OPTION_TEXT = {
  include_requested: ['Shifts I asked for', '[REQUESTED]'],
  include_waitlist: ['Shifts I am waitlisted for', '[WAITLIST]'],
  include_offers: ["Offers I haven't answered", '[OFFERED]'],
  include_time_off: ['My time off', null],
  include_drafts: ['Draft events', '[DRAFT]'],
};
const TAGS = [
  ['[Confirmed]', 'You are booked.', 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10'],
  ['[REQUESTED]', 'You asked; the venue has not answered.', 'text-amber-200 border-amber-500/40 bg-amber-500/10'],
  ['[WAITLIST]', 'You are in line for a full position.', 'text-slate-200 border-slate-600 bg-slate-800'],
  ['[OFFERED]', 'Offered to you; answer in ShiftBoard.', 'text-sky-200 border-sky-500/40 bg-sky-500/10'],
];
const MANY_VENUES = 4;   // more venue calendars than this (admins) -> a picker instead of a long list

function agoText(value) {
  if (!value) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const btn = 'px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition';
const addBtn = `${btn} bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700`;

function CalendarCard({ cal, busy, onTurnOn, onOption, onAskReset, onAskOff }) {
  const [copied, setCopied] = useState('');   // '' | 'yes' | 'manual' (couldn't copy: the link is selected instead)
  const [help, setHelp] = useState(false);
  const input = useRef(null);
  const meta = cal.shift_lead ? { ...KIND.venue, label: 'Venue calendar · shift lead', icon: ClipboardCheck } : (KIND[cal.kind] || KIND.venue);
  const Icon = meta.icon;
  const on = !!cal.id;

  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(cal.url);
      done = true;
    } catch (err) {
      input.current?.select();
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
    }
    if (!done) input.current?.select();        // leave it selected so they can copy it themselves
    setCopied(done ? 'yes' : 'manual');
    setTimeout(() => setCopied(''), 4000);
  };

  // They turned this calendar on, then lost access to it (the link now shows an empty calendar).
  if (cal.available === false) {
    return (
      <div className="p-4 rounded-2xl border bg-slate-900 border-amber-500/30" data-calendar={cal.scope_key}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 text-amber-300 bg-amber-500/10 border-amber-500/30">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-white break-words">{cal.name}</h3>
                <span className="px-2 py-0.5 rounded-full border text-[10px] font-bold text-amber-300 bg-amber-500/10 border-amber-500/30">No longer available</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{cal.description}</p>
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => onAskOff(cal)}
            className={`${btn} bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 flex-shrink-0`}>
            <PowerOff className="w-3.5 h-3.5" /> Turn off
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-2xl border ${on ? 'bg-slate-900 border-emerald-700/50' : 'bg-slate-900 border-slate-800'}`} data-calendar={cal.scope_key}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${meta.tone}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white break-words">{cal.name}</h3>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.tone}`}>{meta.label}</span>
              {on && <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black">ON</span>}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{cal.description}</p>
          </div>
        </div>
        {!on && (
          <button type="button" disabled={busy} onClick={() => onTurnOn(cal)}
            className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50 flex-shrink-0`}>
            <CalendarPlus className="w-4 h-4" /> Turn on
          </button>
        )}
      </div>

      {on && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Add it to your calendar</p>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <a href={cal.google_url} target="_blank" rel="noopener noreferrer" className={addBtn}><ExternalLink className="w-3.5 h-3.5" /> Google Calendar</a>
              <a href={cal.webcal_url} className={addBtn}><Smartphone className="w-3.5 h-3.5" /> Apple / iPhone</a>
              <a href={cal.outlook_url} target="_blank" rel="noopener noreferrer" className={addBtn}><ExternalLink className="w-3.5 h-3.5" /> Outlook.com</a>
              <a href={cal.office_url} target="_blank" rel="noopener noreferrer" className={addBtn}><ExternalLink className="w-3.5 h-3.5" /> Microsoft 365</a>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500" htmlFor={`cal-url-${cal.id}`}>Or copy the private link (any calendar app)</label>
            <div className="mt-1.5 flex gap-2">
              <input id={`cal-url-${cal.id}`} ref={input} readOnly value={cal.url} onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-300 font-mono" />
              <button type="button" onClick={copy} className={`${btn} ${copied === 'yes' ? 'bg-emerald-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700'} flex-shrink-0`}>
                {copied === 'yes' ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
              </button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">{copied === 'yes' ? 'Link copied.' : ''}</p>
            {copied === 'manual' && (
              <p className="mt-1.5 text-[11px] text-amber-200" role="status">Your browser didn't allow copying. The link is selected: copy it with your keyboard or the menu.</p>
            )}
            <button type="button" onClick={() => setHelp((v) => !v)} aria-expanded={help}
              className="mt-1.5 text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1">
              <ChevronDown className={`w-3 h-3 transition ${help ? 'rotate-180' : ''}`} /> Where do I paste it?
            </button>
            {help && (
              <ul className="mt-1.5 text-[11px] text-slate-400 space-y-1 list-disc pl-4">
                <li><b className="text-slate-300">Google Calendar</b> (on a computer): Other calendars → + → From URL.</li>
                <li><b className="text-slate-300">iPhone / iPad</b>: Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar.</li>
                <li><b className="text-slate-300">Mac Calendar</b>: File → New Calendar Subscription.</li>
                <li><b className="text-slate-300">Outlook</b>: Add calendar → Subscribe from web.</li>
              </ul>
            )}
          </div>

          {cal.options.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
                {cal.kind === 'worker' ? 'Also show (confirmed shifts are always shown)' : 'Also show'}
              </p>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {cal.options.map((name) => (
                  <label key={name} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-200 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={!!cal[name]}
                      onChange={(e) => onOption(cal, name, e.target.checked)} />
                    <span>{OPTION_TEXT[name]?.[0] || name}</span>
                    {OPTION_TEXT[name]?.[1] && <span className="ml-auto font-mono text-[10px] text-slate-500">{OPTION_TEXT[name][1]}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <p className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
              <CalendarCheck className="w-3.5 h-3.5 text-slate-500" />
              {cal.last_fetched_at ? `A calendar app last read this ${agoText(cal.last_fetched_at)}.` : "No calendar app has read this yet. Add it with one of the buttons above."}
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => onAskReset(cal)} className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50`}>
                <RefreshCw className="w-3.5 h-3.5" /> Reset link
              </button>
              <button type="button" disabled={busy} onClick={() => onAskOff(cal)} className={`${btn} bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50`}>
                <PowerOff className="w-3.5 h-3.5" /> Turn off
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Phase 36.1: Profile -> Calendar sync. Every account type.
 * Each calendar the person may have (the server decides, by role) can be turned on. That makes a private link
 * (an iCalendar feed) that Google, Apple, Outlook or any calendar app subscribes to. One-way, and never any pay.
 * Props: data ({ enabled, public_address_ok, calendars }), onData(next), onSaved(message), onError(message)
 */
export default function CalendarSyncPanel({ data, onData, onSaved, onError }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [pick, setPick] = useState('');
  const calendars = data?.calendars || [];

  const replace = (next) => onData({ ...data, calendars: calendars.map((c) => (c.scope_key === next.scope_key ? next : c)) });
  // quiet = the confirm dialog shows the error itself
  const run = async (fn, okText, quiet = false) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) replace(next);
      if (okText) onSaved?.(okText);
    } catch (err) {
      if (!quiet) onError?.(err.response?.data?.detail || 'Could not save that. Try again.');
      throw err;
    } finally {
      setBusy(false);
    }
  };
  const remove = (cal) => onData({ ...data, calendars: calendars.filter((c) => c.scope_key !== cal.scope_key) });

  const turnOn = (cal) => run(async () => (await api.post('/me/calendar-links', {
    kind: cal.kind, venue_id: cal.venue_id, organization_id: cal.organization_id,
  })).data, `${cal.name} is on. Add it to your calendar with one of the buttons.`).catch(() => {});
  const setOption = (cal, name, value) => {
    replace({ ...cal, [name]: value });          // tick the box right away; put it back if the save fails
    return run(async () => (await api.put(`/me/calendar-links/${cal.id}`, { [name]: value })).data,
      'Saved. Your calendar app picks it up the next time it checks.').catch(() => replace(cal));
  };
  const askReset = (cal) => setConfirm({
    title: 'Reset this link?',
    message: `"${cal.name}" gets a new private link. The old one stops working right away, so the calendar will stop updating wherever you added it until you add the new link. Do this if the link was shared by mistake.`,
    confirmLabel: 'Reset link',
    danger: true,
    onConfirm: () => run(async () => (await api.post(`/me/calendar-links/${cal.id}/reset`)).data, 'New link made. Add it to your calendar again.', true),
  });
  const askOff = (cal) => setConfirm({
    title: 'Turn this calendar off?',
    message: `"${cal.name}" stops updating everywhere you added it. Remove it from your calendar app too, or the old entries may stay there.`,
    confirmLabel: 'Turn off',
    danger: true,
    onConfirm: () => run(async () => {
      await api.delete(`/me/calendar-links/${cal.id}`);
      if (cal.available === false) {
        remove(cal);          // it can't be turned on again, so it leaves the list
        return null;
      }
      return {
        ...cal, id: null, url: null, webcal_url: null, google_url: null, outlook_url: null, office_url: null, last_fetched_at: null,
      };
    }, `${cal.name} is off.`, true),
  });

  if (!data) {
    return <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center text-sm text-slate-500">Loading your calendars…</div>;
  }
  if (!data.enabled) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center text-sm text-slate-400">
        Calendar sync is turned off on this site.
      </div>
    );
  }

  const isVenueOff = (c) => c.kind === 'venue' && !c.id && c.available !== false;
  const offVenues = calendars.filter(isVenueOff);
  const usePicker = offVenues.length > MANY_VENUES;
  const shown = usePicker ? calendars.filter((c) => !isVenueOff(c)) : calendars;
  const hasWorker = calendars.some((c) => c.kind === 'worker');
  const picked = offVenues.find((c) => c.scope_key === pick);

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <CalendarPlus className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Calendar sync</h2>
            <p className="text-sm text-slate-300">
              See your {hasWorker ? 'shifts' : 'events'} in Google Calendar, Apple Calendar, Outlook or any other calendar app. Turn a calendar on, add it once, and it keeps itself up to date.
            </p>
          </div>
        </div>
        {hasWorker && (
          <div className="grid sm:grid-cols-2 gap-1.5">
            {TAGS.map(([tag, text, tone]) => (
              <div key={tag} className="flex items-center gap-2 text-xs text-slate-300">
                <span className={`px-2 py-0.5 rounded-md border font-mono text-[11px] font-bold ${tone}`}>{tag}</span> {text}
              </div>
            ))}
          </div>
        )}
        <ul className="text-xs text-slate-400 space-y-1.5">
          <li className="flex items-start gap-2"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            It works one way. Changing or deleting an entry in your calendar app does not change anything in ShiftBoard.</li>
          <li className="flex items-start gap-2"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            Your calendar app decides how often it checks: usually every few hours, and Google can take up to a day. For last-minute changes rely on ShiftBoard notifications.</li>
          <li className="flex items-start gap-2"><Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            Pay is never put in a calendar. Each link is private: anyone who has it can see that calendar, so don't share it. If it gets out, use Reset link.</li>
        </ul>
      </div>

      {!data.public_address_ok && (
        <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs text-amber-100 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400" />
          <span>This site is on a local or non-secure address. Google and Outlook read calendars from their own servers and can't reach it, so the buttons only work once the site has a public https address.</span>
        </div>
      )}

      {calendars.length === 0 && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center text-sm text-slate-400">
          There's no calendar for your account yet. Once you manage a venue, its calendar shows up here.
        </div>
      )}

      {shown.map((cal) => (
        <CalendarCard key={cal.scope_key} cal={cal} busy={busy} onTurnOn={turnOn} onOption={setOption} onAskReset={askReset} onAskOff={askOff} />
      ))}

      {usePicker && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <label htmlFor="calendar-venue-pick" className="text-sm font-bold text-white">A calendar for one venue</label>
          <p className="text-xs text-slate-400 mt-0.5">Every event at that venue, with who is booked.</p>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <select id="calendar-venue-pick" value={pick} onChange={(e) => setPick(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">Pick a venue…</option>
              {offVenues.map((c) => <option key={c.scope_key} value={c.scope_key}>{c.name}</option>)}
            </select>
            <button type="button" disabled={busy || !picked} onClick={() => { turnOn(picked); setPick(''); }}
              className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50`}>
              <CalendarPlus className="w-4 h-4" /> Turn on
            </button>
          </div>
        </div>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
```

---

## D2. `frontend/src/pages/ProfilePage.jsx` (7 EDITS)
New state `calendars` (`useState(null)`), loaded once with `GET /me/calendar-links`; a **Calendar sync** tab for every account type (hidden when the setting is off).

**Edit 1.** Find:
```jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserRound, CalendarDays, CalendarOff, Award, Bell, Check, AlertCircle, X, CircleDot } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserRound, CalendarDays, CalendarOff, CalendarPlus, Award, Bell, Check, AlertCircle, X, CircleDot } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
```

**Edit 2.** Find:
```jsx
import TimeOffPanel from '../components/profile/TimeOffPanel';
import CertificatesPanel from '../components/profile/CertificatesPanel';
import NotificationSettingsModal from '../components/NotificationSettingsModal';

const MISSING_TEXT = {
```
Replace with:
```jsx
import TimeOffPanel from '../components/profile/TimeOffPanel';
import CertificatesPanel from '../components/profile/CertificatesPanel';
import CalendarSyncPanel from '../components/profile/CalendarSyncPanel';   // Phase 36.1
import NotificationSettingsModal from '../components/NotificationSettingsModal';

const MISSING_TEXT = {
```

**Edit 3.** Find:
```jsx
/**
 * Phase 31 + 32: The signed-in person's profile.
 * Tabs (?tab=): about · availability · time-off · certificates · notifications. Workers see all of them;
 * managers and admins see About and Notifications.
 */
export default function ProfilePage() {
```
Replace with:
```jsx
/**
 * Phase 31 + 32: The signed-in person's profile.
 * Tabs (?tab=): about · availability · time-off · certificates · calendar · notifications. Workers see all of them;
 * managers and admins see About, Calendar sync and Notifications.
 * Phase 36.1: Calendar sync is for every account type (hidden when CALENDAR_SYNC is off).
 */
export default function ProfilePage() {
```

**Edit 4.** Find:
```jsx
  const [notice, setNotice] = useState(null);   // { type, text }
  const [showNotif, setShowNotif] = useState(false);

  const load = async () => {
```
Replace with:
```jsx
  const [notice, setNotice] = useState(null);   // { type, text }
  const [showNotif, setShowNotif] = useState(false);
  const [calendars, setCalendars] = useState(null);   // Phase 36.1: { enabled, public_address_ok, calendars } (null = not loaded)

  const load = async () => {
```

**Edit 5.** Find:
```jsx
  useEffect(() => {
    load();
  }, []);

  const isWorker = profile?.role === 'worker';
```
Replace with:
```jsx
  useEffect(() => {
    load();
    // Phase 36.1: which calendars this account may connect. A failure just hides the tab.
    api.get('/me/calendar-links')
      .then((res) => setCalendars(res.data))
      .catch(() => setCalendars({ enabled: false, public_address_ok: true, calendars: [] }));
  }, []);

  const isWorker = profile?.role === 'worker';
```

**Edit 6.** Find:
```jsx
    isWorker && { id: 'time-off', label: 'Time off', icon: CalendarOff },   // Phase 32.1: blocks, nothing to wait for
    isWorker && { id: 'certificates', label: 'Certificates', icon: Award, badge: (profile?.certifications || []).filter((c) => c.expired || c.status === 'rejected').length },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ].filter(Boolean);
```
Replace with:
```jsx
    isWorker && { id: 'time-off', label: 'Time off', icon: CalendarOff },   // Phase 32.1: blocks, nothing to wait for
    isWorker && { id: 'certificates', label: 'Certificates', icon: Award, badge: (profile?.certifications || []).filter((c) => c.expired || c.status === 'rejected').length },
    (calendars === null || calendars.enabled) && { id: 'calendar', label: 'Calendar sync', icon: CalendarPlus },   // Phase 36.1
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ].filter(Boolean);
```

**Edit 7.** Find:
```jsx
          <CertificatesPanel certifications={profile.certifications} types={profile.cert_types} onChanged={reload} onError={fail} />
        )}
        {tab === 'notifications' && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
```
Replace with:
```jsx
          <CertificatesPanel certifications={profile.certifications} types={profile.cert_types} onChanged={reload} onError={fail} />
        )}
        {tab === 'calendar' && <CalendarSyncPanel data={calendars} onData={setCalendars} onSaved={ok} onError={fail} />}
        {tab === 'notifications' && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
```

---

## D3. `frontend/src/components/WorkerCalendar.jsx` (2 EDITS)
A **Sync** button in the calendar toolbar that opens `/profile?tab=calendar`.

**Edit 1.** Find:
```jsx
import React, { useMemo, useState } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths, isSameMonth, format,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, List as ListIcon, AlertTriangle, MapPin, Clock, Eye, EyeOff, ArrowRight,
} from 'lucide-react';
import { fmtTime, fmtTimeRange, fmtLongDate, tzAbbrev } from '../utils/venueTime';
```
Replace with:
```jsx
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths, isSameMonth, format,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, List as ListIcon, AlertTriangle, MapPin, Clock, Eye, EyeOff, ArrowRight, CalendarPlus,
} from 'lucide-react';
import { fmtTime, fmtTimeRange, fmtLongDate, tzAbbrev } from '../utils/venueTime';
```

**Edit 2.** Find:
```jsx
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
```
Replace with:
```jsx
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Phase 36.1: these shifts in Google / Apple / Outlook */}
          <Link to="/profile?tab=calendar" title="See these shifts in Google, Apple or Outlook calendar"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-slate-900 text-slate-400 border-slate-800 hover:text-white inline-flex items-center gap-1.5">
            <CalendarPlus className="w-3.5 h-3.5" /> Sync
          </Link>
          <button
            type="button"
```

---

# PART F: Settings templates and guides

## F1. `.env.template` (1 EDIT)

**Edit 1.** Find:
```bash
# Each venue can keep its own shifts off the board (Venue settings → List our shifts on the public board).
PUBLIC_EVENT_BOARD=false

# ------------------------------------------------------------------------------
```
Replace with:
```bash
# Each venue can keep its own shifts off the board (Venue settings → List our shifts on the public board).
PUBLIC_EVENT_BOARD=false
# true = people can see their shifts in Google Calendar, Apple Calendar, Outlook or any calendar app
# (Profile → Calendar sync). Each calendar is a private link that the calendar app reads on its own, so the
# site needs a public https address (APP_BASE_URL) for Google and Outlook to reach it. Pay is never included.
# false = the settings are hidden and every calendar link stops working (they work again when turned back on).
CALENDAR_SYNC=true

# ------------------------------------------------------------------------------
```

---

## F2. `backend/.env.template` (1 EDIT)

**Edit 1.** Find:
```bash
SHOW_DEMO_LOGINS=false
PUBLIC_EVENT_BOARD=false

# Firebase: paths relative to backend/ when running locally
```
Replace with:
```bash
SHOW_DEMO_LOGINS=false
PUBLIC_EVENT_BOARD=false
CALENDAR_SYNC=true

# Firebase: paths relative to backend/ when running locally
```

---

## F3. `agy_system_instructions.md` (1 EDIT)
One sentence added to rule 11, and rule 12 added after it (the end of the file).

**Edit 1.** Find:
```markdown
   * **Shift leads never see pay.** Nothing a lead can call may return a pay rate, tip, cost or earnings. What a lead reads lives in `routers/lead.py`, with response models that have no pay fields. Never return a manager schema (`EventTimesheet`, `EventDetail`, `ShiftRosterResponse`, ...) from an endpoint a lead can call, and never open a manager read endpoint to leads.
   * There is no venue sign-up: only platform admins create organizations and put venues in them.
11. **The public board (Phase 36):** `PUBLIC_EVENT_BOARD=true` makes the home page a public board for people who aren't signed in. `routers/public.py` is the ONLY place for endpoints that need no sign-in (besides sign-in itself, invites and avatars).
   * `GET /api/public/board` returns only: event id, title, start and end, time zone, venue name, city, and positions with open spots. Never add pay, addresses, coordinates, notes, location names, requirements, logos, venue ids or anyone's name to it.
   * Every other endpoint must depend on `get_current_user` (directly or through a `require_...` dependency). A new endpoint with no sign-in needs the user's explicit OK.
   * The frontend learns the setting from `GET /api/public/config` (`utils/publicConfig.js`). No `VITE_` variable.
```
Replace with:
```markdown
   * **Shift leads never see pay.** Nothing a lead can call may return a pay rate, tip, cost or earnings. What a lead reads lives in `routers/lead.py`, with response models that have no pay fields. Never return a manager schema (`EventTimesheet`, `EventDetail`, `ShiftRosterResponse`, ...) from an endpoint a lead can call, and never open a manager read endpoint to leads.
   * There is no venue sign-up: only platform admins create organizations and put venues in them.
11. **The public board (Phase 36):** `PUBLIC_EVENT_BOARD=true` makes the home page a public board for people who aren't signed in. `routers/public.py` is the ONLY place for endpoints that need no sign-in (besides sign-in itself, invites and avatars). Since 0.36.1 it also serves private calendar links (rule 12).
   * `GET /api/public/board` returns only: event id, title, start and end, time zone, venue name, city, and positions with open spots. Never add pay, addresses, coordinates, notes, location names, requirements, logos, venue ids or anyone's name to it.
   * Every other endpoint must depend on `get_current_user` (directly or through a `require_...` dependency). A new endpoint with no sign-in needs the user's explicit OK.
   * The frontend learns the setting from `GET /api/public/config` (`utils/publicConfig.js`). No `VITE_` variable.
12. **Calendar sync (Phase 36.1):** private calendar links (table `calendar_feeds`), switched by `CALENDAR_SYNC`.
   * `GET /api/public/calendar/{token}.ics` needs no sign-in: the long random token in the address is the credential. It is the only no-sign-in endpoint that returns anything about a person or a roster. Don't add another, and never log or return a token anywhere except to its owner.
   * `services/calendar_feeds.py` is the only place that decides who may have which calendar (`scopes_for`) and what a feed contains. A new role or membership gets its calendar there. Access is worked out again every time a feed is built (a built feed is reused for up to 60 seconds).
   * **No pay in a feed, ever:** no rate, tip, cost or earnings. Also no staff-only notes, private time-off notes, email addresses or phone numbers. A shift lead's venue calendar never includes drafts.
   * A worker's entries keep these tags exactly: `[Confirmed]`, `[REQUESTED]`, `[WAITLIST]`, `[OFFERED]`. Venue, manager, organization and admin calendars have one entry per event.
   * Every text value written to a feed goes through `ics_text()` (it escapes the value and neutralises every kind of line break), and every link through `app_link()`.
   * Feeds are one-way and written by hand as iCalendar text (no new package). Don't add sign-in-with-Google or Microsoft calendar connections unless a phase asks.
```

---

## F4. `docs/DEPLOYMENT.md` (2 EDITS)
Two lines under the clean-install steps (the first one is the home-page line from 0.36.0, which is missing from this file), and one troubleshooting row.

**Edit 1.** Both blocks are wrapped in four backticks; the three-backtick lines inside them are content. Find:
````markdown
   ```
2. Still in `.env`, set the first admin: `SUPER_ADMIN_USERNAME=you@yourdomain.com`. Put the password in `.secrets/stack.env` as `SUPER_ADMIN_PASSWORD`. Optionally list people who should always be admins when they sign in with Firebase: `ALWAYS_ADMIN_EMAILS=you@yourdomain.com,partner@yourdomain.com`.
3. Start it: `docker compose up -d --build` (new install) or `docker compose up -d --force-recreate` (existing one).
4. Check: sign in as the admin. Admin → Venues is empty and Admin → People lists only you.
````
Replace with:
````markdown
   ```
2. Still in `.env`, set the first admin: `SUPER_ADMIN_USERNAME=you@yourdomain.com`. Put the password in `.secrets/stack.env` as `SUPER_ADMIN_PASSWORD`. Optionally list people who should always be admins when they sign in with Firebase: `ALWAYS_ADMIN_EMAILS=you@yourdomain.com,partner@yourdomain.com`.
   Also decide what the home page is: `PUBLIC_EVENT_BOARD=true` shows a public board of posted shifts to people who aren't signed in (event name, time, venue, city and open spots only); `false` (the default) shows the sign-in page.
   Calendar sync (Profile → Calendar sync) is on unless you set `CALENDAR_SYNC=false`. Google and Outlook read each person's private calendar link from their own servers, so set `APP_BASE_URL` to the site's public `https` address.
3. Start it: `docker compose up -d --build` (new install) or `docker compose up -d --force-recreate` (existing one).
4. Check: sign in as the admin. Admin → Venues is empty and Admin → People lists only you.
````

**Edit 2.** Find:
```markdown
| A demo login is refused | The password is whatever `--password` was at the last load (`Demo12345!` by default). Demo accounts use the email + password form, not Google. |
| `service "backend" is not running` | Start the stack first: `docker compose up -d`. |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` (any port) | Another stack on this computer already uses that port. Give this stack its own ports in `.env` (section E). |
| A second stack shows the first stack's data, or starting it replaced the first stack's containers | Both folders have the same stack name. Set `COMPOSE_PROJECT_NAME` in the second folder's `.env` (section E), then run `docker compose up -d --force-recreate` in the first folder and then in the second. |
```
Replace with:
```markdown
| A demo login is refused | The password is whatever `--password` was at the last load (`Demo12345!` by default). Demo accounts use the email + password form, not Google. |
| `service "backend" is not running` | Start the stack first: `docker compose up -d`. |
| Google or Outlook says it can't add a ShiftBoard calendar, or it never updates | Their servers must be able to open the link: the site needs a public `https` address, and anything in front of it (a Cloudflare Access rule, a bot challenge, a login wall) must let `/api/public/calendar/` through. Open the link in a private browser window: it should download a calendar file. Google can take up to a day to show changes. |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` (any port) | Another stack on this computer already uses that port. Give this stack its own ports in `.env` (section E). |
| A second stack shows the first stack's data, or starting it replaced the first stack's containers | Both folders have the same stack name. Set `COMPOSE_PROJECT_NAME` in the second folder's `.env` (section E), then run `docker compose up -d --force-recreate` in the first folder and then in the second. |
```

---

## F5. `product-roadmap.md` (1 EDIT)

**Edit 1.** Find:
```markdown
- ⏳ **Venue sign-up** (a manager creates a venue, and an admin approves or verifies it): not built yet, on purpose. Next when wanted.

### Later / nice to have
- **Admin "needs attention" dashboard:**
```
Replace with:
```markdown
- ⏳ **Venue sign-up** (a manager creates a venue, and an admin approves or verifies it): not built yet, on purpose. Next when wanted.

### Phase 36.1: Calendar sync (shipped in 0.36.1)
- ✅ **Private calendar links** for every account type (Profile → Calendar sync): worker, venue, manager, organization and admin calendars that Google, Apple, Outlook and any other calendar app subscribe to. One-way, and never any pay.
- ✅ A worker's shifts are tagged `[Confirmed]`, `[REQUESTED]`, `[WAITLIST]` and `[OFFERED]`.
- ⏳ **Later, if wanted:**
  - **Sign in with Google / Microsoft** to write shifts straight into a calendar within a minute (needs a Google Cloud and a Microsoft app registration, and Google's review).
  - **Read a worker's own calendar** (they paste its private link) to warn before they request a shift that clashes with something personal.

### Later / nice to have
- **Admin "needs attention" dashboard:**
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (1 EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.36.0",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.36.1",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (1 EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.36.0"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.36.1"
```

---

## V3. `CHANGELOG.md` (1 EDIT)
The new section goes above `[0.36.0]`.

**Edit 1.** Find:
```markdown
All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.36.0] - 2026-10-06 - Phase 36: Organizations, owners, shift leads and the public board
```
Replace with:
```markdown
All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.36.1] - 2026-10-06 - Phase 36.1: Calendar sync

### Added
- **Calendar sync** for every account type (Profile → **Calendar sync**): see ShiftBoard in Google Calendar, Apple Calendar, Outlook or any other calendar app.
  - Turning a calendar on makes a private link (an iCalendar feed) that the calendar app subscribes to. One tap adds it to Google, Apple, Outlook.com or Microsoft 365; the link can be copied for anything else.
  - It is one-way, and the calendar app decides how often it checks (Google can take up to a day).
- **Calendars by role:**
  - Worker: **My shifts**.
  - Shift lead: also a venue calendar for each venue they lead (posted events only).
  - Manager: **All my venues** and one calendar per venue.
  - Owner: also one per organization.
  - Platform admin: **Every venue**, and any organization's or venue's calendar.
- **Tags on a worker's shifts:** `[Confirmed]`, `[REQUESTED]`, `[WAITLIST]` and `[OFFERED]`, plus their time off. Everything except confirmed shifts can be switched off per link. Only confirmed shifts show as busy.
- **Venue calendars** have one entry per event, such as "Smith Wedding (6/8 filled)", with positions and who is booked in the details. Managers can include drafts, tagged `[DRAFT]`.
- **Reset link** (a new private link; the old one stops at once) and **Turn off**. The settings show when a calendar app last read each link.
- A **Sync** button on the worker's calendar opens the settings.
- Setting `CALENDAR_SYNC` (default `true`). `false` hides the settings and stops every link.
- Table `calendar_feeds`. Endpoints `GET/POST /api/me/calendar-links`, `PUT/DELETE /api/me/calendar-links/{id}`, `POST /api/me/calendar-links/{id}/reset`, and the feed `GET /api/public/calendar/{token}.ics`.
- `database/upgrades/0.36.1.sql`: the "keep your data" SQL for this version.

### Security
- A calendar never contains pay, tips, staff-only notes, private time-off notes, email addresses or phone numbers.
- The link's 43-character random token is its only credential. What it shows is worked out again each time the feed is built (at most a minute old): losing a venue, a shift lead role or the account empties the calendar, and the settings then list the link as "No longer available" so it can be turned off.
- Titles, notes and names can't inject anything into a calendar: every kind of line break in them is neutralised.
- The feed is the only new endpoint that works without a sign-in.

## [0.36.0] - 2026-10-06 - Phase 36: Organizations, owners, shift leads and the public board
```

---

## V4. `README.md` (5 EDITS)

**Edit 1.** Find:
```markdown
  * Drafts, cancelled and past events are never listed. Full events are listed as "Full".
* Signed-in people never see the board: `/` takes them to their own home page, as before.
* Apart from signing in, invites and the board, **every API endpoint needs a sign-in** (since 0.36.0 that includes `GET /api/venues`, `GET /api/venues/{id}` and `GET /api/venues/{id}/shifts`).

### For workers
```
Replace with:
```markdown
  * Drafts, cancelled and past events are never listed. Full events are listed as "Full".
* Signed-in people never see the board: `/` takes them to their own home page, as before.
* Apart from signing in, invites, the board and private calendar links, **every API endpoint needs a sign-in** (since 0.36.0 that includes `GET /api/venues`, `GET /api/venues/{id}` and `GET /api/venues/{id}/shifts`).

### Calendar sync
Everyone can see their ShiftBoard calendar in **Google Calendar, Apple Calendar, Outlook or any other calendar app** (Profile → **Calendar sync**, every account type; `CALENDAR_SYNC=false` turns it off).
* **How it works:** turning a calendar on makes a **private link** (an iCalendar feed, `GET /api/public/calendar/{token}.ics`). The calendar app subscribes to it and checks it on its own schedule: usually every few hours, and Google can take up to a day.
  * It is **one-way**: nothing done in the calendar app changes ShiftBoard.
  * Buttons add it to Google, Apple, Outlook.com or Microsoft 365 in one tap; the link can be copied for anything else.
* **Which calendars a person can turn on** follows their access:

  | Who | Calendars |
  | :--- | :--- |
  | Worker | **My shifts** |
  | Shift lead | My shifts, plus a **venue calendar** for each venue they lead (posted events only) |
  | Manager | **All my venues**, plus one **venue calendar** per venue |
  | Owner | the above, plus an **organization calendar** for each organization they own |
  | Platform admin | **Every venue**, plus any organization's or venue's calendar |
* **A worker's calendar** tags every shift:
  * `[Confirmed]` booked
  * `[REQUESTED]` asked for, waiting on the venue
  * `[WAITLIST]` in line for a full position
  * `[OFFERED]` offered to them, not answered yet

  It also shows their time off. Everything except confirmed shifts can be switched off per link. Only confirmed shifts block the time as "busy".
* **Venue, manager, organization and admin calendars** have one entry per event, such as "Smith Wedding (6/8 filled)", with each position and who is booked in the details. Shifts that aren't part of an event are entries of their own. Managers can add drafts, tagged `[DRAFT]`.
* **What is never in a calendar:** pay, tips, staff-only notes, private time-off notes, email addresses and phone numbers. Each entry links back to ShiftBoard for the rest.
* **The link is the key.** Anyone who has it can read that calendar, so it is long and random. **Reset link** replaces it at once; **Turn off** deletes it.
  * Access is worked out again each time a feed is built (a built feed is reused for up to a minute): a link for a venue someone no longer runs, or for an account that was turned off, shows an empty calendar. Their settings list it as **No longer available** so they can turn it off.
* Google and Outlook read the link from their own servers, so the site needs a public `https` address. Entries link back to ShiftBoard only when `APP_BASE_URL` is that address.
* Feeds cover 30 days back and 180 days ahead.

### For workers
```

**Edit 2.** Find:
```markdown
  schemas.py         Pydantic request / response models
  routers/           one file per area (auth, venues, events, shifts, listings, transfers, cover, team, ...)
                     public.py = no sign-in (config + public board) · organizations.py = owners · lead.py = shift leads
  services/          the logic (booking, auto_confirm, clock, cover, waitlist, reliability, notify*, ...)
                     access.py = manager / shift-lead checks · organizations.py = owners' venue rows · public_board.py
frontend/src/
  pages/             WorkerDashboard, VenueManagerDashboard, AdminPanel, EarningsPage, ProfilePage, ...
```
Replace with:
```markdown
  schemas.py         Pydantic request / response models
  routers/           one file per area (auth, venues, events, shifts, listings, transfers, cover, team, ...)
                     public.py = no sign-in (config + public board + private calendar links) · organizations.py = owners
                     lead.py = shift leads · calendar_sync.py = Profile → Calendar sync
  services/          the logic (booking, auto_confirm, clock, cover, waitlist, reliability, notify*, ...)
                     access.py = manager / shift-lead checks · organizations.py = owners' venue rows · public_board.py
                     calendar_feeds.py = who may have which calendar, and what goes in it (never pay)
frontend/src/
  pages/             WorkerDashboard, VenueManagerDashboard, AdminPanel, EarningsPage, ProfilePage, ...
```

**Edit 3.** Find:
```markdown
  utils/             formatting, time zones, errors, push, version
database/init.sql    the whole schema (runs on an empty database)
backend/src/seed.py        starter demo accounts at startup (off with SEED_DEMO_ACCOUNTS=false)
backend/src/demo_data.py   the full demo data loader: python -m src.demo_data load | reset | clear | status
```
Replace with:
```markdown
  utils/             formatting, time zones, errors, push, version
database/init.sql    the whole schema (runs on an empty database)
database/upgrades/   "keep your data" SQL per version, for a database you don't want to wipe
backend/src/seed.py        starter demo accounts at startup (off with SEED_DEMO_ACCOUNTS=false)
backend/src/demo_data.py   the full demo data loader: python -m src.demo_data load | reset | clear | status
```

**Edit 4.** Find:
```markdown
* **There is no migration tool.** `init.sql` only runs on an empty database. To apply a schema change, pick one:
  * wipe and rebuild: `docker compose down -v`, then `docker compose up -d --build`
  * or run that phase's "keep your data" SQL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE ... IF NOT EXISTS`)

---
```
Replace with:
```markdown
* **There is no migration tool.** `init.sql` only runs on an empty database. To apply a schema change, pick one:
  * wipe and rebuild: `docker compose down -v`, then `docker compose up -d --build`
  * or run that phase's "keep your data" SQL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE ... IF NOT EXISTS`), saved as `database/upgrades/<version>.sql` (the command is at the top of each file)

---
```

**Edit 5.** Find:
```markdown
| Sign-in | `SECRET_KEY` (signs every login; must be set; in `stack.env`), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `ALWAYS_ADMIN_EMAILS`, `ALLOW_SELF_REGISTRATION`, `SHOW_DEMO_LOGINS`, `SEED_DEMO_ACCOUNTS` (`false` = clean install, no starter demo accounts) |
| Home page | `PUBLIC_EVENT_BOARD` (`true` = the home page is the public board of posted shifts; `false` = the sign-in page) |
| Firebase | `USE_MOCK_FIREBASE`, `FIREBASE_CREDENTIALS_PATH` (`.secrets/firebase_service_account.json`), `FIREBASE_WEB_CONFIG_PATH` (`.secrets/firebase-web-config.js`), `FIREBASE_AUTH_PROVIDERS`, `FIREBASE_VAPID_KEY` (push through FCM) |
| Links | `APP_BASE_URL`: the public address used in emails, texts and invites |
```
Replace with:
```markdown
| Sign-in | `SECRET_KEY` (signs every login; must be set; in `stack.env`), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `ALWAYS_ADMIN_EMAILS`, `ALLOW_SELF_REGISTRATION`, `SHOW_DEMO_LOGINS`, `SEED_DEMO_ACCOUNTS` (`false` = clean install, no starter demo accounts) |
| Home page | `PUBLIC_EVENT_BOARD` (`true` = the home page is the public board of posted shifts; `false` = the sign-in page) |
| Calendar sync | `CALENDAR_SYNC` (`true` = people can connect Google / Apple / Outlook with a private calendar link; `false` = hidden, and every link stops working). Needs a public `https` `APP_BASE_URL` |
| Firebase | `USE_MOCK_FIREBASE`, `FIREBASE_CREDENTIALS_PATH` (`.secrets/firebase_service_account.json`), `FIREBASE_WEB_CONFIG_PATH` (`.secrets/firebase-web-config.js`), `FIREBASE_AUTH_PROVIDERS`, `FIREBASE_VAPID_KEY` (push through FCM) |
| Links | `APP_BASE_URL`: the public address used in emails, texts and invites |
```

---

# PART R: For Andrew: rebuild and try it (AGY: don't run any of this)

## 1. The database (schema change ⚠️)

One new table, `calendar_feeds`. Nothing existing changes. Do this **in each stack's folder**. Pick ONE:

**Option 1: fresh database (wipes ALL data in that stack).** `init.sql` already has the new table.
```
docker compose down -v
docker compose up -d --build
```
Then reload the demo data if you want it: `.\deploy_test_data.ps1` (Windows) or `bash deploy_test_data.sh` (Linux).

**Option 2: keep your data.** Just rebuild:
```
docker compose up -d --build
```
* The backend creates the new table by itself when it starts. Unlike 0.36.0, nothing breaks in between, because no existing table changes.
* To make that table match a fresh install exactly (it only adds the database's own default values), you can also run `database/upgrades/0.36.1.sql`. The command for PowerShell and for bash is at the top of that file. It isn't required.

## 2. Settings

* Calendar sync is **on** unless you add `CALENDAR_SYNC=false` to that stack's `.env` (then `docker compose up -d --force-recreate`).
* **`APP_BASE_URL` must be the stack's public `https` address** (for example `https://dev-local.shift-up.team`). The links inside calendar entries use it, and Google and Outlook have to be able to reach the site. Admin → System already warns when it still points at localhost.
* If something sits in front of the site (a Cloudflare Access rule, a bot challenge, a login wall), it has to let `/api/public/calendar/` through. Google's and Microsoft's servers fetch that address without signing in.

## 3. Check it with your own calendar

This is the part I couldn't test: no real Google, Apple or Outlook account was used.

1. Sign in as a worker with some shifts (in the demo data, for example `diego.price@demo.example.com`, password `Demo12345!`).
2. **Profile → Calendar sync → My shifts → Turn on.**
3. Copy the link and open it in a private browser window. It should download a `.ics` file with no sign-in. If it doesn't, fix that first (section 2).
4. Tap **Google Calendar**. Google asks to add the calendar; say yes. The shifts appear under "Other calendars", tagged.
5. On an iPhone, tap **Apple / iPhone**. It offers to subscribe.
6. Tap **Outlook.com** (or **Microsoft 365** for a work account). It opens "Subscribe from web" with the link filled in.
7. If a button doesn't do that, tell me which one and what it showed. The copied link works in all three (the page says where to paste it).

### Checklist
1. Admin → System: *Web app 0.36.1 · Server 0.36.1*.
2. Every account type has a **Calendar sync** tab on its Profile page.
3. Worker: one calendar, **My shifts**. Titles start with `[Confirmed]`, `[REQUESTED]`, `[WAITLIST]` or `[OFFERED]`. No pay anywhere in an entry.
4. Untick **Shifts I asked for**: the `[REQUESTED]` entries are gone the next time the link is read.
5. **Reset link**: the address changes, and the old one answers *This calendar link doesn't work any more.*
6. Manager: **All my venues** and one calendar per venue. Entries read like `Harbor House Events: Gala Dinner (10/12 filled)` with names in the details. Tick **Draft events** to add `[DRAFT]` entries.
7. Owner (`regional.manager@demo.example.com`): also the organization's calendar.
8. Shift lead (`lead.harbor@demo.example.com`): My shifts, plus Harbor House Events with no switches. As the manager, end their lead role: their Calendar sync tab now lists that calendar as **No longer available**, and its link shows an empty calendar within a minute.
9. Admin: **Every venue**, each organization, and a picker for one venue.
10. The worker's **Calendar** tab has a **Sync** button that opens the settings.

### Things to know
* **Updates aren't instant.** ShiftBoard's feed is at most a minute old, but Google re-reads it only every several hours (sometimes a day), Apple and Outlook usually within a few hours. Notifications stay the way people hear about last-minute changes.
* **Tokens are stored as they are**, so the settings page can show a link again. Anyone with database access could read them; Reset link replaces one.
* The address of each read appears in the backend's access log, token included. Keep those logs private.
* **The Apple / iPhone button** uses a `webcal://` address, which relies on the site sending plain http to https (Cloudflare does by default). If it fails, copy the link and add it by hand.
* **A lost access takes up to a minute to show**, because a built feed is reused for that long. Reset link and Turn off are instant.

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.36.1. Apply it as written and don't bump again.)