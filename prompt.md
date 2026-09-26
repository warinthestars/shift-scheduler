# Phase 29: Team, Invites, Direct Assign & Ratings

**Why:** a venue can't bring its staff in today. There's no invite link or import, and only admins create accounts. There's no Team page, and managers can't put a specific person on a shift. Every unrated worker shows a fake ★ 5.0. These were blockers #2 and #4 in the venue-readiness review.

## What this phase adds

1. **Team page:** a new **Team** button on the venue dashboard opens a large modal with three tabs.
   - **Team tab**
     - Lists everyone on the team list plus everyone who has worked there.
     - Filters: On team / Removed / Blocked / Everyone. Search by name, email, phone or position.
     - Each person shows:
       - contact details
       - **positions they work here** (tags)
       - a **private manager note**
       - shifts worked here, last worked, and upcoming bookings
       - rating ("New" until rated), this venue's own rating, and "would book again" x/y
       - reliability
     - Actions: **Edit** (positions and note), **Remove**, **Block**, **Add back**, **Unblock**.
       - **Remove:** off the team (no instant-booking perk or new-shift alerts, no hand-off candidacy), even if they worked there before. They can still request open shifts.
       - **Block:** also can't see, request, be offered or be assigned the venue's shifts. Their waiting requests are declined and open offers withdrawn. Existing bookings stay, and the manager is told how many.
     - **Add people:**
       - *Create an account for them:* makes a worker account with a 12-character temporary password, **shown once**. If the email already has a worker account, they're just added.
       - *They already have an account:* add by email.
   - **Invite tab**
     - **Team link + QR code**
       - One per venue, valid 30 days. It shows **Copy**, **Download QR** (SVG), a use count and **New link** (the old link stops working).
       - Anyone with the link can join.
     - **Invite someone:** name, email and/or mobile, and positions. They get a personal link by email, and by text if SMS is set up. It's valid 14 days and works once.
     - **Import a CSV:** columns name (or first_name/last_name), email, phone, positions (separated with `;`). Up to 200 rows. It previews, then sends, then shows per-row results:
       - invited
       - already on your team
       - already invited
       - invalid, with the reason
     - **Sent invites:** status (Pending / Joined / Expired / Revoked), with Copy link, Resend (extends 14 days) and Turn off.
   - **Managers tab**
     - Lists the venue's managers.
     - **Add a co-manager:**
       - An existing manager account is linked.
       - A new email gets a manager account with a temporary password, shown once.
       - Worker emails are refused (an admin changes roles).
     - Remove a co-manager: you can't remove yourself or the last manager.
2. **Join page `/join/<token>`** (public), for the team link, QR code or personal invite.
   - It shows the venue with **Create my account** or **I already have an account**. The login page opens in the right mode with a "to join the <venue> team" banner, then returns to the join page.
   - Signed in as a worker, it **joins automatically**.
   - Invalid, expired or turned-off links explain why. Manager and admin accounts are told to sign out.
   - If the sign-up detour loses the page (e.g. email verification), the Worker dashboard sends them back to finish joining.
3. **Direct assign and offers.** In the event roster, each open position gets an **Assign / Offer** button.
   - It lists the team first, sorted by:
     1. requested this
     2. available
     3. has this position tag
     4. worked here most
   - Search finds anyone by name or email (flagged "Not on team").
   - Unavailable people show why: booked at that time, booked on another position in this event, or dropped this shift earlier. Blocked people never appear.
   - **Assign:** books them now.
     - A waiting request on this position is approved, not duplicated.
     - A waiting request on another position in the same event is withdrawn.
     - The worker is notified ("You're booked", urgent within 48 h).
   - **Offer:** 1–5 people plus an optional message.
     - The worker sees **"Offered to you"** at the top of their dashboard, with Accept or Decline.
     - The **first to accept is booked**. The others' offers close ("Someone else took it").
     - Managers are notified on acceptance, or when everyone declines.
     - The roster shows offers with status, and pending ones can be withdrawn.
   - Both use the same row locks as worker requests, so nothing overbooks.
4. **Ratings:**
   - Once an event has ended, each person who worked shows **1–5 stars + "Would book again? Yes/No"** in the roster (Past tab). It can be changed or removed.
   - `users.aggregate_rating` and `rating_count` are recalculated from real ratings.
   - **"New"** replaces the fake ★ 5.0 wherever a worker has no ratings: navbar, worker header, roster, approval queue, hand-off picker, old roster, admin users.
   - Written notes stay private to the venue.
5. **Notifications (Phase 28 system):**
   - `assigned`: SMS if urgent
   - `shift_offered`: SMS if urgent
   - `offer_update`: manager
   - `team_joined`: manager, links to `/venue?team=1`, which opens the Team page
6. **Admin fix:** editing a worker's venues in the Admin panel no longer wipes team notes, positions or blocks.

⚠️ **Schema change** (3 altered tables, 2 new tables) and **one new Python package** (`segno`, pure-Python QR codes): see §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`
  - `main.py` CORS logic (only add the three import and `include_router` lines shown)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* **No new npm packages.** The QR code is made on the server (SVG) because the frontend container's `node_modules` volume wouldn't pick up a new npm package on rebuild.
* No native PostgreSQL ENUMs. New status columns are VARCHAR:
  - `venue_whitelists.status`: `active` | `removed` | `blocked`
  - `venue_whitelists.source`: `manager` | `invite` | `import` | `admin`
  - `venue_invites.kind`: `link` | `personal`
  - `shift_offers.status`: `pending` | `accepted` | `declined` | `filled` | `cancelled`
  - `shift_requests.approval_source` gains `manager_assign` and `offer`
* `venue_whitelists.is_active` stays and is kept in sync (`TRUE` only when `status = 'active'`). Every write in this phase sets both.
* Aware UTC datetimes only. Never `UserResponse.model_validate(<ORM User>)`.
* Notifications are always sent **after** the commit via `notify_events.*` (own session, never raises). Don't move them into the transactions.
* **NEW FILE**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current (Phase 28) files and checked:
  - after applying them, the backend imports cleanly and all 110 API routes build
  - the frontend bundles with no missing imports
  - 96 integration checks pass against PostgreSQL 16
  - a browser run passes the main flows: team page, invite link, CSV import, co-managers, offer → accept, and sign up through a team link

  Don't "improve" them.

---

# PART A: Database, models, schemas, packages

## A1. `database/init.sql` (EDITS)
`venue_whitelists` gets status / positions / source / added_by; `ratings` gets would_book_again / updated_at; two new tables appended at the end.

**Edit 1.** Find:
```sql
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes TEXT,                                            -- Phase 29: private manager notes
    is_active BOOLEAN NOT NULL DEFAULT TRUE,               -- kept in sync: TRUE only when status = 'active'
    status VARCHAR(20) NOT NULL DEFAULT 'active',          -- Phase 29: active | removed | blocked
    positions TEXT[] NOT NULL DEFAULT '{}',                -- Phase 29: positions this person works here
    source VARCHAR(20) NOT NULL DEFAULT 'manager',         -- Phase 29: manager | invite | import | admin
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 2.** Find:
```sql
    rated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ratings_worker ON ratings(worker_id);

-- ------------------------------------------------------------------------------
```
Replace with:
```sql
    rated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,                                           -- private to the venue's managers
    would_book_again BOOLEAN,                              -- Phase 29
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ratings_worker ON ratings(worker_id);
CREATE INDEX idx_ratings_venue ON ratings(venue_id);

-- ------------------------------------------------------------------------------
```

**Edit 3.** Find:
```sql
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

```
Replace with:
```sql
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Phase 29: Team invites (link / QR / personal) and direct shift offers
-- ==============================================================================
CREATE TABLE venue_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL DEFAULT 'personal',          -- link (shareable / QR) | personal (one person)
    email VARCHAR(255),
    phone VARCHAR(30),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    positions TEXT[] NOT NULL DEFAULT '{}',
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    uses INT NOT NULL DEFAULT 0,
    accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_venue_invites_venue ON venue_invites(venue_id, kind);

CREATE TABLE shift_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL,                                -- offers sent together; first to accept wins
    offered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',         -- pending | accepted | declined | filled | cancelled
    message TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_shift_offers_worker ON shift_offers(worker_id, status);
CREATE INDEX idx_shift_offers_shift ON shift_offers(shift_id, status);
```

---

## A2. `backend/src/models.py` (EDITS)
Note the `foreign_keys=` on the two whitelist relationships: required now that `venue_whitelists` has a second FK to `users` (`added_by_user_id`). Without it every request fails with "multiple foreign key paths".

**Edit 1.** Find:
```python
    shift_requests = relationship("ShiftRequest", back_populates="worker", foreign_keys="ShiftRequest.worker_id")
    ratings_received = relationship("Rating", back_populates="worker", foreign_keys="Rating.worker_id")
    whitelist_entries = relationship("VenueWhitelist", back_populates="worker", cascade="all, delete-orphan")

class Venue(Base):
```
Replace with:
```python
    shift_requests = relationship("ShiftRequest", back_populates="worker", foreign_keys="ShiftRequest.worker_id")
    ratings_received = relationship("Rating", back_populates="worker", foreign_keys="Rating.worker_id")
    whitelist_entries = relationship("VenueWhitelist", back_populates="worker", cascade="all, delete-orphan", foreign_keys="VenueWhitelist.worker_id")

class Venue(Base):
```

**Edit 2.** Find:
```python
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("venue_id", "worker_id", name="uq_venue_whitelist"),)

    venue = relationship("Venue", back_populates="whitelists")
    worker = relationship("User", back_populates="whitelist_entries")

class VenuePosition(Base):
```
Replace with:
```python
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    notes = Column(Text, nullable=True)                                      # Phase 29: private manager notes
    is_active = Column(Boolean, nullable=False, default=True)                # TRUE only when status == 'active'
    status = Column(String(20), nullable=False, default="active")            # Phase 29: active | removed | blocked
    positions = Column(ARRAY(String), nullable=False, default=list)          # Phase 29
    source = Column(String(20), nullable=False, default="manager")           # Phase 29: manager | invite | import | admin
    added_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("venue_id", "worker_id", name="uq_venue_whitelist"),)

    venue = relationship("Venue", back_populates="whitelists")
    worker = relationship("User", back_populates="whitelist_entries", foreign_keys=[worker_id])

class VenuePosition(Base):
```

**Edit 3.** Find:
```python
    rating = Column(Integer, CheckConstraint("rating >= 1 AND rating <= 5"), nullable=False)
    review = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    shift_request = relationship("ShiftRequest", back_populates="rating")
```
Replace with:
```python
    rating = Column(Integer, CheckConstraint("rating >= 1 AND rating <= 5"), nullable=False)
    review = Column(Text, nullable=True)
    would_book_again = Column(Boolean, nullable=True)                        # Phase 29
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shift_request = relationship("ShiftRequest", back_populates="rating")
```

**Edit 4.** Find:
```python
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"
```
Replace with:
```python
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class VenueInvite(Base):
    """Phase 29: an invite to join a venue's team. kind 'link' = the shareable link / QR code; 'personal' = one person."""
    __tablename__ = "venue_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(64), nullable=False, unique=True)
    kind = Column(String(20), nullable=False, default="personal")          # link | personal
    email = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    positions = Column(ARRAY(String), nullable=False, default=list)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    uses = Column(Integer, nullable=False, default=0)
    accepted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftOffer(Base):
    """Phase 29: a manager offers a position to 1-5 people; the first to accept is booked."""
    __tablename__ = "shift_offers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), nullable=False)
    offered_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="pending")          # pending | accepted | declined | filled | cancelled
    message = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    responded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"
```

---

## A3. `backend/src/schemas.py` (EDITS)
`PositionOffer` is inserted before `RosterPerson` (it is used by `EventPosition`). The Phase 29 schemas are appended at the end.

**Edit 1.** Find:
```python
    role: str
    aggregate_rating: float

    class Config:
```
Replace with:
```python
    role: str
    aggregate_rating: float
    rating_count: int = 0                    # Phase 29: 0 = "New" (no real ratings yet)

    class Config:
```

**Edit 2.** Find:
```python
    bio: Optional[str] = None
    aggregate_rating: Optional[float] = 5.0

    class Config:
```
Replace with:
```python
    bio: Optional[str] = None
    aggregate_rating: Optional[float] = 5.0
    rating_count: int = 0                    # Phase 29

    class Config:
```

**Edit 3.** Find:
```python
# Phase 23: Posted Shifts board (event-grouped roster)
# ------------------------------------------------------------------------------
class RosterPerson(BaseModel):
    request_id: UUID
```
Replace with:
```python
# Phase 23: Posted Shifts board (event-grouped roster)
# ------------------------------------------------------------------------------
class PositionOffer(BaseModel):
    """Phase 29: an offer sent for this position (shown on the manager's roster)."""
    offer_id: UUID
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    status: str                              # pending | accepted | declined | filled | cancelled
    created_at: datetime
    responded_at: Optional[datetime] = None


class RosterPerson(BaseModel):
    request_id: UUID
```

**Edit 4.** Find:
```python
    note: Optional[str] = None          # Phase 26.1: worker's note with their request
    info_seen: Optional[bool] = None    # Phase 26.2: booked person has read the latest shift info (None = nothing to read)


```
Replace with:
```python
    note: Optional[str] = None          # Phase 26.1: worker's note with their request
    info_seen: Optional[bool] = None    # Phase 26.2: booked person has read the latest shift info (None = nothing to read)
    rating_count: int = 0               # Phase 29: 0 = "New"
    my_rating: Optional[int] = None     # Phase 29: this venue's rating for THIS shift (1-5)
    would_book_again: Optional[bool] = None
    rating_review: Optional[str] = None
    approval_source: Optional[str] = None   # Phase 29: e.g. manager_assign, offer


```

**Edit 5.** Find:
```python
    assigned: List[RosterPerson] = []
    requested: List[RosterPerson] = []


```
Replace with:
```python
    assigned: List[RosterPerson] = []
    requested: List[RosterPerson] = []
    offers: List[PositionOffer] = []         # Phase 29: pending + recently answered offers


```

**Edit 6.** Find:
```python
    timezone: Optional[str] = None
    phone: Optional[str] = None              # saved to users.phone; "" clears it
```
Replace with:
```python
    timezone: Optional[str] = None
    phone: Optional[str] = None              # saved to users.phone; "" clears it


# ------------------------------------------------------------------------------
# Phase 29: Team, invites, direct assign / offers, ratings
# ------------------------------------------------------------------------------
class TeamMember(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str = "active"                   # active | removed | blocked
    on_list: bool = False                    # has a team-list row (added / invited), not just "worked here"
    source: Optional[str] = None             # manager | invite | import | admin | worked
    positions: List[str] = []
    notes: Optional[str] = None              # private to this venue's managers
    shifts_worked: int = 0                   # finished shifts at this venue
    upcoming: int = 0                        # booked, not finished yet, at this venue
    last_worked: Optional[datetime] = None
    aggregate_rating: float = 5.0            # across all venues
    rating_count: int = 0                    # 0 = "New"
    venue_rating: Optional[float] = None     # average of THIS venue's ratings
    venue_rating_count: int = 0
    would_book_again_yes: int = 0
    would_book_again_no: int = 0
    reliability: Optional[WorkerReliability] = None
    added_at: Optional[datetime] = None


class TeamMemberUpdate(BaseModel):
    status: Optional[str] = None             # active | removed | blocked
    positions: Optional[List[str]] = None
    notes: Optional[str] = None


class TeamMemberUpdateResult(BaseModel):
    member: TeamMember
    message: str
    booked_upcoming: int = 0                 # blocking doesn't remove existing bookings; this says how many remain


class TeamAddExisting(BaseModel):
    email: str
    positions: List[str] = []


class TeamCreateWorker(BaseModel):
    first_name: str
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    positions: List[str] = []


class AccountCreateResult(BaseModel):
    user_id: UUID
    created: bool                            # False = existing account was linked instead
    temporary_password: Optional[str] = None # shown once
    message: str


class VenueManagerItem(BaseModel):
    user_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    is_primary: bool = False
    is_you: bool = False


class ManagerCreate(BaseModel):
    email: str
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None


class InviteLinkResponse(BaseModel):
    id: UUID
    token: str
    url: str
    expires_at: datetime
    uses: int = 0
    qr_svg: str                              # SVG markup of the QR code for `url`


class InviteRow(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    positions: List[str] = []


class InviteBatchCreate(BaseModel):
    rows: List[InviteRow]
    send: bool = True                        # email / text the invite now
    source: str = "manual"                   # manual | import


class InviteRowResult(BaseModel):
    row: int                                 # 1-based, as uploaded
    name: str = ""
    email: Optional[str] = None
    result: str                              # invited | already_member | already_invited | invalid
    message: str = ""
    invite_id: Optional[UUID] = None
    url: Optional[str] = None


class InviteBatchResult(BaseModel):
    results: List[InviteRowResult]
    invited: int = 0
    skipped: int = 0
    emailed: int = 0
    texted: int = 0
    email_available: bool = False


class PersonalInvite(BaseModel):
    id: UUID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    positions: List[str] = []
    status: str                              # pending | accepted | expired | revoked
    url: str
    created_at: datetime
    expires_at: datetime
    last_sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    accepted_by_name: Optional[str] = None


class PublicInvite(BaseModel):
    valid: bool
    reason: Optional[str] = None             # why it can't be used (expired / revoked / used)
    venue_id: Optional[UUID] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    logo_url: Optional[str] = None
    kind: Optional[str] = None
    first_name: Optional[str] = None
    email: Optional[str] = None
    positions: List[str] = []
    expires_at: Optional[datetime] = None


class InviteAcceptResult(BaseModel):
    venue_id: UUID
    venue_name: str
    already_member: bool = False


class AssignCandidate(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    aggregate_rating: float = 5.0
    rating_count: int = 0
    reliability_score: Optional[float] = None
    on_team: bool = True
    positions: List[str] = []
    position_match: bool = False             # their team positions include this position
    available: bool = True                   # can be assigned / offered right now
    reason: Optional[str] = None             # why not (overlap, already booked in this event, ...)
    requested_this: bool = False             # has a waiting request on this position (assign = approve it)
    offered: bool = False                    # has a pending offer for this position
    venue_shifts: int = 0


class AssignRequest(BaseModel):
    worker_id: UUID


class AssignResult(BaseModel):
    request_id: UUID
    message: str


class OfferCreate(BaseModel):
    worker_ids: List[UUID]                   # 1-5 people
    message: Optional[str] = None


class OfferSkip(BaseModel):
    worker_id: UUID
    name: str = ""
    reason: str


class OfferCreateResult(BaseModel):
    batch_id: Optional[UUID] = None
    offered: int = 0
    skipped: List[OfferSkip] = []
    message: str = ""


class WorkerOffer(BaseModel):
    offer_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    venue_id: UUID
    venue_name: str
    venue_timezone: Optional[str] = None
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    hourly_rate: Optional[float] = None      # None when hidden
    hourly_rate_max: Optional[float] = None
    tips_eligible: bool = False
    tip_pool: bool = False
    location_name: Optional[str] = None
    address: Optional[str] = None
    message: Optional[str] = None
    offered_by: Optional[str] = None
    others_offered: int = 0                  # other people offered the same spot (first to accept wins)
    created_at: datetime
    expires_at: datetime


class OfferAcceptResult(BaseModel):
    request_id: UUID
    message: str


class RatingInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    would_book_again: Optional[bool] = None
    review: Optional[str] = None


class RatingResponse(BaseModel):
    request_id: UUID
    worker_id: UUID
    rating: Optional[int] = None             # None after delete
    would_book_again: Optional[bool] = None
    review: Optional[str] = None
    aggregate_rating: float
    rating_count: int
```

---

## A4. `backend/requirements.txt` (EDIT)

**Edit 1.** Find:
```text
requests>=2.31.0
tzdata>=2024.1
```
Replace with:
```text
requests>=2.31.0
tzdata>=2024.1
segno>=1.6.0
```

---

# PART B: Backend

## B1. `backend/src/services/team.py` (EDITS)
Team = active list row, OR worked there without a removed/blocked row. New helpers: `is_blocked`, `blocked_venue_ids`, `set_membership`.

**Edit 1.** Find:
```python
Team = active workers who are on the venue whitelist OR have worked/been booked there before.
All subqueries use an aliased Shift table so correlation is unambiguous.
"""
from typing import List
from uuid import UUID

from sqlalchemy import select, func, or_, exists
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
```
Replace with:
```python
Team = active workers who are on the venue whitelist OR have worked/been booked there before.
All subqueries use an aliased Shift table so correlation is unambiguous.

Phase 29: a team-list row now has a status (active | removed | blocked).
* 'active'  row -> on the team.
* 'removed' / 'blocked' row -> NOT on the team, even if they worked here before.
* 'blocked' also stops them requesting, being offered or assigned this venue's shifts.
"""
from typing import List
from uuid import UUID

from sqlalchemy import select, func, or_, and_, exists
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
```

**Edit 2.** Find:
```python
ACTIVE_BOOKING_STATUSES = ("approved", "confirmed", "checked_in")
ACTIVE_REQUEST_STATUSES = ("pending", "pending_manager_approval", "approved", "confirmed", "checked_in")


```
Replace with:
```python
ACTIVE_BOOKING_STATUSES = ("approved", "confirmed", "checked_in")
ACTIVE_REQUEST_STATUSES = ("pending", "pending_manager_approval", "approved", "confirmed", "checked_in")


TEAM_STATUSES = ("active", "removed", "blocked")
EXCLUDED_STATUSES = ("removed", "blocked")


```

**Edit 3.** Find:
```python
        .exists()
    )
    worked_there = (
        select(ShiftRequest.id)
```
Replace with:
```python
        .exists()
    )
    excluded = (
        select(VenueWhitelist.id)
        .where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == User.id,
            VenueWhitelist.status.in_(EXCLUDED_STATUSES),
        )
        .exists()
    )
    worked_there = (
        select(ShiftRequest.id)
```

**Edit 4.** Find:
```python
        .exists()
    )
    return or_(on_whitelist, worked_there)


async def get_venue_team(db: AsyncSession, venue_id: UUID, exclude_user_id: UUID = None) -> List[User]:
```
Replace with:
```python
        .exists()
    )
    return or_(on_whitelist, and_(worked_there, ~excluded))


async def is_blocked(db: AsyncSession, venue_id: UUID, worker_id: UUID) -> bool:
    """Phase 29: the venue blocked this person (no requests, offers or assignments)."""
    return bool(await db.scalar(
        select(VenueWhitelist.id).where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == worker_id,
            VenueWhitelist.status == "blocked",
        )
    ))


async def blocked_venue_ids(db: AsyncSession, worker_id: UUID) -> set:
    """Phase 29: venues that blocked this worker."""
    return set((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == worker_id,
            VenueWhitelist.status == "blocked",
        )
    )).scalars().all())


async def set_membership(
    db: AsyncSession,
    venue_id: UUID,
    worker_id: UUID,
    *,
    status: str = "active",
    source: str = "manager",
    positions: List[str] = None,
    added_by: UUID = None,
    merge_positions: bool = True,
) -> VenueWhitelist:
    """
    Phase 29: create or update this person's team-list row. Does NOT commit.
    positions: merged into the existing list (merge_positions=True) or replace it.
    """
    row = await db.scalar(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == worker_id)
    )
    clean = [p.strip()[:100] for p in (positions or []) if p and p.strip()]
    if row is None:
        row = VenueWhitelist(
            venue_id=venue_id, worker_id=worker_id, status=status, is_active=(status == "active"),
            source=source, positions=clean, added_by_user_id=added_by,
        )
        db.add(row)
    else:
        row.status = status
        row.is_active = status == "active"
        if positions is not None:
            if merge_positions:
                row.positions = list(dict.fromkeys(list(row.positions or []) + clean))
            else:
                row.positions = clean
    await db.flush()
    return row

async def get_venue_team(db: AsyncSession, venue_id: UUID, exclude_user_id: UUID = None) -> List[User]:
```

---

## B2. NEW FILE `backend/src/services/staffing.py`
Assign, offers (first to accept wins), candidates, the worker's open offers. Uses the Phase 26.1 row locks from `booking.py`.

```python
"""
Phase 29: Managers put specific people on a position.

* assign_worker(): "Assign to..." books one person directly (manager decision, no request needed).
* create_offers(): "Offer to..." sends the position to 1-5 people. The FIRST to accept is booked;
  the others' offers become 'filled' once the position is full.
* accept_offer() / decline_offer(): the worker's side.
* list_candidates(): who can be assigned / offered, with the reason when someone can't.

Booking uses the same row locks as request_position() (event, then position), so an assign,
an offer acceptance and a worker's own request can never overbook a position.
"""
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftOffer, User, Venue, VenueWhitelist,
)
from src.schemas import AssignCandidate, OfferCreateResult, OfferSkip, WorkerOffer
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
from src.services.reliability import compute_reliability
from src.services.locations import load_locations
from src.auth import normalize_role

logger = logging.getLogger("shiftboard.staffing")

MAX_OFFER_PEOPLE = 5
REASSIGNABLE_STATUSES = ("withdrawn", "rejected", "cancelled", "removed")
HISTORY_MESSAGES = {
    "dropped": "dropped this shift earlier",
    "no_show": "was marked a no-show on this shift",
    "transferred": "handed this shift off earlier",
    "completed": "already completed this shift",
}
FINISHED_STATUSES = ("approved", "confirmed", "checked_in", "completed")


def full_name(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or (u.email or "Someone")


async def _book_locked(
    db: AsyncSession,
    shift: Shift,
    worker: User,
    *,
    source: str,
    approved_by: Optional[UUID],
    who: str,
) -> ShiftRequest:
    """
    Books `worker` on the (already locked) `shift`. Does NOT commit.
    `who` words the error messages: "you" for the worker's own action, the person's name for a manager.
    """
    now = datetime.now(timezone.utc)
    you = who == "you"
    if normalize_role(worker.role) != "worker" or not worker.is_active:
        raise HTTPException(status_code=400, detail="Only active worker accounts can be booked on shifts.")
    if shift.event_id:
        event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
        if event is not None and event.cancelled_at is not None:
            raise HTTPException(status_code=400, detail="This event was cancelled.")
    if (shift.status or "").upper() == "CANCELLED":
        raise HTTPException(status_code=400, detail="This position was cancelled.")
    if as_utc(shift.end_time) <= now:
        raise HTTPException(status_code=400, detail="This shift is already over.")
    if await is_blocked(db, shift.venue_id, worker.id):
        raise HTTPException(
            status_code=400,
            detail="This venue isn't booking you right now." if you else f"{who} is blocked at this venue. Unblock them on the Team page first.",
        )
    if (shift.spots_filled or 0) >= (shift.capacity or 1) or (shift.status or "").upper() != "OPEN":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This position is already full.")

    # One active request per worker per event
    same_event_q = (
        select(ShiftRequest, Shift.role_type)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker.id, func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
    )
    same_event_q = same_event_q.where(Shift.event_id == shift.event_id) if shift.event_id else same_event_q.where(Shift.id == shift.id)
    target = None
    for req, role in (await db.execute(same_event_q)).all():
        st = (req.status or "").lower()
        if req.shift_id == shift.id:
            if st in PENDING_STATUSES:
                target = req                       # their own waiting request: approve it
                continue
            raise HTTPException(status_code=400, detail="You're already booked on this position." if you else f"{who} is already booked on this position.")
        if st in PENDING_STATUSES:
            req.status = "withdrawn"
            req.status_reason = f"Booked as {shift.role_type} instead"
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"You're already booked as {role} for this event." if you
                        else f"{who} is already booked as {role} for this event."),
            )

    if target is None:
        target = await db.scalar(
            select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == worker.id)
        )
        if target is not None:
            st = (target.status or "").lower()
            if st in HISTORY_MESSAGES:
                raise HTTPException(
                    status_code=400,
                    detail=(f"You {HISTORY_MESSAGES[st]}, so it can't be booked again here." if you
                            else f"{who} {HISTORY_MESSAGES[st]}, so they can't be booked on it again."),
                )
            if st not in REASSIGNABLE_STATUSES and st not in PENDING_STATUSES:
                raise HTTPException(status_code=400, detail=f"Already on this position (status: {st}).")

    # Overlapping booking elsewhere
    overlap = await db.scalar(
        select(Shift.title)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == worker.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.start_time < shift.end_time,
            Shift.end_time > shift.start_time,
            Shift.id != shift.id,
        )
        .limit(1)
    )
    if overlap:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"You're already booked at that time ({overlap})." if you
                    else f"{who} is already booked at that time ({overlap})."),
        )

    shift.spots_filled = (shift.spots_filled or 0) + 1
    if shift.spots_filled >= (shift.capacity or 1):
        shift.status = "FILLED"

    if target is None:
        target = ShiftRequest(shift_id=shift.id, worker_id=worker.id)
        db.add(target)
    target.status = "approved"
    target.approval_source = source
    target.approved_by_user_id = approved_by
    target.approved_at = now
    target.check_in_time = None
    target.check_in_verified = False
    target.check_out_time = None
    target.check_out_verified = False
    target.dropped_at = None
    target.status_reason = None
    target.pay_rate = None
    await db.flush()

    # Offers: this person's pending offer for this position is settled; if now full, the rest are 'filled'
    await db.execute(
        update(ShiftOffer)
        .where(ShiftOffer.shift_id == shift.id, ShiftOffer.worker_id == worker.id, ShiftOffer.status == "pending")
        .values(status="accepted" if source == "offer" else "cancelled", responded_at=now)
    )
    if shift.spots_filled >= (shift.capacity or 1):
        await db.execute(
            update(ShiftOffer)
            .where(ShiftOffer.shift_id == shift.id, ShiftOffer.status == "pending")
            .values(status="filled", responded_at=now)
        )
    return target


async def assign_worker(db: AsyncSession, manager: User, shift_id: UUID, worker_id: UUID) -> Tuple[UUID, str]:
    """Manager books a specific person. Commits. Returns (request_id, message)."""
    try:
        shift = await _load_shift_locked(db, shift_id)
        worker = await db.scalar(select(User).where(User.id == worker_id))
        if worker is None:
            raise HTTPException(status_code=404, detail="Person not found.")
        name = full_name(worker)
        req = await _book_locked(db, shift, worker, source="manager_assign", approved_by=manager.id, who=name)
        req_id = req.id
        role = shift.role_type
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("assign_worker failed")
        raise HTTPException(status_code=500, detail=f"Could not assign: {e}")
    return req_id, f"{name} is booked as {role}."


async def create_offers(
    db: AsyncSession, manager: User, shift_id: UUID, worker_ids: List[UUID], message: Optional[str]
) -> Tuple[OfferCreateResult, List[UUID]]:
    """Creates one offer batch. Commits. Returns (result, offer ids to notify)."""
    ids = list(dict.fromkeys(worker_ids or []))
    if not ids:
        raise HTTPException(status_code=400, detail="Pick at least one person.")
    if len(ids) > MAX_OFFER_PEOPLE:
        raise HTTPException(status_code=400, detail=f"Offer to at most {MAX_OFFER_PEOPLE} people at a time.")
    now = datetime.now(timezone.utc)
    try:
        shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
        if shift is None:
            raise HTTPException(status_code=404, detail="Position not found.")
        if (shift.status or "").upper() == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if shift.event_id:
            ev = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
            if ev is not None and ev.cancelled_at is not None:
                raise HTTPException(status_code=400, detail="This event was cancelled.")
        if as_utc(shift.start_time) <= now:
            raise HTTPException(status_code=400, detail="This shift has already started. Use Assign instead.")
        if (shift.spots_filled or 0) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position is already full.")

        cands = {c.worker_id: c for c in await list_candidates(db, shift, worker_ids=ids)}
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}
        batch = uuid.uuid4()
        skipped: List[OfferSkip] = []
        offer_ids: List[UUID] = []
        clean_msg = (message or "").strip()[:500] or None
        for wid in ids:
            u = users.get(wid)
            c = cands.get(wid)
            name = full_name(u)
            if u is None or c is None:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Not found, inactive or blocked."))
                continue
            if c.offered:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Already has an offer for this position."))
                continue
            if not c.available and not c.requested_this:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=c.reason or "Not available."))
                continue
            o = ShiftOffer(
                shift_id=shift.id, venue_id=shift.venue_id, worker_id=wid, batch_id=batch,
                offered_by_user_id=manager.id, status="pending", message=clean_msg,
                expires_at=shift.start_time, created_at=now,
            )
            db.add(o)
            await db.flush()
            offer_ids.append(o.id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("create_offers failed")
        raise HTTPException(status_code=500, detail=f"Could not send offers: {e}")

    n = len(offer_ids)
    msg = (f"Offered to {n} {'person' if n == 1 else 'people'}. The first to accept gets it."
           if n else "No offers sent.")
    return OfferCreateResult(batch_id=batch if n else None, offered=n, skipped=skipped, message=msg), offer_ids


async def accept_offer(db: AsyncSession, worker: User, offer_id: UUID) -> Tuple[UUID, ShiftOffer]:
    """Worker accepts. First to accept is booked. Commits. Returns (request_id, offer)."""
    now = datetime.now(timezone.utc)
    offer = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id, ShiftOffer.worker_id == worker.id))
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    st = (offer.status or "").lower()
    if st != "pending":
        raise HTTPException(status_code=400, detail={
            "accepted": "You already accepted this offer.",
            "declined": "You declined this offer.",
            "filled": "Someone else accepted this one first.",
            "cancelled": "The manager withdrew this offer.",
        }.get(st, "This offer is no longer open."))
    if as_utc(offer.expires_at) <= now:
        raise HTTPException(status_code=400, detail="This offer has expired.")
    shift_id = offer.shift_id
    try:
        shift = await _load_shift_locked(db, shift_id)
        offer = await db.scalar(
            select(ShiftOffer).where(ShiftOffer.id == offer_id).with_for_update()
            .execution_options(populate_existing=True)
        )
        if (offer.status or "").lower() != "pending":
            raise HTTPException(status_code=409, detail="Someone else accepted this one first.")
        req = await _book_locked(db, shift, worker, source="offer", approved_by=offer.offered_by_user_id, who="you")
        req_id = req.id
        await db.commit()
    except HTTPException as e:
        await db.rollback()
        if e.status_code == status.HTTP_409_CONFLICT and "full" in str(e.detail):
            try:
                await db.execute(
                    update(ShiftOffer).where(ShiftOffer.id == offer_id, ShiftOffer.status == "pending")
                    .values(status="filled", responded_at=now)
                )
                await db.commit()
            except Exception:
                await db.rollback()
            raise HTTPException(status_code=409, detail="Someone else accepted this one first.")
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("accept_offer failed")
        raise HTTPException(status_code=500, detail=f"Could not accept: {e}")
    offer = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    return req_id, offer


async def decline_offer(db: AsyncSession, worker: User, offer_id: UUID) -> Tuple[ShiftOffer, bool]:
    """Worker declines. Commits. Returns (offer, nobody_left) - nobody_left: every offer in the batch is answered and none accepted."""
    offer = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id, ShiftOffer.worker_id == worker.id))
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    if (offer.status or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="This offer is no longer open.")
    try:
        offer.status = "declined"
        offer.responded_at = datetime.now(timezone.utc)
        await db.flush()
        statuses = (await db.execute(
            select(ShiftOffer.status).where(ShiftOffer.batch_id == offer.batch_id)
        )).scalars().all()
        nobody_left = all(s in ("declined", "cancelled") for s in statuses)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not decline: {e}")
    return offer, nobody_left


async def cancel_offer(db: AsyncSession, offer: ShiftOffer) -> None:
    if (offer.status or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="Only offers that are still waiting can be withdrawn.")
    try:
        offer.status = "cancelled"
        offer.responded_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not withdraw the offer: {e}")


# ---------------------------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------------------------
async def list_candidates(
    db: AsyncSession, shift: Shift, *, q: Optional[str] = None, worker_ids: Optional[List[UUID]] = None,
) -> List[AssignCandidate]:
    """
    The venue's team (+ anyone matching `q` by name / email when searching, flagged on_team=False).
    Blocked people are never listed. With worker_ids: exactly those people (used to validate offers).
    """
    venue_id = shift.venue_id
    team = await get_venue_team(db, venue_id)
    team_ids = {u.id for u in team}
    people = {u.id: u for u in team}
    if worker_ids is not None:
        extra = [w for w in worker_ids if w not in people]
        if extra:
            for u in (await db.execute(
                select(User).where(User.id.in_(extra), func.lower(User.role) == "worker", User.is_active == True)
            )).scalars().all():
                people[u.id] = u
        people = {k: v for k, v in people.items() if k in set(worker_ids)}
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
        )).scalars().all():
            people.setdefault(u.id, u)
        people = {
            k: v for k, v in people.items()
            if q.strip().lower() in f"{v.first_name or ''} {v.last_name or ''} {v.email or ''}".lower()
        }
    if not people:
        return []
    ids = list(people.keys())

    wl = {r.worker_id: r for r in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id.in_(ids))
    )).scalars().all()}
    blocked = {wid for wid, r in wl.items() if r.status == "blocked"}

    # Requests in this event (or on this position when it has no event)
    ev_q = (
        select(ShiftRequest.worker_id, ShiftRequest.shift_id, ShiftRequest.status, Shift.role_type)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
    )
    ev_q = ev_q.where(Shift.event_id == shift.event_id) if shift.event_id else ev_q.where(Shift.id == shift.id)
    in_event = defaultdict(list)
    for wid, sid, st, role in (await db.execute(ev_q)).all():
        in_event[wid].append((sid, (st or "").lower(), role))

    history = {wid: (st or "").lower() for wid, st in (await db.execute(
        select(ShiftRequest.worker_id, ShiftRequest.status).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id.in_(ids)
        )
    )).all()}

    overlaps = {}
    for wid, title in (await db.execute(
        select(ShiftRequest.worker_id, Shift.title)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            ShiftRequest.worker_id.in_(ids),
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.start_time < shift.end_time,
            Shift.end_time > shift.start_time,
            Shift.id != shift.id,
        )
    )).all():
        overlaps.setdefault(wid, title)

    offered = set((await db.execute(
        select(ShiftOffer.worker_id).where(
            ShiftOffer.shift_id == shift.id, ShiftOffer.status == "pending", ShiftOffer.worker_id.in_(ids)
        )
    )).scalars().all())

    now = datetime.now(timezone.utc)
    worked = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            ShiftRequest.worker_id.in_(ids), Shift.venue_id == venue_id, Shift.end_time < now,
            func.lower(ShiftRequest.status).in_(FINISHED_STATUSES),
        )
        .group_by(ShiftRequest.worker_id)
    )).all())
    rel = await compute_reliability(db, ids)
    role_l = (shift.role_type or "").lower()

    out: List[AssignCandidate] = []
    for wid, u in people.items():
        if wid in blocked:
            continue
        positions = list(wl[wid].positions or []) if wid in wl else []
        reason = None
        requested_this = False
        for sid, st, role in in_event.get(wid, []):
            if sid == shift.id and st in PENDING_STATUSES:
                requested_this = True
            elif sid == shift.id:
                reason = "Already booked on this position."
            elif st in PENDING_STATUSES:
                pass                       # booking them here withdraws that request
            else:
                reason = f"Booked as {role} for this event."
        if reason is None and history.get(wid) in HISTORY_MESSAGES:
            reason = f"Can't rebook: {HISTORY_MESSAGES[history[wid]]}."
        if reason is None and wid in overlaps:
            reason = f"Booked at that time ({overlaps[wid]})."
        out.append(AssignCandidate(
            worker_id=wid,
            first_name=u.first_name or "",
            last_name=u.last_name or "",
            email=u.email,
            phone=u.phone,
            aggregate_rating=float(u.aggregate_rating or 0.0),
            rating_count=int(u.rating_count or 0),
            reliability_score=(rel.get(wid) or {}).get("score"),
            on_team=wid in team_ids,
            positions=positions,
            position_match=any(p.lower() == role_l for p in positions),
            available=reason is None,
            reason=reason,
            requested_this=requested_this,
            offered=wid in offered,
            venue_shifts=int(worked.get(wid, 0)),
        ))
    out.sort(key=lambda c: (
        not c.requested_this, not c.available, not c.position_match, not c.on_team,
        -c.venue_shifts, (c.first_name or "").lower(), (c.last_name or "").lower(),
    ))
    return out


# ---------------------------------------------------------------------------------------------
# Worker's open offers
# ---------------------------------------------------------------------------------------------
async def worker_offers(db: AsyncSession, worker: User) -> List[WorkerOffer]:
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(ShiftOffer, Shift)
        .join(Shift, Shift.id == ShiftOffer.shift_id)
        .where(
            ShiftOffer.worker_id == worker.id,
            ShiftOffer.status == "pending",
            ShiftOffer.expires_at > now,
            func.upper(Shift.status) == "OPEN",
        )
        .order_by(Shift.start_time.asc())
    )).all()
    if not rows:
        return []
    venue_ids = {s.venue_id for _, s in rows}
    venues = {v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()}
    event_ids = {s.event_id for _, s in rows if s.event_id}
    events = {e.id: e for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    locations = await load_locations(db, [e.location_id for e in events.values()])
    offerer_ids = {o.offered_by_user_id for o, _ in rows if o.offered_by_user_id}
    offerers = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(offerer_ids)))).scalars().all()} if offerer_ids else {}
    batch_ids = {o.batch_id for o, _ in rows}
    batch_counts = dict((await db.execute(
        select(ShiftOffer.batch_id, func.count(ShiftOffer.id))
        .where(ShiftOffer.batch_id.in_(batch_ids), ShiftOffer.status == "pending")
        .group_by(ShiftOffer.batch_id)
    )).all())

    out = []
    for o, s in rows:
        ev = events.get(s.event_id)
        if ev is not None and ev.cancelled_at is not None:
            continue
        if (s.spots_filled or 0) >= (s.capacity or 1):
            continue
        v = venues.get(s.venue_id)
        loc = locations.get(ev.location_id) if ev is not None and ev.location_id else None
        show_pay = not s.hide_rate
        out.append(WorkerOffer(
            offer_id=o.id,
            shift_id=s.id,
            event_id=s.event_id,
            venue_id=s.venue_id,
            venue_name=v.name if v else "",
            venue_timezone=v.timezone if v else None,
            title=ev.title if ev is not None else (s.title or "Shift"),
            role_type=s.role_type or "Worker",
            start_time=s.start_time,
            end_time=s.end_time,
            hourly_rate=float(s.hourly_rate) if show_pay and s.hourly_rate is not None else None,
            hourly_rate_max=float(s.hourly_rate_max) if show_pay and s.hourly_rate_max is not None else None,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            location_name=loc.name if loc is not None else None,
            address=loc.address if loc is not None else (v.address if v else None),
            message=o.message,
            offered_by=full_name(offerers.get(o.offered_by_user_id)) if o.offered_by_user_id in offerers else None,
            others_offered=max(0, int(batch_counts.get(o.batch_id, 1)) - 1),
            created_at=o.created_at,
            expires_at=o.expires_at,
        ))
    return out
```

---

## B3. NEW FILE `backend/src/services/invites.py`

```python
"""
Phase 29: Team invites.

* One shareable link per venue (kind 'link'): printed as a QR code, posted in the staff group chat.
  Anyone with it can join the team. Valid 30 days; "New link" revokes the old one.
* Personal invites (kind 'personal'): one per person, from the Invite form or a CSV import.
  Emailed (and texted when SMS is set up). Valid 14 days; can be used once.

Joining = a team-list row with status 'active' (services/team.set_membership).
A person the venue BLOCKED can't join through any invite.
"""
import io
import logging
import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

import segno
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import Venue, VenueInvite
from src.services.messaging import (
    absolute_link, email_available, sms_available, send_email, send_sms, render_email, normalize_phone,
)

logger = logging.getLogger("shiftboard.invites")

LINK_DAYS = 30
PERSONAL_DAYS = 14
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def new_token() -> str:
    return secrets.token_urlsafe(18)          # 24 URL-safe characters


def invite_url(token: str) -> str:
    return absolute_link(f"/join/{token}")


def qr_svg(url: str) -> str:
    """SVG markup (no XML declaration) for the QR code of `url`."""
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#0f172a", light="#ffffff", xmldecl=False)
    return buf.getvalue().decode("utf-8")


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def invite_status(inv: VenueInvite, now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if inv.revoked_at is not None:
        return "revoked"
    if inv.kind == "personal" and inv.accepted_at is not None:
        return "accepted"
    if as_utc(inv.expires_at) <= now:
        return "expired"
    return "pending"


def valid_email(value: Optional[str]) -> bool:
    return bool(value and EMAIL_RE.match(value.strip()))


async def get_or_create_link(db: AsyncSession, venue_id, created_by) -> VenueInvite:
    """The venue's current shareable link (creates one if there's none usable). Does NOT commit."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(VenueInvite)
        .where(VenueInvite.venue_id == venue_id, VenueInvite.kind == "link", VenueInvite.revoked_at.is_(None))
        .order_by(VenueInvite.created_at.desc())
    )).scalars().all()
    for inv in rows:
        if as_utc(inv.expires_at) > now:
            return inv
    inv = VenueInvite(
        venue_id=venue_id, token=new_token(), kind="link", created_by_user_id=created_by,
        expires_at=now + timedelta(days=LINK_DAYS), positions=[], created_at=now,
    )
    db.add(inv)
    await db.flush()
    return inv


async def regenerate_link(db: AsyncSession, venue_id, created_by) -> VenueInvite:
    """Revokes every current link and makes a new one. Does NOT commit."""
    now = datetime.now(timezone.utc)
    for inv in (await db.execute(
        select(VenueInvite).where(
            VenueInvite.venue_id == venue_id, VenueInvite.kind == "link", VenueInvite.revoked_at.is_(None)
        )
    )).scalars().all():
        inv.revoked_at = now
    await db.flush()
    return await get_or_create_link(db, venue_id, created_by)


async def send_invite(inv: VenueInvite, venue: Venue, inviter_name: str) -> Tuple[bool, bool]:
    """Emails / texts one personal invite. Never raises. Returns (emailed, texted)."""
    url = invite_url(inv.token)
    first = (inv.first_name or "").strip()
    hello = f"Hi {first}, " if first else ""
    title = f"Join {venue.name} on ShiftBoard"
    body = (f"{hello}{inviter_name} invited you to join the {venue.name} team on ShiftBoard. "
            "You'll see their open shifts, can book them and get reminders.\n\n"
            "Tap the button to create your account (or sign in) and join. The link works for 14 days.")
    emailed = texted = False
    if inv.email and valid_email(inv.email):
        try:
            text, html_body = render_email(title, body, url, footer_link="/")
            ok, err = await send_email(inv.email, title, text, html_body)
            emailed = bool(ok)
            if not ok:
                logger.warning(f"Invite email to {inv.email} failed: {err}")
        except Exception:
            logger.exception("invite email failed")
    if inv.phone and sms_available() and normalize_phone(inv.phone):
        try:
            ok, err = await send_sms(inv.phone, f"{inviter_name} invited you to join {venue.name} on ShiftBoard: {url}")
            texted = bool(ok)
        except Exception:
            logger.exception("invite sms failed")
    return emailed, texted
```

---

## B4. NEW FILE `backend/src/routers/team.py`
Endpoints (venue manager or platform admin):

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/venues/{venue_id}/team?status=active\|removed\|blocked\|all` | team list |
| POST | `/api/venues/{venue_id}/team` `{email, positions}` | add an existing worker |
| POST | `/api/venues/{venue_id}/team/accounts` `{first_name, last_name, email, phone, positions}` | create worker account → `{temporary_password}` once |
| PATCH | `/api/venues/{venue_id}/team/{worker_id}` `{status?, positions?, notes?}` | edit / remove / block |
| GET | `/api/venues/{venue_id}/managers` | managers |
| POST | `/api/venues/{venue_id}/managers` `{email, first_name, last_name, phone}` | add co-manager |
| DELETE | `/api/venues/{venue_id}/managers/{user_id}` | remove co-manager (not yourself, not the last) |
| PUT | `/api/venues/{venue_id}/ratings/{request_id}` `{rating 1-5, would_book_again, review}` | rate a finished shift |
| DELETE | `/api/venues/{venue_id}/ratings/{request_id}` | remove the rating |

```python
"""
Phase 29: The venue's Team page, co-managers and ratings.

Everything here requires the venue's manager (or a platform admin).

  GET    /api/venues/{venue_id}/team?status=active|removed|blocked|all
  POST   /api/venues/{venue_id}/team                     add an existing worker by email
  POST   /api/venues/{venue_id}/team/accounts            create a worker account (temporary password, shown once)
  PATCH  /api/venues/{venue_id}/team/{worker_id}         status / positions / private notes
  GET    /api/venues/{venue_id}/managers
  POST   /api/venues/{venue_id}/managers                 add a co-manager (existing manager account, or a new one)
  DELETE /api/venues/{venue_id}/managers/{user_id}
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

router = APIRouter(prefix="/api/venues", tags=["Team"])

WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")
FINISHED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
RATEABLE_STATUSES = ("approved", "confirmed", "checked_in", "completed")


def _clean_positions(values: Optional[List[str]]) -> List[str]:
    out = []
    for v in values or []:
        v = (v or "").strip()[:100]
        if v and v.lower() not in [o.lower() for o in out]:
            out.append(v)
    return out


# ---------------------------------------------------------------------------------------------
# Team list
# ---------------------------------------------------------------------------------------------
async def build_team(db: AsyncSession, venue_id: UUID, only_ids: Optional[List[UUID]] = None) -> List[TeamMember]:
    """Everyone on the list (any status) + everyone who has worked / been booked here."""
    now = datetime.now(timezone.utc)
    wl_q = select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id)
    if only_ids is not None:
        wl_q = wl_q.where(VenueWhitelist.worker_id.in_(only_ids))
    rows = {r.worker_id: r for r in (await db.execute(wl_q)).scalars().all()}

    worked_q = (
        select(ShiftRequest.worker_id)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(Shift.venue_id == venue_id, func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
        .distinct()
    )
    if only_ids is not None:
        worked_q = worked_q.where(ShiftRequest.worker_id.in_(only_ids))
    worked_ids = set((await db.execute(worked_q)).scalars().all())

    ids = set(rows.keys()) | worked_ids
    if not ids:
        return []
    users = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_(ids), func.lower(User.role) == "worker", User.is_active == True)
    )).scalars().all()}
    ids = list(users.keys())
    if not ids:
        return []

    finished = {}
    for wid, n, last in (await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id), func.max(Shift.start_time))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            Shift.venue_id == venue_id, ShiftRequest.worker_id.in_(ids), Shift.end_time < now,
            func.lower(ShiftRequest.status).in_(FINISHED_STATUSES),
        )
        .group_by(ShiftRequest.worker_id)
    )).all():
        finished[wid] = (int(n), last)
    upcoming = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            Shift.venue_id == venue_id, ShiftRequest.worker_id.in_(ids), Shift.end_time >= now,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
        )
        .group_by(ShiftRequest.worker_id)
    )).all())
    vr = {}
    for wid, avg, n, yes, no in (await db.execute(
        select(
            Rating.worker_id, func.avg(Rating.rating), func.count(Rating.id),
            func.count(Rating.id).filter(Rating.would_book_again == True),
            func.count(Rating.id).filter(Rating.would_book_again == False),
        )
        .where(Rating.venue_id == venue_id, Rating.worker_id.in_(ids))
        .group_by(Rating.worker_id)
    )).all():
        vr[wid] = (round(float(avg), 2) if avg is not None else None, int(n), int(yes), int(no))
    rel = await compute_reliability(db, ids)

    out = []
    for wid, u in users.items():
        row = rows.get(wid)
        n_done, last = finished.get(wid, (0, None))
        v_avg, v_n, yes, no = vr.get(wid, (None, 0, 0, 0))
        r = rel.get(wid)
        out.append(TeamMember(
            worker_id=wid,
            first_name=u.first_name or "",
            last_name=u.last_name or "",
            email=u.email,
            phone=u.phone,
            avatar_url=u.avatar_url,
            status=(row.status or "active") if row is not None else "active",
            on_list=row is not None,
            source=(row.source if row is not None else "worked"),
            positions=list(row.positions or []) if row is not None else [],
            notes=row.notes if row is not None else None,
            shifts_worked=n_done,
            upcoming=int(upcoming.get(wid, 0)),
            last_worked=last,
            aggregate_rating=float(u.aggregate_rating or 0.0),
            rating_count=int(u.rating_count or 0),
            venue_rating=v_avg,
            venue_rating_count=v_n,
            would_book_again_yes=yes,
            would_book_again_no=no,
            reliability=WorkerReliability(worker_id=wid, **r) if r else None,
            added_at=row.created_at if row is not None else None,
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
    return out


async def _one_member(db: AsyncSession, venue_id: UUID, worker_id: UUID) -> TeamMember:
    found = await build_team(db, venue_id, only_ids=[worker_id])
    if not found:
        raise HTTPException(status_code=404, detail="That person isn't on this team.")
    return found[0]


@router.get("/{venue_id}/team", response_model=List[TeamMember])
async def get_team(
    venue_id: UUID,
    status_filter: str = Query("active", alias="status", pattern="^(active|removed|blocked|all)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    members = await build_team(db, venue_id)
    if status_filter != "all":
        members = [m for m in members if m.status == status_filter]
    return members


@router.post("/{venue_id}/team", response_model=TeamMember)
async def add_existing_worker(
    venue_id: UUID,
    body: TeamAddExisting,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
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


@router.post("/{venue_id}/team/accounts", response_model=AccountCreateResult, status_code=status.HTTP_201_CREATED)
async def create_worker_account(
    venue_id: UUID,
    body: TeamCreateWorker,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Creates a WORKER account with a temporary password (returned once) and adds it to this team.
    If a worker account with that email already exists, it's just added to the team."""
    await verify_venue_manager_access(venue_id, current_user, db)
    email = (body.email or "").strip().lower()
    first = (body.first_name or "").strip()[:100]
    if not first:
        raise HTTPException(status_code=400, detail="First name is required.")
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    positions = _clean_positions(body.positions)
    try:
        existing = await db.scalar(select(User).where(func.lower(User.email) == email))
        if existing is not None:
            if normalize_role(existing.role) != "worker":
                raise HTTPException(status_code=409, detail="That email belongs to a manager or admin account.")
            await set_membership(db, venue_id, existing.id, status="active", source="manager",
                                 positions=positions, added_by=current_user.id)
            await db.commit()
            return AccountCreateResult(
                user_id=existing.id, created=False,
                message=f"{email} already has an account, so they were added to your team. They sign in as usual.",
            )
        temp = _generate_temp_password()
        user = User(
            email=email,
            hashed_password=get_password_hash(temp),
            role="worker",
            first_name=first,
            last_name=(body.last_name or "").strip()[:100],
            phone=(body.phone or "").strip()[:30] or None,
            skills=[],
            aggregate_rating=5.0,
            rating_count=0,
            total_shifts=0,
            is_active=True,
        )
        db.add(user)
        await db.flush()
        user_id = user.id
        await set_membership(db, venue_id, user_id, status="active", source="manager",
                             positions=positions, added_by=current_user.id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("create_worker_account failed")
        raise HTTPException(status_code=500, detail=f"Could not create the account: {e}")
    return AccountCreateResult(
        user_id=user_id, created=True, temporary_password=temp,
        message="Account created. Give them this temporary password; it's shown only once.",
    )


@router.patch("/{venue_id}/team/{worker_id}", response_model=TeamMemberUpdateResult)
async def update_member(
    venue_id: UUID,
    worker_id: UUID,
    body: TeamMemberUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    data = body.model_dump(exclude_unset=True)
    new_status = data.get("status")
    if new_status is not None and new_status not in TEAM_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be active, removed or blocked.")
    user = await db.scalar(select(User).where(User.id == worker_id))
    if user is None or normalize_role(user.role) != "worker":
        raise HTTPException(status_code=404, detail="Worker not found.")

    now = datetime.now(timezone.utc)
    booked_upcoming = 0
    message = "Saved."
    try:
        row = await db.scalar(
            select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == worker_id)
        )
        if row is None:
            row = await set_membership(db, venue_id, worker_id, status=new_status or "active",
                                       source="manager", positions=[], added_by=current_user.id)
        elif new_status is not None:
            row.status = new_status
            row.is_active = new_status == "active"
        if "positions" in data and data["positions"] is not None:
            row.positions = _clean_positions(data["positions"])
        if "notes" in data:
            row.notes = (data["notes"] or "").strip()[:2000] or None

        if new_status == "blocked":
            # Waiting requests at this venue are declined; open offers are withdrawn.
            pending = (await db.execute(
                select(ShiftRequest)
                .join(Shift, Shift.id == ShiftRequest.shift_id)
                .where(
                    Shift.venue_id == venue_id, ShiftRequest.worker_id == worker_id,
                    func.lower(ShiftRequest.status).in_(("pending", "pending_manager_approval")),
                )
            )).scalars().all()
            for r in pending:
                r.status = "rejected"
                r.status_reason = "Not selected"
            await db.execute(
                update(ShiftOffer)
                .where(ShiftOffer.venue_id == venue_id, ShiftOffer.worker_id == worker_id, ShiftOffer.status == "pending")
                .values(status="cancelled", responded_at=now)
            )
            message = "Blocked. They can't request, be offered or be assigned your shifts."
        elif new_status == "removed":
            message = "Removed from the team. They can still request your open shifts; they just aren't on the team."
        elif new_status == "active":
            message = "On the team."
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")

    if new_status in ("blocked", "removed"):
        booked_upcoming = int(await db.scalar(
            select(func.count(ShiftRequest.id))
            .join(Shift, Shift.id == ShiftRequest.shift_id)
            .where(
                Shift.venue_id == venue_id, ShiftRequest.worker_id == worker_id, Shift.end_time >= now,
                func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            )
        ) or 0)
        if booked_upcoming:
            message += f" They're still booked on {booked_upcoming} upcoming shift{'s' if booked_upcoming != 1 else ''}; remove them from those shifts if needed."
    return TeamMemberUpdateResult(member=await _one_member(db, venue_id, worker_id), message=message, booked_upcoming=booked_upcoming)


# ---------------------------------------------------------------------------------------------
# Co-managers
# ---------------------------------------------------------------------------------------------
async def _managers(db: AsyncSession, venue_id: UUID, me: User) -> List[VenueManagerItem]:
    rows = (await db.execute(
        select(VenueManager, User)
        .join(User, User.id == VenueManager.user_id)
        .where(VenueManager.venue_id == venue_id)
        .order_by(VenueManager.is_primary.desc(), User.first_name.asc())
    )).all()
    return [
        VenueManagerItem(
            user_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email,
            phone=u.phone, is_primary=bool(vm.is_primary), is_you=u.id == me.id,
        )
        for vm, u in rows
    ]


@router.get("/{venue_id}/managers", response_model=List[VenueManagerItem])
async def list_managers(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    return await _managers(db, venue_id, current_user)


@router.post("/{venue_id}/managers", response_model=AccountCreateResult, status_code=status.HTTP_201_CREATED)
async def add_manager(
    venue_id: UUID,
    body: ManagerCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Adds a co-manager. Existing manager account -> linked. No account -> a manager account is created
    with a temporary password (returned once). Worker and admin accounts are refused (an admin changes roles)."""
    await verify_venue_manager_access(venue_id, current_user, db)
    email = (body.email or "").strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    try:
        user = await db.scalar(select(User).where(func.lower(User.email) == email))
        temp = None
        created = False
        if user is not None:
            role = normalize_role(user.role)
            if role == "platform_admin":
                raise HTTPException(status_code=400, detail="That's a platform admin; they can already manage every venue.")
            if role != "venue_manager":
                raise HTTPException(
                    status_code=409,
                    detail="That email belongs to a worker account. Ask a platform admin to change it to a manager account, or use a different email.",
                )
            if not user.is_active:
                raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
            already = await db.scalar(
                select(VenueManager).where(VenueManager.venue_id == venue_id, VenueManager.user_id == user.id)
            )
            if already is not None:
                raise HTTPException(status_code=400, detail="They already manage this venue.")
        else:
            first = (body.first_name or "").strip()[:100]
            if not first:
                raise HTTPException(status_code=400, detail="First name is required for a new account.")
            temp = _generate_temp_password()
            user = User(
                email=email,
                hashed_password=get_password_hash(temp),
                role="venue_manager",
                first_name=first,
                last_name=(body.last_name or "").strip()[:100],
                phone=(body.phone or "").strip()[:30] or None,
                skills=[],
                aggregate_rating=5.0,
                rating_count=0,
                total_shifts=0,
                is_active=True,
            )
            db.add(user)
            await db.flush()
            created = True
        user_id = user.id
        db.add(VenueManager(venue_id=venue_id, user_id=user_id, is_primary=False))
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("add_manager failed")
        raise HTTPException(status_code=500, detail=f"Could not add the manager: {e}")
    return AccountCreateResult(
        user_id=user_id, created=created, temporary_password=temp,
        message=("Manager account created. Give them this temporary password; it's shown only once."
                 if created else "Added. They'll see this venue next time they sign in."),
    )


@router.delete("/{venue_id}/managers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_manager(
    venue_id: UUID,
    user_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't remove yourself. Ask another manager or an admin.")
    count = int(await db.scalar(select(func.count(VenueManager.user_id)).where(VenueManager.venue_id == venue_id)) or 0)
    row = await db.scalar(select(VenueManager).where(VenueManager.venue_id == venue_id, VenueManager.user_id == user_id))
    if row is None:
        raise HTTPException(status_code=404, detail="They don't manage this venue.")
    if count <= 1:
        raise HTTPException(status_code=400, detail="A venue needs at least one manager.")
    try:
        await db.delete(row)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the manager: {e}")
    return None


# ---------------------------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------------------------
async def recompute_rating(db: AsyncSession, worker_id: UUID) -> User:
    """users.aggregate_rating / rating_count from the ratings table. Does NOT commit."""
    avg, n = (await db.execute(
        select(func.avg(Rating.rating), func.count(Rating.id)).where(Rating.worker_id == worker_id)
    )).one()
    user = await db.scalar(select(User).where(User.id == worker_id))
    user.rating_count = int(n or 0)
    user.aggregate_rating = round(float(avg), 2) if n else 5.0
    await db.flush()
    return user


async def _rateable_request(db: AsyncSession, venue_id: UUID, request_id: UUID) -> ShiftRequest:
    row = (await db.execute(
        select(ShiftRequest, Shift).join(Shift, Shift.id == ShiftRequest.shift_id).where(ShiftRequest.id == request_id)
    )).first()
    if row is None or row[1].venue_id != venue_id:
        raise HTTPException(status_code=404, detail="Booking not found at this venue.")
    req, shift = row
    if (req.status or "").lower() not in RATEABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Only people who worked the shift can be rated.")
    end = shift.end_time if shift.end_time.tzinfo else shift.end_time.replace(tzinfo=timezone.utc)
    if end > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="You can rate once the shift has ended.")
    return req


@router.put("/{venue_id}/ratings/{request_id}", response_model=RatingResponse)
async def rate_shift(
    venue_id: UUID,
    request_id: UUID,
    body: RatingInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    req = await _rateable_request(db, venue_id, request_id)
    worker_id = req.worker_id
    try:
        rating = await db.scalar(select(Rating).where(Rating.shift_request_id == request_id))
        if rating is None:
            rating = Rating(shift_request_id=request_id, venue_id=venue_id, worker_id=worker_id)
            db.add(rating)
        rating.rating = int(body.rating)
        rating.would_book_again = body.would_book_again
        rating.review = (body.review or "").strip()[:1000] or None
        rating.rated_by_user_id = current_user.id
        rating.updated_at = datetime.now(timezone.utc)
        await db.flush()
        user = await recompute_rating(db, worker_id)
        resp = RatingResponse(
            request_id=request_id, worker_id=worker_id, rating=rating.rating,
            would_book_again=rating.would_book_again, review=rating.review,
            aggregate_rating=float(user.aggregate_rating), rating_count=int(user.rating_count),
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save the rating: {e}")
    return resp


@router.delete("/{venue_id}/ratings/{request_id}", response_model=RatingResponse)
async def delete_rating(
    venue_id: UUID,
    request_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    rating = await db.scalar(select(Rating).where(Rating.shift_request_id == request_id, Rating.venue_id == venue_id))
    if rating is None:
        raise HTTPException(status_code=404, detail="No rating to remove.")
    worker_id = rating.worker_id
    try:
        await db.delete(rating)
        await db.flush()
        user = await recompute_rating(db, worker_id)
        resp = RatingResponse(
            request_id=request_id, worker_id=worker_id, rating=None,
            aggregate_rating=float(user.aggregate_rating), rating_count=int(user.rating_count),
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the rating: {e}")
    return resp
```

---

## B5. NEW FILE `backend/src/routers/invites.py`
`GET /api/invites/{token}` is deliberately public (no sign-in) so the join page can show the venue before sign-up. It returns only the venue name/address/logo and the invite's first name/positions.

```python
"""
Phase 29: Team invites.

Manager (venue's manager or platform admin):
  GET    /api/venues/{venue_id}/invites/link              the team link + QR code (created on first use)
  POST   /api/venues/{venue_id}/invites/link/regenerate   new link; the old one stops working
  GET    /api/venues/{venue_id}/invites                   personal invites
  POST   /api/venues/{venue_id}/invites                   invite people (form or CSV rows), optionally email/text now
  POST   /api/venues/{venue_id}/invites/{invite_id}/resend
  DELETE /api/venues/{venue_id}/invites/{invite_id}       revoke

Anyone with the link:
  GET    /api/invites/{token}                             public preview (no sign-in)
  POST   /api/invites/{token}/accept                      signed-in worker joins the team
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, VenueInvite, VenueWhitelist
from src.schemas import (
    InviteLinkResponse, InviteBatchCreate, InviteBatchResult, InviteRowResult, PersonalInvite,
    PublicInvite, InviteAcceptResult,
)
from src.auth import require_manager_or_admin, get_current_user, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services.invites import (
    get_or_create_link, regenerate_link, invite_url, qr_svg, invite_status, valid_email, new_token,
    send_invite, PERSONAL_DAYS, as_utc,
)
from src.services.messaging import email_available, normalize_phone
from src.services.team import set_membership
from src.services import notify_events

logger = logging.getLogger("shiftboard.invites")

router = APIRouter(tags=["Invites"])

MAX_ROWS = 200


def _person(u: User) -> str:
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or u.email


def _clean_positions(values) -> List[str]:
    out = []
    for v in values or []:
        v = (v or "").strip()[:100]
        if v and v.lower() not in [o.lower() for o in out]:
            out.append(v)
    return out


def _link_response(inv: VenueInvite) -> InviteLinkResponse:
    url = invite_url(inv.token)
    return InviteLinkResponse(id=inv.id, token=inv.token, url=url, expires_at=inv.expires_at, uses=inv.uses or 0, qr_svg=qr_svg(url))


def _personal_response(inv: VenueInvite, accepted_name=None) -> PersonalInvite:
    return PersonalInvite(
        id=inv.id, first_name=inv.first_name, last_name=inv.last_name, email=inv.email, phone=inv.phone,
        positions=list(inv.positions or []), status=invite_status(inv), url=invite_url(inv.token),
        created_at=inv.created_at, expires_at=inv.expires_at, last_sent_at=inv.last_sent_at,
        accepted_at=inv.accepted_at, accepted_by_name=accepted_name,
    )


# ---------------------------------------------------------------------------------------------
# Manager: team link / QR
# ---------------------------------------------------------------------------------------------
@router.get("/api/venues/{venue_id}/invites/link", response_model=InviteLinkResponse)
async def get_team_link(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    try:
        inv = await get_or_create_link(db, venue_id, current_user.id)
        resp = _link_response(inv)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not load the team link: {e}")
    return resp


@router.post("/api/venues/{venue_id}/invites/link/regenerate", response_model=InviteLinkResponse)
async def regenerate_team_link(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    try:
        inv = await regenerate_link(db, venue_id, current_user.id)
        resp = _link_response(inv)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not make a new link: {e}")
    return resp


# ---------------------------------------------------------------------------------------------
# Manager: personal invites (form + CSV import)
# ---------------------------------------------------------------------------------------------
@router.get("/api/venues/{venue_id}/invites", response_model=List[PersonalInvite])
async def list_invites(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    rows = (await db.execute(
        select(VenueInvite)
        .where(VenueInvite.venue_id == venue_id, VenueInvite.kind == "personal")
        .order_by(VenueInvite.created_at.desc())
        .limit(500)
    )).scalars().all()
    acc_ids = {r.accepted_by_user_id for r in rows if r.accepted_by_user_id}
    names = {u.id: _person(u) for u in (await db.execute(select(User).where(User.id.in_(acc_ids)))).scalars().all()} if acc_ids else {}
    return [_personal_response(r, names.get(r.accepted_by_user_id)) for r in rows]


@router.post("/api/venues/{venue_id}/invites", response_model=InviteBatchResult)
async def create_invites(
    venue_id: UUID,
    body: InviteBatchCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    if not body.rows:
        raise HTTPException(status_code=400, detail="Add at least one person.")
    if len(body.rows) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_ROWS} people per upload.")
    now = datetime.now(timezone.utc)
    results: List[InviteRowResult] = []
    to_send: List[VenueInvite] = []
    seen = set()
    try:
        # Existing members and open invites, by email (lower-case)
        member_emails = set((await db.execute(
            select(func.lower(User.email))
            .join(VenueWhitelist, VenueWhitelist.worker_id == User.id)
            .where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.status == "active")
        )).scalars().all())
        open_invites = {}
        for inv in (await db.execute(
            select(VenueInvite).where(
                VenueInvite.venue_id == venue_id, VenueInvite.kind == "personal",
                VenueInvite.revoked_at.is_(None), VenueInvite.accepted_at.is_(None),
            )
        )).scalars().all():
            if inv.email and as_utc(inv.expires_at) > now:
                open_invites[inv.email.lower()] = inv

        for i, row in enumerate(body.rows, start=1):
            first = (row.first_name or "").strip()[:100]
            last = (row.last_name or "").strip()[:100]
            email = (row.email or "").strip().lower() or None
            phone = (row.phone or "").strip()[:30] or None
            name = f"{first} {last}".strip()
            if not email and not phone:
                results.append(InviteRowResult(row=i, name=name, result="invalid", message="Needs an email or a mobile number."))
                continue
            if email and not valid_email(email):
                results.append(InviteRowResult(row=i, name=name, email=email, result="invalid", message="Email doesn't look right."))
                continue
            if phone and not normalize_phone(phone):
                results.append(InviteRowResult(row=i, name=name, email=email, result="invalid", message="Mobile number doesn't look right."))
                continue
            key = email or phone
            if key in seen:
                results.append(InviteRowResult(row=i, name=name, email=email, result="invalid", message="Listed twice in this upload."))
                continue
            seen.add(key)
            if email and email in member_emails:
                results.append(InviteRowResult(row=i, name=name, email=email, result="already_member", message="Already on your team."))
                continue
            if email and email in open_invites:
                inv = open_invites[email]
                results.append(InviteRowResult(
                    row=i, name=name, email=email, result="already_invited",
                    message="Already invited; use Resend if they lost it.", invite_id=inv.id, url=invite_url(inv.token),
                ))
                continue
            inv = VenueInvite(
                venue_id=venue_id, token=new_token(), kind="personal", email=email, phone=phone,
                first_name=first or None, last_name=last or None, positions=_clean_positions(row.positions),
                created_by_user_id=current_user.id, expires_at=now + timedelta(days=PERSONAL_DAYS), created_at=now,
                last_sent_at=now if body.send else None,
            )
            db.add(inv)
            await db.flush()
            results.append(InviteRowResult(
                row=i, name=name, email=email, result="invited", message="Invited.", invite_id=inv.id, url=invite_url(inv.token),
            ))
            if body.send:
                to_send.append(inv)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("create_invites failed")
        raise HTTPException(status_code=500, detail=f"Could not create the invites: {e}")

    emailed = texted = 0
    if to_send:
        inviter = _person(current_user)
        sem = asyncio.Semaphore(5)

        async def _one(inv):
            async with sem:
                return await send_invite(inv, venue, inviter)
        for e_ok, t_ok in await asyncio.gather(*[_one(inv) for inv in to_send]):
            emailed += int(e_ok)
            texted += int(t_ok)

    invited = sum(1 for r in results if r.result == "invited")
    return InviteBatchResult(
        results=results, invited=invited, skipped=len(results) - invited,
        emailed=emailed, texted=texted, email_available=email_available(),
    )


async def _manager_invite(db: AsyncSession, venue_id: UUID, invite_id: UUID) -> VenueInvite:
    inv = await db.scalar(select(VenueInvite).where(VenueInvite.id == invite_id, VenueInvite.venue_id == venue_id))
    if inv is None or inv.kind != "personal":
        raise HTTPException(status_code=404, detail="Invite not found.")
    return inv


@router.post("/api/venues/{venue_id}/invites/{invite_id}/resend", response_model=PersonalInvite)
async def resend_invite(
    venue_id: UUID,
    invite_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    inv = await _manager_invite(db, venue_id, invite_id)
    st = invite_status(inv)
    if st in ("accepted", "revoked"):
        raise HTTPException(status_code=400, detail=f"This invite was {st}.")
    now = datetime.now(timezone.utc)
    try:
        inv.expires_at = now + timedelta(days=PERSONAL_DAYS)
        inv.last_sent_at = now
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not resend: {e}")
    await send_invite(inv, venue, _person(current_user))
    return _personal_response(inv)


@router.delete("/api/venues/{venue_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    venue_id: UUID,
    invite_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    inv = await _manager_invite(db, venue_id, invite_id)
    try:
        if inv.revoked_at is None:
            inv.revoked_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not revoke: {e}")
    return None


# ---------------------------------------------------------------------------------------------
# Public: preview + accept
# ---------------------------------------------------------------------------------------------
def _why_invalid(inv: VenueInvite) -> str:
    st = invite_status(inv)
    return {
        "revoked": "This invite link was turned off by the venue. Ask them for a new one.",
        "accepted": "This invite was already used.",
        "expired": "This invite has expired. Ask the venue for a new one.",
    }.get(st, "")


@router.get("/api/invites/{token}", response_model=PublicInvite)
async def preview_invite(token: str, db: AsyncSession = Depends(get_db)):
    inv = await db.scalar(select(VenueInvite).where(VenueInvite.token == token))
    if inv is None:
        return PublicInvite(valid=False, reason="This invite link isn't valid. Check you copied all of it.")
    venue = await db.scalar(select(Venue).where(Venue.id == inv.venue_id))
    if venue is None:
        return PublicInvite(valid=False, reason="This venue no longer exists.")
    reason = _why_invalid(inv)
    return PublicInvite(
        valid=not reason, reason=reason or None,
        venue_id=venue.id, venue_name=venue.name, venue_address=venue.address, logo_url=venue.logo_url,
        kind=inv.kind, first_name=inv.first_name if inv.kind == "personal" else None,
        email=inv.email if inv.kind == "personal" else None,
        positions=list(inv.positions or []), expires_at=inv.expires_at,
    )


@router.post("/api/invites/{token}/accept", response_model=InviteAcceptResult)
async def accept_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if normalize_role(current_user.role) != "worker":
        raise HTTPException(status_code=400, detail="Invites are for worker accounts. Sign out and sign in (or sign up) as the worker.")
    inv = await db.scalar(select(VenueInvite).where(VenueInvite.token == token))
    if inv is None:
        raise HTTPException(status_code=404, detail="This invite link isn't valid.")
    venue = await db.scalar(select(Venue).where(Venue.id == inv.venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="This venue no longer exists.")
    venue_id, venue_name = venue.id, venue.name

    row = await db.scalar(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == current_user.id)
    )
    if row is not None and row.status == "blocked":
        raise HTTPException(status_code=403, detail="You can't join this venue's team. Contact the venue if you think this is a mistake.")
    already = row is not None and row.status == "active"
    if already:
        return InviteAcceptResult(venue_id=venue_id, venue_name=venue_name, already_member=True)

    reason = _why_invalid(inv)
    if reason:
        raise HTTPException(status_code=400, detail=reason)
    now = datetime.now(timezone.utc)
    try:
        await set_membership(
            db, venue_id, current_user.id, status="active",
            source="invite", positions=list(inv.positions or []), added_by=inv.created_by_user_id,
        )
        inv.uses = (inv.uses or 0) + 1
        if inv.kind == "personal":
            inv.accepted_at = now
            inv.accepted_by_user_id = current_user.id
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not join the team: {e}")
    await notify_events.team_joined(venue_id, current_user.id)
    return InviteAcceptResult(venue_id=venue_id, venue_name=venue_name, already_member=False)
```

---

## B6. NEW FILE `backend/src/routers/staffing.py`

```python
"""
Phase 29: Direct assign and offers.

Manager (venue's manager or platform admin):
  GET    /api/shifts/{shift_id}/candidates?q=     team (+ search) with availability
  POST   /api/shifts/{shift_id}/assign            book one person now
  POST   /api/shifts/{shift_id}/offers            offer to 1-5 people; first to accept is booked
  DELETE /api/offers/{offer_id}                   withdraw a waiting offer

Worker:
  GET    /api/me/offers                           offers waiting for me
  POST   /api/offers/{offer_id}/accept
  POST   /api/offers/{offer_id}/decline
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Shift, ShiftOffer
from src.schemas import (
    AssignCandidate, AssignRequest, AssignResult, OfferCreate, OfferCreateResult, WorkerOffer, OfferAcceptResult,
)
from src.auth import require_manager_or_admin, get_current_user, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services import staffing
from src.services import notify_events

router = APIRouter(tags=["Staffing"])


async def _managed_shift(db: AsyncSession, shift_id: UUID, user: User) -> Shift:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        raise HTTPException(status_code=404, detail="Position not found.")
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
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id)
    await notify_events.assigned(request_id)          # after commit; never raises
    return AssignResult(request_id=request_id, message=message)


@router.post("/api/shifts/{shift_id}/offers", response_model=OfferCreateResult)
async def offer(
    shift_id: UUID,
    body: OfferCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await _managed_shift(db, shift_id, current_user)
    result, offer_ids = await staffing.create_offers(db, current_user, shift_id, body.worker_ids, body.message)
    if offer_ids:
        await notify_events.offers_sent(offer_ids)    # after commit; never raises
    return result


@router.delete("/api/offers/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
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


@router.get("/api/me/offers", response_model=List[WorkerOffer])
async def my_offers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if normalize_role(current_user.role) != "worker":
        return []
    return await staffing.worker_offers(db, current_user)


@router.post("/api/offers/{offer_id}/accept", response_model=OfferAcceptResult)
async def accept(
    offer_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    request_id, o = await staffing.accept_offer(db, current_user, offer_id)
    await notify_events.offer_accepted(o.id, request_id)
    return OfferAcceptResult(request_id=request_id, message="You're booked. It's on your calendar now.")


@router.post("/api/offers/{offer_id}/decline")
async def decline(
    offer_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    o, nobody_left = await staffing.decline_offer(db, current_user, offer_id)
    if nobody_left:
        await notify_events.offer_nobody(o.id)
    return {"detail": "Declined. Thanks for letting them know."}
```

---

## B7. `backend/src/services/notify.py` (EDIT)
Four new notification kinds.

**Edit 1.** Find:
```python
    "unread_update": ("manager", False),
    "late_worker": ("manager", True),
    "test": ("test", True),
}
```
Replace with:
```python
    "unread_update": ("manager", False),
    "late_worker": ("manager", True),
    "assigned": ("booking", True),           # Phase 29: a manager booked you
    "shift_offered": ("booking", True),      # Phase 29: offered to you (first to accept wins)
    "offer_update": ("manager", False),      # Phase 29: offer accepted / nobody took it
    "team_joined": ("manager", False),       # Phase 29: someone joined through an invite
    "test": ("test", True),
}
```

---

## B8. `backend/src/services/notify_events.py` (EDITS)

**Edit 1.** Find:
```python
  worker event popout  : /worker?event=<event_id>
  worker hand-offs     : /worker?tab=transfers
  manager event        : /venue?venue=<venue_id>&event=<event_id>
"""
import logging
```
Replace with:
```python
  worker event popout  : /worker?event=<event_id>
  worker hand-offs     : /worker?tab=transfers
  worker offers        : /worker?tab=find          (Phase 29: offers show at the top of Find Shifts)
  manager event        : /venue?venue=<venue_id>&event=<event_id>
  manager team         : /venue?venue=<venue_id>&team=1   (Phase 29)
"""
import logging
```

**Edit 2.** Find:
```python
from src.database import AsyncSessionLocal
from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation,
)
from src.services.notify import notify_in
```
Replace with:
```python
from src.database import AsyncSessionLocal
from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation, ShiftOffer,
)
from src.services.notify import notify_in
```

**Edit 3.** Find:
```python
async def new_event_posted(event_id) -> None:
    await _run("new_event_posted", _new_event_posted, event_id)
```
Replace with:
```python
async def new_event_posted(event_id) -> None:
    await _run("new_event_posted", _new_event_posted, event_id)


# ---------------------------------------------------------------------------------------------
# Phase 29: direct assign, offers, team joins
# ---------------------------------------------------------------------------------------------
async def _assigned(db: AsyncSession, request_id) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift, venue, event, location = await _shift_bundle(db, req.shift_id)
    if shift is None:
        return
    await notify_in(
        db, [req.worker_id], "assigned",
        f"You're booked: {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}. "
        "Your manager booked you. Open the shift for arrival info and notes; drop it early if you can't make it.",
        worker_shift_link(req.id), venue_id=shift.venue_id, event_id=shift.event_id, request_id=req.id,
        urgent=is_soon(shift.start_time), dedupe_key=f"assigned:{req.id}:{int(_as_utc(req.approved_at or req.created_at).timestamp())}",
    )


async def assigned(request_id) -> None:
    await _run("assigned", _assigned, request_id)


async def _offers_sent(db: AsyncSession, offer_ids) -> None:
    offers = (await db.execute(select(ShiftOffer).where(ShiftOffer.id.in_(list(offer_ids))))).scalars().all()
    if not offers:
        return
    shift, venue, event, location = await _shift_bundle(db, offers[0].shift_id)
    if shift is None:
        return
    others = len(offers) - 1
    for o in offers:
        body = f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}."
        if o.message:
            body += f"\n“{o.message}”"
        body += ("\nOffered to a few people: the first to accept gets it." if others else "\nAccept or decline in the app.")
        await notify_in(
            db, [o.worker_id], "shift_offered",
            f"Shift offered to you: {shift.role_type} · {event.title if event else shift.title}",
            body, "/worker?tab=find", venue_id=shift.venue_id, event_id=shift.event_id,
            urgent=is_soon(shift.start_time), dedupe_key=f"offer:{o.id}",
        )


async def offers_sent(offer_ids) -> None:
    await _run("offers_sent", _offers_sent, offer_ids)


async def _offer_accepted(db: AsyncSession, offer_id, request_id) -> None:
    o = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    if o is None:
        return
    shift, venue, event, _ = await _shift_bundle(db, o.shift_id)
    worker = await db.scalar(select(User).where(User.id == o.worker_id))
    if shift is None:
        return
    await notify_in(
        db, await manager_ids(db, o.venue_id), "offer_update",
        f"{person(worker)} accepted: {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. They're booked.",
        manager_link(o.venue_id, shift.event_id), venue_id=o.venue_id, event_id=shift.event_id, request_id=request_id,
        dedupe_key=f"offer-acc:{o.id}",
    )


async def offer_accepted(offer_id, request_id) -> None:
    await _run("offer_accepted", _offer_accepted, offer_id, request_id)


async def _offer_nobody(db: AsyncSession, offer_id) -> None:
    o = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    if o is None:
        return
    shift, venue, event, _ = await _shift_bundle(db, o.shift_id)
    if shift is None:
        return
    await notify_in(
        db, await manager_ids(db, o.venue_id), "offer_update",
        f"No one took it: {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. Everyone you offered it to said no. Offer it to someone else or leave it open.",
        manager_link(o.venue_id, shift.event_id), venue_id=o.venue_id, event_id=shift.event_id,
        dedupe_key=f"offer-none:{o.batch_id}",
    )


async def offer_nobody(offer_id) -> None:
    await _run("offer_nobody", _offer_nobody, offer_id)


async def _team_joined(db: AsyncSession, venue_id, worker_id) -> None:
    worker = await db.scalar(select(User).where(User.id == worker_id))
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if worker is None or venue is None:
        return
    await notify_in(
        db, await manager_ids(db, venue_id), "team_joined",
        f"{person(worker)} joined your team",
        f"{person(worker)} accepted your invite to {venue.name}.",
        f"/venue?venue={venue_id}&team=1", venue_id=venue_id,
        dedupe_key=f"joined:{venue_id}:{worker_id}",
    )


async def team_joined(venue_id, worker_id) -> None:
    await _run("team_joined", _team_joined, venue_id, worker_id)
```

---

## B9. `backend/src/services/booking.py` (EDITS)
Blocked workers can't request.

**Edit 1.** Find:
```python
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events

logger = logging.getLogger("shiftboard.booking")
```
Replace with:
```python
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events
from src.services.team import is_blocked

logger = logging.getLogger("shiftboard.booking")
```

**Edit 2.** Find:
```python
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")

        # --- One active request per event -------------------------------------------------
```
Replace with:
```python
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
        if await is_blocked(db, shift.venue_id, worker.id):          # Phase 29
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")

        # --- One active request per event -------------------------------------------------
```

---

## B10. `backend/src/services/listings.py` (EDITS)
A venue that blocked you doesn't appear in Find Shifts.

**Edit 1.** Find:
```python
from src.services.auto_confirm import decide_approval
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
```
Replace with:
```python
from src.services.auto_confirm import decide_approval
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.team import blocked_venue_ids
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
```

**Edit 2.** Find:
```python

    locations = await load_locations(db, [e.location_id for e in events])   # Phase 27

    out: List[EventListing] = []
    for ev in events:
        venue = venues.get(ev.venue_id)
        if venue is None:
            continue
        ev_shifts = shifts_by_event.get(ev.id, [])
        start, end = as_utc(ev.start_time), as_utc(ev.end_time)
```
Replace with:
```python

    locations = await load_locations(db, [e.location_id for e in events])   # Phase 27
    blocked = await blocked_venue_ids(db, user.id)                        # Phase 29

    out: List[EventListing] = []
    for ev in events:
        venue = venues.get(ev.venue_id)
        if venue is None:
            continue
        if event_id is None and venue.id in blocked:
            continue          # Phase 29: a venue that blocked you doesn't show up in Find Shifts
        ev_shifts = shifts_by_event.get(ev.id, [])
        start, end = as_utc(ev.start_time), as_utc(ev.end_time)
```

---

## B11. `backend/src/routers/venues.py` (EDITS)
Roster people get rating fields + `approval_source`; each position gets its `offers`; the old whitelist endpoint also sets `status`.

**Edit 1.** Find:
```python
from src.models import (
    Venue, VenueManager, VenueWhitelist, User, UserRole,
    Shift, ShiftRequest, RequestStatus, TimeEntry, VenuePosition, ShiftEvent, TimeEntryEdit
)
from src.schemas import (
    VenueCreate, VenueUpdateSettings, VenueResponse,
    WhitelistAddRequest, WhitelistResponse,
    ShiftResponse, ShiftRequestResponse,
    WorkerContactSchema, ShiftRosterResponse, UserBrief,
    WorkerReliability, VenueEventResponse, EventPosition, RosterPerson,
    VenuePositionCreate, VenuePositionUpdate, VenuePositionResponse,
    VenueDirectoryItem, VenueProfileResponse, PublicVenueEvent
```
Replace with:
```python
from src.models import (
    Venue, VenueManager, VenueWhitelist, User, UserRole,
    Shift, ShiftRequest, RequestStatus, TimeEntry, VenuePosition, ShiftEvent, TimeEntryEdit,
    Rating, ShiftOffer,
)
from src.schemas import (
    VenueCreate, VenueUpdateSettings, VenueResponse,
    WhitelistAddRequest, WhitelistResponse,
    ShiftResponse, ShiftRequestResponse,
    WorkerContactSchema, ShiftRosterResponse, UserBrief,
    WorkerReliability, VenueEventResponse, EventPosition, RosterPerson, PositionOffer,
    VenuePositionCreate, VenuePositionUpdate, VenuePositionResponse,
    VenueDirectoryItem, VenueProfileResponse, PublicVenueEvent
```

**Edit 2.** Find:
```python
    if existing:
        existing.is_active = True
        existing.notes = wl_in.notes or existing.notes
        await db.commit()
```
Replace with:
```python
    if existing:
        existing.is_active = True
        existing.status = "active"          # Phase 29
        existing.notes = wl_in.notes or existing.notes
        await db.commit()
```

**Edit 3.** Find:
```python
                avatar_url=worker.avatar_url,
                bio=worker.bio,
                aggregate_rating=rating
            )
            workers_by_shift[req.shift_id].append(contact)
```
Replace with:
```python
                avatar_url=worker.avatar_url,
                bio=worker.bio,
                aggregate_rating=rating,
                rating_count=int(worker.rating_count or 0),   # Phase 29
            )
            workers_by_shift[req.shift_id].append(contact)
```

**Edit 4.** Find:
```python
    clock_state = {(sid, wid): (n > 0, n_out > 0 and n_out >= n) for sid, wid, n, n_out in te_rows}

    assigned_by_shift = defaultdict(list)
    requested_by_shift = defaultdict(list)
```
Replace with:
```python
    clock_state = {(sid, wid): (n > 0, n_out > 0 and n_out >= n) for sid, wid, n, n_out in te_rows}

    # Phase 29: this venue's rating for each booking, and offers per position
    req_ids = [req.id for req, _ in req_rows]
    ratings_by_req = {
        r.shift_request_id: r for r in (await db.execute(
            select(Rating).where(Rating.shift_request_id.in_(req_ids))
        )).scalars().all()
    } if req_ids else {}
    offers_by_shift = defaultdict(list)
    recent_cutoff = now_utc - timedelta(days=7)
    for o, ou in (await db.execute(
        select(ShiftOffer, User)
        .join(User, User.id == ShiftOffer.worker_id)
        .where(ShiftOffer.shift_id.in_(shift_ids))
        .order_by(ShiftOffer.created_at.asc())
    )).all():
        if o.status != "pending" and (o.responded_at is None or o.responded_at < recent_cutoff):
            continue
        offers_by_shift[o.shift_id].append(PositionOffer(
            offer_id=o.id, worker_id=o.worker_id, first_name=ou.first_name or "", last_name=ou.last_name or "",
            status=o.status, created_at=o.created_at, responded_at=o.responded_at,
        ))

    assigned_by_shift = defaultdict(list)
    requested_by_shift = defaultdict(list)
```

**Edit 5.** Find:
```python
            clocked_out=clocked_out or req.check_out_time is not None,
            note=req.notes,
        )
        if person.status in ASSIGNED_STATUSES:
```
Replace with:
```python
            clocked_out=clocked_out or req.check_out_time is not None,
            note=req.notes,
            rating_count=int(worker.rating_count or 0),
            my_rating=ratings_by_req[req.id].rating if req.id in ratings_by_req else None,
            would_book_again=ratings_by_req[req.id].would_book_again if req.id in ratings_by_req else None,
            rating_review=ratings_by_req[req.id].review if req.id in ratings_by_req else None,
            approval_source=req.approval_source,
        )
        if person.status in ASSIGNED_STATUSES:
```

**Edit 6.** Find:
```python
            assigned=assigned_by_shift[s.id],
            requested=requested_by_shift[s.id],
        ))

```
Replace with:
```python
            assigned=assigned_by_shift[s.id],
            requested=requested_by_shift[s.id],
            offers=offers_by_shift[s.id],
        ))

```

---

## B12. `backend/src/routers/admin.py` (EDITS)
Editing a worker's venues no longer deletes removed/blocked rows or notes of venues that stay ticked.

**Edit 1.** Find:
```python
                        db.add(VenueManager(venue_id=v.id, user_id=new_user.id, is_primary=False))
                    elif role_clean == "worker":
                        db.add(VenueWhitelist(venue_id=v.id, worker_id=new_user.id, is_active=True))

        await db.commit()
```
Replace with:
```python
                        db.add(VenueManager(venue_id=v.id, user_id=new_user.id, is_primary=False))
                    elif role_clean == "worker":
                        db.add(VenueWhitelist(venue_id=v.id, worker_id=new_user.id, is_active=True, status="active", source="admin"))

        await db.commit()
```

**Edit 2.** Find:
```python
        if rebuild_venues:
            await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
            await db.execute(delete(VenueWhitelist).where(VenueWhitelist.worker_id == user.id))
            for idx, vid in enumerate(target_ids):
                if new_role == "venue_manager":
                    db.add(VenueManager(venue_id=vid, user_id=user.id, is_primary=(idx == 0)))
                elif new_role == "worker":
                    db.add(VenueWhitelist(venue_id=vid, worker_id=user.id, is_active=True))

        await db.commit()
```
Replace with:
```python
        if rebuild_venues:
            await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
            # Phase 29: keep team notes / positions / blocks. Only ACTIVE team rows for venues that were
            # unticked are deleted (as before); removed/blocked rows are kept; ticked venues are (re)activated.
            wl_rows = {
                r.venue_id: r for r in (await db.execute(
                    select(VenueWhitelist).where(VenueWhitelist.worker_id == user.id)
                )).scalars().all()
            }
            for vid, r in wl_rows.items():
                if (new_role != "worker" or vid not in target_ids) and (r.status or "active") == "active":
                    await db.delete(r)
            for idx, vid in enumerate(target_ids):
                if new_role == "venue_manager":
                    db.add(VenueManager(venue_id=vid, user_id=user.id, is_primary=(idx == 0)))
                elif new_role == "worker":
                    existing_wl = wl_rows.get(vid)
                    if existing_wl is not None:
                        existing_wl.status = "active"
                        existing_wl.is_active = True
                    else:
                        db.add(VenueWhitelist(venue_id=vid, worker_id=user.id, is_active=True, status="active", source="admin"))

        await db.commit()
```

---

## B13. `backend/src/main.py` (EDITS)
Router imports and `include_router` lines only. **Do not touch the CORS block.**

**Edit 1.** Find:
```python
from src.routers.locations import router as locations_router
from src.routers.notifications import router as notifications_router
from src.services.notification_worker import notification_worker_loop

```
Replace with:
```python
from src.routers.locations import router as locations_router
from src.routers.notifications import router as notifications_router
from src.routers.team import router as team_router
from src.routers.invites import router as invites_router
from src.routers.staffing import router as staffing_router
from src.services.notification_worker import notification_worker_loop

```

**Edit 2.** Find:
```python
app.include_router(locations_router)
app.include_router(notifications_router)


```
Replace with:
```python
app.include_router(locations_router)
app.include_router(notifications_router)
app.include_router(team_router)
app.include_router(invites_router)
app.include_router(staffing_router)


```

---

# PART C: Frontend

## C1. NEW FILE `frontend/src/components/RatingBadge.jsx`

```jsx
import React from 'react';
import { Star } from 'lucide-react';

/**
 * Phase 29: A worker's rating. Shows "New" until they have a real rating (rating_count 0),
 * instead of the old default ★ 5.0.
 */
export default function RatingBadge({ rating, count, showCount = true, className = '' }) {
  const n = Number(count || 0);
  if (!n) {
    return (
      <span
        title="No ratings yet"
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 whitespace-nowrap ${className}`}
      >
        New
      </span>
    );
  }
  return (
    <span
      title={`${Number(rating || 0).toFixed(2)} average from ${n} rating${n === 1 ? '' : 's'}`}
      className={`inline-flex items-center gap-1 text-amber-400 text-xs font-bold whitespace-nowrap ${className}`}
    >
      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
      {Number(rating || 0).toFixed(1)}
      {showCount && <span className="text-amber-500/70 font-semibold">({n})</span>}
    </span>
  );
}
```

---

## C2. NEW FILE `frontend/src/components/RateWorker.jsx`

```jsx
import React, { useState } from 'react';
import { Star, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react';
import api from '../api/client';

/**
 * Phase 29: Rate one finished booking (1-5 stars + "Would book again?").
 * Ratings are private to the venue's managers; only the worker's average is shown elsewhere.
 * Props: venueId, person (RosterPerson), onSaved(result)
 */
export default function RateWorker({ venueId, person, onSaved }) {
  const [stars, setStars] = useState(person.my_rating || 0);
  const [hover, setHover] = useState(0);
  const [again, setAgain] = useState(person.would_book_again ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (nextStars, nextAgain) => {
    if (!nextStars) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/venues/${venueId}/ratings/${person.request_id}`, {
        rating: nextStars,
        would_book_again: nextAgain,
      });
      if (onSaved) onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save the rating.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.delete(`/venues/${venueId}/ratings/${person.request_id}`);
      setStars(0);
      setAgain(null);
      if (onSaved) onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove the rating.');
    } finally {
      setSaving(false);
    }
  };

  const pickStars = (n) => {
    setStars(n);
    save(n, again);
  };
  const pickAgain = (v) => {
    const next = again === v ? null : v;
    setAgain(next);
    if (stars) save(stars, next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-800">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rate</span>
      <div className="flex items-center" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={saving}
            onMouseEnter={() => setHover(n)}
            onClick={() => pickStars(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className="p-0.5 disabled:opacity-50"
          >
            <Star className={`w-4 h-4 ${(hover || stars) >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
          </button>
        ))}
      </div>
      <span className="text-[11px] text-slate-400">Would book again?</span>
      <button
        type="button"
        disabled={saving || !stars}
        onClick={() => pickAgain(true)}
        title={stars ? 'Yes' : 'Pick stars first'}
        className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 disabled:opacity-40 ${
          again === true ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}
      >
        <ThumbsUp className="w-3 h-3" /> Yes
      </button>
      <button
        type="button"
        disabled={saving || !stars}
        onClick={() => pickAgain(false)}
        title={stars ? 'No' : 'Pick stars first'}
        className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 disabled:opacity-40 ${
          again === false ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}
      >
        <ThumbsDown className="w-3 h-3" /> No
      </button>
      {person.my_rating && (
        <button type="button" onClick={clear} disabled={saving} title="Remove rating"
          className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      {saving && <span className="text-[10px] text-slate-500">Saving…</span>}
      {error && <span className="text-[11px] text-rose-400">{error}</span>}
    </div>
  );
}
```

---

## C3. NEW FILE `frontend/src/components/StaffPositionModal.jsx`

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, Search, Send, Check, AlertTriangle, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';

const MAX_OFFER = 5;

/**
 * Phase 29: Fill a position with specific people.
 *   Assign  -> books that person now (they get a notification).
 *   Offer   -> sends the position to 1-5 people; the first to accept is booked.
 * Props: event (VenueEventResponse), position (EventPosition), onClose, onDone(message)
 */
export default function StaffPositionModal({ event, position, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);   // worker ids
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);          // 'offer' | `assign-${id}`
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState([]);

  const spotsLeft = Math.max(0, (position.capacity || 1) - (position.assigned?.length || 0));
  const started = new Date(event.start_time).getTime() <= Date.now();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/shifts/${position.shift_id}/candidates`, { params: debouncedQ ? { q: debouncedQ } : {} })
      .then((res) => active && setCandidates(res.data || []))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load people.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [position.shift_id, debouncedQ]);

  const selectable = (c) => (c.available || c.requested_this) && !c.offered;
  const toggle = (c) => {
    if (!selectable(c)) return;
    setSelected((prev) => {
      if (prev.includes(c.worker_id)) return prev.filter((x) => x !== c.worker_id);
      if (prev.length >= MAX_OFFER) return prev;
      return [...prev, c.worker_id];
    });
  };

  const assign = async (c) => {
    setBusy(`assign-${c.worker_id}`);
    setError('');
    try {
      const res = await api.post(`/shifts/${position.shift_id}/assign`, { worker_id: c.worker_id });
      onDone(res.data.message);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not assign.');
    } finally {
      setBusy(null);
    }
  };

  const sendOffers = async () => {
    setBusy('offer');
    setError('');
    setSkipped([]);
    try {
      const res = await api.post(`/shifts/${position.shift_id}/offers`, {
        worker_ids: selected,
        message: message.trim() || null,
      });
      if (res.data.offered > 0) {
        const extra = res.data.skipped?.length ? ` (${res.data.skipped.length} skipped)` : '';
        onDone(res.data.message + extra);
      } else {
        setSkipped(res.data.skipped || []);
        setError(res.data.message || 'No offers sent.');
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send the offers.');
    } finally {
      setBusy(null);
    }
  };

  const nameOf = useMemo(() => {
    const m = {};
    candidates.forEach((c) => {
      m[c.worker_id] = `${c.first_name} ${c.last_name}`.trim() || c.email;
    });
    return m;
  }, [candidates]);

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Close
      </button>
      <button
        type="button"
        onClick={sendOffers}
        disabled={!selected.length || busy !== null || started}
        title={started ? 'This shift has started. Use Assign.' : ''}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
      >
        <Send className="w-4 h-4" />
        {busy === 'offer' ? 'Sending…' : selected.length ? `Offer to ${selected.length} selected` : 'Offer to selected'}
      </button>
    </>
  );

  return (
    <ModalShell
      title={`Fill ${position.role_type}`}
      subtitle={`${event.title} · ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
      icon={<UserPlus className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={footer}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          <strong className="text-slate-200">Assign</strong> books someone right now.{' '}
          <strong className="text-slate-200">Offer</strong> sends it to up to {MAX_OFFER} people at once; the first to accept gets it
          and the other offers close.
        </p>

        {error && (
          <div className="p-3 rounded-xl text-sm border bg-rose-950/60 border-rose-700 text-rose-200">
            {error}
            {skipped.length > 0 && (
              <ul className="mt-1 text-xs list-disc pl-5">
                {skipped.map((s) => (
                  <li key={s.worker_id}>{s.name}: {s.reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your team, or anyone by name or email"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 py-6 text-center">Loading…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            {debouncedQ ? 'No one matches.' : 'No one on your team yet. Invite people from the Team page, or search by name.'}
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => {
              const isSel = selected.includes(c.worker_id);
              const canPick = selectable(c);
              return (
                <div
                  key={c.worker_id}
                  className={`p-3 rounded-xl border flex flex-wrap items-center gap-3 ${
                    isSel ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-950'
                  } ${canPick ? '' : 'opacity-70'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    disabled={!canPick || (!isSel && selected.length >= MAX_OFFER)}
                    onChange={() => toggle(c)}
                    aria-label={`Select ${nameOf[c.worker_id]}`}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">{nameOf[c.worker_id]}</span>
                      <RatingBadge rating={c.aggregate_rating} count={c.rating_count} />
                      {c.reliability_score !== null && c.reliability_score !== undefined && (
                        <span className="text-[10px] text-slate-400">{Math.round(c.reliability_score)}% reliable</span>
                      )}
                      {c.position_match && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-0.5">
                          <Check className="w-3 h-3" /> {position.role_type}
                        </span>
                      )}
                      {!c.on_team && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">Not on team</span>
                      )}
                      {c.requested_this && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">Requested this</span>
                      )}
                      {c.offered && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 inline-flex items-center gap-0.5">
                          <Clock className="w-3 h-3" /> Offer waiting
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {c.venue_shifts > 0 ? `${c.venue_shifts} shift${c.venue_shifts === 1 ? '' : 's'} here` : 'Hasn’t worked here yet'}
                      {c.positions?.length > 0 && ` · ${c.positions.join(', ')}`}
                    </div>
                    {c.reason && (
                      <div className="text-[11px] text-amber-300 mt-0.5 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {c.reason}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => assign(c)}
                    disabled={!(c.available || c.requested_this) || busy !== null || spotsLeft === 0}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-slate-700 text-xs font-bold disabled:opacity-40"
                  >
                    {busy === `assign-${c.worker_id}` ? '…' : c.requested_this ? 'Approve' : 'Assign'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Message with the offer (optional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. We're short on the main bar. Can you help?"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">{selected.length}/{MAX_OFFER} selected.</p>
        </div>
      </div>
    </ModalShell>
  );
}
```

---

## C4. NEW FILE `frontend/src/components/TeamModal.jsx`

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
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
// Members tab
// ---------------------------------------------------------------------------------------------
function MemberCard({ m, venueId, positionOptions, onUpdated, onMessage }) {
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(m.positions || []);
  const [notes, setNotes] = useState(m.notes || '');
  const [confirm, setConfirm] = useState(null); // 'blocked' | 'removed'
  const [busy, setBusy] = useState(false);
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
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const here = m.venue_rating_count > 0
    ? `Here: ★ ${Number(m.venue_rating).toFixed(1)} (${m.venue_rating_count})`
    : null;
  const again = m.would_book_again_yes + m.would_book_again_no > 0
    ? `Would book again ${m.would_book_again_yes}/${m.would_book_again_yes + m.would_book_again_no}`
    : null;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">{name}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_CHIP[m.status] || STATUS_CHIP.active}`}>
              {m.status === 'active' ? 'On team' : m.status === 'removed' ? 'Removed' : 'Blocked'}
            </span>
            <RatingBadge rating={m.aggregate_rating} count={m.rating_count} />
            <ReliabilityBadge data={m.reliability} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-1">
            {m.phone && <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{m.phone}</a>}
            {m.email && <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Mail className="w-3 h-3" />{m.email}</a>}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {m.shifts_worked} shift{m.shifts_worked === 1 ? '' : 's'} here
            {m.last_worked && ` · last ${fmtShortDate(m.last_worked)}`}
            {m.upcoming > 0 && ` · ${m.upcoming} upcoming`}
            {here && ` · ${here}`}
            {again && ` · ${again}`}
            {` · ${SOURCE_LABEL[m.source] || ''}`}
          </div>
          {m.positions?.length > 0 && !editing && (
            <div className="flex flex-wrap gap-1 mt-2">
              {m.positions.map((p) => (
                <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p}</span>
              ))}
            </div>
          )}
          {m.notes && !editing && (
            <p className="text-xs text-slate-300 mt-2 whitespace-pre-line bg-slate-900 border border-slate-800 rounded-lg p-2">
              <span className="text-slate-500 font-semibold">Private note: </span>{m.notes}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!editing && (
            <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
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
      </div>

      {confirm && (
        <div className="mt-3 p-3 rounded-xl border border-rose-600/40 bg-rose-500/5 text-xs text-rose-100 flex flex-wrap items-center gap-2">
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
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
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
    </div>
  );
}

function AddPeoplePanel({ venueId, positionOptions, onAdded, onMessage, onGoInvite }) {
  const [mode, setMode] = useState('create'); // 'create' | 'existing'
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'existing') {
        await api.post(`/venues/${venueId}/team`, { email: form.email, positions: form.positions });
        onMessage({ type: 'success', text: `${form.email} added to the team.` });
        setForm({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
      } else {
        const res = await api.post(`/venues/${venueId}/team/accounts`, form);
        setResult(res.data);
      }
      onAdded();
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not add them.' });
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <TempPassword
        result={result}
        onDone={() => {
          setResult(null);
          setForm({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} className={`${cardCls} space-y-3`}>
      <div className="flex flex-wrap gap-2">
        {[
          ['create', 'Create an account for them'],
          ['existing', 'They already have an account'],
        ].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMode(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === id ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
            {label}
          </button>
        ))}
        <button type="button" onClick={onGoInvite} className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-slate-800 text-slate-400 border-slate-700">
          Send an invite instead
        </button>
      </div>
      {mode === 'create' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
          <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          <input className={inputCls} placeholder="Mobile (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </div>
      )}
      {mode === 'existing' && (
        <input className={inputCls} type="email" placeholder="Their ShiftBoard email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">Positions</label>
        <PositionPicker options={positionOptions} value={form.positions} onChange={(v) => set('positions', v)} />
      </div>
      <p className="text-[11px] text-slate-500">
        {mode === 'create'
          ? 'Creates a worker account with a temporary password you give them. If the email already has an account, they are just added to your team.'
          : 'Adds an existing worker account to your team.'}
      </p>
      <button type="submit" className={btnPrimary} disabled={busy}>
        <UserPlus className="w-4 h-4" /> {busy ? 'Saving…' : mode === 'create' ? 'Create account' : 'Add to team'}
      </button>
    </form>
  );
}

function MembersTab({ venueId, positionOptions, onChanged, onMessage, onGoInvite }) {
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, position" className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="active">On team</option>
          <option value="removed">Removed</option>
          <option value="blocked">Blocked</option>
          <option value="all">Everyone</option>
        </select>
        <button type="button" className={btnPrimary} onClick={() => setAdding((a) => !a)}>
          <UserPlus className="w-4 h-4" /> {adding ? 'Close' : 'Add people'}
        </button>
      </div>

      {adding && (
        <AddPeoplePanel
          venueId={venueId}
          positionOptions={positionOptions}
          onAdded={() => { setTick((t) => t + 1); onChanged(); }}
          onMessage={onMessage}
          onGoInvite={onGoInvite}
        />
      )}

      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">
          {filter === 'active' ? 'No one on the team yet. Add people or share your team link.' : 'No one here.'}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">{shown.length} {shown.length === 1 ? 'person' : 'people'}</p>
          {shown.map((m) => (
            <MemberCard key={m.worker_id} m={m} venueId={venueId} positionOptions={positionOptions} onUpdated={updated} onMessage={onMessage} />
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
 * Props: venue ({id, name}), positions (venue positions [{name}]), onClose, onChanged
 */
export default function TeamModal({ venue, positions = [], onClose, onChanged }) {
  const [tab, setTab] = useState('members');
  const [msg, setMsg] = useState(null);
  const positionOptions = useMemo(() => (positions || []).map((p) => p.name).filter(Boolean), [positions]);
  const changed = () => onChanged && onChanged();

  const tabs = [
    ['members', 'Team', Users],
    ['invite', 'Invite', Send],
    ['managers', 'Managers', ShieldCheck],
  ];

  const headerExtra = (
    <div className="flex flex-wrap gap-2">
      {tabs.map(([id, label, Icon]) => (
        <button key={id} type="button" onClick={() => { setTab(id); setMsg(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 ${
            tab === id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}>
          <Icon className="w-3.5 h-3.5" /> {label}
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
        <MembersTab venueId={venue.id} positionOptions={positionOptions} onChanged={changed} onMessage={setMsg} onGoInvite={() => setTab('invite')} />
      )}
      {tab === 'invite' && (
        <InviteTab venueId={venue.id} venueName={venue.name} positionOptions={positionOptions} onMessage={setMsg} />
      )}
      {tab === 'managers' && <ManagersTab venueId={venue.id} onMessage={setMsg} />}
    </ModalShell>
  );
}
```

---

## C5. NEW FILE `frontend/src/components/WorkerOffers.jsx`

```jsx
import React from 'react';
import { Send, MapPin, Check, X, Users } from 'lucide-react';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

/**
 * Phase 29: Shifts a manager offered to you. First to accept gets it.
 * Props: offers (WorkerOffer[]), busyId, onAccept(offer), onDecline(offer)
 */
export default function WorkerOffers({ offers = [], busyId, onAccept, onDecline }) {
  if (!offers.length) return null;
  return (
    <div className="mt-6 bg-indigo-500/5 border border-indigo-500/40 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-100">
        <Send className="w-4 h-4 text-indigo-300" />
        Offered to you ({offers.length})
      </div>
      {offers.map((o) => {
        const busy = busyId === o.offer_id;
        return (
          <div key={o.offer_id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{o.role_type}</span>
                <span className="text-sm font-bold text-white">{o.title}</span>
                <span className="text-xs text-slate-400">· {o.venue_name}</span>
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {fmtDate(o.start_time, o.venue_timezone)} · {fmtTimeRange(o.start_time, o.end_time, o.venue_timezone)}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                <PayLabel rate={o.hourly_rate} rateMax={o.hourly_rate_max} className="text-emerald-400 font-semibold" />
                <TipBadge shift={o} />
                {(o.location_name || o.address) && (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <MapPin className="w-3 h-3" /> {o.location_name || o.address}
                  </span>
                )}
              </div>
              {o.message && <div className="text-xs text-indigo-100 italic mt-1">“{o.message}”{o.offered_by ? ` · ${o.offered_by}` : ''}</div>}
              {o.others_offered > 0 && (
                <div className="text-[11px] text-amber-300 mt-1 inline-flex items-center gap-1">
                  <Users className="w-3 h-3" /> Also offered to {o.others_offered} other{o.others_offered === 1 ? '' : 's'}: first to accept gets it.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onAccept(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Check className="w-4 h-4" /> {busy ? '…' : 'Accept'}
              </button>
              <button type="button" onClick={() => onDecline(o)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <X className="w-4 h-4" /> Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

---

## C6. NEW FILE `frontend/src/pages/JoinPage.jsx`

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Calendar, Building2, MapPin, Check, AlertTriangle, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export const PENDING_INVITE_KEY = 'shiftboard_pending_invite';

function remember(token) {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, token);
  } catch (e) {
    /* storage blocked: the router state still carries the invite */
  }
}
function forget() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Phase 29: /join/:token (team link, QR code or personal invite).
 * Signed out -> preview + Create account / Sign in (returns here afterwards).
 * Signed in as a worker -> joins automatically.
 */
export default function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [invite, setInvite] = useState(null);
  const [state, setState] = useState('loading'); // loading | preview | joining | joined | error
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(null);
  const tried = useRef(false);
  const role = (user?.role || '').toLowerCase();

  useEffect(() => {
    let active = true;
    api
      .get(`/invites/${token}`)
      .then((res) => {
        if (!active) return;
        setInvite(res.data);
        if (res.data.valid) remember(token);
        else forget();
        setState('preview');
      })
      .catch(() => {
        if (!active) return;
        setError('Could not load this invite. Check your connection and try again.');
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [token]);

  // A manager/admin opened a worker invite: don't keep bouncing them back here
  useEffect(() => {
    if (!loading && isAuthenticated && role !== 'worker') forget();
  }, [loading, isAuthenticated, role]);

  useEffect(() => {
    if (loading || !isAuthenticated || role !== 'worker' || !invite?.valid || tried.current) return;
    tried.current = true;
    setState('joining');
    api
      .post(`/invites/${token}/accept`)
      .then((res) => {
        forget();
        setJoined(res.data);
        setState('joined');
      })
      .catch((err) => {
        forget();
        setError(err.response?.data?.detail || 'Could not join the team.');
        setState('error');
      });
  }, [loading, isAuthenticated, role, invite, token]);

  const goLogin = (mode) =>
    navigate('/login', {
      state: { from: { pathname: `/join/${token}` }, mode, inviteVenue: invite?.venue_name || null },
    });

  const shell = (children) => (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 px-4 text-slate-100">
      <div className="text-center mb-6">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-3">
          <Calendar className="w-7 h-7 text-slate-950" />
        </div>
        <h1 className="text-2xl font-extrabold text-white">
          Shift<span className="text-emerald-400">Board</span>
        </h1>
      </div>
      <div className="w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">{children}</div>
    </div>
  );

  if (state === 'loading' || loading) return shell(<p className="text-sm text-slate-400 text-center">Loading invite…</p>);

  if (state === 'error' && !invite?.valid && !joined) {
    return shell(
      <>
        <div className="flex items-start gap-2 text-rose-200 text-sm"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error || invite?.reason}</div>
        <Link to="/" className="block text-center text-sm text-emerald-400 hover:underline">Go to ShiftBoard</Link>
      </>
    );
  }

  const venueHeader = invite?.venue_name && (
    <div className="flex items-center gap-3">
      {invite.logo_url ? (
        <img src={invite.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover bg-slate-800" />
      ) : (
        <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950">
          <Building2 className="w-6 h-6" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-lg font-bold text-white truncate">{invite.venue_name}</div>
        {invite.venue_address && (
          <div className="text-xs text-slate-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {invite.venue_address}</div>
        )}
      </div>
    </div>
  );

  if (!invite?.valid && state !== 'joined') {
    return shell(
      <>
        {venueHeader}
        <div className="flex items-start gap-2 text-amber-200 text-sm"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {invite?.reason}</div>
        <Link to="/" className="block text-center text-sm text-emerald-400 hover:underline">Go to ShiftBoard</Link>
      </>
    );
  }

  if (state === 'joined') {
    return shell(
      <>
        {venueHeader}
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-100 text-sm flex items-start gap-2">
          <Check className="w-5 h-5 flex-shrink-0" />
          {joined?.already_member ? `You're already on the ${joined.venue_name} team.` : `You're on the ${joined?.venue_name} team.`}
          {' '}You'll see their shifts in Find Shifts and get alerts when they post new ones.
        </div>
        <button type="button" onClick={() => navigate('/worker', { replace: true })}
          className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm">
          See open shifts
        </button>
      </>
    );
  }

  if (state === 'error') {
    return shell(
      <>
        {venueHeader}
        <div className="flex items-start gap-2 text-rose-200 text-sm"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}</div>
        <Link to="/" className="block text-center text-sm text-emerald-400 hover:underline">Go to ShiftBoard</Link>
      </>
    );
  }

  if (isAuthenticated && role !== 'worker') {
    return shell(
      <>
        {venueHeader}
        <p className="text-sm text-slate-300">
          You're signed in as <strong>{user?.email}</strong>, which is a {role === 'venue_manager' ? 'manager' : 'admin'} account.
          Team invites are for worker accounts. Sign out, then open this link again to sign in or create a worker account.
        </p>
        <button type="button" onClick={() => logout()}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </>
    );
  }

  if (state === 'joining') return shell(<>{venueHeader}<p className="text-sm text-slate-400">Joining the team…</p></>);

  return shell(
    <>
      {venueHeader}
      <p className="text-sm text-slate-200">
        {invite.first_name ? `Hi ${invite.first_name}! ` : ''}You're invited to join the <strong>{invite.venue_name}</strong> team on ShiftBoard:
        see their shifts, book them from your phone and get reminders.
      </p>
      {invite.positions?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {invite.positions.map((p) => (
            <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p}</span>
          ))}
        </div>
      )}
      <button type="button" onClick={() => goLogin('register')}
        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm">
        Create my account
      </button>
      <button type="button" onClick={() => goLogin('signin')}
        className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm">
        I already have an account
      </button>
      {invite.email && <p className="text-[11px] text-slate-500 text-center">Invite sent to {invite.email}. Use that email if you can.</p>}
    </>
  );
}
```

---

## C7. `frontend/src/App.jsx` (EDITS)
Public route `/join/:token` (no `ProtectedRoute`, no Navbar).

**Edit 1.** Find:
```jsx
import VenuesDirectory from './pages/VenuesDirectory';
import VenueProfile from './pages/VenueProfile';

function HomeRedirect() {
```
Replace with:
```jsx
import VenuesDirectory from './pages/VenuesDirectory';
import VenueProfile from './pages/VenueProfile';
import JoinPage from './pages/JoinPage';

function HomeRedirect() {
```

**Edit 2.** Find:
```jsx
            {/* Public Login & Register */}
            <Route path="/login" element={<LoginPage />} />

            {/* Smart Home Redirect */}
```
Replace with:
```jsx
            {/* Public Login & Register */}
            <Route path="/login" element={<LoginPage />} />

            {/* Phase 29: team invite link / QR code (works signed in or out) */}
            <Route path="/join/:token" element={<JoinPage />} />

            {/* Smart Home Redirect */}
```

---

## C8. `frontend/src/pages/LoginPage.jsx` (EDITS)
Opens in Create account mode and shows the invite banner when it comes from the join page. The sign-in logic itself is unchanged.

**Edit 1.** Find:
```jsx
  const location = useLocation();
  const from = location.state?.from?.pathname;

  useEffect(() => {
```
Replace with:
```jsx
  const location = useLocation();
  const from = location.state?.from?.pathname;
  const inviteVenue = location.state?.inviteVenue || null;   // Phase 29: came from a team invite

  // Phase 29: the invite page sends new people straight to "Create account"
  useEffect(() => {
    if (location.state?.mode === 'register') setMode('register');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
```

**Edit 2.** Find:
```jsx

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {mode === 'signin' && fbStatus.show_demo_logins && (
```
Replace with:
```jsx

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        {inviteVenue && (
          <div className="mb-4 p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-100 text-center">
            {mode === 'register' ? 'Create your account' : 'Sign in'} to join the <strong>{inviteVenue}</strong> team.
          </div>
        )}
        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {mode === 'signin' && fbStatus.show_demo_logins && (
```

---

## C9. `frontend/src/components/EventRosterModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin } from 'lucide-react';
import ModalShell from './ModalShell';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
import PayLabel from './PayLabel';
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const APPROVAL_LABEL = { venue_default: 'Venue default', auto: 'Instant booking', manual: 'Needs approval' };

function assignedChip(person) {
```
Replace with:
```jsx
import React, { useState } from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin, Send, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import RateWorker from './RateWorker';
import StaffPositionModal from './StaffPositionModal';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
import PayLabel from './PayLabel';
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const APPROVAL_LABEL = { venue_default: 'Venue default', auto: 'Instant booking', manual: 'Needs approval' };
const SOURCE_LABEL = { manager_assign: 'Assigned by manager', offer: 'Accepted an offer' };   // Phase 29
const OFFER_CHIP = {
  pending: { label: 'Waiting', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30' },
  accepted: { label: 'Accepted', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  declined: { label: 'Declined', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  filled: { label: 'Someone else took it', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  cancelled: { label: 'Withdrawn', cls: 'bg-slate-700/40 text-slate-400 border-slate-600/40' },
};
const RATEABLE = ['approved', 'confirmed', 'checked_in', 'completed'];

function assignedChip(person) {
```

**Edit 2.** Find:
```jsx
export default function EventRosterModal({
  event, onClose, reliabilityMap = {}, onApprove, onDeny, onOpenBoard, onEdit, onRemovePerson, onCancelPosition, actionLoading, timeZone,
}) {
  if (!event) return null;

  const subtitle = (
```
Replace with:
```jsx
export default function EventRosterModal({
  event, onClose, reliabilityMap = {}, onApprove, onDeny, onOpenBoard, onEdit, onRemovePerson, onCancelPosition, actionLoading, timeZone,
  venueId, onChanged,
}) {
  const [staffPos, setStaffPos] = useState(null);     // Phase 29: position being filled (Assign / Offer)
  const [flash, setFlash] = useState(null);           // Phase 29: { type, text }
  const [withdrawing, setWithdrawing] = useState(null);
  if (!event) return null;
  const ended = new Date(event.end_time).getTime() < Date.now();

  const withdrawOffer = async (offerId) => {
    setWithdrawing(offerId);
    try {
      await api.delete(`/offers/${offerId}`);
      setFlash({ type: 'success', text: 'Offer withdrawn.' });
      if (onChanged) onChanged();
    } catch (err) {
      setFlash({ type: 'error', text: err.response?.data?.detail || 'Could not withdraw the offer.' });
    } finally {
      setWithdrawing(null);
    }
  };

  const subtitle = (
```

**Edit 3.** Find:
```jsx
    >
      <div className="space-y-5">
        {event.positions.map((pos) => {
          const isFull = pos.assigned.length >= pos.capacity;
          return (
            <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
```
Replace with:
```jsx
    >
      <div className="space-y-5">
        {flash && (
          <div className={`p-3 rounded-xl text-sm border flex items-start justify-between gap-2 ${flash.type === 'success' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' : 'bg-rose-950/60 border-rose-700 text-rose-200'}`}>
            <span>{flash.text}</span>
            <button type="button" onClick={() => setFlash(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}
        {event.positions.map((pos) => {
          const isFull = pos.assigned.length >= pos.capacity;
          const canStaff = venueId && !event.cancelled && pos.status !== 'CANCELLED' && !isFull && !ended;
          return (
            <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
```

**Edit 4.** Find:
```jsx
                  <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>{pos.assigned.length} / {pos.capacity} filled</span>
                </div>
                {onCancelPosition && !event.cancelled && pos.status !== 'CANCELLED' && (
                  <button type="button" onClick={() => onCancelPosition(pos, event)}
```
Replace with:
```jsx
                  <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>{pos.assigned.length} / {pos.capacity} filled</span>
                </div>
                {canStaff && (
                  <button type="button" onClick={() => setStaffPos(pos)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600 text-emerald-300 hover:text-white text-xs font-bold border border-emerald-600/30 inline-flex items-center gap-1">
                    <UserPlus className="w-3 h-3" /> Assign / Offer
                  </button>
                )}
                {onCancelPosition && !event.cancelled && pos.status !== 'CANCELLED' && (
                  <button type="button" onClick={() => onCancelPosition(pos, event)}
```

**Edit 5.** Find:
```jsx
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
```
Replace with:
```jsx
                        const chip = assignedChip(p);
                        return (
                          <div key={p.request_id} className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              {SOURCE_LABEL[p.approval_source] && (
                                <div className="text-[10px] text-slate-500">{SOURCE_LABEL[p.approval_source]}</div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
                                {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Mail className="w-3 h-3" />{p.email}</a>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
```

**Edit 6.** Find:
```jsx
                              )}
                            </div>
                          </div>
                        );
```
Replace with:
```jsx
                              )}
                            </div>
                          </div>
                          {venueId && ended && RATEABLE.includes(p.status) && (
                            <RateWorker venueId={venueId} person={p} onSaved={() => onChanged && onChanged()} />
                          )}
                          </div>
                        );
```

**Edit 7.** Find:
```jsx
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              <button type="button" onClick={() => onApprove && onApprove(p.request_id)} disabled={isFull || approving || denying}
```
Replace with:
```jsx
                            </div>
                            <div className="flex items-center gap-2">
                              <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              <button type="button" onClick={() => onApprove && onApprove(p.request_id)} disabled={isFull || approving || denying}
```

**Edit 8.** Find:
```jsx
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
```
Replace with:
```jsx
                  )}
                </div>

                {pos.offers && pos.offers.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-indigo-400" /> Offers ({pos.offers.filter((o) => o.status === 'pending').length} waiting)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pos.offers.map((o) => {
                        const oc = OFFER_CHIP[o.status] || OFFER_CHIP.pending;
                        return (
                          <span key={o.offer_id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border ${oc.cls}`}>
                            {o.status === 'pending' && <Clock className="w-3 h-3" />}
                            <span className="font-semibold">{o.first_name} {o.last_name}</span>
                            <span className="opacity-80">· {oc.label}</span>
                            {o.status === 'pending' && (
                              <button type="button" onClick={() => withdrawOffer(o.offer_id)} disabled={withdrawing === o.offer_id}
                                title="Withdraw this offer" className="ml-0.5 hover:text-white disabled:opacity-40">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {staffPos && (
        <StaffPositionModal
          event={event}
          position={staffPos}
          onClose={() => setStaffPos(null)}
          onDone={(message) => {
            setStaffPos(null);
            setFlash({ type: 'success', text: message });
            if (onChanged) onChanged();
          }}
        />
      )}
    </ModalShell>
  );
```

---

## C10. `frontend/src/components/PostedShiftsBoard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
  openEventId = null,      // Phase 28: open this event's roster once it loads (notification link)
  onOpenedEvent,
}) {
  const [scope, setScope] = useState('upcoming');
```
Replace with:
```jsx
  openEventId = null,      // Phase 28: open this event's roster once it loads (notification link)
  onOpenedEvent,
  onDataChanged,           // Phase 29: after assign / offer / rating (parent reloads, which bumps refreshKey)
}) {
  const [scope, setScope] = useState('upcoming');
```

**Edit 2.** Find:
```jsx
  const [menuKey, setMenuKey] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null); // `${venueId}|${scope}` of the events in state

  useEffect(() => {
```
Replace with:
```jsx
  const [menuKey, setMenuKey] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null); // `${venueId}|${scope}` of the events in state
  const [reloadTick, setReloadTick] = useState(0);   // Phase 29
  const handleChanged = () => (onDataChanged ? onDataChanged() : setReloadTick((t) => t + 1));

  useEffect(() => {
```

**Edit 3.** Find:
```jsx
      active = false;
    };
  }, [venueId, scope, refreshKey]);

  // Phase 28: open the event from a notification link (search 'all' if it's not in this list)
```
Replace with:
```jsx
      active = false;
    };
  }, [venueId, scope, refreshKey, reloadTick]);

  // Phase 28: open the event from a notification link (search 'all' if it's not in this list)
```

**Edit 4.** Find:
```jsx
          actionLoading={actionLoading}
          timeZone={timeZone}
        />
      )}
```
Replace with:
```jsx
          actionLoading={actionLoading}
          timeZone={timeZone}
          venueId={venueId}
          onChanged={handleChanged}
        />
      )}
```

---

## C11. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
  Calendar as CalendarIcon, Clock, DollarSign, Users, Plus, Trash2, Check, X,
  Building2, Star, AlertCircle, ShieldCheck, Zap, ArrowRight,
  Download, ArrowRightLeft, MessageSquare, FileText, List as ListIcon, Settings
} from 'lucide-react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
```
Replace with:
```jsx
  Calendar as CalendarIcon, Clock, DollarSign, Users, Plus, Trash2, Check, X,
  Building2, Star, AlertCircle, ShieldCheck, Zap, ArrowRight,
  Download, ArrowRightLeft, MessageSquare, FileText, List as ListIcon, Settings, UserPlus
} from 'lucide-react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
```

**Edit 2.** Find:
```jsx
import TimesheetModal from '../components/TimesheetModal';
import PayLabel from '../components/PayLabel';
import { zonedLocalToUtcIso, fmtShortDate } from '../utils/venueTime';

```
Replace with:
```jsx
import TimesheetModal from '../components/TimesheetModal';
import PayLabel from '../components/PayLabel';
import TeamModal from '../components/TeamModal';
import RatingBadge from '../components/RatingBadge';
import { zonedLocalToUtcIso, fmtShortDate } from '../utils/venueTime';

```

**Edit 3.** Find:
```jsx
  const [timesheetEventId, setTimesheetEventId] = useState(null);
  const [openTarget, setOpenTarget] = useState(null); // Phase 28: { venueId, eventId } from a notification link

  const fetchVenueData = async (venueId) => {
```
Replace with:
```jsx
  const [timesheetEventId, setTimesheetEventId] = useState(null);
  const [openTarget, setOpenTarget] = useState(null); // Phase 28: { venueId, eventId } from a notification link
  const [showTeam, setShowTeam] = useState(false);    // Phase 29: Team page

  const fetchVenueData = async (venueId) => {
```

**Edit 4.** Find:
```jsx
    const venue = searchParams.get('venue');
    const event = searchParams.get('event');
    if (!venue && !event) return;
    const targetVenue = venue || currentVenueId;
    if (venue && String(venue) !== String(currentVenueId)) {
```
Replace with:
```jsx
    const venue = searchParams.get('venue');
    const event = searchParams.get('event');
    const team = searchParams.get('team');          // Phase 29: ?team=1 opens the Team page
    if (!venue && !event && !team) return;
    const targetVenue = venue || currentVenueId;
    if (venue && String(venue) !== String(currentVenueId)) {
```

**Edit 5.** Find:
```jsx
    }
    if (event) setOpenTarget({ venueId: targetVenue, eventId: event });
    const next = new URLSearchParams(searchParams);
    next.delete('venue');
    next.delete('event');
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
```
Replace with:
```jsx
    }
    if (event) setOpenTarget({ venueId: targetVenue, eventId: event });
    if (team) setShowTeam(true);
    const next = new URLSearchParams(searchParams);
    next.delete('venue');
    next.delete('event');
    next.delete('team');
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
```

**Edit 6.** Find:
```jsx
            <button
              type="button"
              onClick={() => setShowVenueSettings(true)}
              disabled={!venueDetails}
```
Replace with:
```jsx
            <button
              type="button"
              onClick={() => setShowTeam(true)}
              disabled={!venueDetails}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4 text-emerald-400" />
              <span>Team</span>
            </button>

            <button
              type="button"
              onClick={() => setShowVenueSettings(true)}
              disabled={!venueDetails}
```

**Edit 7.** Find:
```jsx
                          {worker?.first_name} {worker?.last_name || 'Worker'}
                        </span>
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold border border-amber-500/20">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span>{Number(worker?.aggregate_rating || 5.0).toFixed(1)}</span>
                        </span>
                        <ReliabilityBadge data={reliabilityMap[worker?.id]} />
                        <span className="text-xs text-slate-500">
```
Replace with:
```jsx
                          {worker?.first_name} {worker?.last_name || 'Worker'}
                        </span>
                        <RatingBadge rating={worker?.aggregate_rating} count={worker?.rating_count} />
                        <ReliabilityBadge data={reliabilityMap[worker?.id]} />
                        <span className="text-xs text-slate-500">
```

**Edit 8.** Find:
```jsx
          openEventId={openTarget && String(openTarget.venueId) === String(currentVenueId) ? openTarget.eventId : null}
          onOpenedEvent={() => setOpenTarget(null)}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
```
Replace with:
```jsx
          openEventId={openTarget && String(openTarget.venueId) === String(currentVenueId) ? openTarget.eventId : null}
          onOpenedEvent={() => setOpenTarget(null)}
          onDataChanged={() => fetchVenueData(currentVenueId)}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
```

**Edit 9.** Find:
```jsx
      )}

      {showVenueSettings && venueDetails && (
        <VenueSettingsModal
```
Replace with:
```jsx
      )}

      {showTeam && venueDetails && (
        <TeamModal
          venue={venueDetails}
          positions={venuePositions}
          onClose={() => setShowTeam(false)}
          onChanged={() => fetchVenueData(currentVenueId)}
        />
      )}

      {showVenueSettings && venueDetails && (
        <VenueSettingsModal
```

---

## C12. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```
Replace with:
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
import WorkerCalendar from '../components/WorkerCalendar';
import ShiftDetailsModal from '../components/ShiftDetailsModal';
import { fmtDateTime, fmtTime } from '../utils/venueTime';
import {
```
Replace with:
```jsx
import WorkerCalendar from '../components/WorkerCalendar';
import ShiftDetailsModal from '../components/ShiftDetailsModal';
import WorkerOffers from '../components/WorkerOffers';
import RatingBadge from '../components/RatingBadge';
import { PENDING_INVITE_KEY } from './JoinPage';
import { fmtDateTime, fmtTime } from '../utils/venueTime';
import {
```

**Edit 3.** Find:
```jsx
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
```
Replace with:
```jsx
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [dropping, setDropping] = useState(false);
  const [offers, setOffers] = useState([]);              // Phase 29: shifts offered to me
  const [offerBusy, setOfferBusy] = useState(null);
  const navigate = useNavigate();

  const fetchWorkerData = async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, activeClocksRes, calendarRes, offersRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
        api.get('/transfers/my-incoming'),
        api.get('/shifts/time-entries/active').catch(() => ({ data: [] })),
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
        api.get('/me/offers').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setOffers(offersRes.data || []);
      setCalendar({
        items: calendarRes.data?.items || [],
```

**Edit 4.** Find:
```jsx

  useEffect(() => {
    fetchWorkerData();
  }, []);

  // Phase 26.1: withdraw a request that is still waiting for approval
```
Replace with:
```jsx

  useEffect(() => {
    // Phase 29: finish joining a team if they signed up from an invite link
    let pendingInvite = null;
    try {
      pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
    } catch (e) {
      pendingInvite = null;
    }
    if (pendingInvite) {
      navigate(`/join/${pendingInvite}`, { replace: true });
      return;
    }
    fetchWorkerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 29: accept / decline an offer
  const handleOffer = async (offer, action) => {
    setOfferBusy(offer.offer_id);
    try {
      const res = await api.post(`/offers/${offer.offer_id}/${action}`);
      setNotification({
        type: action === 'accept' ? 'success' : 'info',
        message: action === 'accept' ? res.data.message : 'Offer declined.',
      });
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Could not update the offer.' });
    } finally {
      setOfferBusy(null);
      fetchWorkerData(false);
    }
  };

  // Phase 26.1: withdraw a request that is still waiting for approval
```

**Edit 5.** Find:
```jsx
          {/* Quick Metrics */}
          <div className="flex items-center space-x-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-amber-400 text-sm font-bold">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              <span>{Number(user?.aggregate_rating || user?.rating_average || 5.0).toFixed(1)}</span>
            </div>
            <span className="text-slate-700">•</span>
```
Replace with:
```jsx
          {/* Quick Metrics */}
          <div className="flex items-center space-x-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
            <div className="flex items-center text-sm">
              <RatingBadge rating={user?.aggregate_rating ?? user?.rating_average} count={user?.rating_count} />
            </div>
            <span className="text-slate-700">•</span>
```

**Edit 6.** Find:
```jsx
          </div>
        </div>

        {/* TAB 1: Find Shifts (Phase 26.1: one card per event) */}
```
Replace with:
```jsx
          </div>
        </div>

        {/* Phase 29: shifts a manager offered to me (shown on every tab) */}
        <WorkerOffers
          offers={offers}
          busyId={offerBusy}
          onAccept={(o) => handleOffer(o, 'accept')}
          onDecline={(o) => handleOffer(o, 'decline')}
        />

        {/* TAB 1: Find Shifts (Phase 26.1: one card per event) */}
```

---

## C13. `frontend/src/components/Navbar.jsx` (EDITS)
"New" instead of ★ 5.0 for unrated workers.

**Edit 1.** Find:
```jsx
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
                <span className="text-amber-500/70">({user.rating_count || 0})</span>
              </div>
            )}
```
Replace with:
```jsx
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {user.rating_count ? (
                  <>
                    <span>{Number(user.rating_average || user.aggregate_rating || 0).toFixed(1)}</span>
                    <span className="text-amber-500/70">({user.rating_count})</span>
                  </>
                ) : (
                  <span>New</span>
                )}
              </div>
            )}
```

**Edit 2.** Find:
```jsx
              <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
              </div>
            )}
```
Replace with:
```jsx
              <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{user.rating_count ? Number(user.rating_average || user.aggregate_rating || 0).toFixed(1) : 'New'}</span>
              </div>
            )}
```

---

## C14. `frontend/src/components/TransferModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
                {eligibleWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.first_name} {w.last_name} ({w.email}) — ★ {Number(w.aggregate_rating || 5.0).toFixed(1)}
                  </option>
                ))}
```
Replace with:
```jsx
                {eligibleWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.first_name} {w.last_name} ({w.email}) — {w.rating_count ? `★ ${Number(w.aggregate_rating || 0).toFixed(1)}` : 'New'}
                  </option>
                ))}
```

---

## C15. `frontend/src/components/ShiftRosterModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            assignedWorkers.map((worker) => {
              const fullName = `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || 'Assigned Worker';
              const rating = Number(worker.aggregate_rating || 5.0).toFixed(1);

              return (
```
Replace with:
```jsx
            assignedWorkers.map((worker) => {
              const fullName = `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || 'Assigned Worker';
              const rating = worker.rating_count ? Number(worker.aggregate_rating || 0).toFixed(1) : 'New';   // Phase 29

              return (
```

---

## C16. `frontend/src/pages/AdminPanel.jsx` (EDIT)

**Edit 1.** Find:
```jsx
                          <td className="py-3.5 px-5">
                            <div className="flex items-center space-x-1.5 text-slate-300">
                              <span className="text-amber-400 font-bold">★ {Number(u.aggregate_rating || 5.0).toFixed(1)}</span>
                              <span className="text-slate-500 text-[11px]">({u.rating_count || 0})</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-400 text-[11px]">{u.total_shifts || 0} shifts</span>
```
Replace with:
```jsx
                          <td className="py-3.5 px-5">
                            <div className="flex items-center space-x-1.5 text-slate-300">
                              {u.rating_count ? (
                                <>
                                  <span className="text-amber-400 font-bold">★ {Number(u.aggregate_rating || 0).toFixed(1)}</span>
                                  <span className="text-slate-500 text-[11px]">({u.rating_count})</span>
                                </>
                              ) : (
                                <span className="text-sky-300 font-semibold text-[11px]">New</span>
                              )}
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-400 text-[11px]">{u.total_shifts || 0} shifts</span>
```

---

## E. Rebuild & verification

**Schema changed and a Python package was added (`segno`), so the backend image must rebuild.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS positions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manager';
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE venue_whitelists SET status = CASE WHEN is_active THEN 'active' ELSE 'removed' END;

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS would_book_again BOOLEAN;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_ratings_venue ON ratings(venue_id);

CREATE TABLE IF NOT EXISTS venue_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL DEFAULT 'personal',
    email VARCHAR(255),
    phone VARCHAR(30),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    positions TEXT[] NOT NULL DEFAULT '{}',
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    uses INT NOT NULL DEFAULT 0,
    accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_venue_invites_venue ON venue_invites(venue_id, kind);

CREATE TABLE IF NOT EXISTS shift_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL,
    offered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    message TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shift_offers_worker ON shift_offers(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_shift_offers_shift ON shift_offers(shift_id, status);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Notes**
* Invite links and QR codes use `APP_BASE_URL` (Phase 28 setting). On dev it must be `https://dev-scheduler.jaccollective.com`, or the QR code will point at localhost.
* People joining through an invite sign up with the normal sign-up. If `ALLOW_SELF_REGISTRATION=false`, new people can't create accounts from an invite. In that case use **Team → Add people → Create an account for them**. Existing accounts can always join.
* Seed workers keep their seeded ratings (e.g. ★ 4.8 (12)). New accounts show **New** until a manager rates them.

### Checklist
Manager: **demo_manager@shiftboard.com**, venue **The Hippodrome**.

1. **Team button:** it sits next to Venue Settings.
   * The Team tab lists Jordan (worker2, "Worked here").
   * worker1 (only a waiting request) isn't listed until added.
2. **Add people → Create an account for them:** Uma, uma@example.com, tag **Server**.
   * A 12-character temporary password shows once.
   * Signing in as Uma with it works, and she lands on the Worker dashboard with **New** instead of ★ 5.0.
3. **Edit** Uma: add the note "Trainee". It shows as "Private note: Trainee" and is never visible to workers.
4. **Block** Uma: confirm, and the message says she can't request, be offered or be assigned.
   * As Uma, Hippodrome shifts are gone from Find Shifts.
   * **Unblock** brings them back.
5. **Remove** Jordan (booked on Sunday Brunch):
   * The message says he's still booked on 1 upcoming shift.
   * He disappears from "On team" and shows under Removed.
   * Posting a new shift sends him no new-shift alert.
   * **Add back** restores him.
6. **Invite tab → Team link:**
   * The QR code, the link and **Copy** work, and **Download QR** saves an SVG.
   * **New link:** the old link now says "turned off by the venue".
7. **Scan the QR, or open the link in a private window:**
   * The venue card shows.
   * **Create my account** opens sign-up with the "to join The Hippodrome team" banner.
   * After signing up you're back on the join page: **"You're on The Hippodrome team"**, then **See open shifts**.
   * The manager's bell shows **"<name> joined your team"**, and it opens the Team page.
8. **Invite someone** with just an email:
   * The result reads "1 invited".
   * The Sent invites list shows **Pending** with Copy link, Resend and Turn off.
   * The email (or the `[email:console]` log) has the join link.
9. **CSV import:** a file with `name,email,phone,positions` and a row with a bad email.
   * The preview shows the count.
   * The results show "Invited." and "Email doesn't look right." rows, and an existing member shows "Already on your team".
10. **Managers tab:** add a co-manager with a new email.
    * A temporary password shows, and they can sign in and manage the venue.
    * Removing them loses their access.
    * You can't remove yourself.
    * A worker's email is refused.
11. **Assign:** open an upcoming event → a position → **Assign / Offer**.
    * The team is listed with tags ("Bartender ✓", "Requested this", "Not on team" on search results) and reasons ("Booked at that time …").
    * **Assign** someone: they're booked immediately, the roster says "Assigned by manager", and their bell shows **"You're booked: …"**.
12. **Assign someone with a waiting request:** the button reads **Approve**. Their request is approved, not duplicated, and leaves the Approval Queue.
13. **Offer** to 2–3 people with the message "Need you!":
    * Each worker sees **Offered to you** at the top of their dashboard, with the message and "Also offered to 2 others".
    * The first to **Accept** is booked; the others' offer disappears.
    * The manager gets **"<name> accepted"**, and the roster shows Accepted / Someone else took it.
    * A pending offer can be withdrawn with ×.
14. **Nobody takes it:** everyone declines and the manager gets **"No one took it"**.
15. **Hidden pay:** an offer for a hidden-pay position shows "Pay not listed" to the worker.
16. **Ratings:** open **Past**, then an event that has ended.
    * Each person who worked shows ★★★★★ plus Would book again Yes/No. Tap 4 stars and Yes.
    * The worker's badge becomes ★ 4.0 (1).
    * The Team page shows "Here: ★ 4.0 (1) · Would book again 1/1".
    * The trash icon removes the rating and they're back to **New**.
17. **Admin panel:** editing a worker's venues keeps their Hippodrome block, note and positions.

---