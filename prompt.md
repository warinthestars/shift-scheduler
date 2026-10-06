# Phase 36: Organizations, Owners, Shift Leads & the Public Board (v0.36.0)

**Why:** some of the people running venues own several of them, and venues need someone on the floor who can run a shift without seeing pay. This phase adds organizations with owners, a shift lead role, and a public board of posted shifts that can be the home page. **Venue sign-up is NOT part of this phase**: platform admins set organizations up.

## What changes

### 1. Organizations and the owner role
* An **organization** is a group of venues. A venue belongs to at most one.
* An **owner** is a manager account (`users.role = 'venue_manager'`) with a row in `organization_members`. An owner manages **every venue in the organization**, with every manager screen.
* **`users.role` keeps exactly three values.** Owner is a membership, not a role. Sign-in, JWTs and `auth.py` are not changed.
* **How owners get access without changing any permission check:** an owner gets an ordinary `venue_managers` row for each venue in the organization, marked `via_org = TRUE`.
  * `services/organizations.sync_managers()` is the only code that creates or deletes those rows. It runs whenever an owner or venue is added or removed, an organization is deleted, or an admin changes a user's role.
  * A row a manager already had before becoming an owner stays `via_org = FALSE` and survives being removed as an owner.
* **Who does what:**
  * **Platform admin** (Admin → Organizations): create, rename and delete organizations; put venues in and take them out; add and remove owners.
  * **Owner** (new page `/org`): see every venue side by side; see everyone across the venues' teams and add a person to another venue or move them; add and remove co-owners; rename the organization; choose whether to get each venue's manager alerts.
  * Owners can NOT create venues, add venues to the organization, or delete it.
* **Owner alerts:** an owner gets a venue's manager alerts only when they turn on "Send me each venue's manager alerts", or when the venue has no other manager. Venues they manage directly are not affected.
* **Sharing people:** each venue keeps its own team, positions and notes. An owner can **copy** a person onto another venue's team or **move** them.
  * Positions come along where the other venue has a position with the same name. The staffing company comes along where the other venue has none recorded.
  * A venue that blocked the person is skipped. Moving never touches shifts already booked.

### 2. Shift lead role
* A **shift lead** is a **worker** account that a manager marks "shift lead" on the venue's Team page (`venue_whitelists.is_lead`). They keep booking and working shifts like any worker.
* A lead gets a **Lead** page (`/lead`) for that venue, where they can:
  * see the Today / This week board (who's booked, in, late)
  * clock someone in, and mark a no-show
  * add, fix or delete clock times, with a reason (saved in the audit trail under their name)
  * read and post on any shift's chat, and send a message to everyone booked on the shift
  * fill an open spot: assign or offer it to people **on the team**
* A lead can NOT:
  * see pay, tips, pay periods, exports, the manager time sheet, venue settings or the team list
  * approve or deny requests, post or edit events, remove someone from a shift, or set pay
  * change their own clock times or booking, or assign or offer a shift to themselves
  * do anything at another venue
* **How "no pay" is guaranteed:** what a lead reads comes only from the new `routers/lead.py`, whose response models have no pay fields. Everything else a lead does goes through eight existing endpoints (and the shift chat), none of which returns pay; their check changes from "manager" to "manager or shift lead". No manager read endpoint is opened to leads.
* Removing or blocking someone, or changing their account to a manager, ends their lead role.

### 3. Public event board
* New setting **`PUBLIC_EVENT_BOARD`** (default `false`).
  * `false`: the home page (`/`) sends people who aren't signed in to the sign-in page, as now.
  * `true`: the home page is a **public board** of every posted, upcoming event, with a **Sign in / Sign up** button in the top-right corner.
* The board shows only: event name, date and time, venue name, city, positions and open spots.
* It never shows pay, the street address, map pin, location name, notes, requirements, the venue's logo or id, or anyone's name.
* Tapping an event asks the visitor to sign in or create a worker account. After they do, that same event opens with its full details.
* Listed: published events starting within 60 days. Not listed: drafts, cancelled and past events. Full events are listed as "Full".
* **Per venue** (Venue settings): "List our shifts on the public board" (`venues.public_board`, default on) and "City shown on the public board" (`venues.city`).
  * With no city typed, it is worked out from a US-style address ("123 Main St, Denver, CO 80202" → "Denver, CO"). If that isn't clear, no city is shown. Part of a street address is never shown.
* The frontend reads the setting from the backend (`GET /api/public/config`). **No `VITE_` variable.**
* Signed-in people never see the board. Signing out goes to the home page.

### 4. Also in this phase
* **Three older endpoints now need a sign-in:** `GET /api/venues`, `GET /api/venues/{venue_id}` and `GET /api/venues/{venue_id}/shifts`. They returned addresses, settings and pay to anyone, which the public board would have made easy to find.
* **"Also send it to everyone booked on this shift"** on the shift chat, for managers and shift leads (notification kind `shift_message`).
* **Demo data:** one organization (*Whitaker Hospitality Group*: Harbor House Events + Copperline Taproom, owned by `regional.manager@demo.example.com`), one shift lead per venue (`lead.<venue>@demo.example.com`), one venue off the public board (Juniper Rooftop), one typed city (Copperline).

### API (18 new operations: 211 in all)

| Method and path | Who | What |
| :--- | :--- | :--- |
| `GET /api/public/config` | anyone | `{ public_board, self_registration }` |
| `GET /api/public/board?days=60` | anyone | the board; `404` when `PUBLIC_EVENT_BOARD` is off; `days` 1–90 |
| `GET /api/organizations` | admin: all · owner: theirs | `List[OrganizationDetail]` |
| `POST /api/organizations` | admin | `{ name, venue_ids }` → `OrgChangeResult` (201). `409` duplicate name or a venue already in an organization |
| `GET /api/organizations/{org_id}` | owner / admin | `OrganizationDetail` |
| `PATCH /api/organizations/{org_id}` | owner / admin | `{ name }` → `OrgChangeResult` |
| `DELETE /api/organizations/{org_id}` | admin | 204. Venues are kept |
| `POST /api/organizations/{org_id}/owners` | owner / admin | `{ email, first_name, last_name, phone }` → `OrgChangeResult` (201). Existing manager: linked. No account: a manager account with a temporary password (returned once). Worker: `409`. Admin: `400` |
| `DELETE /api/organizations/{org_id}/owners/{user_id}` | owner / admin | `OrgChangeResult`. An owner can't remove themselves |
| `PATCH /api/organizations/{org_id}/me` | owner | `{ venue_alerts }` → `OrgChangeResult` |
| `POST /api/organizations/{org_id}/venues` | admin | `{ venue_id }` → `OrgChangeResult`. `409` if it's in another organization |
| `DELETE /api/organizations/{org_id}/venues/{venue_id}` | admin | `OrgChangeResult`, with a warning when the venue is left with no manager |
| `GET /api/organizations/{org_id}/overview` | owner / admin | `OrgOverview` |
| `GET /api/organizations/{org_id}/people?q=` | owner / admin | `List[OrgPerson]` |
| `POST /api/organizations/{org_id}/people/{worker_id}/share` | owner / admin | `{ to_venue_ids, from_venue_id, mode: copy \| move }` → `OrgShareResult` |
| `GET /api/lead/venues` | any signed-in user | venues where they are a shift lead (`List[LeadVenue]`; `[]` for everyone else) |
| `GET /api/lead/venues/{venue_id}/tonight` | manager / shift lead | `TonightResponse` (drafts left out for a lead) |
| `GET /api/lead/events/{event_id}/times` | manager / shift lead | `LeadTimes`: clock times and hours, no pay |

**Existing endpoints that now also accept the venue's shift leads** (unchanged for managers):
`POST /api/requests/{id}/no-show`, `POST /api/requests/{id}/time-entries`, `PATCH /api/time-entries/{id}`, `POST /api/time-entries/{id}/delete`, `GET /api/shifts/{id}/candidates`, `POST /api/shifts/{id}/assign`, `POST /api/shifts/{id}/offers`, `DELETE /api/offers/{id}`, and the shift chat (`GET` / `POST /api/shifts/{id}/messages`).

**Changed request / response fields:**
* `PATCH /api/venues/{venue_id}/team/{worker_id}`: new optional `is_lead` (boolean). `TeamMember` has `is_lead`.
* `PUT / PATCH /api/venues/{venue_id}/settings`: new optional `public_board` (boolean) and `city` (string up to 120, `""` clears it; a city with a digit in it is refused with `400`). `VenueResponse` has `public_board`, `city`, `organization_id`.
* `GET /api/venues/{venue_id}/managers`: each item has `via_org` and `organization_name`. `DELETE .../managers/{user_id}` refuses an owner with `400`.
* `POST /api/shifts/{shift_id}/messages`: new optional `notify` (boolean).

### Database (schema change ⚠️, Part R)
* **New tables:** `organizations`, `organization_members` (primary key `organization_id, user_id`; `role VARCHAR(20)`, checked in the app by `models.OrgRole`).
* **New columns:** `venues.organization_id` (nullable, `ON DELETE SET NULL`), `venues.public_board` (default `TRUE`), `venues.city`, `venue_managers.via_org` (default `FALSE`), `venue_whitelists.is_lead` (default `FALSE`).
* `VARCHAR` for the role. **No ENUMs.**

**Version 0.36.0.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## 0. Rules for this phase
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - `docker-compose.yaml`, `docker-compose.demo.yaml`, `deploy_test_data.sh`, `deploy_test_data.ps1`
  - Any real settings file (`.env`, anything in `.secrets/` that isn't a `.template`, any `*.bak`). Never open, read or print one.
  - In `backend/src/main.py`, **only** the three router imports and three `include_router` lines (C1). The CORS block is not touched.
  - In `agy_system_instructions.md`, only the two edits in F4. Leave the Standing rules section exactly as it is.
* **Do NOT run any `docker` or `docker compose` command, the SQL in Part R, or the demo data loader.** Two stacks may be running on this computer with testers' data. Andrew does all of that himself (Part R).
* **`users.role` stays `platform_admin` | `venue_manager` | `worker`.** Don't add a role value, don't change what goes in the JWT, and don't add role checks to `ProtectedRoute`.
* **No native PostgreSQL ENUMs.** `organization_members.role` is `VARCHAR(20)`.
* **Datetimes** are timezone-aware UTC (`datetime.now(timezone.utc)`), as everywhere else.
* **No new packages**, backend or frontend. No `VITE_` variables.
* **Don't add pay to anything a shift lead can call**, and don't open any other endpoint to shift leads. Don't add fields to `PublicBoardEvent`.
* **Code fences are not file content.** Every file and every *Find* / *Replace with* block in this prompt is wrapped in fence lines of three or four backticks. Those lines are Markdown; never write them into a file. Where an edit says its blocks are wrapped in **four** backticks, the three-backtick lines inside ARE content.
* **NEW FILES (15):** create them with exactly the content shown, with LF line endings. Each one states its first and last line: check them when you finish.
* **EDITS (124 in 37 files):** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order, top to bottom of each file.
  - If a *Find* doesn't match, stop and report it. Don't improvise a different edit.
  - Keep each file's existing line endings. `backend/src/config.py` has Windows (CRLF) line endings on this computer; the other edited files have LF. Match on the text.
* **Verification.** All 124 edits were generated from the files in your repo (0.35.6 is fully applied) and replayed by a script: each *Find* matched exactly once, and the result is the code that was tested.
  - **Backend:** imports cleanly. 211 API operations (193 + 18). The API reports **0.36.0**.
  - **A new 137-check suite passes** against a real PostgreSQL. It covers:
    - **Public board:** off by default (`404`); on with no sign-in; exactly the ten allowed fields; no pay, notes, addresses, location names or venue ids anywhere in the response; drafts, cancelled, past and far-off events left out; full events marked full; same-named positions added up; city from the address, a typed city, an off-site event's own city; a city with a street number refused; a venue that opts out isn't listed; after signing up, the same event opens with full details.
    - **Sign-in required:** the three older venue endpoints refuse without a token, and the complete list of endpoints that work without a sign-in is exactly: sign-in (3), Firebase config, invites, avatars, the two public ones, `/` and `/healthz`.
    - **Organizations:** only admins create them; duplicate names and a venue in two organizations refused; a worker or admin can't be an owner; an existing manager is linked, a new email gets a manager account that can sign in; the owner gets every venue with every manager screen; a plain manager doesn't; owners can rename and add co-owners but not add venues, delete, or remove themselves; a manager can't remove an owner from a venue.
    - **Direct vs. organization rows:** a manager who becomes an owner keeps their own venue after being removed as an owner; an admin saving the owner's account (with an empty or a full venue list) keeps the organization rows; changing an owner to a worker removes the ownership.
    - **Owner alerts:** off by default; on with the switch; always on for a venue with no other manager.
    - **Overview and people:** each venue's week matches its own board and the totals add up; copy and move (positions only where they exist, staffing company, blocked venues skipped, lead role dropped on a move); logged and notified.
    - **Removing things:** taking a venue out or deleting the organization keeps the venues and their own managers; a venue left with no manager is flagged; everything is in the admin audit log.
    - **Shift leads:** made and ended by a manager; only active team members; the Today board, with drafts left out; refused on 18 pay, settings, team and posting endpoints and on approve / deny; clock in, fix, delete, no-show, all audited under the lead's name; can't touch their own times; candidates are the team without themselves; can't assign or offer outside the team or to themselves; chat on any shift; "send to everyone" reaches the booked staff and is ignored for ordinary workers; nothing at another venue; managers unchanged, pay still on their time sheet.
    - **No pay for leads:** the Today board, the times sheet and the candidate list were searched for any pay, rate, tip or cost field and for the actual rate: none.
  - **A second audit (7 checks) on the demo data:** every GET endpoint whose ids could be filled in was called as a shift lead and as an ordinary team member of the same venue (96 calls). The only reads the lead has that the team member doesn't are the Lead board, clock times, the candidate list and the shift chat, and none of those responses has a money field. On the public board (59 events): no street, no location name, no money, and the opted-out venue is absent.
  - **All 19 earlier suites still pass** (890 checks, including 6 new demo-data checks). 1,034 checks in all.
  - **`database/init.sql` and `models.py` describe the same schema** (the existing audit suite).
  - **Upgrade path:** the keep-your-data SQL in Part R was run on a 0.35.6 database, twice, and also after the backend had already created the two new tables. Each time the result has the same tables, columns, types, defaults and indexes as a fresh 0.36.0 database (only the column order differs). Then every read endpoint was called against 0.35.6 demo data on the upgraded database: 735 requests, no errors.
  - **Demo data:** loads, clears and reloads with the organization and the shift leads; its manager rows are exactly what `sync_managers()` would make.
  - **Frontend:** bundles with no missing imports (same `lucide-react` 0.359.0 as the repo). In real Chromium, with the demo data:
    - board off: `/` goes to `/login`; board on: `/` shows 59 events; search, city filter and "open spots only" work; no `$` anywhere on the page; no sideways scrolling on a phone
    - tap an event → sign in → the worker page opens that same event; "Create a free account" opens the sign-up form
    - a shift lead: Lead in the menu and a banner on the worker page; the Today board, Clock times, the chat tick box and Find cover all open; no `$` on any of them; no Roster button
    - an owner: Organization in the menu; Overview, People, "Add to a venue", and adding a co-owner (temporary password shown once)
    - Team page: the Shift lead chip and button; Managers: the Owner badge; Venue settings: the public board card; Admin → Organizations: create, add a venue
    - No page errors. The one console message was the expected `400` when adding an owner whose email has no account yet.
  - **Not tested:** nothing was run in Docker, behind the Cloudflare tunnel, or with real Firebase sign-in. The public board was not load-tested; it is cached for 15 seconds per `days` value.

  Don't "improve" them.

---

# PART A: Database

## A1. `backend/src/models.py` (4 EDITS)
Two new models before `Venue`, three columns on `Venue`, one on `VenueManager`, one on `VenueWhitelist`.

**Edit 1.** Find:
```python
    whitelist_entries = relationship("VenueWhitelist", back_populates="worker", cascade="all, delete-orphan", foreign_keys="VenueWhitelist.worker_id")

class Venue(Base):
    __tablename__ = "venues"
```
Replace with:
```python
    whitelist_entries = relationship("VenueWhitelist", back_populates="worker", cascade="all, delete-orphan", foreign_keys="VenueWhitelist.worker_id")

class OrgRole(str, Enum):
    """Phase 36: roles inside an organization. Stored as VARCHAR; checked here (no native PG ENUM)."""
    owner = "owner"


class Organization(Base):
    """Phase 36: a group of venues with one or more owners. An owner manages every venue in it."""
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class OrganizationMember(Base):
    """Phase 36: who owns an organization. services/organizations.py keeps venue_managers in step."""
    __tablename__ = "organization_members"

    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role = Column(String(20), nullable=False, default="owner")               # OrgRole
    venue_alerts = Column(Boolean, nullable=False, default=False)            # also send this owner each venue's manager alerts
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class Venue(Base):
    __tablename__ = "venues"
```

**Edit 2.** Find:
```python
    tip_pool_payroll = Column(Boolean, nullable=False, default=True)               # Phase 35.2
    tips_shown_to_workers = Column(Boolean, nullable=False, default=True)          # Phase 35.2
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    tip_pool_payroll = Column(Boolean, nullable=False, default=True)               # Phase 35.2
    tips_shown_to_workers = Column(Boolean, nullable=False, default=True)          # Phase 35.2
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)  # Phase 36
    public_board = Column(Boolean, nullable=False, default=True)                   # Phase 36: listed on the public event board
    city = Column(String(120), nullable=True)                                      # Phase 36: shown on the public board (never the address)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 3.** Find:
```python
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    # Relationships
```
Replace with:
```python
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    via_org = Column(Boolean, nullable=False, default=False)                 # Phase 36: row exists because they own the venue's organization
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    # Relationships
```

**Edit 4.** Find:
```python
    time_tracking = Column(String(20), nullable=True)                        # Phase 35: payroll | shiftboard | None = venue setting
    works_through = Column(String(120), nullable=True)                       # Phase 35: staffing company / agency
    added_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```
Replace with:
```python
    time_tracking = Column(String(20), nullable=True)                        # Phase 35: payroll | shiftboard | None = venue setting
    works_through = Column(String(120), nullable=True)                       # Phase 35: staffing company / agency
    is_lead = Column(Boolean, nullable=False, default=False)                 # Phase 36: shift lead at this venue (runs the floor, never sees pay)
    added_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```

---

## A2. `database/init.sql` (4 EDITS)
The two new tables go BEFORE `venues` (which points at `organizations`). Same columns as A1.

**Edit 1.** Find:
```sql
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);

-- ------------------------------------------------------------------------------
-- 2. Venues Table
-- ------------------------------------------------------------------------------
```
Replace with:
```sql
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);

-- ------------------------------------------------------------------------------
-- 1b. Organizations (Phase 36): a group of venues with one or more owners.
--     Created before venues because venues.organization_id points here.
-- ------------------------------------------------------------------------------
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'owner',               -- owner (checked in the app: models.OrgRole)
    venue_alerts BOOLEAN NOT NULL DEFAULT FALSE,             -- also send this owner each venue's manager alerts
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX ix_organization_members_user_id ON organization_members(user_id);

-- ------------------------------------------------------------------------------
-- 2. Venues Table
-- ------------------------------------------------------------------------------
```

**Edit 2.** Find:
```sql
    tip_pool_payroll BOOLEAN NOT NULL DEFAULT TRUE,          -- Phase 35.2: venue-payroll people share pools (scheduled hours)
    tips_shown_to_workers BOOLEAN NOT NULL DEFAULT TRUE,     -- Phase 35.2: workers see their tips in Hours & pay
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_venues_coordinates ON venues(lat, lng);

-- ------------------------------------------------------------------------------
```
Replace with:
```sql
    tip_pool_payroll BOOLEAN NOT NULL DEFAULT TRUE,          -- Phase 35.2: venue-payroll people share pools (scheduled hours)
    tips_shown_to_workers BOOLEAN NOT NULL DEFAULT TRUE,     -- Phase 35.2: workers see their tips in Hours & pay
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,   -- Phase 36: the organization this venue belongs to
    public_board BOOLEAN NOT NULL DEFAULT TRUE,              -- Phase 36: listed on the public event board (when PUBLIC_EVENT_BOARD is on)
    city VARCHAR(120),                                       -- Phase 36: shown on the public board; never the street address
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_venues_coordinates ON venues(lat, lng);
CREATE INDEX ix_venues_organization_id ON venues(organization_id);

-- ------------------------------------------------------------------------------
```

**Edit 3.** Find:
```sql
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (venue_id, user_id)
```
Replace with:
```sql
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    via_org BOOLEAN NOT NULL DEFAULT FALSE,                  -- Phase 36: the row exists because they own the venue's organization
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (venue_id, user_id)
```

**Edit 4.** Find:
```sql
    time_tracking VARCHAR(20),                             -- Phase 35: payroll | shiftboard (NULL = the venue's setting)
    works_through VARCHAR(120),                            -- Phase 35: staffing company / agency they come through
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    time_tracking VARCHAR(20),                             -- Phase 35: payroll | shiftboard (NULL = the venue's setting)
    works_through VARCHAR(120),                            -- Phase 35: staffing company / agency they come through
    is_lead BOOLEAN NOT NULL DEFAULT FALSE,                -- Phase 36: shift lead at this venue (runs the floor, never sees pay)
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

---

# PART B: Backend, new files

## B1. NEW FILE `backend/src/services/access.py`
Manager / shift-lead checks. The first line is `"""` and the **last line is `    )).scalars().all())`**.

```python
"""
Phase 36: who may do what at a venue.

  manage = a platform admin, or anyone with a venue_managers row for the venue. Organization owners
           have a row for every venue in their organization (services/organizations.py keeps those
           rows in step), so every existing manager check already covers them.
  floor  = manage, OR an active shift lead at the venue. A shift lead is a WORKER account whose
           team row has is_lead = TRUE.

Floor access is: the Today board, clocking people in and out, marking no-shows, fixing clock
times, the shift chat, and filling open spots from the team.
Floor access is NEVER: pay rates, tips, pay periods, exports, venue settings, the team list,
posting or editing events, or approving requests. Lead screens read through routers/lead.py,
whose response models have no pay fields.
"""
from typing import Iterable, List, Set
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import normalize_role
from src.models import User, VenueWhitelist
from src.services.team import _team_filter
from src.services.venue_public import can_manage_venue

MANAGER = "manager"
LEAD = "lead"
NOT_FLOOR = "You don't run shifts at this venue."


async def is_shift_lead(db: AsyncSession, user: User, venue_id) -> bool:
    if normalize_role(user.role) != "worker" or not user.is_active:
        return False
    return bool(await db.scalar(
        select(VenueWhitelist.id).where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.is_lead == True,
        )
    ))


async def lead_venue_ids(db: AsyncSession, user: User) -> List:
    if normalize_role(user.role) != "worker" or not user.is_active:
        return []
    return list((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.is_lead == True,
        )
    )).scalars().all())


async def floor_access(db: AsyncSession, user: User, venue_id) -> str:
    """Returns MANAGER or LEAD. Raises 403 for everyone else."""
    if await can_manage_venue(db, user, venue_id):
        return MANAGER
    if await is_shift_lead(db, user, venue_id):
        return LEAD
    if normalize_role(user.role) == "worker":
        raise HTTPException(status_code=403, detail=NOT_FLOOR)
    raise HTTPException(status_code=403, detail="You don't manage this venue.")


async def team_ids(db: AsyncSession, venue_id, worker_ids: Iterable) -> Set[UUID]:
    """Which of these people are on the venue's team (on the list, or worked here and not removed / blocked)."""
    ids = [w for w in worker_ids if w]
    if not ids:
        return set()
    return set((await db.execute(
        select(User.id).where(User.id.in_(ids), _team_filter(venue_id))
    )).scalars().all())
```

---

## B2. NEW FILE `backend/src/services/public_board.py`
What the public board shows, and the city rule. The first line is `"""` and the **last line is `    return board`**.

```python
"""
Phase 36: the public event board (the home page for people who aren't signed in, when
PUBLIC_EVENT_BOARD is on).

It lists every published, upcoming, not-cancelled event of every venue that hasn't opted out
(venues.public_board), with the LEAST information that still lets someone decide to sign up:
event name, date and time, venue name, city, positions and open spots.
Never: pay, tips, the street address, map pin, location name, notes, requirements, logo, venue id,
or anyone's name. Those need a worker account.
"""
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, Venue, VenueLocation
from src.schemas import PublicBoard, PublicBoardEvent, PublicBoardPosition

MAX_DAYS = 90
DEFAULT_DAYS = 60
MAX_EVENTS = 300
CACHE_SECONDS = 15           # anyone on the internet can call this; don't hit the database every time

_STATE = re.compile(r"^(?P<city>.*?)[,\s]+(?P<state>[A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$")
_COUNTRY = ("usa", "us", "united states", "united states of america")
# words that mean "this is part of a street address, not a city" (allowed only as the first word: St. Louis)
_STREET_WORDS = {
    "st", "street", "ave", "avenue", "rd", "road", "blvd", "boulevard", "dr", "drive", "ln", "lane", "way",
    "hwy", "highway", "pkwy", "parkway", "plaza", "pl", "place", "ct", "court", "sq", "square", "pier",
    "suite", "ste", "unit", "floor", "fl", "bldg", "building", "apt", "room", "rm",
}
_cache = {}                  # days -> (expires_at, PublicBoard)


def clear_cache() -> None:
    _cache.clear()


def _clean_city(city: str, state: Optional[str] = None, typed: bool = False) -> Optional[str]:
    city = (city or "").strip(" ,")
    if not city or any(ch.isdigit() for ch in city) or len(city) > 60:
        return None                       # a number means it's (part of) a street address: show nothing
    if not typed:
        words = [w.strip(".").lower() for w in city.split()]
        if any(w in _STREET_WORDS for w in words[1:]) or (len(words) == 1 and words[0] in _STREET_WORDS):
            return None                   # 'Main St', 'One Harbor Plaza': not a city
    return f"{city}, {state.upper()}" if state else city


def city_from_address(address: Optional[str]) -> Optional[str]:
    """
    '123 Main St, Denver, CO 80202' -> 'Denver, CO'.  Works on US-style addresses with commas.
    Anything it can't read safely gives None: the board then shows no city at all, never the address.
    """
    parts = [p.strip() for p in (address or "").split(",") if p.strip()]
    if parts and parts[-1].lower() in _COUNTRY:
        parts = parts[:-1]
    if len(parts) < 2:
        return None
    last = parts[-1]
    # '..., Denver, CO 80202'
    m = re.match(r"^(?P<state>[A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$", last)
    if m:
        return _clean_city(parts[-2], m.group("state"))
    # '..., Denver CO 80202'
    m = _STATE.match(last)
    if m and m.group("city").strip():
        return _clean_city(m.group("city"), m.group("state"))
    return None


def venue_city(venue: Venue) -> Optional[str]:
    """The city the manager typed, else worked out from the address, else nothing."""
    typed = (venue.city or "").strip()
    if typed:
        return _clean_city(typed, typed=True)
    return city_from_address(venue.address)


async def build_public_board(db: AsyncSession, days: int = DEFAULT_DAYS) -> PublicBoard:
    days = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    hit = _cache.get(days)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]

    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(ShiftEvent, Venue)
        .join(Venue, Venue.id == ShiftEvent.venue_id)
        .where(
            func.coalesce(ShiftEvent.status, "published") == "published",
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.start_time > now,
            ShiftEvent.start_time <= now + timedelta(days=days),
            Venue.public_board == True,
        )
        .order_by(ShiftEvent.start_time.asc(), ShiftEvent.id.asc())
        .limit(MAX_EVENTS)
    )).all()

    out = []
    if rows:
        event_ids = [e.id for e, _v in rows]
        by_event = defaultdict(list)
        for s in (await db.execute(
            select(Shift)
            .where(Shift.event_id.in_(event_ids), func.upper(Shift.status) != "CANCELLED")
            .order_by(Shift.created_at.asc(), Shift.role_type.asc())
        )).scalars().all():
            by_event[s.event_id].append(s)
        loc_ids = {e.location_id for e, _v in rows if e.location_id}
        locations = {}
        if loc_ids:
            locations = {
                l.id: l for l in (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(loc_ids)))).scalars().all()
            }
        for ev, venue in rows:
            spots = {}                    # position name -> open spots (same-named positions are added up)
            for s in by_event.get(ev.id, []):
                name = (s.role_type or "Worker").strip() or "Worker"
                left = max(0, int(s.capacity or 0) - int(s.spots_filled or 0))
                if (s.status or "").upper() != "OPEN":
                    left = 0
                spots[name] = spots.get(name, 0) + left
            if not spots:
                continue
            city = None
            loc = locations.get(ev.location_id) if ev.location_id else None
            if loc is not None:
                city = city_from_address(loc.address)     # an off-site event: that place's city, if it can be read
            city = city or venue_city(venue)
            total = sum(spots.values())
            out.append(PublicBoardEvent(
                event_id=ev.id,
                title=ev.title,
                start_time=ev.start_time,
                end_time=ev.end_time,
                timezone=venue.timezone or "America/New_York",
                venue_name=venue.name,
                city=city,
                positions=[PublicBoardPosition(name=n, open_spots=c) for n, c in spots.items()],
                open_spots=total,
                full=total == 0,
            ))

    board = PublicBoard(events=out, days=days, generated_at=now)
    _cache[days] = (time.monotonic() + CACHE_SECONDS, board)
    return board
```

---

## B3. NEW FILE `backend/src/services/organizations.py`
`sync_managers()` and the organization helpers. The first line is `"""` and the **last line is `    )`**.

```python
"""
Phase 36: organizations and their owners.

An organization groups venues. Each of its OWNERS manages every venue in it.

How that works without touching any existing permission check: an owner gets an ordinary
venue_managers row for every venue in the organization, marked via_org = TRUE.
sync_managers() below is the ONLY place those rows are created or deleted. Call it (before the
commit) whenever one of these changes:
    * an owner is added to or removed from an organization
    * a venue is put into or taken out of an organization
    * an organization is deleted
    * an admin changes a user's role or rebuilds their venue list
Rows a manager already had before becoming an owner keep via_org = FALSE and are never deleted here,
so taking someone off an organization only removes what the organization gave them.

Rules:
    * Owners are manager accounts (users.role = 'venue_manager'). A worker or admin can't be an owner.
    * Venue sign-up doesn't exist yet: platform admins create organizations and put venues in them.
"""
import logging
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import normalize_role
from src.models import Organization, OrganizationMember, OrgRole, User, Venue, VenueManager
from src.schemas import OrganizationDetail, OrgOverview, OrgOwner, OrgVenue, OrgVenueToday
from src.services.public_board import venue_city

logger = logging.getLogger("shiftboard.organizations")

OWNER = OrgRole.owner.value


async def sync_managers(db: AsyncSession) -> None:
    """
    Make venue_managers match organization ownership. Does NOT commit.
    wanted = every (venue, owner) pair where the venue is in an organization the user owns.
      * a via_org row that is no longer wanted is deleted
      * a wanted pair with no row gets one (via_org = TRUE)
      * a wanted pair that already has a direct row is left exactly as it is
    """
    await db.flush()
    wanted = set((await db.execute(
        select(Venue.id, OrganizationMember.user_id)
        .join(OrganizationMember, OrganizationMember.organization_id == Venue.organization_id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.role == OWNER, func.lower(User.role) == "venue_manager")
    )).all())
    have = {(r.venue_id, r.user_id): r for r in (await db.execute(select(VenueManager))).scalars().all()}
    for key, row in have.items():
        if row.via_org and key not in wanted:
            await db.delete(row)
    for venue_id, user_id in wanted:
        if (venue_id, user_id) not in have:
            db.add(VenueManager(venue_id=venue_id, user_id=user_id, is_primary=False, via_org=True))
    await db.flush()


async def drop_memberships_unless_manager(db: AsyncSession, user: User) -> None:
    """Owners are manager accounts. Call after a role change, before sync_managers(). Does NOT commit."""
    if normalize_role(user.role) != "venue_manager":
        await db.execute(delete(OrganizationMember).where(OrganizationMember.user_id == user.id))


async def owned_org_ids(db: AsyncSession, user: User) -> List:
    return list((await db.execute(
        select(OrganizationMember.organization_id).where(
            OrganizationMember.user_id == user.id, OrganizationMember.role == OWNER,
        )
    )).scalars().all())


async def is_owner(db: AsyncSession, user: User, organization_id) -> bool:
    return bool(await db.scalar(
        select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user.id,
            OrganizationMember.role == OWNER,
        )
    ))


async def owner_org_of_venue(db: AsyncSession, user_id, venue_id) -> Optional[Organization]:
    """The organization that makes this user a manager of this venue, if any."""
    return await db.scalar(
        select(Organization)
        .join(Venue, Venue.organization_id == Organization.id)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(Venue.id == venue_id, OrganizationMember.user_id == user_id, OrganizationMember.role == OWNER)
    )


async def load_org(db: AsyncSession, organization_id, user: User, admin_only: bool = False) -> Organization:
    """404 if it doesn't exist. Platform admins: always. Owners: unless admin_only."""
    org = await db.scalar(select(Organization).where(Organization.id == organization_id))
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return org
    if admin_only:
        raise HTTPException(status_code=403, detail="Only a platform admin can do that.")
    if not await is_owner(db, user, org.id):
        raise HTTPException(status_code=403, detail="You don't own this organization.")
    return org


def clean_name(name: Optional[str]) -> str:
    name = " ".join((name or "").split())[:255]
    if not name:
        raise HTTPException(status_code=400, detail="Give the organization a name.")
    return name


async def name_taken(db: AsyncSession, name: str, except_id=None) -> bool:
    q = select(Organization.id).where(func.lower(Organization.name) == name.lower())
    if except_id is not None:
        q = q.where(Organization.id != except_id)
    return bool(await db.scalar(q))


async def detail(db: AsyncSession, org: Organization, viewer: Optional[User] = None) -> OrganizationDetail:
    owners = (await db.execute(
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == org.id, OrganizationMember.role == OWNER)
        .order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
    )).all()
    venues = (await db.execute(
        select(Venue).where(Venue.organization_id == org.id).order_by(Venue.name.asc())
    )).scalars().all()
    direct = dict((await db.execute(
        select(VenueManager.venue_id, func.count(VenueManager.user_id))
        .where(VenueManager.venue_id.in_([v.id for v in venues] or [None]), VenueManager.via_org == False)
        .group_by(VenueManager.venue_id)
    )).all()) if venues else {}
    viewer_id = viewer.id if viewer is not None else None
    return OrganizationDetail(
        id=org.id,
        name=org.name,
        owners=[
            OrgOwner(
                user_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email,
                phone=u.phone, venue_alerts=bool(m.venue_alerts), is_you=u.id == viewer_id,
            )
            for m, u in owners
        ],
        venues=[
            OrgVenue(
                id=v.id, name=v.name, city=venue_city(v), timezone=v.timezone or "America/New_York",
                managers=int(direct.get(v.id, 0)), public_board=bool(v.public_board),
            )
            for v in venues
        ],
        is_owner=any(u.id == viewer_id for _m, u in owners),
        created_at=org.created_at,
    )


async def venues_without_manager(db: AsyncSession, venue_ids: Iterable) -> List[str]:
    """Names of these venues that now have nobody managing them (for a warning, not an error)."""
    ids = [v for v in venue_ids if v]
    if not ids:
        return []
    managed = set((await db.execute(
        select(VenueManager.venue_id).where(VenueManager.venue_id.in_(ids)).distinct()
    )).scalars().all())
    names = (await db.execute(
        select(Venue.name).where(Venue.id.in_([v for v in ids if v not in managed] or [None])).order_by(Venue.name)
    )).scalars().all()
    return [f"{n} has no manager now. Add one in Admin → Venues." for n in names]


async def overview(db: AsyncSession, org: Organization) -> OrgOverview:
    """Every venue in the organization, side by side: today and the week ahead."""
    from src.services.tonight import build_tonight        # imported here: tonight imports a lot

    now = datetime.now(timezone.utc)
    venues = (await db.execute(
        select(Venue).where(Venue.organization_id == org.id).order_by(Venue.name.asc())
    )).scalars().all()
    cards = []
    for v in venues:
        t = await build_tonight(db, v)
        c = t.counts or {}
        week_events = [e for d in t.week for e in d.events if e.status != "draft"]
        upcoming = sorted((e for e in week_events if e.start_time > now), key=lambda e: e.start_time)
        cards.append(OrgVenueToday(
            venue_id=v.id,
            name=v.name,
            city=venue_city(v),
            timezone=t.timezone,
            events_today=int(c.get("events", 0)),
            live_now=sum(1 for e in t.events if e.state == "live"),
            booked_today=int(c.get("booked", 0)),
            clocked_in=int(c.get("clocked_in", 0)),
            late=int(c.get("late", 0)) + int(c.get("missed", 0)),
            open_spots_today=int(c.get("open_spots", 0)),
            open_spots_week=sum(e.open_spots for e in week_events),
            requests_waiting=sum(e.requested for e in week_events),
            events_week=len(week_events),
            next_event_title=upcoming[0].title if upcoming else None,
            next_event_start=upcoming[0].start_time if upcoming else None,
        ))
    keys = ("events_today", "live_now", "booked_today", "clocked_in", "late",
            "open_spots_today", "open_spots_week", "requests_waiting", "events_week")
    return OrgOverview(
        organization_id=org.id, name=org.name, now=now, venues=cards,
        totals={k: sum(getattr(c, k) for c in cards) for k in keys},
    )
```

---

## B4. NEW FILE `backend/src/routers/public.py`
The only endpoints that need no sign-in. The first line is `"""` and the **last line is `    return await build_public_board(db, days)`**.

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


@router.get("/config", response_model=PublicConfig)
async def public_config():
    return PublicConfig(
        public_board=bool(settings.PUBLIC_EVENT_BOARD),
        self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
    )


@router.get("/board", response_model=PublicBoard)
async def public_board(
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS, description="How far ahead to look"),
    db: AsyncSession = Depends(get_db),
):
    if not settings.PUBLIC_EVENT_BOARD:
        raise HTTPException(status_code=404, detail="The public board is turned off.")
    return await build_public_board(db, days)
```

---

## B5. NEW FILE `backend/src/routers/organizations.py`
The first line is `"""` and the **last line is `                          person=people[0] if people else None)`**.

```python
"""
Phase 36: organizations (a group of venues) and their owners.

  GET    /api/organizations                                   admin: all · owner: the ones they own
  POST   /api/organizations                                   admin   create (name + venues)
  GET    /api/organizations/{org_id}
  PATCH  /api/organizations/{org_id}                          owner / admin   rename
  DELETE /api/organizations/{org_id}                          admin   the venues stay; they just stop being grouped
  POST   /api/organizations/{org_id}/owners                   owner / admin   add an owner by email
  DELETE /api/organizations/{org_id}/owners/{user_id}         owner / admin
  POST   /api/organizations/{org_id}/venues                   admin   put a venue in
  DELETE /api/organizations/{org_id}/venues/{venue_id}        admin   take a venue out
  PATCH  /api/organizations/{org_id}/me                       owner   my own settings (venue alerts)
  GET    /api/organizations/{org_id}/overview                 every venue side by side
  GET    /api/organizations/{org_id}/people?q=                everyone on any of its venues' teams
  POST   /api/organizations/{org_id}/people/{worker_id}/share copy or move a person to other venues

There is no venue sign-up yet: only platform admins create organizations and decide which venues
are in them. An owner manages every venue in the organization through ordinary venue_managers
rows (via_org = TRUE) kept in step by services/organizations.sync_managers().
"""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_password_hash, normalize_role, require_admin, require_manager_or_admin
from src.database import get_db
from src.models import (
    Organization, OrganizationMember, User, Venue, VenuePosition, VenueWhitelist,
)
from src.routers.admin import _generate_temp_password
from src.routers.team import build_team
from src.schemas import (
    OrganizationCreate, OrganizationDetail, OrganizationUpdate, OrgChangeResult, OrgMyUpdate,
    OrgOverview, OrgOwnerAdd, OrgPerson, OrgPersonVenue, OrgShareBody, OrgShareResult, OrgShareSkip,
    OrgVenueAdd,
)
from src.services import activity, admin_audit, notify_events
from src.services import organizations as orgs
from src.services.invites import valid_email
from src.services.team import set_membership

logger = logging.getLogger("shiftboard.organizations")

router = APIRouter(prefix="/api/organizations", tags=["Organizations"])


def _is_admin(user: User) -> bool:
    return normalize_role(user.role) in ("platform_admin", "super_admin")


async def _result(db, org, user, message="Saved.", warnings=None, **kw) -> OrgChangeResult:
    return OrgChangeResult(
        organization=await orgs.detail(db, org, user), message=message, warnings=warnings or [], **kw
    )


# ---------------------------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------------------------
@router.get("", response_model=List[OrganizationDetail])
async def list_organizations(
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(Organization).order_by(func.lower(Organization.name))
    if not _is_admin(current_user):
        mine = await orgs.owned_org_ids(db, current_user)
        if not mine:
            return []
        q = q.where(Organization.id.in_(mine))
    rows = (await db.execute(q)).scalars().all()
    return [await orgs.detail(db, o, current_user) for o in rows]


@router.post("", response_model=OrgChangeResult, status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    name = orgs.clean_name(body.name)
    if await orgs.name_taken(db, name):
        raise HTTPException(status_code=409, detail="An organization with that name already exists.")
    venue_ids = list(dict.fromkeys(body.venue_ids or []))
    venues = []
    if venue_ids:
        venues = (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()
        if len(venues) != len(venue_ids):
            raise HTTPException(status_code=400, detail="One of those venues doesn't exist.")
        taken = [v.name for v in venues if v.organization_id is not None]
        if taken:
            raise HTTPException(
                status_code=409,
                detail=f"{', '.join(taken)} already belong{'s' if len(taken) == 1 else ''} to an organization. Take them out of it first.",
            )
    try:
        org = Organization(name=name, created_by_user_id=current_user.id)
        db.add(org)
        await db.flush()
        for v in venues:
            v.organization_id = org.id
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.exception("create_organization failed")
        raise HTTPException(status_code=500, detail=f"Could not create the organization: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_created", f"Created the organization {name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, "Organization created. Add an owner next.")


@router.get("/{org_id}", response_model=OrganizationDetail)
async def get_organization(
    org_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    return await orgs.detail(db, org, current_user)


@router.patch("/{org_id}", response_model=OrgChangeResult)
async def rename_organization(
    org_id: UUID,
    body: OrganizationUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    name = orgs.clean_name(body.name)
    if await orgs.name_taken(db, name, except_id=org.id):
        raise HTTPException(status_code=409, detail="An organization with that name already exists.")
    old = org.name
    try:
        org.name = name
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not rename it: {e}")
    await db.refresh(org)
    if _is_admin(current_user) and old != name:
        await admin_audit.record(current_user.id, "org_updated", f"Renamed the organization {old} to {name}",
                                 target_type="organization", target_id=org.id)
    return await _result(db, org, current_user)


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    org_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The venues, their managers, teams and history are untouched. Owners lose the venues they only had through it."""
    org = await orgs.load_org(db, org_id, current_user, admin_only=True)
    name = org.name
    try:
        for v in (await db.execute(select(Venue).where(Venue.organization_id == org.id))).scalars().all():
            v.organization_id = None
        await db.execute(delete(OrganizationMember).where(OrganizationMember.organization_id == org.id))
        await db.delete(org)
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not delete it: {e}")
    await admin_audit.record(current_user.id, "org_deleted", f"Deleted the organization {name}",
                             target_type="organization", target_id=org_id)
    return None


# ---------------------------------------------------------------------------------------------
# Owners
# ---------------------------------------------------------------------------------------------
@router.post("/{org_id}/owners", response_model=OrgChangeResult, status_code=status.HTTP_201_CREATED)
async def add_owner(
    org_id: UUID,
    body: OrgOwnerAdd,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """An existing manager account is linked. No account -> a manager account is created with a temporary
    password (returned once). Worker and admin accounts are refused."""
    org = await orgs.load_org(db, org_id, current_user)
    email = (body.email or "").strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    temp = None
    created = False
    try:
        user = await db.scalar(select(User).where(func.lower(User.email) == email))
        if user is not None:
            role = normalize_role(user.role)
            if role == "platform_admin":
                raise HTTPException(status_code=400, detail="That's a platform admin; they can already manage every venue.")
            if role != "venue_manager":
                raise HTTPException(
                    status_code=409,
                    detail="That email belongs to a worker account. Owners need a manager account: ask a platform admin to change it, or use a different email.",
                )
            if not user.is_active:
                raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
            if await orgs.is_owner(db, user, org.id):
                raise HTTPException(status_code=400, detail="They already own this organization.")
        else:
            first = (body.first_name or "").strip()[:100]
            if not first:
                raise HTTPException(status_code=400, detail="First name is required for a new account.")
            temp = _generate_temp_password()
            user = User(
                email=email, hashed_password=get_password_hash(temp), role="venue_manager",
                first_name=first, last_name=(body.last_name or "").strip()[:100],
                phone=(body.phone or "").strip()[:30] or None,
                skills=[], aggregate_rating=5.0, rating_count=0, total_shifts=0, is_active=True,
            )
            db.add(user)
            await db.flush()
            created = True
        who = admin_audit.person(user)
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=orgs.OWNER, venue_alerts=False))
        await orgs.sync_managers(db)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("add_owner failed")
        raise HTTPException(status_code=500, detail=f"Could not add the owner: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_owner", f"Made {who} an owner of {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(
        db, org, current_user,
        ("Owner account created. Give them this temporary password; it's shown only once." if created
         else "Added. They manage every venue in this organization from their next page load."),
        created=created, temporary_password=temp,
    )


@router.delete("/{org_id}/owners/{user_id}", response_model=OrgChangeResult)
async def remove_owner(
    org_id: UUID,
    user_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    admin = _is_admin(current_user)
    row = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.user_id == user_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="They don't own this organization.")
    if not admin:
        if user_id == current_user.id:
            raise HTTPException(status_code=400, detail="You can't remove yourself. Ask another owner or a platform admin.")
    target = await db.scalar(select(User).where(User.id == user_id))
    who = admin_audit.person(target)
    venue_ids = list((await db.execute(select(Venue.id).where(Venue.organization_id == org.id))).scalars().all())
    try:
        await db.delete(row)
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the owner: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_owner", f"Removed {who} as an owner of {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, "Removed. They keep any venue they manage directly.",
                         warnings=await orgs.venues_without_manager(db, venue_ids))


@router.patch("/{org_id}/me", response_model=OrgChangeResult)
async def update_my_membership(
    org_id: UUID,
    body: OrgMyUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    row = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.user_id == current_user.id,
        )
    )
    if row is None:
        raise HTTPException(status_code=400, detail="Only an owner of this organization has this setting.")
    try:
        row.venue_alerts = bool(body.venue_alerts)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    return await _result(
        db, org, current_user,
        "You'll get each venue's manager alerts." if body.venue_alerts
        else "Venue alerts off. You still get them for venues you manage directly, and for a venue with no other manager.",
    )


# ---------------------------------------------------------------------------------------------
# Venues (platform admin only: there is no venue sign-up yet)
# ---------------------------------------------------------------------------------------------
@router.post("/{org_id}/venues", response_model=OrgChangeResult)
async def add_venue(
    org_id: UUID,
    body: OrgVenueAdd,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user, admin_only=True)
    venue = await db.scalar(select(Venue).where(Venue.id == body.venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if venue.organization_id == org.id:
        raise HTTPException(status_code=400, detail="That venue is already in this organization.")
    if venue.organization_id is not None:
        other = await db.scalar(select(Organization.name).where(Organization.id == venue.organization_id))
        raise HTTPException(status_code=409, detail=f"{venue.name} belongs to {other}. Take it out of that organization first.")
    vname = venue.name
    try:
        venue.organization_id = org.id
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not add the venue: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_venue", f"Put {vname} into {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, f"{vname} is in {org.name}. Its owners manage it now.")


@router.delete("/{org_id}/venues/{venue_id}", response_model=OrgChangeResult)
async def remove_venue(
    org_id: UUID,
    venue_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user, admin_only=True)
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id, Venue.organization_id == org.id))
    if venue is None:
        raise HTTPException(status_code=404, detail="That venue isn't in this organization.")
    vname = venue.name
    try:
        venue.organization_id = None
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not take the venue out: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_venue", f"Took {vname} out of {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, f"{vname} is on its own again.",
                         warnings=await orgs.venues_without_manager(db, [venue_id]))


# ---------------------------------------------------------------------------------------------
# The combined view
# ---------------------------------------------------------------------------------------------
@router.get("/{org_id}/overview", response_model=OrgOverview)
async def organization_overview(
    org_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    return await orgs.overview(db, org)


async def _people(db: AsyncSession, org: Organization, only_ids: Optional[List[UUID]] = None) -> List[OrgPerson]:
    """Everyone with a team row at any venue of the organization (any status), one line per person."""
    venues = (await db.execute(
        select(Venue).where(Venue.organization_id == org.id).order_by(Venue.name.asc())
    )).scalars().all()
    leads = set((await db.execute(
        select(VenueWhitelist.venue_id, VenueWhitelist.worker_id).where(
            VenueWhitelist.venue_id.in_([v.id for v in venues] or [None]),
            VenueWhitelist.is_lead == True, VenueWhitelist.is_active == True,
        )
    )).all()) if venues else set()
    people = {}
    for v in venues:
        for m in await build_team(db, v.id, only_ids=only_ids):
            if not m.on_list and m.status == "none":
                continue
            p = people.get(m.worker_id)
            if p is None:
                p = people[m.worker_id] = OrgPerson(
                    worker_id=m.worker_id, first_name=m.first_name, last_name=m.last_name, email=m.email,
                    phone=m.phone, aggregate_rating=m.aggregate_rating, rating_count=m.rating_count, venues=[],
                )
            p.venues.append(OrgPersonVenue(
                venue_id=v.id, venue_name=v.name, status=m.status, positions=m.positions,
                is_lead=(v.id, m.worker_id) in leads, shifts_worked=m.shifts_worked, upcoming=m.upcoming,
                works_through=m.works_through,
            ))
    out = list(people.values())
    out.sort(key=lambda p: ((p.first_name or "").lower(), (p.last_name or "").lower()))
    return out


@router.get("/{org_id}/people", response_model=List[OrgPerson])
async def organization_people(
    org_id: UUID,
    q: Optional[str] = Query(None, max_length=100),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    people = await _people(db, org)
    needle = (q or "").strip().lower()
    if needle:
        people = [
            p for p in people
            if needle in f"{p.first_name} {p.last_name}".lower() or needle in (p.email or "").lower()
            or needle in (p.phone or "")
        ]
    return people


@router.post("/{org_id}/people/{worker_id}/share", response_model=OrgShareResult)
async def share_person(
    org_id: UUID,
    worker_id: UUID,
    body: OrgShareBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    copy: put this person on other venues' teams in the organization.
    move: the same, and take them off the from venue's team (their bookings there are not touched).
    Their positions come along where the other venue has a position with the same name, and their
    staffing company comes along where the other venue has none recorded. A venue that blocked them
    is skipped: unblock them there first.
    """
    org = await orgs.load_org(db, org_id, current_user)
    mode = (body.mode or "copy").strip().lower()
    if mode not in ("copy", "move"):
        raise HTTPException(status_code=400, detail="Choose copy or move.")
    target_ids = list(dict.fromkeys(body.to_venue_ids or []))
    if not target_ids:
        raise HTTPException(status_code=400, detail="Pick at least one venue.")
    if mode == "move" and body.from_venue_id is None:
        raise HTTPException(status_code=400, detail="Say which venue you're moving them from.")
    if body.from_venue_id is not None and body.from_venue_id in target_ids:
        raise HTTPException(status_code=400, detail="The venue they're coming from can't also be where they're going.")
    wanted = target_ids + ([body.from_venue_id] if body.from_venue_id is not None else [])
    venues = {
        v.id: v for v in (await db.execute(
            select(Venue).where(Venue.id.in_(wanted), Venue.organization_id == org.id)
        )).scalars().all()
    }
    if len(venues) != len(wanted):
        raise HTTPException(status_code=400, detail="All of the venues must be in this organization.")
    worker = await db.scalar(select(User).where(User.id == worker_id))
    if worker is None or normalize_role(worker.role) != "worker":
        raise HTTPException(status_code=404, detail="Worker not found.")
    if not worker.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
    name = f"{worker.first_name or ''} {worker.last_name or ''}".strip() or worker.email

    source = None
    if body.from_venue_id is not None:
        source = await db.scalar(
            select(VenueWhitelist).where(
                VenueWhitelist.venue_id == body.from_venue_id, VenueWhitelist.worker_id == worker_id,
            )
        )
        if source is None or (source.status or "active") != "active":
            raise HTTPException(status_code=400, detail=f"{name} isn't on {venues[body.from_venue_id].name}'s team.")
    source_positions = list(source.positions or []) if source is not None else []
    source_name = venues[body.from_venue_id].name if body.from_venue_id is not None else None

    added, added_ids, skipped = [], [], []
    try:
        for vid in target_ids:
            v = venues[vid]
            row = await db.scalar(
                select(VenueWhitelist).where(VenueWhitelist.venue_id == vid, VenueWhitelist.worker_id == worker_id)
            )
            if row is not None and (row.status or "active") == "blocked":
                skipped.append(OrgShareSkip(venue_name=v.name, reason="Blocked at this venue. Unblock them on its Team page first."))
                continue
            if row is not None and (row.status or "active") == "active":
                skipped.append(OrgShareSkip(venue_name=v.name, reason="Already on this team."))
                continue
            names = {
                (n or "").lower(): n for n in (await db.execute(
                    select(VenuePosition.name).where(VenuePosition.venue_id == vid, VenuePosition.is_active == True)
                )).scalars().all()
            }
            positions = [names[p.lower()] for p in source_positions if p and p.lower() in names]
            row = await set_membership(db, vid, worker_id, status="active", source="manager",
                                       positions=positions, added_by=current_user.id)
            if source is not None and not row.works_through and source.works_through:
                row.works_through = source.works_through
            added.append(v.name)
            added_ids.append(vid)
        moved = False
        if mode == "move" and added:
            source.status = "removed"
            source.is_active = False
            source.is_lead = False
            moved = True
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("share_person failed")
        raise HTTPException(status_code=500, detail=f"Could not share them: {e}")

    for vid in added_ids:
        await activity.for_worker(
            "team_added", vid, worker_id, current_user.id,
            "Added {name} to the team" + (f" (from {source_name})".replace("{", "{{").replace("}", "}}") if source_name else ""),
        )
        await notify_events.team_added(vid, worker_id)
    if moved:
        await activity.for_worker("team_status", body.from_venue_id, worker_id, current_user.id,
                                  "Moved {name} to another venue in the organization")

    if not added:
        message = f"Nothing changed for {name}."
    elif moved:
        message = f"Moved {name} from {source_name} to {', '.join(added)}. Shifts they're already booked on at {source_name} are not changed."
    else:
        message = f"{name} is now on the team at {', '.join(added)}."
    people = await _people(db, org, only_ids=[worker_id])
    return OrgShareResult(added=added, skipped=skipped, moved=moved, message=message,
                          person=people[0] if people else None)
```

---

## B6. NEW FILE `backend/src/routers/lead.py`
What a shift lead reads. No pay fields. The first line is `"""` and the **last line is `    )`**.

```python
"""
Phase 36: what a shift lead reads.

A shift lead is a WORKER account marked "shift lead" on a venue's team (venue_whitelists.is_lead).
They run the floor: see who's on today, clock people in and out, mark no-shows, fix clock times,
post on the shift chat, and fill open spots from the team. They never see pay.

  GET /api/lead/venues                       the venues where I'm a shift lead
  GET /api/lead/venues/{venue_id}/tonight    the Today board (the manager's board has no pay in it either)
  GET /api/lead/events/{event_id}/times      everyone's clock times for one event: hours, never pay

The response models here have NO pay fields. Never add one, and never return a manager schema
(EventTimesheet, EventDetail, ShiftRosterResponse, ...) from this file.

What a lead CHANGES goes through the existing endpoints, which accept managers and leads
(services/access.floor_access):
  POST   /api/requests/{id}/no-show          POST /api/requests/{id}/time-entries
  PATCH  /api/time-entries/{id}              POST /api/time-entries/{id}/delete
  GET    /api/shifts/{id}/candidates         POST /api/shifts/{id}/assign      POST /api/shifts/{id}/offers
  DELETE /api/offers/{id}                    GET / POST /api/shifts/{id}/messages
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_current_user
from src.database import get_db
from src.models import ShiftEvent, User, Venue
from src.schemas import LeadTimes, LeadTimesPerson, LeadVenue, TonightResponse
from src.services.access import LEAD, floor_access, lead_venue_ids
from src.services.timesheets import build_timesheet
from src.services.tonight import build_tonight

router = APIRouter(prefix="/api/lead", tags=["Shift lead"])


@router.get("/venues", response_model=List[LeadVenue])
async def my_lead_venues(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ids = await lead_venue_ids(db, current_user)
    if not ids:
        return []
    venues = (await db.execute(select(Venue).where(Venue.id.in_(ids)).order_by(Venue.name.asc()))).scalars().all()
    return [LeadVenue(venue_id=v.id, name=v.name, timezone=v.timezone or "America/New_York") for v in venues]


@router.get("/venues/{venue_id}/tonight", response_model=TonightResponse)
async def lead_tonight(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    access = await floor_access(db, current_user, venue_id)
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    board = await build_tonight(db, venue)
    if access == LEAD:
        for day in board.week:                      # drafts are the manager's business
            day.events = [e for e in day.events if e.status != "draft"]
    return board


@router.get("/events/{event_id}/times", response_model=LeadTimes)
async def lead_event_times(
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    await floor_access(db, current_user, event.venue_id)
    if (event.status or "published") == "draft":
        raise HTTPException(status_code=404, detail="Event not found.")
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    sheet = await build_timesheet(db, event, venue)
    people = [
        LeadTimesPerson(
            request_id=p.request_id, worker_id=p.worker_id, name=p.name, shift_id=p.shift_id,
            role_type=p.role_type, status=p.status, status_reason=p.status_reason, entries=p.entries,
            total_hours=p.total_hours, time_tracking=p.time_tracking, is_you=p.worker_id == current_user.id,
        )
        for p in sheet.people
    ]
    return LeadTimes(
        event_id=sheet.event_id, venue_id=event.venue_id, title=sheet.title, start_time=sheet.start_time,
        end_time=sheet.end_time, timezone=sheet.timezone, cancelled=sheet.cancelled, started=sheet.started,
        people=people, total_hours=sheet.total_hours,
    )
```

---

# PART C: Backend, edits

## C1. `backend/src/main.py` (2 EDITS)
Three imports and three `include_router` lines. Nothing else in this file.

**Edit 1.** Find:
```python
from src.routers.pay_periods import router as pay_periods_router   # Phase 35
from src.routers.tips import router as tips_router                 # Phase 35.2
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```
Replace with:
```python
from src.routers.pay_periods import router as pay_periods_router   # Phase 35
from src.routers.tips import router as tips_router                 # Phase 35.2
from src.routers.public import router as public_router             # Phase 36
from src.routers.organizations import router as organizations_router   # Phase 36
from src.routers.lead import router as lead_router                 # Phase 36
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```

**Edit 2.** Find:
```python
app.include_router(pay_periods_router)   # Phase 35
app.include_router(tips_router)          # Phase 35.2


@app.get("/healthz", tags=["System"])
```
Replace with:
```python
app.include_router(pay_periods_router)   # Phase 35
app.include_router(tips_router)          # Phase 35.2
app.include_router(public_router)        # Phase 36: no sign-in needed
app.include_router(organizations_router) # Phase 36
app.include_router(lead_router)          # Phase 36


@app.get("/healthz", tags=["System"])
```

---

## C2. `backend/src/config.py` (1 EDIT)
The new setting, right after `SEED_DEMO_ACCOUNTS`. This file has CRLF line endings: keep them.

**Edit 1.** Find:
```python
    # false = a clean install: only the super admin (and ALWAYS_ADMIN_EMAILS) is set up.
    SEED_DEMO_ACCOUNTS: bool = os.getenv("SEED_DEMO_ACCOUNTS", "true").lower() in ("true", "1", "yes")
    # Phase 28.1: emails that are always platform admins (comma-separated)
    ALWAYS_ADMIN_EMAILS: str = os.getenv("ALWAYS_ADMIN_EMAILS", "")
```
Replace with:
```python
    # false = a clean install: only the super admin (and ALWAYS_ADMIN_EMAILS) is set up.
    SEED_DEMO_ACCOUNTS: bool = os.getenv("SEED_DEMO_ACCOUNTS", "true").lower() in ("true", "1", "yes")
    # Phase 36: true = the home page (/) is a public board of posted shifts for people who aren't signed in,
    # with a Sign in / Sign up button. false = the home page is the sign-in page, as before.
    PUBLIC_EVENT_BOARD: bool = os.getenv("PUBLIC_EVENT_BOARD", "false").lower() in ("true", "1", "yes")
    # Phase 28.1: emails that are always platform admins (comma-separated)
    ALWAYS_ADMIN_EMAILS: str = os.getenv("ALWAYS_ADMIN_EMAILS", "")
```

---

## C3. `backend/src/schemas.py` (7 EDITS)
Small additions to five existing models, and the new Phase 36 models appended at the end of the file.

**Edit 1.** Find:
```python
    tip_pool_payroll: bool = True           # Phase 35.2: venue-payroll people share tip pools (scheduled hours)
    tips_shown_to_workers: bool = True      # Phase 35.2: workers see their tips in Hours & pay

class VenueCreate(BaseModel):
```
Replace with:
```python
    tip_pool_payroll: bool = True           # Phase 35.2: venue-payroll people share tip pools (scheduled hours)
    tips_shown_to_workers: bool = True      # Phase 35.2: workers see their tips in Hours & pay
    public_board: bool = True               # Phase 36: listed on the public event board
    city: Optional[str] = None              # Phase 36: shown on the public board (never the address)

class VenueCreate(BaseModel):
```

**Edit 2.** Find:
```python
    tip_pool_payroll: Optional[bool] = None           # Phase 35.2
    tips_shown_to_workers: Optional[bool] = None      # Phase 35.2

class VenueResponse(VenueBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
```
Replace with:
```python
    tip_pool_payroll: Optional[bool] = None           # Phase 35.2
    tips_shown_to_workers: Optional[bool] = None      # Phase 35.2
    public_board: Optional[bool] = None               # Phase 36
    city: Optional[str] = Field(None, max_length=120) # Phase 36: "" clears it (the board then works it out from the address)

class VenueResponse(VenueBase):
    id: UUID
    organization_id: Optional[UUID] = None            # Phase 36
    created_at: datetime
    updated_at: datetime
```

**Edit 3.** Find:
```python
class ShiftBoardMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)

class ShiftBoardMessageResponse(BaseModel):
```
Replace with:
```python
class ShiftBoardMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    notify: bool = False                     # Phase 36: managers and shift leads: also send it to everyone booked on the shift

class ShiftBoardMessageResponse(BaseModel):
```

**Edit 4.** Find:
```python
    effective_time_tracking: str = "shiftboard"   # Phase 35: what applies to their next booking
    works_through: Optional[str] = None      # Phase 35: staffing company / agency


class TeamMemberUpdate(BaseModel):
```
Replace with:
```python
    effective_time_tracking: str = "shiftboard"   # Phase 35: what applies to their next booking
    works_through: Optional[str] = None      # Phase 35: staffing company / agency
    is_lead: bool = False                    # Phase 36: shift lead at this venue


class TeamMemberUpdate(BaseModel):
```

**Edit 5.** Find:
```python
    time_tracking: Optional[str] = None      # Phase 35: payroll | shiftboard | venue (or null) = use the venue setting
    works_through: Optional[str] = Field(None, max_length=120)   # Phase 35: "" clears it


class TeamMemberUpdateResult(BaseModel):
```
Replace with:
```python
    time_tracking: Optional[str] = None      # Phase 35: payroll | shiftboard | venue (or null) = use the venue setting
    works_through: Optional[str] = Field(None, max_length=120)   # Phase 35: "" clears it
    is_lead: Optional[bool] = None           # Phase 36: make / stop being a shift lead (active team members only)


class TeamMemberUpdateResult(BaseModel):
```

**Edit 6.** Find:
```python
    is_primary: bool = False
    is_you: bool = False


class ManagerCreate(BaseModel):
```
Replace with:
```python
    is_primary: bool = False
    is_you: bool = False
    via_org: bool = False                    # Phase 36: manages this venue as an owner of its organization
    organization_name: Optional[str] = None  # Phase 36


class ManagerCreate(BaseModel):
```

**Edit 7.** Find:
```python
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
MyProfile.model_rebuild()
```
Replace with:
```python
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
MyProfile.model_rebuild()


# ------------------------------------------------------------------------------
# Phase 36: Organizations, owners, shift leads and the public event board
# ------------------------------------------------------------------------------
class OrgOwner(BaseModel):
    user_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    venue_alerts: bool = False               # also gets each venue's manager alerts
    is_you: bool = False


class OrgVenue(BaseModel):
    id: UUID
    name: str
    city: Optional[str] = None
    timezone: str = "America/New_York"
    managers: int = 0                        # managers assigned directly (owners not counted)
    public_board: bool = True


class OrganizationDetail(BaseModel):
    id: UUID
    name: str
    owners: List[OrgOwner] = []
    venues: List[OrgVenue] = []
    is_owner: bool = False                   # the viewer owns it (false for a platform admin who doesn't)
    created_at: Optional[datetime] = None


class OrganizationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    venue_ids: List[UUID] = []


class OrganizationUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class OrgOwnerAdd(BaseModel):
    email: str
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None


class OrgVenueAdd(BaseModel):
    venue_id: UUID


class OrgMyUpdate(BaseModel):
    venue_alerts: bool


class OrgChangeResult(BaseModel):
    organization: OrganizationDetail
    message: str = "Saved."
    warnings: List[str] = []                 # e.g. "Harbor House has no manager now."
    created: bool = False                    # a new manager account was made for the owner
    temporary_password: Optional[str] = None # shown once


class OrgVenueToday(BaseModel):
    venue_id: UUID
    name: str
    city: Optional[str] = None
    timezone: str = "America/New_York"
    events_today: int = 0
    live_now: int = 0                        # events running right now
    booked_today: int = 0
    clocked_in: int = 0
    late: int = 0                            # late + not clocked in yet after the start
    open_spots_today: int = 0
    open_spots_week: int = 0                 # today + 6 days, published events
    requests_waiting: int = 0                # today + 6 days
    events_week: int = 0
    next_event_title: Optional[str] = None
    next_event_start: Optional[datetime] = None


class OrgOverview(BaseModel):
    organization_id: UUID
    name: str
    now: datetime
    venues: List[OrgVenueToday] = []
    totals: dict = {}


class OrgPersonVenue(BaseModel):
    venue_id: UUID
    venue_name: str
    status: str = "active"                   # active | removed | blocked
    positions: List[str] = []
    is_lead: bool = False
    shifts_worked: int = 0
    upcoming: int = 0
    works_through: Optional[str] = None


class OrgPerson(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    aggregate_rating: float = 5.0
    rating_count: int = 0
    venues: List[OrgPersonVenue] = []        # only venues in this organization


class OrgShareBody(BaseModel):
    to_venue_ids: List[UUID]
    from_venue_id: Optional[UUID] = None     # copy their positions and staffing company from here
    mode: str = "copy"                       # copy | move (move also takes them off the from venue's team)


class OrgShareSkip(BaseModel):
    venue_name: str
    reason: str


class OrgShareResult(BaseModel):
    added: List[str] = []                    # venue names
    skipped: List[OrgShareSkip] = []
    moved: bool = False
    message: str = ""
    person: Optional[OrgPerson] = None


class LeadVenue(BaseModel):
    venue_id: UUID
    name: str
    timezone: str = "America/New_York"


class LeadTimesPerson(BaseModel):
    """A booked person's clock times. No pay fields, by design."""
    request_id: UUID
    worker_id: UUID
    name: str
    shift_id: UUID
    role_type: str
    status: str
    status_reason: Optional[str] = None
    entries: List[TimeEntryRow] = []
    total_hours: float = 0
    time_tracking: str = "shiftboard"
    is_you: bool = False                     # leads can't change their own times


class LeadTimes(BaseModel):
    event_id: UUID
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    timezone: str
    cancelled: bool = False
    started: bool = False
    people: List[LeadTimesPerson] = []
    total_hours: float = 0


class PublicBoardPosition(BaseModel):
    name: str
    open_spots: int = 0


class PublicBoardEvent(BaseModel):
    """What someone who isn't signed in may see. No pay, no address, no notes, no venue id."""
    event_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    timezone: str = "America/New_York"
    venue_name: str
    city: Optional[str] = None
    positions: List[PublicBoardPosition] = []
    open_spots: int = 0
    full: bool = False


class PublicBoard(BaseModel):
    events: List[PublicBoardEvent] = []
    days: int = 60
    generated_at: datetime


class PublicConfig(BaseModel):
    public_board: bool = False
    self_registration: bool = True
```

---

## C4. `backend/src/services/venue_positions.py` (3 EDITS)
`public_board` and `city` in the venue settings rules.

**Edit 1.** Find:
```python
    "team_time_tracking", "work_week_start", "pay_period", "pay_period_approval",                    # Phase 35
    "tips_enabled", "tip_pool_split", "tip_pool_payroll", "tips_shown_to_workers",                   # Phase 35.2
)
VALID_TIP_SPLITS = ("hours", "equal")                                                                 # Phase 35.2
```
Replace with:
```python
    "team_time_tracking", "work_week_start", "pay_period", "pay_period_approval",                    # Phase 35
    "tips_enabled", "tip_pool_split", "tip_pool_payroll", "tips_shown_to_workers",                   # Phase 35.2
    "public_board",                                                                                  # Phase 36
)
VALID_TIP_SPLITS = ("hours", "equal")                                                                 # Phase 35.2
```

**Edit 2.** Find:
```python
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
    "website_url",                                                                                   # Phase 34.6
)
WEBSITE_ERROR = "Enter the venue's web address, like www.yourvenue.com."
```
Replace with:
```python
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
    "website_url",                                                                                   # Phase 34.6
    "city",                                                                                          # Phase 36
)
WEBSITE_ERROR = "Enter the venue's web address, like www.yourvenue.com."
```

**Edit 3.** Find:
```python
        data["website_url"] = clean_website(data["website_url"])

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Choose how shift requests are approved.")
```
Replace with:
```python
        data["website_url"] = clean_website(data["website_url"])

    if data.get("city") and any(ch.isdigit() for ch in data["city"]):         # Phase 36: a city, not a street address
        raise HTTPException(status_code=400, detail="Enter just the city or area, like Denver, CO. No street numbers.")

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Choose how shift requests are approved.")
```

---

## C5. `backend/src/routers/venues.py` (3 EDITS)
Sign-in required on three older endpoints. Their bodies are unchanged.

**Edit 1.** Find:
```python
    return venue

@router.get("", response_model=List[VenueResponse])
async def list_venues(db: AsyncSession = Depends(get_db)):
    """List all registered venues"""
    result = await db.execute(select(Venue).order_by(Venue.name))
```
Replace with:
```python
    return venue

@router.get("", response_model=List[VenueResponse])
async def list_venues(
    current_user: User = Depends(get_current_user),          # Phase 36: sign-in required (it returns addresses and settings)
    db: AsyncSession = Depends(get_db),
):
    """List all registered venues"""
    result = await db.execute(select(Venue).order_by(Venue.name))
```

**Edit 2.** Find:
```python
    return venue

@router.get("/{venue_id}", response_model=VenueResponse)
async def get_venue(venue_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Task 3: Retrieve venue details by ID.
```
Replace with:
```python
    return venue

@router.get("/{venue_id}", response_model=VenueResponse)
async def get_venue(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),          # Phase 36: sign-in required
    db: AsyncSession = Depends(get_db),
):
    """
    Task 3: Retrieve venue details by ID.
```

**Edit 3.** Find:
```python
async def get_venue_shifts(
    venue_id: UUID,
    db: AsyncSession = Depends(get_db)
):
```
Replace with:
```python
async def get_venue_shifts(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),          # Phase 36: sign-in required (it returns pay)
    db: AsyncSession = Depends(get_db)
):
```

---

## C6. `backend/src/routers/timesheets.py` (9 EDITS)
No-show and the three clock-time endpoints accept shift leads. `remove_person` and `set_pay_rate` stay manager-only: don't change them.

**Edit 1.** Find:
```python
Phase 26: Manager actions on a single person's booking and their time entries.
Every change is audited in time_entry_edits.
"""
from datetime import datetime, timezone
```
Replace with:
```python
Phase 26: Manager actions on a single person's booking and their time entries.
Every change is audited in time_entry_edits.

Phase 36: shift leads (services/access.py) may mark a no-show and add, change or delete clock
times. Removing someone from a shift and setting pay stay manager-only. None of the four
lead-allowed endpoints returns pay. A lead can't change their own booking or times.
"""
from datetime import datetime, timezone
```

**Edit 2.** Find:
```python
from src.models import User, Shift, ShiftRequest, TimeEntry, TimeEntryEdit
from src.schemas import ReasonBody, TimeEntryInput, PayRateInput, NoShowResult
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services import notify_events
from src.services import activity
```
Replace with:
```python
from src.models import User, Shift, ShiftRequest, TimeEntry, TimeEntryEdit
from src.schemas import ReasonBody, TimeEntryInput, PayRateInput, NoShowResult
from src.auth import require_manager_or_admin, get_current_user
from src.services.venue_public import can_manage_venue
from src.services.access import floor_access, LEAD                 # Phase 36
from src.services import notify_events
from src.services import activity
```

**Edit 3.** Find:
```python
    return last is not None and last.new_value == NO_SHOW_RELEASED


async def _load_request(db: AsyncSession, request_id: UUID, user: User):
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Booking not found.")
    shift = await db.scalar(select(Shift).where(Shift.id == req.shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if not await can_manage_venue(db, user, shift.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return req, shift


async def _load_entry(db: AsyncSession, entry_id: UUID, user: User):
    entry = await db.scalar(select(TimeEntry).where(TimeEntry.id == entry_id))
    if not entry:
```
Replace with:
```python
    return last is not None and last.new_value == NO_SHOW_RELEASED


OWN_TIMES = "You can't change your own booking or clock times. Ask a manager."


async def _check_access(db: AsyncSession, user: User, shift: Shift, worker_id, floor: bool) -> None:
    """floor=False: managers only. floor=True (Phase 36): managers and the venue's shift leads."""
    if not floor:
        if not await can_manage_venue(db, user, shift.venue_id):
            raise HTTPException(status_code=403, detail="You don't manage this venue.")
        return
    if await floor_access(db, user, shift.venue_id) == LEAD and worker_id == user.id:
        raise HTTPException(status_code=403, detail=OWN_TIMES)


async def _load_request(db: AsyncSession, request_id: UUID, user: User, floor: bool = False):
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Booking not found.")
    shift = await db.scalar(select(Shift).where(Shift.id == req.shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    await _check_access(db, user, shift, req.worker_id, floor)
    return req, shift


async def _load_entry(db: AsyncSession, entry_id: UUID, user: User, floor: bool = False):
    entry = await db.scalar(select(TimeEntry).where(TimeEntry.id == entry_id))
    if not entry:
```

**Edit 4.** Find:
```python
    if not req or not shift:
        raise HTTPException(status_code=404, detail="Booking not found for this entry.")
    if not await can_manage_venue(db, user, shift.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return entry, req, shift


async def _locked_check(db: AsyncSession, shift: Shift, *moments) -> None:
```
Replace with:
```python
    if not req or not shift:
        raise HTTPException(status_code=404, detail="Booking not found for this entry.")
    await _check_access(db, user, shift, entry.worker_id, floor)
    return entry, req, shift


async def _locked_check(db: AsyncSession, shift: Shift, *moments) -> None:
```

**Edit 5.** Find:
```python
async def mark_no_show(
    request_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
```
Replace with:
```python
async def mark_no_show(
    request_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(get_current_user),          # Phase 36: managers and shift leads (checked in _load_request)
    db: AsyncSession = Depends(get_db)
):
    """
```

**Edit 6.** Find:
```python
    NO_SHOW_RELEASED so undoing it (adding time) gives the spot back.
    """
    req, shift = await _load_request(db, request_id, current_user)
    st = (req.status or "").lower()
    now = datetime.now(timezone.utc)
```
Replace with:
```python
    NO_SHOW_RELEASED so undoing it (adding time) gives the spot back.
    """
    req, shift = await _load_request(db, request_id, current_user, floor=True)
    st = (req.status or "").lower()
    now = datetime.now(timezone.utc)
```

**Edit 7.** Find:
```python
    request_id: UUID,
    body: TimeEntryInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    req, shift = await _load_request(db, request_id, current_user)
    reason = require_reason(body.reason)
    st = (req.status or "").lower()
```
Replace with:
```python
    request_id: UUID,
    body: TimeEntryInput,
    current_user: User = Depends(get_current_user),          # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db)
):
    req, shift = await _load_request(db, request_id, current_user, floor=True)
    reason = require_reason(body.reason)
    st = (req.status or "").lower()
```

**Edit 8.** Find:
```python
    entry_id: UUID,
    body: TimeEntryInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    entry, req, shift = await _load_entry(db, entry_id, current_user)
    reason = require_reason(body.reason)
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
```
Replace with:
```python
    entry_id: UUID,
    body: TimeEntryInput,
    current_user: User = Depends(get_current_user),          # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db)
):
    entry, req, shift = await _load_entry(db, entry_id, current_user, floor=True)
    reason = require_reason(body.reason)
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
```

**Edit 9.** Find:
```python
    entry_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    entry, req, shift = await _load_entry(db, entry_id, current_user)
    reason = require_reason(body.reason)
    await _locked_check(db, shift, entry.clock_in_time)                   # Phase 35
```
Replace with:
```python
    entry_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(get_current_user),          # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db)
):
    entry, req, shift = await _load_entry(db, entry_id, current_user, floor=True)
    reason = require_reason(body.reason)
    await _locked_check(db, shift, entry.clock_in_time)                   # Phase 35
```

---

## C7. `backend/src/routers/staffing.py` (5 EDITS)
Candidates, assign, offer and withdraw accept shift leads, limited to the team.

**Edit 1.** Find:
```python
Phase 29: Direct assign and offers.

Manager (venue's manager or platform admin):
  GET    /api/shifts/{shift_id}/candidates?q=     team (+ search) with availability
  POST   /api/shifts/{shift_id}/assign            book one person now
```
Replace with:
```python
Phase 29: Direct assign and offers.

Phase 36: the four manager endpoints also accept the venue's shift leads (services/access.py).
A lead only sees and picks people who are on the team, and can't assign or offer to themselves.
Nothing here returns pay.

Manager (venue's manager or platform admin) or shift lead:
  GET    /api/shifts/{shift_id}/candidates?q=     team (+ search) with availability
  POST   /api/shifts/{shift_id}/assign            book one person now
```

**Edit 2.** Find:
```python
    AssignCandidate, AssignRequest, AssignResult, OfferCreate, OfferCreateResult, WorkerOffer, OfferAcceptResult,
)
from src.auth import require_manager_or_admin, get_current_user, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services import staffing
from src.services import notify_events
```
Replace with:
```python
    AssignCandidate, AssignRequest, AssignResult, OfferCreate, OfferCreateResult, WorkerOffer, OfferAcceptResult,
)
from src.auth import get_current_user, normalize_role
from src.services.access import floor_access, team_ids, LEAD      # Phase 36
from src.services import staffing
from src.services import notify_events
```

**Edit 3.** Find:
```python
router = APIRouter(tags=["Staffing"])


async def _managed_shift(db: AsyncSession, shift_id: UUID, user: User) -> Shift:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    await verify_venue_manager_access(shift.venue_id, user, db)
    return shift


@router.get("/api/shifts/{shift_id}/candidates", response_model=List[AssignCandidate])
async def get_candidates(
    shift_id: UUID,
    q: Optional[str] = Query(None, max_length=100),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    shift = await _managed_shift(db, shift_id, current_user)
    return await staffing.list_candidates(db, shift, q=q)


@router.post("/api/shifts/{shift_id}/assign", response_model=AssignResult)
async def assign(
    shift_id: UUID,
    body: AssignRequest,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await _managed_shift(db, shift_id, current_user)
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id, reason=body.reason)
    await notify_events.assigned(request_id)          # after commit; never raises
```
Replace with:
```python
router = APIRouter(tags=["Staffing"])


async def _floor_shift(db: AsyncSession, shift_id: UUID, user: User):
    """Phase 36: the shift, and 'manager' or 'lead'. 403 for anyone else."""
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    return shift, await floor_access(db, user, shift.venue_id)


async def _lead_may_pick(db: AsyncSession, user: User, shift: Shift, worker_ids) -> None:
    """Phase 36: a shift lead fills spots from the team only, and never with themselves."""
    ids = list(dict.fromkeys(worker_ids or []))
    if user.id in ids:
        raise HTTPException(status_code=403, detail="You can't put yourself on a shift here. Request it from Find shifts.")
    on_team = await team_ids(db, shift.venue_id, ids)
    if any(w not in on_team for w in ids):
        raise HTTPException(status_code=403, detail="Shift leads can only pick people on the team. Ask a manager to add them first.")


@router.get("/api/shifts/{shift_id}/candidates", response_model=List[AssignCandidate])
async def get_candidates(
    shift_id: UUID,
    q: Optional[str] = Query(None, max_length=100),
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    shift, access = await _floor_shift(db, shift_id, current_user)
    people = await staffing.list_candidates(db, shift, q=q)
    if access == LEAD:
        people = [p for p in people if p.on_team and p.worker_id != current_user.id]
    return people


@router.post("/api/shifts/{shift_id}/assign", response_model=AssignResult)
async def assign(
    shift_id: UUID,
    body: AssignRequest,
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    shift, access = await _floor_shift(db, shift_id, current_user)
    if access == LEAD:
        await _lead_may_pick(db, current_user, shift, [body.worker_id])
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id, reason=body.reason)
    await notify_events.assigned(request_id)          # after commit; never raises
```

**Edit 4.** Find:
```python
    shift_id: UUID,
    body: OfferCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await _managed_shift(db, shift_id, current_user)
    result, offer_ids = await staffing.create_offers(db, current_user, shift_id, body.worker_ids, body.message)
    if offer_ids:
```
Replace with:
```python
    shift_id: UUID,
    body: OfferCreate,
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    shift, access = await _floor_shift(db, shift_id, current_user)
    if access == LEAD:
        await _lead_may_pick(db, current_user, shift, body.worker_ids)
    result, offer_ids = await staffing.create_offers(db, current_user, shift_id, body.worker_ids, body.message)
    if offer_ids:
```

**Edit 5.** Find:
```python
async def withdraw_offer(
    offer_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    o = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    if o is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    await verify_venue_manager_access(o.venue_id, current_user, db)
    await staffing.cancel_offer(db, o)
    return None
```
Replace with:
```python
async def withdraw_offer(
    offer_id: UUID,
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    o = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    if o is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    await floor_access(db, current_user, o.venue_id)
    await staffing.cancel_offer(db, o)
    return None
```

---

## C8. `backend/src/routers/shifts.py` (3 EDITS)
Shift leads on the shift chat, and the `notify` option.

**Edit 1.** Find:
```python
from src.services import notify_events
from src.services import activity

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```
Replace with:
```python
from src.services import notify_events
from src.services import activity
from src.services.access import is_shift_lead                      # Phase 36

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```

**Edit 2.** Find:
```python
        )

    # Worker access: Must hold an assigned / confirmed request
    req = await db.scalar(
```
Replace with:
```python
        )

    # Phase 36: the venue's shift leads see and post on every shift's chat
    if await is_shift_lead(db, user, shift.venue_id):
        return

    # Worker access: Must hold an assigned / confirmed request
    req = await db.scalar(
```

**Edit 3.** Find:
```python
    await db.refresh(msg)

    res = await db.execute(
        select(ShiftBoardMessage)
```
Replace with:
```python
    await db.refresh(msg)

    # Phase 36: "Send to everyone booked": managers, admins and shift leads only (ignored for anyone else)
    if msg_in.notify and (
        normalize_role(current_user.role) in ("platform_admin", "super_admin", "venue_manager")
        or await is_shift_lead(db, current_user, shift.venue_id)
    ):
        await notify_events.shift_message(msg.id)        # after commit; never raises

    res = await db.execute(
        select(ShiftBoardMessage)
```

---

## C9. `backend/src/routers/team.py` (7 EDITS)
`is_lead` on the team, the Owner flag on the manager list, and the guard on removing an owner.

**Edit 1.** Find:
```python
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftRequest, ShiftOffer, Rating,
    VenueInvite, ShiftEvent, TimeEntry,
)
from src.schemas import (
```
Replace with:
```python
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftRequest, ShiftOffer, Rating,
    VenueInvite, ShiftEvent, TimeEntry,
    Organization,                                               # Phase 36
)
from src.schemas import (
```

**Edit 2.** Find:
```python
from src.services.invites import valid_email, invite_status
from src.services import activity, notify_events

logger = logging.getLogger("shiftboard.team")
```
Replace with:
```python
from src.services.invites import valid_email, invite_status
from src.services import activity, notify_events
from src.services.organizations import owner_org_of_venue      # Phase 36

logger = logging.getLogger("shiftboard.team")
```

**Edit 3.** Find:
```python
            effective_time_tracking=resolve(venue_mode, row),
            works_through=row.works_through if row is not None else None,
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
```
Replace with:
```python
            effective_time_tracking=resolve(venue_mode, row),
            works_through=row.works_through if row is not None else None,
            is_lead=bool(row is not None and row.is_lead and (row.status or "active") == "active"),   # Phase 36
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
```

**Edit 4.** Find:
```python
            from src.services.time_tracking import clean_company
            row.works_through = clean_company(data["works_through"])

        if new_status == "blocked":
```
Replace with:
```python
            from src.services.time_tracking import clean_company
            row.works_through = clean_company(data["works_through"])
        # Phase 36: shift lead (active team members only; removing or blocking someone ends it)
        was_lead = bool(row.is_lead)
        if (row.status or "active") != "active":
            if data.get("is_lead"):
                raise HTTPException(status_code=400, detail="Only people on the team can be shift leads. Put them back on the team first.")
            row.is_lead = False
        elif data.get("is_lead") is not None:
            row.is_lead = bool(data["is_lead"])
        lead_changed = bool(row.is_lead) != was_lead
        now_lead = bool(row.is_lead)

        if new_status == "blocked":
```

**Edit 5.** Find:
```python
        await activity.for_worker("team_tracking", venue_id, worker_id, current_user.id,
                                  "{name}: " + ", ".join(bits).replace("{", "{{").replace("}", "}}"))
    if new_status is not None:
        await activity.for_worker(
```
Replace with:
```python
        await activity.for_worker("team_tracking", venue_id, worker_id, current_user.id,
                                  "{name}: " + ", ".join(bits).replace("{", "{{").replace("}", "}}"))
    if lead_changed:                                                                # Phase 36
        await activity.for_worker(
            "team_lead", venue_id, worker_id, current_user.id,
            "Made {name} a shift lead" if now_lead else "{name} is no longer a shift lead",
        )
        if now_lead:
            await notify_events.made_shift_lead(venue_id, worker_id)
        if new_status is None and "is_lead" in data:
            message = ("They're a shift lead now. They'll find Lead in their menu." if now_lead
                       else "They're no longer a shift lead.")
    if new_status is not None:
        await activity.for_worker(
```

**Edit 6.** Find:
```python
        .order_by(VenueManager.is_primary.desc(), User.first_name.asc())
    )).all()
    return [
        VenueManagerItem(
            user_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email,
            phone=u.phone, is_primary=bool(vm.is_primary), is_you=u.id == me.id,
        )
        for vm, u in rows
```
Replace with:
```python
        .order_by(VenueManager.is_primary.desc(), User.first_name.asc())
    )).all()
    # Phase 36: owners of the venue's organization are listed as "Owner" and can't be removed here
    org_name = await db.scalar(
        select(Organization.name).join(Venue, Venue.organization_id == Organization.id).where(Venue.id == venue_id)
    )
    return [
        VenueManagerItem(
            user_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email,
            phone=u.phone, is_primary=bool(vm.is_primary), is_you=u.id == me.id,
            via_org=bool(vm.via_org), organization_name=org_name if vm.via_org else None,
        )
        for vm, u in rows
```

**Edit 7.** Find:
```python
    if row is None:
        raise HTTPException(status_code=404, detail="They don't manage this venue.")
    if count <= 1:
        raise HTTPException(status_code=400, detail="A venue needs at least one manager.")
```
Replace with:
```python
    if row is None:
        raise HTTPException(status_code=404, detail="They don't manage this venue.")
    owned = await owner_org_of_venue(db, user_id, venue_id)                          # Phase 36
    if owned is not None:
        raise HTTPException(
            status_code=400,
            detail=f"They own {owned.name}, so they manage every venue in it. An owner or a platform admin can remove them as an owner on the Organization page.",
        )
    if count <= 1:
        raise HTTPException(status_code=400, detail="A venue needs at least one manager.")
```

---

## C10. `backend/src/routers/admin.py` (5 EDITS)
An admin editing a user leaves organization rows alone, and a role change settles ownership.

**Edit 1.** Find:
```python
from src.database import get_db
from src.models import Venue, Shift, User, ShiftRequest, UserRole, VenueManager, VenueWhitelist, TimeEntry
from src.schemas import VenueResponse, UserResponse, UserCreateAdmin, UserUpdateAdmin, AdminPasswordReset, AdminPasswordResetResponse
from src.auth import require_admin, get_password_hash, normalize_role
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email
from src.services import admin_audit

router = APIRouter(prefix="/api/admin", tags=["Admin"])
```
Replace with:
```python
from src.database import get_db
from src.models import Venue, Shift, User, ShiftRequest, UserRole, VenueManager, VenueWhitelist, TimeEntry
from src.models import OrganizationMember                                       # Phase 36
from src.schemas import VenueResponse, UserResponse, UserCreateAdmin, UserUpdateAdmin, AdminPasswordReset, AdminPasswordResetResponse
from src.auth import require_admin, get_password_hash, normalize_role
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email
from src.services import admin_audit
from src.services.organizations import drop_memberships_unless_manager, sync_managers   # Phase 36

router = APIRouter(prefix="/api/admin", tags=["Admin"])
```

**Edit 2.** Find:
```python
                if missing:
                    raise HTTPException(status_code=400, detail=f"Unknown venue id(s): {', '.join(missing)}")
            if new_role == "venue_manager" and not target_ids:
                raise HTTPException(
                    status_code=400,
```
Replace with:
```python
                if missing:
                    raise HTTPException(status_code=400, detail=f"Unknown venue id(s): {', '.join(missing)}")
            owns_org = bool(await db.scalar(                                 # Phase 36: an owner's venues come from the organization
                select(func.count(OrganizationMember.user_id)).where(OrganizationMember.user_id == user.id)
            ))
            if new_role == "venue_manager" and not target_ids and not (owns_org and old_role == "venue_manager"):
                raise HTTPException(
                    status_code=400,
```

**Edit 3.** Find:
```python
                user.email = new_email

        if rebuild_venues:
            await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
            # Phase 29: keep team notes / positions / blocks. Only ACTIVE team rows for venues that were
            # unticked are deleted (as before); removed/blocked rows are kept; ticked venues are (re)activated.
```
Replace with:
```python
                user.email = new_email

        if rebuild_venues:
            # Phase 36: rows an organization gave them (via_org) are not part of "venue assignments".
            # They are left alone here and settled by sync_managers() below.
            org_venue_ids = set((await db.execute(
                select(VenueManager.venue_id).where(VenueManager.user_id == user.id, VenueManager.via_org == True)
            )).scalars().all())
            await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id, VenueManager.via_org == False))
            # Phase 29: keep team notes / positions / blocks. Only ACTIVE team rows for venues that were
            # unticked are deleted (as before); removed/blocked rows are kept; ticked venues are (re)activated.
```

**Edit 4.** Find:
```python
            for idx, vid in enumerate(target_ids):
                if new_role == "venue_manager":
                    db.add(VenueManager(venue_id=vid, user_id=user.id, is_primary=(idx == 0)))
                elif new_role == "worker":
```
Replace with:
```python
            for idx, vid in enumerate(target_ids):
                if new_role == "venue_manager":
                    if vid in org_venue_ids:
                        continue                                    # already theirs through the organization
                    db.add(VenueManager(venue_id=vid, user_id=user.id, is_primary=(idx == 0)))
                elif new_role == "worker":
```

**Edit 5.** Find:
```python
                    else:
                        db.add(VenueWhitelist(venue_id=vid, worker_id=user.id, is_active=True, status="active", source="admin"))

        await db.commit()
```
Replace with:
```python
                    else:
                        db.add(VenueWhitelist(venue_id=vid, worker_id=user.id, is_active=True, status="active", source="admin"))

        if role_changed:                                            # Phase 36: owners are manager accounts
            await db.flush()
            await drop_memberships_unless_manager(db, user)
            await sync_managers(db)
            if new_role != "worker":                                # a shift lead is a worker
                for r in (await db.execute(
                    select(VenueWhitelist).where(VenueWhitelist.worker_id == user.id, VenueWhitelist.is_lead == True)
                )).scalars().all():
                    r.is_lead = False

        await db.commit()
```

---

## C11. `backend/src/services/always_admin.py` (2 EDITS)

**Edit 1.** Find:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import User, VenueManager, VenueWhitelist

logger = logging.getLogger("shiftboard.always_admin")
```
Replace with:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import User, VenueManager, VenueWhitelist, OrganizationMember

logger = logging.getLogger("shiftboard.always_admin")
```

**Edit 2.** Find:
```python
    if (user.role or "").lower() != "platform_admin":
        await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
        await db.execute(delete(VenueWhitelist).where(VenueWhitelist.worker_id == user.id))
        user.role = "platform_admin"
```
Replace with:
```python
    if (user.role or "").lower() != "platform_admin":
        await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
        await db.execute(delete(OrganizationMember).where(OrganizationMember.user_id == user.id))   # Phase 36: admins manage everything already
        await db.execute(delete(VenueWhitelist).where(VenueWhitelist.worker_id == user.id))
        user.role = "platform_admin"
```

---

## C12. `backend/src/services/notify.py` (1 EDIT)
One new notification kind.

**Edit 1.** Find:
```python
    "waitlist_offer": ("booking", True),     # Phase 34: a spot opened and you're next (short time to take it)
    "waitlist_update": ("booking", False),   # Phase 34: booked / request sent / offer ran out / waitlist closed
    "test": ("test", True),
}
```
Replace with:
```python
    "waitlist_offer": ("booking", True),     # Phase 34: a spot opened and you're next (short time to take it)
    "waitlist_update": ("booking", False),   # Phase 34: booked / request sent / offer ran out / waitlist closed
    "shift_message": ("booking", True),      # Phase 36: a manager or shift lead sent an update to everyone booked on the shift
    "test": ("test", True),
}
```

---

## C13. `backend/src/services/notify_events.py` (3 EDITS)
Who gets manager alerts (owners), and two new hooks at the end of the file.

**Edit 1.** Find:
```python
from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation, ShiftOffer,
)
from src.services.notify import notify_in, deliver_soon
```
Replace with:
```python
from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation, ShiftOffer,
    OrganizationMember,                                         # Phase 36
)
from src.services.notify import notify_in, deliver_soon
```

**Edit 2.** Find:
```python
    return _as_utc(start) - datetime.now(timezone.utc) <= URGENT_WINDOW


async def manager_ids(db: AsyncSession, venue_id) -> List:
    return list((await db.execute(
        select(VenueManager.user_id).where(VenueManager.venue_id == venue_id)
    )).scalars().all())


async def _shift_bundle(db: AsyncSession, shift_id):
```
Replace with:
```python
    return _as_utc(start) - datetime.now(timezone.utc) <= URGENT_WINDOW


async def manager_ids(db: AsyncSession, venue_id) -> List:
    """
    Who gets this venue's manager alerts.
    Phase 36: an organization owner's row (via_org) counts only when that owner turned on
    "venue alerts" for the organization. If nobody else manages the venue, its owners get the
    alerts anyway, so an alert is never sent to no one.
    """
    rows = (await db.execute(
        select(VenueManager.user_id, VenueManager.via_org).where(VenueManager.venue_id == venue_id)
    )).all()
    direct = [uid for uid, via in rows if not via]
    owners = [uid for uid, via in rows if via]
    if not owners:
        return direct
    if not direct:
        return owners
    wants = set((await db.execute(
        select(OrganizationMember.user_id)
        .join(Venue, Venue.organization_id == OrganizationMember.organization_id)
        .where(Venue.id == venue_id, OrganizationMember.user_id.in_(owners), OrganizationMember.venue_alerts == True)
    )).scalars().all())
    return direct + [uid for uid in owners if uid in wants]


async def _shift_bundle(db: AsyncSession, shift_id):
```

**Edit 3.** Find:
```python
async def cert_reviewed(cert_id) -> None:
    await _run("cert_reviewed", _cert_reviewed, cert_id)
```
Replace with:
```python
async def cert_reviewed(cert_id) -> None:
    await _run("cert_reviewed", _cert_reviewed, cert_id)


# ---------------------------------------------------------------------------------------------
# Phase 36: "Send to everyone booked" on the shift chat (managers and shift leads)
# ---------------------------------------------------------------------------------------------
async def _shift_message(db: AsyncSession, message_id) -> None:
    from src.models import ShiftBoardMessage
    msg = await db.scalar(select(ShiftBoardMessage).where(ShiftBoardMessage.id == message_id))
    if msg is None:
        return
    shift, venue, event, _ = await _shift_bundle(db, msg.shift_id)
    if shift is None:
        return
    author = await db.scalar(select(User).where(User.id == msg.author_id))
    booked = (await db.execute(
        select(ShiftRequest.id, ShiftRequest.worker_id).where(
            ShiftRequest.shift_id == shift.id,
            func.lower(ShiftRequest.status).in_(("approved", "confirmed", "checked_in")),
            ShiftRequest.worker_id != msg.author_id,
        )
    )).all()
    text = (msg.content or "").strip()
    if len(text) > 500:
        text = text[:497] + "..."
    title = f"{person(author)}: {shift.role_type} · {event.title if event else shift.title}"
    for request_id, worker_id in booked:
        await notify_in(
            db, [worker_id], "shift_message", title,
            f"{when_text(shift.start_time, venue)}\n{text}",
            worker_shift_link(request_id), venue_id=shift.venue_id, event_id=shift.event_id, request_id=request_id,
            urgent=is_soon(shift.start_time), dedupe_key=f"shiftmsg:{msg.id}",
        )


async def shift_message(message_id) -> None:
    await _run("shift_message", _shift_message, message_id)


async def _made_shift_lead(db: AsyncSession, venue_id, worker_id) -> None:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        return
    await notify_in(
        db, [worker_id], "team_added", f"You're a shift lead at {venue.name}",
        "You can see who's on today, clock people in and out, mark no-shows, fix clock times, "
        "post updates and fill open spots from the team. Open Lead in your menu.",
        "/lead", venue_id=venue_id,
    )


async def made_shift_lead(venue_id, worker_id) -> None:
    await _run("made_shift_lead", _made_shift_lead, venue_id, worker_id)
```

---

# PART D: Frontend, new files

## D1. NEW FILE `frontend/src/utils/publicConfig.js`
The first line is `import api from '../api/client';` and the **last line is `}`**.

```js
import api from '../api/client';

/**
 * Phase 36: settings the web app needs before anyone signs in (GET /api/public/config, no token needed).
 *   public_board       true = the home page is the public board of posted shifts
 *   self_registration  true = people can create their own worker account
 * Asked once per page load and remembered. If the server can't be reached, the board is treated as off,
 * so the home page falls back to the sign-in page.
 */
const OFF = { public_board: false, self_registration: false };
let pending = null;

export function getPublicConfig() {
  if (!pending) {
    pending = api
      .get('/public/config')
      .then((res) => ({ ...OFF, ...(res.data || {}) }))
      .catch(() => {
        pending = null;          // try again next time
        return OFF;
      });
  }
  return pending;
}

/** The event someone tapped on the public board; the worker dashboard opens it after they sign in. */
const KEY = 'shiftboard_public_event';

export function rememberPublicEvent(eventId) {
  try {
    if (eventId) sessionStorage.setItem(KEY, String(eventId));
  } catch (e) { /* private mode: they just land on the dashboard */ }
}

export function takePublicEvent() {
  try {
    const id = sessionStorage.getItem(KEY);
    if (id) sessionStorage.removeItem(KEY);
    return id || null;
  } catch (e) {
    return null;
  }
}
```

---

## D2. NEW FILE `frontend/src/pages/PublicBoardPage.jsx`
The public board (the home page when the setting is on). The first line is `import React, { useCallback, useEffect, useMemo, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Search, MapPin, Clock, Users, LogIn, UserPlus, Lock, RefreshCw, X } from 'lucide-react';
import api from '../api/client';
import ModalShell from '../components/ModalShell';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import { rememberPublicEvent } from '../utils/publicConfig';

const REFRESH_MS = 60000;

/**
 * Phase 36: the public event board. It is the home page (/) for people who aren't signed in when
 * PUBLIC_EVENT_BOARD is on (App.jsx decides). It needs no sign-in and shows only what
 * GET /api/public/board returns: event name, date and time, venue name, city, positions and open spots.
 * Pay, the address and the details need a worker account, so every card leads to sign-up.
 * Props: config ({ public_board, self_registration })
 */
export default function PublicBoardPage({ config }) {
  const navigate = useNavigate();
  const canRegister = !!config?.self_registration;
  const [events, setEvents] = useState(null);       // null = first load
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [picked, setPicked] = useState(null);       // the event someone tapped

  const load = useCallback(async () => {
    try {
      const res = await api.get('/public/board');
      setEvents(res.data?.events || []);
      setError('');
    } catch (err) {
      setError('Shifts couldn’t be loaded. Check your connection and try again.');
      setEvents((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const cities = useMemo(
    () => [...new Set((events || []).map((e) => e.city).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (events || []).filter((e) => {
      if (openOnly && e.full) return false;
      if (city && e.city !== city) return false;
      if (!needle) return true;
      const text = [e.title, e.venue_name, e.city, ...e.positions.map((p) => p.name)].filter(Boolean).join(' ').toLowerCase();
      return text.includes(needle);
    });
  }, [events, q, city, openOnly]);

  // one section per day, in each event's own time zone
  const days = useMemo(() => {
    const out = [];
    shown.forEach((e) => {
      const label = fmtLongDate(e.start_time, e.timezone);
      const last = out[out.length - 1];
      if (last && last.label === label) last.events.push(e);
      else out.push({ label, events: [e] });
    });
    return out;
  }, [shown]);

  const goSignIn = (mode) => {
    if (picked) rememberPublicEvent(picked.event_id);
    navigate('/login', mode === 'register' ? { state: { mode: 'register' } } : undefined);
  };

  const totalOpen = shown.reduce((n, e) => n + (e.open_spots || 0), 0);
  const filtered = !!(q.trim() || city || openOnly);
  const field = 'bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
              <Calendar className="w-5 h-5 text-slate-950" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white truncate">
              Shift<span className="text-emerald-400">Board</span>
            </span>
          </div>
          <button type="button" onClick={() => { setPicked(null); navigate('/login'); }}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
            <LogIn className="w-4 h-4" />
            {canRegister ? (
              <>
                <span className="sm:hidden">Sign in / up</span>
                <span className="hidden sm:inline">Sign in / Sign up</span>
              </>
            ) : 'Sign in'}
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Open shifts</h1>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            Shifts posted by venues on ShiftBoard.{' '}
            {canRegister
              ? 'Create a free worker account to see the pay and the full details, and to book.'
              : 'Sign in to see the pay and the full details, and to book.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search shifts</span>
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by event, venue, city or position"
              className={`${field} w-full pl-9 pr-3 py-2.5`} />
          </label>
          {cities.length > 1 && (
            <label>
              <span className="sr-only">City</span>
              <select value={city} onChange={(e) => setCity(e.target.value)} className={`${field} w-full sm:w-auto px-3 py-2.5`}>
                <option value="">All cities</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-sm text-slate-300 cursor-pointer select-none">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-emerald-500" />
            Open spots only
          </label>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-sm text-rose-200 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs font-bold underline"><RefreshCw className="w-3.5 h-3.5" /> Try again</button>
          </div>
        )}

        {events === null && !error && (
          <p className="py-16 text-center text-sm text-slate-500">Loading open shifts…</p>
        )}

        {events !== null && shown.length === 0 && !error && (
          <div className="py-16 text-center border border-dashed border-slate-800 rounded-2xl">
            <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">
              {filtered ? 'No shifts match that.' : 'No shifts are posted right now.'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {filtered ? 'Try a different search.' : 'Check back soon. New shifts are posted all the time.'}
            </p>
            {filtered && (
              <button type="button" onClick={() => { setQ(''); setCity(''); setOpenOnly(false); }}
                className="mt-3 text-xs font-bold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Clear the search
              </button>
            )}
          </div>
        )}

        {shown.length > 0 && (
          <p className="text-xs text-slate-500">
            {shown.length} event{shown.length === 1 ? '' : 's'} · {totalOpen} open spot{totalOpen === 1 ? '' : 's'}
          </p>
        )}

        {days.map((day) => (
          <section key={day.label} aria-label={day.label} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400 sticky top-16 bg-slate-950/95 backdrop-blur py-2 z-10">{day.label}</h2>
            <ul className="space-y-2">
              {day.events.map((e) => (
                <li key={e.event_id}>
                  <button type="button" onClick={() => setPicked(e)}
                    className={`w-full text-left p-4 rounded-2xl border bg-slate-900 hover:border-emerald-500/50 focus:outline-none focus:border-emerald-500 transition flex flex-col sm:flex-row sm:items-center gap-3 ${
                      e.full ? 'border-slate-800 opacity-75' : 'border-slate-700'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {fmtTimeRange(e.start_time, e.end_time, e.timezone)}
                      </p>
                      <h3 className="text-base font-bold text-white truncate mt-0.5">{e.title}</h3>
                      <p className="text-sm text-slate-400 flex flex-wrap items-center gap-x-1.5">
                        <span className="font-medium text-slate-300">{e.venue_name}</span>
                        {e.city && (
                          <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><MapPin className="w-3.5 h-3.5" />{e.city}</span>
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {e.positions.map((p) => (
                          <span key={p.name}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                              p.open_spots > 0 ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                            {p.name} · {p.open_spots > 0 ? `${p.open_spots} open` : 'full'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 flex-shrink-0">
                      <span className={`text-sm font-bold inline-flex items-center gap-1 ${e.full ? 'text-slate-500' : 'text-amber-300'}`}>
                        <Users className="w-4 h-4" /> {e.full ? 'Full' : `${e.open_spots} open spot${e.open_spots === 1 ? '' : 's'}`}
                      </span>
                      <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" /> {e.full ? 'Sign in to join the waitlist' : 'Sign in to see pay & book'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-500 px-4">
        Run a venue? <button type="button" onClick={() => navigate('/login')} className="font-semibold text-slate-300 hover:text-white underline">Sign in</button> to post and manage your shifts.
      </footer>

      {picked && (
        <ModalShell
          title={picked.title}
          subtitle={`${picked.venue_name}${picked.city ? ` · ${picked.city}` : ''} · ${fmtLongDate(picked.start_time, picked.timezone)}, ${fmtTimeRange(picked.start_time, picked.end_time, picked.timezone)}`}
          icon={<Lock className="w-5 h-5 text-emerald-400" />}
          onClose={() => setPicked(null)}
          maxWidth="max-w-md"
          footer={(
            <>
              <button type="button" onClick={() => goSignIn('signin')}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-200 inline-flex items-center gap-1.5">
                <LogIn className="w-4 h-4" /> {canRegister ? 'I have an account' : 'Sign in'}
              </button>
              {canRegister && (
                <button type="button" onClick={() => goSignIn('register')}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-sm font-bold text-slate-950 inline-flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" /> Create a free account
                </button>
              )}
            </>
          )}
        >
          <p className="text-sm text-slate-300">
            {canRegister ? 'Create a free worker account' : 'Sign in'} to see this shift’s <strong className="text-white">pay</strong>,{' '}
            <strong className="text-white">address</strong> and <strong className="text-white">full details</strong>,
            and to {picked.full ? 'join its waitlist' : 'book it'}.
          </p>
          <ul className="mt-3 space-y-1">
            {picked.positions.map((p) => (
              <li key={p.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-200">{p.name}</span>
                <span className={p.open_spots > 0 ? 'text-emerald-300 font-semibold' : 'text-slate-500'}>
                  {p.open_spots > 0 ? `${p.open_spots} open` : 'full'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">We’ll bring you straight back to this shift after you sign in.</p>
        </ModalShell>
      )}
    </div>
  );
}
```

---

## D3. NEW FILE `frontend/src/components/lead/LeadBanner.jsx`
Create the `components/lead/` folder. The first line is `import React, { useEffect, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ChevronRight } from 'lucide-react';
import api from '../../api/client';

/**
 * Phase 36: on the worker page, a slim banner for people who are a shift lead somewhere.
 * It is the way into the Lead view on a phone (the bottom tab bar has no room for it).
 * Shows nothing for everyone else.
 */
export default function LeadBanner() {
  const [venues, setVenues] = useState([]);

  useEffect(() => {
    let active = true;
    api
      .get('/lead/venues')
      .then((res) => {
        if (active) setVenues(res.data || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (venues.length === 0) return null;
  const names = venues.map((v) => v.name);
  const where = names.length > 2 ? `${names.length} venues` : names.join(' and ');

  return (
    <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
      <ClipboardCheck className="w-5 h-5 text-amber-300 flex-shrink-0" />
      <p className="flex-1 min-w-0 text-xs text-amber-100">
        <b className="text-amber-200">You’re a shift lead at {where}.</b> See who’s on today, clock people in and out, and fill open spots.
      </p>
      <Link to="/lead" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-0.5 whitespace-nowrap">
        Open Lead <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
```

---

## D4. NEW FILE `frontend/src/components/lead/LeadTimesModal.jsx`
The first line is `import React, { useCallback, useEffect, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Check, X, Clock, UserX } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { fmtDate, fmtTimeRange, fmtTime, fmtShortDate, utcToZonedLocalInput, zonedLocalToUtcIso } from '../../utils/venueTime';
import { GEO_LABELS, metersText } from '../../utils/listingFormat';

const STATUS = {
  approved: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
};
const inputCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white';

function flagsOf(e) {
  const out = [];
  if (e.clock_in_geo_status === 'manager') out.push('entered by hand');
  if (e.clock_in_geo_status === 'outside_geofence') {
    out.push(`${GEO_LABELS.outside_geofence || 'away from site'}${e.clock_in_distance_m != null ? ` · ${metersText(e.clock_in_distance_m)}` : ''}`);
  }
  if (e.auto_closed) out.push('auto-closed, check the hours');
  if (e.late_minutes > 0) out.push(`late ${e.late_minutes} min`);
  if (e.edited) out.push('edited');
  return out;
}

/**
 * Phase 36: the shift lead's "Clock times" for one event: who was in and out, and hours.
 * Reads GET /api/lead/events/{eventId}/times, which has NO pay in it. Don't add pay, tips or
 * pay-rate controls here; those live in the manager's TimesheetModal.
 * A lead can add, fix or delete a time (a reason is required and saved), and mark a no-show.
 * They can't change their own row.
 * Props: eventId, timeZone, onClose, onChanged()
 */
export default function LeadTimesModal({ eventId, timeZone, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // form = { kind: 'add' | 'edit' | 'delete' | 'noshow', requestId, entryId, cin, cout, reason }
  const [form, setForm] = useState(null);
  const tz = data?.timezone || timeZone;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/lead/events/${eventId}/times`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load the clock times.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setForm(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.detail || 'That change did not save.');
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    const f = form;
    if (!f) return null;
    if (f.kind === 'add' || f.kind === 'edit') {
      if (!f.cin) return setError('Clock-in time is required.');
      if (!f.reason.trim()) return setError('Add a short reason for the change.');
      const payload = {
        clock_in_time: zonedLocalToUtcIso(f.cin, tz),
        clock_out_time: f.cout ? zonedLocalToUtcIso(f.cout, tz) : null,
        reason: f.reason.trim(),
      };
      return run(() => (f.kind === 'add'
        ? api.post(`/requests/${f.requestId}/time-entries`, payload)
        : api.patch(`/time-entries/${f.entryId}`, payload)));
    }
    if (f.kind === 'delete') {
      if (!f.reason.trim()) return setError('Add a short reason.');
      return run(() => api.post(`/time-entries/${f.entryId}/delete`, { reason: f.reason.trim() }));
    }
    if (f.kind === 'noshow') {
      return run(() => api.post(`/requests/${f.requestId}/no-show`, { reason: f.reason.trim() || null }));
    }
    return null;
  };

  const formRow = () => {
    const f = form;
    return (
      <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-700 space-y-2">
        {(f.kind === 'add' || f.kind === 'edit') && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-400">In
              <input type="datetime-local" value={f.cin} onChange={(e) => setForm({ ...f, cin: e.target.value })} className={`${inputCls} block mt-0.5`} />
            </label>
            <label className="text-[11px] text-slate-400">Out (blank = still working)
              <input type="datetime-local" value={f.cout} onChange={(e) => setForm({ ...f, cout: e.target.value })} className={`${inputCls} block mt-0.5`} />
            </label>
          </div>
        )}
        {f.kind === 'delete' && <p className="text-xs text-rose-300">Delete this time entry?</p>}
        {f.kind === 'noshow' && <p className="text-xs text-rose-300">Mark as a no-show? This counts against their reliability, they’re told, and their spot opens again.</p>}
        <input
          value={f.reason}
          onChange={(e) => setForm({ ...f, reason: e.target.value })}
          placeholder={f.kind === 'noshow' ? 'Note (optional, they’ll see it)' : 'Reason for the change (required)'}
          aria-label={f.kind === 'noshow' ? 'Note' : 'Reason for the change'}
          className={`${inputCls} w-full`}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setForm(null); setError(''); }} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 inline-flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
          <button type="button" onClick={submitForm} disabled={busy}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50 ${f.kind === 'delete' || f.kind === 'noshow' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>
            <Check className="w-3 h-3" /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <ModalShell
      title={data ? `Clock times: ${data.title}` : 'Clock times'}
      subtitle={data ? `${fmtDate(data.start_time, tz)} • ${fmtTimeRange(data.start_time, data.end_time, tz)}` : null}
      icon={<ClipboardList className="w-5 h-5 text-amber-300" />}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={data ? (
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-300">Total <strong className="text-white">{data.total_hours.toFixed(2)} h</strong></span>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Done</button>
        </div>
      ) : null}
    >
      {error && <div role="alert" className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {loading && !data ? (
        <p className="text-sm text-slate-500 text-center py-10">Loading…</p>
      ) : data && data.people.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-10">No one is booked on this event yet.</p>
      ) : data ? (
        <div className="space-y-3">
          {data.people.map((p) => {
            const st = STATUS[p.status] || { label: p.status, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
            const payroll = p.time_tracking === 'payroll';
            const canNoShow = !p.is_you && data.started && ['approved', 'confirmed'].includes(p.status) && p.entries.length === 0;
            const formHere = form && form.requestId === p.request_id;
            return (
              <div key={p.request_id} className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{p.name}{p.is_you ? ' (you)' : ''}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p.role_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                    {payroll && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-violet-500/10 text-violet-300 border-violet-500/30">Venue payroll</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-300 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {p.total_hours.toFixed(2)} h</span>
                </div>
                {p.status === 'no_show' && p.status_reason && <p className="mt-1 text-[11px] text-rose-300">Note: {p.status_reason}</p>}
                {payroll && <p className="mt-1 text-[11px] text-slate-500">Clocks in with the venue’s own system, so there are usually no times here.</p>}

                <ul className="mt-2 space-y-1">
                  {p.entries.map((e) => {
                    const flags = flagsOf(e);
                    return (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <span>
                          {fmtShortDate(e.clock_in_time, tz)} · {fmtTime(e.clock_in_time, tz)} – {e.clock_out_time ? fmtTime(e.clock_out_time, tz) : <em className="text-sky-300 not-italic">still clocked in</em>}
                          <span className="text-slate-500"> · {e.hours.toFixed(2)} h</span>
                          {flags.length > 0 && <span className="text-amber-300/80"> · {flags.join(' · ')}</span>}
                        </span>
                        {!p.is_you && (
                          <span className="inline-flex items-center gap-1">
                            <button type="button" aria-label={`Fix this time for ${p.name}`}
                              onClick={() => { setError(''); setForm({ kind: 'edit', requestId: p.request_id, entryId: e.id, cin: utcToZonedLocalInput(e.clock_in_time, tz), cout: e.clock_out_time ? utcToZonedLocalInput(e.clock_out_time, tz) : '', reason: '' }); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"><Pencil className="w-3.5 h-3.5" /></button>
                            <button type="button" aria-label={`Delete this time for ${p.name}`}
                              onClick={() => { setError(''); setForm({ kind: 'delete', requestId: p.request_id, entryId: e.id, cin: '', cout: '', reason: '' }); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800"><Trash2 className="w-3.5 h-3.5" /></button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {p.entries.length === 0 && !payroll && <li className="text-[11px] text-slate-500">No clock-in yet.</li>}
                </ul>

                {p.is_you ? (
                  <p className="mt-2 text-[11px] text-slate-500">You can’t change your own times. Clock in and out from My shifts, or ask a manager.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button"
                      onClick={() => { setError(''); setForm({ kind: 'add', requestId: p.request_id, entryId: null, cin: utcToZonedLocalInput(data.start_time, tz), cout: '', reason: '' }); }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add a time
                    </button>
                    {canNoShow && (
                      <button type="button"
                        onClick={() => { setError(''); setForm({ kind: 'noshow', requestId: p.request_id, entryId: null, cin: '', cout: '', reason: '' }); }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/40 text-[11px] font-semibold text-rose-200 inline-flex items-center gap-1">
                        <UserX className="w-3 h-3" /> No-show
                      </button>
                    )}
                  </div>
                )}
                {formHere && formRow()}
              </div>
            );
          })}
        </div>
      ) : null}
    </ModalShell>
  );
}
```

---

## D5. NEW FILE `frontend/src/pages/LeadPage.jsx`
The first line is `import React, { useEffect, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Check, AlertCircle, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import TonightBoard from '../components/manager/TonightBoard';
import ShiftBoardModal from '../components/ShiftBoardModal';
import LeadTimesModal from '../components/lead/LeadTimesModal';

const VENUE_KEY = 'shiftboard_lead_venue_id';

/**
 * Phase 36: the shift lead's page (/lead). A shift lead is a worker a manager marked "shift lead"
 * on the venue's Team page. Here they run the floor for that venue:
 *   the Today board (who's booked, in, late), clock someone in, mark a no-show, fix clock times,
 *   message a shift (and send it to everyone booked), and fill an open spot from the team.
 * There is no pay anywhere on this page, and nothing here reads a manager endpoint that has pay in it.
 */
export default function LeadPage() {
  const { user } = useAuth();
  const [venues, setVenues] = useState(null);          // null = loading
  const [venueId, setVenueId] = useState('');
  const [boardShift, setBoardShift] = useState(null);  // { id, title, role_type }
  const [timesEventId, setTimesEventId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState(null);          // { type, message }

  useEffect(() => {
    let active = true;
    api
      .get('/lead/venues')
      .then((res) => {
        if (!active) return;
        const list = res.data || [];
        setVenues(list);
        let saved = '';
        try { saved = localStorage.getItem(VENUE_KEY) || ''; } catch (e) { /* private mode */ }
        setVenueId(list.some((v) => v.venue_id === saved) ? saved : (list[0]?.venue_id || ''));
      })
      .catch(() => active && setVenues([]));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const pickVenue = (id) => {
    setVenueId(id);
    try { localStorage.setItem(VENUE_KEY, id); } catch (e) { /* private mode */ }
  };

  const venue = (venues || []).find((v) => v.venue_id === venueId) || null;

  if (venues === null) {
    return <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-10 text-sm text-slate-500">Loading…</main>;
  }

  if (venues.length === 0) {
    return (
      <main className="max-w-xl mx-auto w-full px-4 mt-16 text-center">
        <ClipboardCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-white">You’re not a shift lead right now</h1>
        <p className="mt-2 text-sm text-slate-400">
          A venue’s manager makes someone a shift lead from their Team page. When they do, this page shows who’s on today.
        </p>
        <Link to="/worker" className="mt-5 inline-block px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">Back to my shifts</Link>
      </main>
    );
  }

  return (
    <>
      <section className="bg-slate-900/50 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-amber-300" /> Shift lead
            </h1>
            <p className="text-sm text-slate-400 truncate">
              {venue ? venue.name : ''} · {user?.first_name}, you can clock people in and out, mark no-shows, message shifts and fill open spots.
            </p>
          </div>
          {venues.length > 1 && (
            <label className="text-xs text-slate-400">
              Venue
              <select value={venueId} onChange={(e) => pickVenue(e.target.value)}
                className="block mt-0.5 bg-slate-900 border border-slate-700 text-white text-sm font-semibold rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500">
                {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6 space-y-4">
        {notice && (
          <div role="status" className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'error' ? 'bg-rose-950/80 border-rose-700 text-rose-200' : 'bg-emerald-950/80 border-emerald-700 text-emerald-200'}`}>
            <span className="inline-flex items-start gap-2">
              {notice.type === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {notice.message}
            </span>
            <button type="button" aria-label="Hide" onClick={() => setNotice(null)} className="p-0.5 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
          </div>
        )}

        {venue && (
          <TonightBoard
            key={venue.venue_id}
            venueId={venue.venue_id}
            timeZone={venue.timezone}
            refreshKey={refreshKey}
            reliabilityMap={null}
            tonightPath={`/lead/venues/${venue.venue_id}/tonight`}
            timesLabel="Clock times"
            onOpenBoard={(shift) => setBoardShift(shift)}
            onTimesheet={(eventId) => setTimesEventId(eventId)}
            onChanged={(message) => message && setNotice({ type: 'success', message })}
          />
        )}

        <p className="text-xs text-slate-500">
          Pay, tips, approving requests, the team list and posting shifts stay with the venue’s managers.
        </p>
      </main>

      {timesEventId && venue && (
        <LeadTimesModal
          eventId={timesEventId}
          timeZone={venue.timezone}
          onClose={() => setTimesEventId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {boardShift && (
        <ShiftBoardModal
          shiftId={boardShift.id}
          shiftTitle={`${boardShift.title} (${boardShift.role_type})`}
          currentUserRole={user?.role}
          canNotify
          onClose={() => setBoardShift(null)}
        />
      )}
    </>
  );
}
```

---

## D6. NEW FILE `frontend/src/components/org/OrgOwnersPanel.jsx`
Create the `components/org/` folder. The first line is `import React, { useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useState } from 'react';
import { Crown, UserPlus, Trash2, KeyRound, Check } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';

const inputCls = 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500';

/**
 * Phase 36: who owns an organization, and adding or removing owners.
 * Used on the owner's Organization page and in Admin → Organizations.
 * An owner manages every venue in the organization. Owners are manager accounts: an existing manager
 * is linked by email; an email with no account gets a new manager account and a temporary password
 * (shown once, here).
 * Props: org (OrganizationDetail), isAdmin, onChanged(orgChangeResult)
 */
export default function OrgOwnersPanel({ org, isAdmin = false, onChanged }) {
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '' });
  const [needName, setNeedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);     // { email, password }
  const [confirm, setConfirm] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    setCreated(null);
    setBusy(true);
    try {
      const res = await api.post(`/organizations/${org.id}/owners`, {
        email: form.email.trim(), first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      });
      if (res.data.created) setCreated({ email: form.email.trim().toLowerCase(), password: res.data.temporary_password });
      setForm({ email: '', first_name: '', last_name: '' });
      setNeedName(false);
      onChanged?.(res.data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Could not add the owner.';
      if (String(detail).startsWith('First name is required')) {
        setNeedName(true);
        setError('No account uses that email yet. Add their name and we’ll create a manager account for them.');
      } else {
        setError(detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const askRemove = (o) => setConfirm({
    title: `Remove ${o.first_name || o.email} as an owner?`,
    message: `They stop managing this organization’s venues, except any venue they manage directly. Their account isn’t deleted.`,
    confirmLabel: 'Remove owner',
    danger: true,
    onConfirm: async () => {
      const res = await api.delete(`/organizations/${org.id}/owners/${o.user_id}`);
      onChanged?.(res.data);
    },
  });

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-white flex items-center gap-2"><Crown className="w-4 h-4 text-amber-300" /> Owners</h3>
      <p className="text-xs text-slate-400">An owner manages every venue in {org.name}: schedules, teams, pay periods and settings.</p>

      {org.owners.length === 0 ? (
        <p className="text-sm text-slate-500">No owners yet. Add one below.</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {org.owners.map((o) => (
            <li key={o.user_id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {`${o.first_name} ${o.last_name}`.trim() || o.email}{o.is_you ? ' (you)' : ''}
                </p>
                <p className="text-xs text-slate-400 truncate">{o.email}{o.phone ? ` · ${o.phone}` : ''}</p>
              </div>
              {(isAdmin || !o.is_you) && (
                <button type="button" onClick={() => askRemove(o)}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-600/30 text-xs font-bold inline-flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {created && (
        <div role="status" className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-100">
          <p className="font-semibold flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Manager account created for {created.email}</p>
          <p className="mt-1 text-xs">Temporary password (shown only once): <code className="px-1.5 py-0.5 rounded bg-slate-950 text-white font-mono select-all">{created.password}</code></p>
        </div>
      )}

      <form onSubmit={add} className="space-y-2">
        <label className="block text-xs text-slate-400">Add an owner by email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="owner@yourcompany.com" className={`${inputCls} mt-1`} />
        </label>
        {needName && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-400">First name
              <input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs text-slate-400">Last name
              <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className={`${inputCls} mt-1`} />
            </label>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <button type="submit" disabled={busy || !form.email.trim()}
          className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />} {busy ? 'Adding…' : 'Add owner'}
        </button>
      </form>

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
```

---

## D7. NEW FILE `frontend/src/components/org/SharePersonModal.jsx`
The first line is `import React, { useMemo, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useMemo, useState } from 'react';
import { Users, Check, ArrowRightLeft, Copy } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';

/**
 * Phase 36: put one person on other venues' teams in the organization (copy), or move them
 * from one venue to others (move = also taken off the venue they came from).
 * Props: orgId, person (OrgPerson), venues (OrgVenue[]), onClose, onDone(orgShareResult)
 */
export default function SharePersonModal({ orgId, person, venues, onClose, onDone }) {
  const name = `${person.first_name} ${person.last_name}`.trim() || person.email;
  const activeAt = useMemo(() => person.venues.filter((v) => v.status === 'active'), [person]);
  const statusAt = useMemo(() => Object.fromEntries(person.venues.map((v) => [v.venue_id, v.status])), [person]);
  const [from, setFrom] = useState(activeAt[0]?.venue_id || '');
  const [mode, setMode] = useState('copy');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const targets = venues.filter((v) => statusAt[v.id] !== 'active');

  const submit = async () => {
    setError('');
    if (picked.length === 0) return setError('Pick at least one venue.');
    if (mode === 'move' && !from) return setError('Pick the venue they’re moving from.');
    setBusy(true);
    try {
      const res = await api.post(`/organizations/${orgId}/people/${person.worker_id}/share`, {
        to_venue_ids: picked, from_venue_id: from || null, mode,
      });
      onDone?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'That didn’t save.');
    } finally {
      setBusy(false);
    }
    return null;
  };

  const modeBtn = (id, label, Icon, hint) => (
    <button type="button" onClick={() => setMode(id)} aria-pressed={mode === id}
      className={`flex-1 text-left p-3 rounded-xl border transition ${mode === id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'}`}>
      <span className="text-sm font-bold text-white inline-flex items-center gap-1.5"><Icon className="w-4 h-4" /> {label}</span>
      <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>
    </button>
  );

  return (
    <ModalShell
      title={`Add ${name} to another venue`}
      icon={<Users className="w-5 h-5 text-teal-300" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || targets.length === 0}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-sm font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-50">
            <Check className="w-4 h-4" /> {busy ? 'Saving…' : mode === 'move' ? 'Move' : 'Add to team'}
          </button>
        </>
      )}
    >
      {targets.length === 0 ? (
        <p className="text-sm text-slate-400">{name} is already on the team at every venue in this organization.</p>
      ) : (
        <div className="space-y-4">
          {activeAt.length > 0 && (
            <div className="flex gap-2">
              {modeBtn('copy', 'Copy', Copy, 'On both teams.')}
              {modeBtn('move', 'Move', ArrowRightLeft, 'Taken off the team they come from. Shifts already booked there stay.')}
            </div>
          )}

          {activeAt.length > 0 && (
            <label className="block text-xs text-slate-400">
              {mode === 'move' ? 'Moving from' : 'Bring their positions and staffing company from'}
              <select value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white">
                {mode === 'copy' && <option value="">Nowhere (start blank)</option>}
                {activeAt.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.venue_name}</option>)}
              </select>
            </label>
          )}

          <fieldset>
            <legend className="text-xs text-slate-400 mb-1">Add to</legend>
            <ul className="space-y-1.5">
              {targets.map((v) => {
                const blocked = statusAt[v.id] === 'blocked';
                const same = v.id === from;
                return (
                  <li key={v.id}>
                    <label className={`flex items-center gap-2 p-2.5 rounded-xl border ${blocked || same ? 'border-slate-800 opacity-60' : 'border-slate-700 cursor-pointer hover:border-slate-600'} bg-slate-950/40`}>
                      <input type="checkbox" disabled={blocked || same} checked={picked.includes(v.id)} onChange={() => toggle(v.id)} className="accent-teal-500" />
                      <span className="text-sm text-white flex-1 min-w-0 truncate">{v.name}</span>
                      {blocked && <span className="text-[11px] text-rose-300">Blocked there. Unblock on its Team page first.</span>}
                      {!blocked && statusAt[v.id] === 'removed' && <span className="text-[11px] text-slate-400">Was removed; this puts them back</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <p className="text-[11px] text-slate-500">Positions come along where the other venue has a position with the same name.</p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        </div>
      )}
    </ModalShell>
  );
}
```

---

## D8. NEW FILE `frontend/src/pages/OrganizationPage.jsx`
The first line is `import React, { useCallback, useEffect, useMemo, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Network, LayoutDashboard, Users, Settings2, Building2, MapPin, Radio, AlarmClock, UserPlus, Inbox, ChevronRight,
  Search, RefreshCw, Pencil, Check, X, AlertCircle, ClipboardCheck, BellRing,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import OrgOwnersPanel from '../components/org/OrgOwnersPanel';
import SharePersonModal from '../components/org/SharePersonModal';
import RatingBadge from '../components/RatingBadge';
import { fmtDate, fmtTime } from '../utils/venueTime';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'people', label: 'People', icon: Users },
  { id: 'settings', label: 'Owners & settings', icon: Settings2 },
];
const STATUS_CHIP = {
  active: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30',
  removed: 'bg-slate-800 text-slate-400 border-slate-700 line-through',
  blocked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};

function Stat({ label, value, tone = 'text-white', icon: Icon }) {
  return (
    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </p>
      <p className={`text-xl font-black mt-0.5 ${tone}`}>{value}</p>
    </div>
  );
}

/**
 * Phase 36: the organization owner's page (/org). An organization is a group of venues; its owners
 * manage every venue in it.
 *   Overview            every venue side by side: today and the next seven days. "Open venue" goes to the
 *                       normal manager dashboard for that venue.
 *   People              everyone on any venue's team; add a person to another venue, or move them.
 *   Owners & settings   owners, the organization's name, and "send me each venue's manager alerts".
 * Platform admins can open any organization here; they create organizations and choose their venues
 * in Admin → Organizations (there is no venue sign-up yet).
 */
export default function OrganizationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isAdmin = String(user?.role || '').toLowerCase() === 'platform_admin';
  const [orgs, setOrgs] = useState(null);                 // null = loading
  const [overview, setOverview] = useState(null);
  const [people, setPeople] = useState(null);
  const [q, setQ] = useState('');
  const [share, setShare] = useState(null);               // OrgPerson
  const [notice, setNotice] = useState(null);             // { type, message }
  const [renaming, setRenaming] = useState(null);         // string while editing
  const [busy, setBusy] = useState(false);

  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const org = useMemo(() => {
    if (!orgs || orgs.length === 0) return null;
    return orgs.find((o) => o.id === params.get('org')) || orgs[0];
  }, [orgs, params]);
  const orgId = org?.id || null;

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const loadOrgs = useCallback(() => api
    .get('/organizations')
    .then((res) => setOrgs(res.data || []))
    .catch(() => setOrgs([])), []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const loadOverview = useCallback(() => {
    if (!orgId) return;
    api.get(`/organizations/${orgId}/overview`).then((res) => setOverview(res.data)).catch(() => setOverview(null));
  }, [orgId]);

  const loadPeople = useCallback(() => {
    if (!orgId) return;
    api.get(`/organizations/${orgId}/people`).then((res) => setPeople(res.data || [])).catch(() => setPeople([]));
  }, [orgId]);

  useEffect(() => {
    setOverview(null);
    setPeople(null);
    if (!orgId) return;
    if (tab === 'overview') loadOverview();
    if (tab === 'people') loadPeople();
  }, [orgId, tab, loadOverview, loadPeople]);

  useEffect(() => {
    if (!notice || notice.type === 'error') return undefined;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const replaceOrg = (result) => {
    if (result?.organization) setOrgs((list) => (list || []).map((o) => (o.id === result.organization.id ? result.organization : o)));
    const extra = (result?.warnings || []).join(' ');
    if (result?.message) setNotice({ type: extra ? 'error' : 'success', message: `${result.message}${extra ? ` ${extra}` : ''}` });
  };

  const saveName = async () => {
    const name = (renaming || '').trim();
    if (!name || name === org.name) return setRenaming(null);
    setBusy(true);
    try {
      const res = await api.patch(`/organizations/${org.id}`, { name });
      replaceOrg({ organization: res.data.organization, message: 'Renamed.' });
      setRenaming(null);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.detail || 'Could not rename it.' });
    } finally {
      setBusy(false);
    }
    return null;
  };

  const setAlerts = async (on) => {
    setBusy(true);
    try {
      const res = await api.patch(`/organizations/${org.id}/me`, { venue_alerts: on });
      replaceOrg(res.data);
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const openVenue = (venueId) => {
    if (isAdmin) {
      try { localStorage.setItem('shiftboard_admin_venue_id', venueId); } catch (e) { /* ignore */ }
      window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venueId }));
    }
    navigate(`/venue?venue=${venueId}`);
  };

  const shownPeople = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people || [];
    return (people || []).filter((p) => `${p.first_name} ${p.last_name} ${p.email || ''} ${p.phone || ''}`.toLowerCase().includes(needle)
      || p.venues.some((v) => v.venue_name.toLowerCase().includes(needle) || v.positions.some((x) => x.toLowerCase().includes(needle))));
  }, [people, q]);

  if (orgs === null) {
    return <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-10 text-sm text-slate-500">Loading…</main>;
  }

  if (!org) {
    return (
      <main className="max-w-xl mx-auto w-full px-4 mt-16 text-center">
        <Network className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-white">No organization yet</h1>
        <p className="mt-2 text-sm text-slate-400">
          {isAdmin
            ? 'An organization groups venues under one or more owners. Create one in Admin → Organizations.'
            : 'An organization groups several venues under one owner. A ShiftBoard admin sets it up and makes you an owner.'}
        </p>
        <Link to={isAdmin ? '/admin?tab=organizations' : '/venue'} className="mt-5 inline-block px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white">
          {isAdmin ? 'Open Admin → Organizations' : 'Back to my venue'}
        </Link>
      </main>
    );
  }

  const me = org.owners.find((o) => o.is_you) || null;
  const t = overview?.totals || {};

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 bg-teal-500/10 text-teal-300 rounded-2xl border border-teal-500/20 flex-shrink-0">
                <Network className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                {renaming === null ? (
                  <h1 className="text-2xl font-black text-white flex items-center gap-2">
                    <span className="truncate">{org.name}</span>
                    <button type="button" onClick={() => setRenaming(org.name)} aria-label="Rename the organization"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>
                  </h1>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="flex items-center gap-2">
                    <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={255} aria-label="Organization name"
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-lg font-bold text-white focus:outline-none focus:border-teal-500" />
                    <button type="submit" disabled={busy} aria-label="Save the name" className="p-2 rounded-lg bg-teal-600 text-white"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setRenaming(null)} aria-label="Cancel" className="p-2 rounded-lg bg-slate-800 text-slate-300"><X className="w-4 h-4" /></button>
                  </form>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {org.venues.length} venue{org.venues.length === 1 ? '' : 's'} · {org.owners.length} owner{org.owners.length === 1 ? '' : 's'}
                  {!org.is_owner && isAdmin && ' · you’re viewing as a platform admin'}
                </p>
              </div>
            </div>
            {orgs.length > 1 && (
              <label className="text-xs text-slate-400">
                Organization
                <select value={org.id} onChange={(e) => setParam('org', e.target.value)}
                  className="block mt-0.5 bg-slate-900 border border-slate-700 text-white text-sm font-semibold rounded-xl px-3 py-2">
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <nav className="flex gap-1 mt-5 overflow-x-auto -mb-px" aria-label="Organization sections">
            {TABS.map((x) => {
              const Icon = x.icon;
              const on = tab === x.id;
              return (
                <button key={x.id} type="button" onClick={() => setParam('tab', x.id)} aria-current={on ? 'page' : undefined}
                  className={`px-3.5 py-2.5 text-sm font-bold inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition ${
                    on ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                  <Icon className={`w-4 h-4 ${on ? 'text-teal-300' : ''}`} /> {x.label}
                </button>
              );
            })}
          </nav>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-4">
        {notice && (
          <div role="status" className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'error' ? 'bg-amber-950/60 border-amber-700 text-amber-100' : 'bg-emerald-950/80 border-emerald-700 text-emerald-200'}`}>
            <span className="flex items-start gap-2">
              {notice.type === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {notice.message}
            </span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs underline flex-shrink-0">Dismiss</button>
          </div>
        )}

        {/* ------------------------------------------------------------------ Overview */}
        {tab === 'overview' && (
          <>
            {org.venues.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No venues in this organization yet. A platform admin adds them in Admin → Organizations.
              </p>
            ) : overview === null ? (
              <p className="py-12 text-center text-sm text-slate-500">Loading every venue…</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-white">All venues today</h2>
                  <button type="button" onClick={loadOverview} className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <Stat label="Events today" value={t.events_today || 0} />
                  <Stat label="Live now" value={t.live_now || 0} icon={Radio} tone={t.live_now ? 'text-emerald-300' : 'text-white'} />
                  <Stat label="Clocked in" value={`${t.clocked_in || 0} / ${t.booked_today || 0}`} />
                  <Stat label="Late" value={t.late || 0} icon={AlarmClock} tone={t.late ? 'text-rose-300' : 'text-white'} />
                  <Stat label="Open this week" value={t.open_spots_week || 0} icon={UserPlus} tone={t.open_spots_week ? 'text-amber-300' : 'text-white'} />
                  <Stat label="Requests waiting" value={t.requests_waiting || 0} icon={Inbox} tone={t.requests_waiting ? 'text-amber-300' : 'text-white'} />
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {overview.venues.map((v) => (
                    <li key={v.venue_id} className={`p-4 rounded-2xl bg-slate-900 border ${v.late > 0 ? 'border-rose-500/50' : v.live_now > 0 ? 'border-emerald-500/40' : 'border-slate-800'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white truncate flex items-center gap-1.5">
                            <Building2 className="w-4 h-4 text-teal-300 flex-shrink-0" /> {v.name}
                          </h3>
                          {v.city && <p className="text-xs text-slate-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {v.city}</p>}
                        </div>
                        {v.live_now > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                            <Radio className="w-3 h-3" /> LIVE
                          </span>
                        )}
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div><dt className="text-[10px] text-slate-500 uppercase">Today</dt><dd className="text-sm font-bold text-white">{v.events_today} event{v.events_today === 1 ? '' : 's'}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">In / booked</dt><dd className="text-sm font-bold text-white">{v.clocked_in} / {v.booked_today}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">Late</dt><dd className={`text-sm font-bold ${v.late ? 'text-rose-300' : 'text-white'}`}>{v.late}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">This week</dt><dd className="text-sm font-bold text-white">{v.events_week} event{v.events_week === 1 ? '' : 's'}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">Open spots</dt><dd className={`text-sm font-bold ${v.open_spots_week ? 'text-amber-300' : 'text-white'}`}>{v.open_spots_week}</dd></div>
                        <div><dt className="text-[10px] text-slate-500 uppercase">Requests</dt><dd className={`text-sm font-bold ${v.requests_waiting ? 'text-amber-300' : 'text-white'}`}>{v.requests_waiting}</dd></div>
                      </dl>
                      <p className="mt-3 text-xs text-slate-400 truncate">
                        {v.next_event_title
                          ? <>Next: <span className="text-slate-200 font-semibold">{v.next_event_title}</span> · {fmtDate(v.next_event_start, v.timezone)}, {fmtTime(v.next_event_start, v.timezone)}</>
                          : 'Nothing else posted this week.'}
                      </p>
                      <button type="button" onClick={() => openVenue(v.venue_id)}
                        className="mt-3 w-full px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white inline-flex items-center justify-center gap-1">
                        Open venue <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {/* ------------------------------------------------------------------ People */}
        {tab === 'people' && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="relative flex-1">
                <span className="sr-only">Search people</span>
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, venue or position"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500" />
              </label>
              <p className="text-xs text-slate-500">{people ? `${shownPeople.length} of ${people.length} people` : ''}</p>
            </div>
            <p className="text-xs text-slate-500">
              Each venue keeps its own team, positions and notes. Add someone to another venue’s team here, or move them. To change positions, notes or shift leads, open that venue’s Team page.
            </p>
            {people === null ? (
              <p className="py-12 text-center text-sm text-slate-500">Loading people…</p>
            ) : shownPeople.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                {people.length === 0 ? 'Nobody is on a team at these venues yet.' : 'Nobody matches that search.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {shownPeople.map((p) => (
                  <li key={p.worker_id} className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="md:w-80 min-w-0">
                      <p className="text-sm font-semibold text-white truncate flex items-center gap-2">
                        {`${p.first_name} ${p.last_name}`.trim() || p.email}
                        <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                      </p>
                      <p className="text-xs text-slate-400 truncate">{p.email}{p.phone ? ` · ${p.phone}` : ''}</p>
                    </div>
                    <ul className="flex-1 flex flex-wrap gap-1.5">
                      {p.venues.map((v) => (
                        <li key={v.venue_id}
                          title={`${v.status === 'active' ? 'On the team' : v.status === 'blocked' ? 'Blocked' : 'Removed'}${v.positions.length ? ` · ${v.positions.join(', ')}` : ''}${v.works_through ? ` · through ${v.works_through}` : ''} · ${v.shifts_worked} worked, ${v.upcoming} coming up`}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 ${STATUS_CHIP[v.status] || STATUS_CHIP.removed}`}>
                          {v.is_lead && <ClipboardCheck className="w-3 h-3 text-amber-300" aria-label="Shift lead" />}
                          {v.venue_name}
                          {v.status === 'blocked' && <span className="font-normal"> · blocked</span>}
                          {v.status === 'active' && v.positions.length > 0 && <span className="font-normal text-emerald-100/70"> · {v.positions.slice(0, 2).join(', ')}{v.positions.length > 2 ? '…' : ''}</span>}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => setShare(p)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white inline-flex items-center gap-1 whitespace-nowrap self-start md:self-center">
                      <UserPlus className="w-3.5 h-3.5" /> Add to a venue
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ------------------------------------------------------------------ Owners & settings */}
        {tab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <OrgOwnersPanel org={org} isAdmin={isAdmin} onChanged={replaceOrg} />
            <div className="space-y-4">
              {me && (
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><BellRing className="w-4 h-4 text-teal-300" /> Your alerts</h3>
                  <label className="mt-2 flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={!!me.venue_alerts} disabled={busy} onChange={(e) => setAlerts(e.target.checked)} className="mt-1 accent-teal-500" />
                    <span>
                      <span className="block text-sm font-semibold text-white">Send me each venue’s manager alerts</span>
                      <span className="block text-xs text-slate-400 mt-0.5">
                        New requests, late arrivals, dropped shifts and so on, for every venue here. Off: each venue’s own managers get them.
                        You always get them for a venue you manage directly, and for a venue that has no other manager.
                      </span>
                    </span>
                  </label>
                </section>
              )}
              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-teal-300" /> Venues</h3>
                {org.venues.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No venues yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-800">
                    {org.venues.map((v) => (
                      <li key={v.id} className="py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{v.name}</p>
                          <p className="text-xs text-slate-400">
                            {v.city || 'No city shown'} · {v.managers} manager{v.managers === 1 ? '' : 's'} of its own
                            {!v.public_board && ' · not on the public board'}
                          </p>
                        </div>
                        <button type="button" onClick={() => openVenue(v.id)} className="text-xs font-bold text-teal-300 hover:text-teal-200 inline-flex items-center gap-0.5 whitespace-nowrap">
                          Open <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  A ShiftBoard admin adds venues to an organization or takes them out. Add a venue’s own managers from that venue’s Team page.
                </p>
              </section>
            </div>
          </div>
        )}
      </main>

      {share && (
        <SharePersonModal
          orgId={org.id}
          person={share}
          venues={org.venues}
          onClose={() => setShare(null)}
          onDone={(result) => {
            const skipped = (result.skipped || []).map((s) => `${s.venue_name}: ${s.reason}`).join(' ');
            setNotice({ type: result.added.length ? 'success' : 'error', message: `${result.message}${skipped ? ` ${skipped}` : ''}` });
            if (result.person) setPeople((list) => (list || []).map((p) => (p.worker_id === result.person.worker_id ? result.person : p)));
            else loadPeople();
          }}
        />
      )}
    </div>
  );
}
```

---

## D9. NEW FILE `frontend/src/components/admin/AdminOrganizations.jsx`
The first line is `import React, { useCallback, useEffect, useMemo, useState } from 'react';` and the **last line is `}`**.

```jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Plus, Building2, Trash2, Pencil, Check, X, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import OrgOwnersPanel from '../org/OrgOwnersPanel';
import { card, inputCls, selectCls, btnGhost, btnPrimary, btnDanger, SectionTitle } from './adminUi';

/**
 * Phase 36: Admin → Organizations. An organization groups venues under one or more owners;
 * each owner manages every venue in it. There is no venue sign-up yet, so platform admins do this:
 *   create / rename / delete an organization, add or remove its owners, and put venues in or take them out.
 * A venue belongs to at most one organization. Deleting an organization never deletes a venue.
 * Props: refreshKey, venues ([{ id, name }]), onFlash({ type, message }), onChanged()
 */
export default function AdminOrganizations({ refreshKey, venues = [], onFlash, onChanged }) {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(null);       // { id, name }
  const [addVenue, setAddVenue] = useState({});     // org id -> venue id picked
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => api
    .get('/organizations')
    .then((res) => setOrgs(res.data || []))
    .catch(() => setOrgs([])), []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const taken = useMemo(() => new Set((orgs || []).flatMap((o) => o.venues.map((v) => v.id))), [orgs]);
  const freeVenues = venues.filter((v) => !taken.has(v.id));

  const apply = (result, fallback) => {
    if (result?.organization) {
      setOrgs((list) => {
        const rest = (list || []).filter((o) => o.id !== result.organization.id);
        return [...rest, result.organization].sort((a, b) => a.name.localeCompare(b.name));
      });
    }
    const warn = (result?.warnings || []).join(' ');
    onFlash?.({ type: warn ? 'error' : 'success', message: `${result?.message || fallback}${warn ? ` ${warn}` : ''}` });
    onChanged?.();
  };
  const fail = (err, fallback) => onFlash?.({ type: 'error', message: err.response?.data?.detail || fallback });

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await api.post('/organizations', { name: newName.trim(), venue_ids: [] });
      setNewName('');
      setOpenId(res.data.organization.id);
      apply(res.data, 'Organization created.');
    } catch (err) {
      fail(err, 'Could not create the organization.');
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const { id, name } = rename;
    if (!name.trim()) return setRename(null);
    try {
      const res = await api.patch(`/organizations/${id}`, { name: name.trim() });
      apply(res.data, 'Renamed.');
      setRename(null);
    } catch (err) {
      fail(err, 'Could not rename it.');
    }
    return null;
  };

  const putVenue = async (org) => {
    const venueId = addVenue[org.id];
    if (!venueId) return;
    try {
      const res = await api.post(`/organizations/${org.id}/venues`, { venue_id: venueId });
      setAddVenue((m) => ({ ...m, [org.id]: '' }));
      apply(res.data, 'Venue added.');
    } catch (err) {
      fail(err, 'Could not add the venue.');
    }
  };

  const askTakeOut = (org, v) => setConfirm({
    title: `Take ${v.name} out of ${org.name}?`,
    message: 'The venue, its team and its history stay exactly as they are. Its own managers keep managing it; the organization’s owners stop.',
    confirmLabel: 'Take it out',
    onConfirm: async () => {
      const res = await api.delete(`/organizations/${org.id}/venues/${v.id}`);
      apply(res.data, 'Venue taken out.');
    },
  });

  const askDelete = (org) => setConfirm({
    title: `Delete ${org.name}?`,
    message: `Its ${org.venues.length} venue${org.venues.length === 1 ? '' : 's'} and their teams, shifts and history are NOT deleted; they just stop being grouped. Its owners stop managing those venues unless they manage one directly.`,
    confirmLabel: 'Delete organization',
    danger: true,
    onConfirm: async () => {
      await api.delete(`/organizations/${org.id}`);
      setOrgs((list) => (list || []).filter((o) => o.id !== org.id));
      onFlash?.({ type: 'success', message: `Deleted ${org.name}. Its venues are untouched.` });
      onChanged?.();
    },
  });

  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <SectionTitle icon={Network} title="Organizations" tone="text-teal-300" />
        <p className="text-xs text-slate-400 -mt-1 mb-3">
          Group venues under one or more owners. An owner manages every venue in the organization. A venue can be in one organization.
        </p>
        <form onSubmit={create} className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1">
            <span className="sr-only">New organization name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={255} placeholder="New organization name, e.g. Harbor Hospitality Group" className={inputCls} />
          </label>
          <button type="submit" disabled={busy || !newName.trim()} className={btnPrimary}><Plus className="w-4 h-4" /> Create organization</button>
        </form>
      </div>

      {orgs === null && <p className="text-sm text-slate-500 text-center py-8">Loading…</p>}
      {orgs !== null && orgs.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-10 border border-dashed border-slate-800 rounded-2xl">
          No organizations yet. Create one above, then add its owners and venues.
        </p>
      )}

      {(orgs || []).map((org) => {
        const open = openId === org.id;
        return (
          <div key={org.id} className={card}>
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setOpenId(open ? null : org.id)} aria-expanded={open} className="flex-1 min-w-0 text-left">
                <span className="text-base font-bold text-white flex items-center gap-2">
                  <Network className="w-4 h-4 text-teal-300 flex-shrink-0" /> <span className="truncate">{org.name}</span>
                </span>
                <span className="block text-xs text-slate-400 mt-0.5">
                  {org.venues.length} venue{org.venues.length === 1 ? '' : 's'} · {org.owners.length === 0
                    ? <b className="text-amber-300">no owner yet</b>
                    : `owned by ${org.owners.map((o) => `${o.first_name} ${o.last_name}`.trim() || o.email).join(', ')}`}
                </span>
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => navigate(`/org?org=${org.id}`)} className={btnGhost}>Overview <ChevronRight className="w-3 h-3" /></button>
                <button type="button" onClick={() => setOpenId(open ? null : org.id)} className={btnGhost}>{open ? 'Close' : 'Manage'}</button>
              </div>
            </div>

            {open && (
              <div className="border-t border-slate-800 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <OrgOwnersPanel org={org} isAdmin onChanged={(r) => apply(r, 'Saved.')} />

                <div className="space-y-4">
                  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-teal-300" /> Venues</h3>
                    {org.venues.length === 0 ? (
                      <p className="text-sm text-slate-500">No venues yet.</p>
                    ) : (
                      <ul className="divide-y divide-slate-800">
                        {org.venues.map((v) => (
                          <li key={v.id} className="py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{v.name}</p>
                              <p className="text-xs text-slate-400">{v.city || 'No city shown'} · {v.managers} manager{v.managers === 1 ? '' : 's'} of its own</p>
                            </div>
                            <button type="button" onClick={() => askTakeOut(org, v)} className={btnGhost}><X className="w-3 h-3" /> Take out</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <label className="flex-1">
                        <span className="sr-only">Venue to add to {org.name}</span>
                        <select value={addVenue[org.id] || ''} onChange={(e) => setAddVenue((m) => ({ ...m, [org.id]: e.target.value }))} className={`${selectCls} w-full`}>
                          <option value="">{freeVenues.length ? 'Pick a venue to add…' : 'Every venue is already in an organization'}</option>
                          {freeVenues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </label>
                      <button type="button" onClick={() => putVenue(org)} disabled={!addVenue[org.id]} className={btnPrimary}><Plus className="w-4 h-4" /> Add venue</button>
                    </div>
                  </section>

                  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-white">Name</h3>
                    {rename && rename.id === org.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="flex gap-2">
                        <input autoFocus value={rename.name} maxLength={255} aria-label="Organization name" onChange={(e) => setRename({ id: org.id, name: e.target.value })} className={inputCls} />
                        <button type="submit" className={btnPrimary}><Check className="w-4 h-4" /> Save</button>
                        <button type="button" onClick={() => setRename(null)} className={btnGhost}>Cancel</button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setRename({ id: org.id, name: org.name })} className={btnGhost}><Pencil className="w-3 h-3" /> Rename</button>
                        <button type="button" onClick={() => askDelete(org)} className={btnDanger}><Trash2 className="w-3 h-3" /> Delete organization</button>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
```

---

# PART E: Frontend, edits

## E1. `frontend/src/App.jsx` (4 EDITS)
State: `publicConfig` (`useState(null)`) in `HomeRedirect`. Routes: `/lead` (workers) and `/org` (managers and admins).

**Edit 1.** Find:
```jsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
```

**Edit 2.** Find:
```jsx
import ProfilePage from './pages/ProfilePage';
import EarningsPage from './pages/EarningsPage';   // Phase 33.1

function HomeRedirect() {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
```
Replace with:
```jsx
import ProfilePage from './pages/ProfilePage';
import EarningsPage from './pages/EarningsPage';   // Phase 33.1
import PublicBoardPage from './pages/PublicBoardPage';       // Phase 36: home page when the public board is on
import LeadPage from './pages/LeadPage';                     // Phase 36: shift leads
import OrganizationPage from './pages/OrganizationPage';     // Phase 36: organization owners
import { getPublicConfig } from './utils/publicConfig';      // Phase 36

function HomeRedirect() {
  const { user, isAuthenticated, loading } = useAuth();
  // Phase 36: null = not asked yet. Only asked when nobody is signed in.
  const [publicConfig, setPublicConfig] = useState(null);

  useEffect(() => {
    if (loading || isAuthenticated) return undefined;
    let active = true;
    getPublicConfig().then((cfg) => {
      if (active) setPublicConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, [loading, isAuthenticated]);

  if (loading || (!isAuthenticated && publicConfig === null)) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
```

**Edit 3.** Find:
```jsx
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const role = (user?.role || '').toLowerCase();
```
Replace with:
```jsx
  }

  if (!isAuthenticated) {
    // Phase 36: PUBLIC_EVENT_BOARD on -> the public board is the home page. Off -> the sign-in page, as before.
    return publicConfig.public_board ? <PublicBoardPage config={publicConfig} /> : <Navigate to="/login" replace />;
  }

  const role = (user?.role || '').toLowerCase();
```

**Edit 4.** Find:
```jsx
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
```
Replace with:
```jsx
            />

            {/* Phase 36: shift leads (worker accounts marked "shift lead" on a venue's team) */}
            <Route
              path="/lead"
              element={
                <ProtectedRoute allowedRoles={['worker']}>
                  <Navbar />
                  <LeadPage />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />

            {/* Phase 36: organization owners (and platform admins) */}
            <Route
              path="/org"
              element={
                <ProtectedRoute allowedRoles={['venue_manager', 'platform_admin']}>
                  <Navbar />
                  <OrganizationPage />
                </ProtectedRoute>
              }
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
```

---

## E2. `frontend/src/pages/LoginPage.jsx` (4 EDITS)
Only a link back to the board when it is on (state `boardOn`). The sign-in logic is not touched.

**Edit 1.** Find:
```jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
```
Replace with:
```jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
```

**Edit 2.** Find:
```jsx
  MailCheck,
  Info,
} from 'lucide-react';
import {
  getFirebaseStatus,
```
Replace with:
```jsx
  MailCheck,
  Info,
  ArrowLeft,
} from 'lucide-react';
import { getPublicConfig } from '../utils/publicConfig';   // Phase 36
import {
  getFirebaseStatus,
```

**Edit 3.** Find:
```jsx
    getFirebaseStatus().then((s) => {
      if (active) setFbStatus(s);
    });
    return () => {
```
Replace with:
```jsx
    getFirebaseStatus().then((s) => {
      if (active) setFbStatus(s);
    });
    return () => {
      active = false;
    };
  }, []);

  // Phase 36: when the public board is on, offer a way back to it
  const [boardOn, setBoardOn] = useState(false);
  useEffect(() => {
    let active = true;
    getPublicConfig().then((cfg) => {
      if (active) setBoardOn(!!cfg.public_board);
    });
    return () => {
```

**Edit 4.** Find:
```jsx
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-4">
```
Replace with:
```jsx
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      {boardOn && (
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4 mb-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Open shifts
          </Link>
        </div>
      )}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-4">
```

---

## E3. `frontend/src/components/Navbar.jsx` (5 EDITS)
State `isLead` and `ownsOrg`; the Lead and Organization links; signing out goes to `/`.

**Edit 1.** Find:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound, Wallet } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33
```
Replace with:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound, Wallet, ClipboardCheck, Network } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33
```

**Edit 2.** Find:
```jsx
    await disablePush();          // Phase 33: this device stops getting this account's notifications
    logout();
    navigate('/login');
  };

  // Phase 33: if this device already allowed notifications, make sure the server still has it
  useEffect(() => {
    if (user?.id) syncPush();
  }, [user?.id]);

  // Close the mobile menu whenever the route changes
```
Replace with:
```jsx
    await disablePush();          // Phase 33: this device stops getting this account's notifications
    logout();
    navigate('/');                // Phase 36: the home page is the public board, or the sign-in page when the board is off
  };

  // Phase 33: if this device already allowed notifications, make sure the server still has it
  useEffect(() => {
    if (user?.id) syncPush();
  }, [user?.id]);

  // Phase 36: is this worker a shift lead anywhere / does this manager own an organization?
  // Asked once per sign-in; the page-level components ask again for the details.
  const [isLead, setIsLead] = useState(false);
  const [ownsOrg, setOwnsOrg] = useState(false);
  useEffect(() => {
    let active = true;
    setIsLead(false);
    setOwnsOrg(false);
    if (!user?.id) return undefined;
    if (userRole === 'worker') {
      api.get('/lead/venues').then((res) => active && setIsLead((res.data || []).length > 0)).catch(() => {});
    } else if (userRole === 'venue_manager') {
      api.get('/organizations').then((res) => active && setOwnsOrg((res.data || []).length > 0)).catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [user?.id, userRole]);

  // Close the mobile menu whenever the route changes
```

**Edit 3.** Find:
```jsx
      active: 'bg-slate-800 text-emerald-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Manager view' : 'My venue',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
    },
    isPlatformAdmin && {
```
Replace with:
```jsx
      active: 'bg-slate-800 text-emerald-400',
    },
    isWorker && isLead && {                         // Phase 36: shift leads
      to: '/lead',
      label: 'Lead',
      icon: ClipboardCheck,
      active: 'bg-slate-800 text-amber-300',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Manager view' : 'My venue',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
    },
    isManagerRole && ownsOrg && {                   // Phase 36: organization owners (admins use Admin → Organizations)
      to: '/org',
      label: 'Organization',
      icon: Network,
      active: 'bg-slate-800 text-teal-300',
    },
    isPlatformAdmin && {
```

**Edit 4.** Find:
```jsx
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                    <span>{ROLE_TEXT[userRole] || 'Worker'}</span>
                  </div>
                </div>
```
Replace with:
```jsx
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                    <span>{ownsOrg ? 'Owner' : isLead ? 'Shift lead' : (ROLE_TEXT[userRole] || 'Worker')}</span>
                  </div>
                </div>
```

**Edit 5.** Find:
```jsx
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{ROLE_TEXT[userRole] || 'Worker'}</span>
              </div>
            </div>
```
Replace with:
```jsx
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{ownsOrg ? 'Owner' : isLead ? 'Shift lead' : (ROLE_TEXT[userRole] || 'Worker')}</span>
              </div>
            </div>
```

---

## E4. `frontend/src/pages/WorkerDashboard.jsx` (3 EDITS)
Opens the event tapped on the public board, and shows the shift-lead banner.

**Edit 1.** Find:
```jsx
import CoverBoard from '../components/worker/CoverBoard';       // Phase 34
import WaitlistPanel from '../components/worker/WaitlistPanel'; // Phase 34
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```
Replace with:
```jsx
import CoverBoard from '../components/worker/CoverBoard';       // Phase 34
import WaitlistPanel from '../components/worker/WaitlistPanel'; // Phase 34
import LeadBanner from '../components/lead/LeadBanner';         // Phase 36
import { takePublicEvent } from '../utils/publicConfig';        // Phase 36
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```

**Edit 2.** Find:
```jsx
  };

  // Deep links from notifications (?tab=, ?request=, ?event=)
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
```
Replace with:
```jsx
  };

  // Phase 36: they tapped a shift on the public board, then signed in or signed up: open that shift
  useEffect(() => {
    if (String(user?.role || '').toLowerCase() !== 'worker') return;
    const eventId = takePublicEvent();
    if (!eventId) return;
    setActiveTab('find');
    setOpenListing({ eventId, initial: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links from notifications (?tab=, ?request=, ?event=)
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
```

**Edit 3.** Find:
```jsx
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {isWorker && <ProfileNudge />}
        <AppNudge />
        {notification && (
```
Replace with:
```jsx
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {isWorker && <ProfileNudge />}
        {isWorker && <LeadBanner />}
        <AppNudge />
        {notification && (
```

---

## E5. `frontend/src/components/ShiftBoard.jsx` (5 EDITS)
New prop `canNotify`, state `notifyAll`, and the tick box.

**Edit 1.** Find:
```jsx
} from 'lucide-react';

export default function ShiftBoard({ shiftId, currentUserRole, shiftTitle, onClose }) {
  const { user } = useAuth();
  const effectiveRole = currentUserRole || user?.role;
```
Replace with:
```jsx
} from 'lucide-react';

/**
 * The shift chat. Phase 36: managers, admins and shift leads (canNotify) get a tick box,
 * "Also send it to everyone booked on this shift", which sends the message as a notification too.
 */
export default function ShiftBoard({ shiftId, currentUserRole, shiftTitle, onClose, canNotify = null }) {
  const { user } = useAuth();
  const effectiveRole = currentUserRole || user?.role;
```

**Edit 2.** Find:
```jsx
  const messagesEndRef = useRef(null);

  const isManagerOrAdmin = ['venue_manager', 'platform_admin', 'super_admin'].includes(effectiveRole);

  const fetchMessages = async () => {
```
Replace with:
```jsx
  const messagesEndRef = useRef(null);

  const isManagerOrAdmin = ['venue_manager', 'platform_admin', 'super_admin'].includes(effectiveRole);
  const mayNotify = canNotify === null ? isManagerOrAdmin : !!canNotify;    // Phase 36
  const [notifyAll, setNotifyAll] = useState(false);

  const fetchMessages = async () => {
```

**Edit 3.** Find:
```jsx
      const res = await api.post(`/shifts/${shiftId}/messages`, {
        content: newMessage.trim(),
      });
      setMessages((prev) => [...prev, res.data]);
      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
```
Replace with:
```jsx
      const res = await api.post(`/shifts/${shiftId}/messages`, {
        content: newMessage.trim(),
        notify: mayNotify && notifyAll,          // Phase 36
      });
      setMessages((prev) => [...prev, res.data]);
      setNewMessage('');
      setNotifyAll(false);
    } catch (err) {
      console.error('Error sending message:', err);
```

**Edit 4.** Find:
```jsx
      </div>

      {/* Compose Form */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 border-t border-slate-800 bg-slate-950 flex items-center space-x-2"
      >
        <input
```
Replace with:
```jsx
      </div>

      {/* Phase 36: managers and shift leads can push the message to everyone booked */}
      {mayNotify && (
        <label className="px-4 pt-2.5 bg-slate-950 border-t border-slate-800 flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={notifyAll} onChange={(e) => setNotifyAll(e.target.checked)} className="accent-indigo-500" />
          Also send it to everyone booked on this shift
        </label>
      )}

      {/* Compose Form */}
      <form
        onSubmit={handleSendMessage}
        className={`p-3 bg-slate-950 flex items-center space-x-2 ${mayNotify ? '' : 'border-t border-slate-800'}`}
      >
        <input
```

**Edit 5.** Find:
```jsx
        >
          <Send className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{sending ? 'Posting...' : 'Post'}</span>
        </button>
      </form>
```
Replace with:
```jsx
        >
          <Send className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{sending ? 'Posting...' : (mayNotify && notifyAll ? 'Post & send' : 'Post')}</span>
        </button>
      </form>
```

---

## E6. `frontend/src/components/ShiftBoardModal.jsx` (2 EDITS)

**Edit 1.** Find:
```jsx
 * Phase 25.3: Discussion board overlay. Always renders above ModalShell (z-[60]).
 */
export default function ShiftBoardModal({ shiftId, shiftTitle, currentUserRole, onClose }) {
  useModalLayer(onClose);

  return createPortal(
```
Replace with:
```jsx
 * Phase 25.3: Discussion board overlay. Always renders above ModalShell (z-[60]).
 */
export default function ShiftBoardModal({ shiftId, shiftTitle, currentUserRole, onClose, canNotify = null }) {
  useModalLayer(onClose);

  return createPortal(
```

**Edit 2.** Find:
```jsx
    >
      <div className="max-w-2xl w-full">
        <ShiftBoard shiftId={shiftId} shiftTitle={shiftTitle} currentUserRole={currentUserRole} onClose={onClose} />
      </div>
    </div>,
```
Replace with:
```jsx
    >
      <div className="max-w-2xl w-full">
        <ShiftBoard shiftId={shiftId} shiftTitle={shiftTitle} currentUserRole={currentUserRole} onClose={onClose} canNotify={canNotify} />
      </div>
    </div>,
```

---

## E7. `frontend/src/components/manager/TonightBoard.jsx` (5 EDITS)
New props `tonightPath` and `timesLabel`, so the Lead page can reuse the board. Managers see no change.

**Edit 1.** Find:
```jsx
 *        onChanged(message)   -> parent reloads everything and shows the message
 *        onSummary({ late, openSpots })
 */
export default function TonightBoard({
  venueId, timeZone, refreshKey = 0, reliabilityMap = {},
  onOpenBoard, onOpenEvent, onTimesheet, onOpenWorker, onChanged, onSummary,
}) {
  const [data, setData] = useState(null);
```
Replace with:
```jsx
 *        onChanged(message)   -> parent reloads everything and shows the message
 *        onSummary({ late, openSpots })
 * Phase 36: also the shift lead's board (pages/LeadPage.jsx). Lead mode passes
 *        tonightPath = `/lead/venues/${venueId}/tonight` and timesLabel = 'Clock times', and leaves out
 *        onOpenEvent / onOpenWorker (those buttons then aren't drawn). Everything else is the same.
 */
export default function TonightBoard({
  venueId, timeZone, refreshKey = 0, reliabilityMap = {},
  onOpenBoard, onOpenEvent, onTimesheet, onOpenWorker, onChanged, onSummary,
  tonightPath = null, timesLabel = 'Time sheet',
}) {
  const [data, setData] = useState(null);
```

**Edit 2.** Find:
```jsx
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(`/venues/${venueId}/tonight`);
      if (venueRef.current !== venueId) return;
      setData(res.data);
```
Replace with:
```jsx
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(tonightPath || `/venues/${venueId}/tonight`);
      if (venueRef.current !== venueId) return;
      setData(res.data);
```

**Edit 3.** Find:
```jsx
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
```
Replace with:
```jsx
      setLoading(false);
    }
  }, [venueId, tonightPath]);

  useEffect(() => {
```

**Edit 4.** Find:
```jsx
    }
    if (a.kind === 'geo' && a.event_id) {
      out.push(<button key="ts" type="button" onClick={() => onTimesheet?.(a.event_id)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><ClipboardList className="w-3 h-3" /> Time sheet</button>);
    }
    return out;
```
Replace with:
```jsx
    }
    if (a.kind === 'geo' && a.event_id) {
      out.push(<button key="ts" type="button" onClick={() => onTimesheet?.(a.event_id)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><ClipboardList className="w-3 h-3" /> {timesLabel}</button>);
    }
    return out;
```

**Edit 5.** Find:
```jsx
                  onTimesheet={onTimesheet}
                  onOpenWorker={onOpenWorker}
                />
              ))}
```
Replace with:
```jsx
                  onTimesheet={onTimesheet}
                  onOpenWorker={onOpenWorker}
                  timesLabel={timesLabel}
                />
              ))}
```

---

## E8. `frontend/src/components/manager/TodayEventCard.jsx` (4 EDITS)

**Edit 1.** Find:
```jsx
 *        onBoard(position), onClockIn(person, position), onNoShow(person, position), onFindCover(position),
 *        onOpenEvent(eventId), onTimesheet(eventId), onOpenWorker(workerId)
 */
export default function TodayEventCard({
  event, timeZone, nowMs, reliabilityMap = {}, highlightRequestId,
  onBoard, onClockIn, onNoShow, onFindCover, onOpenEvent, onTimesheet, onOpenWorker,
}) {
  const ended = event.state === 'ended';
```
Replace with:
```jsx
 *        onBoard(position), onClockIn(person, position), onNoShow(person, position), onFindCover(position),
 *        onOpenEvent(eventId), onTimesheet(eventId), onOpenWorker(workerId)
 * Phase 36: without onOpenEvent there's no Roster button, and without onOpenWorker names aren't links
 *        (the shift lead's board). timesLabel names the time-sheet button. reliabilityMap = null hides
 *        the reliability badges (leads don't get that data).
 */
export default function TodayEventCard({
  event, timeZone, nowMs, reliabilityMap = {}, highlightRequestId,
  onBoard, onClockIn, onNoShow, onFindCover, onOpenEvent, onTimesheet, onOpenWorker,
  timesLabel = 'Time sheet',
}) {
  const ended = event.state === 'ended';
```

**Edit 2.** Find:
```jsx
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.event_id && !ended && (
            <button type="button" onClick={() => onOpenEvent?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
```
Replace with:
```jsx
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.event_id && !ended && onOpenEvent && (
            <button type="button" onClick={() => onOpenEvent?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
```

**Edit 3.** Find:
```jsx
            <button type="button" onClick={() => onTimesheet?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
              <ClipboardList className="w-3.5 h-3.5" /> Time sheet
            </button>
          )}
```
Replace with:
```jsx
            <button type="button" onClick={() => onTimesheet?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
              <ClipboardList className="w-3.5 h-3.5" /> {timesLabel}
            </button>
          )}
```

**Edit 4.** Find:
```jsx
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${st.cls}`}>{st.label}</span>
                        <div className="min-w-0">
                          <button type="button" onClick={() => onOpenWorker?.(p.worker_id)} className="text-sm font-semibold text-white hover:underline truncate text-left">
                            {p.first_name} {p.last_name}
                          </button>
                          <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                            {sub && <span className={p.clock_state === 'late' ? 'text-rose-300 font-semibold' : ''}>{sub}</span>}
                            {p.manager_clock && <span className="text-indigo-300">clocked in by a manager</span>}
                            {p.geo_flag && <span className="text-amber-300 inline-flex items-center gap-0.5"><MapPinOff className="w-3 h-3" /> away from site</span>}
                            {p.info_seen === false && ['upcoming', 'due', 'late'].includes(p.clock_state) && (
                              <span className="text-amber-200 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" /> hasn't read the update</span>
                            )}
                            <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                          </p>
                        </div>
```
Replace with:
```jsx
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${st.cls}`}>{st.label}</span>
                        <div className="min-w-0">
                          {onOpenWorker ? (
                            <button type="button" onClick={() => onOpenWorker(p.worker_id)} className="text-sm font-semibold text-white hover:underline truncate text-left">
                              {p.first_name} {p.last_name}
                            </button>
                          ) : (
                            <span className="text-sm font-semibold text-white truncate block">{p.first_name} {p.last_name}</span>
                          )}
                          <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                            {sub && <span className={p.clock_state === 'late' ? 'text-rose-300 font-semibold' : ''}>{sub}</span>}
                            {p.manager_clock && <span className="text-indigo-300">clocked in for them</span>}
                            {p.geo_flag && <span className="text-amber-300 inline-flex items-center gap-0.5"><MapPinOff className="w-3 h-3" /> away from site</span>}
                            {p.info_seen === false && ['upcoming', 'due', 'late'].includes(p.clock_state) && (
                              <span className="text-amber-200 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" /> hasn't read the update</span>
                            )}
                            {reliabilityMap && <ReliabilityBadge data={reliabilityMap[p.worker_id]} />}
                          </p>
                        </div>
```

---

## E9. `frontend/src/components/manager/WeekAtGlance.jsx` (1 EDIT)

**Edit 1.** Find:
```jsx
              {d.events.map((e) => (
                <li key={e.event_key}>
                  <button type="button" disabled={!e.event_id} onClick={() => e.event_id && onOpenEvent?.(e.event_id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg border bg-slate-950/50 hover:bg-slate-800/80 transition ${fillTone(e)}`}>
                    <p className="text-[10px] text-slate-400">{fmtTime(e.start_time, timeZone)}</p>
```
Replace with:
```jsx
              {d.events.map((e) => (
                <li key={e.event_key}>
                  <button type="button" disabled={!e.event_id || !onOpenEvent} onClick={() => e.event_id && onOpenEvent?.(e.event_id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg border bg-slate-950/50 hover:bg-slate-800/80 transition ${fillTone(e)}`}>
                    <p className="text-[10px] text-slate-400">{fmtTime(e.start_time, timeZone)}</p>
```

---

## E10. `frontend/src/components/TeamModal.jsx` (4 EDITS)
The Shift lead chip and button, and the Owner badge on the Managers tab.

**Edit 1.** Find:
```jsx
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus, BadgeCheck,
  Building2, Timer,
} from 'lucide-react';
import api from '../api/client';
```
Replace with:
```jsx
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus, BadgeCheck,
  Building2, Timer, ClipboardCheck, Crown,
} from 'lucide-react';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
              </span>
            )}
            {(m.positions || []).slice(0, 3).map((p) => (
              <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px] font-bold uppercase">{p}</span>
```
Replace with:
```jsx
              </span>
            )}
            {/* Phase 36 */}
            {m.is_lead && (
              <span title="Shift lead: runs the floor (clock-ins, no-shows, open spots). Never sees pay."
                className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[9px] font-bold inline-flex items-center gap-0.5">
                <ClipboardCheck className="w-2.5 h-2.5" /> Shift lead
              </span>
            )}
            {(m.positions || []).slice(0, 3).map((p) => (
              <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px] font-bold uppercase">{p}</span>
```

**Edit 3.** Find:
```jsx
              <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
```
Replace with:
```jsx
              <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {/* Phase 36: shift lead */}
            {m.status === 'active' && (
              <button type="button" className={btnGhost} disabled={busy} onClick={() => patch({ is_lead: !m.is_lead })}
                title="A shift lead sees who's on today, clocks people in and out, marks no-shows, fixes clock times, messages shifts and fills open spots from the team. They never see pay.">
                <ClipboardCheck className={`w-3.5 h-3.5 ${m.is_lead ? 'text-amber-300' : ''}`} /> {m.is_lead ? 'Stop being shift lead' : 'Make shift lead'}
              </button>
            )}
```

**Edit 4.** Find:
```jsx
              {m.is_you && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">You</span>}
              {m.is_primary && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">Primary</span>}
              <span className="text-xs text-slate-400">{m.email}</span>
              {!m.is_you && (
                <span className="ml-auto">
                  {confirmId === m.user_id ? (
```
Replace with:
```jsx
              {m.is_you && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">You</span>}
              {m.is_primary && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">Primary</span>}
              {/* Phase 36: owners of the venue's organization manage it automatically */}
              {m.via_org && (
                <span title={`Owner of ${m.organization_name || 'the organization'}. Owners manage every venue in it and are changed on the Organization page.`}
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-500/10 text-teal-300 border border-teal-500/30 inline-flex items-center gap-1">
                  <Crown className="w-3 h-3" /> Owner{m.organization_name ? ` · ${m.organization_name}` : ''}
                </span>
              )}
              <span className="text-xs text-slate-400">{m.email}</span>
              {!m.is_you && !m.via_org && (
                <span className="ml-auto">
                  {confirmId === m.user_id ? (
```

---

## E11. `frontend/src/components/VenueSettingsModal.jsx` (3 EDITS)
Form fields `public_board` and `city`, and their card.

**Edit 1.** Find:
```jsx
    show_rates_publicly: venue?.show_rates_publicly ?? true,
    allow_public_cover: venue?.allow_public_cover ?? true,                        // Phase 34
    auto_approve_rating_threshold:
      venue?.auto_approve_rating_threshold != null ? String(venue.auto_approve_rating_threshold) : '',
```
Replace with:
```jsx
    show_rates_publicly: venue?.show_rates_publicly ?? true,
    allow_public_cover: venue?.allow_public_cover ?? true,                        // Phase 34
    public_board: venue?.public_board ?? true,                                    // Phase 36
    city: venue?.city || '',                                                      // Phase 36
    auto_approve_rating_threshold:
      venue?.auto_approve_rating_threshold != null ? String(venue.auto_approve_rating_threshold) : '',
```

**Edit 2.** Find:
```jsx
      show_rates_publicly: !!form.show_rates_publicly,
      allow_public_cover: !!form.allow_public_cover,                              // Phase 34
      auto_approve_rating_threshold: form.auto_approve_rating_threshold === '' ? null : parseFloat(form.auto_approve_rating_threshold),
      arrival_instructions: form.arrival_instructions,
```
Replace with:
```jsx
      show_rates_publicly: !!form.show_rates_publicly,
      allow_public_cover: !!form.allow_public_cover,                              // Phase 34
      public_board: !!form.public_board,                                          // Phase 36
      city: form.city.trim(),                                                     // Phase 36: "" = work it out from the address
      auto_approve_rating_threshold: form.auto_approve_rating_threshold === '' ? null : parseFloat(form.auto_approve_rating_threshold),
      arrival_instructions: form.arrival_instructions,
```

**Edit 3.** Find:
```jsx
              </label>
            </div>

            <div className={cardCls}>
              <div>
                <label className={labelCls}>Arrival instructions (only booked staff see these)</label>
```
Replace with:
```jsx
              </label>
            </div>

            {/* Phase 36: the public event board (people who aren't signed in) */}
            <div className={cardCls}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={!!form.public_board}
                  onChange={(e) => setForm({ ...form, public_board: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">List our shifts on the public board</span>
                  <span className="block text-xs text-slate-400">
                    If ShiftBoard's public board is switched on, people who aren't signed in can see your event names, dates,
                    positions and open spots. Never pay, your address or your notes. They need a worker account to see more or to book.
                  </span>
                </span>
              </label>
              <div className="mt-3">
                <label className={labelCls} htmlFor="venue-city">City shown on the public board</label>
                <input id="venue-city" type="text" value={form.city} onChange={set('city')} className={inputCls} maxLength={120}
                  placeholder="Leave blank to use the city in your address, e.g. Denver, CO" />
              </div>
            </div>

            <div className={cardCls}>
              <div>
                <label className={labelCls}>Arrival instructions (only booked staff see these)</label>
```

---

## E12. `frontend/src/pages/AdminPanel.jsx` (4 EDITS)
The Organizations tab.

**Edit 1.** Find:
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, LayoutDashboard, Building2, Users, History, Server, UserPlus, Plus } from 'lucide-react';
import api from '../api/client';
import { APP_VERSION } from '../utils/version';   // Phase 34.5
```
Replace with:
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, LayoutDashboard, Building2, Users, History, Server, UserPlus, Plus, Network } from 'lucide-react';
import api from '../api/client';
import { APP_VERSION } from '../utils/version';   // Phase 34.5
```

**Edit 2.** Find:
```jsx
import AdminActivity from '../components/admin/AdminActivity';
import AdminSystem from '../components/admin/AdminSystem';
import { Flash, venuesChanged } from '../components/admin/adminUi';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'venues', label: 'Venues', icon: Building2 },
  { id: 'users', label: 'People', icon: Users },
  { id: 'activity', label: 'Activity', icon: History },
```
Replace with:
```jsx
import AdminActivity from '../components/admin/AdminActivity';
import AdminSystem from '../components/admin/AdminSystem';
import AdminOrganizations from '../components/admin/AdminOrganizations';   // Phase 36
import { Flash, venuesChanged } from '../components/admin/adminUi';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'venues', label: 'Venues', icon: Building2 },
  { id: 'organizations', label: 'Organizations', icon: Network },   // Phase 36
  { id: 'users', label: 'People', icon: Users },
  { id: 'activity', label: 'Activity', icon: History },
```

**Edit 3.** Find:
```jsx
/**
 * Phase 29.2: Platform admin console.
 * Tabs (kept in ?tab=): Overview · Venues · People · Activity · System.
 * Venue and person details open in right-hand drawers from any tab.
 */
```
Replace with:
```jsx
/**
 * Phase 29.2: Platform admin console.
 * Tabs (kept in ?tab=): Overview · Venues · Organizations (Phase 36) · People · Activity · System.
 * Venue and person details open in right-hand drawers from any tab.
 */
```

**Edit 4.** Find:
```jsx
          <AdminVenues refreshKey={refreshKey} onOpenVenue={setVenueDrawer} onCreate={() => setCreateVenue(true)} />
        )}
        {tab === 'users' && (
          <AdminUsers refreshKey={refreshKey} venues={venues} onOpenUser={setUserDrawer} onCreate={() => setCreateUser(true)} />
```
Replace with:
```jsx
          <AdminVenues refreshKey={refreshKey} onOpenVenue={setVenueDrawer} onCreate={() => setCreateVenue(true)} />
        )}
        {tab === 'organizations' && (
          <AdminOrganizations refreshKey={refreshKey} venues={venues} onFlash={setFlash} onChanged={() => window.dispatchEvent(new CustomEvent('admin_venues_changed'))} />
        )}
        {tab === 'users' && (
          <AdminUsers refreshKey={refreshKey} venues={venues} onOpenUser={setUserDrawer} onCreate={() => setCreateUser(true)} />
```

---

# PART F: Demo data, settings templates and guides

## F1. `backend/src/demo_data.py` (7 EDITS)

**Edit 1.** Find:
```python
from src.database import AsyncSessionLocal, Base
from src.models import (
    CoverRequest, EventTemplate, EventTip, NotificationPreference, PayPeriodApproval, Rating, Shift,
    ShiftBoardMessage, ShiftEvent, ShiftOffer, ShiftRequest, ShiftTransfer, TimeEntry, TimeEntryEdit, TimeOffBlock,
    User, Venue, VenueActivity, VenueInvite, VenueLocation, VenueManager, VenuePosition, VenueWhitelist,
```
Replace with:
```python
from src.database import AsyncSessionLocal, Base
from src.models import (
    CoverRequest, EventTemplate, EventTip, NotificationPreference, Organization, OrganizationMember, PayPeriodApproval, Rating, Shift,
    ShiftBoardMessage, ShiftEvent, ShiftOffer, ShiftRequest, ShiftTransfer, TimeEntry, TimeEntryEdit, TimeOffBlock,
    User, Venue, VenueActivity, VenueInvite, VenueLocation, VenueManager, VenuePosition, VenueWhitelist,
```

**Edit 2.** Find:
```python
def uid(key: str) -> uuid.UUID:
    return uuid.uuid5(NS, key)


# ------------------------------------------------------------------------------------------------
```
Replace with:
```python
def uid(key: str) -> uuid.UUID:
    return uuid.uuid5(NS, key)


ORG_NAME = "Whitaker Hospitality Group"          # Phase 36: the demo organization (Harbor House + Copperline)
ORG_IDS = [uid("org:whitaker")]


# ------------------------------------------------------------------------------------------------
```

**Edit 3.** Find:
```python
                      ot_weekly_hours=40, ot_daily_hours=None, work_week_start=2, tips_enabled=True,
                      tip_pool_split="equal", geofence_enabled=False,
                      arrival_instructions="Side door by the patio. Aprons are behind the bar.",
                      dress_code="Copperline tee (we have spares), jeans, closed-toe shoes."),
```
Replace with:
```python
                      ot_weekly_hours=40, ot_daily_hours=None, work_week_start=2, tips_enabled=True,
                      tip_pool_split="equal", geofence_enabled=False,
                      city="RiNo, Denver",                                    # Phase 36: typed city for the public board
                      arrival_instructions="Side door by the patio. Aprons are behind the bar.",
                      dress_code="Copperline tee (we have spares), jeans, closed-toe shoes."),
```

**Edit 4.** Find:
```python
                      pay_period_approval=False, ot_weekly_hours=40, ot_daily_hours=8, tips_enabled=False,
                      show_rates_publicly=False, allow_public_cover=False, geofence_enabled=False,
                      arrival_instructions="Check in with the host stand on 12. Staff lockers on 11.",
                      dress_code="All black, elevated. No logos."),
```
Replace with:
```python
                      pay_period_approval=False, ot_weekly_hours=40, ot_daily_hours=8, tips_enabled=False,
                      show_rates_publicly=False, allow_public_cover=False, geofence_enabled=False,
                      public_board=False,                                     # Phase 36: this venue stays off the public board
                      arrival_instructions="Check in with the host stand on 12. Staff lockers on 11.",
                      dress_code="All black, elevated. No logos."),
```

**Edit 5.** Find:
```python
        built[4]["by_role"]["Setup Crew"].append(both)
        regional = self.person("venue_manager", "Sam", "Whitaker", f"regional.manager@{DOMAIN}", bio="Regional operations manager.")
        for v in (built[1], built[2]):
            self.add(VenueManager(venue_id=v["venue"].id, user_id=regional.id, is_primary=False))
        # a brand-new team member with no history, and one removed, one blocked
        for v in built:
```
Replace with:
```python
        built[4]["by_role"]["Setup Crew"].append(both)
        regional = self.person("venue_manager", "Sam", "Whitaker", f"regional.manager@{DOMAIN}", bio="Regional operations manager.")
        # Phase 36: those two venues are one organization, and the regional manager owns it. An owner's
        # venue rows are via_org (the same rows services/organizations.sync_managers() would make).
        opened = self.now - timedelta(days=self.weeks_back * 7 + 30)
        org = self.add(Organization(id=ORG_IDS[0], name=ORG_NAME, created_at=opened, updated_at=opened))
        self.add(OrganizationMember(organization_id=org.id, user_id=regional.id, role="owner", venue_alerts=False,
                                    created_at=opened))
        for v in (built[1], built[2]):
            v["venue"].organization_id = org.id
            self.add(VenueManager(venue_id=v["venue"].id, user_id=regional.id, is_primary=False, via_org=True))
        # Phase 36: one shift lead per venue (a reliable team member), with an easy login
        for v in built:
            wid = next((w for w in v["members"] if self.profile.get(w) == "ace"), next(iter(v["members"])))
            v["members"][wid].is_lead = True
            self.users[wid].email = f"lead.{v['spec']['key']}@{DOMAIN}"
        # a brand-new team member with no history, and one removed, one blocked
        for v in built:
```

**Edit 6.** Find:
```python
    """Delete the demo venues and demo accounts. Everything attached to them goes with them (ON DELETE CASCADE)."""
    v = (await db.execute(delete(Venue).where(Venue.id.in_(VENUE_IDS)))).rowcount
    u = (await db.execute(delete(User).where(User.email.like(f"%@{DOMAIN}")))).rowcount
    return v, u
```
Replace with:
```python
    """Delete the demo venues and demo accounts. Everything attached to them goes with them (ON DELETE CASCADE)."""
    v = (await db.execute(delete(Venue).where(Venue.id.in_(VENUE_IDS)))).rowcount
    await db.execute(delete(Organization).where(Organization.id.in_(ORG_IDS)))      # Phase 36: the demo organization
    u = (await db.execute(delete(User).where(User.email.like(f"%@{DOMAIN}")))).rowcount
    return v, u
```

**Edit 7.** Find:
```python
        for s in VENUES:
            print(f"  manager.{s['key']}@{DOMAIN:<18}  {s['name']}")
        print(f"  regional.manager@{DOMAIN}   Harbor House Events + Copperline Taproom")
        print(f"Workers: Admin -> Users, or any venue's Team list. They all end in @{DOMAIN}.")
        print("Existing admins see every demo venue in the venue picker.")
```
Replace with:
```python
        for s in VENUES:
            print(f"  manager.{s['key']}@{DOMAIN:<18}  {s['name']}")
        print(f"  regional.manager@{DOMAIN}   owner of {ORG_NAME} (Harbor House Events + Copperline Taproom)")
        print("Shift leads (worker accounts with a Lead view):")
        for s in VENUES:
            print(f"  lead.{s['key']}@{DOMAIN:<21}  {s['name']}")
        print(f"Workers: Admin -> Users, or any venue's Team list. They all end in @{DOMAIN}.")
        print("Existing admins see every demo venue in the venue picker.")
```

---

## F2. `.env.template` (1 EDIT)

**Edit 1.** Find:
```bash
# Set false for anything real. (The big demo data set is separate: see docs/DEPLOYMENT.md.)
SEED_DEMO_ACCOUNTS=true

# ------------------------------------------------------------------------------
```
Replace with:
```bash
# Set false for anything real. (The big demo data set is separate: see docs/DEPLOYMENT.md.)
SEED_DEMO_ACCOUNTS=true
# true = the home page (/) is a public board of posted shifts for people who aren't signed in, with a
# "Sign in / Sign up" button in the corner. It shows the event name, date and time, venue name, city,
# positions and open spots. Never pay, addresses or notes: those need a worker account.
# false = the home page is the sign-in page.
# Each venue can keep its own shifts off the board (Venue settings → List our shifts on the public board).
PUBLIC_EVENT_BOARD=false

# ------------------------------------------------------------------------------
```

---

## F3. `backend/.env.template` (1 EDIT)

**Edit 1.** Find:
```bash
ALLOW_SELF_REGISTRATION=true
SHOW_DEMO_LOGINS=false

# Firebase: paths relative to backend/ when running locally
```
Replace with:
```bash
ALLOW_SELF_REGISTRATION=true
SHOW_DEMO_LOGINS=false
PUBLIC_EVENT_BOARD=false

# Firebase: paths relative to backend/ when running locally
```

---

## F4. `agy_system_instructions.md` (2 EDITS)
Two role lines, and rules 10 and 11 added after rule 9 (the last line of the file).

**Edit 1.** Find:
```markdown
*   **Venue Manager:** Posts shifts, manages venue profile, reviews applicants, rates workers, manages whitelist.
*   **Worker:** Subscribes to shift types/locations, applies for shifts, checks in/out (geolocation), manages personal profile.

### 2. Worker Profiles & Ratings
```
Replace with:
```markdown
*   **Venue Manager:** Posts shifts, manages venue profile, reviews applicants, rates workers, manages whitelist.
*   **Worker:** Subscribes to shift types/locations, applies for shifts, checks in/out (geolocation), manages personal profile.
*   **Owner (Phase 36):** a manager account that owns an organization (a group of venues). Manages every venue in it. Not a `users.role` value: a row in `organization_members`.
*   **Shift lead (Phase 36):** a worker marked shift lead on a venue's team (`venue_whitelists.is_lead`). Runs the floor (clock-ins, no-shows, clock times, shift chat, open spots). Never sees pay. Not a `users.role` value.

### 2. Worker Profiles & Ratings
```

**Edit 2.** Find:
```markdown
   * Refer to a container as `docker compose exec <service>`, never by a container name.
   * Never run `docker compose` yourself on this computer: a command in the wrong folder acts on the wrong stack.
```
Replace with:
```markdown
   * Refer to a container as `docker compose exec <service>`, never by a container name.
   * Never run `docker compose` yourself on this computer: a command in the wrong folder acts on the wrong stack.
10. **Roles and access (Phase 36):** `users.role` has exactly three values: `platform_admin`, `venue_manager`, `worker`. Never add a fourth. Owner and shift lead are memberships, not roles.
   * **Owners:** `organization_members` (role `owner`). An owner manages every venue in the organization through ordinary `venue_managers` rows with `via_org = TRUE`. Only `services/organizations.sync_managers()` creates or deletes those rows. Call it, before the commit, whenever an owner or a venue is added to or removed from an organization, an organization is deleted, or a user's role changes. Never write `via_org` rows by hand anywhere else (the demo loader is the one exception, and its rows must match what the sync would make).
   * **Shift leads:** `venue_whitelists.is_lead`. Use `services/access.floor_access()` for "manager or shift lead"; use the existing manager checks for everything else. A new endpoint is manager-only unless the phase says leads may use it.
   * **Shift leads never see pay.** Nothing a lead can call may return a pay rate, tip, cost or earnings. What a lead reads lives in `routers/lead.py`, with response models that have no pay fields. Never return a manager schema (`EventTimesheet`, `EventDetail`, `ShiftRosterResponse`, ...) from an endpoint a lead can call, and never open a manager read endpoint to leads.
   * There is no venue sign-up: only platform admins create organizations and put venues in them.
11. **The public board (Phase 36):** `PUBLIC_EVENT_BOARD=true` makes the home page a public board for people who aren't signed in. `routers/public.py` is the ONLY place for endpoints that need no sign-in (besides sign-in itself, invites and avatars).
   * `GET /api/public/board` returns only: event id, title, start and end, time zone, venue name, city, and positions with open spots. Never add pay, addresses, coordinates, notes, location names, requirements, logos, venue ids or anyone's name to it.
   * Every other endpoint must depend on `get_current_user` (directly or through a `require_...` dependency). A new endpoint with no sign-in needs the user's explicit OK.
   * The frontend learns the setting from `GET /api/public/config` (`utils/publicConfig.js`). No `VITE_` variable.
```

---

## F5. `docs/DEPLOYMENT.md` (2 EDITS)

**Edit 1.** Both blocks are wrapped in four backticks; the three-backtick lines inside them are content. Find:
````markdown
   SHOW_DEMO_LOGINS=false
   ```
2. Still in `.env`, set the first admin: `SUPER_ADMIN_USERNAME=you@yourdomain.com`. Put the password in `.secrets/stack.env` as `SUPER_ADMIN_PASSWORD`. Optionally list people who should always be admins when they sign in with Firebase: `ALWAYS_ADMIN_EMAILS=you@yourdomain.com,partner@yourdomain.com`.
3. Start it: `docker compose up -d --build` (new install) or `docker compose up -d --force-recreate` (existing one).
````
Replace with:
````markdown
   SHOW_DEMO_LOGINS=false
   ```
   Also decide what the home page is: `PUBLIC_EVENT_BOARD=true` shows a public board of posted shifts to people who aren't signed in (event name, time, venue, city and open spots only); `false` (the default) shows the sign-in page.
2. Still in `.env`, set the first admin: `SUPER_ADMIN_USERNAME=you@yourdomain.com`. Put the password in `.secrets/stack.env` as `SUPER_ADMIN_PASSWORD`. Optionally list people who should always be admins when they sign in with Firebase: `ALWAYS_ADMIN_EMAILS=you@yourdomain.com,partner@yourdomain.com`.
3. Start it: `docker compose up -d --build` (new install) or `docker compose up -d --force-recreate` (existing one).
````

**Edit 2.** Find:
```markdown
| Manager | `manager.juniper@demo.example.com` | Juniper Rooftop |
| Manager | `manager.riverside@demo.example.com` | Riverside Convention Center |
| Manager | `regional.manager@demo.example.com` | Harbor House + Copperline |
| Workers | any address ending `@demo.example.com` (Admin → People, or a venue's Team list) | their own shifts |
| Your admins | their normal login | every demo venue, in the venue picker |
```
Replace with:
```markdown
| Manager | `manager.juniper@demo.example.com` | Juniper Rooftop |
| Manager | `manager.riverside@demo.example.com` | Riverside Convention Center |
| Owner | `regional.manager@demo.example.com` | Whitaker Hospitality Group: Harbor House + Copperline, and the Organization page |
| Shift lead | `lead.marlowe@demo.example.com` (also `lead.harbor`, `lead.copperline`, `lead.juniper`, `lead.riverside`) | their own shifts, plus the Lead view for that venue |
| Workers | any address ending `@demo.example.com` (Admin → People, or a venue's Team list) | their own shifts |
| Your admins | their normal login | every demo venue, in the venue picker |
```

---

## F6. `product-roadmap.md` (1 EDIT)

**Edit 1.** Find:
```markdown
- **Export presets:** generic, Gusto, ADP column layouts.

### Phase 36: Self-serve venues & multi-location owners ⚠️
- **Venue sign-up:** a manager creates a venue, and an admin approves or verifies it.
- **Organizations:** one owner has several venues, a combined dashboard and shared team, and moves workers between venues.
- **Roles:** owner, manager, shift lead (can clock people in and out and mark no-shows, no pay access).

### Later / nice to have
```
Replace with:
```markdown
- **Export presets:** generic, Gusto, ADP column layouts.

### Phase 36: Multi-location owners, shift leads & the public board ⚠️ (shipped in 0.36.0)
- ✅ **Organizations:** one owner has several venues, a combined dashboard, and adds or moves workers between the venues' teams. Platform admins set organizations up.
- ✅ **Roles:** owner, manager, shift lead (clocks people in and out, marks no-shows, fixes clock times, messages shifts and fills open spots; no pay access).
- ✅ **Public event board:** with `PUBLIC_EVENT_BOARD=true` the home page lists posted shifts with minimal details; a worker account is needed to see the rest or to book.
- ⏳ **Venue sign-up** (a manager creates a venue, and an admin approves or verifies it): not built yet, on purpose. Next when wanted.

### Later / nice to have
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (1 EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.6",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.36.0",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (1 EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.6"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.36.0"
```

---

## V3. `CHANGELOG.md` (1 EDIT)
The new section goes above `[0.35.6]`.

**Edit 1.** Find:
```markdown
All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.6] - 2026-10-04 - Phase 35.4: Dev and prod stacks on one computer
```
Replace with:
```markdown
All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.36.0] - 2026-10-06 - Phase 36: Organizations, owners, shift leads and the public board

### Added
- **Organizations.** A group of venues with one or more owners. A venue belongs to at most one.
  - Platform admins create them, choose their venues and add owners in **Admin → Organizations**. There is no venue sign-up yet.
  - Tables `organizations` and `organization_members`; column `venues.organization_id`.
- **Owner role.** A manager account that owns an organization manages every venue in it, with every manager screen.
  - New **Organization** page (`/org`): every venue side by side (today and the next seven days), everyone across the venues' teams, and owners and settings.
  - Owners can add a person to another venue's team or move them (positions and staffing company come along where they fit), add co-owners, and rename the organization.
  - Owners get a venue's manager alerts only if they turn on "Send me each venue's manager alerts", or when the venue has no other manager.
  - A venue's Managers list shows owners with an Owner badge; they are removed on the Organization page, not there.
- **Shift lead role.** A manager marks a team member "shift lead" on the Team page (`venue_whitelists.is_lead`).
  - New **Lead** page (`/lead`): the Today board, clock someone in, mark a no-show, fix clock times, message a shift, and fill open spots from the team.
  - A shift lead never sees pay, tips, pay periods, exports, settings or the team list, and can't approve requests or post events. They can't change their own clock times.
  - They stay a worker: they still find, book and work shifts.
- **Public event board.** With `PUBLIC_EVENT_BOARD=true` the home page (`/`) shows every posted, upcoming event to people who aren't signed in, with a **Sign in / Sign up** button in the corner.
  - It shows the event name, date and time, venue name, city, positions and open spots. Never pay, addresses or notes.
  - Tapping an event asks the visitor to sign in or create a worker account, then opens that event with its full details.
  - Each venue can stay off the board and can set the city shown (Venue settings → `public_board`, `city`).
  - With `PUBLIC_EVENT_BOARD=false` (the default) the home page is the sign-in page, as before.
- **"Also send it to everyone booked on this shift"** on the shift chat, for managers and shift leads (notification kind `shift_message`).
- The demo data has one organization (Whitaker Hospitality Group, owned by `regional.manager@demo.example.com`) and one shift lead per venue (`lead.<venue>@demo.example.com`).

### Changed
- `GET /api/venues`, `GET /api/venues/{id}` and `GET /api/venues/{id}/shifts` now need a sign-in. They returned addresses, settings and pay to anyone.
- Marking a no-show, adding, changing or deleting a clock time, the candidate list, assign, offer and withdrawing an offer accept the venue's shift leads as well as its managers.
- Signing out goes to the home page (the public board, or the sign-in page when the board is off).
- Database: new columns `venues.public_board`, `venues.city`, `venue_managers.via_org`, `venue_whitelists.is_lead`.

## [0.35.6] - 2026-10-04 - Phase 35.4: Dev and prod stacks on one computer
```

---

## V4. `README.md` (4 EDITS)

**Edit 1.** Find:
```markdown
Access is enforced on the server by dependencies in `backend/src/auth.py` (`get_current_user`, `require_role(...)` and its shortcuts `require_admin`, `require_manager_or_admin`, `require_worker`, plus `verify_venue_access`. Admins pass every role check). In the browser, `<ProtectedRoute allowedRoles={[...]}>` does the same. Emails listed in `ALWAYS_ADMIN_EMAILS` are always promoted to admin, so you can't get locked out.

---

## 3. What it does
```
Replace with:
```markdown
Access is enforced on the server by dependencies in `backend/src/auth.py` (`get_current_user`, `require_role(...)` and its shortcuts `require_admin`, `require_manager_or_admin`, `require_worker`, plus `verify_venue_access`. Admins pass every role check). In the browser, `<ProtectedRoute allowedRoles={[...]}>` does the same. Emails listed in `ALWAYS_ADMIN_EMAILS` are always promoted to admin, so you can't get locked out.

**Two more roles sit on top of those three (since 0.36.0).** They are not values of `users.role`:

| Role | What it is in the data | Home page | What they do |
| :--- | :--- | :--- | :--- |
| **Owner** | A manager account with a row in `organization_members` (role `owner`). | `/org` (and `/venue`) | Manages **every venue in their organization**, exactly as a manager would, and gets the Organization page: every venue side by side, everyone across the venues' teams (add a person to another venue, or move them), and the list of owners. |
| **Shift lead** | A worker account whose team row at a venue has `is_lead = TRUE`. | `/lead` (and `/worker`) | Runs the floor at that venue: the Today board, clocking people in and out, no-shows, fixing clock times, the shift chat (with "send to everyone booked"), and filling open spots from the team. **Never sees pay**, tips, pay periods, exports, settings or the team list, and can't approve requests or post events. Still books and works shifts like any worker. |

* An **organization** (`organizations`) is a group of venues. A venue belongs to at most one (`venues.organization_id`). There is no venue sign-up yet: platform admins create organizations, choose their venues and name the first owner in **Admin → Organizations**. Owners can add co-owners.
* Owners manage their venues through ordinary `venue_managers` rows marked `via_org`. `services/organizations.sync_managers()` is the only code that creates or deletes those rows, so every existing manager check covers owners with no change.
* "May this person run the floor here?" is `services/access.floor_access()` (manager or shift lead). What a lead reads comes from `routers/lead.py`, whose response models have no pay fields.

---

## 3. What it does
```

**Edit 2.** Find:
```markdown
* Mock Firebase mode (`USE_MOCK_FIREBASE=true`) for local testing without Google.
* Invites: managers invite people by email, link or QR code. Joining through an invite adds them to the venue team.

### For workers
```
Replace with:
```markdown
* Mock Firebase mode (`USE_MOCK_FIREBASE=true`) for local testing without Google.
* Invites: managers invite people by email, link or QR code. Joining through an invite adds them to the venue team.

### Home page and the public board
* **`PUBLIC_EVENT_BOARD=false` (the default):** the home page (`/`) sends people who aren't signed in to the sign-in page.
* **`PUBLIC_EVENT_BOARD=true`:** the home page is a **public board** of every posted, upcoming event, with a **Sign in / Sign up** button in the corner.
  * It shows only: event name, date and time, venue name, city, positions and open spots (`GET /api/public/board`, no sign-in needed).
  * It never shows pay, the street address, map pin, location name, notes, requirements or venue ids. Those need a worker account.
  * Tapping an event asks the visitor to sign in or create a worker account, then opens that same event with its full details.
  * A venue can keep its shifts off the board, and can type the city that is shown (Venue settings). With no city typed, it is worked out from the address; if that isn't clear, no city is shown.
  * Drafts, cancelled and past events are never listed. Full events are listed as "Full".
* Signed-in people never see the board: `/` takes them to their own home page, as before.
* Apart from signing in, invites and the board, **every API endpoint needs a sign-in** (since 0.36.0 that includes `GET /api/venues`, `GET /api/venues/{id}` and `GET /api/venues/{id}/shifts`).

### For workers
```

**Edit 3.** Find:
```markdown
  schemas.py         Pydantic request / response models
  routers/           one file per area (auth, venues, events, shifts, listings, transfers, cover, team, ...)
  services/          the logic (booking, auto_confirm, clock, cover, waitlist, reliability, notify*, ...)
frontend/src/
  pages/             WorkerDashboard, VenueManagerDashboard, AdminPanel, EarningsPage, ProfilePage, ...
  components/        shared UI; admin/, manager/, worker/, profile/ sub-folders
  context/AuthContext.jsx, api/client.js   (locked: change only when asked)
  utils/             formatting, time zones, errors, push, version
```
Replace with:
```markdown
  schemas.py         Pydantic request / response models
  routers/           one file per area (auth, venues, events, shifts, listings, transfers, cover, team, ...)
                     public.py = no sign-in (config + public board) · organizations.py = owners · lead.py = shift leads
  services/          the logic (booking, auto_confirm, clock, cover, waitlist, reliability, notify*, ...)
                     access.py = manager / shift-lead checks · organizations.py = owners' venue rows · public_board.py
frontend/src/
  pages/             WorkerDashboard, VenueManagerDashboard, AdminPanel, EarningsPage, ProfilePage, ...
                     PublicBoardPage (home page when the board is on), LeadPage (/lead), OrganizationPage (/org)
  components/        shared UI; admin/, manager/, worker/, profile/, lead/, org/ sub-folders
  context/AuthContext.jsx, api/client.js   (locked: change only when asked)
  utils/             formatting, time zones, errors, push, version
```

**Edit 4.** Find:
```markdown
| Database / Redis | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` |
| Sign-in | `SECRET_KEY` (signs every login; must be set; in `stack.env`), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `ALWAYS_ADMIN_EMAILS`, `ALLOW_SELF_REGISTRATION`, `SHOW_DEMO_LOGINS`, `SEED_DEMO_ACCOUNTS` (`false` = clean install, no starter demo accounts) |
| Firebase | `USE_MOCK_FIREBASE`, `FIREBASE_CREDENTIALS_PATH` (`.secrets/firebase_service_account.json`), `FIREBASE_WEB_CONFIG_PATH` (`.secrets/firebase-web-config.js`), `FIREBASE_AUTH_PROVIDERS`, `FIREBASE_VAPID_KEY` (push through FCM) |
| Links | `APP_BASE_URL`: the public address used in emails, texts and invites |
```
Replace with:
```markdown
| Database / Redis | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` |
| Sign-in | `SECRET_KEY` (signs every login; must be set; in `stack.env`), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `ALWAYS_ADMIN_EMAILS`, `ALLOW_SELF_REGISTRATION`, `SHOW_DEMO_LOGINS`, `SEED_DEMO_ACCOUNTS` (`false` = clean install, no starter demo accounts) |
| Home page | `PUBLIC_EVENT_BOARD` (`true` = the home page is the public board of posted shifts; `false` = the sign-in page) |
| Firebase | `USE_MOCK_FIREBASE`, `FIREBASE_CREDENTIALS_PATH` (`.secrets/firebase_service_account.json`), `FIREBASE_WEB_CONFIG_PATH` (`.secrets/firebase-web-config.js`), `FIREBASE_AUTH_PROVIDERS`, `FIREBASE_VAPID_KEY` (push through FCM) |
| Links | `APP_BASE_URL`: the public address used in emails, texts and invites |
```

---

# PART R: For Andrew: rebuild and try it (AGY: don't run any of this)

## 1. The database (schema change ⚠️)

Two new tables and five new columns. Do this **in each stack's folder** (dev, and prod if it gets this version). Pick ONE:

**Option 1: keep your data (recommended; your partners are testing).** Run once. It's safe to run twice.
```bash
docker compose exec -T database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
-- Phase 36 (0.36.0): keep your data. Safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'owner',
    venue_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id)
);

-- If the backend restarted before you ran this, it already made the two tables above, but
-- without the database defaults. These lines add them (and change nothing otherwise).
ALTER TABLE organizations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE organizations ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE organizations ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE organization_members ALTER COLUMN role SET DEFAULT 'owner';
ALTER TABLE organization_members ALTER COLUMN venue_alerts SET DEFAULT FALSE;
ALTER TABLE organization_members ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS ix_organization_members_user_id ON organization_members(user_id);

ALTER TABLE venues ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS public_board BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS city VARCHAR(120);
CREATE INDEX IF NOT EXISTS ix_venues_organization_id ON venues(organization_id);

ALTER TABLE venue_managers ADD COLUMN IF NOT EXISTS via_org BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
SQL
docker compose up -d --build --force-recreate
```
* `POSTGRES_USER` / `POSTGRES_DB` are the database container's own settings, so this works whatever you named them.
* In PowerShell, save the lines between `<<'SQL'` and `SQL` as `phase36.sql` and run: `Get-Content phase36.sql | docker compose exec -T database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`
* The backend reloads as soon as the code lands, before you run the SQL. Until the SQL has run, pages that load venues or teams show errors. That's expected: nothing is lost, and the last command above restarts everything cleanly.
* Existing venues get the defaults: listed on the public board (which stays off until you turn it on), no city typed, no organization. Nobody becomes a shift lead or an owner.

**Option 2: fresh database (wipes ALL data in that stack):**
```bash
docker compose down -v
docker compose up -d --build
```

## 2. The public board

It's off until you set this in that stack's `.env`:
```
PUBLIC_EVENT_BOARD=true
```
then `docker compose up -d --force-recreate` (settings only; your data is kept).

* On: the home page shows posted shifts to people who aren't signed in. Off: the home page is the sign-in page.
* A venue can stay off the board, or set its city, in **Settings → Details → List our shifts on the public board**.
* If you use a real public address, anyone who has it can read event names, times, venue names, cities and open spots. Nothing else.

## 3. Organizations, owners and shift leads

* **Organization:** Admin → **Organizations** → type a name → *Create organization* → *Manage*: add its venues, then add an owner by email.
  * An existing manager account is linked. An email with no account gets a new manager account and a temporary password, shown once.
  * A worker account can't be an owner. Change it to a manager in Admin → People first.
* **Owner:** signs in as usual and finds **Organization** in the menu.
* **Shift lead:** a manager opens **Team**, opens the person, and taps **Make shift lead**. The person finds **Lead** in their menu (and a banner on their page).
* With the demo data (`bash deploy_test_data.sh reset`, password `Demo12345!`): owner `regional.manager@demo.example.com`; shift leads `lead.harbor@demo.example.com`, `lead.marlowe@…`, `lead.copperline@…`, `lead.juniper@…`, `lead.riverside@…`. `reset` deletes what testers did inside the demo venues.

### Checklist
1. Admin → System: *Web app 0.36.0 · Server 0.36.0*.
2. Sign out. With `PUBLIC_EVENT_BOARD` not set, the home page is the sign-in page, as before.
3. Set `PUBLIC_EVENT_BOARD=true` and recreate. Signed out, the home page lists posted shifts with a **Sign in / Sign up** button top-right. No pay and no addresses anywhere.
4. Tap a shift → *I have an account* → sign in as a worker: that shift opens with its pay and details.
5. In a private window, open `https://<your address>/api/venues`: it answers *Please sign in again.* (it used to list every venue).
6. As a manager: **Settings → Details** has the *List our shifts on the public board* card. Untick it, save, and that venue's shifts leave the board within a few seconds.
7. As a manager: **Team** → a person → **Make shift lead**. Sign in as that person: **Lead** is in the menu. The Today board shows who's on; *Clock times* shows hours and no pay; the shift chat has *Also send it to everyone booked on this shift*.
8. As that shift lead, open `/venue`: *This page isn't for your account.*
9. As admin: **Admin → Organizations**: create one, add two venues and an owner. Sign in as the owner: **Organization** shows both venues side by side, **People** lists both teams, and *Add to a venue* puts someone on the other team.
10. As a manager of one of those venues: **Team → Managers** shows the owner with an **Owner** badge and no Remove button.

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.36.0. Apply it as written and don't bump again.)