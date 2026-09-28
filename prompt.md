# Phase 34: Cover Requests & Waitlists

**Why:**
* When a booked worker can't make a shift, the only options are a direct hand-off to one named teammate, or dropping it (not allowed inside 24 hours, and it counts against reliability). There's no way to say "can anyone take this?".
* When a position is full, people who want it have no way to get in line. If someone drops, whoever refreshes first wins.

**Decisions (yours):**
* **Both** cover requests and waitlists ship in Phase 34.
* **Taking cover follows the venue's usual rules**: the same decision as a normal request (instant for team members at a "book my team instantly" venue; otherwise the manager approves).
* **Venue setting + worker choice**: a new venue setting, **on by default**, lets workers also post cover on the public shift board. The worker picks *My team* or *My team + the public board*.
* **No taker: warn, they stay booked.** The worker and managers are warned 12 hours and 3 hours before the start. Asking for cover never counts against reliability.

## Part 1: Cover requests ("Ask for cover")
**Worker, My shifts:** on a booked shift that hasn't started, the ⋯ menu has **Ask for cover**.
* A dialog asks who can see it, with an optional note (300 characters):
  - **My team at {venue}**
  - **My team + the public shift board**. This is greyed out if the venue has it off.
* The card then shows a chip: **Asking for cover · team only** (or **· team + public board**). The menu shows **Cancel cover request** (with a confirm).
* While a cover request is live, **Hand off to a teammate** is disabled with a hint, and the API refuses it too.

**Who sees it:**
* The venue's team always sees it.
* The public sees it only if the worker chose the board **and** the venue allows it. If the venue turns the setting off later, public posts fall back to team only.
* Teammates get a `cover_needed` notification when:
  - it fits their departments
  - they could actually take it (not double-booked, has the certificates, not blocked, etc.)
  - Up to 50 people. It's urgent if the shift is within 24 hours.
* Managers get an FYI.

**Taking it:** Find shifts gets a **Need cover** section at the top. Each item shows:
* pay, time and "Covering for Ava"
* the note
* **Take it** (instant) or **Ask to take it** (needs the manager), with a confirm
* why you can't take it, if you can't (overlap, certificates…)

What happens on take:
* **Instant** (venue's usual rules say instant):
  - The original booking becomes `transferred` ("Covered by Ben Test").
  - The taker is `approved` with `approval_source = 'cover'` ("Covering for Ava Test").
  - The taker's other waiting requests in the event are withdrawn.
  - Spots don't change.
  - Everyone is told: the taker ("You're booked"), the poster ("Ben is covering your shift") and the managers.
* **Needs approval:** the take becomes a hand-off waiting in the manager's existing **Hand-offs to approve** list. It's marked with a **Cover** chip, using the new `shift_transfers.cover_request_id`.
  - **Approve**: same swap as instant.
  - **Deny**: the post opens again for someone else.
  - The poster can withdraw it from their sent hand-offs. They keep the shift and the post closes.
* Only one person can be taking a post at a time. The poster can't cancel while the manager decides.

**Background (every minute):**
* Posts close when:
  - the shift starts
  - the booking goes away (dropped, removed, no-show)
  - the position is cancelled
* A take still waiting for the manager is closed with the post.
* Warnings go to the worker and managers:
  - **12 h** before the start (normal)
  - **3 h** before (urgent)
  - Each once. A post made inside 3 h gets only the 3 h warning.
* Dropping a shift closes its cover post right away.
* The "can't drop within 24 hours" message now says "Ask for cover, hand it off, or message your manager."

**Manager:**
* The roster shows **"Asked for cover · still booked"** on the person (or "Someone took their cover request · approve it in Hand-offs").
* The activity log records *asked for cover / is covering / waiting for approval*.
* **Venue settings** has a new checkbox: **Workers can post cover on the public shift board** (on by default).

## Part 2: Waitlists for full positions
**Joining:**
* Full events are now listed in Find shifts, in a section at the bottom: **Full: join a waitlist (N)**. It's collapsed unless you're in line somewhere.
* They are **not** counted in "open to pick up" or the Find shifts tab count.
* In the event popup, each full position shows "Full · N waiting" and:
  - **Book me automatically if a spot opens** (checked by default)
  - **Join waitlist**
  - Once joined: "You're #2 in line" and **Leave waitlist**.
* Rules:
  - One place per event.
  - Not if you already have a request or booking there.
  - Not if you dropped a shift there.
  - Not if it overlaps a booked shift.
  - Not if you're missing a certificate, or the venue blocked you.
  - Only when the position really is full.

**When a spot opens** (someone drops, is removed, a manager adds a spot…), the line moves in join order:
* **Book me automatically**: we send the request for them with the venue's usual rules. They're booked instantly or the manager reviews it (note "From the waitlist"). They're told either way.
* **Offer me first**: they get an urgent **"A spot opened up"** notification.
  - The offer lasts **30 minutes**, or **10 minutes** if the shift starts within 3 hours.
  - **The spot is held for them**: nobody else can book it, and it shows as full to others.
  - **Take it** or **Pass** on My shifts, with a live countdown.
  - Pass or time-out → the next person.
* If someone can't be booked anymore (e.g. they booked something overlapping), their place closes and they're told why.
* It runs right after a drop, and every minute in the background worker (for removals, no-shows and added spots).
* When the shift starts or is cancelled, the line closes.

**Other screens:**
* My shifts shows **A spot opened for you** (offers) and **On a waitlist** (places in line, with Leave).
* The manager roster shows **Waitlist (2): Cy T., Dee T.** per position.

## API (177 → **187** operations)
Cover:
| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/cover` | `{request_id, audience: "team"\|"public", note}` → 201 `{cover_id, message}` |
| `POST` | `/api/cover/{id}/cancel` | Poster cancels (only while open) |
| `GET` | `/api/cover/open` | Posts the viewer can see, with `can_take`, `problem`, `booking` |
| `GET` | `/api/cover/mine` | The poster's live posts |
| `POST` | `/api/cover/{id}/take` | → `{status: "covered"\|"pending_approval", message, request_id}` |

Waitlist:
| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/waitlist` | `{shift_id, auto_book}` → 201 |
| `GET` | `/api/waitlist/mine` | The worker's places in line and offers |
| `POST` | `/api/waitlist/{id}/leave` | Leave the line |
| `POST` | `/api/waitlist/{id}/take` | Take an offer |
| `POST` | `/api/waitlist/{id}/pass` | Pass on an offer |

Changed:
* Listings positions gain `waitlist_count`, `my_waitlist`, `can_waitlist`, and events gain `full`. Offered spots are subtracted from `spots_left`.
* Hand-offs gain `cover_request_id`.
* The manager events list gains `positions[].waitlist` and `assigned[].cover`.
* Manager review of a hand-off now refuses one that isn't waiting for the manager ("This hand-off is already settled."). Before, approving twice would swap twice.

New notification kinds:
* `cover_needed`
* `cover_update`
* `cover_warning`
* `cover_manager` (manager category)
* `waitlist_offer`
* `waitlist_update`

They use the existing categories, so people's settings apply.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`, `frontend/public/`
  - In `backend/src/main.py`, the **only** change is the two lines that import and include the new `cover` router (shown below). CORS and everything else stay as they are.
* **Schema change** (new tables `cover_requests`, `waitlist_entries`; new columns `venues.allow_public_cover`, `shift_transfers.cover_request_id`):
  - Status columns are plain `VARCHAR`, **no PostgreSQL ENUMs**. Validation stays in the app.
  - See Part F for the rebuild, or the keep-your-data SQL.
* No new packages.
* Aware UTC datetimes only (`datetime.now(timezone.utc)`).
* Notification hooks run **after** the main commit and never raise.
* **NEW FILE**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from your **current** files: all 22 edited files were checked against your repo and match (33.1 is fully applied). They were verified:
  - **Backend:** imports cleanly; **187** API operations (177 + 10).
  - **Frontend:** bundles with no missing imports.
  - **A new 96-check cover + waitlist suite** passes (twice, from a fresh database). It covers:
    - team-only vs public visibility; the venue switch
    - instant take vs manager approval, deny → reopens, approve → swap
    - poster withdraws; double approve refused; approve refused when the original is gone
    - overlap refused; drop closes the post
    - 12 h / 3 h warnings (once each; only 3 h when posted late); expiry
    - roster flags; activity log
    - waitlist: join rules, place numbers, offer 30 / 10 min, the held spot refused to others, pass → next person auto-requested, expiry → next offered, take, instant booking from the line for a team member, closed-with-reason when they can't be booked, leave, one place per event, closes at start, and an extra spot picked up by the minute check
  - **All earlier suites still pass** (28, 20, 97, 36, 64, 67, 39, 49, 107, 32, 17, 24, 24).
  - **The keep-your-data SQL** was run twice on a copy of your current schema, and the result matches a fresh `init.sql` exactly (columns and indexes).
  - In real Chromium, on phone and desktop:
    - the Need cover section and take confirm
    - the Ask for cover dialog and card chips
    - the waitlist join UI, the offer countdown and the full-events section
    - the manager Cover chip, the roster flags / waitlist names and the settings checkbox
    - no page errors

  Don't "improve" them.

---

# PART A: Database & models

## A1. `database/init.sql` (EDITS)
New columns `venues.allow_public_cover` and `shift_transfers.cover_request_id`; new tables `cover_requests` and `waitlist_entries` (plain VARCHAR statuses, partial unique indexes: one live cover post per booking, one live place per person per position).

**Edit 1.** Find:
```sql
    clock_in_early_minutes INT NOT NULL DEFAULT 30,
    auto_clock_out_hours INT NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    clock_in_early_minutes INT NOT NULL DEFAULT 30,
    auto_clock_out_hours INT NOT NULL DEFAULT 2,
    allow_public_cover BOOLEAN NOT NULL DEFAULT TRUE,        -- Phase 34: workers may also post cover on the public board
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 2.** Find:
```sql
    status VARCHAR(50) NOT NULL DEFAULT 'pending_worker_acceptance',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    status VARCHAR(50) NOT NULL DEFAULT 'pending_worker_acceptance',
    notes TEXT,
    cover_request_id UUID,                                    -- Phase 34: set when this hand-off came from a cover post
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 3.** Find:
```sql
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
Replace with:
```sql
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Phase 34: Cover requests and waitlists
-- ==============================================================================
CREATE TABLE cover_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES shift_requests(id) ON DELETE CASCADE,   -- the booking that needs cover
    from_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience VARCHAR(10) NOT NULL DEFAULT 'team',             -- team | public (team + the public board)
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',               -- open | pending_approval | covered | cancelled | expired
    taken_by_worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    transfer_id UUID REFERENCES shift_transfers(id) ON DELETE SET NULL,
    warned_12h_at TIMESTAMPTZ,
    warned_3h_at TIMESTAMPTZ,
    closed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cover_requests_shift ON cover_requests(shift_id);
CREATE INDEX idx_cover_requests_status ON cover_requests(status);
CREATE INDEX idx_cover_requests_venue ON cover_requests(venue_id);
-- one live cover post per booking
CREATE UNIQUE INDEX uq_cover_requests_live ON cover_requests(request_id) WHERE status IN ('open', 'pending_approval');

CREATE TABLE waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auto_book BOOLEAN NOT NULL DEFAULT TRUE,                  -- book (or request) automatically when a spot opens
    status VARCHAR(20) NOT NULL DEFAULT 'waiting',            -- waiting | offered | booked | requested | passed | expired | left | closed
    offered_at TIMESTAMPTZ,
    offer_expires_at TIMESTAMPTZ,
    request_id UUID REFERENCES shift_requests(id) ON DELETE SET NULL,
    closed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_waitlist_shift ON waitlist_entries(shift_id, created_at);
CREATE INDEX idx_waitlist_worker ON waitlist_entries(worker_id);
-- one live place per person per position
CREATE UNIQUE INDEX uq_waitlist_live ON waitlist_entries(shift_id, worker_id) WHERE status IN ('waiting', 'offered');
```

---

## A2. `backend/src/models.py` (EDITS)
`Venue.allow_public_cover`, `ShiftTransfer.cover_request_id`, new `CoverRequest` and `WaitlistEntry` at the end of the file.

**Edit 1.** Find:
```python
    clock_in_early_minutes = Column(Integer, nullable=False, default=30)       # Phase 27
    auto_clock_out_hours = Column(Integer, nullable=False, default=2)          # Phase 27
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    clock_in_early_minutes = Column(Integer, nullable=False, default=30)       # Phase 27
    auto_clock_out_hours = Column(Integer, nullable=False, default=2)          # Phase 27
    allow_public_cover = Column(Boolean, nullable=False, default=True)         # Phase 34
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 2.** Find:
```python
    status = Column(String(50), nullable=False, default="pending_worker_acceptance", index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    status = Column(String(50), nullable=False, default="pending_worker_acceptance", index=True)
    notes = Column(Text, nullable=True)
    cover_request_id = Column(UUID(as_uuid=True), nullable=True)                # Phase 34: came from a cover post
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 3.** Find:
```python
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```
Replace with:
```python
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class CoverRequest(Base):
    """Phase 34: a booked worker asks their venue team (and optionally the public board) to take their shift.
    They stay booked until someone takes it."""
    __tablename__ = "cover_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), nullable=False)
    from_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    audience = Column(String(10), nullable=False, default="team")              # team | public
    note = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="open", index=True)    # open | pending_approval | covered | cancelled | expired
    taken_by_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    transfer_id = Column(UUID(as_uuid=True), ForeignKey("shift_transfers.id", ondelete="SET NULL"), nullable=True)
    warned_12h_at = Column(DateTime(timezone=True), nullable=True)
    warned_3h_at = Column(DateTime(timezone=True), nullable=True)
    closed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WaitlistEntry(Base):
    """Phase 34: a place in line for a full position. When a spot opens the first person is booked
    (auto_book) or offered it for a short time."""
    __tablename__ = "waitlist_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    auto_book = Column(Boolean, nullable=False, default=True)
    status = Column(String(20), nullable=False, default="waiting")   # waiting | offered | booked | requested | passed | expired | left | closed
    offered_at = Column(DateTime(timezone=True), nullable=True)
    offer_expires_at = Column(DateTime(timezone=True), nullable=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="SET NULL"), nullable=True)
    closed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

---

## A3. `backend/src/schemas.py` (EDITS)
Venue setting, `ShiftTransferResponse.cover_request_id`, `ListingWaitlist` + new listing fields, roster `cover` / `waitlist`, and the cover / waitlist request and response models before `WorkerProfile.model_rebuild()`.

**Edit 1.** Find:
```python
    clock_in_early_minutes: int = 30        # Phase 27
    auto_clock_out_hours: int = 2           # Phase 27

class VenueCreate(BaseModel):
```
Replace with:
```python
    clock_in_early_minutes: int = 30        # Phase 27
    auto_clock_out_hours: int = 2           # Phase 27
    allow_public_cover: bool = True         # Phase 34

class VenueCreate(BaseModel):
```

**Edit 2.** Find:
```python
    clock_in_early_minutes: Optional[int] = None      # Phase 27
    auto_clock_out_hours: Optional[int] = None        # Phase 27

class VenueResponse(VenueBase):
```
Replace with:
```python
    clock_in_early_minutes: Optional[int] = None      # Phase 27
    auto_clock_out_hours: Optional[int] = None        # Phase 27
    allow_public_cover: Optional[bool] = None         # Phase 34

class VenueResponse(VenueBase):
```

**Edit 3.** Find:
```python
    status: str
    notes: Optional[str] = None              # Phase 29.1: the note with the hand-off (was never sent)
    created_at: datetime
    updated_at: datetime
```
Replace with:
```python
    status: str
    notes: Optional[str] = None              # Phase 29.1: the note with the hand-off (was never sent)
    cover_request_id: Optional[UUID] = None  # Phase 34: this hand-off came from a cover post
    created_at: datetime
    updated_at: datetime
```

**Edit 4.** Find:
```python
    time_off_reason: Optional[str] = None        # Phase 32.1: the block's reason (managers see it)
    outside_department: bool = False             # Phase 32.2: their request is outside their departments


```
Replace with:
```python
    time_off_reason: Optional[str] = None        # Phase 32.1: the block's reason (managers see it)
    outside_department: bool = False             # Phase 32.2: their request is outside their departments
    cover: Optional[str] = None                  # Phase 34: open | pending_approval (they asked for cover)


```

**Edit 5.** Find:
```python
    offers: List[PositionOffer] = []         # Phase 29: pending + recently answered offers
    dropped: List[RosterPerson] = []         # Phase 29.4: people who dropped this position (can be booked back)


```
Replace with:
```python
    offers: List[PositionOffer] = []         # Phase 29: pending + recently answered offers
    dropped: List[RosterPerson] = []         # Phase 29.4: people who dropped this position (can be booked back)
    waitlist: List[str] = []                 # Phase 34: names in line order ("Ana R.")


```

**Edit 6.** Find:
```python


class ListingPosition(BaseModel):
    shift_id: UUID
```
Replace with:
```python


class ListingWaitlist(BaseModel):
    """Phase 34: the viewer's place on a full position's waitlist."""
    entry_id: UUID
    status: str                                # waiting | offered
    place: int = 1                             # 1 = next in line
    auto_book: bool = True                     # True = book me (or send my request) as soon as a spot opens
    offer_expires_at: Optional[datetime] = None


class ListingPosition(BaseModel):
    shift_id: UUID
```

**Edit 7.** Find:
```python
    department_match: str = "not_set"          # Phase 32.2: match | outside | not_set (for THIS viewer)
    missing_certs: List[str] = []              # Phase 32: what the VIEWER is missing (non-empty = can't request)


```
Replace with:
```python
    department_match: str = "not_set"          # Phase 32.2: match | outside | not_set (for THIS viewer)
    missing_certs: List[str] = []              # Phase 32: what the VIEWER is missing (non-empty = can't request)
    waitlist_count: int = 0                    # Phase 34: people waiting for this position (live entries)
    my_waitlist: Optional[ListingWaitlist] = None   # Phase 34: the viewer's place in line
    can_waitlist: bool = False                 # Phase 34: full, and the viewer could join the waitlist


```

**Edit 8.** Find:
```python
    series: List["EventListing"] = []                 # Phase 32.3: single-event view only: the series' other upcoming dates
    series_more: int = 0                              # Phase 32.3: list view: how many other dates of this series are listed too


```
Replace with:
```python
    series: List["EventListing"] = []                 # Phase 32.3: single-event view only: the series' other upcoming dates
    series_more: int = 0                              # Phase 32.3: list view: how many other dates of this series are listed too
    full: bool = False                                # Phase 34: no open spots (shown so people can join a waitlist)


```

**Edit 9.** Find:
```python


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```
Replace with:
```python



# ------------------------------------------------------------------------------------------------
# Phase 34: cover requests + waitlists
# ------------------------------------------------------------------------------------------------
class CoverPostBody(BaseModel):
    request_id: UUID
    audience: str = "team"                   # team | public
    note: Optional[str] = Field(None, max_length=300)


class CoverListing(BaseModel):
    cover_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    venue_id: UUID
    venue_name: str
    venue_timezone: str = "America/New_York"
    start_time: datetime
    end_time: datetime
    hours: float = 0
    hourly_rate: Optional[float] = None      # None = hidden
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    from_first_name: str
    note: Optional[str] = None
    audience: str = "team"                   # what actually applies (public falls back to team if the venue turned it off)
    on_team: bool = False
    can_take: bool = False
    problem: Optional[str] = None            # why the viewer can't take it
    booking: str = "approval"                # instant | approval (for THIS viewer)
    take_note: Optional[str] = None          # e.g. "Your waiting request for Server at this event will be withdrawn."
    department_match: str = "not_set"
    created_at: datetime


class CoverMine(BaseModel):
    cover_id: UUID
    request_id: UUID
    shift_id: UUID
    status: str                              # open | pending_approval
    audience: str
    note: Optional[str] = None
    taker_first_name: Optional[str] = None
    created_at: datetime


class CoverPostResult(BaseModel):
    cover_id: UUID
    message: str


class CoverTakeResult(BaseModel):
    status: str                              # covered | pending_approval
    message: str
    request_id: Optional[UUID] = None        # the taker's booking when covered


class WaitlistJoinBody(BaseModel):
    shift_id: UUID
    auto_book: bool = True


class WaitlistMine(BaseModel):
    entry_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    venue_name: str
    venue_timezone: str = "America/New_York"
    start_time: datetime
    end_time: datetime
    status: str                              # waiting | offered
    place: int = 1
    auto_book: bool = True
    offer_expires_at: Optional[datetime] = None


class WaitlistActionResult(BaseModel):
    status: str                              # waiting | booked | requested | passed | left
    message: str
    entry_id: Optional[UUID] = None
    request_id: Optional[UUID] = None


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```

---

## A4. `backend/src/services/venue_positions.py` (EDIT)
`allow_public_cover` can't be saved as null.

**Edit 1.** Find:
```python
    "name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy",
    "geofence_enabled", "geofence_buffer_meters", "clock_in_early_minutes", "auto_clock_out_hours",   # Phase 27
)
TEXT_VENUE_FIELDS = (
```
Replace with:
```python
    "name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy",
    "geofence_enabled", "geofence_buffer_meters", "clock_in_early_minutes", "auto_clock_out_hours",   # Phase 27
    "allow_public_cover",                                                                            # Phase 34
)
TEXT_VENUE_FIELDS = (
```

---

# PART B: Backend services

## B1. NEW FILE `backend/src/services/cover.py`

```python
"""
Phase 34: Cover requests ("I need cover").

A booked worker posts their shift for someone else to take:
  * audience 'team'   -> people on that venue's team see it (and get a notification if it fits their departments)
  * audience 'public' -> the team, plus everyone on the Find shifts board (only if the venue allows it:
                         venues.allow_public_cover)
They STAY BOOKED until someone takes it. Asking for cover never counts against reliability.

Taking it follows the venue's usual booking rules (same decision as a normal request):
  * instant (e.g. team member at a "book my team instantly" venue) -> swapped right away
  * otherwise -> a hand-off waiting for the manager (shift_transfers row with cover_request_id), shown in the
    manager's existing "Hand-offs to approve" queue. Approve = swapped; deny = the post opens again.
The background worker warns the worker + managers 12 h and 3 h before the start if nobody has taken it,
and closes posts whose shift started or whose booking is gone.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    CoverRequest, Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueWhitelist, RequestStatus,
)
from src.schemas import CoverListing, CoverMine
from src.services.auto_confirm import decide_approval, check_double_booking
from src.services.booking import (
    _load_shift_locked, require_certs, prior_drop_in_event, withdraw_other_pending_in_event,
    ACTIVE_STATUSES, PENDING_STATUSES, BOOKED_STATUSES, as_utc,
)
from src.services.team import is_blocked, blocked_venue_ids
from src.services.departments import load_dept_context
from src.services.fit import load_requirements, required_for, load_fit, tz_of, cert_label

logger = logging.getLogger("shiftboard.cover")

LIVE = ("open", "pending_approval")
AUDIENCES = ("team", "public")
NOTE_MAX = 300
WARN_12H = timedelta(hours=12)             # "nobody has taken it yet" warnings to the worker + managers
WARN_3H = timedelta(hours=3)
NO_COVER_STATUSES = ("removed", "no_show")          # on this exact shift: can't take it


def _name(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    return (f"{u.first_name or ''} {u.last_name or ''}".strip()) or (u.email or "Someone")


async def _on_team(db: AsyncSession, venue_id, worker_id) -> bool:
    return bool(await db.scalar(select(VenueWhitelist.id).where(
        VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == worker_id,
        VenueWhitelist.is_active == True, VenueWhitelist.status == "active",
    )))


def effective_audience(cover: CoverRequest, venue: Venue) -> str:
    """A public post goes back to team-only if the venue turns public cover off."""
    return "public" if cover.audience == "public" and bool(venue.allow_public_cover) else "team"


# ------------------------------------------------------------------------------------------------
# Posting / cancelling
# ------------------------------------------------------------------------------------------------
async def post_cover(db: AsyncSession, worker: User, request_id: UUID, audience: str, note: Optional[str]) -> UUID:
    """Creates an open cover post for the worker's own booking. Commits. Returns its id."""
    if audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail="Choose who can see it: your team, or your team and the public board.")
    clean = (note or "").strip()[:NOTE_MAX] or None
    try:
        req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
        if req is None or req.worker_id != worker.id:
            raise HTTPException(status_code=404, detail="Shift not found.")
        if (req.status or "").lower() not in ("approved", "confirmed"):
            raise HTTPException(status_code=400, detail="You can only ask for cover on a shift you're booked on and haven't started.")
        shift = await _load_shift_locked(db, req.shift_id)
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
        venue = shift.venue
        if audience == "public" and not venue.allow_public_cover:
            raise HTTPException(status_code=400, detail=f"{venue.name} only lets you ask your team for cover.")
        live = await db.scalar(select(CoverRequest.id).where(CoverRequest.request_id == req.id, CoverRequest.status.in_(LIVE)))
        if live:
            raise HTTPException(status_code=400, detail="You've already asked for cover on this shift.")
        handoff = await db.scalar(select(ShiftTransfer.id).where(
            ShiftTransfer.shift_id == shift.id, ShiftTransfer.from_worker_id == worker.id,
            ShiftTransfer.status.in_(("pending_worker_acceptance", "pending_manager_approval")),
        ))
        if handoff:
            raise HTTPException(status_code=400, detail="You've already sent a hand-off for this shift. Withdraw it first.")
        cover = CoverRequest(shift_id=shift.id, venue_id=shift.venue_id, request_id=req.id, from_worker_id=worker.id,
                             audience=audience, note=clean, status="open")
        db.add(cover)
        await db.flush()
        cover_id = cover.id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("post_cover failed")
        raise HTTPException(status_code=500, detail=f"Could not post your cover request: {e}")
    return cover_id


async def cancel_cover(db: AsyncSession, worker: User, cover_id: UUID) -> None:
    """The worker takes their post down (only while nobody is waiting on a manager for it). Commits."""
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    if cover is None or cover.from_worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Cover request not found.")
    if cover.status == "pending_approval":
        raise HTTPException(status_code=400, detail="Someone is already taking it and the manager is deciding. Ask the manager if you need to stop it.")
    if cover.status != "open":
        raise HTTPException(status_code=400, detail="This cover request is already closed.")
    try:
        cover.status = "cancelled"
        cover.closed_reason = "Cancelled by you"
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not cancel it: {e}")


# ------------------------------------------------------------------------------------------------
# Who can take it, and how
# ------------------------------------------------------------------------------------------------
async def taker_check(db: AsyncSession, taker: User, cover: CoverRequest, shift: Shift, venue: Venue,
                      depts=None) -> Tuple[Optional[str], str, Optional[str]]:
    """(problem or None, 'instant' | 'approval', note). `note` explains side effects (e.g. a waiting request is withdrawn)."""
    if taker.id == cover.from_worker_id:
        return "This is your own shift.", "approval", None
    if as_utc(shift.start_time) <= datetime.now(timezone.utc):
        return "This shift has already started.", "approval", None
    if await is_blocked(db, venue.id, taker.id):
        return "This venue isn't taking requests from you right now.", "approval", None
    on_team = await _on_team(db, venue.id, taker.id)
    if effective_audience(cover, venue) == "team" and not on_team:
        return "Only the venue's team can take this one.", "approval", None
    try:
        await require_certs(db, taker, shift, you=True)
    except HTTPException as e:
        return e.detail, "approval", None
    try:
        await check_double_booking(db, taker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
    except HTTPException:
        return "You're booked on another shift at that time.", "approval", None
    same = select(ShiftRequest, Shift.role_type).join(Shift, Shift.id == ShiftRequest.shift_id).where(
        ShiftRequest.worker_id == taker.id, func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
    same = same.where(Shift.event_id == shift.event_id) if shift.event_id else same.where(Shift.id == shift.id)
    note = None
    for r, role in (await db.execute(same)).all():
        if (r.status or "").lower() in PENDING_STATUSES:
            note = f"Your waiting request for {role} at this event will be withdrawn."
        else:
            return f"You're already booked as {role} for this event.", "approval", None
    mine = await db.scalar(select(ShiftRequest.status).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == taker.id))
    if (mine or "").lower() in NO_COVER_STATUSES:
        return "You can't take this shift.", "approval", None

    decision, _src = decide_approval(shift, venue, taker, on_team)
    mode = "instant" if decision == RequestStatus.APPROVED else "approval"
    if mode == "instant" and await prior_drop_in_event(db, taker.id, shift) is not None:
        mode = "approval"                                   # coming back after a drop always needs the manager
    if mode == "instant":
        depts = depts or await load_dept_context(db, [taker.id], [venue.id])
        if depts.match(taker.id, shift) == "outside":
            mode = "approval"                               # Phase 32.2: outside their departments
    return None, mode, note


async def take_cover(db: AsyncSession, taker: User, cover_id: UUID) -> Tuple[str, UUID]:
    """Takes a cover post. Returns ('covered' | 'pending_approval', transfer_id). Commits."""
    try:
        cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
        if cover is None:
            raise HTTPException(status_code=404, detail="This cover request is no longer available.")
        shift = await _load_shift_locked(db, cover.shift_id)
        cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id).with_for_update()
                                .execution_options(populate_existing=True))
        if cover.status != "open":
            raise HTTPException(status_code=400, detail="Someone else is already taking this shift.")
        venue = shift.venue
        orig = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == cover.request_id))
        if orig is None or (orig.status or "").lower() not in ("approved", "confirmed"):
            cover.status = "cancelled"
            cover.closed_reason = "The original booking changed"
            await db.commit()
            raise HTTPException(status_code=400, detail="This shift doesn't need cover anymore.")
        problem, mode, _note = await taker_check(db, taker, cover, shift, venue)
        if problem:
            raise HTTPException(status_code=400, detail=problem)

        now = datetime.now(timezone.utc)
        from_user = await db.scalar(select(User).where(User.id == cover.from_worker_id))
        transfer = ShiftTransfer(
            shift_id=shift.id, from_worker_id=cover.from_worker_id, to_worker_id=taker.id,
            status="approved" if mode == "instant" else "pending_manager_approval",
            notes=("Cover request" + (f": {cover.note}" if cover.note else "")), cover_request_id=cover.id,
        )
        db.add(transfer)
        await db.flush()
        cover.taken_by_worker_id = taker.id
        cover.transfer_id = transfer.id
        if mode == "instant":
            await swap(db, shift, orig, taker, from_user, approved_by=None)
            cover.status = "covered"
        else:
            cover.status = "pending_approval"
        transfer_id = transfer.id
        result = cover.status
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("take_cover failed")
        raise HTTPException(status_code=500, detail=f"Could not take this shift: {e}")
    return result, transfer_id


async def swap(db: AsyncSession, shift: Shift, orig: ShiftRequest, taker: User, from_user: Optional[User], approved_by=None) -> ShiftRequest:
    """Moves the booking from the original worker to the taker. Spots don't change. Does NOT commit."""
    now = datetime.now(timezone.utc)
    orig.status = "transferred"
    orig.status_reason = f"Covered by {_name(taker)}"
    to_req = await db.scalar(select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == taker.id))
    if to_req is None:
        to_req = ShiftRequest(shift_id=shift.id, worker_id=taker.id)
        db.add(to_req)
    to_req.status = "approved"
    to_req.approval_source = "cover"
    to_req.approved_by_user_id = approved_by
    to_req.approved_at = now
    to_req.status_reason = f"Covering for {_name(from_user)}"
    to_req.pay_rate = None
    to_req.check_in_time = None
    to_req.check_in_verified = False
    to_req.check_out_time = None
    to_req.check_out_verified = False
    await withdraw_other_pending_in_event(db, taker.id, shift.event_id, shift.id, "Took a shift that needed cover at this event")
    await db.flush()
    return to_req


async def check_before_approve(db: AsyncSession, transfer: ShiftTransfer) -> None:
    """Manager approving a cover take: the original worker must still hold the shift. Raises 400 if not."""
    if not transfer.cover_request_id:
        return
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == transfer.cover_request_id))
    orig = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == cover.request_id)) if cover else None
    if orig is None or (orig.status or "").lower() not in ("approved", "confirmed"):
        raise HTTPException(status_code=400, detail="The original worker isn't on this shift anymore, so there's nothing to cover.")


async def after_transfer_review(db: AsyncSession, transfer: ShiftTransfer) -> None:
    """Called by the manager's hand-off review before its commit: keeps the cover post in step. Does NOT commit."""
    if not transfer.cover_request_id:
        return
    await db.flush()                          # the session doesn't autoflush: make the new booking row visible
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == transfer.cover_request_id))
    if cover is None:
        return
    st = (transfer.status or "").lower()
    if st == "approved":
        cover.status = "covered"
        taker = await db.scalar(select(User).where(User.id == transfer.to_worker_id))
        frm = await db.scalar(select(User).where(User.id == transfer.from_worker_id))
        for r in (await db.execute(select(ShiftRequest).where(
                ShiftRequest.shift_id == transfer.shift_id,
                ShiftRequest.worker_id.in_((transfer.to_worker_id, transfer.from_worker_id))))).scalars().all():
            if r.worker_id == transfer.to_worker_id:
                r.approval_source = "cover"
                r.status_reason = f"Covering for {_name(frm)}"
            elif (r.status or "").lower() == "transferred":
                r.status_reason = f"Covered by {_name(taker)}"
    elif st in ("denied", "declined"):
        if cover.status == "pending_approval":
            cover.status = "open"             # back up for someone else
            cover.taken_by_worker_id = None
            cover.transfer_id = None
    elif st == "cancelled_by_sender":         # the worker withdrew: they keep the shift, the post closes
        if cover.status in LIVE:
            cover.status = "cancelled"
            cover.closed_reason = "Cancelled by you"


async def close_for_request(db: AsyncSession, request_id: UUID, reason: str) -> int:
    """The booking is going away (dropped / removed / no-show): close its live cover post and any
    cover take waiting for the manager. Does NOT commit. Returns how many were closed."""
    n = 0
    for cover in (await db.execute(select(CoverRequest).where(
            CoverRequest.request_id == request_id, CoverRequest.status.in_(LIVE)))).scalars().all():
        if cover.transfer_id:
            t = await db.scalar(select(ShiftTransfer).where(ShiftTransfer.id == cover.transfer_id))
            if t is not None and t.status == "pending_manager_approval":
                t.status = "cancelled_by_sender"
        cover.status = "cancelled"
        cover.closed_reason = reason
        n += 1
    return n


# ------------------------------------------------------------------------------------------------
# Lists
# ------------------------------------------------------------------------------------------------
def _rate_for(shift: Shift, booked_here: bool) -> Tuple[Optional[float], Optional[float]]:
    if shift.hide_rate and not booked_here:
        return None, None
    return float(shift.hourly_rate), (float(shift.hourly_rate_max) if shift.hourly_rate_max is not None else None)


async def open_for(db: AsyncSession, viewer: User) -> List[CoverListing]:
    """Cover posts this person can see: their teams' posts, plus public posts from venues that allow them."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(CoverRequest, Shift, Venue, ShiftEvent, User)
        .join(Shift, Shift.id == CoverRequest.shift_id)
        .join(Venue, Venue.id == CoverRequest.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .join(User, User.id == CoverRequest.from_worker_id)
        .where(CoverRequest.status == "open", Shift.start_time > now, CoverRequest.from_worker_id != viewer.id)
        .order_by(Shift.start_time.asc())
        .limit(100)
    )).all()
    if not rows:
        return []
    blocked = await blocked_venue_ids(db, viewer.id)
    team = set((await db.execute(select(VenueWhitelist.venue_id).where(
        VenueWhitelist.worker_id == viewer.id, VenueWhitelist.is_active == True, VenueWhitelist.status == "active",
    ))).scalars().all())
    depts = await load_dept_context(db, [viewer.id], {r[2].id for r in rows})
    out: List[CoverListing] = []
    for cover, shift, venue, event, frm in rows:
        if venue.id in blocked:
            continue
        aud = effective_audience(cover, venue)
        if aud == "team" and venue.id not in team:
            continue
        problem, mode, note = await taker_check(db, viewer, cover, shift, venue, depts=depts)
        rate, rate_max = _rate_for(shift, False)
        start, end = as_utc(shift.start_time), as_utc(shift.end_time)
        out.append(CoverListing(
            cover_id=cover.id, shift_id=shift.id, event_id=shift.event_id,
            title=(event.title if event is not None else None) or shift.title or shift.role_type,
            role_type=shift.role_type or "Shift", venue_id=venue.id, venue_name=venue.name,
            venue_timezone=venue.timezone or "America/New_York",
            start_time=shift.start_time, end_time=shift.end_time,
            hours=round(max(0.0, (end - start).total_seconds() / 3600.0), 2),
            hourly_rate=rate, hourly_rate_max=rate_max, hide_rate=bool(shift.hide_rate),
            tips_eligible=bool(shift.tips_eligible),
            from_first_name=(frm.first_name or "A teammate"), note=cover.note,
            audience=aud, on_team=venue.id in team,
            can_take=problem is None, problem=problem, booking=mode, take_note=note,
            department_match=depts.match(viewer.id, shift),
            created_at=cover.created_at,
        ))
    return out


async def mine(db: AsyncSession, worker: User) -> List[CoverMine]:
    rows = (await db.execute(
        select(CoverRequest, User).outerjoin(User, User.id == CoverRequest.taken_by_worker_id)
        .where(CoverRequest.from_worker_id == worker.id, CoverRequest.status.in_(LIVE))
    )).all()
    return [CoverMine(cover_id=c.id, request_id=c.request_id, shift_id=c.shift_id, status=c.status, audience=c.audience,
                      note=c.note, taker_first_name=(u.first_name if u is not None else None), created_at=c.created_at)
            for c, u in rows]


# ------------------------------------------------------------------------------------------------
# Background sweep (every minute, from the notification worker)
# ------------------------------------------------------------------------------------------------
async def sweep(db: AsyncSession, now: datetime) -> List[Tuple[str, UUID]]:
    """Closes stale posts and returns warnings to send: [('12h'|'3h', cover_id)]. Does NOT commit."""
    rows = (await db.execute(
        select(CoverRequest, Shift, ShiftRequest)
        .join(Shift, Shift.id == CoverRequest.shift_id)
        .join(ShiftRequest, ShiftRequest.id == CoverRequest.request_id)
        .where(CoverRequest.status.in_(LIVE))
    )).all()
    warnings = []

    async def _close(cover, status, reason, transfer_status):
        if cover.status == "pending_approval" and cover.transfer_id:
            t = await db.scalar(select(ShiftTransfer).where(ShiftTransfer.id == cover.transfer_id))
            if t is not None and t.status == "pending_manager_approval":
                t.status = transfer_status
        cover.status = status
        cover.closed_reason = reason

    for cover, shift, req in rows:
        start = as_utc(shift.start_time)
        if start <= now:
            await _close(cover, "expired", "The shift started", "expired")
            continue
        if (req.status or "").lower() not in ("approved", "confirmed"):
            await _close(cover, "cancelled", "The booking changed (dropped, removed or cancelled)", "cancelled_by_sender")
            continue
        if (shift.status or "").upper() == "CANCELLED":
            await _close(cover, "cancelled", "The position was cancelled", "cancelled_by_sender")
            continue
        if cover.status != "open":
            continue
        left = start - now
        if left <= WARN_3H:
            if cover.warned_3h_at is None:
                cover.warned_3h_at = now
                cover.warned_12h_at = cover.warned_12h_at or now     # never send the 12 h one after the 3 h one
                warnings.append(("3h", cover.id))
        elif left <= WARN_12H and cover.warned_12h_at is None:
            cover.warned_12h_at = now
            warnings.append(("12h", cover.id))
    return warnings
```

---

## B2. NEW FILE `backend/src/services/waitlist.py`

```python
"""
Phase 34: Waitlists for full positions.

* A worker joins the waitlist of a FULL position (one live place per event).
* When a spot opens (someone drops, is removed, a manager adds a spot ...), the background worker
  (every minute, and right after a drop) goes down the line in join order:
    - auto_book = True  -> it asks for the spot for them with the venue's usual rules
                           (request_position: instant booking, or a request the manager reviews)
    - auto_book = False -> they get an OFFER for a short time (30 min; 10 min if the shift starts
                           within 3 hours). Take = same as auto_book. Pass / time out = next person.
* A live offer HOLDS the spot: nobody else can book it while the offer is open (request_position).
* Entries close when the shift starts or is cancelled, or when the person can't be booked anymore
  (the reason is kept in closed_reason and sent to them).
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import Shift, ShiftEvent, ShiftRequest, User, Venue, WaitlistEntry
from src.schemas import ListingWaitlist, WaitlistMine
from src.services.auto_confirm import check_double_booking
from src.services.booking import (
    as_utc, require_certs, prior_drop_in_event, ACTIVE_STATUSES, PENDING_STATUSES, BLOCKED_MESSAGES,
)
from src.services.team import is_blocked

logger = logging.getLogger("shiftboard.waitlist")

LIVE = ("waiting", "offered")
OFFER_TIME = timedelta(minutes=30)
OFFER_TIME_SOON = timedelta(minutes=10)      # when the shift starts within SOON
SOON = timedelta(hours=3)
MAX_STEPS = 25                               # per shift per run


def _is_full(shift: Shift) -> bool:
    cap = shift.capacity if shift.capacity is not None else 1
    return (shift.status or "").upper() == "FILLED" or (shift.spots_filled or 0) >= cap


async def held_by_offers(db: AsyncSession, shift_id, exclude_worker_id=None) -> int:
    """How many spots are held by open waitlist offers (used by request_position and listings)."""
    q = select(func.count(WaitlistEntry.id)).where(
        WaitlistEntry.shift_id == shift_id, WaitlistEntry.status == "offered",
        WaitlistEntry.offer_expires_at > datetime.now(timezone.utc),
    )
    if exclude_worker_id is not None:
        q = q.where(WaitlistEntry.worker_id != exclude_worker_id)
    return int(await db.scalar(q) or 0)


# ------------------------------------------------------------------------------------------------
# Join / leave
# ------------------------------------------------------------------------------------------------
async def join(db: AsyncSession, worker: User, shift_id: UUID, auto_book: bool) -> UUID:
    """Adds the worker to a full position's waitlist. Commits. Returns the entry id."""
    try:
        shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
        if shift is None:
            raise HTTPException(status_code=404, detail="Position not found.")
        st = (shift.status or "").upper()
        if st == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if st == "DRAFT":
            raise HTTPException(status_code=400, detail="This event isn't open for requests.")
        event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
        if event is not None and (event.cancelled_at is not None or (event.status or "published") == "draft"):
            raise HTTPException(status_code=400, detail="This event isn't open for requests.")
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
        cap = shift.capacity if shift.capacity is not None else 1
        if not _is_full(shift) and (shift.spots_filled or 0) + await held_by_offers(db, shift.id, worker.id) < cap:
            raise HTTPException(status_code=400, detail="This position has open spots. Request it instead.")
        if await is_blocked(db, shift.venue_id, worker.id):
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")
        await require_certs(db, worker, shift, you=True)

        same = select(ShiftRequest.id).join(Shift, Shift.id == ShiftRequest.shift_id).where(
            ShiftRequest.worker_id == worker.id, func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
        same = same.where(Shift.event_id == shift.event_id) if shift.event_id else same.where(Shift.id == shift.id)
        if await db.scalar(same.limit(1)):
            raise HTTPException(status_code=400, detail="You already have a request or a booking at this event.")
        mine = await db.scalar(select(ShiftRequest.status).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == worker.id))
        if (mine or "").lower() in BLOCKED_MESSAGES:
            raise HTTPException(status_code=400, detail=BLOCKED_MESSAGES[(mine or "").lower()])
        if await prior_drop_in_event(db, worker.id, shift) is not None:
            raise HTTPException(status_code=400, detail="You dropped a shift at this event, so you can't join its waitlist. Message the manager instead.")
        try:
            await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
        except HTTPException:
            raise HTTPException(status_code=400, detail="You're booked on another shift at that time.")

        live = select(WaitlistEntry.id).where(WaitlistEntry.worker_id == worker.id, WaitlistEntry.status.in_(LIVE))
        live = live.where(WaitlistEntry.event_id == shift.event_id) if shift.event_id else live.where(WaitlistEntry.shift_id == shift.id)
        if await db.scalar(live.limit(1)):
            raise HTTPException(status_code=400, detail="You're already on a waitlist for this event. Leave it first to pick a different position.")

        entry = WaitlistEntry(shift_id=shift.id, venue_id=shift.venue_id, event_id=shift.event_id,
                              worker_id=worker.id, auto_book=bool(auto_book), status="waiting")
        db.add(entry)
        await db.flush()
        entry_id = entry.id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("waitlist join failed")
        raise HTTPException(status_code=500, detail=f"Could not join the waitlist: {e}")
    return entry_id


async def _own_live(db: AsyncSession, worker: User, entry_id: UUID) -> WaitlistEntry:
    entry = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id).with_for_update())
    if entry is None or entry.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if entry.status not in LIVE:
        raise HTTPException(status_code=400, detail="You're not on this waitlist anymore.")
    return entry


async def leave(db: AsyncSession, worker: User, entry_id: UUID) -> UUID:
    """Leaves the waitlist (also turns down an open offer). Commits. Returns the shift id."""
    try:
        entry = await _own_live(db, worker, entry_id)
        entry.status = "left"
        entry.closed_reason = "You left the waitlist"
        shift_id = entry.shift_id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not leave the waitlist: {e}")
    return shift_id


async def pass_offer(db: AsyncSession, worker: User, entry_id: UUID) -> UUID:
    """Turns down an offer. Commits. Returns the shift id (the caller runs process_shift for the next person)."""
    try:
        entry = await _own_live(db, worker, entry_id)
        if entry.status != "offered":
            raise HTTPException(status_code=400, detail="There's no offer to pass on.")
        entry.status = "passed"
        entry.closed_reason = "You passed on the spot"
        shift_id = entry.shift_id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not pass on the offer: {e}")
    return shift_id


async def take_offer(db: AsyncSession, worker: User, entry_id: UUID) -> Tuple[str, UUID]:
    """Takes an open offer: asks for the spot with the venue's usual rules.
    Returns ('booked' | 'requested', request_id). Commits (request_position commits)."""
    from src.services.booking import request_position      # late import: booking imports this module
    entry = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    if entry is None or entry.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if entry.status != "offered":
        raise HTTPException(status_code=400, detail="This offer isn't open anymore.")
    if entry.offer_expires_at is None or as_utc(entry.offer_expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This offer ran out of time.")
    shift_id = entry.shift_id
    request_id = await request_position(db, worker, shift_id, note="From the waitlist")
    return await _mark_done(db, entry_id, request_id)


async def _mark_done(db: AsyncSession, entry_id: UUID, request_id: UUID) -> Tuple[str, UUID]:
    status = (await db.scalar(select(ShiftRequest.status).where(ShiftRequest.id == request_id)) or "").lower()
    result = "requested" if status in PENDING_STATUSES else "booked"
    entry = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    if entry is not None:
        entry.status = result
        entry.request_id = request_id
        entry.closed_reason = None
        await db.commit()
    return result, request_id


# ------------------------------------------------------------------------------------------------
# Views
# ------------------------------------------------------------------------------------------------
async def _live_by_shift(db: AsyncSession, shift_ids: Iterable) -> Dict:
    """shift_id -> live entries in line order."""
    ids = list(shift_ids)
    out: Dict = {}
    if not ids:
        return out
    for e in (await db.execute(
        select(WaitlistEntry).where(WaitlistEntry.shift_id.in_(ids), WaitlistEntry.status.in_(LIVE))
        .order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc())
    )).scalars().all():
        out.setdefault(e.shift_id, []).append(e)
    return out


class ListingInfo:
    """Waitlist facts for a batch of positions, for one viewer (listings) or for a manager (roster)."""

    def __init__(self, by_shift: Dict, viewer_id=None):
        self.by_shift = by_shift
        self.viewer_id = viewer_id
        now = datetime.now(timezone.utc)
        self.held = {sid: sum(1 for e in es if e.status == "offered" and e.offer_expires_at is not None
                              and as_utc(e.offer_expires_at) > now and e.worker_id != viewer_id)
                     for sid, es in by_shift.items()}
        self.my_events = set()
        for es in by_shift.values():
            for e in es:
                if viewer_id is not None and e.worker_id == viewer_id:
                    self.my_events.add(e.event_id or e.shift_id)

    def count(self, shift_id) -> int:
        return len(self.by_shift.get(shift_id, []))

    def mine(self, shift_id) -> Optional[ListingWaitlist]:
        for i, e in enumerate(self.by_shift.get(shift_id, []), start=1):
            if e.worker_id == self.viewer_id:
                return ListingWaitlist(entry_id=e.id, status=e.status, place=i, auto_book=bool(e.auto_book),
                                       offer_expires_at=e.offer_expires_at if e.status == "offered" else None)
        return None


async def listing_info(db: AsyncSession, shift_ids: Iterable, viewer_id=None) -> ListingInfo:
    return ListingInfo(await _live_by_shift(db, shift_ids), viewer_id)


async def my_entries(db: AsyncSession, worker: User) -> List[WaitlistMine]:
    rows = (await db.execute(
        select(WaitlistEntry, Shift, Venue, ShiftEvent)
        .join(Shift, Shift.id == WaitlistEntry.shift_id)
        .join(Venue, Venue.id == WaitlistEntry.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .where(WaitlistEntry.worker_id == worker.id, WaitlistEntry.status.in_(LIVE),
               Shift.start_time > datetime.now(timezone.utc))
        .order_by(Shift.start_time.asc())
    )).all()
    lines = await _live_by_shift(db, {r[1].id for r in rows})
    out = []
    for e, shift, venue, event in rows:
        place = next((i for i, x in enumerate(lines.get(shift.id, []), start=1) if x.id == e.id), 1)
        out.append(WaitlistMine(
            entry_id=e.id, shift_id=shift.id, event_id=shift.event_id,
            title=(event.title if event is not None else None) or shift.title or shift.role_type,
            role_type=shift.role_type or "Shift", venue_name=venue.name,
            venue_timezone=venue.timezone or "America/New_York",
            start_time=shift.start_time, end_time=shift.end_time, status=e.status, place=place,
            auto_book=bool(e.auto_book), offer_expires_at=e.offer_expires_at if e.status == "offered" else None,
        ))
    return out


# ------------------------------------------------------------------------------------------------
# The engine
# ------------------------------------------------------------------------------------------------
async def _close(entry: WaitlistEntry, status: str, reason: str, events: list, notify: bool = True) -> None:
    entry.status = status
    entry.closed_reason = reason
    if notify:
        events.append(("closed", entry.id))


async def process_shift(db: AsyncSession, shift_id, now: datetime, events: list) -> None:
    """Goes down one position's line while there are free spots. Commits as it goes.
    Appends ('offer' | 'booked' | 'requested' | 'closed' | 'expired', entry_id) to `events`."""
    from src.services.booking import request_position      # late import (booking imports this module)
    for _ in range(MAX_STEPS):
        # Lock the position so two runs never hand out the same spot
        shift = await db.scalar(select(Shift).where(Shift.id == shift_id).with_for_update()
                                .execution_options(populate_existing=True))
        if shift is None:
            await db.rollback()
            return
        entries = (await db.execute(
            select(WaitlistEntry).where(WaitlistEntry.shift_id == shift_id, WaitlistEntry.status.in_(LIVE))
            .order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc())
            .execution_options(populate_existing=True)
        )).scalars().all()
        if not entries:
            await db.commit()
            return
        event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
        start = as_utc(shift.start_time)

        # 1. Whole line closes: started / cancelled
        reason = None
        if start <= now:
            reason = "The shift started"
        elif (shift.status or "").upper() == "CANCELLED" or (event is not None and event.cancelled_at is not None):
            reason = "The position was cancelled"
        if reason:
            for e in entries:
                await _close(e, "closed", reason, events, notify=reason != "The shift started")
            await db.commit()
            return

        # 2. Offers that ran out of time
        for e in entries:
            if e.status == "offered" and (e.offer_expires_at is None or as_utc(e.offer_expires_at) <= now):
                e.status = "expired"
                e.closed_reason = "The offer ran out of time"
                events.append(("expired", e.id))
        entries = [e for e in entries if e.status in LIVE]

        # 3. Free spots not already held by an offer or a waiting request from this line
        cap = shift.capacity if shift.capacity is not None else 1
        offered = sum(1 for e in entries if e.status == "offered")
        pending_from_line = int(await db.scalar(
            select(func.count(WaitlistEntry.id)).join(ShiftRequest, ShiftRequest.id == WaitlistEntry.request_id)
            .where(WaitlistEntry.shift_id == shift_id, WaitlistEntry.status == "requested",
                   func.lower(ShiftRequest.status).in_(PENDING_STATUSES))
        ) or 0)
        free = cap - (shift.spots_filled or 0) - offered - pending_from_line
        open_now = (shift.status or "").upper() in ("OPEN", "FILLED")
        waiting = [e for e in entries if e.status == "waiting"]
        if free <= 0 or not open_now or not waiting:
            await db.commit()
            return

        nxt = waiting[0]
        if not nxt.auto_book:
            nxt.status = "offered"
            nxt.offered_at = now
            nxt.offer_expires_at = min(now + (OFFER_TIME_SOON if start - now <= SOON else OFFER_TIME), start)
            events.append(("offer", nxt.id))
            await db.commit()
            continue

        # auto_book: ask for the spot with the venue's usual rules
        entry_id, worker_id = nxt.id, nxt.worker_id
        await db.commit()                                     # release the lock; request_position takes its own
        worker = await db.scalar(select(User).where(User.id == worker_id))
        if worker is None or not worker.is_active:
            e = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
            await _close(e, "closed", "Account not active", events, notify=False)
            await db.commit()
            continue
        try:
            request_id = await request_position(db, worker, shift_id, note="From the waitlist")
        except HTTPException as ex:
            e = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
            if e is not None and e.status in LIVE:
                if ex.detail == "This position just filled up.":
                    await db.commit()
                    return                                    # someone else got it first; stay in line
                await _close(e, "closed", f"We couldn't book you: {ex.detail}", events)
                await db.commit()
            continue
        result, _rid = await _mark_done(db, entry_id, request_id)
        events.append((result, entry_id))


async def process(db: AsyncSession, now: datetime, shift_ids: Optional[Iterable] = None) -> list:
    """Every minute (notification worker): all positions with a live line. Returns the events to notify."""
    if shift_ids is None:
        shift_ids = (await db.execute(
            select(WaitlistEntry.shift_id).where(WaitlistEntry.status.in_(LIVE)).distinct()
        )).scalars().all()
        await db.commit()
    events: list = []
    for sid in list(shift_ids):
        try:
            await process_shift(db, sid, now, events)
        except Exception:
            await db.rollback()
            logger.exception(f"waitlist processing failed for {sid}")
    return events


async def kick(shift_id) -> None:
    """Right after a spot opens (drop, pass ...): run this position's line now. Own session. Never raises."""
    try:
        from src.services import notify_cover
        async with AsyncSessionLocal() as db:
            events = await process(db, datetime.now(timezone.utc), [shift_id])
        await notify_cover.waitlist_events(events)
    except Exception:
        logger.exception("waitlist kick failed")
```

---

## B3. NEW FILE `backend/src/services/notify_cover.py`

```python
"""
Phase 34: Notifications for cover requests and waitlists.

Public functions open their own session, commit and NEVER raise (call them after the main commit).
`*_in` functions run inside a session you already have (the notification worker) and don't commit.

Links:
  cover posts to take  : /worker?tab=find       ("Need cover" section at the top of Find shifts)
  my shifts / offers   : /worker?tab=schedule   (cover status on the card, waitlist offers panel)
  managers             : /venue?venue=<id>&event=<id>
"""
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import CoverRequest, Shift, ShiftRequest, ShiftTransfer, User, Venue, VenueWhitelist, WaitlistEntry
from src.services.notify import notify_in, deliver_soon
from src.services.notify_events import (
    _run, _shift_bundle, _as_utc, when_text, person, place_text, manager_ids, manager_link, worker_shift_link,
)

logger = logging.getLogger("shiftboard.notify_cover")

TEAM_CAP = 50                        # most teammates told about one cover post
URGENT_WITHIN = timedelta(hours=24)
FIND = "/worker?tab=find"
SCHEDULE = "/worker?tab=schedule"


def _what(shift, event, venue) -> str:
    return f"{shift.role_type} · {event.title if event else shift.title}, {when_text(shift.start_time, venue)}"


def _first(u) -> str:
    return (u.first_name if u is not None and u.first_name else None) or person(u)


# ---------------------------------------------------------------------------------------------
# Cover posted
# ---------------------------------------------------------------------------------------------
async def _cover_posted(db: AsyncSession, cover_id) -> None:
    from src.services.cover import taker_check
    from src.services.departments import load_dept_context
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    if cover is None or cover.status != "open":
        return
    shift, venue, event, location = await _shift_bundle(db, cover.shift_id)
    if shift is None or venue is None:
        return
    frm = await db.scalar(select(User).where(User.id == cover.from_worker_id))
    what = _what(shift, event, venue)
    urgent = _as_utc(shift.start_time) - datetime.now(timezone.utc) <= URGENT_WITHIN
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)

    team = (await db.execute(
        select(User).join(VenueWhitelist, VenueWhitelist.worker_id == User.id).where(
            VenueWhitelist.venue_id == venue.id, VenueWhitelist.is_active == True, VenueWhitelist.status == "active",
            User.is_active == True, func.lower(User.role) == "worker", User.id != cover.from_worker_id,
        ).limit(300)
    )).scalars().all()
    depts = await load_dept_context(db, [u.id for u in team], [venue.id])
    told = []
    for u in team:
        if len(told) >= TEAM_CAP:
            break
        if depts.match(u.id, shift) == "outside":
            continue                                            # not their department: they can still find it on the board
        problem, _mode, _note = await taker_check(db, u, cover, shift, venue, depts=depts)
        if problem is None:
            told.append(u.id)
    body = what + (f"\n“{cover.note}”" if cover.note else "") + "\nOpen Find shifts to take it."
    await notify_in(db, told, "cover_needed", f"{_first(frm)} needs someone to cover their shift", body, FIND,
                    urgent=urgent, dedupe_key=f"cover:{cover.id}:posted", **common)
    await notify_in(db, await manager_ids(db, venue.id), "cover_manager",
                    f"{person(frm)} asked for cover", f"{what}\nThey stay booked until someone takes it."
                    + (" Posted on the public shift board too." if cover.audience == "public" and venue.allow_public_cover else ""),
                    manager_link(venue.id, shift.event_id), dedupe_key=f"cover:{cover.id}:posted-mgr", **common)


async def cover_posted(cover_id) -> None:
    await _run("cover_posted", _cover_posted, cover_id)


# ---------------------------------------------------------------------------------------------
# Cover taken (instantly, or waiting for the manager)
# ---------------------------------------------------------------------------------------------
async def _cover_taken(db: AsyncSession, cover_id) -> None:
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    if cover is None or cover.taken_by_worker_id is None:
        return
    shift, venue, event, location = await _shift_bundle(db, cover.shift_id)
    if shift is None:
        return
    frm = await db.scalar(select(User).where(User.id == cover.from_worker_id))
    taker = await db.scalar(select(User).where(User.id == cover.taken_by_worker_id))
    what = _what(shift, event, venue)
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
    key = f"cover:{cover.id}:{cover.transfer_id}:{cover.status}"
    if cover.status == "covered":
        to_req = await db.scalar(select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == taker.id))
        await notify_in(db, [taker.id], "request_approved",
                        f"You're booked: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(covering for {_first(frm)}). Open the shift for arrival info and notes.",
                        worker_shift_link(to_req.id) if to_req else SCHEDULE,
                        request_id=to_req.id if to_req else None, dedupe_key=key, **common)
        await notify_in(db, [frm.id], "cover_update", f"{person(taker)} is covering your shift",
                        f"{what}\nYou're off this shift.", SCHEDULE, dedupe_key=key, **common)
        await notify_in(db, await manager_ids(db, shift.venue_id), "cover_manager",
                        f"{person(taker)} is covering for {person(frm)}", what,
                        manager_link(shift.venue_id, shift.event_id), dedupe_key=key, **common)
    elif cover.status == "pending_approval":
        await notify_in(db, await manager_ids(db, shift.venue_id), "swap_pending",
                        f"Cover waiting: {person(taker)} wants to cover for {person(frm)}", what,
                        manager_link(shift.venue_id, shift.event_id), dedupe_key=key, **common)
        await notify_in(db, [frm.id], "cover_update", f"{person(taker)} wants to cover your shift",
                        f"{what}\nWaiting for the manager to approve. You're still on it until then.",
                        SCHEDULE, dedupe_key=key, **common)


async def cover_taken(cover_id) -> None:
    await _run("cover_taken", _cover_taken, cover_id)


async def transfer_decided_in(db: AsyncSession, t: ShiftTransfer) -> None:
    """Called by notify_events._transfer_changed for hand-offs that came from a cover post."""
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == t.cover_request_id))
    shift, venue, event, location = await _shift_bundle(db, t.shift_id)
    if cover is None or shift is None:
        return
    frm = await db.scalar(select(User).where(User.id == t.from_worker_id))
    taker = await db.scalar(select(User).where(User.id == t.to_worker_id))
    what = _what(shift, event, venue)
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
    st = (t.status or "").lower()
    key = f"cover-transfer:{t.id}:{st}"
    if st == "approved":
        to_req = await db.scalar(select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == t.to_worker_id))
        await notify_in(db, [t.to_worker_id], "request_approved",
                        f"You're booked: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(covering for {_first(frm)}). Open the shift for arrival info and notes.",
                        worker_shift_link(to_req.id) if to_req else SCHEDULE,
                        request_id=to_req.id if to_req else None, dedupe_key=key, **common)
        await notify_in(db, [t.from_worker_id], "cover_update", f"Cover approved: {person(taker)} is taking your shift",
                        f"{what}\nYou're off this shift.", SCHEDULE, dedupe_key=key, **common)
    elif st == "cancelled_by_sender":
        await notify_in(db, [t.to_worker_id], "cover_update", f"{_first(frm)} doesn't need cover anymore",
                        f"{what}\nThey're keeping the shift.", FIND, dedupe_key=key, **common)
    elif st in ("denied", "declined"):
        await notify_in(db, [t.to_worker_id], "cover_update", "The manager didn't approve you covering this shift",
                        f"{what}\n{_first(frm)} stays on it.", FIND, dedupe_key=key, **common)
        still_open = cover.status == "open"
        await notify_in(db, [t.from_worker_id], "cover_update", f"The manager didn't approve {person(taker)} covering",
                        f"{what}\nYou're still on this shift." + (" Your cover request is open again." if still_open else ""),
                        SCHEDULE, dedupe_key=key, **common)


# ---------------------------------------------------------------------------------------------
# 12 h / 3 h warnings (notification worker)
# ---------------------------------------------------------------------------------------------
async def warnings_in(db: AsyncSession, warnings) -> int:
    sent = 0
    for which, cover_id in warnings:
        cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
        if cover is None:
            continue
        shift, venue, event, location = await _shift_bundle(db, cover.shift_id)
        if shift is None:
            continue
        frm = await db.scalar(select(User).where(User.id == cover.from_worker_id))
        what = _what(shift, event, venue)
        urgent = which == "3h"
        hours = "3 hours" if urgent else "12 hours"
        common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
        sent += await notify_in(
            db, [cover.from_worker_id], "cover_warning", f"Nobody has taken your shift yet (starts in about {hours})",
            f"{what}\nYou're still booked. If you can't make it, message your manager now.",
            SCHEDULE, urgent=urgent, dedupe_key=f"cover:{cover.id}:warn-{which}", **common)
        sent += await notify_in(
            db, await manager_ids(db, shift.venue_id), "cover_manager",
            f"Still needs cover: {person(frm)}'s shift starts in about {hours}",
            f"{what}\nNobody has taken it. {_first(frm)} is still booked.",
            manager_link(shift.venue_id, shift.event_id), urgent=urgent,
            dedupe_key=f"cover:{cover.id}:warn-{which}-mgr", **common)
    return sent


# ---------------------------------------------------------------------------------------------
# Waitlist
# ---------------------------------------------------------------------------------------------
async def waitlist_events_in(db: AsyncSession, events) -> int:
    sent = 0
    for kind, entry_id in events:
        e = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
        if e is None:
            continue
        shift, venue, event, location = await _shift_bundle(db, e.shift_id)
        if shift is None:
            continue
        what = _what(shift, event, venue)
        common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
        key = f"waitlist:{e.id}:{kind}:{e.offered_at.isoformat() if e.offered_at else ''}"
        if kind == "offer":
            mins = max(1, round((_as_utc(e.offer_expires_at) - datetime.now(timezone.utc)).total_seconds() / 60)) if e.offer_expires_at else 10
            sent += await notify_in(db, [e.worker_id], "waitlist_offer", f"A spot opened up: {shift.role_type}",
                                    f"{what}\nYou're next on the waitlist. Take it in the next {mins} minutes or it goes to the next person.",
                                    SCHEDULE, urgent=True, dedupe_key=key, **common)
        elif kind == "booked":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", f"You're booked from the waitlist: {shift.role_type}",
                                    f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}. "
                                    "Open the shift for arrival info and notes.",
                                    worker_shift_link(e.request_id) if e.request_id else SCHEDULE,
                                    request_id=e.request_id, urgent=True, dedupe_key=key, **common)
        elif kind == "requested":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", f"A spot opened up: {shift.role_type}",
                                    f"{what}\nWe sent your request from the waitlist. The manager will review it.",
                                    SCHEDULE, dedupe_key=key, **common)
        elif kind == "expired":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", "Your waitlist offer ran out of time",
                                    f"{what}\nThe spot went to the next person. You can join the waitlist again.",
                                    FIND, dedupe_key=key, **common)
        elif kind == "closed":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", "You're off a waitlist",
                                    f"{what}\n{e.closed_reason or 'The waitlist closed.'}", FIND, dedupe_key=key, **common)
    return sent


async def waitlist_events(events) -> None:
    if not events:
        return
    try:
        async with AsyncSessionLocal() as db:
            await waitlist_events_in(db, events)
            await db.commit()
        deliver_soon()
    except Exception:
        logger.exception("waitlist notifications failed")
```

---

## B4. `backend/src/services/booking.py` (EDIT)
A spot offered to someone on the waitlist is held for them (checked under the position lock, after the capacity check). The import is inside the function on purpose: `waitlist.py` imports `booking.py`.

**Edit 1.** Find:
```python
        if shift_status != "OPEN" or (shift.spots_filled or 0) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position just filled up.")

        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
```
Replace with:
```python
        if shift_status != "OPEN" or (shift.spots_filled or 0) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position just filled up.")
        # Phase 34: a spot offered to someone on the waitlist is held for them until the offer runs out
        from src.services.waitlist import held_by_offers
        if (shift.spots_filled or 0) + await held_by_offers(db, shift.id, exclude_worker_id=worker.id) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position just filled up.")

        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
```

---

## B5. `backend/src/services/listings.py` (EDITS)
Full events are listed (`full`), waitlist info per position, offered spots subtracted from `spots_left`.

**Edit 1.** Find:
```python
from src.services.fit import load_fit, load_requirements, required_for, tz_of, cert_label   # Phase 31 + 32
from src.services.departments import load_dept_context   # Phase 32.2
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
```
Replace with:
```python
from src.services.fit import load_fit, load_requirements, required_for, tz_of, cert_label   # Phase 31 + 32
from src.services.departments import load_dept_context   # Phase 32.2
from src.services import waitlist as waitlist_svc          # Phase 34
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
```

**Edit 2.** Find:
```python
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    Phase 32.3: in single mode, `series` holds the series' other upcoming dates (list-mode rules);
```
Replace with:
```python
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Phase 34: full events are listed too (full=True) so people can join a waitlist.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    Phase 32.3: in single mode, `series` holds the series' other upcoming dates (list-mode rules);
```

**Edit 3.** Find:
```python
    requirements = await load_requirements(db, venue_ids)
    depts = await load_dept_context(db, [user.id], venue_ids)            # Phase 32.2

    out: List[EventListing] = []
```
Replace with:
```python
    requirements = await load_requirements(db, venue_ids)
    depts = await load_dept_context(db, [user.id], venue_ids)            # Phase 32.2
    wl = await waitlist_svc.listing_info(db, [s.id for s in shifts], user.id)   # Phase 34
    removed_here = {s.id for s in shifts if s.id in mine and (mine[s.id].status or "").lower() in ("removed", "no_show")}

    out: List[EventListing] = []
```

**Edit 4.** Find:
```python
            rate_max = _f(s.hourly_rate_max) if visible else None
            cap = s.capacity if s.capacity is not None else 1
            left = max(0, cap - (s.spots_filled or 0))
            is_open = (s.status or "").upper() == "OPEN" and left > 0
            decision, _src = decide_approval(s, venue, user, venue.id in whitelisted)
```
Replace with:
```python
            rate_max = _f(s.hourly_rate_max) if visible else None
            cap = s.capacity if s.capacity is not None else 1
            left = max(0, cap - (s.spots_filled or 0) - wl.held.get(s.id, 0))   # Phase 34: offered spots are held
            is_open = (s.status or "").upper() == "OPEN" and left > 0
            decision, _src = decide_approval(s, venue, user, venue.id in whitelisted)
```

**Edit 5.** Find:
```python
                department=depts.dept_of(s.venue_id, s.role_type),
                department_match=dmatch,
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        requestable = [p for p in open_positions if not p.missing_certs]      # Phase 32
        if event_id is None and not open_positions and my_request is None:
            continue   # list mode: nothing to request and nothing of mine here

        conflict = None
```
Replace with:
```python
                department=depts.dept_of(s.venue_id, s.role_type),
                department_match=dmatch,
                waitlist_count=wl.count(s.id),                                        # Phase 34
                my_waitlist=wl.mine(s.id),
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        requestable = [p for p in open_positions if not p.missing_certs]      # Phase 32
        full = bool(positions) and not open_positions                          # Phase 34
        if event_id is None and not positions:
            continue   # list mode: nothing here at all

        conflict = None
```

**Edit 6.** Find:
```python
        started = start <= now
        cancelled = ev.cancelled_at is not None
        can_request = (
            not cancelled
```
Replace with:
```python
        started = start <= now
        cancelled = ev.cancelled_at is not None
        # Phase 34: who can join a full position's waitlist (one place per event)
        in_line = any(p.my_waitlist is not None for p in positions)
        for p in positions:
            p.can_waitlist = (
                p.status == "FILLED" and not cancelled and not started and not in_line
                and my_request is None and conflict is None and dropped_here is None
                and not p.missing_certs and p.shift_id not in removed_here
                and (ev.status or "published") == "published"
            )
        can_request = (
            not cancelled
```

**Edit 7.** Find:
```python
            department_match=_event_match(open_positions or positions),                 # Phase 32.2
            series_id=ev.series_id,                                                     # Phase 32.3
        ))

```
Replace with:
```python
            department_match=_event_match(open_positions or positions),                 # Phase 32.2
            series_id=ev.series_id,                                                     # Phase 32.3
            full=full,                                                                  # Phase 34
        ))

```

---

## B6. `backend/src/services/notify.py` (EDIT)
Six new notification kinds.

**Edit 1.** Find:
```python
    "cert_review": ("booking", False),       # Phase 32: a manager verified / didn't accept a certificate
    "cert_expiring": ("reminder", False),    # Phase 32: a certificate expires in 30 / 7 days, or today
    "test": ("test", True),
}
```
Replace with:
```python
    "cert_review": ("booking", False),       # Phase 32: a manager verified / didn't accept a certificate
    "cert_expiring": ("reminder", False),    # Phase 32: a certificate expires in 30 / 7 days, or today
    "cover_needed": ("booking", True),       # Phase 34: a teammate needs someone to cover their shift
    "cover_update": ("booking", False),      # Phase 34: your cover request was taken / approved / not approved
    "cover_warning": ("booking", True),      # Phase 34: nobody has taken your shift 12 h / 3 h before it starts
    "cover_manager": ("manager", True),      # Phase 34: managers: cover asked / covered / still uncovered
    "waitlist_offer": ("booking", True),     # Phase 34: a spot opened and you're next (short time to take it)
    "waitlist_update": ("booking", False),   # Phase 34: booked / request sent / offer ran out / waitlist closed
    "test": ("test", True),
}
```

---

## B7. `backend/src/services/notify_events.py` (EDIT)
Hand-offs that came from a cover post use the cover wording.

**Edit 1.** Find:
```python
    if shift is None:
        return
    frm = await db.scalar(select(User).where(User.id == t.from_worker_id))
    to = await db.scalar(select(User).where(User.id == t.to_worker_id))
```
Replace with:
```python
    if shift is None:
        return
    if t.cover_request_id:                        # Phase 34: came from a cover post (its own wording)
        from src.services import notify_cover
        await notify_cover.transfer_decided_in(db, t)
        return
    frm = await db.scalar(select(User).where(User.id == t.from_worker_id))
    to = await db.scalar(select(User).where(User.id == t.to_worker_id))
```

---

## B8. `backend/src/services/notification_worker.py` (EDITS)
Cover sweep + 12 h / 3 h warnings, and the waitlist engine, every minute.

**Edit 1.** Find:
```python
  5. managers: a position still has open spots 3 hours before it starts (once per position; Phase 30)
  5b. workers: a certificate expires in 30 days, in 7 days, or today (once each; Phase 32)
  6. send due email / SMS from the outbox

```
Replace with:
```python
  5. managers: a position still has open spots 3 hours before it starts (once per position; Phase 30)
  5b. workers: a certificate expires in 30 days, in 7 days, or today (once each; Phase 32)
  5c. cover requests: close stale ones, warn 12 h / 3 h before start if nobody took it (Phase 34)
  5d. waitlists: give opened spots to the next person in line, expire old offers (Phase 34)
  6. send due email / SMS from the outbox

```

**Edit 2.** Find:
```python


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled), ("certs", scan_expiring_certs)):
        try:
            async with AsyncSessionLocal() as db:
                await fn(db, now)
                await db.commit()
        except Exception:
            logger.exception(f"notification scan '{label}' failed")
    try:
        async with AsyncSessionLocal() as db:
```
Replace with:
```python


async def scan_cover(db: AsyncSession, now: datetime) -> int:
    """Phase 34: close stale cover posts, then warn the worker + managers 12 h / 3 h before the start."""
    from src.services import cover, notify_cover
    warnings = await cover.sweep(db, now)
    return await notify_cover.warnings_in(db, warnings)


async def run_waitlists(now: datetime) -> None:
    """Phase 34: waitlist engine (commits as it goes), then its notifications."""
    from src.services import waitlist, notify_cover
    async with AsyncSessionLocal() as db:
        events = await waitlist.process(db, now)
    async with AsyncSessionLocal() as db:
        await notify_cover.waitlist_events_in(db, events)
        await db.commit()


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled), ("certs", scan_expiring_certs), ("cover", scan_cover)):
        try:
            async with AsyncSessionLocal() as db:
                await fn(db, now)
                await db.commit()
        except Exception:
            logger.exception(f"notification scan '{label}' failed")
    try:
        await run_waitlists(now)                                                   # Phase 34
    except Exception:
        logger.exception("waitlist processing failed")
    try:
        async with AsyncSessionLocal() as db:
```

---

## B9. `backend/src/services/activity.py` (EDITS)

**Edit 1.** Find:
```python
    "request_withdrawn": "bookings",
    "shift_dropped": "bookings",
    "person_removed": "bookings",
    "transfer_approved": "bookings",
```
Replace with:
```python
    "request_withdrawn": "bookings",
    "shift_dropped": "bookings",
    "cover_requested": "bookings",       # Phase 34
    "cover_taken": "bookings",
    "cover_pending": "bookings",
    "person_removed": "bookings",
    "transfer_approved": "bookings",
```

**Edit 2.** Find:
```python
        "request_withdrawn": f"{name} withdrew their request for {what}",
        "shift_dropped": f"{name} dropped {what}",
        "person_removed": f"Removed {name} from {what}",
        "assigned": f"Assigned {name} to {what}",
```
Replace with:
```python
        "request_withdrawn": f"{name} withdrew their request for {what}",
        "shift_dropped": f"{name} dropped {what}",
        "cover_requested": f"{name} asked for cover on {what}",              # Phase 34
        "cover_taken": f"{name} is covering {what}",
        "cover_pending": f"Cover for {name} on {what} is waiting for approval",
        "person_removed": f"Removed {name} from {what}",
        "assigned": f"Assigned {name} to {what}",
```

---

# PART C: Backend routes

## C1. NEW FILE `backend/src/routers/cover.py`

```python
"""
Phase 34: Cover requests ("I need cover") and waitlists for full positions.
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, CoverRequest, ShiftRequest
from src.schemas import (
    CoverPostBody, CoverPostResult, CoverListing, CoverMine, CoverTakeResult,
    WaitlistJoinBody, WaitlistMine, WaitlistActionResult,
)
from src.auth import get_current_user, require_worker
from src.services import cover as cover_svc
from src.services import waitlist
from src.services import notify_cover
from src.services import activity

router = APIRouter(prefix="/api", tags=["Cover & waitlists"])


# ------------------------------------------------------------------------------------------------
# Cover requests
# ------------------------------------------------------------------------------------------------
@router.post("/cover", response_model=CoverPostResult, status_code=status.HTTP_201_CREATED)
async def post_cover_request(
    body: CoverPostBody,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Ask your venue team (and optionally the public shift board) to take one of your booked shifts.
    You stay booked until someone takes it."""
    cover_id = await cover_svc.post_cover(db, current_user, body.request_id, body.audience, body.note)
    await notify_cover.cover_posted(cover_id)
    await activity.for_request("cover_requested", body.request_id, current_user.id,
                               "team + public board" if body.audience == "public" else "team only")
    return CoverPostResult(
        cover_id=cover_id,
        message="Cover request posted. You're still on this shift until someone takes it.",
    )


@router.post("/cover/{cover_id}/cancel", response_model=CoverPostResult)
async def cancel_cover_request(
    cover_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Take your cover request down (only while nobody has taken it)."""
    await cover_svc.cancel_cover(db, current_user, cover_id)
    return CoverPostResult(cover_id=cover_id, message="Cover request cancelled. You're keeping this shift.")


@router.get("/cover/open", response_model=List[CoverListing])
async def list_open_cover(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Shifts that need cover and that you can see: your teams' posts, plus public posts."""
    return await cover_svc.open_for(db, current_user)


@router.get("/cover/mine", response_model=List[CoverMine])
async def list_my_cover(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your live cover requests (open, or taken and waiting for the manager)."""
    return await cover_svc.mine(db, current_user)


@router.post("/cover/{cover_id}/take", response_model=CoverTakeResult)
async def take_cover_request(
    cover_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Take a shift that needs cover. Same rules as a normal request at that venue:
    instant booking swaps it now; otherwise the manager approves it in their hand-off queue."""
    result, _transfer_id = await cover_svc.take_cover(db, current_user, cover_id)
    await notify_cover.cover_taken(cover_id)
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    request_id = None
    if result == "covered":
        request_id = await db.scalar(select(ShiftRequest.id).where(
            ShiftRequest.shift_id == cover.shift_id, ShiftRequest.worker_id == current_user.id))
        await activity.for_request("cover_taken", request_id, current_user.id, "no approval needed")
        message = "You're booked! It's in My shifts."
    else:
        await activity.for_request("cover_pending", cover.request_id, current_user.id,
                                   f"{current_user.first_name or 'Someone'} wants to take it")
        message = "Sent. The manager has to approve it. Until then it's still theirs."
    return CoverTakeResult(status=result, message=message, request_id=request_id)


# ------------------------------------------------------------------------------------------------
# Waitlists
# ------------------------------------------------------------------------------------------------
@router.post("/waitlist", response_model=WaitlistActionResult, status_code=status.HTTP_201_CREATED)
async def join_waitlist(
    body: WaitlistJoinBody,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Join a full position's waitlist. auto_book=true: we ask for the spot for you as soon as one opens."""
    entry_id = await waitlist.join(db, current_user, body.shift_id, body.auto_book)
    return WaitlistActionResult(
        status="waiting", entry_id=entry_id,
        message=("You're on the waitlist. If a spot opens we'll ask for it for you right away."
                 if body.auto_book else
                 "You're on the waitlist. If a spot opens we'll offer it to you first."),
    )


@router.get("/waitlist/mine", response_model=List[WaitlistMine])
async def my_waitlists(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your places in line (waiting, or offered a spot right now)."""
    return await waitlist.my_entries(db, current_user)


@router.post("/waitlist/{entry_id}/leave", response_model=WaitlistActionResult)
async def leave_waitlist(
    entry_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    shift_id = await waitlist.leave(db, current_user, entry_id)
    await waitlist.kick(shift_id)          # if they were holding an offer, the next person gets it
    return WaitlistActionResult(status="left", entry_id=entry_id, message="You left the waitlist.")


@router.post("/waitlist/{entry_id}/take", response_model=WaitlistActionResult)
async def take_waitlist_offer(
    entry_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Take the spot you were offered (the venue's usual rules apply)."""
    result, request_id = await waitlist.take_offer(db, current_user, entry_id)
    return WaitlistActionResult(
        status=result, entry_id=entry_id, request_id=request_id,
        message="You're booked! It's in My shifts." if result == "booked" else "Request sent. The manager will review it.",
    )


@router.post("/waitlist/{entry_id}/pass", response_model=WaitlistActionResult)
async def pass_waitlist_offer(
    entry_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Turn down the spot. It goes to the next person in line."""
    shift_id = await waitlist.pass_offer(db, current_user, entry_id)
    await waitlist.kick(shift_id)
    return WaitlistActionResult(status="passed", entry_id=entry_id, message="Passed. The spot goes to the next person.")
```

---

## C2. `backend/src/main.py` (EDITS)
**Only** these two lines: import and include the new router. Nothing else in main.py changes.

**Edit 1.** Find:
```python
from src.routers.event_templates import router as event_templates_router
from src.routers.profile import router as profile_router   # Phase 31 + 32
from src.services.notification_worker import notification_worker_loop

```
Replace with:
```python
from src.routers.event_templates import router as event_templates_router
from src.routers.profile import router as profile_router   # Phase 31 + 32
from src.routers.cover import router as cover_router       # Phase 34
from src.services.notification_worker import notification_worker_loop

```

**Edit 2.** Find:
```python
app.include_router(event_templates_router)
app.include_router(profile_router)   # Phase 31 + 32


```
Replace with:
```python
app.include_router(event_templates_router)
app.include_router(profile_router)   # Phase 31 + 32
app.include_router(cover_router)     # Phase 34


```

---

## C3. `backend/src/routers/transfers.py` (EDITS)
Refuse a direct hand-off while a cover request is live. Manager review only acts on hand-offs waiting for the manager, and keeps the cover post in step (approve / deny / the poster withdraws).

**Edit 1.** Find:
```python
from src.services.team import get_transfer_candidates
from src.services.booking import require_certs, refuse_if_blocked   # Phase 32 / 32.1

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])
```
Replace with:
```python
from src.services.team import get_transfer_candidates
from src.services.booking import require_certs, refuse_if_blocked   # Phase 32 / 32.1
from src.services import cover as cover_svc                          # Phase 34

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])
```

**Edit 2.** Find:
```python
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You do not hold a confirmed spot on this shift."
        )

```
Replace with:
```python
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You do not hold a confirmed spot on this shift."
        )
    # Phase 34: one way out at a time: a live cover request blocks a direct hand-off
    if await db.scalar(select(cover_svc.CoverRequest.id).where(
            cover_svc.CoverRequest.request_id == ownership.id, cover_svc.CoverRequest.status.in_(cover_svc.LIVE))):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You've asked for cover on this shift. Cancel the cover request first to hand it to someone directly."
        )

```

**Edit 3.** Find:
```python
            detail="You can't change this hand-off."
        )

    await db.commit()
```
Replace with:
```python
            detail="You can't change this hand-off."
        )
    await cover_svc.after_transfer_review(db, transfer)          # Phase 34: keep a cover post in step

    await db.commit()
```

**Edit 4.** Find:
```python

    action = body.action.lower().strip()
    if action == "approve":
        shift = transfer.shift

        # Double check double-booking before proceeding
```
Replace with:
```python

    action = body.action.lower().strip()
    # Phase 34: only a hand-off that's waiting for the manager can be approved or denied
    if (transfer.status or "").lower() != "pending_manager_approval":
        raise HTTPException(status_code=400, detail="This hand-off is already settled.")
    if action == "approve":
        shift = transfer.shift
        await cover_svc.check_before_approve(db, transfer)          # Phase 34: the original worker still holds it

        # Double check double-booking before proceeding
```

**Edit 5.** Find:
```python
        transfer.status = "denied"
    else:
        raise HTTPException(status_code=400, detail="Something went wrong. Refresh the page and try again.")

    await db.commit()
    await db.refresh(transfer)
```
Replace with:
```python
        transfer.status = "denied"
    else:
        raise HTTPException(status_code=400, detail="Something went wrong. Refresh the page and try again.")
    await cover_svc.after_transfer_review(db, transfer)          # Phase 34: keep a cover post in step

    await db.commit()
    await db.refresh(transfer)
```

---

## C4. `backend/src/routers/shifts.py` (EDITS)
Dropping closes the cover post and runs the waitlist right away; the late-drop message mentions cover.

**Edit 1.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="It starts in less than 24 hours, so it can't be dropped. Hand it off to a teammate or message your manager."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="It starts in less than 24 hours, so it can't be dropped. Ask for cover, hand it off to a teammate, or message your manager."
        )

```

**Edit 2.** Find:
```python
        if shift.status == "FILLED":
            shift.status = "OPEN"

        # Step 3: Commit transaction
```
Replace with:
```python
        if shift.status == "FILLED":
            shift.status = "OPEN"
        # Phase 34: their cover request (and a cover take waiting for the manager) closes with the booking
        from src.services.cover import close_for_request
        await close_for_request(db, shift_req.id, "You dropped this shift")

        # Step 3: Commit transaction
```

**Edit 3.** Find:
```python
    # Phase 29.1: managers hear about drops right away (after commit; never raises)
    await notify_events.shift_dropped(shift_req.id)
    await activity.for_request("shift_dropped", shift_req.id, current_user.id,
                               f"“{shift_req.status_reason}”" if shift_req.status_reason else "")   # Phase 29.4: with their reason
```
Replace with:
```python
    # Phase 29.1: managers hear about drops right away (after commit; never raises)
    await notify_events.shift_dropped(shift_req.id)
    from src.services import waitlist
    await waitlist.kick(shift.id)          # Phase 34: the freed spot goes to the waitlist right away (never raises)
    await activity.for_request("shift_dropped", shift_req.id, current_user.id,
                               f"“{shift_req.status_reason}”" if shift_req.status_reason else "")   # Phase 29.4: with their reason
```

---

## C5. `backend/src/routers/venues.py` (EDITS)
Manager events list: `cover` on booked people, `waitlist` names per position.

**Edit 1.** Find:
```python
                )

    events = {}
    order = []
```
Replace with:
```python
                )

    # Phase 34: who asked for cover, and who is waiting in line for a full position
    from src.models import CoverRequest, WaitlistEntry
    cover_by_request = dict((await db.execute(
        select(CoverRequest.request_id, CoverRequest.status).where(
            CoverRequest.shift_id.in_(shift_ids), CoverRequest.status.in_(("open", "pending_approval")))
    )).all())
    for ps in assigned_by_shift.values():
        for person in ps:
            person.cover = cover_by_request.get(person.request_id)
    waitlist_by_shift = defaultdict(list)
    for e, wu in (await db.execute(
        select(WaitlistEntry, User).join(User, User.id == WaitlistEntry.worker_id)
        .where(WaitlistEntry.shift_id.in_(shift_ids), WaitlistEntry.status.in_(("waiting", "offered")))
        .order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc())
    )).all():
        waitlist_by_shift[e.shift_id].append(
            f"{wu.first_name or ''} {(wu.last_name or '')[:1]}{'.' if wu.last_name else ''}".strip() or "Someone")

    events = {}
    order = []
```

**Edit 2.** Find:
```python
            offers=offers_by_shift[s.id],
            dropped=dropped_by_shift[s.id],            # Phase 29.4
        ))

```
Replace with:
```python
            offers=offers_by_shift[s.id],
            dropped=dropped_by_shift[s.id],            # Phase 29.4
            waitlist=waitlist_by_shift[s.id],          # Phase 34
        ))

```

---

# PART D: Frontend, worker

## D1. NEW FILE `frontend/src/components/worker/CoverDialog.jsx`

```jsx
import React, { useState } from 'react';
import { LifeBuoy, Users, Globe, Info } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import PayLabel from '../PayLabel';
import { fmtDateTime } from '../../utils/venueTime';

/**
 * Phase 34: Ask for cover on one of my booked shifts.
 * The worker picks who can see it: their team at this venue, or the team AND the public shift board
 * (only when the venue allows it). They stay booked until someone takes it.
 * Props: req (ShiftRequestResponse), onClose, onPosted(message)
 */
export default function CoverDialog({ req, onClose, onPosted }) {
  const shift = req.shift || {};
  const venue = shift.venue || {};
  const publicAllowed = venue.allow_public_cover !== false;
  const [audience, setAudience] = useState('team');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/cover', { request_id: req.id, audience, note: note.trim() || null });
      onPosted(res.data?.message || 'Cover request posted.');
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not post your cover request.');
    } finally {
      setBusy(false);
    }
  };

  const option = (id, Icon, title, text, disabled = false) => (
    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
      disabled ? 'opacity-50 cursor-not-allowed border-slate-800'
        : audience === id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
      <input type="radio" name="cover-audience" value={id} checked={audience === id} disabled={disabled}
        onChange={() => setAudience(id)} className="mt-1 accent-emerald-500" />
      <Icon className="w-4 h-4 mt-0.5 text-emerald-300 flex-shrink-0" />
      <span className="text-xs">
        <span className="block font-bold text-white text-sm">{title}</span>
        <span className="text-slate-400">{text}</span>
      </span>
    </label>
  );

  return (
    <ModalShell
      title="Ask for cover"
      icon={<LifeBuoy className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Close
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
            {busy ? 'Posting…' : 'Post cover request'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
          <p className="font-bold text-white">{shift.title}</p>
          <p className="text-slate-400">
            {venue.name} · {shift.role_type} · <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} />
          </p>
          <p className="text-slate-500">{fmtDateTime(shift.start_time, venue.timezone)}</p>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="Who can see it">
          <p className="text-xs font-semibold text-slate-300">Who can see it</p>
          {option('team', Users, `My team at ${venue.name || 'this venue'}`,
            'People on the venue team get a notification if it fits their departments.')}
          {option('public', Globe, 'My team + the public shift board',
            publicAllowed
              ? 'Also listed on Find shifts for anyone. People outside the team need the manager to approve.'
              : `${venue.name || 'This venue'} only allows asking the team.`,
            !publicAllowed)}
        </div>
        <label className="block text-xs font-semibold text-slate-300">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="e.g. Family thing came up. Happy to swap for a Sunday."
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </label>
        <p className="text-[11px] text-slate-400 bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex gap-2">
          <Info className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <span>
            You stay booked until someone takes it. If nobody does, we'll remind you 12 hours and 3 hours before
            the start. Asking for cover never counts against your reliability.
          </span>
        </p>
      </div>
    </ModalShell>
  );
}
```

---

## D2. NEW FILE `frontend/src/components/worker/CoverBoard.jsx`

```jsx
import React from 'react';
import { LifeBuoy, Zap, Clock, Globe, Users, AlertCircle } from 'lucide-react';
import PayLabel from '../PayLabel';
import TipBadge from '../TipBadge';
import { fmtDate, fmtTimeRange } from '../../utils/venueTime';

/**
 * Phase 34: "Need cover" on Find shifts: teammates' (and public) shifts that need someone.
 * Props: items (CoverListing[] from GET /api/cover/open), busyId, onTake(item)
 */
export default function CoverBoard({ items = [], busyId, onTake }) {
  if (!items.length) return null;
  return (
    <section className="mt-6 bg-amber-500/5 border border-amber-500/40 rounded-2xl p-4 space-y-3" aria-label="Shifts that need cover">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
          <LifeBuoy className="w-4 h-4 text-amber-300" />
          Need cover ({items.length})
        </div>
        <p className="text-[11px] text-amber-200/70 mt-0.5">Someone booked can't make it. Take it and it's yours (some need the manager's OK).</p>
      </div>
      {items.map((c) => {
        const busy = busyId === c.cover_id;
        return (
          <div key={c.cover_id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{c.role_type}</span>
                <span className="text-sm font-bold text-white">{c.title}</span>
                <span className="text-xs text-slate-400">· {c.venue_name}</span>
                {c.audience === 'public' && !c.on_team ? (
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-1"><Globe className="w-3 h-3" /> Public</span>
                ) : (
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-1"><Users className="w-3 h-3" /> Your team</span>
                )}
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {fmtDate(c.start_time, c.venue_timezone)} · {fmtTimeRange(c.start_time, c.end_time, c.venue_timezone)}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                <PayLabel rate={c.hourly_rate} rateMax={c.hourly_rate_max} className="text-emerald-400 font-semibold" />
                <TipBadge shift={c} />
                <span className="text-slate-400">Covering for {c.from_first_name}</span>
              </div>
              {c.note && <div className="text-xs text-amber-100 italic mt-1">“{c.note}”</div>}
              {c.can_take && c.booking === 'approval' && (
                <div className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> The manager has to approve it</div>
              )}
              {c.can_take && c.take_note && <div className="text-[11px] text-amber-300 mt-1">{c.take_note}</div>}
              {!c.can_take && c.problem && (
                <div className="text-[11px] text-rose-300 mt-1 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {c.problem}</div>
              )}
            </div>
            {c.can_take && (
              <button type="button" onClick={() => onTake(c)} disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto">
                {c.booking === 'instant' && <Zap className="w-4 h-4" />}
                {busy ? '…' : c.booking === 'instant' ? 'Take it' : 'Ask to take it'}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
```

---

## D3. NEW FILE `frontend/src/components/worker/WaitlistPanel.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Hourglass, Check, X, ListOrdered, Zap } from 'lucide-react';
import { fmtDate, fmtTimeRange } from '../../utils/venueTime';

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function left(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Phase 34: My waitlists (on My shifts). Offers first (Take / Pass with a countdown), then my places in line.
 * Props: entries (WaitlistMine[] from GET /api/waitlist/mine), busyId, onTake(e), onPass(e), onLeave(e), onExpired()
 */
export default function WaitlistPanel({ entries = [], busyId, onTake, onPass, onLeave, onExpired }) {
  const offers = entries.filter((e) => e.status === 'offered');
  const waiting = entries.filter((e) => e.status === 'waiting');
  const now = useNow(offers.length > 0);
  const anyRanOut = offers.some((o) => new Date(o.offer_expires_at).getTime() <= now);
  useEffect(() => {
    if (anyRanOut && onExpired) onExpired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyRanOut]);
  if (!entries.length) return null;

  const line = (e) => (
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{e.role_type}</span>
        <span className="text-sm font-bold text-white">{e.title}</span>
        <span className="text-xs text-slate-400">· {e.venue_name}</span>
      </div>
      <div className="text-xs text-slate-300 mt-1">
        {fmtDate(e.start_time, e.venue_timezone)} · {fmtTimeRange(e.start_time, e.end_time, e.venue_timezone)}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {offers.length > 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-100">
            <Hourglass className="w-4 h-4 text-emerald-300" />
            A spot opened for you ({offers.length})
          </div>
          {offers.map((e) => {
            const ms = new Date(e.offer_expires_at).getTime() - now;
            const busy = busyId === e.entry_id;
            return (
              <div key={e.entry_id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  {line(e)}
                  <div className={`text-[11px] mt-1 font-semibold ${ms < 120000 ? 'text-rose-300' : 'text-amber-300'}`}>
                    You're next on the waitlist. {ms > 0 ? `${left(ms)} left to take it.` : 'Time ran out.'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onPass(e)} disabled={busy || ms <= 0}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                    <X className="w-4 h-4" /> Pass
                  </button>
                  <button type="button" onClick={() => onTake(e)} disabled={busy || ms <= 0}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                    <Check className="w-4 h-4" /> {busy ? '…' : 'Take it'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {waiting.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ListOrdered className="w-3.5 h-3.5" /> On a waitlist ({waiting.length})
          </h2>
          {waiting.map((e) => (
            <div key={e.entry_id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                {line(e)}
                <div className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1">
                  {e.place === 1 ? 'You\'re next in line' : `#${e.place} in line`}
                  {' · '}
                  {e.auto_book
                    ? <><Zap className="w-3 h-3 text-emerald-400" /> we'll ask for the spot for you as soon as one opens</>
                    : "we'll offer you the spot first when one opens"}
                </div>
              </div>
              {/* Phase 32.3 rule: the negative action is never where the positive one just was */}
              <button type="button" onClick={() => onLeave(e)} disabled={busyId === e.entry_id}
                className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold self-start sm:self-auto disabled:opacity-50">
                Leave waitlist
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
```

---

## D4. `frontend/src/components/worker/MyShiftCard.jsx` (EDITS)
Ask for cover / Cancel cover request in the ⋯ menu, the cover chip, and "Covered by / Covering for" lines.

**Edit 1.** Find:
```jsx
import {
  Timer, Info, Navigation, CalendarPlus, MessageSquare, ArrowRightLeft, LogOut, MoreHorizontal, AlertTriangle,
  Clock, Undo2, Check, RotateCcw,
} from 'lucide-react';
import PayLabel from '../PayLabel';
```
Replace with:
```jsx
import {
  Timer, Info, Navigation, CalendarPlus, MessageSquare, ArrowRightLeft, LogOut, MoreHorizontal, AlertTriangle,
  Clock, Undo2, Check, RotateCcw, LifeBuoy, X,
} from 'lucide-react';
import PayLabel from '../PayLabel';
```

**Edit 2.** Find:
```jsx
  shift_auto_confirm: 'Booked right away',
  rating_threshold: 'Booked right away (thanks to your rating)',
};

```
Replace with:
```jsx
  shift_auto_confirm: 'Booked right away',
  rating_threshold: 'Booked right away (thanks to your rating)',
  cover: 'You took this to cover for a teammate',      // Phase 34
};

```

**Edit 3.** Find:
```jsx
 * Props: req, calItem (calendar item for booked shifts), clockedIn, busy ('clock' | 'withdraw' | null),
 *        onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw, onAddCalendar, onDirections, onAskBack
 */
export default function MyShiftCard({
  req, calItem, clockedIn = false, busy = null, onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw,
  onAddCalendar, onDirections, onAskBack,
}) {
  const shift = req.shift || {};
```
Replace with:
```jsx
 * Props: req, calItem (calendar item for booked shifts), clockedIn, busy ('clock' | 'withdraw' | null),
 *        onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw, onAddCalendar, onDirections, onAskBack
 * Phase 34: cover (my live cover request for this booking, from GET /api/cover/mine, or null), onAskCover, onCancelCover
 */
export default function MyShiftCard({
  req, calItem, clockedIn = false, busy = null, onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw,
  onAddCalendar, onDirections, onAskBack, cover = null, onAskCover, onCancelCover,
}) {
  const shift = req.shift || {};
```

**Edit 4.** Find:
```jsx
  const shiftCancelled = String(shift.status || '').toUpperCase() === 'CANCELLED';
  const canAskBack = isDropped && startMs > now && !shiftCancelled && onAskBack;
  const { month, day, weekday } = dateParts(shift.start_time, tz);

```
Replace with:
```jsx
  const shiftCancelled = String(shift.status || '').toUpperCase() === 'CANCELLED';
  const canAskBack = isDropped && startMs > now && !shiftCancelled && onAskBack;
  const canCover = isBooked && !isCheckedIn && startMs > now;                         // Phase 34
  const { month, day, weekday } = dateParts(shift.start_time, tz);

```

**Edit 5.** Find:
```jsx
    isBooked && !ended && { label: 'Add to my calendar', icon: CalendarPlus, onClick: onAddCalendar },
    (isBooked || isCheckedIn || isCompleted) && { label: 'Shift chat', icon: MessageSquare, onClick: onBoard },
    isBooked && !isCheckedIn && !ended && { label: 'Hand off to a teammate', icon: ArrowRightLeft, onClick: onHandOff },
    isBooked && !isCheckedIn && !ended && {
      label: 'Drop shift', icon: LogOut, onClick: onDrop, danger: true, disabled: !canDrop,
      hint: canDrop ? null : 'Not within 24 hours of the start. Hand it off or message your manager.',
    },
  ];

  const reasonLine = req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn', 'dropped', 'rejected'].includes(st);

  return (
```
Replace with:
```jsx
    isBooked && !ended && { label: 'Add to my calendar', icon: CalendarPlus, onClick: onAddCalendar },
    (isBooked || isCheckedIn || isCompleted) && { label: 'Shift chat', icon: MessageSquare, onClick: onBoard },
    // Phase 34: ask the team (and maybe the public board) to take it; you stay booked until someone does
    canCover && !cover && onAskCover && {
      label: 'Ask for cover', icon: LifeBuoy, onClick: onAskCover,
      hint: 'Your team can take it. You stay booked until someone does.',
    },
    canCover && cover?.status === 'open' && onCancelCover && { label: 'Cancel cover request', icon: X, onClick: onCancelCover },
    isBooked && !isCheckedIn && !ended && {
      label: 'Hand off to a teammate', icon: ArrowRightLeft, onClick: onHandOff, disabled: !!cover,
      hint: cover ? 'You asked for cover. Cancel that first.' : null,
    },
    isBooked && !isCheckedIn && !ended && {
      label: 'Drop shift', icon: LogOut, onClick: onDrop, danger: true, disabled: !canDrop,
      hint: canDrop ? null : 'Not within 24 hours of the start. Ask for cover, hand it off, or message your manager.',
    },
  ];

  const reasonLine = req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn', 'dropped', 'rejected'].includes(st);
  const coveredLine = req.status_reason && (st === 'transferred' || req.approval_source === 'cover');   // Phase 34: "Covered by Ben" / "Covering for Ava"

  return (
```

**Edit 6.** Find:
```jsx
            {req.previous_drop_at && (isBooked || isPending) && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-300 border-slate-600">After a drop</span>
            )}
            {(isBooked || isCheckedIn) && SOURCE_LABELS[req.approval_source] && (
```
Replace with:
```jsx
            {req.previous_drop_at && (isBooked || isPending) && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-300 border-slate-600">After a drop</span>
            )}
            {cover && isBooked && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${cover.status === 'pending_approval'
                ? 'bg-indigo-500/15 text-indigo-200 border-indigo-500/40' : 'bg-amber-500/10 text-amber-200 border-amber-500/40'}`}>
                <LifeBuoy className="w-3 h-3" />
                {cover.status === 'pending_approval'
                  ? `${cover.taker_first_name || 'Someone'} wants to cover · waiting for the manager`
                  : `Asking for cover · ${cover.audience === 'public' ? 'team + public board' : 'team only'}`}
              </span>
            )}
            {(isBooked || isCheckedIn) && SOURCE_LABELS[req.approval_source] && (
```

**Edit 7.** Find:
```jsx
          {isPending && req.notes && <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>}
          {reasonLine && <p className="text-[11px] text-rose-300">Reason: {req.status_reason}</p>}
        </div>
        <div className="flex items-center gap-2 md:justify-end flex-wrap">
```
Replace with:
```jsx
          {isPending && req.notes && <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>}
          {reasonLine && <p className="text-[11px] text-rose-300">Reason: {req.status_reason}</p>}
          {coveredLine && <p className="text-[11px] text-slate-400">{req.status_reason}</p>}
          {cover?.note && isBooked && <p className="text-[11px] text-slate-400">Your cover note: <span className="text-slate-300">{cover.note}</span></p>}
        </div>
        <div className="flex items-center gap-2 md:justify-end flex-wrap">
```

---

## D5. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)
Loads `/cover/open`, `/cover/mine`, `/waitlist/mine`; Need cover section; waitlist panel; the full-events section; dialogs.

**Edit 1.** Find:
```jsx
import AppNudge from '../components/AppNudge';   // Phase 33
import EarningsCard from '../components/worker/EarningsCard';   // Phase 33.1
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```
Replace with:
```jsx
import AppNudge from '../components/AppNudge';   // Phase 33
import EarningsCard from '../components/worker/EarningsCard';   // Phase 33.1
import CoverDialog from '../components/worker/CoverDialog';     // Phase 34
import CoverBoard from '../components/worker/CoverBoard';       // Phase 34
import WaitlistPanel from '../components/worker/WaitlistPanel'; // Phase 34
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```

**Edit 2.** Find:
```jsx
  });
  return groups;
}

```
Replace with:
```jsx
  });
  return groups;
}

// Phase 34: a full event is listed so people can join its waitlist; it goes in its own section
function isFullOnly(l) {
  return l.full && !l.my_request;
}

```

**Edit 3.** Find:
```jsx
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
  const navigate = useNavigate();

```
Replace with:
```jsx
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
  // Phase 34: cover requests + waitlists
  const [coverOpen, setCoverOpen] = useState([]);          // shifts that need cover that I could see
  const [myCovers, setMyCovers] = useState([]);            // my live cover requests
  const [waitlists, setWaitlists] = useState([]);          // my places in line / offers
  const [coverFor, setCoverFor] = useState(null);          // req being posted for cover (dialog)
  const [coverCancel, setCoverCancel] = useState(null);    // { cover, title } waiting for "Cancel cover request?"
  const [coverTake, setCoverTake] = useState(null);        // cover listing waiting for "Take this shift?"
  const [coverBusy, setCoverBusy] = useState(null);
  const [waitBusy, setWaitBusy] = useState(null);
  const navigate = useNavigate();

```

**Edit 4.** Find:
```jsx
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, outRes, activeClocksRes, calendarRes, offersRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
```
Replace with:
```jsx
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, outRes, activeClocksRes, calendarRes, offersRes, coverRes, myCoverRes, waitRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
```

**Edit 5.** Find:
```jsx
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
        api.get('/me/offers').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setOffers(offersRes.data || []);
      setCalendar({ items: calendarRes.data?.items || [], unread_count: calendarRes.data?.unread_count || 0 });
      setMyShifts(myRes.data || []);
```
Replace with:
```jsx
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
        api.get('/me/offers').catch(() => ({ data: [] })),
        api.get('/cover/open').catch(() => ({ data: [] })),        // Phase 34
        api.get('/cover/mine').catch(() => ({ data: [] })),
        api.get('/waitlist/mine').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setOffers(offersRes.data || []);
      setCoverOpen(coverRes.data || []);
      setMyCovers(myCoverRes.data || []);
      setWaitlists(waitRes.data || []);
      setCalendar({ items: calendarRes.data?.items || [], unread_count: calendarRes.data?.unread_count || 0 });
      setMyShifts(myRes.data || []);
```

**Edit 6.** Find:
```jsx
          return UPCOMING_STATUSES.includes(st) && new Date(r.shift?.end_time).getTime() >= Date.now();
        });
        return upcoming || (offersRes.data || []).length ? 'schedule' : 'find';
      });
    } catch (err) {
```
Replace with:
```jsx
          return UPCOMING_STATUSES.includes(st) && new Date(r.shift?.end_time).getTime() >= Date.now();
        });
        const waitOffer = (waitRes.data || []).some((w) => w.status === 'offered');
        return upcoming || waitOffer || (offersRes.data || []).length ? 'schedule' : 'find';
      });
    } catch (err) {
```

**Edit 7.** Find:
```jsx
    } finally {
      setOfferBusy(null);
      fetchWorkerData(false);
    }
```
Replace with:
```jsx
    } finally {
      setOfferBusy(null);
      fetchWorkerData(false);
    }
  };

  // Phase 34: cover + waitlist actions
  const takeCover = async (c) => {
    setCoverBusy(c.cover_id);
    try {
      const res = await api.post(`/cover/${c.cover_id}/take`);
      flash('success', res.data.message);
    } catch (err) {
      throw err;   // ConfirmDialog shows it
    } finally {
      setCoverBusy(null);
      fetchWorkerData(false);
    }
  };

  const cancelCover = async (cover) => {
    await api.post(`/cover/${cover.cover_id}/cancel`);
    flash('info', "Cover request cancelled. You're keeping this shift.");
    fetchWorkerData(false);
  };

  const waitAction = async (e, action) => {
    setWaitBusy(e.entry_id);
    try {
      const res = await api.post(`/waitlist/${e.entry_id}/${action}`);
      flash(action === 'take' ? 'success' : 'info', res.data.message);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not update the waitlist.');
    } finally {
      setWaitBusy(null);
      fetchWorkerData(false);
    }
```

**Edit 8.** Find:
```jsx

  // Find Shifts
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;
  const roleOptions = useMemo(
    () => Array.from(new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN').map((p) => p.role_type)))).sort(),
    [listings]
  );
```
Replace with:
```jsx

  // Find Shifts
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;   // Phase 34: full events don't count
  const roleOptions = useMemo(
    () => Array.from(new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN' || p.can_waitlist).map((p) => p.role_type)))).sort(),
    [listings]
  );
```

**Edit 9.** Find:
```jsx
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
```
Replace with:
```jsx
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status || p.can_waitlist || p.my_waitlist))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
```

**Edit 10.** Find:
```jsx
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested, fitsOnly, mineOnly]);
  // Phase 32.2: shifts in my departments first; everything else under "Other departments"
  const listingGroups = useMemo(() => groupByDay(filteredListings.filter((l) => !isOtherDept(l))), [filteredListings]);
  const otherGroups = useMemo(() => groupByDay(filteredListings.filter(isOtherDept)), [filteredListings]);
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested || fitsOnly || mineOnly;
  const clearFilters = () => {
```
Replace with:
```jsx
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested, fitsOnly, mineOnly]);
  // Phase 32.2: shifts in my departments first; everything else under "Other departments"
  const listingGroups = useMemo(() => groupByDay(filteredListings.filter((l) => !isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const otherGroups = useMemo(() => groupByDay(filteredListings.filter((l) => isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const fullListings = useMemo(() => filteredListings.filter(isFullOnly), [filteredListings]);                 // Phase 34
  const fullGroups = useMemo(() => groupByDay(fullListings), [fullListings]);
  const myWaitCount = fullListings.filter((l) => l.positions.some((p) => p.my_waitlist)).length;
  const coverByRequest = useMemo(() => new Map(myCovers.map((c) => [c.request_id, c])), [myCovers]);
  const waitOffers = waitlists.filter((w) => w.status === 'offered').length;
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested || fitsOnly || mineOnly;
  const clearFilters = () => {
```

**Edit 11.** Find:
```jsx
    .filter((r) => !isUpcomingReq(r) && !canAskBack(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));
  const needsAnswer = offers.length + incomingTransfers.length;

  const addShiftToCalendar = (req) => {
```
Replace with:
```jsx
    .filter((r) => !isUpcomingReq(r) && !canAskBack(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));
  const needsAnswer = offers.length + incomingTransfers.length + waitOffers;

  const addShiftToCalendar = (req) => {
```

**Edit 12.** Find:
```jsx
        onDirections={place ? () => window.open(mapsUrl(place), '_blank', 'noopener') : null}
        onAskBack={req.shift?.event_id ? () => setOpenListing({ eventId: req.shift.event_id, initial: null }) : null}
      />
    );
```
Replace with:
```jsx
        onDirections={place ? () => window.open(mapsUrl(place), '_blank', 'noopener') : null}
        onAskBack={req.shift?.event_id ? () => setOpenListing({ eventId: req.shift.event_id, initial: null }) : null}
        cover={coverByRequest.get(req.id) || null}
        onAskCover={() => setCoverFor(req)}
        onCancelCover={() => setCoverCancel({ cover: coverByRequest.get(req.id), title: req.shift?.title || 'this shift' })}
      />
    );
```

**Edit 13.** Find:
```jsx
    const detail = {
      tab: activeTab,
      badges: { schedule: offers.length, calendar: calendar.unread_count || 0, transfers: incomingTransfers.length },
    };
    try { sessionStorage.setItem('shiftboard_worker_tab', JSON.stringify(detail)); } catch (e) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('worker_tab_state', { detail }));
  }, [activeTab, offers.length, calendar.unread_count, incomingTransfers.length]);

  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length },
    { id: 'find', label: 'Find shifts', icon: Search, count: openListingCount },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, badge: calendar.unread_count },
    { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft, badge: incomingTransfers.length },
```
Replace with:
```jsx
    const detail = {
      tab: activeTab,
      badges: { schedule: offers.length + waitOffers, calendar: calendar.unread_count || 0, transfers: incomingTransfers.length },
    };
    try { sessionStorage.setItem('shiftboard_worker_tab', JSON.stringify(detail)); } catch (e) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('worker_tab_state', { detail }));
  }, [activeTab, offers.length, waitOffers, calendar.unread_count, incomingTransfers.length]);

  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length, badge: waitOffers },
    { id: 'find', label: 'Find shifts', icon: Search, count: openListingCount, badge: coverOpen.filter((c) => c.can_take).length },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, badge: calendar.unread_count },
    { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft, badge: incomingTransfers.length },
```

**Edit 14.** Find:
```jsx
            </button>
            {needsAnswer > 0 && (
              <button type="button" onClick={() => setActiveTab(offers.length ? 'schedule' : 'transfers')}
                className={`${chipBtn} border-amber-500/50 text-amber-200`}>
                <b className="text-amber-100">{needsAnswer}</b> waiting for your answer
```
Replace with:
```jsx
            </button>
            {needsAnswer > 0 && (
              <button type="button" onClick={() => setActiveTab(offers.length || waitOffers ? 'schedule' : 'transfers')}
                className={`${chipBtn} border-amber-500/50 text-amber-200`}>
                <b className="text-amber-100">{needsAnswer}</b> waiting for your answer
```

**Edit 15.** Find:
```jsx

        {/* Offers get answered on My shifts; elsewhere a slim reminder */}
        {offers.length > 0 && activeTab !== 'schedule' && (
          <button type="button" onClick={() => setActiveTab('schedule')}
            className="mt-4 w-full p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 text-left text-sm text-indigo-100 flex items-center gap-2 hover:bg-indigo-500/10">
            <Send className="w-4 h-4 text-indigo-300" />
            <span className="flex-1">{plural(offers.length, 'shift')} offered to you. Answer on My shifts.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
```
Replace with:
```jsx

        {/* Offers get answered on My shifts; elsewhere a slim reminder */}
        {offers.length + waitOffers > 0 && activeTab !== 'schedule' && (
          <button type="button" onClick={() => setActiveTab('schedule')}
            className="mt-4 w-full p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 text-left text-sm text-indigo-100 flex items-center gap-2 hover:bg-indigo-500/10">
            <Send className="w-4 h-4 text-indigo-300" />
            <span className="flex-1">{plural(offers.length + waitOffers, 'shift')} offered to you. Answer on My shifts.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
```

**Edit 16.** Find:
```jsx
            <EarningsCard refreshKey={earningsKey} />
            <WorkerOffers offers={offers} busyId={offerBusy} onAccept={(o) => handleOffer(o, 'accept')} onDecline={(o) => handleOffer(o, 'decline')} />
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-4">Coming up</h2>
```
Replace with:
```jsx
            <EarningsCard refreshKey={earningsKey} />
            <WorkerOffers offers={offers} busyId={offerBusy} onAccept={(o) => handleOffer(o, 'accept')} onDecline={(o) => handleOffer(o, 'decline')} />
            <WaitlistPanel entries={waitlists} busyId={waitBusy}
              onTake={(e) => waitAction(e, 'take')} onPass={(e) => waitAction(e, 'pass')} onLeave={(e) => waitAction(e, 'leave')}
              onExpired={() => fetchWorkerData(false)} />
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-4">Coming up</h2>
```

**Edit 17.** Find:
```jsx
        {activeTab === 'find' && (
          <div className="mt-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
```
Replace with:
```jsx
        {activeTab === 'find' && (
          <div className="mt-6">
            <CoverBoard items={coverOpen} busyId={coverBusy} onTake={(c) => setCoverTake(c)} />
            <div className="mt-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
```

**Edit 18.** Find:
```jsx
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.length === 0 && otherGroups.length > 0 && (
                  <p className="text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-center">
```
Replace with:
```jsx
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.length === 0 && otherGroups.length === 0 && fullGroups.length > 0 && (
                  <p className="text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-center">
                    Everything listed is full right now. Join a waitlist below and we'll let you know if a spot opens.
                  </p>
                )}
                {listingGroups.length === 0 && otherGroups.length > 0 && (
                  <p className="text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-center">
```

**Edit 19.** Find:
```jsx
                  </div>
                )}
              </div>
            )}
```
Replace with:
```jsx
                  </div>
                )}
                {/* Phase 34: full events, so people can get in line */}
                {fullGroups.length > 0 && (
                  <details className="group border-t border-slate-800 pt-6" open={myWaitCount > 0}>
                    <summary className="cursor-pointer select-none list-none">
                      <span className="text-sm font-bold text-slate-200">Full: join a waitlist ({fullListings.length})</span>
                      {myWaitCount > 0 && <span className="ml-2 text-[11px] text-emerald-300">You're in line for {plural(myWaitCount, 'event')}</span>}
                      <span className="block text-xs text-slate-500 mt-0.5">
                        No spots left. Join the line and we'll book you (or offer you the spot) if one opens.
                      </span>
                    </summary>
                    <div className="mt-6 space-y-6">
                      <ListingDayGroups groups={fullGroups} onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })} />
                    </div>
                  </details>
                )}
              </div>
            )}
```

**Edit 20.** Find:
```jsx
              <WorkerCalendar
                items={calendar.items}
                openListings={listings}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
```
Replace with:
```jsx
              <WorkerCalendar
                items={calendar.items}
                openListings={listings.filter((l) => !isFullOnly(l))}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
```

**Edit 21.** Find:
```jsx
      )}

      {shiftToDrop && (
        <DropShiftDialog
```
Replace with:
```jsx
      )}

      {/* Phase 34: cover */}
      {coverFor && (
        <CoverDialog req={coverFor} onClose={() => setCoverFor(null)}
          onPosted={(message) => { flash('success', message); fetchWorkerData(false); }} />
      )}
      {coverCancel && (
        <ConfirmDialog
          title="Cancel your cover request?"
          message={`Nobody will be able to take ${coverCancel.title} from you anymore. You're still booked on it.`}
          confirmLabel="Cancel cover request"
          onConfirm={() => cancelCover(coverCancel.cover)}
          onClose={() => setCoverCancel(null)}
        />
      )}
      {coverTake && (
        <ConfirmDialog
          title={coverTake.booking === 'instant' ? 'Take this shift?' : 'Ask to take this shift?'}
          message={`${coverTake.role_type} · ${coverTake.title} at ${coverTake.venue_name}, covering for ${coverTake.from_first_name}. ${
            coverTake.booking === 'instant'
              ? "It's yours right away and goes in My shifts."
              : `The manager has to approve it. Until then it's still ${coverTake.from_first_name}'s.`}${coverTake.take_note ? ` ${coverTake.take_note}` : ''}`}
          confirmLabel={coverTake.booking === 'instant' ? 'Take it' : 'Send to the manager'}
          onConfirm={() => takeCover(coverTake)}
          onClose={() => setCoverTake(null)}
        />
      )}

      {shiftToDrop && (
        <DropShiftDialog
```

---

## D6. `frontend/src/components/EventListingModal.jsx` (EDITS)
Join / leave / take / pass under each full position.

**Edit 1.** Find:
```jsx
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus,
  Zap, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Briefcase, Lock, Repeat,
} from 'lucide-react';
import api from '../api/client';
```
Replace with:
```jsx
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus,
  Zap, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Briefcase, Lock, Repeat, ListOrdered,
} from 'lucide-react';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
  const [result, setResult] = useState(null); // { type: 'success' | 'info' | 'error', message }
  const [seriesPicks, setSeriesPicks] = useState(() => new Set());   // Phase 32.3: event_ids of other dates to request too

  const applyListing = (next, resetSelection = false) => {
```
Replace with:
```jsx
  const [result, setResult] = useState(null); // { type: 'success' | 'info' | 'error', message }
  const [seriesPicks, setSeriesPicks] = useState(() => new Set());   // Phase 32.3: event_ids of other dates to request too
  const [wlAuto, setWlAuto] = useState(true);                          // Phase 34: join the waitlist as "book me automatically"
  const [wlBusy, setWlBusy] = useState(null);

  const applyListing = (next, resetSelection = false) => {
```

**Edit 3.** Find:
```jsx
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not send your request.' });
      reload(false);
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
```
Replace with:
```jsx
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not send your request.' });
      reload(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Phase 34: waitlist for a full position (one place per event)
  const waitlist = async (p, action) => {
    setWlBusy(p.shift_id);
    setResult(null);
    try {
      const res = action === 'join'
        ? await api.post('/waitlist', { shift_id: p.shift_id, auto_book: wlAuto })
        : await api.post(`/waitlist/${p.my_waitlist.entry_id}/${action}`);
      setResult({ type: action === 'take' && res.data.status === 'booked' ? 'success' : 'info', message: res.data.message });
      if (onChanged) onChanged(res.data);
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not update the waitlist.' });
    } finally {
      setWlBusy(null);
      reload(false);
    }
  };

  const withdraw = async () => {
```

**Edit 4.** Find:
```jsx
    if (listing.conflict) {
      blockedReason = `This overlaps a shift you're booked on (${listing.conflict}).`;
    } else if (!selected) {
      primary = (
```
Replace with:
```jsx
    if (listing.conflict) {
      blockedReason = `This overlaps a shift you're booked on (${listing.conflict}).`;
    } else if (!selected && listing.full) {
      // Phase 34: nothing to request; the waitlist buttons are on each position
      primary = <span className="text-xs text-slate-400">Every position is full. Join a waitlist above.</span>;
    } else if (!selected) {
      primary = (
```

**Edit 5.** Find:
```jsx
              const active = selectedId === p.shift_id;
              const est = estPayText(p);
              return (
                <button
                  key={p.shift_id}
                  type="button"
                  role="radio"
```
Replace with:
```jsx
              const active = selectedId === p.shift_id;
              const est = estPayText(p);
              const wl = p.my_waitlist;                                                           // Phase 34
              const wlRow = full && !listing.cancelled && !listing.started && (wl || p.can_waitlist || p.waitlist_count > 0);
              return (
                <div key={p.shift_id}>
                <button
                  type="button"
                  role="radio"
```

**Edit 6.** Find:
```jsx
                      {est && <div className="text-[10px] text-slate-500">{est} for the shift</div>}
                      <div className={`text-[11px] font-semibold mt-0.5 ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                        {full ? 'Full' : `${p.spots_left} of ${p.capacity} open`}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
```
Replace with:
```jsx
                      {est && <div className="text-[10px] text-slate-500">{est} for the shift</div>}
                      <div className={`text-[11px] font-semibold mt-0.5 ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                        {full ? `Full${p.waitlist_count ? ` · ${p.waitlist_count} waiting` : ''}` : `${p.spots_left} of ${p.capacity} open`}
                      </div>
                    </div>
                  </div>
                </button>
                {wlRow && (
                  <div className="mt-1 ml-3 pl-3 border-l-2 border-slate-800 py-1.5 text-[11px] text-slate-300 space-y-1.5">
                    {wl && wl.status === 'offered' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-emerald-300 font-semibold">A spot opened and it's being held for you.</span>
                        <button type="button" disabled={wlBusy === p.shift_id} onClick={() => waitlist(p, 'pass')}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 font-semibold disabled:opacity-50">Pass</button>
                        <button type="button" disabled={wlBusy === p.shift_id} onClick={() => waitlist(p, 'take')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold disabled:opacity-50">Take it</button>
                      </div>
                    ) : wl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <ListOrdered className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          <b className="text-white">{wl.place === 1 ? "You're next in line" : `You're #${wl.place} in line`}</b>
                          {wl.auto_book ? ". We'll ask for the spot for you as soon as one opens." : ". We'll offer you the spot first when one opens."}
                        </span>
                        <button type="button" disabled={wlBusy === p.shift_id} onClick={() => waitlist(p, 'leave')}
                          className="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 font-semibold disabled:opacity-50">Leave waitlist</button>
                      </div>
                    ) : p.can_waitlist ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500" checked={wlAuto} onChange={(e) => setWlAuto(e.target.checked)} />
                          Book me automatically if a spot opens
                        </label>
                        <button type="button" disabled={wlBusy === p.shift_id} onClick={() => waitlist(p, 'join')}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40 font-bold disabled:opacity-50">
                          {wlBusy === p.shift_id ? 'Joining…' : 'Join waitlist'}
                        </button>
                        {!wlAuto && <span className="block w-full text-slate-500">You'll get a notification and a short time to take it.</span>}
                      </div>
                    ) : (
                      <span className="text-slate-500">{p.waitlist_count} {p.waitlist_count === 1 ? 'person is' : 'people are'} on the waitlist.</span>
                    )}
                  </div>
                )}
                </div>
              );
            })}
```

---

## D7. `frontend/src/components/EventListingCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
                {est && <span className="hidden sm:inline text-slate-500">{est}</span>}
                <span className={`font-semibold ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                  {full ? 'Full' : `${p.spots_left} open`}
                </span>
              </div>
```
Replace with:
```jsx
                {est && <span className="hidden sm:inline text-slate-500">{est}</span>}
                <span className={`font-semibold ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                  {full ? (p.my_waitlist ? `#${p.my_waitlist.place} in line` : p.waitlist_count ? `Full · ${p.waitlist_count} waiting` : 'Full') : `${p.spots_left} open`}
                </span>
              </div>
```

**Edit 2.** Find:
```jsx
        </span>
        <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
          {mine ? 'View details' : listing.dropped_here ? 'Ask to come back' : 'View & request'}
          <ChevronRight className="w-4 h-4" />
        </span>
```
Replace with:
```jsx
        </span>
        <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
          {mine ? 'View details' : listing.dropped_here ? 'Ask to come back'
            : listing.full ? (listing.positions.some((p) => p.my_waitlist) ? "You're on the waitlist" : 'Join waitlist') : 'View & request'}
          <ChevronRight className="w-4 h-4" />
        </span>
```

---

## D8. `frontend/src/components/worker/HandoffsPanel.jsx` (EDITS)
Sent hand-offs that came from a cover request get their own wording.

**Edit 1.** Find:
```jsx
  denied: ['Manager said no · you still have the shift', 'text-slate-400'],
  cancelled_by_sender: ['You withdrew it', 'text-slate-500'],
};
const WAITING = ['pending_worker_acceptance', 'pending_manager_approval'];
```
Replace with:
```jsx
  denied: ['Manager said no · you still have the shift', 'text-slate-400'],
  cancelled_by_sender: ['You withdrew it', 'text-slate-500'],
};
// Phase 34: hand-offs that came from a cover request (someone took your post)
const COVER_STATUS = {
  pending_manager_approval: ['Took your cover request · waiting for the manager', 'text-amber-300'],
  approved: ['Covered · they have the shift', 'text-emerald-300'],
  denied: ['Manager said no · you still have the shift', 'text-slate-400'],
  cancelled_by_sender: ['You kept the shift', 'text-slate-500'],
  expired: ['The shift started before the manager decided', 'text-slate-500'],
};
const WAITING = ['pending_worker_acceptance', 'pending_manager_approval'];
```

**Edit 2.** Find:
```jsx
          </p>
        ) : sent.map((t) => {
          const [label, tone] = OUT_STATUS[t.status] || [t.status, 'text-slate-400'];
          const waiting = WAITING.includes(t.status);
          return (
```
Replace with:
```jsx
          </p>
        ) : sent.map((t) => {
          const [label, tone] = (t.cover_request_id && COVER_STATUS[t.status]) || OUT_STATUS[t.status] || [t.status, 'text-slate-400'];
          const waiting = WAITING.includes(t.status);
          return (
```

---

# PART E: Frontend, manager

## E1. `frontend/src/components/ManagerQueues.jsx` (EDITS)
**Cover** chip on hand-offs that came from a cover request.

**Edit 1.** Find:
```jsx
import React from 'react';
import { Users, ArrowRightLeft, Check, X, Eye, MessageSquareQuote, ArrowRight, RotateCcw, Briefcase } from 'lucide-react';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
```
Replace with:
```jsx
import React from 'react';
import { Users, ArrowRightLeft, Check, X, Eye, MessageSquareQuote, ArrowRight, RotateCcw, Briefcase, LifeBuoy } from 'lucide-react';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
```

**Edit 2.** Find:
```jsx
                  <div className="flex flex-wrap items-center gap-1.5 text-sm text-white font-semibold">
                    {name(t.from_worker)} <ArrowRight className="w-3.5 h-3.5 text-amber-400" /> {name(t.to_worker)}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
```
Replace with:
```jsx
                  <div className="flex flex-wrap items-center gap-1.5 text-sm text-white font-semibold">
                    {name(t.from_worker)} <ArrowRight className="w-3.5 h-3.5 text-amber-400" /> {name(t.to_worker)}
                    {t.cover_request_id && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-200 border border-amber-500/40 inline-flex items-center gap-1"
                        title={`${t.from_worker?.first_name || 'They'} asked for cover and ${t.to_worker?.first_name || 'this person'} took it`}>
                        <LifeBuoy className="w-3 h-3" /> Cover
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
```

---

## E2. `frontend/src/components/EventRosterModal.jsx` (EDITS)
"Asked for cover" on the person, the waitlist line per position.

**Edit 1.** Find:
```jsx
import React, { useState } from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin, Send, Clock, RotateCcw, LogOut } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```
Replace with:
```jsx
import React, { useState } from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin, Send, Clock, RotateCcw, LogOut, LifeBuoy, ListOrdered } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```

**Edit 2.** Find:
```jsx

const APPROVAL_LABEL = { venue_default: 'Venue setting', auto: 'Book instantly', manual: 'Needs approval' };
const SOURCE_LABEL = { manager_assign: 'Assigned by manager', offer: 'Accepted an offer' };   // Phase 29
const OFFER_CHIP = {
  pending: { label: 'Waiting', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30' },
```
Replace with:
```jsx

const APPROVAL_LABEL = { venue_default: 'Venue setting', auto: 'Book instantly', manual: 'Needs approval' };
const SOURCE_LABEL = { manager_assign: 'Assigned by manager', offer: 'Accepted an offer', cover: 'Covering for a teammate' };   // Phase 29 / 34
const OFFER_CHIP = {
  pending: { label: 'Waiting', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30' },
```

**Edit 3.** Find:
```jsx
                                </div>
                              ))}
                              {p.time_off && (
                                <div className="text-[10px] inline-flex items-center gap-1 text-rose-300">
```
Replace with:
```jsx
                                </div>
                              ))}
                              {p.cover && (
                                <div className="text-[10px] inline-flex items-center gap-1 text-amber-300 mr-2">
                                  <LifeBuoy className="w-3 h-3" /> {p.cover === 'pending_approval' ? 'Someone took their cover request · approve it in Hand-offs' : 'Asked for cover · still booked'}
                                </div>
                              )}
                              {p.time_off && (
                                <div className="text-[10px] inline-flex items-center gap-1 text-rose-300">
```

**Edit 4.** Find:
```jsx
                </div>

                {pos.dropped && pos.dropped.length > 0 && (
                  <div>
```
Replace with:
```jsx
                </div>

                {/* Phase 34: people waiting for a spot, in order */}
                {pos.waitlist && pos.waitlist.length > 0 && (
                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5">
                    <ListOrdered className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold text-slate-300">Waitlist ({pos.waitlist.length}):</span>
                    <span>{pos.waitlist.join(', ')}</span>
                    <span className="text-slate-500">· the next person gets a spot automatically if one opens</span>
                  </div>
                )}

                {pos.dropped && pos.dropped.length > 0 && (
                  <div>
```

---

## E3. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
The **Workers can post cover on the public shift board** checkbox.

**Edit 1.** Find:
```jsx
    approval_policy: venue?.approval_policy || 'team_auto',
    show_rates_publicly: venue?.show_rates_publicly ?? true,
    auto_approve_rating_threshold:
      venue?.auto_approve_rating_threshold != null ? String(venue.auto_approve_rating_threshold) : '',
```
Replace with:
```jsx
    approval_policy: venue?.approval_policy || 'team_auto',
    show_rates_publicly: venue?.show_rates_publicly ?? true,
    allow_public_cover: venue?.allow_public_cover ?? true,                        // Phase 34
    auto_approve_rating_threshold:
      venue?.auto_approve_rating_threshold != null ? String(venue.auto_approve_rating_threshold) : '',
```

**Edit 2.** Find:
```jsx
      approval_policy: form.approval_policy,
      show_rates_publicly: !!form.show_rates_publicly,
      auto_approve_rating_threshold: form.auto_approve_rating_threshold === '' ? null : parseFloat(form.auto_approve_rating_threshold),
      arrival_instructions: form.arrival_instructions,
```
Replace with:
```jsx
      approval_policy: form.approval_policy,
      show_rates_publicly: !!form.show_rates_publicly,
      allow_public_cover: !!form.allow_public_cover,                              // Phase 34
      auto_approve_rating_threshold: form.auto_approve_rating_threshold === '' ? null : parseFloat(form.auto_approve_rating_threshold),
      arrival_instructions: form.arrival_instructions,
```

**Edit 3.** Find:
```jsx
            </div>

            <div className={cardCls}>
              <label className="flex items-start gap-3 cursor-pointer">
```
Replace with:
```jsx
            </div>

            {/* Phase 34: where workers can ask for cover */}
            <div className={cardCls}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={!!form.allow_public_cover}
                  onChange={(e) => setForm({ ...form, allow_public_cover: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">Workers can post cover on the public shift board</span>
                  <span className="block text-xs text-slate-400">
                    When someone can't make a shift they can always ask your team. With this on they can also list it
                    for anyone on Find shifts. People outside your team still follow the approval rule above.
                  </span>
                </span>
              </label>
            </div>

            <div className={cardCls}>
              <label className="flex items-start gap-3 cursor-pointer">
```

---

# PART F: Rebuild & verification

**This phase changes the database.** Pick ONE:

**Option 1: fresh database (wipes all data):**
```bash
docker compose down -v
docker compose up -d --build
```

**Option 2: keep your data.** Run this once, then rebuild without `-v`. It's safe to run twice.
```bash
docker compose exec -T db psql -U shiftboard_user -d shiftboard <<'SQL'
-- Phase 34: keep your data (run once; safe to run again)
ALTER TABLE venues ADD COLUMN IF NOT EXISTS allow_public_cover BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE shift_transfers ADD COLUMN IF NOT EXISTS cover_request_id UUID;
CREATE TABLE IF NOT EXISTS cover_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES shift_requests(id) ON DELETE CASCADE,   -- the booking that needs cover
    from_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience VARCHAR(10) NOT NULL DEFAULT 'team',             -- team | public (team + the public board)
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',               -- open | pending_approval | covered | cancelled | expired
    taken_by_worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    transfer_id UUID REFERENCES shift_transfers(id) ON DELETE SET NULL,
    warned_12h_at TIMESTAMPTZ,
    warned_3h_at TIMESTAMPTZ,
    closed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cover_requests_shift ON cover_requests(shift_id);
CREATE INDEX IF NOT EXISTS idx_cover_requests_status ON cover_requests(status);
CREATE INDEX IF NOT EXISTS idx_cover_requests_venue ON cover_requests(venue_id);
-- one live cover post per booking
CREATE UNIQUE INDEX IF NOT EXISTS uq_cover_requests_live ON cover_requests(request_id) WHERE status IN ('open', 'pending_approval');

CREATE TABLE IF NOT EXISTS waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auto_book BOOLEAN NOT NULL DEFAULT TRUE,                  -- book (or request) automatically when a spot opens
    status VARCHAR(20) NOT NULL DEFAULT 'waiting',            -- waiting | offered | booked | requested | passed | expired | left | closed
    offered_at TIMESTAMPTZ,
    offer_expires_at TIMESTAMPTZ,
    request_id UUID REFERENCES shift_requests(id) ON DELETE SET NULL,
    closed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_waitlist_shift ON waitlist_entries(shift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_worker ON waitlist_entries(worker_id);
-- one live place per person per position
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_live ON waitlist_entries(shift_id, worker_id) WHERE status IN ('waiting', 'offered');
SQL
docker compose up -d --build
```
(If your database service or user is named differently in `docker-compose.yml`, use those names.)

If the page is blank or shows "Invalid hook call":
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### Checklist
Use two worker accounts on the same venue team (A and B), one worker **not** on the team (C), and the manager.

**Cover**
1. As A, book (or get assigned) a shift 2+ days out. ⋯ → **Ask for cover** → *My team* + a note → **Post cover request**.
   * The card shows **Asking for cover · team only**.
   * **Hand off to a teammate** is greyed out.
2. B gets a notification. B's Find shifts shows **Need cover** at the top with A's note. C doesn't see it.
3. A: ⋯ → **Cancel cover request**. Post again with **My team + the public shift board**.
4. C now sees it, with **Ask to take it** ("The manager has to approve it"). C takes it.
   * A's card says "C wants to cover · waiting for the manager".
   * The manager's **Hand-offs to approve** shows it with a **Cover** chip.
5. Manager **Deny**: A is still booked; the post is open again (B and C see it). Now B takes it: **Take it** books B right away.
   * A's shift moves to history as "Handed off · Covered by B".
   * B's card says "You took this to cover for a teammate".
6. Manager → Settings: untick **Workers can post cover on the public shift board** and save. As A, ask for cover on another shift: the public option is greyed out.
7. Post cover on a shift that starts within 12 hours (or edit an event's time): within a minute, A and the manager get "Nobody has taken your shift yet". The manager's roster shows "Asked for cover · still booked".

**Waitlists**

8. Fill a 1-spot position (assign A). As C, Find shifts → bottom: **Full: join a waitlist** → open the event.
   * Untick **Book me automatically**, then **Join waitlist**: "You're next in line".
   * As B, join the same position with the box ticked: "#2 in line".
   * The manager's roster shows **Waitlist (2): C, B**.
9. A drops the shift (it must be 24 h+ away). C gets an urgent **A spot opened up**, and My shifts shows it with a 30-minute countdown. Others see the position as full.
10. C taps **Pass**. B is booked right away (B is on the team) and gets "You're booked from the waitlist".
11. "Open to pick up" and the Find shifts count don't include full events.