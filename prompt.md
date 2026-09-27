# Phase 31 + 32: Availability, Time Off, Worker Profile & Certificates

**Why:** Managers can now assign, offer and see who's late (Phases 29–30). But the system still knows nothing about the people they're booking:

* It doesn't know when they can work.
* It doesn't know when they've asked to be away.
* It doesn't know whether a bartender actually has an alcohol-server card.

Workers also have no page of their own: no photo, emergency contact or certificates, and the phone number is buried in notification settings. This phase adds all of that and makes assigning and self-booking **safe**.

## What this phase adds

### A. Phase 31: Weekly availability & time off
1. **Weekly availability** (Profile → Availability):
   * Each day can have one or more time ranges. Quick fills: Evenings, Weeknights only, Weekends, Any time.
   * Ranges can run past midnight ("4 PM – 2 AM").
   * Times are judged in the **venue's** time zone.
   * With nothing set, availability counts as "not set" and never warns.
2. **Time off** (Profile → Time off):
   * A worker asks for a date range, with an optional reason.
   * The request goes to the managers of **every venue they're on the team with**. Any one of them approves or declines; declining needs a note.
   * The worker can withdraw a pending request or cancel approved time off.
   * Overlapping requests are refused.
   * Booked shifts inside the range stay booked and are listed as **clashes** ("Booked here then: Fri Oct 2 · Server · Friday Gala"), so the manager can find cover.
3. **Managers see it everywhere:**

   | Where | What they see |
   |---|---|
   | "Needs you" strip | "1 time-off request" |
   | Dashboard | a new **Time off requests** card, shown only while there are some |
   | This week | "Off: Sam Taylor" on each day |
   | Roster | "Has approved time off that day" on booked people |
   | Assign / Offer | chips: Available / Outside their availability / Time off / Asked for time off |
   | Worker profile | availability and upcoming time off |

   * **Assign** asks "Assign anyway?" when there's a warning.
   * **Offers skip people with approved time off** ("Has approved time off that day").
4. **Find shifts:**
   * Each card says "Outside your usual availability", "You asked for time off that day" or "You have time off that day".
   * A new **Fits my availability** filter hides shifts outside their availability or on approved time off.
   * Availability never blocks a request.

### B. Phase 32: Worker profile & certificates
1. **Profile page** at `/profile` (Navbar: click your name, or "My profile" in the phone menu). It has tabs: **About me · Availability · Time off · Certificates · Notifications**. Managers and admins see only About me and Notifications.
   * **About me:**
     - photo: resized in the browser, JPG/PNG/WebP, max 2 MB
     - name
     - **mobile number, required for workers** and validated
     - bio (600 characters)
     - **positions I work** (chips, with suggestions)
     - **emergency contact**: shown only to managers of venues they're on the team with or have booked at
   * The header lists **what's missing** (phone, photo, emergency contact, availability). The worker page shows a slim **"Finish your profile"** banner until it's done.
2. **Certificates:**
   * The types:
     - Alcohol server card
     - Food handler card
     - Food protection manager
     - 21+ confirmed (checked in person, no dates)
     - Security guard license
     - First aid / CPR
   * Each has a number, dates (**expiry required** where the type expires) and an optional **photo or PDF** (max 5 MB), stored privately: only the worker and managers of connected venues can open it.
   * **Changing a certificate sends it back to "not verified".**
   * Reminders go out **30 days** and **7 days** before expiry, and on the day.
3. **Position requirements** (Venue Settings → Positions & pay):
   * Each position gets **Requires:** toggles, e.g. Bartender requires Alcohol server + 21+.
   * **Workers can't request that position** without the certificate on file, in date and not rejected. The message is specific: "Bartender at The Hippodrome needs: Alcohol server card, 21+ confirmed. Add it on your Profile page…"
   * The listing shows 🔒 "You need: …" and a link to the profile.
   * **Offers skip them**, **accepting an old offer re-checks** (so an expired card is caught), and **hand-offs to someone without it are refused**.
   * **Managers can still assign** after an "Assign anyway?" warning. It's their call, and the roster then shows "Missing: Alcohol server card".
4. **Verification:**
   * In the worker profile (Team page or activity log), each certificate has **View**, **Verify** and **Not accepted** (note required).
   * The worker is notified either way.
   * The Team list shows verified chips and "• 2 to verify".
   * The roster shows "…not verified" on booked people whose required certificate isn't checked yet.

⚠️ **Schema change:**
* 4 new tables: `worker_availability`, `time_off_requests`, `user_files`, `worker_certifications`
* 2 new columns on `users`: the emergency contact
* 1 new column on `venue_positions`: `required_certs`

See §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - **`main.py`**: only the two router lines in B1 change. The CORS block and everything else stay exactly as they are.
* No new npm or Python packages. `python-multipart` (uploads) is already in `requirements.txt`, and image resizing uses the browser's canvas.
* **No native PostgreSQL ENUMs.** Certificate types and time-off / verification statuses are plain `VARCHAR` values, validated in code (`services/fit.py` `CERT_TYPES`).
* Aware UTC datetimes only.
* "Today" and "which day does this shift touch" are worked out in the **venue's** time zone (`ZoneInfo(venue.timezone)`). Time-off dates are plain `DATE`s.
* Notification and activity hooks run **after** the commit and never raise, as before.
* Files are stored **in the database** (`user_files.data BYTEA`), so no new volume is needed. Profile photos are served publicly by id (`/api/files/avatar/{id}`), like any avatar. Certificate scans need a login (`/api/files/{id}`), so the frontend opens them through axios as a blob (`utils/files.js`).
* **NEW FILE / FULL FILE**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current files. Your repo was checked against the Phase 30 copy first, and every file matched. They were verified:
  - the backend imports cleanly: 171 API operations, 15 new
  - the frontend bundles with no missing imports
  - **87 new integration checks** pass against PostgreSQL 16, and all earlier suites pass (400 checks)
  - the keep-data upgrade path (§E) was tested on a Phase 30 database
  - every new screen was rendered with the real Tailwind build, on desktop and phone

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDITS)
Emergency contact on `users`, `required_certs` on `venue_positions`, and the four new tables at the end.

**Edit 1.** Find:
```sql
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    discoverable VARCHAR(20) NOT NULL DEFAULT 'private',   -- Phase 29.1: private | venues | everyone
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    discoverable VARCHAR(20) NOT NULL DEFAULT 'private',   -- Phase 29.1: private | venues | everyone
    emergency_contact_name VARCHAR(100),                   -- Phase 32
    emergency_contact_phone VARCHAR(30),                   -- Phase 32
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 2.** Find:
```sql
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    required_certs TEXT[] NOT NULL DEFAULT '{}',          -- Phase 32: cert type keys, e.g. {alcohol_server}
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 3.** Find:
```sql
);
CREATE INDEX idx_event_templates_venue ON event_templates(venue_id);
```
Replace with:
```sql
);
CREATE INDEX idx_event_templates_venue ON event_templates(venue_id);

-- ------------------------------------------------------------------------------
-- Phase 31: Availability & time off
-- ------------------------------------------------------------------------------
CREATE TABLE worker_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL,                                -- 0 = Monday ... 6 = Sunday
    start_local VARCHAR(5) NOT NULL,                          -- 'HH:MM' local time where they work
    end_local VARCHAR(5) NOT NULL,                            -- 'HH:MM' or '24:00'; earlier than start = next day
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_availability_weekday CHECK (weekday BETWEEN 0 AND 6)
);
CREATE INDEX idx_worker_availability_worker ON worker_availability(worker_id);

CREATE TABLE time_off_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,                                   -- inclusive
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',            -- pending | approved | denied | cancelled
    decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    decision_note TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_time_off_range CHECK (end_date >= start_date)
);
CREATE INDEX idx_time_off_worker ON time_off_requests(worker_id);
CREATE INDEX idx_time_off_status ON time_off_requests(status);

-- ------------------------------------------------------------------------------
-- Phase 32: Profile files & certifications
-- ------------------------------------------------------------------------------
CREATE TABLE user_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,                                -- avatar | certificate
    filename VARCHAR(255),
    content_type VARCHAR(100) NOT NULL,
    size_bytes INT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_user_files_owner ON user_files(owner_id);

CREATE TABLE worker_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cert_type VARCHAR(50) NOT NULL,                           -- alcohol_server | food_handler | age_21 | ...
    number VARCHAR(100),
    issued_on DATE,
    expires_on DATE,
    file_id UUID REFERENCES user_files(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'unverified',         -- unverified | verified | rejected
    verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_worker_cert UNIQUE (worker_id, cert_type)
);
CREATE INDEX idx_worker_certs_worker ON worker_certifications(worker_id);
```

---

## A2. `backend/src/models.py` (EDITS)
New models: `WorkerAvailability`, `TimeOffRequest`, `UserFile`, `WorkerCertification`.

**Edit 1.** Find:
```python
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float, Numeric,
    DateTime, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, JSONB
```
Replace with:
```python
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float, Numeric,
    DateTime, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint, UniqueConstraint,
    Date, SmallInteger, LargeBinary,
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, JSONB
```

**Edit 2.** Find:
```python
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    discoverable = Column(String(20), nullable=False, default="private")   # Phase 29.1: private | venues | everyone
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```
Replace with:
```python
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    discoverable = Column(String(20), nullable=False, default="private")   # Phase 29.1: private | venues | everyone
    emergency_contact_name = Column(String(100), nullable=True)            # Phase 32
    emergency_contact_phone = Column(String(30), nullable=True)            # Phase 32
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```

**Edit 3.** Find:
```python
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    required_certs = Column(ARRAY(String), nullable=False, default=list)   # Phase 32: cert type keys
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 4.** Find:
```python
    author = relationship("User", foreign_keys=[author_id])

```
Replace with:
```python
    author = relationship("User", foreign_keys=[author_id])


# ------------------------------------------------------------------------------
# Phase 31: Availability & time off
# ------------------------------------------------------------------------------
class WorkerAvailability(Base):
    """One weekly window. A worker with no rows hasn't set availability (treated as open)."""
    __tablename__ = "worker_availability"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    weekday = Column(SmallInteger, nullable=False)          # 0 = Monday ... 6 = Sunday
    start_local = Column(String(5), nullable=False)         # 'HH:MM'
    end_local = Column(String(5), nullable=False)           # 'HH:MM' or '24:00'; earlier than start = next day
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (CheckConstraint("weekday BETWEEN 0 AND 6", name="chk_availability_weekday"),)


class TimeOffRequest(Base):
    __tablename__ = "time_off_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)                 # inclusive
    reason = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)   # pending | approved | denied | cancelled
    decided_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="SET NULL"), nullable=True)
    decision_note = Column(Text, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (CheckConstraint("end_date >= start_date", name="chk_time_off_range"),)


# ------------------------------------------------------------------------------
# Phase 32: Profile files & certifications
# ------------------------------------------------------------------------------
class UserFile(Base):
    """Small uploads kept in the database (profile photos, certificate scans)."""
    __tablename__ = "user_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)               # avatar | certificate
    filename = Column(String(255), nullable=True)
    content_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class WorkerCertification(Base):
    __tablename__ = "worker_certifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    cert_type = Column(String(50), nullable=False)          # keys in services/certs.py CERT_TYPES
    number = Column(String(100), nullable=True)
    issued_on = Column(Date, nullable=True)
    expires_on = Column(Date, nullable=True)
    file_id = Column(UUID(as_uuid=True), ForeignKey("user_files.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="unverified")   # unverified | verified | rejected
    verified_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="SET NULL"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("worker_id", "cert_type", name="uq_worker_cert"),)
```

---

## A3. `backend/src/schemas.py` (EDITS)
* `required_certs` on venue positions
* `cert_issues` / `time_off` on `RosterPerson`
* `required_certs` / `missing_certs` on `ListingPosition`
* `availability` / `time_off` on `EventListing`
* fit fields on `AssignCandidate`
* profile fields on `WorkerProfile`
* `certs` / `cert_attention` on `TeamMember`
* `time_off` on `WeekDay`
* all the new Phase 31/32 schemas at the end

**Edit 1.** Find:
```python
    previous_drop_at: Optional[datetime] = None  # Phase 29.4: came back / asking back after a drop
    rebook_reason: Optional[str] = None          # Phase 29.4


```
Replace with:
```python
    previous_drop_at: Optional[datetime] = None  # Phase 29.4: came back / asking back after a drop
    rebook_reason: Optional[str] = None          # Phase 29.4
    cert_issues: List[str] = []                  # Phase 32: e.g. "Alcohol server card (expired)", "Food handler card not verified"
    time_off: Optional[str] = None               # Phase 31: approved | pending time off on this shift's day(s)


```

**Edit 2.** Find:
```python
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False


class VenuePositionUpdate(BaseModel):
```
Replace with:
```python
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    required_certs: List[str] = []           # Phase 32: cert type keys (services/fit.py CERT_TYPES)


class VenuePositionUpdate(BaseModel):
```

**Edit 3.** Find:
```python
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


```
Replace with:
```python
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    required_certs: Optional[List[str]] = None   # Phase 32


```

**Edit 4.** Find:
```python
    sort_order: int
    is_active: bool

    class Config:
```
Replace with:
```python
    sort_order: int
    is_active: bool
    required_certs: List[str] = []           # Phase 32

    class Config:
```

**Edit 5.** Find:
```python
    my_dropped_at: Optional[datetime] = None   # Phase 29.4: the viewer dropped this position
    staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)


```
Replace with:
```python
    my_dropped_at: Optional[datetime] = None   # Phase 29.4: the viewer dropped this position
    staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)
    required_certs: List[str] = []             # Phase 32: labels of what this position needs
    missing_certs: List[str] = []              # Phase 32: what the VIEWER is missing (non-empty = can't request)


```

**Edit 6.** Find:
```python
    can_request: bool = True
    dropped_here: Optional[datetime] = None           # Phase 29.4: viewer dropped a position in this event -> asking back needs a reason + approval


```
Replace with:
```python
    can_request: bool = True
    dropped_here: Optional[datetime] = None           # Phase 29.4: viewer dropped a position in this event -> asking back needs a reason + approval
    availability: str = "not_set"                     # Phase 31: fits | outside | not_set (the viewer's weekly availability)
    time_off: Optional[str] = None                    # Phase 31: approved | pending time off that day


```

**Edit 7.** Find:
```python
    reliability: Optional[WorkerReliability] = None
    added_at: Optional[datetime] = None


```
Replace with:
```python
    reliability: Optional[WorkerReliability] = None
    added_at: Optional[datetime] = None
    certs: List[str] = []                    # Phase 32: cert keys that are verified and in date
    cert_attention: int = 0                  # Phase 32: certificates waiting for a check (not verified yet)


```

**Edit 8.** Find:
```python
    dropped_at: Optional[datetime] = None    # Phase 29.4: dropped this event; Assign needs a reason, offers are skipped
    drop_reason: Optional[str] = None


```
Replace with:
```python
    dropped_at: Optional[datetime] = None    # Phase 29.4: dropped this event; Assign needs a reason, offers are skipped
    drop_reason: Optional[str] = None
    availability: str = "not_set"            # Phase 31: fits | outside | not_set
    time_off: Optional[str] = None           # Phase 31: approved | pending
    missing_certs: List[str] = []            # Phase 32: labels (offers skip them; Assign asks first)
    unverified_certs: List[str] = []         # Phase 32: on file but no manager has checked them


```

**Edit 9.** Find:
```python
    pending_here: int = 0                    # waiting requests at this venue
    other_venues: int = 0                    # other venues they've worked at (count only)


```
Replace with:
```python
    pending_here: int = 0                    # waiting requests at this venue
    other_venues: int = 0                    # other venues they've worked at (count only)
    bio: Optional[str] = None                                     # Phase 32
    avatar_url: Optional[str] = None
    skills: List[str] = []                                        # "positions I work" from their profile
    emergency_contact_name: Optional[str] = None                  # only for people on the team / booked here
    emergency_contact_phone: Optional[str] = None
    certifications: List["CertificationItem"] = []
    availability: List["AvailabilityWindow"] = []                 # Phase 31
    time_off: List["TimeOffItem"] = []                            # upcoming pending / approved


```

**Edit 10.** Find:
```python
    capacity: int = 0
    filled: int = 0


```
Replace with:
```python
    capacity: int = 0
    filled: int = 0
    time_off: List[str] = []                     # Phase 31: team members with approved time off that day


```

**Edit 11.** Find:
```python
    detail: str
    spot_reopened: bool = False
```
Replace with:
```python
    detail: str
    spot_reopened: bool = False


# ------------------------------------------------------------------------------
# Phase 31: Availability & time off
# ------------------------------------------------------------------------------
class AvailabilityWindow(BaseModel):
    weekday: int = Field(..., ge=0, le=6)            # 0 = Monday ... 6 = Sunday
    start_local: str                                 # 'HH:MM'
    end_local: str                                   # 'HH:MM' or '24:00'; earlier than start = runs past midnight


class AvailabilityUpdate(BaseModel):
    windows: List[AvailabilityWindow] = []           # [] = clear (no availability set)


class TimeOffCreate(BaseModel):
    start_date: date
    end_date: date
    reason: Optional[str] = Field(None, max_length=500)


class TimeOffItem(BaseModel):
    id: UUID
    worker_id: UUID
    worker_name: Optional[str] = None
    start_date: date
    end_date: date
    reason: Optional[str] = None
    status: str                                      # pending | approved | denied | cancelled
    decision_note: Optional[str] = None
    decided_at: Optional[datetime] = None
    decided_by_name: Optional[str] = None
    decided_venue_name: Optional[str] = None
    created_at: datetime
    conflicts: List[str] = []                        # booked shifts in the range ("Sat Oct 3 · Bartender · Gala")


class TimeOffDecision(BaseModel):
    approve: bool
    note: Optional[str] = Field(None, max_length=500)


# ------------------------------------------------------------------------------
# Phase 32: Profile & certifications
# ------------------------------------------------------------------------------
class CertTypeInfo(BaseModel):
    key: str
    label: str
    hint: Optional[str] = None
    expires: bool = True


class CertificationItem(BaseModel):
    id: UUID
    cert_type: str
    label: str
    number: Optional[str] = None
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    file_id: Optional[UUID] = None
    status: str                                      # unverified | verified | rejected
    verified_at: Optional[datetime] = None
    verified_by_name: Optional[str] = None
    verified_venue_name: Optional[str] = None
    review_note: Optional[str] = None
    expired: bool = False
    expiring_soon: bool = False                      # within 30 days


class CertificationUpsert(BaseModel):
    number: Optional[str] = Field(None, max_length=100)
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    file_id: Optional[UUID] = None                   # from POST /api/me/files
    remove_file: bool = False


class CertReview(BaseModel):
    status: str                                      # verified | rejected
    note: Optional[str] = Field(None, max_length=500)


class FileUploadResult(BaseModel):
    id: UUID
    url: str
    content_type: str
    size_bytes: int


class MyProfile(BaseModel):
    id: UUID
    email: str
    role: str
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    skills: List[str] = []
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    discoverable: str = "private"
    availability: List[AvailabilityWindow] = []
    time_off: List[TimeOffItem] = []
    certifications: List[CertificationItem] = []
    cert_types: List[CertTypeInfo] = []
    missing: List[str] = []                          # phone | photo | emergency_contact | availability


class MyProfileUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=30)
    bio: Optional[str] = Field(None, max_length=600)
    skills: Optional[List[str]] = None
    emergency_contact_name: Optional[str] = Field(None, max_length=100)
    emergency_contact_phone: Optional[str] = Field(None, max_length=30)


WorkerProfile.model_rebuild()
```

---

# PART B: Backend

## B1. `backend/src/main.py` (EDITS: router import + include only)

**Edit 1.** Find:
```python
from src.routers.admin_console import router as admin_console_router
from src.routers.event_templates import router as event_templates_router
from src.services.notification_worker import notification_worker_loop

```
Replace with:
```python
from src.routers.admin_console import router as admin_console_router
from src.routers.event_templates import router as event_templates_router
from src.routers.profile import router as profile_router   # Phase 31 + 32
from src.services.notification_worker import notification_worker_loop

```

**Edit 2.** Find:
```python
app.include_router(admin_console_router)
app.include_router(event_templates_router)


```
Replace with:
```python
app.include_router(admin_console_router)
app.include_router(event_templates_router)
app.include_router(profile_router)   # Phase 31 + 32


```

---

## B2. NEW FILE `backend/src/services/fit.py`
The rules (availability fit, time-off overlap, certificate checks) and the certificate catalogue. Everything is loaded in bulk.

```python
"""
Phase 31 + 32: Does this person fit this shift?

  availability  - 'fits' | 'outside' | 'not_set'
                  Weekly windows are wall-clock times WHERE THEY WORK, so a shift is judged in its venue's
                  time zone. A shift fits when it sits entirely inside one window. Windows may run past
                  midnight (end earlier than start, or '24:00'). No windows at all = 'not_set' (never warns).
  time off      - 'approved' | 'pending' | None
                  A request covers whole local days (start_date..end_date inclusive). A shift overlaps when
                  any local day it touches is covered (a shift ending exactly at midnight doesn't touch the next day).
  certificates  - labels of what's missing for a position, e.g. ["Alcohol server card"]
                  A certificate counts when it isn't rejected and hasn't expired by the shift's local date.
                  Unverified certificates count (managers see the "not verified" badge).

Everything is loaded in bulk (one query per table) so candidate lists and listings stay fast.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, date, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import WorkerAvailability, TimeOffRequest, WorkerCertification, VenuePosition

ACTIVE_TIME_OFF = ("pending", "approved")

# The certificate catalogue. Keys are stored in VARCHAR columns (no DB enum).
CERT_TYPES: Dict[str, dict] = {
    "alcohol_server": {"label": "Alcohol server card", "hint": "TIPS, RBS, ServSafe Alcohol or your state's card", "expires": True},
    "food_handler": {"label": "Food handler card", "hint": "ServSafe Food Handler or your county's card", "expires": True},
    "food_manager": {"label": "Food protection manager", "hint": "ServSafe Manager or equivalent", "expires": True},
    "age_21": {"label": "21+ confirmed", "hint": "A manager checks your ID in person and marks it verified", "expires": False},
    "security_license": {"label": "Security guard license", "hint": "State guard card", "expires": True},
    "first_aid": {"label": "First aid / CPR", "hint": "Red Cross, AHA or similar", "expires": True},
}


def cert_label(key: str) -> str:
    return CERT_TYPES.get(key, {}).get("label", key.replace("_", " ").capitalize())


def as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def tz_of(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "America/New_York")
    except Exception:
        return ZoneInfo("America/New_York")


def parse_hm(value: str) -> Tuple[int, int]:
    """'HH:MM' (00:00-24:00) -> (h, m). Raises ValueError on bad input."""
    v = (value or "").strip()
    if len(v) != 5 or v[2] != ":":
        raise ValueError(f"Time must look like 18:30 (got '{value}').")
    h, m = int(v[:2]), int(v[3:])
    if not (0 <= h <= 24 and 0 <= m <= 59) or (h == 24 and m != 0):
        raise ValueError(f"'{value}' isn't a valid time.")
    return h, m


def _window_bounds(day: date, start_local: str, end_local: str, tz: ZoneInfo) -> Tuple[datetime, datetime]:
    sh, sm = parse_hm(start_local)
    eh, em = parse_hm(end_local)
    start = datetime.combine(day, time(sh % 24, sm), tzinfo=tz)
    end_day = day + timedelta(days=1) if (eh, em) == (24, 0) or (eh, em) <= (sh, sm) else day
    end = datetime.combine(end_day, time(eh % 24, em), tzinfo=tz)
    return start, end


def availability_fit(windows: List[Tuple[int, str, str]], start: datetime, end: datetime, tz: ZoneInfo) -> str:
    if not windows:
        return "not_set"
    s_loc, e_loc = as_utc(start).astimezone(tz), as_utc(end).astimezone(tz)
    for day in (s_loc.date(), s_loc.date() - timedelta(days=1)):   # yesterday's overnight window can cover early hours
        wd = day.weekday()
        for w_day, w_start, w_end in windows:
            if w_day != wd:
                continue
            try:
                ws, we = _window_bounds(day, w_start, w_end, tz)
            except ValueError:
                continue
            if ws <= s_loc and e_loc <= we:
                return "fits"
    return "outside"


def shift_local_days(start: datetime, end: datetime, tz: ZoneInfo) -> Tuple[date, date]:
    s_loc, e_loc = as_utc(start).astimezone(tz), as_utc(end).astimezone(tz)
    last = (e_loc - timedelta(microseconds=1)).date() if e_loc > s_loc else s_loc.date()
    return s_loc.date(), max(s_loc.date(), last)


def time_off_hit(requests: List[Tuple[date, date, str]], start: datetime, end: datetime, tz: ZoneInfo) -> Optional[str]:
    first, last = shift_local_days(start, end, tz)
    hit = None
    for d0, d1, st in requests:
        if d0 <= last and d1 >= first:
            if st == "approved":
                return "approved"
            hit = "pending"
    return hit


def missing_certs(required: Iterable[str], held: Dict[str, Tuple[str, Optional[date]]], on_day: date) -> List[str]:
    """required: cert keys. held: key -> (status, expires_on). Returns labels of what's missing / expired / rejected."""
    out = []
    for key in required or []:
        h = held.get(key)
        if h is None:
            out.append(cert_label(key))
        elif h[0] == "rejected":
            out.append(f"{cert_label(key)} (not accepted)")
        elif h[1] is not None and h[1] < on_day:
            out.append(f"{cert_label(key)} (expired)")
    return out


def unverified_certs(required: Iterable[str], held: Dict[str, Tuple[str, Optional[date]]]) -> List[str]:
    return [cert_label(k) for k in required or [] if k in held and held[k][0] == "unverified"]


@dataclass
class WorkerFit:
    windows: List[Tuple[int, str, str]] = field(default_factory=list)
    time_off: List[Tuple[date, date, str]] = field(default_factory=list)
    certs: Dict[str, Tuple[str, Optional[date]]] = field(default_factory=dict)

    def availability(self, start, end, tz) -> str:
        return availability_fit(self.windows, start, end, tz)

    def off(self, start, end, tz) -> Optional[str]:
        return time_off_hit(self.time_off, start, end, tz)

    def missing(self, required, start, end, tz) -> List[str]:
        return missing_certs(required, self.certs, shift_local_days(start, end, tz)[1])


async def load_fit(db: AsyncSession, worker_ids: Iterable) -> Dict:
    """worker_id -> WorkerFit, three queries total."""
    ids = list({w for w in worker_ids if w})
    out = {w: WorkerFit() for w in ids}
    if not ids:
        return out
    for a in (await db.execute(
        select(WorkerAvailability).where(WorkerAvailability.worker_id.in_(ids))
        .order_by(WorkerAvailability.weekday, WorkerAvailability.start_local)
    )).scalars().all():
        out[a.worker_id].windows.append((int(a.weekday), a.start_local, a.end_local))
    today = datetime.now(timezone.utc).date() - timedelta(days=1)
    for t in (await db.execute(
        select(TimeOffRequest).where(
            TimeOffRequest.worker_id.in_(ids), TimeOffRequest.status.in_(ACTIVE_TIME_OFF), TimeOffRequest.end_date >= today,
        )
    )).scalars().all():
        out[t.worker_id].time_off.append((t.start_date, t.end_date, t.status))
    for c in (await db.execute(select(WorkerCertification).where(WorkerCertification.worker_id.in_(ids)))).scalars().all():
        out[c.worker_id].certs[c.cert_type] = (c.status, c.expires_on)
    return out


async def load_requirements(db: AsyncSession, venue_ids: Iterable) -> Dict:
    """(venue_id, position name lower) -> [cert keys]. Positions are matched to shifts by name (shift.role_type)."""
    ids = list({v for v in venue_ids if v})
    if not ids:
        return {}
    req = {}
    for p in (await db.execute(
        select(VenuePosition).where(VenuePosition.venue_id.in_(ids), func.cardinality(VenuePosition.required_certs) > 0)
    )).scalars().all():
        req[(p.venue_id, (p.name or "").strip().lower())] = list(p.required_certs or [])
    return req


def required_for(reqs: Dict, shift) -> List[str]:
    return reqs.get((shift.venue_id, (shift.role_type or "").strip().lower()), [])


def availability_text(fit: str) -> Optional[str]:
    return {"outside": "Outside their availability"}.get(fit)
```

---

## B3. NEW FILE `backend/src/services/profile.py`
Profile / time-off / certificate builders, and the "team venues" and "who may open this file" rules.

```python
"""
Phase 31 + 32: A worker's own profile (photo, contact, emergency contact, positions, bio),
weekly availability, time off and certificates, plus the builders managers' screens reuse.
"""
from collections import defaultdict
from datetime import datetime, date, timezone, timedelta
from typing import Dict, Iterable, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftEvent, ShiftRequest,
    WorkerAvailability, TimeOffRequest, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, AvailabilityWindow, TimeOffItem, CertificationItem, CertTypeInfo,
)
from src.services.fit import CERT_TYPES, cert_label, tz_of, as_utc
from src.services.team import WORKED_STATUSES, EXCLUDED_STATUSES
from src.auth import normalize_role

BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
EXPIRING_DAYS = 30
MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_CERT_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
CERT_FILE_TYPES = IMAGE_TYPES + ("application/pdf",)
MAX_WINDOWS = 21
MAX_TIME_OFF_DAYS = 60


def full_name(u: Optional[User]) -> str:
    if u is None:
        return ""
    n = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return n or (u.email or "")


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


# ---------------------------------------------------------------------------------------------
# Relationships
# ---------------------------------------------------------------------------------------------
async def team_venue_ids(db: AsyncSession, worker_id) -> set:
    """Venues where this worker is on the team: an active team-list row, or they've worked there
    (and weren't removed / blocked). Their managers see and decide the worker's time off."""
    rows = (await db.execute(
        select(VenueWhitelist.venue_id, VenueWhitelist.is_active, VenueWhitelist.status)
        .where(VenueWhitelist.worker_id == worker_id)
    )).all()
    listed = {v for v, active, st in rows if active and (st or "active") not in EXCLUDED_STATUSES}
    excluded = {v for v, _, st in rows if (st or "") in EXCLUDED_STATUSES}
    worked = set((await db.execute(
        select(Shift.venue_id).join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker_id, func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
        .distinct()
    )).scalars().all())
    return listed | (worked - excluded)


async def related_venue_ids(db: AsyncSession, worker_id) -> set:
    """Any venue the worker has a connection to (team list in any state, or any request there)."""
    wl = set((await db.execute(select(VenueWhitelist.venue_id).where(VenueWhitelist.worker_id == worker_id))).scalars().all())
    req = set((await db.execute(
        select(Shift.venue_id).join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker_id).distinct()
    )).scalars().all())
    return wl | req


async def managed_venue_ids(db: AsyncSession, user: User) -> Optional[set]:
    """None = platform admin (every venue)."""
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return None
    return set((await db.execute(select(VenueManager.venue_id).where(VenueManager.user_id == user.id))).scalars().all())


async def may_view_worker(db: AsyncSession, viewer: User, worker_id) -> bool:
    if viewer.id == worker_id:
        return True
    mine = await managed_venue_ids(db, viewer)
    if mine is None:
        return True
    return bool(mine & await related_venue_ids(db, worker_id))


# ---------------------------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------------------------
async def _names(db: AsyncSession, user_ids: Iterable, venue_ids: Iterable):
    uids = {u for u in user_ids if u}
    vids = {v for v in venue_ids if v}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()} if uids else {}
    venues = {v.id: v.name for v in (await db.execute(select(Venue).where(Venue.id.in_(vids)))).scalars().all()} if vids else {}
    return users, venues


async def cert_items(db: AsyncSession, certs: List[WorkerCertification]) -> List[CertificationItem]:
    users, venues = await _names(db, [c.verified_by_user_id for c in certs], [c.verified_venue_id for c in certs])
    today = today_utc()
    out = []
    for c in sorted(certs, key=lambda c: list(CERT_TYPES).index(c.cert_type) if c.cert_type in CERT_TYPES else 99):
        expired = c.expires_on is not None and c.expires_on < today
        out.append(CertificationItem(
            id=c.id, cert_type=c.cert_type, label=cert_label(c.cert_type), number=c.number,
            issued_on=c.issued_on, expires_on=c.expires_on, file_id=c.file_id, status=c.status or "unverified",
            verified_at=c.verified_at, verified_by_name=full_name(users.get(c.verified_by_user_id)) or None,
            verified_venue_name=venues.get(c.verified_venue_id), review_note=c.review_note,
            expired=expired,
            expiring_soon=(not expired and c.expires_on is not None and c.expires_on <= today + timedelta(days=EXPIRING_DAYS)),
        ))
    return out


async def time_off_items(db: AsyncSession, rows: List[TimeOffRequest], venue_id=None) -> List[TimeOffItem]:
    """conflicts = booked shifts inside each range (only this venue's when venue_id is given)."""
    if not rows:
        return []
    users, venues = await _names(
        db, [r.worker_id for r in rows] + [r.decided_by_user_id for r in rows], [r.decided_venue_id for r in rows],
    )
    worker_ids = {r.worker_id for r in rows}
    lo = min(r.start_date for r in rows) - timedelta(days=1)
    hi = max(r.end_date for r in rows) + timedelta(days=2)
    q = (
        select(ShiftRequest.worker_id, Shift, Venue)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(
            ShiftRequest.worker_id.in_(worker_ids),
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.start_time >= datetime(lo.year, lo.month, lo.day, tzinfo=timezone.utc),
            Shift.start_time < datetime(hi.year, hi.month, hi.day, tzinfo=timezone.utc),
        )
        .order_by(Shift.start_time.asc())
    )
    if venue_id is not None:
        q = q.where(Shift.venue_id == venue_id)
    booked = defaultdict(list)
    for wid, s, v in (await db.execute(q)).all():
        booked[wid].append((s, v))
    out = []
    for r in rows:
        conflicts = []
        for s, v in booked.get(r.worker_id, []):
            local = as_utc(s.start_time).astimezone(tz_of(v.timezone))
            if r.start_date <= local.date() <= r.end_date:
                label = f"{local.strftime('%a %b %-d')} · {s.role_type} · {s.title}"
                conflicts.append(label if venue_id is not None else f"{label} ({v.name})")
        out.append(TimeOffItem(
            id=r.id, worker_id=r.worker_id, worker_name=full_name(users.get(r.worker_id)) or None,
            start_date=r.start_date, end_date=r.end_date, reason=r.reason, status=r.status,
            decision_note=r.decision_note, decided_at=r.decided_at,
            decided_by_name=full_name(users.get(r.decided_by_user_id)) or None,
            decided_venue_name=venues.get(r.decided_venue_id), created_at=r.created_at, conflicts=conflicts,
        ))
    return out


async def availability_of(db: AsyncSession, worker_id) -> List[AvailabilityWindow]:
    return [
        AvailabilityWindow(weekday=a.weekday, start_local=a.start_local, end_local=a.end_local)
        for a in (await db.execute(
            select(WorkerAvailability).where(WorkerAvailability.worker_id == worker_id)
            .order_by(WorkerAvailability.weekday, WorkerAvailability.start_local)
        )).scalars().all()
    ]


async def upcoming_time_off(db: AsyncSession, worker_id, include_past_days: int = 0) -> List[TimeOffRequest]:
    return (await db.execute(
        select(TimeOffRequest).where(
            TimeOffRequest.worker_id == worker_id,
            TimeOffRequest.end_date >= today_utc() - timedelta(days=include_past_days),
        ).order_by(TimeOffRequest.start_date.asc())
    )).scalars().all()


def profile_missing(user: User, has_availability: bool) -> List[str]:
    missing = []
    if not (user.phone or "").strip():
        missing.append("phone")
    if not user.avatar_url:
        missing.append("photo")
    if not (user.emergency_contact_name and user.emergency_contact_phone):
        missing.append("emergency_contact")
    if not has_availability:
        missing.append("availability")
    return missing


async def build_my_profile(db: AsyncSession, user: User) -> MyProfile:
    avail = await availability_of(db, user.id)
    time_off = await time_off_items(db, list(await upcoming_time_off(db, user.id, include_past_days=30)))
    certs = await cert_items(db, list((await db.execute(
        select(WorkerCertification).where(WorkerCertification.worker_id == user.id)
    )).scalars().all()))
    is_worker = normalize_role(user.role) == "worker"
    return MyProfile(
        id=user.id, email=user.email, role=normalize_role(user.role),
        first_name=user.first_name or "", last_name=user.last_name or "", phone=user.phone,
        avatar_url=user.avatar_url, bio=user.bio, skills=list(user.skills or []),
        emergency_contact_name=user.emergency_contact_name, emergency_contact_phone=user.emergency_contact_phone,
        discoverable=user.discoverable or "private",
        availability=avail, time_off=time_off, certifications=certs,
        cert_types=[CertTypeInfo(key=k, **v) for k, v in CERT_TYPES.items()],
        missing=profile_missing(user, bool(avail)) if is_worker else [m for m in profile_missing(user, True) if m == "phone"],
    )


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------
async def read_upload(upload: UploadFile, allowed, max_bytes: int) -> bytes:
    ctype = (upload.content_type or "").lower()
    if ctype not in allowed:
        nice = "a JPG, PNG or WebP image" if "application/pdf" not in allowed else "a JPG, PNG, WebP or PDF file"
        raise HTTPException(status_code=400, detail=f"Please upload {nice}.")
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"That file is too big (max {max_bytes // (1024 * 1024)} MB).")
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    return data


def avatar_url(file_id) -> str:
    return f"/api/files/avatar/{file_id}"
```

---

## B4. NEW FILE `backend/src/routers/profile.py`
All 15 new endpoints (listed in the docstring).

```python
"""
Phase 31 + 32: Profile, availability, time off and certificates.

Worker (signed in, their own data):
  GET    /api/me/profile                              everything on the Profile page
  PUT    /api/me/profile                              name, phone (required for workers), bio, positions, emergency contact
  POST   /api/me/avatar            (multipart file)    upload a profile photo (JPG/PNG/WebP, max 2 MB)
  DELETE /api/me/avatar
  PUT    /api/me/availability                         replace the weekly windows ([] = not set)
  POST   /api/me/time-off                             ask for days off (goes to the managers of their team venues)
  POST   /api/me/time-off/{id}/cancel                 withdraw a pending request / cancel approved time off
  POST   /api/me/files             (multipart file)    upload a certificate scan (JPG/PNG/WebP/PDF, max 5 MB)
  PUT    /api/me/certifications/{cert_type}           add or update a certificate (changes reset verification)
  DELETE /api/me/certifications/{cert_type}

Files:
  GET    /api/files/avatar/{file_id}                  profile photos (public, like any avatar)
  GET    /api/files/{file_id}                         certificate scans: the owner, managers of venues they're connected to, admins

Managers:
  GET    /api/venues/{venue_id}/time-off?scope=pending|upcoming   the venue team's requests (with clashes at this venue)
  POST   /api/time-off/{id}/decide?venue_id=          approve / deny (any manager of one of the worker's team venues)
  POST   /api/venues/{venue_id}/people/{worker_id}/certifications/{cert_id}/review   verify / reject
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response, status
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import (
    User, Venue, WorkerAvailability, TimeOffRequest, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, MyProfileUpdate, AvailabilityUpdate, AvailabilityWindow, TimeOffCreate, TimeOffItem,
    TimeOffDecision, CertificationUpsert, CertificationItem, CertReview, FileUploadResult,
)
from src.auth import get_current_user, require_manager_or_admin, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services.fit import CERT_TYPES, parse_hm, cert_label
from src.services.messaging import normalize_phone
from src.services.team import get_venue_team
from src.services.profile import (
    build_my_profile, time_off_items, cert_items, team_venue_ids, related_venue_ids, managed_venue_ids,
    may_view_worker, read_upload, avatar_url, today_utc, full_name,
    IMAGE_TYPES, CERT_FILE_TYPES, MAX_AVATAR_BYTES, MAX_CERT_BYTES, MAX_WINDOWS, MAX_TIME_OFF_DAYS,
)
from src.services import notify_events, activity

logger = logging.getLogger("shiftboard.profile")

router = APIRouter(tags=["Profile"])


def _clean(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


# ---------------------------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------------------------
@router.get("/api/me/profile", response_model=MyProfile)
async def get_my_profile(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await build_my_profile(db, current_user)


@router.put("/api/me/profile", response_model=MyProfile)
async def update_my_profile(
    body: MyProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    is_worker = normalize_role(current_user.role) == "worker"
    if "first_name" in data and not _clean(data["first_name"]):
        raise HTTPException(status_code=400, detail="First name can't be empty.")
    if "phone" in data:
        raw = _clean(data["phone"])
        if raw is None:
            if is_worker:
                raise HTTPException(status_code=400, detail="A mobile number is required so venues can reach you and texts can work.")
        elif normalize_phone(raw) is None:
            raise HTTPException(status_code=400, detail="That phone number doesn't look right. Use 10 digits, or +country code.")
    if _clean(data.get("emergency_contact_phone")) and normalize_phone(data["emergency_contact_phone"]) is None:
        raise HTTPException(status_code=400, detail="The emergency contact's phone number doesn't look right.")
    try:
        for key in ("first_name", "last_name", "phone", "bio", "emergency_contact_name", "emergency_contact_phone"):
            if key in data:
                setattr(current_user, key, _clean(data[key]) if key not in ("first_name", "last_name") else (_clean(data[key]) or ""))
        if "skills" in data and data["skills"] is not None:
            seen, skills = set(), []
            for s in data["skills"]:
                s = (s or "").strip()[:50]
                if s and s.lower() not in seen:
                    seen.add(s.lower())
                    skills.append(s)
            current_user.skills = skills[:12]
        await db.commit()
        await db.refresh(current_user)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your profile: {e}")
    return await build_my_profile(db, current_user)


@router.post("/api/me/avatar", response_model=MyProfile)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await read_upload(file, IMAGE_TYPES, MAX_AVATAR_BYTES)
    try:
        old = (await db.execute(
            select(UserFile.id).where(UserFile.owner_id == current_user.id, UserFile.kind == "avatar")
        )).scalars().all()
        f = UserFile(owner_id=current_user.id, kind="avatar", filename=(file.filename or "photo")[:255],
                     content_type=file.content_type.lower(), size_bytes=len(data), data=data,
                     created_at=datetime.now(timezone.utc))
        db.add(f)
        await db.flush()
        if old:
            await db.execute(delete(UserFile).where(UserFile.id.in_(old)))
        current_user.avatar_url = avatar_url(f.id)
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your photo: {e}")
    return await build_my_profile(db, current_user)


@router.delete("/api/me/avatar", response_model=MyProfile)
async def remove_avatar(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(delete(UserFile).where(UserFile.owner_id == current_user.id, UserFile.kind == "avatar"))
        current_user.avatar_url = None
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove your photo: {e}")
    return await build_my_profile(db, current_user)


# ---------------------------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------------------------
@router.put("/api/me/availability", response_model=List[AvailabilityWindow])
async def set_availability(
    body: AvailabilityUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if len(body.windows) > MAX_WINDOWS:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_WINDOWS} time ranges, please.")
    clean = []
    for w in body.windows:
        try:
            sh, sm = parse_hm(w.start_local)
            eh, em = parse_hm(w.end_local)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if (sh, sm) == (24, 0):
            raise HTTPException(status_code=400, detail="A range can't start at 24:00.")
        if (sh, sm) == (eh, em):
            raise HTTPException(status_code=400, detail="Start and end can't be the same. For the whole day use 00:00 to 24:00.")
        key = (w.weekday, w.start_local, w.end_local)
        if key not in clean:
            clean.append(key)
    try:
        await db.execute(delete(WorkerAvailability).where(WorkerAvailability.worker_id == current_user.id))
        for d, a, b in clean:
            db.add(WorkerAvailability(worker_id=current_user.id, weekday=d, start_local=a, end_local=b,
                                      created_at=datetime.now(timezone.utc)))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your availability: {e}")
    return [AvailabilityWindow(weekday=d, start_local=a, end_local=b) for d, a, b in sorted(clean)]


# ---------------------------------------------------------------------------------------------
# Time off (worker)
# ---------------------------------------------------------------------------------------------
@router.post("/api/me/time-off", response_model=TimeOffItem, status_code=status.HTTP_201_CREATED)
async def request_time_off(
    body: TimeOffCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="The last day can't be before the first day.")
    if body.start_date < today_utc() - timedelta(days=1):
        raise HTTPException(status_code=400, detail="Time off has to start today or later.")
    if (body.end_date - body.start_date).days + 1 > MAX_TIME_OFF_DAYS:
        raise HTTPException(status_code=400, detail=f"Ask for up to {MAX_TIME_OFF_DAYS} days at a time.")
    overlap = await db.scalar(
        select(TimeOffRequest.id).where(
            TimeOffRequest.worker_id == current_user.id,
            TimeOffRequest.status.in_(("pending", "approved")),
            TimeOffRequest.start_date <= body.end_date,
            TimeOffRequest.end_date >= body.start_date,
        ).limit(1)
    )
    if overlap:
        raise HTTPException(status_code=409, detail="You already asked for time off on some of these days.")
    try:
        now = datetime.now(timezone.utc)
        t = TimeOffRequest(worker_id=current_user.id, start_date=body.start_date, end_date=body.end_date,
                           reason=_clean(body.reason), status="pending", created_at=now, updated_at=now)
        db.add(t)
        await db.commit()
        await db.refresh(t)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not send your request: {e}")
    await notify_events.time_off_requested(t.id)
    await activity.for_time_off("time_off_requested", t.id, current_user.id)
    return (await time_off_items(db, [t]))[0]


@router.post("/api/me/time-off/{time_off_id}/cancel", response_model=TimeOffItem)
async def cancel_time_off(
    time_off_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id, TimeOffRequest.worker_id == current_user.id))
    if t is None:
        raise HTTPException(status_code=404, detail="Request not found.")
    if t.status not in ("pending", "approved"):
        raise HTTPException(status_code=400, detail="This request is already closed.")
    if t.end_date < today_utc():
        raise HTTPException(status_code=400, detail="That time off is already over.")
    was = t.status
    try:
        t.status = "cancelled"
        t.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(t)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not cancel: {e}")
    if was == "approved":
        await activity.for_time_off("time_off_cancelled", t.id, current_user.id)
    return (await time_off_items(db, [t]))[0]


# ---------------------------------------------------------------------------------------------
# Time off (managers)
# ---------------------------------------------------------------------------------------------
@router.get("/api/venues/{venue_id}/time-off", response_model=List[TimeOffItem])
async def venue_time_off(
    venue_id: UUID,
    scope: str = Query("pending", pattern="^(pending|upcoming)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    team_ids = [u.id for u in await get_venue_team(db, venue_id)]
    if not team_ids:
        return []
    q = select(TimeOffRequest).where(TimeOffRequest.worker_id.in_(team_ids), TimeOffRequest.end_date >= today_utc())
    q = q.where(TimeOffRequest.status == "pending") if scope == "pending" else q.where(TimeOffRequest.status.in_(("pending", "approved")))
    rows = (await db.execute(q.order_by(TimeOffRequest.start_date.asc()))).scalars().all()
    return await time_off_items(db, list(rows), venue_id=venue_id)


@router.post("/api/time-off/{time_off_id}/decide", response_model=TimeOffItem)
async def decide_time_off(
    time_off_id: UUID,
    body: TimeOffDecision,
    venue_id: Optional[UUID] = Query(None, description="The venue the manager is deciding for (shown to the worker)"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None:
        raise HTTPException(status_code=404, detail="Request not found.")
    team_venues = await team_venue_ids(db, t.worker_id)
    mine = await managed_venue_ids(db, current_user)
    allowed = team_venues if mine is None else (team_venues & mine)
    if not allowed and mine is not None:
        raise HTTPException(status_code=403, detail="This person isn't on the team at a venue you manage.")
    if venue_id is not None and allowed and venue_id not in allowed:
        raise HTTPException(status_code=403, detail="This person isn't on that venue's team.")
    if t.status != "pending":
        raise HTTPException(status_code=400, detail=f"This request was already {t.status}.")
    note = _clean(body.note)
    if not body.approve and not note:
        raise HTTPException(status_code=400, detail="Add a short note so they know why.")
    try:
        now = datetime.now(timezone.utc)
        t.status = "approved" if body.approve else "denied"
        t.decided_by_user_id = current_user.id
        t.decided_venue_id = venue_id or (sorted(allowed, key=str)[0] if allowed else None)
        t.decision_note = note
        t.decided_at = now
        t.updated_at = now
        await db.commit()
        await db.refresh(t)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save the decision: {e}")
    await notify_events.time_off_decided(t.id)
    await activity.for_time_off("time_off_approved" if body.approve else "time_off_denied", t.id, current_user.id,
                                venue_id=t.decided_venue_id)
    return (await time_off_items(db, [t], venue_id=t.decided_venue_id))[0]


# ---------------------------------------------------------------------------------------------
# Certificates
# ---------------------------------------------------------------------------------------------
@router.post("/api/me/files", response_model=FileUploadResult, status_code=status.HTTP_201_CREATED)
async def upload_cert_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await read_upload(file, CERT_FILE_TYPES, MAX_CERT_BYTES)
    try:
        f = UserFile(owner_id=current_user.id, kind="certificate", filename=(file.filename or "certificate")[:255],
                     content_type=file.content_type.lower(), size_bytes=len(data), data=data,
                     created_at=datetime.now(timezone.utc))
        db.add(f)
        await db.commit()
        await db.refresh(f)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not upload: {e}")
    return FileUploadResult(id=f.id, url=f"/api/files/{f.id}", content_type=f.content_type, size_bytes=f.size_bytes)


@router.put("/api/me/certifications/{cert_type}", response_model=CertificationItem)
async def upsert_certification(
    cert_type: str,
    body: CertificationUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    info = CERT_TYPES.get(cert_type)
    if info is None:
        raise HTTPException(status_code=400, detail="Unknown certificate type.")
    if info["expires"] and body.expires_on is None:
        raise HTTPException(status_code=400, detail=f"Add the expiry date on your {info['label'].lower()}.")
    if body.issued_on and body.expires_on and body.expires_on < body.issued_on:
        raise HTTPException(status_code=400, detail="The expiry date can't be before the issue date.")
    if body.file_id is not None:
        owned = await db.scalar(select(UserFile.id).where(
            UserFile.id == body.file_id, UserFile.owner_id == current_user.id, UserFile.kind == "certificate"))
        if owned is None:
            raise HTTPException(status_code=400, detail="That upload wasn't found. Try attaching it again.")
    try:
        c = await db.scalar(select(WorkerCertification).where(
            WorkerCertification.worker_id == current_user.id, WorkerCertification.cert_type == cert_type))
        now = datetime.now(timezone.utc)
        if c is None:
            c = WorkerCertification(worker_id=current_user.id, cert_type=cert_type, status="unverified", created_at=now)
            db.add(c)
        old_file = c.file_id
        new_file = None if body.remove_file else (body.file_id or c.file_id)
        changed = (
            c.number != _clean(body.number) or c.issued_on != body.issued_on or c.expires_on != body.expires_on
            or c.file_id != new_file
        )
        c.number = _clean(body.number)
        c.issued_on = body.issued_on if info["expires"] else None
        c.expires_on = body.expires_on if info["expires"] else None
        c.file_id = new_file
        if changed:                                      # a new card has to be checked again
            c.status = "unverified"
            c.verified_by_user_id = None
            c.verified_venue_id = None
            c.verified_at = None
            c.review_note = None
        c.updated_at = now
        await db.flush()
        if old_file and old_file != new_file:
            await db.execute(delete(UserFile).where(UserFile.id == old_file, UserFile.owner_id == current_user.id))
        await db.commit()
        await db.refresh(c)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    return (await cert_items(db, [c]))[0]


@router.delete("/api/me/certifications/{cert_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_certification(
    cert_type: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    c = await db.scalar(select(WorkerCertification).where(
        WorkerCertification.worker_id == current_user.id, WorkerCertification.cert_type == cert_type))
    if c is None:
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        file_id = c.file_id
        await db.execute(delete(WorkerCertification).where(WorkerCertification.id == c.id))
        if file_id:
            await db.execute(delete(UserFile).where(UserFile.id == file_id, UserFile.owner_id == current_user.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not delete: {e}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/venues/{venue_id}/people/{worker_id}/certifications/{cert_id}/review", response_model=CertificationItem)
async def review_certification(
    venue_id: UUID,
    worker_id: UUID,
    cert_id: UUID,
    body: CertReview,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if body.status not in ("verified", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be verified or rejected.")
    if venue_id not in await related_venue_ids(db, worker_id):
        raise HTTPException(status_code=404, detail="Person not found.")
    c = await db.scalar(select(WorkerCertification).where(
        WorkerCertification.id == cert_id, WorkerCertification.worker_id == worker_id))
    if c is None:
        raise HTTPException(status_code=404, detail="Certificate not found.")
    note = _clean(body.note)
    if body.status == "rejected" and not note:
        raise HTTPException(status_code=400, detail="Say what's wrong so they can fix it.")
    try:
        c.status = body.status
        c.verified_by_user_id = current_user.id
        c.verified_venue_id = venue_id
        c.verified_at = datetime.now(timezone.utc)
        c.review_note = note
        await db.commit()
        await db.refresh(c)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    await notify_events.cert_reviewed(c.id)
    safe_note = (note or "").replace("{", "{{").replace("}", "}}")
    verb = "Verified" if body.status == "verified" else "Didn't accept"
    await activity.for_worker("cert_verified" if body.status == "verified" else "cert_rejected", venue_id, worker_id,
                              current_user.id, f"{verb} {{name}}'s {cert_label(c.cert_type).lower()}" + (f" · {safe_note}" if note else ""))
    return (await cert_items(db, [c]))[0]


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------
@router.get("/api/files/avatar/{file_id}")
async def get_avatar(file_id: UUID, db: AsyncSession = Depends(get_db)):
    f = await db.scalar(select(UserFile).where(UserFile.id == file_id, UserFile.kind == "avatar"))
    if f is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return Response(content=f.data, media_type=f.content_type, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/api/files/{file_id}")
async def get_file(file_id: UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    f = await db.scalar(select(UserFile).where(UserFile.id == file_id))
    if f is None or not await may_view_worker(db, current_user, f.owner_id):
        raise HTTPException(status_code=404, detail="Not found.")
    safe = (f.filename or "file").replace('"', "")
    return Response(content=f.data, media_type=f.content_type,
                    headers={"Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "private, no-store"})
```

---

## B5. `backend/src/services/booking.py` (EDITS)
New `require_certs()`. A worker's own request is refused when the position needs a certificate they don't have.

**Edit 1.** Find:
```python
from sqlalchemy.orm import selectinload

from src.models import Shift, ShiftEvent, ShiftRequest, User
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events
from src.services import activity
from src.services.team import is_blocked

logger = logging.getLogger("shiftboard.booking")
```
Replace with:
```python
from sqlalchemy.orm import selectinload

from src.models import Shift, ShiftEvent, ShiftRequest, User, Venue
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events
from src.services import activity
from src.services.team import is_blocked
from src.services.fit import load_fit, load_requirements, required_for, tz_of

logger = logging.getLogger("shiftboard.booking")
```

**Edit 2.** Find:
```python
    q = q.where(Shift.event_id == shift.event_id) if shift.event_id else q.where(Shift.id == shift.id)
    return await db.scalar(q)


```
Replace with:
```python
    q = q.where(Shift.event_id == shift.event_id) if shift.event_id else q.where(Shift.id == shift.id)
    return await db.scalar(q)


async def require_certs(db: AsyncSession, worker: User, shift: Shift, you: bool = True, who: str = "") -> None:
    """Phase 32: 400 when the position needs certificates this person doesn't have (or that expired / weren't accepted)."""
    required = required_for(await load_requirements(db, [shift.venue_id]), shift)
    if not required:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    tz = tz_of(venue.timezone if venue is not None else None)
    missing = (await load_fit(db, [worker.id]))[worker.id].missing(required, shift.start_time, shift.end_time, tz)
    if missing:
        where = f" at {venue.name}" if venue is not None else ""
        if you:
            raise HTTPException(status_code=400, detail=f"{shift.role_type}{where} needs: {', '.join(missing)}. "
                                                        "Add it on your Profile page, then try again.")
        raise HTTPException(status_code=400, detail=f"{who or 'They'} can't take this: {shift.role_type}{where} needs {', '.join(missing)}.")


```

**Edit 3.** Find:
```python
        if await is_blocked(db, shift.venue_id, worker.id):          # Phase 29
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")

        # --- One active request per event -------------------------------------------------
```
Replace with:
```python
        if await is_blocked(db, shift.venue_id, worker.id):          # Phase 29
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")
        await require_certs(db, worker, shift, you=True)              # Phase 32

        # --- One active request per event -------------------------------------------------
```

---

## B6. `backend/src/services/staffing.py` (EDITS)
Candidates carry `availability`, `time_off`, `missing_certs` and `unverified_certs`. Offers skip people missing certificates or on approved time off, and accepting an offer re-checks certificates.

**Edit 1.** Find:
```python
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
    prior_drop_in_event, REBOOK_REASON_MIN,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
from src.services.reliability import compute_reliability
from src.services.locations import load_locations
from src.auth import normalize_role

```
Replace with:
```python
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
    prior_drop_in_event, REBOOK_REASON_MIN, require_certs,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
from src.services.reliability import compute_reliability
from src.services.locations import load_locations
from src.services.fit import load_fit, load_requirements, required_for, tz_of, unverified_certs   # Phase 31 + 32
from src.auth import normalize_role

```

**Edit 2.** Find:
```python
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=c.reason or "Not available."))
                continue
            o = ShiftOffer(
                shift_id=shift.id, venue_id=shift.venue_id, worker_id=wid, batch_id=batch,
```
Replace with:
```python
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=c.reason or "Not available."))
                continue
            if c.missing_certs:                                                         # Phase 32
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=f"Needs {', '.join(c.missing_certs)} on their profile."))
                continue
            if c.time_off == "approved":                                                # Phase 31
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Has approved time off that day."))
                continue
            o = ShiftOffer(
                shift_id=shift.id, venue_id=shift.venue_id, worker_id=wid, batch_id=batch,
```

**Edit 3.** Find:
```python
        if (offer.status or "").lower() != "pending":
            raise HTTPException(status_code=409, detail="Someone else accepted this one first.")
        req = await _book_locked(db, shift, worker, source="offer", approved_by=offer.offered_by_user_id, who="you")
        req_id = req.id
```
Replace with:
```python
        if (offer.status or "").lower() != "pending":
            raise HTTPException(status_code=409, detail="Someone else accepted this one first.")
        await require_certs(db, worker, shift, you=True)                               # Phase 32
        req = await _book_locked(db, shift, worker, source="offer", approved_by=offer.offered_by_user_id, who="you")
        req_id = req.id
```

**Edit 4.** Find:
```python
    rel = await compute_reliability(db, ids)
    role_l = (shift.role_type or "").lower()

    out: List[AssignCandidate] = []
```
Replace with:
```python
    rel = await compute_reliability(db, ids)
    role_l = (shift.role_type or "").lower()
    fits = await load_fit(db, ids)                                                   # Phase 31 + 32
    required = required_for(await load_requirements(db, [venue_id]), shift)
    venue_obj = await db.scalar(select(Venue).where(Venue.id == venue_id))
    tz = tz_of(venue_obj.timezone if venue_obj is not None else None)

    out: List[AssignCandidate] = []
```

**Edit 5.** Find:
```python
            dropped_at=dropped[wid][0] if wid in dropped else None,
            drop_reason=dropped[wid][1] if wid in dropped else None,
        ))
    out.sort(key=lambda c: (
```
Replace with:
```python
            dropped_at=dropped[wid][0] if wid in dropped else None,
            drop_reason=dropped[wid][1] if wid in dropped else None,
            availability=fits[wid].availability(shift.start_time, shift.end_time, tz),
            time_off=fits[wid].off(shift.start_time, shift.end_time, tz),
            missing_certs=fits[wid].missing(required, shift.start_time, shift.end_time, tz),
            unverified_certs=unverified_certs(required, fits[wid].certs),
        ))
    out.sort(key=lambda c: (
```

---

## B7. `backend/src/routers/transfers.py` (EDITS)
A hand-off to a teammate without the required certificate is refused.

**Edit 1.** Find:
```python
from src.services import activity
from src.services.team import get_transfer_candidates

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])
```
Replace with:
```python
from src.services import activity
from src.services.team import get_transfer_candidates
from src.services.booking import require_certs   # Phase 32

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])
```

**Edit 2.** Find:
```python
            detail="You do not hold a confirmed spot on this shift."
        )

    # 4. Check if there's already an active transfer for this shift
```
Replace with:
```python
            detail="You do not hold a confirmed spot on this shift."
        )

    # Phase 32: the teammate needs the position's certificates
    await require_certs(db, to_worker, shift, you=False, who=f"{to_worker.first_name or 'They'}".strip())

    # 4. Check if there's already an active transfer for this shift
```

---

## B8. `backend/src/services/listings.py` (EDITS)

**Edit 1.** Find:
```python
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.team import blocked_venue_ids
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
```
Replace with:
```python
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.team import blocked_venue_ids
from src.services.fit import load_fit, load_requirements, required_for, tz_of, cert_label   # Phase 31 + 32
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
```

**Edit 2.** Find:
```python
    locations = await load_locations(db, [e.location_id for e in events])   # Phase 27
    blocked = await blocked_venue_ids(db, user.id)                        # Phase 29

    out: List[EventListing] = []
```
Replace with:
```python
    locations = await load_locations(db, [e.location_id for e in events])   # Phase 27
    blocked = await blocked_venue_ids(db, user.id)                        # Phase 29
    my_fit = (await load_fit(db, [user.id]))[user.id]                     # Phase 31 + 32
    requirements = await load_requirements(db, venue_ids)

    out: List[EventListing] = []
```

**Edit 3.** Find:
```python
        drops = [as_utc(mine[s.id].dropped_at) for s in ev_shifts if s.id in mine and mine[s.id].dropped_at is not None]
        dropped_here = max(drops) if drops else None
        for s in ev_shifts:
            r = mine.get(s.id)
```
Replace with:
```python
        drops = [as_utc(mine[s.id].dropped_at) for s in ev_shifts if s.id in mine and mine[s.id].dropped_at is not None]
        dropped_here = max(drops) if drops else None
        vtz = tz_of(venue.timezone)
        for s in ev_shifts:
            r = mine.get(s.id)
```

**Edit 4.** Find:
```python
                my_dropped_at=r.dropped_at if r is not None and my_status == "dropped" else None,   # Phase 29.4
                staff_notes=s.staff_notes if booked_here else None,
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        if event_id is None and not open_positions and my_request is None:
            continue   # list mode: nothing to request and nothing of mine here
```
Replace with:
```python
                my_dropped_at=r.dropped_at if r is not None and my_status == "dropped" else None,   # Phase 29.4
                staff_notes=s.staff_notes if booked_here else None,
                required_certs=[cert_label(k) for k in required_for(requirements, s)],                # Phase 32
                missing_certs=my_fit.missing(required_for(requirements, s), s.start_time, s.end_time, vtz),
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        requestable = [p for p in open_positions if not p.missing_certs]      # Phase 32
        if event_id is None and not open_positions and my_request is None:
            continue   # list mode: nothing to request and nothing of mine here
```

**Edit 5.** Find:
```python
            not cancelled
            and not started
            and bool(open_positions)
            and conflict is None
            and (my_request is None or my_request.status in PENDING_STATUSES)
```
Replace with:
```python
            not cancelled
            and not started
            and bool(requestable)
            and conflict is None
            and (my_request is None or my_request.status in PENDING_STATUSES)
```

**Edit 6.** Find:
```python
            ) else None,
            geofence_on=geofence_on(ev, venue),
        ))
    return out
```
Replace with:
```python
            ) else None,
            geofence_on=geofence_on(ev, venue),
            availability=my_fit.availability(ev.start_time, ev.end_time, vtz),          # Phase 31
            time_off=my_fit.off(ev.start_time, ev.end_time, vtz),
        ))
    return out
```

---

## B9. `backend/src/routers/venues.py` (EDITS)
Validates `required_certs` on position create/update, and adds roster `cert_issues` / `time_off`.

**Edit 1.** Find:
```python
from src.services.clock import auto_close_open_entries, late_minutes as clock_late_minutes
from src.services.locations import load_locations
from src.services import activity
from src.services import admin_audit
```
Replace with:
```python
from src.services.clock import auto_close_open_entries, late_minutes as clock_late_minutes
from src.services.locations import load_locations
from src.services.fit import CERT_TYPES, load_fit, load_requirements, required_for, tz_of, unverified_certs   # Phase 31 + 32


def _clean_certs(keys) -> List[str]:
    """Phase 32: keep known certificate keys, in catalogue order, no duplicates."""
    wanted = {k for k in (keys or [])}
    unknown = wanted - set(CERT_TYPES)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown certificate type: {', '.join(sorted(unknown))}.")
    return [k for k in CERT_TYPES if k in wanted]
from src.services import activity
from src.services import admin_audit
```

**Edit 2.** Find:
```python
            existing.tips_eligible = bool(pos_in.tips_eligible)
            existing.tip_pool = bool(pos_in.tips_eligible and pos_in.tip_pool)
            await db.commit()
            await db.refresh(existing)
```
Replace with:
```python
            existing.tips_eligible = bool(pos_in.tips_eligible)
            existing.tip_pool = bool(pos_in.tips_eligible and pos_in.tip_pool)
            existing.required_certs = _clean_certs(pos_in.required_certs)      # Phase 32
            await db.commit()
            await db.refresh(existing)
```

**Edit 3.** Find:
```python
            sort_order=int(max_order) + 1,
            is_active=True,
        )
        db.add(pos)
```
Replace with:
```python
            sort_order=int(max_order) + 1,
            is_active=True,
            required_certs=_clean_certs(pos_in.required_certs),                # Phase 32
        )
        db.add(pos)
```

**Edit 4.** Find:
```python
    if "default_rate" in data and (data["default_rate"] is None or data["default_rate"] <= 0):
        raise HTTPException(status_code=400, detail="Default rate must be greater than $0.")

    try:
```
Replace with:
```python
    if "default_rate" in data and (data["default_rate"] is None or data["default_rate"] <= 0):
        raise HTTPException(status_code=400, detail="Default rate must be greater than $0.")
    if "required_certs" in data:                                                 # Phase 32
        if data["required_certs"] is None:
            data.pop("required_certs")
        else:
            data["required_certs"] = _clean_certs(data["required_certs"])

    try:
```

**Edit 5.** Find:
```python
    event_locations = await load_locations(db, [e.location_id for e in event_objs.values()])   # Phase 27

    # Phase 26.2: has each booked person read the latest info?
    for s in shifts:
```
Replace with:
```python
    event_locations = await load_locations(db, [e.location_id for e in event_objs.values()])   # Phase 27

    # Phase 31 + 32: certificate problems and time off for booked people
    fit_by_worker = await load_fit(db, {p.worker_id for ps in assigned_by_shift.values() for p in ps})
    requirements = await load_requirements(db, [venue_id])
    vtz = tz_of(venue_obj.timezone if venue_obj is not None else None)
    for s in shifts:
        needed = required_for(requirements, s)
        for person in assigned_by_shift[s.id]:
            f = fit_by_worker.get(person.worker_id)
            if f is None:
                continue
            person.cert_issues = f.missing(needed, s.start_time, s.end_time, vtz) + [
                f"{label} not verified" for label in unverified_certs(needed, f.certs)
            ]
            if person.status in ("approved", "confirmed"):
                person.time_off = f.off(s.start_time, s.end_time, vtz)

    # Phase 26.2: has each booked person read the latest info?
    for s in shifts:
```

---

## B10. `backend/src/routers/team.py` (EDITS)
Adds certificate chips on the team list, and the profile, certificates, availability and time off to the worker profile.

**Edit 1.** Find:
```python
    rel = await compute_reliability(db, ids)

    out = []
    for wid, u in users.items():
```
Replace with:
```python
    rel = await compute_reliability(db, ids)

    # Phase 32: verified, in-date certificates (chips on the Team list) and ones waiting for a check
    from src.models import WorkerCertification
    cert_ok, cert_wait = {}, {}
    if users:
        today = datetime.now(timezone.utc).date()
        for c in (await db.execute(
            select(WorkerCertification).where(WorkerCertification.worker_id.in_(list(users)))
        )).scalars().all():
            if c.expires_on is not None and c.expires_on < today:
                continue
            if c.status == "verified":
                cert_ok.setdefault(c.worker_id, []).append(c.cert_type)
            elif c.status == "unverified":
                cert_wait[c.worker_id] = cert_wait.get(c.worker_id, 0) + 1

    out = []
    for wid, u in users.items():
```

**Edit 2.** Find:
```python
            reliability=WorkerReliability(worker_id=wid, **r) if r else None,
            added_at=row.created_at if row is not None else None,
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
```
Replace with:
```python
            reliability=WorkerReliability(worker_id=wid, **r) if r else None,
            added_at=row.created_at if row is not None else None,
            certs=sorted(cert_ok.get(wid, [])),
            cert_attention=cert_wait.get(wid, 0),
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
```

**Edit 3.** Find:
```python
               func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
    ) or 0)
    return WorkerProfile(member=member, history=history, pending_here=pending_here, other_venues=other_venues)
```
Replace with:
```python
               func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
    ) or 0)
    # Phase 31 + 32: profile, certificates, availability, time off. Private contact details only for
    # people connected to this venue (not a stranger found through search).
    from src.models import WorkerCertification
    from src.services.profile import cert_items, time_off_items, availability_of, upcoming_time_off
    connected = member.status != "none"
    certs = await cert_items(db, list((await db.execute(
        select(WorkerCertification).where(WorkerCertification.worker_id == worker_id)
    )).scalars().all()))
    time_off = [t for t in await time_off_items(db, list(await upcoming_time_off(db, worker_id)), venue_id=venue_id)
                if t.status in ("pending", "approved")]
    return WorkerProfile(
        member=member, history=history, pending_here=pending_here, other_venues=other_venues,
        bio=user.bio, avatar_url=user.avatar_url, skills=list(user.skills or []),
        emergency_contact_name=user.emergency_contact_name if connected else None,
        emergency_contact_phone=user.emergency_contact_phone if connected else None,
        certifications=certs, availability=await availability_of(db, worker_id),
        time_off=time_off if connected else [],
    )
```

---

## B11. `backend/src/services/tonight.py` (EDITS)
"Off: …" names per day on This week.

**Edit 1.** Find:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, ShiftOffer, TimeEntry, User, Venue
from src.schemas import (
    TonightResponse, TonightEvent, TonightPosition, TonightPerson, TonightAlert, WeekDay, WeekEvent,
```
Replace with:
```python
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, ShiftOffer, TimeEntry, User, Venue, TimeOffRequest
from src.services.team import get_venue_team
from src.schemas import (
    TonightResponse, TonightEvent, TonightPosition, TonightPerson, TonightAlert, WeekDay, WeekEvent,
```

**Edit 2.** Find:
```python
        we.start_time = min(we.start_time, start)
        we.end_time = max(we.end_time, as_utc(s.end_time))
    for d in days:
        d.events.sort(key=lambda e: e.start_time)
        d.capacity = sum(e.capacity for e in d.events if e.status != "draft")
```
Replace with:
```python
        we.start_time = min(we.start_time, start)
        we.end_time = max(we.end_time, as_utc(s.end_time))
    # Phase 31: who on the team has approved time off each day
    team = {u.id: u for u in await get_venue_team(db, venue.id)}
    if team:
        last_day = today_local + timedelta(days=WEEK_DAYS - 1)
        for t in (await db.execute(
            select(TimeOffRequest).where(
                TimeOffRequest.worker_id.in_(list(team)), TimeOffRequest.status == "approved",
                TimeOffRequest.start_date <= last_day, TimeOffRequest.end_date >= today_local,
            )
        )).scalars().all():
            for d in days:
                if t.start_date.isoformat() <= d.date <= t.end_date.isoformat():
                    d.time_off.append(_name(team[t.worker_id]))
    for d in days:
        d.time_off.sort()
        d.events.sort(key=lambda e: e.start_time)
        d.capacity = sum(e.capacity for e in d.events if e.status != "draft")
```

---

## B12. `backend/src/services/activity.py` (EDITS)
New kinds (Team filter): `time_off_requested/approved/denied/cancelled` and `cert_verified/rejected`, plus the `for_time_off()` hook.

**Edit 1.** Find:
```python

from src.database import AsyncSessionLocal
from src.models import VenueActivity, Shift, ShiftEvent, ShiftRequest, User, Venue

logger = logging.getLogger("shiftboard.activity")
```
Replace with:
```python

from src.database import AsyncSessionLocal
from src.models import VenueActivity, Shift, ShiftEvent, ShiftRequest, User, Venue, TimeOffRequest

logger = logging.getLogger("shiftboard.activity")
```

**Edit 2.** Find:
```python
    "manager_clock_in": "alerts",
    "unfilled_soon": "alerts",
}
CATEGORIES = ("bookings", "staffing", "team", "changes", "alerts")
```
Replace with:
```python
    "manager_clock_in": "alerts",
    "unfilled_soon": "alerts",
    "time_off_requested": "team",       # Phase 31
    "time_off_approved": "team",
    "time_off_denied": "team",
    "time_off_cancelled": "team",
    "cert_verified": "team",            # Phase 32
    "cert_rejected": "team",
}
CATEGORIES = ("bookings", "staffing", "team", "changes", "alerts")
```

**Edit 3.** Find:
```python
async def for_venue(kind: str, venue_id, actor_id=None, text: str = "") -> None:
    await _run(kind, _for_venue, kind, venue_id, actor_id, text)
```
Replace with:
```python
async def for_venue(kind: str, venue_id, actor_id=None, text: str = "") -> None:
    await _run(kind, _for_venue, kind, venue_id, actor_id, text)


# ---------------------------------------------------------------------------------------------
# Phase 31: time off (logged at every team venue, or the deciding venue for decisions)
# ---------------------------------------------------------------------------------------------
def _range_text(t: TimeOffRequest) -> str:
    a = t.start_date.strftime("%a %b %-d")
    return a if t.end_date == t.start_date else f"{a} – {t.end_date.strftime('%a %b %-d')}"


async def _for_time_off(db: AsyncSession, kind: str, time_off_id, actor_id, venue_id) -> None:
    from src.services.profile import team_venue_ids      # local import: profile imports this module's siblings
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None:
        return
    worker = await db.scalar(select(User).where(User.id == t.worker_id))
    name = person(worker)
    when = _range_text(t)
    text = {
        "time_off_requested": f"{name} asked for time off: {when}",
        "time_off_approved": f"Approved {name}'s time off: {when}",
        "time_off_denied": f"Declined {name}'s time off: {when}",
        "time_off_cancelled": f"{name} cancelled their time off: {when}",
    }.get(kind, f"{name}: {when}")
    if kind == "time_off_requested" and t.reason:
        text += f" · {t.reason}"
    if kind in ("time_off_approved", "time_off_denied") and t.decision_note:
        text += f" · {t.decision_note}"
    venues = [venue_id] if venue_id else sorted(await team_venue_ids(db, t.worker_id), key=str)
    for v in venues:
        await record_in(db, v, kind, text, actor_id=actor_id, worker_id=t.worker_id)


async def for_time_off(kind: str, time_off_id, actor_id=None, venue_id=None) -> None:
    await _run(kind, _for_time_off, kind, time_off_id, actor_id, venue_id)
```

---

## B13. `backend/src/services/notify_events.py` (EDIT: append)
New hooks: `time_off_requested`, `time_off_decided` and `cert_reviewed`.

**Edit 1.** Find:
```python
async def shift_dropped(request_id) -> None:
    await _run("shift_dropped", _shift_dropped, request_id)
```
Replace with:
```python
async def shift_dropped(request_id) -> None:
    await _run("shift_dropped", _shift_dropped, request_id)


# ---------------------------------------------------------------------------------------------
# Phase 31: time off   /   Phase 32: certificates
# ---------------------------------------------------------------------------------------------
def _days_text(t) -> str:
    a = t.start_date.strftime("%a %b %-d")
    return a if t.end_date == t.start_date else f"{a} – {t.end_date.strftime('%a %b %-d')}"


async def _time_off_requested(db: AsyncSession, time_off_id) -> None:
    from src.models import TimeOffRequest
    from src.services.profile import team_venue_ids, time_off_items
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None:
        return
    worker = await db.scalar(select(User).where(User.id == t.worker_id))
    for venue_id in sorted(await team_venue_ids(db, t.worker_id), key=str):
        item = (await time_off_items(db, [t], venue_id=venue_id))[0]
        body = f"{_days_text(t)}." + (f" “{t.reason}”" if t.reason else "")
        if item.conflicts:
            body += f"\nBooked here then: {'; '.join(item.conflicts[:3])}"
        await notify_in(
            db, await manager_ids(db, venue_id), "time_off_request",
            f"{person(worker)} asked for time off", body,
            manager_link(venue_id), venue_id=venue_id, dedupe_key=f"timeoff:{t.id}",
        )


async def time_off_requested(time_off_id) -> None:
    await _run("time_off_requested", _time_off_requested, time_off_id)


async def _time_off_decided(db: AsyncSession, time_off_id) -> None:
    from src.models import TimeOffRequest
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None or t.status not in ("approved", "denied"):
        return
    venue = await db.scalar(select(Venue).where(Venue.id == t.decided_venue_id)) if t.decided_venue_id else None
    approved = t.status == "approved"
    body = f"{_days_text(t)}" + (f" · {venue.name}" if venue else "") + "."
    if t.decision_note:
        body += f"\n“{t.decision_note}”"
    await notify_in(
        db, [t.worker_id], "time_off_decided",
        "Time off approved" if approved else "Time off not approved", body,
        "/profile?tab=time-off", venue_id=t.decided_venue_id, dedupe_key=f"timeoff-d:{t.id}",
    )


async def time_off_decided(time_off_id) -> None:
    await _run("time_off_decided", _time_off_decided, time_off_id)


async def _cert_reviewed(db: AsyncSession, cert_id) -> None:
    from src.models import WorkerCertification
    from src.services.fit import cert_label
    c = await db.scalar(select(WorkerCertification).where(WorkerCertification.id == cert_id))
    if c is None or c.status not in ("verified", "rejected"):
        return
    venue = await db.scalar(select(Venue).where(Venue.id == c.verified_venue_id)) if c.verified_venue_id else None
    label = cert_label(c.cert_type)
    if c.status == "verified":
        title, body = f"{label} verified", f"Checked by {venue.name if venue else 'a venue'}."
    else:
        title = f"{label} wasn't accepted"
        body = f"{venue.name if venue else 'A venue'} says: “{c.review_note}”. Update it on your profile."
    await notify_in(
        db, [c.worker_id], "cert_review", title, body, "/profile?tab=certificates",
        venue_id=c.verified_venue_id, dedupe_key=f"cert-r:{c.id}:{int(c.verified_at.timestamp()) if c.verified_at else 0}",
    )


async def cert_reviewed(cert_id) -> None:
    await _run("cert_reviewed", _cert_reviewed, cert_id)
```

---

## B14. `backend/src/services/notify.py` (EDIT)
Registers the 4 new notification kinds so email/SMS preferences apply.

**Edit 1.** Find:
```python
    "no_show": ("booking", True),            # Phase 30: a manager marked you a no-show
    "unfilled_soon": ("manager", True),      # Phase 30: spots still open 3 h before start
    "test": ("test", True),
}
```
Replace with:
```python
    "no_show": ("booking", True),            # Phase 30: a manager marked you a no-show
    "unfilled_soon": ("manager", True),      # Phase 30: spots still open 3 h before start
    "time_off_request": ("manager", False),  # Phase 31: a team member asked for time off
    "time_off_decided": ("booking", False),  # Phase 31: your time off was approved / declined
    "cert_review": ("booking", False),       # Phase 32: a manager verified / didn't accept a certificate
    "cert_expiring": ("reminder", False),    # Phase 32: a certificate expires in 30 / 7 days, or today
    "test": ("test", True),
}
```

---

## B15. `backend/src/services/notification_worker.py` (EDITS)
New `scan_expiring_certs` step (30 days, 7 days, on the day; each sent once).

**Edit 1.** Find:
```python
  4. managers: people who haven't read an UPDATE to a shift starting within 24h (once per update)
  5. managers: a position still has open spots 3 hours before it starts (once per position; Phase 30)
  6. send due email / SMS from the outbox

```
Replace with:
```python
  4. managers: people who haven't read an UPDATE to a shift starting within 24h (once per update)
  5. managers: a position still has open spots 3 hours before it starts (once per position; Phase 30)
  5b. workers: a certificate expires in 30 days, in 7 days, or today (once each; Phase 32)
  6. send due email / SMS from the outbox

```

**Edit 2.** Find:
```python


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled)):
        try:
            async with AsyncSessionLocal() as db:
```
Replace with:
```python


async def scan_expiring_certs(db: AsyncSession, now: datetime) -> int:
    """Phase 32: remind people 30 days and 7 days before a certificate expires, and on the day."""
    from src.models import WorkerCertification
    from src.services.fit import cert_label
    today = now.date()
    sent = 0
    for c in (await db.execute(
        select(WorkerCertification).where(
            WorkerCertification.expires_on.isnot(None),
            WorkerCertification.expires_on >= today,
            WorkerCertification.expires_on <= today + timedelta(days=30),
            WorkerCertification.status != "rejected",
        )
    )).scalars().all():
        left = (c.expires_on - today).days
        bucket = "0" if left <= 0 else ("7" if left <= 7 else "30")
        label = cert_label(c.cert_type)
        title = f"Your {label.lower()} expires today" if left <= 0 else f"Your {label.lower()} expires in {left} day{'s' if left != 1 else ''}"
        sent += await notify_in(
            db, [c.worker_id], "cert_expiring", title,
            "Renew it and update your profile. Positions that need it can't be booked once it expires.",
            "/profile?tab=certificates", urgent=left <= 0,
            dedupe_key=f"cert-exp:{c.id}:{c.expires_on.isoformat()}:{bucket}",
        )
    return sent


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled), ("certs", scan_expiring_certs)):
        try:
            async with AsyncSessionLocal() as db:
```

---

# PART C: Frontend, worker

New folder: `frontend/src/components/profile/`.

## C1. NEW FILE `frontend/src/utils/availability.js`

```js
/**
 * Phase 31: weekly availability helpers. Weekday 0 = Monday ... 6 = Sunday (matches the API).
 * Times are 'HH:MM' (or '24:00' for end of day); an end earlier than the start runs past midnight.
 */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** '18:30' -> '6:30 PM', '24:00' / '00:00' -> '12:00 AM' */
export function fmtHm(value) {
  if (!value) return '';
  const [h, m] = value.split(':').map(Number);
  const hh = h % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function windowText(w) {
  if (w.start_local === '00:00' && w.end_local === '24:00') return 'All day';
  return `${fmtHm(w.start_local)} – ${fmtHm(w.end_local)}`;
}

/** [{weekday, start_local, end_local}] -> ["Mon 4:00 PM – 12:00 AM", ...] grouped by day */
export function availabilitySummary(windows = []) {
  const byDay = WEEKDAYS.map(() => []);
  windows.forEach((w) => byDay[w.weekday]?.push(windowText(w)));
  return byDay.map((ranges, i) => ({ day: WEEKDAYS[i], ranges })).filter((d) => d.ranges.length);
}

/** Quick presets for the editor */
export const PRESETS = [
  { id: 'evenings', label: 'Evenings (4 PM – midnight)', start: '16:00', end: '24:00', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'weeknights', label: 'Weeknights only', start: '17:00', end: '24:00', days: [0, 1, 2, 3, 4] },
  { id: 'weekends', label: 'Weekends, any time', start: '00:00', end: '24:00', days: [5, 6] },
  { id: 'anytime', label: 'Any time', start: '00:00', end: '24:00', days: [0, 1, 2, 3, 4, 5, 6] },
];

/** 'YYYY-MM-DD' -> 'Mon, Oct 5' without timezone drift */
export function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDayRange(a, b) {
  return a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
}

/** today's date as 'YYYY-MM-DD' in the viewer's time zone */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

---

## C2. NEW FILE `frontend/src/utils/files.js`
Photo resize (canvas), multipart upload, and opening a private file as a blob.

```js
import api from '../api/client';

/**
 * Phase 32: file helpers (no extra packages).
 */

/** Shrinks a photo in the browser to at most `max` px on the long side and returns a JPEG File. */
export function resizeImage(file, max = 640, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please pick a photo (JPG, PNG or WebP).'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not read that photo.'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

/** POST a single file as multipart/form-data. */
export function uploadFile(path, file) {
  const form = new FormData();
  form.append('file', file);
  return api.post(path, form, { headers: { 'Content-Type': 'multipart/form-data' } });
}

/**
 * Opens a private file (certificate scan) in a new tab. The file needs the login token, so it's
 * fetched with axios and shown from a blob URL. The tab is opened first so pop-up blockers allow it.
 */
export async function openProtectedFile(fileId) {
  const win = window.open('', '_blank');
  try {
    const res = await api.get(`/files/${fileId}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}
```

---

## C3. NEW FILE `frontend/src/utils/certs.js`
Must match `CERT_TYPES` in `services/fit.py`.

```js
/**
 * Phase 32: certificate types. Keys and labels match backend/src/services/fit.py CERT_TYPES.
 */
export const CERT_OPTIONS = [
  { key: 'alcohol_server', label: 'Alcohol server card', short: 'Alcohol server' },
  { key: 'food_handler', label: 'Food handler card', short: 'Food handler' },
  { key: 'food_manager', label: 'Food protection manager', short: 'Food manager' },
  { key: 'age_21', label: '21+ confirmed', short: '21+' },
  { key: 'security_license', label: 'Security guard license', short: 'Security license' },
  { key: 'first_aid', label: 'First aid / CPR', short: 'First aid' },
];

export const certShort = (key) => CERT_OPTIONS.find((c) => c.key === key)?.short || key;
```

---

## C4. NEW FILE `frontend/src/pages/ProfilePage.jsx`
Note `w-full` on the page root, the header container and `<main>`.

```jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserRound, CalendarDays, CalendarOff, Award, Bell, Check, AlertCircle, X, CircleDot } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/WorkerProfilePanel';
import AboutSection from '../components/profile/AboutSection';
import AvailabilityEditor from '../components/profile/AvailabilityEditor';
import TimeOffPanel from '../components/profile/TimeOffPanel';
import CertificatesPanel from '../components/profile/CertificatesPanel';
import NotificationSettingsModal from '../components/NotificationSettingsModal';

const MISSING_TEXT = {
  phone: ['Add your mobile number', 'about'],
  photo: ['Add a profile photo', 'about'],
  emergency_contact: ['Add an emergency contact', 'about'],
  availability: ['Set your weekly availability', 'availability'],
};

/**
 * Phase 31 + 32: The signed-in person's profile.
 * Tabs (?tab=): about · availability · time-off · certificates · notifications. Workers see all of them;
 * managers and admins see About and Notifications.
 */
export default function ProfilePage() {
  const { refreshProfile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);   // { type, text }
  const [showNotif, setShowNotif] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/me/profile');
      setProfile(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load your profile.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isWorker = profile?.role === 'worker';
  const tabs = [
    { id: 'about', label: 'About me', icon: UserRound },
    isWorker && { id: 'availability', label: 'Availability', icon: CalendarDays },
    isWorker && { id: 'time-off', label: 'Time off', icon: CalendarOff, badge: (profile?.time_off || []).filter((t) => t.status === 'pending').length },
    isWorker && { id: 'certificates', label: 'Certificates', icon: Award, badge: (profile?.certifications || []).filter((c) => c.expired || c.status === 'rejected').length },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ].filter(Boolean);
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'about';
  const setTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
    if (id === 'notifications') setShowNotif(true);
  };

  useEffect(() => {
    if (tab === 'notifications') setShowNotif(true);
  }, [tab]);

  const ok = (text) => setNotice({ type: 'success', text });
  const fail = (text) => setNotice({ type: 'error', text });
  const afterSave = (next, text) => {
    setProfile(next);
    ok(text);
    refreshProfile?.();
  };
  const reload = async (text) => {
    await load();
    if (text) ok(text);
  };

  if (error) {
    return <div className="w-full min-h-screen bg-slate-950 text-rose-300 p-8 text-center text-sm">{error}</div>;
  }
  if (!profile) {
    return <div className="w-full min-h-screen bg-slate-950 text-slate-500 p-8 text-center text-sm">Loading your profile…</div>;
  }

  const name = `${profile.first_name} ${profile.last_name}`.trim() || profile.email;

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="w-full bg-slate-900 border-b border-slate-800 py-6">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar person={profile} size="w-14 h-14 text-lg" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{name}</h1>
            <p className="text-xs text-slate-400">{profile.email}</p>
          </div>
          {profile.missing.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs space-y-1">
              <p className="font-bold text-amber-200">Finish your profile</p>
              {profile.missing.map((m) => (
                <button key={m} type="button" onClick={() => setTab(MISSING_TEXT[m]?.[1] || 'about')}
                  className="flex items-center gap-1.5 text-amber-100/80 hover:text-white">
                  <CircleDot className="w-3 h-3 text-amber-400" /> {MISSING_TEXT[m]?.[0] || m}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 mt-6 space-y-5">
        <nav className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-2xl" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition ${
                tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <t.icon className="w-4 h-4" /> {t.label}
              {t.badge > 0 && <span className="px-1.5 rounded-full bg-amber-500 text-slate-950 text-[10px]">{t.badge}</span>}
            </button>
          ))}
        </nav>

        {notice && (
          <div className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'success' ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200' : 'bg-rose-950/80 border-rose-700 text-rose-200'}`}>
            <span className="flex items-start gap-2">
              {notice.type === 'success' ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {notice.text}
            </span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="p-0.5 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
          </div>
        )}

        {tab === 'about' && <AboutSection profile={profile} onSaved={afterSave} onError={fail} />}
        {tab === 'availability' && (
          <AvailabilityEditor windows={profile.availability} onError={fail}
            onSaved={(windows, text) => { setProfile((p) => ({ ...p, availability: windows, missing: windows.length ? p.missing.filter((m) => m !== 'availability') : [...new Set([...p.missing, 'availability'])] })); ok(text); }} />
        )}
        {tab === 'time-off' && <TimeOffPanel items={profile.time_off} onChanged={reload} onError={fail} />}
        {tab === 'certificates' && (
          <CertificatesPanel certifications={profile.certifications} types={profile.cert_types} onChanged={reload} onError={fail} />
        )}
        {tab === 'notifications' && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
            <p className="text-sm text-slate-300">Choose what gets emailed or texted to you, quiet hours, and who can find you.</p>
            <button type="button" onClick={() => setShowNotif(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5">
              <Bell className="w-4 h-4" /> Notification settings
            </button>
          </div>
        )}
      </main>

      {showNotif && <NotificationSettingsModal onClose={() => { setShowNotif(false); load(); }} />}
    </div>
  );
}
```

---

## C5. NEW FILE `frontend/src/components/profile/AboutSection.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Camera, Trash2, Save, Phone, HeartPulse, X, Plus } from 'lucide-react';
import api from '../../api/client';
import { Avatar } from '../WorkerProfilePanel';
import { resizeImage, uploadFile } from '../../utils/files';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-semibold text-slate-300';
const SUGGESTED = ['Bartender', 'Barback', 'Server', 'Host', 'Runner', 'Busser', 'Line cook', 'Prep cook', 'Dishwasher', 'Security', 'AV tech', 'Event staff'];
const BIO_MAX = 600;

/**
 * Phase 32: Photo, name, mobile (required for workers), bio, positions I work, emergency contact.
 * Props: profile (MyProfile), onSaved(profile, message), onError(message)
 */
export default function AboutSection({ profile, onSaved, onError }) {
  const isWorker = profile.role === 'worker';
  const [form, setForm] = useState(null);
  const [skillDraft, setSkillDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    setForm({
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      phone: profile.phone || '',
      bio: profile.bio || '',
      skills: profile.skills || [],
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: profile.emergency_contact_phone || '',
    });
  }, [profile]);

  if (!form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addSkill = (value) => {
    const v = (value || '').trim();
    if (!v || form.skills.some((s) => s.toLowerCase() === v.toLowerCase()) || form.skills.length >= 12) return;
    set('skills', [...form.skills, v]);
    setSkillDraft('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/me/profile', form);
      onSaved(res.data, 'Profile saved.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      const small = await resizeImage(file);
      const res = await uploadFile('/me/avatar', small);
      onSaved(res.data, 'Photo updated.');
    } catch (err) {
      onError(err.response?.data?.detail || err.message || 'Could not upload that photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      const res = await api.delete('/me/avatar');
      onSaved(res.data, 'Photo removed.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not remove your photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Photo */}
      <section className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <Avatar person={{ ...profile, avatar_url: profile.avatar_url }} size="w-20 h-20 text-2xl" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Profile photo</p>
          <p className="text-xs text-slate-400">A clear photo of your face helps the door staff and managers know who you are.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className={`px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${photoBusy ? 'opacity-50 pointer-events-none' : ''}`}>
              <Camera className="w-3.5 h-3.5" /> {profile.avatar_url ? 'Change photo' : 'Add a photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickPhoto} />
            </label>
            {profile.avatar_url && (
              <button type="button" onClick={removePhoto} disabled={photoBusy}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            )}
            {photoBusy && <span className="text-xs text-slate-400 self-center">Uploading…</span>}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={labelCls}>First name
            <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>Last name
            <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> Mobile number {isWorker && <span className="text-rose-300">(required)</span>}</span>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(212) 555-0199" inputMode="tel" className={inputCls} />
            <span className="block text-[11px] text-slate-500 font-normal mt-1">Managers can call you, and shift texts go here once you turn texts on in Notifications.</span>
          </label>
          <div className="text-xs text-slate-400 sm:pt-5">
            Signed in as <span className="text-slate-200">{profile.email}</span>
          </div>
        </div>
        <label className={labelCls}>About you
          <textarea value={form.bio} onChange={(e) => set('bio', e.target.value.slice(0, BIO_MAX))} rows={3}
            placeholder="e.g. Eight years behind busy cocktail bars. Comfortable running a service well on my own."
            className={inputCls} />
          <span className="block text-[11px] text-slate-500 font-normal text-right">{form.bio.length}/{BIO_MAX}</span>
        </label>
        {isWorker && (
          <div>
            <p className={labelCls}>Positions I work</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {form.skills.map((s) => (
                <span key={s} className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1">
                  {s}
                  <button type="button" aria-label={`Remove ${s}`} onClick={() => set('skills', form.skills.filter((x) => x !== s))} className="hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input value={skillDraft} onChange={(e) => setSkillDraft(e.target.value)} placeholder="Add a position"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addSkill(skillDraft);
                  }
                }}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white w-36 focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {SUGGESTED.filter((s) => !form.skills.some((x) => x.toLowerCase() === s.toLowerCase())).map((s) => (
                <button key={s} type="button" onClick={() => addSkill(s)}
                  className="px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-400 hover:text-white hover:border-slate-500 inline-flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Emergency contact */}
      {isWorker && (
        <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div>
            <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5"><HeartPulse className="w-4 h-4 text-rose-300" /> Emergency contact</p>
            <p className="text-xs text-slate-400">Only managers of venues you're booked at or on the team with can see this.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={labelCls}>Name
              <input value={form.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} placeholder="e.g. Pat Lee (partner)" className={inputCls} />
            </label>
            <label className={labelCls}>Phone
              <input value={form.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', e.target.value)} inputMode="tel" className={inputCls} />
            </label>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
```

---

## C6. NEW FILE `frontend/src/components/profile/AvailabilityEditor.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Plus, X, Save, Info } from 'lucide-react';
import api from '../../api/client';
import { WEEKDAYS_LONG, PRESETS, fmtHm } from '../../utils/availability';

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const END_TIMES = [...HALF_HOURS.slice(1), '24:00'];
const selCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500';

function toDays(windows) {
  const days = WEEKDAYS_LONG.map(() => []);
  (windows || []).forEach((w) => days[w.weekday]?.push({ start: w.start_local, end: w.end_local }));
  return days;
}

/**
 * Phase 31: Weekly availability. Each day can have one or more time ranges; a range that ends
 * earlier than it starts runs past midnight. Leaving every day empty = "not set" (no warnings anywhere).
 * Props: windows (AvailabilityWindow[]), onSaved(windows, message), onError(message)
 */
export default function AvailabilityEditor({ windows, onSaved, onError }) {
  const [days, setDays] = useState(() => toDays(windows));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDays(toDays(windows));
    setDirty(false);
  }, [windows]);

  const update = (fn) => {
    setDays((prev) => fn(prev.map((d) => d.map((r) => ({ ...r })))));
    setDirty(true);
  };
  const applyPreset = (p) => update(() => WEEKDAYS_LONG.map((_, i) => (p.days.includes(i) ? [{ start: p.start, end: p.end }] : [])));

  const save = async () => {
    setSaving(true);
    try {
      const body = { windows: days.flatMap((ranges, weekday) => ranges.map((r) => ({ weekday, start_local: r.start, end_local: r.end }))) };
      const res = await api.put('/me/availability', body);
      onSaved(res.data, res.data.length ? 'Availability saved.' : 'Availability cleared. Every shift counts as a fit.');
      setDirty(false);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your availability.');
    } finally {
      setSaving(false);
    }
  };

  const empty = days.every((d) => d.length === 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 flex-shrink-0 text-slate-500" />
        <span>
          When you usually can work, in the local time where the venue is. Managers see it when they assign or offer shifts,
          and <b className="text-slate-200">Find shifts</b> can hide what doesn't fit. It never stops you picking up a shift.
          For one-off days away, use <b className="text-slate-200">Time off</b> instead.
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-400 self-center">Quick fill:</span>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => applyPreset(p)}
            className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 hover:text-white hover:border-slate-500">
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
        {WEEKDAYS_LONG.map((name, i) => (
          <div key={name} className="p-3 flex flex-col sm:flex-row sm:items-start gap-2">
            <div className="sm:w-32 flex items-center justify-between sm:block">
              <span className={`text-sm font-semibold ${days[i].length ? 'text-white' : 'text-slate-500'}`}>{name}</span>
              {days[i].length === 0 && <span className="sm:block text-[11px] text-slate-500">Not available</span>}
            </div>
            <div className="flex-1 space-y-1.5">
              {days[i].map((r, j) => {
                const overnight = r.end !== '24:00' && r.end <= r.start;
                return (
                  <div key={j} className="flex flex-wrap items-center gap-2">
                    <select aria-label={`${name} from`} value={r.start} className={selCls}
                      onChange={(e) => update((d) => { d[i][j].start = e.target.value; return d; })}>
                      {HALF_HOURS.map((t) => <option key={t} value={t}>{fmtHm(t)}</option>)}
                    </select>
                    <span className="text-xs text-slate-500">to</span>
                    <select aria-label={`${name} until`} value={r.end} className={selCls}
                      onChange={(e) => update((d) => { d[i][j].end = e.target.value; return d; })}>
                      {END_TIMES.map((t) => <option key={t} value={t}>{t === '24:00' ? 'Midnight' : fmtHm(t)}</option>)}
                    </select>
                    {overnight && <span className="text-[11px] text-indigo-300">next day</span>}
                    <button type="button" aria-label="Remove this range" onClick={() => update((d) => { d[i].splice(j, 1); return d; })}
                      className="p-1 rounded-md text-slate-500 hover:text-rose-300 hover:bg-slate-800">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              <button type="button" onClick={() => update((d) => { d[i].push({ start: '17:00', end: '24:00' }); return d; })}
                className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> {days[i].length ? 'Add another range' : 'Add a time range'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => update(() => WEEKDAYS_LONG.map(() => []))} disabled={empty}
          className="text-xs text-slate-400 underline hover:text-white disabled:opacity-40 disabled:no-underline">
          Clear everything
        </button>
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save availability'}
        </button>
      </div>
    </div>
  );
}
```

---

## C7. NEW FILE `frontend/src/components/profile/TimeOffPanel.jsx`

```jsx
import React, { useState } from 'react';
import { CalendarOff, Send, AlertTriangle, MessageSquareQuote } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { fmtDayRange, todayIso } from '../../utils/availability';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const STATUS = {
  pending: ['Waiting for a manager', 'bg-amber-500/10 text-amber-300 border-amber-500/30'],
  approved: ['Approved', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'],
  denied: ['Not approved', 'bg-rose-500/10 text-rose-300 border-rose-500/30'],
  cancelled: ['Cancelled', 'bg-slate-800 text-slate-400 border-slate-700'],
};

/**
 * Phase 31: Ask for days off and see what happened to earlier requests.
 * Requests go to the managers of every venue you're on the team with; one of them decides.
 * Props: items (TimeOffItem[]), onChanged(message), onError(message)
 */
export default function TimeOffPanel({ items = [], onChanged, onError }) {
  const today = todayIso();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post('/me/time-off', { start_date: start, end_date: end < start ? start : end, reason: reason.trim() || null });
      setReason('');
      onChanged(res.data.conflicts?.length
        ? 'Sent. Heads up: you’re booked on some of those days. Drop or hand off those shifts if you can’t work them.'
        : 'Sent to your managers. You’ll get a notification when they decide.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not send your request.');
    } finally {
      setBusy(false);
    }
  };

  const askCancel = (t) => setConfirm({
    title: t.status === 'approved' ? 'Cancel this time off?' : 'Withdraw this request?',
    message: `${fmtDayRange(t.start_date, t.end_date)}. You can ask again later if you need to.`,
    confirmLabel: t.status === 'approved' ? 'Cancel time off' : 'Withdraw',
    danger: true,
    onConfirm: async () => {
      await api.post(`/me/time-off/${t.id}/cancel`);
      onChanged('Done.');
    },
  });

  const open = items.filter((t) => ['pending', 'approved'].includes(t.status) && t.end_date >= today);
  const past = items.filter((t) => !open.includes(t));

  return (
    <div className="space-y-6">
      <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5"><CalendarOff className="w-4 h-4 text-amber-300" /> Ask for time off</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs font-semibold text-slate-300">First day
            <input type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Last day
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300 sm:col-span-1">Reason (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="e.g. Family wedding" className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">Goes to the managers at the venues you're on the team with. Shifts you're already booked on stay booked.</p>
          <button type="button" onClick={submit} disabled={busy || !start}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Send className="w-4 h-4" /> {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-white">Coming up</h3>
        {open.length === 0 && <p className="text-xs text-slate-500">No time off coming up.</p>}
        {open.map((t) => <TimeOffRow key={t.id} t={t} onCancel={() => askCancel(t)} />)}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-400">Earlier</h3>
          {past.map((t) => <TimeOffRow key={t.id} t={t} />)}
        </section>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function TimeOffRow({ t, onCancel }) {
  const [label, cls] = STATUS[t.status] || [t.status, STATUS.cancelled[1]];
  return (
    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">{fmtDayRange(t.start_date, t.end_date)}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{label}</span>
        </div>
        {t.reason && <p className="text-xs text-slate-400 mt-0.5">{t.reason}</p>}
        {(t.decided_by_name || t.decision_note) && ['approved', 'denied'].includes(t.status) && (
          <p className="text-[11px] text-slate-400 mt-1 inline-flex items-start gap-1">
            <MessageSquareQuote className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              {t.decided_by_name}{t.decided_venue_name ? ` · ${t.decided_venue_name}` : ''}
              {t.decision_note ? `: “${t.decision_note}”` : ''}
            </span>
          </p>
        )}
        {t.conflicts?.length > 0 && ['pending', 'approved'].includes(t.status) && (
          <p className="text-[11px] text-amber-300 mt-1 inline-flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Still booked: {t.conflicts.join('; ')}</span>
          </p>
        )}
      </div>
      {onCancel && (
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold self-start sm:self-auto">
          {t.status === 'approved' ? 'Cancel' : 'Withdraw'}
        </button>
      )}
    </div>
  );
}
```

---

## C8. NEW FILE `frontend/src/components/profile/CertificatesPanel.jsx`

```jsx
import React, { useState } from 'react';
import { BadgeCheck, ShieldAlert, Clock3, Paperclip, FileText, Trash2, Pencil, Plus, Save, X, Award } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { uploadFile, openProtectedFile } from '../../utils/files';
import { fmtDay } from '../../utils/availability';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';

export function certState(c) {
  if (!c) return ['Not added', 'bg-slate-800 text-slate-400 border-slate-700', null];
  if (c.status === 'rejected') return ['Not accepted', 'bg-rose-500/10 text-rose-300 border-rose-500/30', ShieldAlert];
  if (c.expired) return ['Expired', 'bg-rose-500/10 text-rose-300 border-rose-500/30', ShieldAlert];
  if (c.expiring_soon) return ['Expires soon', 'bg-amber-500/10 text-amber-300 border-amber-500/30', Clock3];
  if (c.status === 'verified') return ['Verified', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', BadgeCheck];
  return ['Added · not verified yet', 'bg-sky-500/10 text-sky-300 border-sky-500/30', null];
}

/**
 * Phase 32: The worker's certificates. Some venue positions need one (e.g. Bartender needs an
 * alcohol server card); requests for those positions are blocked until it's here and in date.
 * Changing a certificate sends it back to "not verified".
 * Props: certifications (CertificationItem[]), types (CertTypeInfo[]), onChanged(message), onError(message)
 */
export default function CertificatesPanel({ certifications = [], types = [], onChanged, onError }) {
  const [editing, setEditing] = useState(null);   // cert type key
  const [confirm, setConfirm] = useState(null);
  const byType = Object.fromEntries(certifications.map((c) => [c.cert_type, c]));

  const askDelete = (t) => setConfirm({
    title: `Remove your ${t.label.toLowerCase()}?`,
    message: 'Positions that need it will be locked for you until you add it again.',
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: async () => {
      await api.delete(`/me/certifications/${t.key}`);
      onChanged('Removed.');
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-2">
        <Award className="w-4 h-4 flex-shrink-0 text-slate-500" />
        <span>
          Some positions need a certificate, like an alcohol server card for bartending. Add yours with the expiry date and a
          photo or PDF of the card. A manager checks it and marks it verified. You'll get a reminder 30 days before one expires.
        </span>
      </p>
      {types.map((t) => {
        const c = byType[t.key];
        const [label, cls, Icon] = certState(c);
        return (
          <div key={t.key} className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-white">{t.label}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${cls}`}>
                    {Icon && <Icon className="w-3 h-3" />} {label}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{t.hint}</p>
                {c && (
                  <p className="text-xs text-slate-300 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {c.number && <span>No. {c.number}</span>}
                    {c.expires_on && <span className={c.expired ? 'text-rose-300' : ''}>Expires {fmtDay(c.expires_on)}</span>}
                    {c.status === 'verified' && c.verified_by_name && (
                      <span className="text-emerald-300">Checked by {c.verified_venue_name || c.verified_by_name}</span>
                    )}
                    {c.file_id && (
                      <button type="button" onClick={() => openProtectedFile(c.file_id).catch(() => onError('Could not open the file.'))}
                        className="text-sky-300 hover:underline inline-flex items-center gap-0.5">
                        <FileText className="w-3 h-3" /> View file
                      </button>
                    )}
                  </p>
                )}
                {c?.status === 'rejected' && c.review_note && (
                  <p className="text-xs text-rose-200 bg-rose-500/5 border border-rose-500/30 rounded-lg px-2 py-1 mt-1.5">
                    {c.verified_venue_name || 'A manager'}: “{c.review_note}”. Update it and it goes back for checking.
                  </p>
                )}
              </div>
              {editing !== t.key && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(t.key)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1">
                    {c ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {c ? 'Update' : 'Add'}
                  </button>
                  {c && (
                    <button type="button" onClick={() => askDelete(t)} aria-label={`Remove ${t.label}`}
                      className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/40">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {editing === t.key && (
              <CertForm type={t} cert={c} onCancel={() => setEditing(null)} onError={onError}
                onSaved={(msg) => { setEditing(null); onChanged(msg); }} />
            )}
          </div>
        );
      })}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function CertForm({ type, cert, onCancel, onSaved, onError }) {
  const [number, setNumber] = useState(cert?.number || '');
  const [issued, setIssued] = useState(cert?.issued_on || '');
  const [expires, setExpires] = useState(cert?.expires_on || '');
  const [fileId, setFileId] = useState(cert?.file_id || null);
  const [fileName, setFileName] = useState(cert?.file_id ? 'Current file' : '');
  const [busy, setBusy] = useState(false);

  const attach = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const res = await uploadFile('/me/files', f);
      setFileId(res.data.id);
      setFileName(f.name);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not upload that file.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/me/certifications/${type.key}`, {
        number: number.trim() || null,
        issued_on: type.expires ? issued || null : null,
        expires_on: type.expires ? expires || null : null,
        file_id: fileId,
        remove_file: !fileId,
      });
      onSaved(`${type.label} saved. A manager will check it.`);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-800 space-y-3">
      {type.expires ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs font-semibold text-slate-300">Card / certificate number
            <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Issued (optional)
            <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Expires <span className="text-rose-300">(required)</span>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={inputCls} />
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Bring your ID to your first shift. A manager checks it and marks this verified. Nothing to fill in.</p>
      )}
      {type.expires && (
        <div className="flex flex-wrap items-center gap-2">
          <label className={`px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            <Paperclip className="w-3.5 h-3.5" /> {fileId ? 'Replace photo / PDF' : 'Attach a photo or PDF'}
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={attach} />
          </label>
          {fileId && (
            <span className="text-xs text-slate-300 inline-flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-sky-300" /> {fileName}
              <button type="button" aria-label="Remove file" onClick={() => { setFileId(null); setFileName(''); }} className="text-slate-500 hover:text-rose-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          <span className="text-[11px] text-slate-500">Max 5 MB. Only you and managers you work with can open it.</span>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
        <button type="button" onClick={save} disabled={busy || (type.expires && !expires)}
          className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

---

## C9. NEW FILE `frontend/src/components/worker/ProfileNudge.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, X, ChevronRight } from 'lucide-react';
import api from '../../api/client';

const TEXT = {
  phone: 'mobile number',
  photo: 'photo',
  emergency_contact: 'emergency contact',
  availability: 'weekly availability',
};

/**
 * Phase 31 + 32: a slim "finish your profile" banner on the worker page while something is missing.
 * Hidden for the rest of the visit once dismissed.
 */
export default function ProfileNudge() {
  const [missing, setMissing] = useState([]);
  const [expiring, setExpiring] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get('/me/profile')
      .then((res) => {
        if (!active) return;
        setMissing(res.data.missing || []);
        setExpiring((res.data.certifications || []).filter((c) => c.expired || c.expiring_soon || c.status === 'rejected').length);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (hidden || (missing.length === 0 && expiring === 0)) return null;
  const parts = missing.map((m) => TEXT[m] || m);
  const text = parts.length
    ? `Add your ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`
    : '';
  const certText = expiring ? `${expiring} certificate${expiring === 1 ? ' needs' : 's need'} attention.` : '';
  const tab = missing.length ? (missing.every((m) => m === 'availability') ? 'availability' : 'about') : 'certificates';

  return (
    <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
      <UserRound className="w-5 h-5 text-amber-300 flex-shrink-0" />
      <p className="flex-1 min-w-0 text-xs text-amber-100">
        <b className="text-amber-200">Finish your profile.</b> {text} {certText}
        {missing.includes('phone') && ' Managers need a number to reach you.'}
      </p>
      <Link to={`/profile?tab=${tab}`} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-0.5 whitespace-nowrap">
        Open profile <ChevronRight className="w-3.5 h-3.5" />
      </Link>
      <button type="button" aria-label="Hide" onClick={() => setHidden(true)} className="p-1 rounded-lg text-amber-200/70 hover:bg-white/10">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
```

---

## C10. `frontend/src/App.jsx` (EDITS)
New `/profile` route (all roles, with the Navbar).

**Edit 1.** Find:
```jsx
import VenueProfile from './pages/VenueProfile';
import JoinPage from './pages/JoinPage';

function HomeRedirect() {
```
Replace with:
```jsx
import VenueProfile from './pages/VenueProfile';
import JoinPage from './pages/JoinPage';
import ProfilePage from './pages/ProfilePage';

function HomeRedirect() {
```

**Edit 2.** Find:
```jsx
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
```
Replace with:
```jsx
            />

            {/* Phase 31 + 32: everyone's own profile */}
            <Route
              path="/profile"
              element={
                <ProtectedRoute allowedRoles={['worker', 'venue_manager', 'platform_admin']}>
                  <Navbar />
                  <ProfilePage />
                </ProtectedRoute>
              }
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
```

---

## C11. `frontend/src/components/Navbar.jsx` (EDITS)
Your name (with avatar) links to `/profile`; the phone menu gains "My profile".

**Edit 1.** Find:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin } from 'lucide-react';

export default function Navbar() {
```
Replace with:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';

export default function Navbar() {
```

**Edit 2.** Find:
```jsx

            {user && (
              <div className="text-right hidden lg:block">
                <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                  <span>{userRole.replace('_', ' ')}</span>
                </div>
              </div>
            )}

```
Replace with:
```jsx

            {user && (
              <Link to="/profile" title="Your profile" className={`hidden lg:flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl transition ${
                location.pathname === '/profile' ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                    <span>{userRole.replace('_', ' ')}</span>
                  </div>
                </div>
                <Avatar person={user} size="w-8 h-8 text-xs" />
              </Link>
            )}

```

**Edit 3.** Find:
```jsx

          <nav className="grid gap-2">
            {links.map(({ to, label, icon: Icon, active }) => (
              <Link
                key={to}
```
Replace with:
```jsx

          <nav className="grid gap-2">
            {[...links, { to: '/profile', label: 'My profile', icon: UserRound, active: 'bg-slate-800 text-emerald-400' }].map(({ to, label, icon: Icon, active }) => (
              <Link
                key={to}
```

---

## C12. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)
Adds the profile nudge and the "Fits my availability" filter.

**Edit 1.** Find:
```jsx
import DropShiftDialog from '../components/worker/DropShiftDialog';
import HandoffsPanel from '../components/worker/HandoffsPanel';
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```
Replace with:
```jsx
import DropShiftDialog from '../components/worker/DropShiftDialog';
import HandoffsPanel from '../components/worker/HandoffsPanel';
import ProfileNudge from '../components/worker/ProfileNudge';
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```

**Edit 2.** Find:
```jsx
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);

  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
```
Replace with:
```jsx
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);            // Phase 31: fits my availability, not on time off

  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
```

**Edit 3.** Find:
```jsx
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested]);
  const listingGroups = useMemo(() => {
    const groups = [];
```
Replace with:
```jsx
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      if (fitsOnly && (l.availability === 'outside' || l.time_off === 'approved')) return false;   // Phase 31
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested, fitsOnly]);
  const listingGroups = useMemo(() => {
    const groups = [];
```

**Edit 4.** Find:
```jsx
    return groups;
  }, [filteredListings]);
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested;
  const clearFilters = () => {
    setSearch('');
```
Replace with:
```jsx
    return groups;
  }, [filteredListings]);
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested || fitsOnly;
  const clearFilters = () => {
    setSearch('');
```

**Edit 5.** Find:
```jsx
    setInstantOnly(false);
    setHideRequested(false);
  };

```
Replace with:
```jsx
    setInstantOnly(false);
    setHideRequested(false);
    setFitsOnly(false);
  };

```

**Edit 6.** Find:
```jsx

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {notification && (
          <div className={`mb-5 p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
```
Replace with:
```jsx

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {isWorker && <ProfileNudge />}
        {notification && (
          <div className={`mb-5 p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
```

**Edit 7.** Find:
```jsx
                  Hide ones I've requested
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">Clear filters</button>
```
Replace with:
```jsx
                  Hide ones I've requested
                </button>
                <button type="button" onClick={() => setFitsOnly((v) => !v)}
                  title="Hide shifts outside your weekly availability or on days you have time off"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    fitsOnly ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  <CalendarDays className="w-3.5 h-3.5" /> Fits my availability
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">Clear filters</button>
```

---

## C13. `frontend/src/components/EventListingCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React from 'react';
import { Clock, MapPin, Zap, ShieldCheck, Users, ChevronRight, AlertTriangle, Star } from 'lucide-react';
import PayLabel from './PayLabel';
import { fmtTimeRange } from '../utils/venueTime';
```
Replace with:
```jsx
import React from 'react';
import { Clock, MapPin, Zap, ShieldCheck, Users, ChevronRight, AlertTriangle, Star, Lock, CalendarOff } from 'lucide-react';
import PayLabel from './PayLabel';
import { fmtTimeRange } from '../utils/venueTime';
```

**Edit 2.** Find:
```jsx
                )}
                <span className="text-xs font-bold text-slate-100 truncate">{p.role_type}</span>
                {p.my_status && (
                  <span className={`text-[10px] whitespace-nowrap ${p.my_status === 'dropped' ? 'text-rose-300' : 'text-amber-300'}`}>
```
Replace with:
```jsx
                )}
                <span className="text-xs font-bold text-slate-100 truncate">{p.role_type}</span>
                {!full && p.missing_certs?.length > 0 && (
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-0.5 whitespace-nowrap" title={`Needs ${p.missing_certs.join(', ')}`}>
                    <Lock className="w-3 h-3" /> needs a certificate
                  </span>
                )}
                {p.my_status && (
                  <span className={`text-[10px] whitespace-nowrap ${p.my_status === 'dropped' ? 'text-rose-300' : 'text-amber-300'}`}>
```

**Edit 3.** Find:
```jsx
        )}
      </div>

      {listing.conflict && (
```
Replace with:
```jsx
        )}
      </div>

      {/* Phase 31: the viewer's own availability / time off */}
      {listing.time_off && (
        <p className={`mt-2 text-[11px] flex items-center gap-1 ${listing.time_off === 'approved' ? 'text-rose-300' : 'text-amber-300'}`}>
          <CalendarOff className="w-3.5 h-3.5 flex-shrink-0" />
          {listing.time_off === 'approved' ? 'You have time off that day' : 'You asked for time off that day'}
        </p>
      )}
      {!listing.time_off && listing.availability === 'outside' && (
        <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
          <CalendarOff className="w-3.5 h-3.5 flex-shrink-0" /> Outside your usual availability
        </p>
      )}

      {listing.conflict && (
```

---

## C14. `frontend/src/components/EventListingModal.jsx` (EDITS)
Positions needing certificates are locked with "You need: …" and a link to the profile. There's also a time-off banner.

**Edit 1.** Find:
```jsx
  if (prev && listing.positions.some((p) => p.shift_id === prev)) return prev;
  if (listing.my_request) return listing.my_request.shift_id;
  const open = listing.positions.filter((p) => p.status === 'OPEN');
  return open.length === 1 ? open[0].shift_id : null;
}
```
Replace with:
```jsx
  if (prev && listing.positions.some((p) => p.shift_id === prev)) return prev;
  if (listing.my_request) return listing.my_request.shift_id;
  const open = listing.positions.filter((p) => p.status === 'OPEN' && !(p.missing_certs || []).length);   // Phase 32
  return open.length === 1 ? open[0].shift_id : null;
}
```

**Edit 2.** Find:
```jsx
      )}

      {blockedReason && (
        <div className="mb-4 p-3 rounded-xl border border-amber-700/60 bg-amber-950/40 text-amber-200 text-xs flex items-start gap-2">
```
Replace with:
```jsx
      )}

      {listing.time_off && !isBooked && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
          listing.time_off === 'approved' ? 'border-rose-700/60 bg-rose-950/40 text-rose-200' : 'border-amber-700/60 bg-amber-950/40 text-amber-200'}`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {listing.time_off === 'approved'
              ? 'You have approved time off that day. Request it only if your plans changed.'
              : 'You asked for time off that day. Request it only if your plans changed.'}
          </span>
        </div>
      )}

      {blockedReason && (
        <div className="mb-4 p-3 rounded-xl border border-amber-700/60 bg-amber-950/40 text-amber-200 text-xs flex items-start gap-2">
```

**Edit 3.** Find:
```jsx
              const isMine = mine && mine.shift_id === p.shift_id;
              const locked = LOCKED_POSITION_STATUSES.includes(ps);
              const disabled = !isMine && (full || locked || isBooked || listing.cancelled || listing.started);
              const active = selectedId === p.shift_id;
              const est = estPayText(p);
```
Replace with:
```jsx
              const isMine = mine && mine.shift_id === p.shift_id;
              const locked = LOCKED_POSITION_STATUSES.includes(ps);
              const needsCerts = !isMine && !full && (p.missing_certs || []).length > 0;          // Phase 32
              const disabled = !isMine && (full || locked || needsCerts || isBooked || listing.cancelled || listing.started);
              const active = selectedId === p.shift_id;
              const est = estPayText(p);
```

**Edit 4.** Find:
```jsx
                      </div>
                      {p.role_notes && <p className="text-[11px] text-slate-400 mt-1.5 whitespace-pre-line">{p.role_notes}</p>}
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
```
Replace with:
```jsx
                      </div>
                      {p.role_notes && <p className="text-[11px] text-slate-400 mt-1.5 whitespace-pre-line">{p.role_notes}</p>}
                      {(p.required_certs || []).length > 0 && (
                        <p className={`text-[11px] mt-1.5 inline-flex items-center gap-1 ${needsCerts ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}>
                          <Lock className="w-3 h-3" />
                          {needsCerts ? `You need: ${p.missing_certs.join(', ')}` : `Requires: ${p.required_certs.join(', ')}`}
                        </p>
                      )}
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
```

**Edit 5.** Find:
```jsx
            })}
          </div>

          {listing.positions.some((p) => p.est_pay_min !== null && p.est_pay_min !== undefined) && (
```
Replace with:
```jsx
            })}
          </div>

          {listing.positions.some((p) => p.status === 'OPEN' && (p.missing_certs || []).length > 0) && (
            <p className="text-xs text-amber-200 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
              Some positions need certificates you haven't added yet.{' '}
              <Link to="/profile?tab=certificates" onClick={onClose} className="font-bold underline hover:text-amber-100">Add them on your profile</Link>
              , then come back to request.
            </p>
          )}

          {listing.positions.some((p) => p.est_pay_min !== null && p.est_pay_min !== undefined) && (
```

---

# PART D: Frontend, manager

## D1. NEW FILE `frontend/src/components/manager/TimeOffCard.jsx`

```jsx
import React, { useState } from 'react';
import { CalendarOff, Check, X, AlertTriangle, MessageSquareQuote } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { fmtDayRange } from '../../utils/availability';

/**
 * Phase 31: Time-off requests from this venue's team, waiting for a decision.
 * Shown in the dashboard's side column only while there are some (like the request / hand-off cards).
 * Clashes list the shifts they're booked on HERE during those days.
 * Props: venueId, items (TimeOffItem[]), onOpenWorker(workerId), onDone(message)
 */
export default function TimeOffCard({ venueId, items = [], onOpenWorker, onDone }) {
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const approve = async (t) => {
    setBusy(t.id);
    try {
      await api.post(`/time-off/${t.id}/decide`, { approve: true }, { params: { venue_id: venueId } });
      onDone(`Approved ${t.worker_name}'s time off.${t.conflicts?.length ? ' They’re still booked on some of those days, so find cover or remove them.' : ''}`);
    } catch (err) {
      onDone(err.response?.data?.detail || 'Could not approve.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const askDeny = (t) => setConfirm({
    title: `Decline ${t.worker_name}'s time off?`,
    message: `${fmtDayRange(t.start_date, t.end_date)}. They’ll see your note.`,
    confirmLabel: 'Decline',
    danger: true,
    input: { label: 'Note for them', placeholder: 'e.g. We’re short that weekend. Can you swap with Sam?', required: true },
    onConfirm: async (note) => {
      await api.post(`/time-off/${t.id}/decide`, { approve: false, note }, { params: { venue_id: venueId } });
      onDone(`Declined. ${t.worker_name} has been told.`);
    },
  });

  if (!items.length) return null;

  return (
    <section id="time-off-queue" className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl scroll-mt-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarOff className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-white">Time off requests</h2>
        <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((t) => (
          <div key={t.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
            <button type="button" onClick={() => onOpenWorker?.(t.worker_id)} className="text-sm font-bold text-white hover:text-emerald-300 text-left">
              {t.worker_name}
            </button>
            <p className="text-xs text-slate-200">{fmtDayRange(t.start_date, t.end_date)}</p>
            {t.reason && (
              <p className="text-[11px] text-slate-400 inline-flex items-start gap-1">
                <MessageSquareQuote className="w-3 h-3 mt-0.5 flex-shrink-0" /> “{t.reason}”
              </p>
            )}
            {t.conflicts?.length > 0 && (
              <p className="text-[11px] text-amber-300 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Booked here then: {t.conflicts.join('; ')}</span>
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => askDeny(t)} disabled={busy === t.id}
                className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Decline
              </button>
              <button type="button" onClick={() => approve(t)} disabled={busy === t.id}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> {busy === t.id ? 'Saving…' : 'Approve'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
```

---

## D2. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
Loads `GET /venues/{id}/time-off`, feeds the strip, and renders `TimeOffCard` above the activity log.

**Edit 1.** Find:
```jsx
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';

/**
```
Replace with:
```jsx
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';
import TimeOffCard from '../components/manager/TimeOffCard';

/**
```

**Edit 2.** Find:
```jsx
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
```
Replace with:
```jsx
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [pendingTimeOff, setPendingTimeOff] = useState([]);   // Phase 31
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
```

**Edit 3.** Find:
```jsx
      }

      const [requestsRes, venueRes, transfersRes, reliabilityRes] = await Promise.all([
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
      ]);

      setPendingRequests(requestsRes.data || []);
```
Replace with:
```jsx
      }

      const [requestsRes, venueRes, transfersRes, reliabilityRes, timeOffRes] = await Promise.all([
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
        api.get(`/venues/${activeId}/time-off`).catch(() => ({ data: [] })),          // Phase 31
      ]);
      setPendingTimeOff(timeOffRes.data || []);

      setPendingRequests(requestsRes.data || []);
```

**Edit 4.** Find:
```jsx
          requests={pendingRequests.length}
          transfers={pendingTransfers.length}
          late={tonightSummary.late}
          openSpots={tonightSummary.openSpots}
```
Replace with:
```jsx
          requests={pendingRequests.length}
          transfers={pendingTransfers.length}
          timeOff={pendingTimeOff.length}
          late={tonightSummary.late}
          openSpots={tonightSummary.openSpots}
```

**Edit 5.** Find:
```jsx
              />
            )}
            <ActivityFeed
              venueId={currentVenueId}
```
Replace with:
```jsx
              />
            )}
            <TimeOffCard
              venueId={currentVenueId}
              items={pendingTimeOff}
              onOpenWorker={setProfileWorkerId}
              onDone={(message, type = 'success') => {
                setNotification({ type, message });
                fetchVenueData(currentVenueId);
              }}
            />
            <ActivityFeed
              venueId={currentVenueId}
```

---

## D3. `frontend/src/components/manager/NeedsYouStrip.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React from 'react';
import { CheckCircle2, Users, ArrowRightLeft, AlarmClock, UserPlus, BellRing } from 'lucide-react';

/**
 * Phase 30: One slim strip at the top of the manager dashboard.
 * Everything waiting on the manager, with a tap to jump to it. When nothing is waiting it shrinks
 * to a single "all caught up" line (the request / hand-off cards are hidden while they're empty).
 * Props: requests (number), transfers (number), late (number: late + missed), openSpots (number: open-spot alerts),
 *        onJump(targetId)  -> 'approval-queue' | 'pending-transfers' | 'tonight-board'
 */
export default function NeedsYouStrip({ requests = 0, transfers = 0, late = 0, openSpots = 0, onJump }) {
  const total = requests + transfers + late + openSpots;

  if (total === 0) {
```
Replace with:
```jsx
import React from 'react';
import { CheckCircle2, Users, ArrowRightLeft, AlarmClock, UserPlus, BellRing, CalendarOff } from 'lucide-react';

/**
 * Phase 30: One slim strip at the top of the manager dashboard.
 * Everything waiting on the manager, with a tap to jump to it. When nothing is waiting it shrinks
 * to a single "all caught up" line (the request / hand-off cards are hidden while they're empty).
 * Props: requests (number), transfers (number), late (number: late + missed), openSpots (number: open-spot alerts),
 *        timeOff (number: Phase 31 time-off requests waiting),
 *        onJump(targetId)  -> 'approval-queue' | 'pending-transfers' | 'tonight-board' | 'time-off-queue'
 */
export default function NeedsYouStrip({ requests = 0, transfers = 0, late = 0, openSpots = 0, timeOff = 0, onJump }) {
  const total = requests + transfers + late + openSpots + timeOff;

  if (total === 0) {
```

**Edit 2.** Find:
```jsx
    transfers > 0 && { id: 'pending-transfers', n: transfers, label: transfers === 1 ? 'hand-off' : 'hand-offs', icon: ArrowRightLeft,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
  ].filter(Boolean);

```
Replace with:
```jsx
    transfers > 0 && { id: 'pending-transfers', n: transfers, label: transfers === 1 ? 'hand-off' : 'hand-offs', icon: ArrowRightLeft,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
    timeOff > 0 && { id: 'time-off-queue', n: timeOff, label: timeOff === 1 ? 'time-off request' : 'time-off requests', icon: CalendarOff,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
  ].filter(Boolean);

```

---

## D4. `frontend/src/components/manager/WeekAtGlance.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React from 'react';
import { FilePen, EyeOff, Users } from 'lucide-react';
import { fmtTime } from '../../utils/venueTime';

```
Replace with:
```jsx
import React from 'react';
import { FilePen, EyeOff, Users, CalendarOff } from 'lucide-react';
import { fmtTime } from '../../utils/venueTime';

```

**Edit 2.** Find:
```jsx
              <p className="text-[10px] text-slate-600 mt-1.5">{d.events.length ? 'Drafts only' : 'Nothing posted'}</p>
            )}
            <ul className="mt-2 space-y-1.5">
              {d.events.map((e) => (
```
Replace with:
```jsx
              <p className="text-[10px] text-slate-600 mt-1.5">{d.events.length ? 'Drafts only' : 'Nothing posted'}</p>
            )}
            {d.time_off?.length > 0 && (
              <p className="mt-1.5 text-[10px] text-amber-200/90 flex items-start gap-1" title={`Approved time off: ${d.time_off.join(', ')}`}>
                <CalendarOff className="w-3 h-3 flex-shrink-0 mt-px" />
                <span className="line-clamp-2">Off: {d.time_off.join(', ')}</span>
              </p>
            )}
            <ul className="mt-2 space-y-1.5">
              {d.events.map((e) => (
```

---

## D5. `frontend/src/components/StaffPositionModal.jsx` (EDITS)
Fit chips, "Assign anyway?", and no offer ticks for people missing certificates or on approved time off.

**Edit 1.** Find:
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, Search, Send, Check, AlertTriangle, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```
Replace with:
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, Search, Send, Check, AlertTriangle, Clock, Lock, CalendarOff, BadgeCheck } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```

**Edit 2.** Find:
```jsx
  }, [position.shift_id, debouncedQ]);

  const selectable = (c) => (c.available || c.requested_this) && !c.offered && !(c.dropped_at && !c.requested_this);   // Phase 29.4
  const toggle = (c) => {
    if (!selectable(c)) return;
```
Replace with:
```jsx
  }, [position.shift_id, debouncedQ]);

  const selectable = (c) => (c.available || c.requested_this) && !c.offered && !(c.dropped_at && !c.requested_this)   // Phase 29.4
    && !(c.missing_certs || []).length && c.time_off !== 'approved';                                               // Phase 31 + 32
  const toggle = (c) => {
    if (!selectable(c)) return;
```

**Edit 3.** Find:
```jsx
  const [reasonFor, setReasonFor] = useState(null);   // Phase 29.4: candidate who dropped this event
  const [reason, setReason] = useState('');

  const assign = async (c, why = null) => {
    // Phase 29.4: someone who dropped this event needs a reason (unless they asked back themselves)
    if (c.dropped_at && !c.requested_this && why === null) {
```
Replace with:
```jsx
  const [reasonFor, setReasonFor] = useState(null);   // Phase 29.4: candidate who dropped this event
  const [reason, setReason] = useState('');
  const [warnFor, setWarnFor] = useState(null);       // Phase 31 + 32: "Assign anyway?" for this candidate

  const assign = async (c, why = null, confirmed = false) => {
    // Phase 31 + 32: missing certificates, time off or outside their availability -> ask first
    if (!confirmed && warningsOf(c).length) {
      setWarnFor(c.worker_id);
      return;
    }
    setWarnFor(null);
    // Phase 29.4: someone who dropped this event needs a reason (unless they asked back themselves)
    if (c.dropped_at && !c.requested_this && why === null) {
```

**Edit 4.** Find:
```jsx
                      </div>
                    )}
                    {reasonFor === c.worker_id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))}
                          onKeyDown={(e) => e.key === 'Enter' && reason.trim().length >= 5 && assign(c, reason.trim())}
                          placeholder="Why are you booking them back?"
                          className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500" />
                        <button type="button" onClick={() => assign(c, reason.trim())} disabled={reason.trim().length < 5 || busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40">Book back</button>
                        <button type="button" onClick={() => setReasonFor(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
```
Replace with:
```jsx
                      </div>
                    )}
                    <FitChips c={c} />
                    {warnFor === c.worker_id && (
                      <div className="mt-2 p-2 rounded-lg border border-amber-500/40 bg-amber-500/5 flex flex-wrap items-center gap-2 w-full">
                        <span className="text-xs text-amber-200 flex-1 min-w-[12rem]">
                          Assign anyway? {warningsOf(c).join(' · ')}.
                        </span>
                        <button type="button" onClick={() => assign(c, null, true)} disabled={busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold disabled:opacity-40">Assign anyway</button>
                        <button type="button" onClick={() => setWarnFor(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
                      </div>
                    )}
                    {reasonFor === c.worker_id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))}
                          onKeyDown={(e) => e.key === 'Enter' && reason.trim().length >= 5 && assign(c, reason.trim(), true)}
                          placeholder="Why are you booking them back?"
                          className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500" />
                        <button type="button" onClick={() => assign(c, reason.trim(), true)} disabled={reason.trim().length < 5 || busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40">Book back</button>
                        <button type="button" onClick={() => setReasonFor(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
```

**Edit 5.** Find:
```jsx
  );
}
```
Replace with:
```jsx
  );
}


/** Phase 31 + 32: what a manager should know before booking this person. */
export function warningsOf(c) {
  const out = [];
  if ((c.missing_certs || []).length) out.push(`Missing ${c.missing_certs.join(', ')}`);
  if (c.time_off === 'approved') out.push('Has approved time off that day');
  if (c.time_off === 'pending') out.push('Asked for time off that day');
  if (c.availability === 'outside') out.push('Outside their availability');
  return out;
}

function FitChips({ c }) {
  const chip = 'px-1.5 py-0.5 rounded text-[10px] font-semibold border inline-flex items-center gap-0.5';
  const items = [];
  (c.missing_certs || []).forEach((m) => items.push(
    <span key={`m-${m}`} className={`${chip} bg-rose-500/10 text-rose-300 border-rose-500/30`}><Lock className="w-3 h-3" /> No {m}</span>,
  ));
  (c.unverified_certs || []).forEach((m) => items.push(
    <span key={`u-${m}`} className={`${chip} bg-sky-500/10 text-sky-300 border-sky-500/30`}><BadgeCheck className="w-3 h-3" /> {m} not verified</span>,
  ));
  if (c.time_off) items.push(
    <span key="off" className={`${chip} ${c.time_off === 'approved' ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
      <CalendarOff className="w-3 h-3" /> {c.time_off === 'approved' ? 'Time off' : 'Asked for time off'}
    </span>,
  );
  if (c.availability === 'outside') items.push(
    <span key="av" className={`${chip} bg-slate-800 text-slate-300 border-slate-700`}><CalendarOff className="w-3 h-3" /> Outside their availability</span>,
  );
  if (c.availability === 'fits') items.push(
    <span key="fit" className={`${chip} bg-emerald-500/10 text-emerald-300 border-emerald-500/30`}><Check className="w-3 h-3" /> Available</span>,
  );
  return items.length ? <div className="flex flex-wrap gap-1 mt-1">{items}</div> : null;
}
```

---

## D6. `frontend/src/components/EventRosterModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
```
Replace with:
```jsx
                                </div>
                              )}
                              {/* Phase 31 + 32 */}
                              {(p.cert_issues || []).map((issue) => (
                                <div key={issue} className={`text-[10px] inline-flex items-center gap-1 mr-2 ${issue.includes('not verified') ? 'text-sky-300' : 'text-rose-300'}`}>
                                  <Lock className="w-3 h-3" /> {issue.includes('not verified') ? issue : `Missing: ${issue}`}
                                </div>
                              ))}
                              {p.time_off && (
                                <div className={`text-[10px] inline-flex items-center gap-1 ${p.time_off === 'approved' ? 'text-rose-300' : 'text-amber-300'}`}>
                                  <AlertTriangle className="w-3 h-3" /> {p.time_off === 'approved' ? 'Has approved time off that day' : 'Asked for time off that day'}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
```

---

## D7. `frontend/src/components/WorkerProfilePanel.jsx` (EDITS)
Adds bio and positions, certificates with View / Verify / Not accepted, availability, time off, and the emergency contact.

**Edit 1.** Find:
```jsx
import React, { useEffect, useState } from 'react';
import { Phone, Mail, Star, ThumbsUp, ThumbsDown, Clock, Building2, StickyNote } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { Phone, Mail, Star, ThumbsUp, ThumbsDown, Clock, Building2, StickyNote, HeartPulse, CalendarDays, CalendarOff, Award, FileText, BadgeCheck, XCircle } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import ConfirmDialog from './ConfirmDialog';
import { availabilitySummary, fmtDay, fmtDayRange } from '../utils/availability';
import { openProtectedFile } from '../utils/files';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
```

**Edit 2.** Find:
```jsx
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
```
Replace with:
```jsx
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);   // Phase 32: after a certificate review
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
```

**Edit 3.** Find:
```jsx
      active = false;
    };
  }, [venueId, workerId, refreshKey]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
```
Replace with:
```jsx
      active = false;
    };
  }, [venueId, workerId, refreshKey, reloadTick]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
```

**Edit 4.** Find:
```jsx
      {!compact && (
        <div className="flex items-start gap-3">
          <Avatar person={m} size="w-12 h-12 text-base" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
```
Replace with:
```jsx
      {!compact && (
        <div className="flex items-start gap-3">
          <Avatar person={{ ...m, avatar_url: data.avatar_url || m.avatar_url }} size="w-12 h-12 text-base" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
```

**Edit 5.** Find:
```jsx
      )}

      {m.notes && (
        <p className="text-xs text-slate-200 whitespace-pre-line bg-amber-500/5 border border-amber-500/30 rounded-xl p-2.5">
          <span className="text-amber-300 font-semibold inline-flex items-center gap-1 mr-1"><StickyNote className="w-3 h-3" /> Private note:</span>
          {m.notes}
        </p>
      )}

      <div>
```
Replace with:
```jsx
      )}

      {/* Phase 32: their own profile */}
      {(data.bio || data.skills?.length > 0) && (
        <div className="text-xs text-slate-300 space-y-1">
          {data.bio && <p className="whitespace-pre-line">{data.bio}</p>}
          {data.skills?.length > 0 && <p className="text-slate-400">Works as: <span className="text-slate-200">{data.skills.join(', ')}</span></p>}
        </div>
      )}

      {m.notes && (
        <p className="text-xs text-slate-200 whitespace-pre-line bg-amber-500/5 border border-amber-500/30 rounded-xl p-2.5">
          <span className="text-amber-300 font-semibold inline-flex items-center gap-1 mr-1"><StickyNote className="w-3 h-3" /> Private note:</span>
          {m.notes}
        </p>
      )}

      <ProfileExtras data={data} venueId={venueId} workerId={workerId} onReviewed={() => setReloadTick((t) => t + 1)} setConfirm={setConfirm} />

      <div>
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
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

const CERT_TONE = {
  verified: ['Verified', 'text-emerald-300', BadgeCheck],
  unverified: ['Not verified yet', 'text-sky-300', null],
  rejected: ['Not accepted', 'text-rose-300', XCircle],
};

/** Phase 31 + 32: certificates (verify / not accepted), availability, time off, emergency contact. */
function ProfileExtras({ data, venueId, workerId, onReviewed, setConfirm }) {
  const [busy, setBusy] = useState(null);
  const review = async (c, status, note = null) => {
    setBusy(c.id);
    try {
      await api.post(`/venues/${venueId}/people/${workerId}/certifications/${c.id}/review`, { status, note });
      onReviewed();
    } finally {
      setBusy(null);
    }
  };
  const askReject = (c) => setConfirm({
    title: `Don't accept this ${c.label.toLowerCase()}?`,
    message: 'They’ll be told what’s wrong so they can fix it. Positions that need it stay locked for them until it’s fixed.',
    confirmLabel: 'Not accepted',
    danger: true,
    input: { label: 'What’s wrong?', placeholder: 'e.g. The photo is blurry, or the name doesn’t match', required: true },
    onConfirm: (note) => review(c, 'rejected', note),
  });
  const summary = availabilitySummary(data.availability);
  const sectionTitle = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <div className={sectionTitle}><Award className="w-3.5 h-3.5" /> Certificates</div>
        {data.certifications?.length ? (
          <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
            {data.certifications.map((c) => {
              const [label, tone, Icon] = CERT_TONE[c.status] || CERT_TONE.unverified;
              return (
                <div key={c.id} className="px-3 py-2 bg-slate-950 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold text-slate-100">{c.label}</span>
                  <span className={`inline-flex items-center gap-0.5 font-semibold ${c.expired ? 'text-rose-300' : tone}`}>
                    {Icon && <Icon className="w-3 h-3" />} {c.expired ? 'Expired' : label}
                  </span>
                  {c.expires_on && <span className="text-slate-400">exp. {fmtDay(c.expires_on)}</span>}
                  {c.number && <span className="text-slate-500">No. {c.number}</span>}
                  {c.status === 'verified' && c.verified_venue_name && <span className="text-slate-500">by {c.verified_venue_name}</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    {c.file_id && (
                      <button type="button" onClick={() => openProtectedFile(c.file_id).catch(() => {})}
                        className="px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:text-white inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" /> View
                      </button>
                    )}
                    {c.status !== 'verified' && (
                      <button type="button" disabled={busy === c.id} onClick={() => review(c, 'verified')}
                        className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
                        Verify
                      </button>
                    )}
                    {c.status !== 'rejected' && (
                      <button type="button" disabled={busy === c.id} onClick={() => askReject(c)}
                        className="px-2 py-1 rounded-md border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                        Not accepted
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">None added.</p>
        )}
      </div>

      <div>
        <div className={sectionTitle}><CalendarDays className="w-3.5 h-3.5" /> Usually available</div>
        {summary.length ? (
          <ul className="text-xs text-slate-300 space-y-0.5">
            {summary.map((d) => <li key={d.day}><span className="text-slate-500 w-9 inline-block">{d.day}</span> {d.ranges.join(', ')}</li>)}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">Not set.</p>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <div className={sectionTitle}><CalendarOff className="w-3.5 h-3.5" /> Time off</div>
          {data.time_off?.length ? (
            <ul className="text-xs space-y-0.5">
              {data.time_off.map((t) => (
                <li key={t.id} className={t.status === 'approved' ? 'text-rose-200' : 'text-amber-200'}>
                  {fmtDayRange(t.start_date, t.end_date)} · {t.status === 'approved' ? 'approved' : 'waiting for a decision'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Nothing coming up.</p>
          )}
        </div>
        {(data.emergency_contact_name || data.emergency_contact_phone) && (
          <div>
            <div className={sectionTitle}><HeartPulse className="w-3.5 h-3.5" /> Emergency contact</div>
            <p className="text-xs text-slate-200">
              {data.emergency_contact_name}
              {data.emergency_contact_phone && (
                <a href={`tel:${data.emergency_contact_phone}`} className="ml-2 text-emerald-300 hover:underline">{data.emergency_contact_phone}</a>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
```

---

## D8. `frontend/src/components/TeamModal.jsx` (EDITS)
Verified certificate chips and "• N to verify" on each row.

**Edit 1.** Find:
```jsx
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

```
Replace with:
```jsx
import {
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus, BadgeCheck,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import WorkerProfilePanel, { Avatar } from './WorkerProfilePanel';
import { certShort } from '../utils/certs';
import { fmtShortDate } from '../utils/venueTime';

```

**Edit 2.** Find:
```jsx
            ))}
            {m.notes && <span title={m.notes} className="text-[10px] text-amber-300">• note</span>}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
```
Replace with:
```jsx
            ))}
            {m.notes && <span title={m.notes} className="text-[10px] text-amber-300">• note</span>}
            {(m.certs || []).map((k) => (
              <span key={k} title="Verified certificate" className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold inline-flex items-center gap-0.5">
                <BadgeCheck className="w-2.5 h-2.5" /> {certShort(k)}
              </span>
            ))}
            {m.cert_attention > 0 && (
              <span className="text-[10px] text-sky-300" title="Open the row to check and verify">• {m.cert_attention} to verify</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
```

---

## D9. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
"Requires:" toggles on each position.

**Edit 1.** Find:
```jsx
import EventTemplatesPanel from './EventTemplatesPanel';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

const POLICIES = [
```
Replace with:
```jsx
import EventTemplatesPanel from './EventTemplatesPanel';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';
import { CERT_OPTIONS } from '../utils/certs';

const POLICIES = [
```

**Edit 2.** Find:
```jsx
    tips_eligible: !!p.tips_eligible,
    tip_pool: !!p.tip_pool,
  };
}
```
Replace with:
```jsx
    tips_eligible: !!p.tips_eligible,
    tip_pool: !!p.tip_pool,
    required_certs: p.required_certs || [],   // Phase 32
  };
}
```

**Edit 3.** Find:
```jsx
        tips_eligible: draft.tips_eligible,
        tip_pool: draft.tips_eligible ? draft.tip_pool : false,
      });
      onChanged();
```
Replace with:
```jsx
        tips_eligible: draft.tips_eligible,
        tip_pool: draft.tips_eligible ? draft.tip_pool : false,
        required_certs: CERT_OPTIONS.map((c) => c.key).filter((k) => draft.required_certs.includes(k)),   // Phase 32
      });
      onChanged();
```

**Edit 4.** Find:
```jsx
          <EyeOff className="w-3.5 h-3.5" /> Hide pay
        </label>
        {position.is_active && dirty && (
          <button type="button" onClick={save} disabled={saving}
```
Replace with:
```jsx
          <EyeOff className="w-3.5 h-3.5" /> Hide pay
        </label>
      </div>
      {/* Phase 32: certificates people need before they can request this position */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-400 mr-1">Requires:</span>
        {CERT_OPTIONS.map((c) => {
          const on = draft.required_certs.includes(c.key);
          return (
            <button key={c.key} type="button" disabled={disabled} aria-pressed={on}
              onClick={() => setDraft({ ...draft, required_certs: on ? draft.required_certs.filter((k) => k !== c.key) : [...draft.required_certs, c.key] })}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition ${
                on ? 'bg-sky-500/15 text-sky-200 border-sky-500/40' : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-300'}`}>
              {c.short}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end">
        {position.is_active && dirty && (
          <button type="button" onClick={save} disabled={saving}
```

**Edit 5.** Find:
```jsx
          <p className="text-xs text-slate-400">
            These fill in pay and tips when you post a shift. Changing them doesn't change shifts you already posted. "Hide pay" keeps the rate off listings until someone is booked.
          </p>
          {loadingPositions ? (
```
Replace with:
```jsx
          <p className="text-xs text-slate-400">
            These fill in pay and tips when you post a shift. Changing them doesn't change shifts you already posted. "Hide pay" keeps the rate off listings until someone is booked.
            "Requires" means people need that certificate on their profile (in date) to request or be offered the position. You can still assign someone yourself after a warning.
          </p>
          {loadingPositions ? (
```

---

## E. Rebuild & verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data.** The four new tables are created automatically when the backend starts (`create_all`). Only the new columns on existing tables need adding:
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(30);
ALTER TABLE venue_positions ADD COLUMN IF NOT EXISTS required_certs TEXT[] NOT NULL DEFAULT '{}';
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
**As a worker:**
1. **Nudge:** `/worker` shows "Finish your profile…" with **Open profile**. Clicking your name in the navbar (or "My profile" in the phone menu) opens `/profile`.
2. **About me:**
   * Add a photo; it appears in the navbar.
   * Clearing your mobile number and saving is refused ("A mobile number is required…").
   * Add positions from the suggestions and an emergency contact, then save. Those items disappear from "Finish your profile".
3. **Availability:**
   * **Evenings (4 PM – midnight)** fills every day. Add a second range, or pick an end time earlier than the start (it shows "next day").
   * Save.
   * In **Find shifts**, a morning event says "Outside your usual availability", and **Fits my availability** hides it.
4. **Time off:**
   * Ask for a range that includes a shift you're booked on. It says "Waiting for a manager" and lists **Still booked: …**.
   * Asking again for overlapping days is refused.
5. **Certificates:**
   * Add an alcohol server card (expiry required) with a photo attached. It shows **Added · not verified yet**, and **View file** opens it.
   * With the card removed, a Bartender position that requires it shows 🔒 "You need: …" and can't be selected.

**As the manager:**

6. **Positions:** Venue Settings → Positions & pay → Bartender → tap **Alcohol server** and **21+**, then Save.
7. **Time off:**
   * The strip shows "1 time-off request", and the **Time off requests** card lists the clash.
   * **Decline** needs a note.
   * **Approve**: the worker is told, and This week shows "Off: name" on those days.
8. **Assign / Offer on the Bartender position:**
   * The chips show missing certificates, "not verified", time off and availability.
   * **Assign** on someone with a warning asks **Assign anyway?**.
   * Offers to people missing the card, or on approved time off, are skipped with the reason.
9. **Verify:**
   * Team → open the worker → Certificates → **View**, **Verify**. The worker gets "…verified", and the Team row shows a green chip.
   * **Not accepted** needs a note and notifies them.
   * When the worker edits the card, it goes back to "not verified".
10. **Roster:** a booked person without the required card shows "Missing: Alcohol server card". One with approved time off that day shows "Has approved time off that day".
11. **Reminders:** a card expiring within 30 days sends one "expires in N days" notification (then again at 7 days and on the day).